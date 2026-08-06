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
import { costUsdFromUsage } from "../src/invoke/llm/pricing.js";
import {
  getRuntimeInputContract,
  resolveRuntimeInputs,
  validateRuntimeArtifactOutput,
} from "../src/invoke/runtimeArtifacts.js";
import { SEED_AGENTS } from "../src/scripts/seed.js";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { config } from "../src/config.js";
import {
  identityHeaders,
  testClerkOptions,
} from "./clerkTestIdentity.js";

const VALID_BIOCRAFT_OUTPUT = `### LinkedIn About

I help venture teams turn complex ideas into practical tools.

I have spent two years building workflow systems for early-stage teams.

One delivery validated 167 acceptance criteria across five working screens.

If your venture team needs a clearer path from idea to build, reach out.

### Spoken event introduction

Test Fellow builds grounded workflow systems for venture teams.

### Suggested headline

Agentic workflow builder for venture teams`;

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
  const app = await buildApp({
    store,
    config: { ...config, apiToken: "", clerk: testClerkOptions() },
  });
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
      headers: identityHeaders(),
      body: JSON.stringify({ inputs: { fixture: "approved" } }),
    },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.status, "error");
  assert.equal(body.traceId, undefined);
  assert.equal(body.tracePersisted, false);
});

function openaiResponse({
  text,
  model = "gpt-5.6-terra",
  input_tokens = 10,
  output_tokens = 10,
}) {
  return {
    model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens,
      output_tokens,
      total_tokens: input_tokens + output_tokens,
    },
  };
}

function runtimeConfig(overrides = {}) {
  const { clerk: clerkOverride, provider = "openai", ...providerOverrides } =
    overrides;
  return {
    ...config,
    apiToken: "",
    clerk: clerkOverride || testClerkOptions(),
    runtime: {
      ...config.runtime,
      provider,
      [provider]: {
        ...(config.runtime[provider] || {}),
        apiKey: "test-runtime-key",
        ...providerOverrides,
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
  assert.equal(config.runtime.openai.timeoutMs, 120_000);
  assert.ok(60_000 < config.runtime.openai.timeoutMs);
});

test("runtime timeout aborts the OpenAI request with a visible 504", async () => {
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
      error.message === "OpenAI generation timed out",
  );
});

test("single-shot mode rejects incomplete source material before calling the model", async () => {
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

test("Biocraft mechanical checks reject hook, keyword-run, and CTA regressions", () => {
  assert.deepEqual(
    validateRuntimeArtifactOutput("A7", VALID_BIOCRAFT_OUTPUT),
    [],
  );

  const longHook = VALID_BIOCRAFT_OUTPUT.replace(
    "I help venture teams turn complex ideas into practical tools.",
    `I ${"help venture teams ship grounded systems ".repeat(7)}`,
  );
  const hookFailure = validateRuntimeArtifactOutput("A7", longHook)[0];
  assert.equal(hookFailure.checkId, "about_hook_max_200_characters");
  assert.match(hookFailure.message, /hook is \d+ characters; maximum is 200/);
  // Structural facts, so a reviewer can tell how far over it went.
  assert.ok(hookFailure.hookChars > 200);
  assert.equal(hookFailure.limit, 200);
  assert.ok(hookFailure.paragraphCount > 0);

  const longAboutBody = "Grounded delivery sentence. ".repeat(120);
  const longAbout = VALID_BIOCRAFT_OUTPUT.replace(
    /### LinkedIn About\n[\s\S]*?\n### Spoken event introduction/,
    `### LinkedIn About\nI help venture teams turn complex ideas into practical tools.\n\n${longAboutBody}\n\nIf your venture team needs a clearer path from idea to build, reach out.\n\n### Spoken event introduction`,
  );
  const aboutFailure = validateRuntimeArtifactOutput("A7", longAbout).find(
    (row) => row.checkId === "about_max_2600_characters",
  );
  assert.ok(aboutFailure);
  assert.ok(aboutFailure.aboutChars > 2600);
  assert.equal(aboutFailure.limit, 2600);

  const longHeadline = VALID_BIOCRAFT_OUTPUT.replace(
    "Agentic workflow builder for venture teams",
    `Agentic ${"workflow builder for venture teams and operators ".repeat(8)}`,
  );
  const headlineFailure = validateRuntimeArtifactOutput("A7", longHeadline).find(
    (row) => row.checkId === "headline_max_220_characters",
  );
  assert.ok(headlineFailure);
  assert.ok(headlineFailure.headlineChars > 220);
  assert.equal(headlineFailure.limit, 220);

  const keywordRun = VALID_BIOCRAFT_OUTPUT.replace(
    "One delivery validated 167 acceptance criteria across five working screens.",
    "n8n · AI automation · Agentic systems · LLMs",
  );
  const runFailure = validateRuntimeArtifactOutput("A7", keywordRun)[0];
  assert.equal(
    runFailure.checkId,
    "about_has_no_delimiter_separated_keyword_run",
  );
  assert.equal(runFailure.delimiter, "·");
  assert.ok(runFailure.segmentCount >= 2);

  const noAboutCta = VALID_BIOCRAFT_OUTPUT.replace(
    "If your venture team needs a clearer path from idea to build, reach out.",
    "The work stays grounded in the supplied evidence.",
  ).replace(
    "Test Fellow builds grounded workflow systems for venture teams.",
    "Test Fellow builds grounded workflow systems for venture teams. Reach out.",
  );
  const ctaFailure = validateRuntimeArtifactOutput("A7", noAboutCta)[0];
  assert.equal(ctaFailure.checkId, "about_closing_has_cta");
  // The three signals are recorded, so "model omitted a CTA" is separable
  // from "detector missed a CTA that is present".
  assert.equal(ctaFailure.hasContactChannel, false);
  assert.equal(ctaFailure.hasImperativeOpener, false);
  assert.equal(ctaFailure.hasInvitationFrame, false);
  assert.ok(ctaFailure.windowParagraphs >= 2);
});

test("v6 scopes delimiter-separated keyword runs to the LinkedIn About", () => {
  for (const [section, line] of [
    ["Spoken event introduction", "Test Fellow builds grounded workflow systems for venture teams."],
    ["Suggested headline", "Agentic workflow builder for venture teams"],
  ]) {
    const relocated = VALID_BIOCRAFT_OUTPUT.replace(
      line,
      "n8n · AI automation · Agentic systems · LLMs",
    );
    const failures = validateRuntimeArtifactOutput("A7", relocated);
    assert.equal(
      failures.some((failure) => failure.checkId === "about_has_no_delimiter_separated_keyword_run"),
      false,
      `${section} may use its normal delimiter format`,
    );
  }
});

test("the CTA check accepts real CTAs that a phrase list rejected", () => {
  // Each of these failed the v3 fixed-phrase list. A check that rejects valid
  // output teaches reviewers to ignore it, so these are regression-locked.
  const closings = {
    availabilityFrame: "Available for advisory work.",
    imperativeOpener: "Book a call.",
    contactChannel: "For speaking enquiries, email hello@example.com.",
    availabilityPresent: "Currently taking on new projects.",
    conditionalConnect: "If you're working on agentic systems and want to compare notes, connect with me here on LinkedIn.",
    firstPersonWillingness: "I would like to connect with teams working on responsible agentic systems.",
    firstPersonInvitation: "I'd love to hear from you.",
    conversationalInvitation: "Happy to chat.",
  };
  for (const [name, closing] of Object.entries(closings)) {
    const output = VALID_BIOCRAFT_OUTPUT.replace(
      "If your venture team needs a clearer path from idea to build, reach out.",
      closing,
    );
    assert.deepEqual(
      validateRuntimeArtifactOutput("A7", output),
      [],
      `${name}: "${closing}" is a valid CTA and must not fail the check`,
    );
  }

  // It must still catch the real v2 regression: a closing with no invitation,
  // no imperative, and no channel.
  const noCta = VALID_BIOCRAFT_OUTPUT.replace(
    "If your venture team needs a clearer path from idea to build, reach out.",
    "The work stays grounded in the supplied evidence.",
  ).replace(
    "Test Fellow builds grounded workflow systems for venture teams.",
    "Test Fellow builds grounded workflow systems for venture teams. Reach out.",
  );
  assert.equal(validateRuntimeArtifactOutput("A7", noCta).length, 1);
});

test("v6 rejects em dashes and double-hyphen substitutes in every generated section", () => {
  for (const [section, line] of [
    ["LinkedIn About", "One delivery validated 167 acceptance criteria across five working screens."],
    ["Spoken event introduction", "Test Fellow builds grounded workflow systems for venture teams."],
    ["Suggested headline", "Agentic workflow builder for venture teams"],
  ]) {
    for (const mark of ["—", "--"]) {
      const output = VALID_BIOCRAFT_OUTPUT.replace(line, `${line} ${mark} grounded delivery`);
      const failure = validateRuntimeArtifactOutput("A7", output).find(
        (candidate) => candidate.checkId === "draft_has_no_em_dash",
      );
      assert.equal(failure?.section, section);
    }
  }
});

test("v6 rejects registered multi-word AI cliche phrases in every generated section", () => {
  for (const [section, line] of [
    ["LinkedIn About", "One delivery validated 167 acceptance criteria across five working screens."],
    ["Spoken event introduction", "Test Fellow builds grounded workflow systems for venture teams."],
    ["Suggested headline", "Agentic workflow builder for venture teams"],
  ]) {
    const output = VALID_BIOCRAFT_OUTPUT.replace(line, "This work sits at the intersection of AI and product development.");
    const failure = validateRuntimeArtifactOutput("A7", output).find(
      (candidate) => candidate.checkId === "draft_has_no_ai_cliche_phrase",
    );
    assert.equal(failure?.section, section);
  }
  const nearMiss = VALID_BIOCRAFT_OUTPUT.replace(
    "One delivery validated 167 acceptance criteria across five working screens.",
    "This work maps intersections between AI and product development.",
  );
  assert.equal(
    validateRuntimeArtifactOutput("A7", nearMiss).some(
      (failure) => failure.checkId === "draft_has_no_ai_cliche_phrase",
    ),
    false,
  );
});

test("v6 retains exact-word matching for registered single AI cliche terms", () => {
  const output = VALID_BIOCRAFT_OUTPUT.replace(
    "I help venture teams turn complex ideas into practical tools.",
    "I leverage practical systems for venture teams.",
  );
  assert.deepEqual(
    validateRuntimeArtifactOutput("A7", output).map((failure) => failure.checkId),
    ["draft_has_no_ai_cliche_phrase"],
  );
  const nonMatch = VALID_BIOCRAFT_OUTPUT.replace(
    "I help venture teams turn complex ideas into practical tools.",
    "I study leveraged buyouts and practical systems.",
  );
  assert.equal(
    validateRuntimeArtifactOutput("A7", nonMatch).some(
      (failure) => failure.checkId === "draft_has_no_ai_cliche_phrase",
    ),
    false,
    "exact-word matching must not reject a longer unrelated word",
  );
});

test("the CTA window is the closing, so a mid-text CTA does not pass", () => {
  // Sarah's rule is "one or two final lines". A window that grows to fill a
  // short About would accept a bio that invites contact in the middle and
  // then trails off, which is the failure the check exists to catch.
  const midTextCta = `### LinkedIn About

I help venture teams turn complex ideas into practical tools.

Reach out if you want a clearer path from idea to build.

I have spent two years building workflow systems for early-stage teams.

One delivery validated 167 acceptance criteria across five working screens.

### Spoken event introduction

Test Fellow builds grounded workflow systems for venture teams.

### Suggested headline

Agentic workflow builder for venture teams`;

  const [failure] = validateRuntimeArtifactOutput("A7", midTextCta);
  assert.equal(failure.checkId, "about_closing_has_cta");
  assert.equal(failure.windowParagraphs, 2);
  assert.equal(failure.paragraphCount, 4);
});

test("a failed check returns the output it was billed for, marked", async () => {
  const failing = VALID_BIOCRAFT_OUTPUT.replace(
    "If your venture team needs a clearer path from idea to build, reach out.",
    "The work stays grounded in supplied evidence.",
  ).replace(
    "Test Fellow builds grounded workflow systems for venture teams.",
    "Test Fellow builds grounded workflow systems for venture teams. Reach out.",
  );
  const invoker = runtimeInvoker(
    runtimeConfig({
      fetch: async () => ({
        ok: true,
        json: async () =>
          openaiResponse({
            text: failing,
            input_tokens: 900,
            output_tokens: 400,
          }),
      }),
    }),
  );

  const result = await invoker.invoke(
    { id: "A7", invocation: { type: "runtime", mode: "single-shot" } },
    { fellowName: "Test Fellow", sourceMaterial: "Grounded source material." },
  );

  // The tokens were spent before the check ran; throwing them away with the
  // output is what made a check failure impossible to diagnose or attribute.
  assert.equal(result.output, failing);
  assert.equal(result.totalTokens, 1300);
  assert.equal(result.costUsd, costUsdFromUsage("gpt-5.6-terra", {
    inputTokens: 900,
    outputTokens: 400,
  }));
  assert.equal(result.checkResults.length, 1);
  assert.equal(result.checkResults[0].checkId, "about_closing_has_cta");
});

test("single-shot run forwards only contract fields to OpenAI Responses", async () => {
  let request;
  const invoker = runtimeInvoker(
    runtimeConfig({
      fetch: async (_url, init) => {
        request = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => openaiResponse({ text: VALID_BIOCRAFT_OUTPUT }),
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
  assert.deepEqual(JSON.parse(request.input), {
    fellowName: "Haniyah Umair",
    sourceMaterial: "Profile text.",
  });
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(typeof request.instructions, "string");
  assert.equal(request.store, false);
});

test(
  "live Biocraft single-shot runtime returns generated bio text",
  {
    skip:
      process.env.RUN_LIVE_OPENAI_TESTS !== "true" ||
      !config.runtime.openai.apiKey,
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
    assert.equal(result.provider, "openai");
    assert.equal(result.modelId, "gpt-5.6-terra");
    assert.equal(typeof result.inputTokens, "number");
    assert.equal(typeof result.outputTokens, "number");
    assert.equal(typeof result.costUsd, "number");
  },
);

test("missing OpenAI key is a visible non-2xx failure without a key leak", async (t) => {
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
  const { inputContract, installArtifact, handoff, ...capabilityFlags } =
    await capability.json();
  assert.deepEqual(handoff, { available: false });
  assert.deepEqual(capabilityFlags, {
    invocationType: "runtime",
    mode: "single-shot",
    serverRun: true,
    artifactAvailable: true,
    configured: false,
    runnable: false,
    feedbackNotes: true,
    feedbackNotesMaxChars: 2000,
    unavailableReason: "Runtime is not configured on the server",
  });
  assert.deepEqual(
    inputContract.fields.map((f) => f.key),
    ["fellowName", "sourceMaterial", "interviewAnswers"],
  );
  assert.equal(installArtifact.available, true);
  assert.equal(installArtifact.kind, "single-shot");
  const response = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({ inputs: { name: "Test Fellow" } }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "Runtime is not configured on the server");
  assert.doesNotMatch(body.error, /test-runtime-key|sk-/i);
});

test("OpenAI API failures stay non-2xx and do not expose the key", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-model-"));
  const store = createStore(dir);
  const app = await buildApp({
    store,
    config: runtimeConfig({
      fetch: async (_url, init) => {
        assert.equal(JSON.parse(init.body).model, "gpt-5.6-terra");
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
    headers: identityHeaders(),
    body: JSON.stringify({
      inputs: {
        fellowName: "Test Fellow",
        sourceMaterial: "All interview answers and source material.",
      },
    }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, "OpenAI Responses API returned 400");
  assert.doesNotMatch(body.error, /test-runtime-key|sk-/i);
  const [trace] = await store.all("traces");
  assert.equal(trace.status, "error");
  assert.equal(trace.provider, "openai");
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
          JSON.stringify(
            openaiResponse({
              text: VALID_BIOCRAFT_OUTPUT,
              input_tokens: 2345,
              output_tokens: 17,
            }),
          ),
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
  const { inputContract, installArtifact, handoff, ...capabilityFlags } =
    await capabilityResponse.json();
  // A7 declares hosted-run + download-install, never prepared-handoff, so it
  // must not be offered a briefing.
  assert.deepEqual(handoff, { available: false });
  assert.deepEqual(capabilityFlags, {
    invocationType: "runtime",
    mode: "single-shot",
    serverRun: true,
    artifactAvailable: true,
    configured: true,
    runnable: true,
    feedbackNotes: true,
    feedbackNotesMaxChars: 2000,
    unavailableReason: null,
  });
  assert.deepEqual(
    inputContract.unsupported.map((u) => u.label),
    ["LinkedIn URL", "Google Drive folder or pitch deck", "Local file path"],
  );
  assert.equal(installArtifact.available, true);
  assert.equal(installArtifact.artifactVersion, "biocraft-singleshot-v9");
  assert.match(installArtifact.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(installArtifact.artifactDigestAlgorithm, "sha256");

  // Prompt must not be writable via PUT. Anonymous writes are refused entirely.
  const anonPut = await fetch(`${base}/api/agents/A7`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...original,
      prompt: "MALICIOUS CLIENT PROMPT",
      invocation: { type: "runtime", artifact: "../../client-controlled.md" },
    }),
  });
  assert.equal(anonPut.status, 401);

  const promptPut = await fetch(`${base}/api/agents/A7`, {
    method: "PUT",
    headers: identityHeaders(),
    body: JSON.stringify({
      name: original.name,
      prompt: "MALICIOUS CLIENT PROMPT",
      invocation: { type: "runtime", artifact: "../../client-controlled.md" },
    }),
  });
  assert.equal(promptPut.status, 400);
  assert.match((await promptPut.json()).error, /prompt/);

  const beforeHealth = await app.svc.fleetHealth();
  const response = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: identityHeaders(),
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
    VALID_BIOCRAFT_OUTPUT,
  );
  assert.equal(run.status, "ok");
  assert.equal(run.via, "runtime");
  assert.equal(run.mode, "single-shot");
  assert.equal(run.agentVersion, "1.0");
  assert.equal(run.artifactVersion, "biocraft-singleshot-v9");
  assert.equal(
    run.artifactDigest,
    createHash("sha256").update(request.body.instructions).digest("hex"),
  );
  assert.equal(run.artifactDigestAlgorithm, "sha256");
  assert.equal(run.tracePersisted, true);
  assert.ok(run.traceId);
  assert.match(request.body.instructions, /# Biocraft — Single-Shot Fellow Bio Draft/);
  assert.match(request.body.instructions, /## Mode boundary/);
  assert.match(
    request.body.instructions,
    /This is not the full interactive `\/biocraft` workflow/,
  );
  assert.doesNotMatch(request.body.instructions, /MALICIOUS CLIENT PROMPT/);
  assert.equal(request.body.model, "gpt-5.6-terra");
  assert.equal(request.body.store, false);
  assert.equal(request.headers.authorization, "Bearer test-runtime-key");

  const trace = await store.get("traces", run.traceId);
  assert.equal(trace.source, "real");
  assert.equal(trace.provider, "openai");
  assert.equal(trace.modelId, "gpt-5.6-terra");
  assert.equal(trace.inputTokens, 2345);
  assert.equal(trace.outputTokens, 17);
  assert.equal(trace.totalTokens, 2362);
  assert.equal(
    trace.costUsd,
    costUsdFromUsage("gpt-5.6-terra", {
      inputTokens: 2345,
      outputTokens: 17,
    }),
  );
  assert.equal(typeof trace.latencyMs, "number");
  assert.equal(trace.metadata.via, "runtime");
  assert.equal(trace.metadata.mode, "single-shot");
  assert.equal(trace.agentVersion, "1.0");
  assert.equal(trace.artifactVersion, "biocraft-singleshot-v9");
  assert.equal(trace.artifactDigest, run.artifactDigest);
  assert.equal(trace.artifactDigestAlgorithm, "sha256");
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
      headers: identityHeaders(),
      body: JSON.stringify({
        rating: 3,
        notes: 'em dash in the hook; "my founder company" when the source says built for',
      }),
    },
  );
  assert.equal(feedbackResponse.status, 201);
  const feedback = await feedbackResponse.json();
  assert.equal(feedback.traceId, run.traceId);
  assert.equal(feedback.rating, 3);
  assert.equal(
    feedback.notes,
    'em dash in the hook; "my founder company" when the source says built for',
  );
  assert.equal((await store.all("feedback")).length, 1);
  // The reviewer's reasoning lives on the feedback record only — the
  // metadata-only trace rule still holds.
  const tracedAfterFeedback = (await store.all("traces")).find(
    (candidate) => candidate.id === run.traceId,
  );
  assert.equal("notes" in tracedAfterFeedback, false);
  assert.equal("output" in tracedAfterFeedback, false);

  const invalidRating = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 6 }),
    },
  );
  assert.equal(invalidRating.status, 400);
  const crossAgent = await fetch(
    `${base}/api/agents/A1/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 5 }),
    },
  );
  assert.equal(crossAgent.status, 404);

  const overLongNotes = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 4, notes: "x".repeat(2001) }),
    },
  );
  assert.equal(overLongNotes.status, 400);
  assert.match((await overLongNotes.json()).error, /2000 characters or fewer/);

  assert.equal((await store.all("feedback")).length, 1);
  assert.deepEqual((await app.svc.getAgent("A7")).evalHistory, []);
  assert.deepEqual(await app.svc.fleetHealth(), beforeHealth);
});

test("feedback notes gate off rejects notes but still accepts the rating", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-feedback-gate-"));
  const store = createStore(dir);
  const gated = runtimeConfig({
    fetch: async () => ({
      ok: true,
      json: async () => openaiResponse({ text: VALID_BIOCRAFT_OUTPUT }),
    }),
  });
  const app = await buildApp({
    store,
    config: {
      ...gated,
      observability: { ...gated.observability, feedbackNotes: false },
    },
  });
  const base = await listen(app, t);

  const capability = await (
    await fetch(`${base}/api/agents/A7/invocation-capability`)
  ).json();
  assert.equal(capability.feedbackNotes, false);

  const run = await (
    await fetch(`${base}/api/agents/A7/run`, {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({
        inputs: { fellowName: "Test Fellow", sourceMaterial: "Profile text." },
      }),
    })
  ).json();
  assert.ok(run.traceId);

  const withNotes = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 3, notes: "Dropped the job title." }),
    },
  );
  assert.equal(withNotes.status, 400);
  assert.match((await withNotes.json()).error, /notes are disabled/);

  const ratingOnly = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 3 }),
    },
  );
  assert.equal(ratingOnly.status, 201);
  assert.equal("notes" in (await ratingOnly.json()), false);
});

test("a failed-check run reaches the caller and the store as fail, not error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-run-checkfail-"));
  const store = createStore(dir);
  const failing = VALID_BIOCRAFT_OUTPUT.replace(
    "If your venture team needs a clearer path from idea to build, reach out.",
    "The work stays grounded in supplied evidence.",
  ).replace(
    "Test Fellow builds grounded workflow systems for venture teams.",
    "Test Fellow builds grounded workflow systems for venture teams. Reach out.",
  );
  const app = await buildApp({
    store,
    config: runtimeConfig({
      fetch: async () => ({
        ok: true,
        json: async () => openaiResponse({ text: failing, input_tokens: 900, output_tokens: 400 }),
      }),
    }),
  });
  const base = await listen(app, t);

  const res = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({
      inputs: { fellowName: "Test Fellow", sourceMaterial: "Profile text." },
    }),
  });
  // 201, not 502: the run happened and produced output. It missed a quality
  // bar, which is a scored failure, not a refusal.
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.status, "checks_failed");
  assert.deepEqual(run.failedChecks, ["about_closing_has_cta"]);
  assert.equal(run.output, failing);
  // Detector language: the check reports that nothing fired, never that the
  // model omitted a CTA. Three false booleans cannot prove omission.
  assert.match(run.checkFailures[0].message, /No CTA detected in the closing/);
  assert.doesNotMatch(run.checkFailures[0].message, /has no|omitted|missing/i);

  const [trace] = await store.all("traces");
  assert.equal(trace.status, "fail");
  assert.equal(trace.failureReason, "about_closing_has_cta");
  assert.equal(trace.checkResults[0].hasInvitationFrame, false);
  assert.equal(trace.totalTokens, 1300);
  // The output itself is still never persisted — only its digest.
  assert.equal("output" in trace, false);
  assert.equal(trace.outputDigest.length, 64);

  // Rateable, which an error trace was not.
  const feedback = await fetch(
    `${base}/api/agents/A7/traces/${run.traceId}/feedback`,
    {
      method: "POST",
      headers: identityHeaders(),
      body: JSON.stringify({ rating: 2, notes: "Check is right, CTA missing." }),
    },
  );
  assert.equal(feedback.status, 201);
});

test("serverRun false stays hidden by capability and rejects run with 400", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "adir-runtime-manual-"));
  const store = createStore(dir);
  const app = await buildApp({
    store,
    config: { ...config, apiToken: "", clerk: testClerkOptions() },
  });
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
    feedbackNotes: true,
    feedbackNotesMaxChars: 2000,
    installArtifact: { available: false },
    handoff: { available: false },
    runnable: false,
    unavailableReason: null,
  });
  const run = await fetch(`${base}/api/agents/A1/run`, {
    method: "POST",
    headers: identityHeaders(),
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
  assert.match(appSource, /LinkedIn About hook is 200 characters or fewer/);
  assert.match(
    appSource,
    /Do not add a CTA to the third-person event introduction/,
  );
  assert.match(appSource, /check the fold on a phone/);
  assert.match(appSource, /refresh the bio in 2–3 months/);
  assert.match(appSource, /Copy \$\{escHtml\(modeWord\)\} SKILL\.md/);
  assert.match(appSource, /Download \$\{escHtml\(modeWord\)\} \(\.zip\)/);
  assert.match(appSource, /Run single-shot draft/);
  assert.match(appSource, /Run gap-fill draft/);
  assert.match(appSource, /const install=capability\.installArtifact;/);
  assert.match(appSource, /if\(install&&install\.available\)/);
  // Export affordances must stay split per usability mode. One shared gate is
  // what handed prepared-handoff agents an install-shaped export.
  assert.doesNotMatch(appSource, /function canDownload/);
  assert.match(
    appSource,
    /function canInstall\(a\)\{return hasUsabilityMode\(a,"download-install"\)\}/,
  );
  assert.match(
    appSource,
    /function canHandoff\(a\)\{return hasUsabilityMode\(a,"prepared-handoff"\)\}/,
  );
  // A failed-check run must be visually distinct from a clean one, not the
  // same card with a line of text above it.
  assert.match(appSource, /run-result-failed/);
  assert.match(appSource, /mechanical check\$\{r\.checkFailures\.length===1\?"":"s"\} did not pass/);
  assert.match(appSource, /Output \(failed checks\)/);
  // The banner must not translate "no detector fired" into "the model omitted".
  assert.match(appSource, /A check can be wrong about a correct draft/);
  // Proposal approval is a review record, not an artifact release. Structured
  // changes are separate review rows and retain only evidence references.
  assert.match(appSource, /function renderProposalChanges/);
  assert.match(appSource, /loop-change-evidence/);
  assert.match(appSource, /Approval records a review decision only/);
  assert.match(appSource, /does not change the Railway catalog version, prompt, check, runtime, or governed Convex version/);
  assert.match(appSource, /A human must make, verify and commit the artifact edit separately/);
  assert.match(appSource, /Record review approval/);
  assert.match(appSource, /Copy approved patch/);
  assert.doesNotMatch(appSource, /Approved → shipped/);
  // One proposal is one defect, so every decision names the proposal it
  // resolves rather than clearing whatever happens to be pending.
  assert.match(appSource, /approveImprovement\('\$\{a\.id\}','\$\{escHtml\(p\.id\|\|""\)\}'\)/);
  assert.match(appSource, /rejectImprovement\('\$\{a\.id\}','\$\{escHtml\(p\.id\|\|""\)\}'\)/);
  assert.match(appSource, /separate proposals, one per defect/);
  // A capability request that fails must say so. Blanking the slots renders an
  // agent that offers nothing, identical to an agent that legitimately has
  // nothing, and only a manual API audit tells the two apart.
  assert.doesNotMatch(
    appSource,
    /catch\(e\)\{[^}]*handoffSlot\.innerHTML=""/,
  );
  assert.match(
    appSource,
    /is not registered on the server\./,
  );
  assert.match(appSource, /\$\{label\} unavailable — \$\{escHtml\(detail\)\}/);
  // The client must not reassemble a skill file from directory metadata.
  assert.doesNotMatch(appSource, /function buildSkillMd/);
  assert.doesNotMatch(appSource, /copyAgentSkill/);
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
