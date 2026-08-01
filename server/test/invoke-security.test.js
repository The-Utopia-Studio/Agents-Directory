import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  getInvoker,
  RUNTIME_TIMEOUT_MS,
  runtimeInvoker,
} from "../src/invoke/index.js";
import {
  getRuntimeInputContract,
  resolveRuntimeInputs,
} from "../src/invoke/runtimeArtifacts.js";
import { SEED_AGENTS } from "../src/scripts/seed.js";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { config } from "../src/config.js";

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

function runtimeConfig(overrides = {}) {
  return {
    ...config,
    runtime: {
      anthropic: {
        ...config.runtime.anthropic,
        apiKey: "test-runtime-key",
        ...overrides,
      },
    },
  };
}

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("runtime uses a dedicated 120 second generation timeout", () => {
  assert.equal(RUNTIME_TIMEOUT_MS, 120_000);
  assert.equal(config.runtime.anthropic.timeoutMs, 120_000);
  assert.ok(60_000 < config.runtime.anthropic.timeoutMs);
});

test("runtime timeout aborts the Anthropic request with a visible 504", async () => {
  const invoker = runtimeInvoker(
    runtimeConfig({
      timeoutMs: 10,
      fetch: async (_url, { signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
  );
  await assert.rejects(
    () =>
      invoker.invoke(
        { id: "A7", invocation: { type: "runtime", mode: "single-shot" } },
        {
          fellowName: "Test Fellow",
          sourceMaterial: "All interview answers and source material.",
        },
      ),
    (error) =>
      error.status === 504 &&
      error.message === "Anthropic generation timed out",
  );
});

test("single-shot mode rejects incomplete source material before calling Anthropic", async () => {
  let called = false;
  const invoker = runtimeInvoker(
    runtimeConfig({
      fetch: async () => {
        called = true;
        throw new Error("must not be called");
      },
    }),
  );
  await assert.rejects(
    () =>
      invoker.invoke(
        { id: "A7", invocation: { type: "runtime", mode: "single-shot" } },
        { fellowName: "Test Fellow" },
      ),
    (error) =>
      error.status === 400 &&
      /none was supplied: Source material/.test(error.message),
  );
  assert.equal(called, false);
});

test("single-shot inputs resolve by contract alias, not by editable record labels", async () => {
  const contract = getRuntimeInputContract("A7");
  assert.deepEqual(
    contract.fields.map((f) => [f.key, f.required, f.multiline]),
    [
      ["fellowName", true, false],
      ["sourceMaterial", true, true],
      ["interviewAnswers", false, true],
    ],
  );
  assert.equal(
    contract.fields.some((f) => "aliases" in f),
    false,
  );

  // The exact payload the directory form sent after A7's labels were renamed.
  const renamedLabels = {
    "Fellow's name": "Haniyah Umair",
    "LinkedIn URL": "https://www.linkedin.com/in/example/",
    "Google Drive folder or pitch deck": "",
    "pasted text or local file path": "Current role: Agentic Operator Intern.",
    "short-interview answers": "In her own words: the brief is everything.",
  };
  const resolved = resolveRuntimeInputs("A7", renamedLabels);
  assert.deepEqual(resolved.missing, []);
  assert.deepEqual(resolved.values, {
    fellowName: "Haniyah Umair",
    sourceMaterial: "Current role: Agentic Operator Intern.",
    interviewAnswers: "In her own words: the brief is everything.",
  });

  // Unsupported inputs are neither required nor forwarded to the model.
  assert.deepEqual(
    contract.unsupported.map((u) => u.label),
    ["LinkedIn URL", "Google Drive folder or pitch deck", "Local file path"],
  );
  assert.deepEqual(
    resolveRuntimeInputs("A7", {
      fellowName: "Haniyah Umair",
      sourceMaterial: "Profile text.",
    }).missing,
    [],
  );
});

test("single-shot run forwards only contract fields to Anthropic", async () => {
  let request;
  const invoker = runtimeInvoker(
    runtimeConfig({
      fetch: async (_url, init) => {
        request = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Draft bio." }],
          }),
        };
      },
    }),
  );
  await invoker.invoke(
    { id: "A7", invocation: { type: "runtime", mode: "single-shot" } },
    {
      "Fellow's name": "Haniyah Umair",
      "pasted text or local file path": "Profile text.",
      "LinkedIn URL": "https://www.linkedin.com/in/example/",
      "Google Drive folder or pitch deck": "https://drive.google.com/x",
    },
  );
  assert.deepEqual(JSON.parse(request.messages[0].content), {
    fellowName: "Haniyah Umair",
    sourceMaterial: "Profile text.",
  });
});

test(
  "live Biocraft single-shot runtime returns generated bio text",
  {
    skip:
      process.env.RUN_LIVE_ANTHROPIC_TESTS !== "true" ||
      !config.runtime.anthropic.apiKey,
  },
  async () => {
    const invoker = runtimeInvoker(config);
    const result = await invoker.invoke(
      {
        id: "A7",
        invocation: { type: "runtime", mode: "single-shot" },
      },
      {
        fellowName: "Alex Morgan",
        sourceMaterial:
          "Alex builds workflow software for venture teams and has spent six years helping founders turn fragmented operating data into clear decisions.",
        proudestOutcome:
          "Helped 40 venture teams reduce weekly reporting time by 30 percent.",
        roleAndWhy:
          "I build practical workflow tools so founders can spend less time reporting and more time building.",
        mission:
          "Replace fragmented venture operations with clear, usable systems.",
        skills:
          "venture operations, workflow design, product strategy, data systems, founder support",
        contact: "Send me a message on LinkedIn.",
        confirmation: "All inputs are complete. Draft the three deliverables now.",
      },
    );
    assert.match(result.output, /Alex Morgan/i);
    assert.ok(result.output.length > 100);
    assert.equal(result.provider, "anthropic");
    assert.equal(result.modelId, "claude-sonnet-4-6");
    assert.equal(typeof result.inputTokens, "number");
    assert.equal(typeof result.outputTokens, "number");
  },
);

test("missing Anthropic key is a visible non-2xx failure without a key leak", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-key-"));
  const store = createStore(dir);
  const app = await buildApp({
    store,
    config: runtimeConfig({ apiKey: "" }),
  });
  const base = await listen(app, t);

  const capability = await fetch(
    `${base}/api/agents/A7/invocation-capability`,
  );
  const { inputContract, ...capabilityFlags } = await capability.json();
  assert.deepEqual(capabilityFlags, {
    invocationType: "runtime",
    mode: "single-shot",
    serverRun: true,
    artifactAvailable: true,
    configured: false,
    runnable: false,
    unavailableReason: "Runtime is not configured on the server",
  });
  assert.deepEqual(
    inputContract.fields.map((f) => f.key),
    ["fellowName", "sourceMaterial", "interviewAnswers"],
  );
  const response = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputs: { name: "Test Fellow" } }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "Runtime is not configured on the server");
  assert.doesNotMatch(body.error, /test-runtime-key|sk-ant/i);
});

test("Anthropic API failures stay non-2xx and do not expose the key", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-model-"));
  const store = createStore(dir);
  const app = await buildApp({
    store,
    config: runtimeConfig({
      model: "broken-model",
      fetch: async (_url, init) => {
        assert.equal(JSON.parse(init.body).model, "broken-model");
        return new Response(JSON.stringify({ error: { message: "bad model" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  });
  const base = await listen(app, t);

  const response = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inputs: {
        fellowName: "Test Fellow",
        sourceMaterial: "All interview answers and source material.",
      },
    }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, "Anthropic Messages API returned 400");
  assert.doesNotMatch(body.error, /test-runtime-key|sk-ant/i);
  const [trace] = await store.all("traces");
  assert.equal(trace.status, "error");
  assert.equal(trace.provider, "anthropic");
  assert.equal(trace.modelId, "broken-model");
  assert.equal(trace.agentVersion, "1.0");
  assert.equal("input" in trace, false);
  assert.equal("output" in trace, false);
  assert.equal("failureReason" in trace, false);
});

test("single-shot runtime uses the server artifact, persists metadata, and links rating", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-real-"));
  const store = createStore(dir);
  let request;
  const app = await buildApp({
    store,
    config: runtimeConfig({
      fetch: async (_url, init) => {
        request = {
          headers: init.headers,
          body: JSON.parse(init.body),
          signal: init.signal,
        };
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(
          JSON.stringify({
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: "Test Fellow builds practical tools for venture teams.",
              },
            ],
            usage: { input_tokens: 2345, output_tokens: 17 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    }),
  });
  const base = await listen(app, t);
  const original = await app.svc.getAgent("A7");
  const capabilityResponse = await fetch(
    `${base}/api/agents/A7/invocation-capability`,
  );
  const { inputContract, ...capabilityFlags } = await capabilityResponse.json();
  assert.deepEqual(capabilityFlags, {
    invocationType: "runtime",
    mode: "single-shot",
    serverRun: true,
    artifactAvailable: true,
    configured: true,
    runnable: true,
    unavailableReason: null,
  });
  assert.deepEqual(
    inputContract.unsupported.map((u) => u.label),
    ["LinkedIn URL", "Google Drive folder or pitch deck", "Local file path"],
  );

  // This unauthenticated write can alter the store record, but neither field
  // can change the server-owned prompt selected by the A7 artifact registry.
  const put = await fetch(`${base}/api/agents/A7`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...original,
      prompt: "MALICIOUS CLIENT PROMPT",
      invocation: { type: "runtime", artifact: "../../client-controlled.md" },
    }),
  });
  assert.equal(put.status, 200);

  const beforeHealth = await app.svc.fleetHealth();
  const response = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inputs: {
        fellowName: "Test Fellow",
        sourceMaterial:
          "All interview answers: builds practical tools for venture teams.",
      },
    }),
  });
  assert.equal(response.status, 201);
  const run = await response.json();
  assert.equal(
    run.output,
    "Test Fellow builds practical tools for venture teams.",
  );
  assert.equal(run.status, "ok");
  assert.equal(run.via, "runtime");
  assert.equal(run.mode, "single-shot");
  assert.equal(run.tracePersisted, true);
  assert.ok(run.traceId);
  assert.match(request.body.system, /# Biocraft — Fellow Bio Writer/);
  assert.match(request.body.system, /## Hosted single-shot mode/);
  assert.match(request.body.system, /This is not the full interactive Biocraft workflow/);
  assert.doesNotMatch(request.body.system, /MALICIOUS CLIENT PROMPT/);
  assert.equal(request.body.model, "claude-sonnet-4-6");
  assert.equal(request.body.max_tokens, 4096);
  assert.equal(request.headers["x-api-key"], "test-runtime-key");

  const trace = await store.get("traces", run.traceId);
  assert.equal(trace.source, "real");
  assert.equal(trace.provider, "anthropic");
  assert.equal(trace.modelId, "claude-sonnet-4-6");
  assert.equal(trace.inputTokens, 2345);
  assert.equal(trace.outputTokens, 17);
  assert.equal(trace.totalTokens, 2362);
  assert.equal("costUsd" in trace, false);
  assert.equal(typeof trace.latencyMs, "number");
  assert.equal(trace.metadata.via, "runtime");
  assert.equal(trace.metadata.mode, "single-shot");
  assert.equal(trace.agentVersion, "1.0");
  assert.equal("agentVersionId" in trace, false);
  assert.equal("input" in trace, false);
  assert.equal("output" in trace, false);
  assert.equal("failureReason" in trace, false);
  assert.equal(trace.outputDigestAlgorithm, "sha256");
  assert.equal(
    trace.outputDigest,
    createHash("sha256").update(run.output).digest("hex"),
  );

  const feedbackResponse = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5, notes: "Voice matched." }),
    },
  );
  assert.equal(feedbackResponse.status, 201);
  const feedback = await feedbackResponse.json();
  assert.equal(feedback.traceId, run.traceId);
  assert.equal(feedback.rating, 5);
  assert.equal("notes" in feedback, false);
  assert.equal((await store.all("feedback")).length, 1);

  const invalidRating = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 6 }),
    },
  );
  assert.equal(invalidRating.status, 400);
  const crossAgent = await fetch(
    `${base}/api/agents/A1/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5 }),
    },
  );
  assert.equal(crossAgent.status, 404);
  assert.equal((await store.all("feedback")).length, 1);
  assert.deepEqual((await app.svc.getAgent("A7")).evalHistory, []);
  assert.deepEqual(await app.svc.fleetHealth(), beforeHealth);
});

test("serverRun false stays hidden by capability and rejects run with 400", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-manual-"));
  const store = createStore(dir);
  const app = await buildApp({ store });
  const base = await listen(app, t);

  const capability = await fetch(
    `${base}/api/agents/A1/invocation-capability`,
  );
  assert.equal(capability.status, 200);
  assert.deepEqual(await capability.json(), {
    invocationType: "link",
    mode: null,
    serverRun: false,
    artifactAvailable: true,
    configured: true,
    inputContract: null,
    runnable: false,
    unavailableReason: null,
  });
  const run = await fetch(`${base}/api/agents/A1/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputs: {} }),
  });
  assert.equal(run.status, 400);
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
    true,
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
    /capability\.serverRun&&capability\.artifactAvailable&&capability\.configured&&capability\.runnable/,
  );
  assert.match(appSource, /This is not the full \/biocraft agent/);
  assert.doesNotMatch(appSource, /inferredUsabilityModes|getUsabilityModes/);
  assert.match(appSource, /MISCONFIGURED: this agent has no stored usabilityModes/);
  const langfuseSource = await readFile(
    new URL("../src/observability/langfuseAdapter.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(langfuseSource, /input:\s*trace\.input/);
  assert.doesNotMatch(langfuseSource, /output:\s*trace\.output/);
  assert.match(langfuseSource, /outputDigest:\s*trace\.outputDigest/);
});
