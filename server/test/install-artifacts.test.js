import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { runtimeInvoker } from "../src/invoke/index.js";
import { config } from "../src/config.js";

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function unzipStored(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    assert.equal(method, 0, "test parser expects stored ZIP entries");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString();
    files.set(name, buffer.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

test("A7 copy export is byte-for-byte the system artifact runtime executes", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-install-skill-")));
  const app = await buildApp({ store });
  const base = await listen(app, t);

  // Client-controlled descriptive pointers do not select an export path.
  const agent = await app.svc.getAgent("A7");
  await app.svc.putAgent({
    ...agent,
    invocation: {
      ...agent.invocation,
      artifact: "../../../../client-controlled/SKILL.md",
    },
  });

  const response = await fetch(
    `${base}/api/agents/A7/install-artifact/skill`,
  );
  assert.equal(response.status, 200);
  const exported = await response.json();
  const expectedDigest = createHash("sha256")
    .update(Buffer.from(exported.content))
    .digest("hex");
  assert.equal(exported.kind, "single-shot");
  assert.equal(exported.artifactDigest, expectedDigest);
  assert.equal(exported.artifactDigestAlgorithm, "sha256");
  assert.equal(
    exported.filename,
    `A7-biocraft-v1-${expectedDigest.slice(0, 7)}-SKILL.md`,
  );
  assert.doesNotMatch(exported.content, /artifact-(?:commit|digest):/);
  assert.match(exported.content, /## Mode boundary/);
  assert.match(exported.content, /no Chrome, Google Drive, filesystem/);
  assert.doesNotMatch(exported.content, /mcp__Claude_in_Chrome__navigate/);
  assert.doesNotMatch(exported.content, /Google Drive MCP tools/);

  let runtimeSystem;
  const invoker = runtimeInvoker({
    ...config,
    runtime: {
      anthropic: {
        ...config.runtime.anthropic,
        apiKey: "test-runtime-key",
        fetch: async (_url, init) => {
          runtimeSystem = JSON.parse(init.body).system;
          return {
            ok: true,
            json: async () => ({
              model: "claude-sonnet-4-6",
              content: [{ type: "text", text: "Draft bio." }],
            }),
          };
        },
      },
    },
  });
  await invoker.invoke(
    { id: "A7", invocation: { type: "runtime", mode: "single-shot" } },
    { fellowName: "Test Fellow", sourceMaterial: "Grounded profile text." },
  );
  assert.equal(runtimeSystem, exported.content);
});

test("A7 ZIP contains the runtime folder and follows the evaluated version", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-install-zip-")));
  const app = await buildApp({ store });
  const base = await listen(app, t);
  const agent = await app.svc.getAgent("A7");
  await app.svc.putAgent({
    ...agent,
    version: "biocraft.v1.1",
    guardrails: ["Never fabricate metrics", "No em dashes"],
    successCriteria: ["About is at most 2,600 characters"],
  });

  const response = await fetch(
    `${base}/api/agents/A7/install-artifact/download`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(
    response.headers.get("x-artifact-digest-algorithm"),
    "sha256",
  );

  const files = unzipStored(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(
    [...files.keys()].sort(),
    ["MANIFEST.md", "SKILL.md"].sort(),
  );
  const expectedDigest = createHash("sha256")
    .update(files.get("SKILL.md"))
    .digest("hex");
  assert.equal(response.headers.get("x-artifact-digest"), expectedDigest);
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="A7-biocraft-v1.1-${expectedDigest.slice(0, 7)}.zip"`,
  );
  const manifest = files.get("MANIFEST.md").toString();
  assert.match(manifest, /Agent name: Biocraft single-shot draft/);
  assert.match(manifest, /Directory display ID: A7/);
  assert.match(manifest, /Directory version label: biocraft\.v1\.1/);
  assert.match(manifest, /Artifact version: v1\.1/);
  assert.match(manifest, /Artifact mode: single-shot/);
  assert.equal(
    manifest.includes(`Artifact digest: \`${expectedDigest}\``),
    true,
  );
  assert.match(manifest, /Artifact digest algorithm: `sha256`/);
  assert.match(manifest, /`SKILL\.md` — The exact single-shot system artifact/);
  assert.match(manifest, /single-shot artifact/);
  assert.match(manifest, /not the full Chrome\/Google Drive/);
  assert.match(manifest, /hosted runtime executes this same server-owned/);
  assert.match(manifest, /Never fabricate metrics/);
  assert.match(manifest, /About is at most 2,600 characters/);
  assert.match(manifest, /1\. \*\*Output\*\*/);
  assert.match(manifest, /2\. \*\*Rating\*\*/);
  assert.match(manifest, /3\. \*\*Artifact digest\*\*/);
  assert.match(manifest, /4\. \*\*Artifact digest algorithm\*\*/);

  assert.match(files.get("SKILL.md").toString(), /artifact-mode: single-shot/);
  assert.doesNotMatch(files.get("SKILL.md").toString(), /Google Drive MCP tools/);
});

test("download capability fails closed without a registered artifact", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-install-none-")));
  const app = await buildApp({ store });
  const base = await listen(app, t);

  const capability = await (
    await fetch(`${base}/api/agents/A1/invocation-capability`)
  ).json();
  assert.deepEqual(capability.installArtifact, { available: false });

  const response = await fetch(
    `${base}/api/agents/A1/install-artifact/download`,
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "No install artifact for this agent");
});
