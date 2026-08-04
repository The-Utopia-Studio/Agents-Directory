import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { runtimeInvoker } from "../src/invoke/index.js";
import { config } from "../src/config.js";

const VALID_OUTPUT = `### LinkedIn About

I help venture teams turn complex ideas into practical tools.

I build grounded workflow systems for early-stage teams.

One delivery validated 167 acceptance criteria across five screens.

If your team needs a clearer path from idea to build, reach out.

### Spoken event introduction

Test Fellow builds grounded workflow systems for venture teams.

### Suggested headline

Workflow builder for venture teams`;

const ARTIFACTS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/artifacts",
);
const RUNTIME_ARTIFACTS_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../src/invoke/runtimeArtifacts.js"),
).href;

/**
 * Mirror production boot: top-level snapshotArtifact assignment, no try/catch.
 * Fixtures live under the artifacts root so the path check does not soft-return
 * null before the frontmatter guard runs — that soft path is for unreadable
 * dirs, not for a loaded artifact missing its lists.
 */
async function spawnBootWithSkill(skillBody) {
  const dir = await mkdtemp(join(ARTIFACTS_ROOT, ".boot-fail-"));
  await writeFile(join(dir, "SKILL.md"), skillBody);
  const harness = join(dir, "boot.mjs");
  await writeFile(
    harness,
    `import { pathToFileURL } from "node:url";
import { snapshotArtifact } from ${JSON.stringify(RUNTIME_ARTIFACTS_URL)};
const SNAPSHOT = snapshotArtifact(pathToFileURL(${JSON.stringify(`${dir}/`)}), "SKILL.md");
console.log("boot-continued", Boolean(SNAPSHOT));
`,
  );
  try {
    return spawnSync(process.execPath, [harness], { encoding: "utf8" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
  assert.equal(exported.artifactVersion, "biocraft-singleshot-v7");
  assert.equal(
    exported.filename,
    `A7-biocraft-singleshot-v7-${expectedDigest.slice(0, 7)}-SKILL.md`,
  );
  assert.match(
    exported.content,
    /^artifact_version: biocraft-singleshot-v7$/m,
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
              content: [{ type: "text", text: VALID_OUTPUT }],
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
  // Deliberately misleading directory record: the manifest must ignore it and
  // report the guardrails declared inside the digested artifact instead.
  await app.svc.putAgent({
    ...agent,
    version: "biocraft.v1.1",
    guardrails: ["Directory-record guardrail that must not reach the manifest"],
    successCriteria: ["Directory-record criterion that must not reach it"],
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
    `attachment; filename="A7-biocraft-singleshot-v7-${expectedDigest.slice(0, 7)}.zip"`,
  );
  const manifest = files.get("MANIFEST.md").toString();
  assert.match(manifest, /Agent name: Biocraft single-shot draft/);
  assert.match(manifest, /Directory display ID: A7/);
  assert.match(manifest, /Artifact mode: single-shot/);

  // Exactly one version is offered as the one to quote back; the catalog label
  // appears only as a cross-reference, in prose that says so.
  assert.match(
    manifest,
    /\*\*Artifact version — quote this when returning a result:\*\*\n`biocraft-singleshot-v7`/,
  );
  assert.match(
    manifest,
    /a separate label that tracks the catalog entry rather than this download[\s\S]*?`A7` version biocraft\.v1\.1\./,
  );
  assert.doesNotMatch(manifest, /^- Directory version label:/m);
  assert.equal(
    manifest.includes(`Artifact digest: \`${expectedDigest}\``),
    true,
  );
  assert.match(manifest, /Artifact digest algorithm: `sha256`/);
  assert.match(manifest, /`SKILL\.md` — The exact single-shot system artifact/);
  assert.match(manifest, /single-shot artifact/);
  assert.match(manifest, /not the full Chrome\/Google Drive/);
  assert.match(manifest, /hosted runtime executes this same server-owned/);
  // Guardrails and criteria come from the digested artifact, never the record.
  const skill = files.get("SKILL.md").toString();
  assert.doesNotMatch(manifest, /Directory-record guardrail/);
  assert.doesNotMatch(manifest, /Directory-record criterion/);
  assert.match(manifest, /Never fabricate or alter a metric/);
  assert.match(manifest, /Preserve qualifiers such as Intern/);
  assert.match(manifest, /LinkedIn About hook is 200 characters or fewer/);
  assert.match(manifest, /Spoken event introduction reads aloud in 20 to 30/);
  assert.match(
    manifest,
    /Do not add a CTA to the third-person event introduction/,
  );
  const guardrailBullets = manifest
    .split("## Guardrails")[1]
    .split("## Success criteria")[0]
    .match(/^- /gm);
  assert.equal(guardrailBullets.length, 10);
  // The frontmatter declaration and the prose the model reads must stay in step.
  const skillGuardrails = skill.split("\n## Guardrails\n")[1];
  assert.equal(skillGuardrails.match(/^\d+\. /gm).length, guardrailBullets.length);
  assert.match(skill, /^checks:\n(?:  - .+\n){3}/m);
  assert.match(skill, /about_hook_max_200_characters/);
  assert.match(skill, /about_max_2600_characters/);
  assert.match(skill, /headline_max_220_characters/);
  assert.match(skill, /about_has_no_delimiter_separated_keyword_run/);
  assert.match(skill, /draft_has_no_em_dash/);
  assert.match(skill, /draft_has_no_ai_cliche_phrase/);
  assert.match(skill, /about_closing_has_cta/);

  // The count in the sentence must match the list it introduces.
  const returnBlock = manifest.split("## Return a result")[1];
  assert.match(returnBlock, /Return these three items/);
  assert.equal(returnBlock.match(/^\d+\. \*\*/gm).length, 3);
  assert.match(returnBlock, /1\. \*\*Output\*\*/);
  assert.match(returnBlock, /2\. \*\*Rating\*\*/);
  assert.match(returnBlock, /3\. \*\*Artifact version\*\*/);
  assert.match(
    manifest,
    /Machine provenance is recorded separately as\s+`sha256:[a-f0-9]{64}`/,
  );

  assert.match(skill, /artifact-mode: single-shot/);
  assert.doesNotMatch(skill, /Google Drive MCP tools/);
});

test("boot aborts when frontmatter guardrails or success_criteria are missing or empty", async () => {
  const expected = /Artifact loaded without frontmatter guardrails and success_criteria/;
  const baseFrontmatter = `---
name: boot-fail-fixture
description: Fixture for asserting import-time abort.
artifact-mode: single-shot
artifact_version: boot-fail-v0
`;

  const cases = [
    {
      name: "both lists missing",
      body: `${baseFrontmatter}---\n\n# Fixture\n`,
    },
    {
      name: "guardrails missing",
      body: `${baseFrontmatter}success_criteria:
  - LinkedIn About hook is 200 characters or fewer
---\n\n# Fixture\n`,
    },
    {
      name: "success_criteria missing",
      body: `${baseFrontmatter}guardrails:
  - Never fabricate a metric
---\n\n# Fixture\n`,
    },
    {
      name: "guardrails empty",
      body: `${baseFrontmatter}guardrails:
success_criteria:
  - LinkedIn About hook is 200 characters or fewer
---\n\n# Fixture\n`,
    },
    {
      name: "success_criteria empty",
      body: `${baseFrontmatter}guardrails:
  - Never fabricate a metric
success_criteria:
---\n\n# Fixture\n`,
    },
  ];

  for (const fixture of cases) {
    const result = await spawnBootWithSkill(fixture.body);
    assert.notEqual(
      result.status,
      0,
      `${fixture.name}: process must exit non-zero (got ${result.status})`,
    );
    assert.match(
      result.stderr,
      expected,
      `${fixture.name}: stderr must carry the boot-failure throw, not a warning`,
    );
    assert.equal(
      /boot-continued/.test(result.stdout),
      false,
      `${fixture.name}: must not continue after the throw`,
    );
  }
});

test("boot aborts when mechanical checks are missing or unknown", async () => {
  const base = `---
name: boot-fail-check-fixture
description: Fixture for check validation.
artifact-mode: single-shot
artifact_version: boot-fail-check-v0
guardrails:
  - Never fabricate a metric
success_criteria:
  - LinkedIn About hook is 200 characters or fewer
`;
  const cases = [
    {
      name: "missing checks",
      body: `${base}---\n\n# Fixture\n`,
      expected: /Artifact loaded without frontmatter checks/,
    },
    {
      name: "unknown check",
      body: `${base}checks:
  - check_that_no_runtime_implements
---\n\n# Fixture\n`,
      expected: /unknown runtime check.*check_that_no_runtime_implements/,
    },
  ];

  for (const fixture of cases) {
    const result = await spawnBootWithSkill(fixture.body);
    assert.notEqual(result.status, 0, `${fixture.name}: process must exit non-zero`);
    assert.match(result.stderr, fixture.expected);
    assert.equal(/boot-continued/.test(result.stdout), false);
  }
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
