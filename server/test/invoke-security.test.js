import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  requestJsonEndpoint,
  SAFE_INVOCATION_HEADERS,
  validateInvocationUrl,
} from "../src/invoke/networkPolicy.js";
import { getInvoker } from "../src/invoke/index.js";
import { SEED_AGENTS } from "../src/scripts/seed.js";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";

test("HTTP invocation rejects local, encoded, private, and metadata targets", async () => {
  assert.deepEqual(SAFE_INVOCATION_HEADERS, {
    "content-type": "application/json",
  });
  const blocked = [
    "file:///etc/passwd",
    "http://localhost/run",
    "http://127.0.0.1/run",
    "http://2130706433/run",
    "http://0177.0.0.1/run",
    "http://0x7f000001/run",
    "http://10.0.0.1/run",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/run",
    "http://[::ffff:127.0.0.1]/run",
    "http://[::ffff:7f00:1]/run",
    "http://[::127.0.0.1]/run",
  ];
  for (const url of blocked) {
    await assert.rejects(() => validateInvocationUrl(url), {
      message: /Invalid|HTTP or HTTPS|local|non-public/,
    });
  }

  await assert.rejects(
    () =>
      validateInvocationUrl("https://metadata.google.internal/computeMetadata/v1", {
        resolveHostname: async () => [
          { address: "169.254.169.254", family: 4 },
        ],
      }),
    /non-public/,
  );
});

test("every redirect destination is revalidated before another request", async () => {
  let requests = 0;
  await assert.rejects(
    () =>
      requestJsonEndpoint(
        "https://public.example/run",
        { input: "fixture" },
        {
          resolveHostname: async (hostname) => [
            {
              address:
                hostname === "public.example" ? "93.184.216.34" : "127.0.0.1",
              family: 4,
            },
          ],
          transport: async () => {
            requests += 1;
            return {
              statusCode: 302,
              headers: { location: "http://169.254.169.254/latest/meta-data" },
              body: "",
            };
          },
        },
      ),
    /non-public/,
  );
  assert.equal(requests, 1, "blocked redirect must not receive a second request");
});

test("HTTP invocation timeout aborts the in-flight request", async () => {
  await assert.rejects(
    () =>
      requestJsonEndpoint(
        "https://public.example/run",
        { input: "fixture" },
        {
          timeoutMs: 10,
          resolveHostname: async () => [
            { address: "93.184.216.34", family: 4 },
          ],
          transport: async (_target, _body, { signal }) =>
            await new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
            }),
        },
      ),
    (error) => error.status === 504 && /timed out/.test(error.message),
  );
});

test("custom transport is rejected outside the Node test runner", () => {
  const moduleUrl = new URL(
    "../src/invoke/networkPolicy.js",
    import.meta.url,
  ).href;
  const script = `
    import { requestJsonEndpoint } from ${JSON.stringify(moduleUrl)};
    try {
      await requestJsonEndpoint("https://public.example/run", {}, {
        transport: async () => ({ statusCode: 200, headers: {}, body: "bypass" })
      });
      process.exitCode = 2;
    } catch (error) {
      console.log(error.message);
    }
  `;
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { encoding: "utf8", env },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Custom invocation transport is test-only/);
});

test("failed HTTP run returns non-2xx while file trace writes are disabled", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-invoke-"));
  const store = createStore(dir);
  const app = await buildApp({ store });
  const agent = await app.svc.getAgent("A2");
  await app.svc.putAgent({
    ...agent,
    invocation: { type: "http", url: "http://127.0.0.1/private" },
  });

  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/agents/A2/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: { fixture: "approved" } }),
    },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.status, "error");
  assert.equal(body.traceId, undefined);
  assert.equal(body.tracePersisted, false);
});

test("usability modes remain separate from the scalar invocation adapter", async () => {
  const agent = SEED_AGENTS.find((candidate) => candidate.id === "A2");
  assert.equal(typeof agent.invocation.type, "string");
  assert.deepEqual(agent.usabilityModes, [
    "hosted-run",
    "download-install",
  ]);
  assert.equal(getInvoker(agent, {}).serverRun, true);
  assert.equal(
    getInvoker({ invocation: { type: "mcp" } }, {}).serverRun,
    false,
  );
  assert.equal(
    getInvoker({ invocation: { type: "runtime" } }, {}).serverRun,
    false,
  );
  const appSource = await readFile(
    new URL("../../app.js", import.meta.url),
    "utf8",
  );
  assert.match(
    appSource,
    /usabilityModes:\["hosted-run","download-install"\]/,
  );
  assert.match(
    appSource,
    /hasUsabilityMode\(a,"hosted-run"\)&&\["mock","http"\]/,
  );
  assert.doesNotMatch(appSource, /inferredUsabilityModes|getUsabilityModes/);
  assert.match(appSource, /MISCONFIGURED: this agent has no stored usabilityModes/);
});
