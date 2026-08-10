// The loop, as one service. Routes call these methods; the methods orchestrate
// the store + the (swappable) observability and optimizer providers. All the
// business rules of the eval -> improve -> approve cycle live here.
import { createHash } from "node:crypto";
import { getInvoker } from "../invoke/index.js";
import { assertUsabilityModes } from "./usabilityModes.js";
import {
  buildInstallArtifactZip,
  getInstallArtifactCapability,
  loadInstallSkill,
} from "../artifacts/installArtifacts.js";
import {
  getRuntimeArtifactDescriptor,
  loadRuntimeArtifact,
} from "../invoke/runtimeArtifacts.js";
import {
  getHandoffCapability,
  loadHandoffBriefing,
} from "../handoff/handoffArtifacts.js";
import { sanitizeCheckResults, sanitizeFailureReason, ensureFailureCause, sanitizeLlmGroundingStatus } from "./traceSafety.js";
import { LLM_GROUNDING_STATUS } from "../eval/llmGroundingCheck.js";
import {
  GROUNDING_CALIBRATION_COLLECTION,
  GROUNDING_EVIDENCE_COLLECTION,
  GROUNDING_VERDICT,
  SEED_CALIBRATION_FINDINGS,
  findTextForDigest,
  summarizeCalibration,
  falsePositiveExclusions,
  sanitizeFailingTraceForMaker,
  systematicFalsePositiveChecks,
} from "../eval/groundingCalibration.js";
import { validateProposal } from "../improve/proposalContract.js";
import { readProposals, writeProposals, selectProposal } from "./proposals.js";
import { buildServiceMigrationSnapshot } from "../migration/export.js";
import { createConvexAuthorityClient } from "../convex/authorityClient.js";
import {
  LoopPullRequestError,
  openLoopPullRequest,
} from "../github/loopPullRequest.js";

function outputDigest(output) {
  return createHash("sha256").update(String(output)).digest("hex");
}

function approvedChangePatch(proposal) {
  const change = proposal?.changes?.[0];
  if (!change) return "";
  return [
    `# Approved change ${proposal.id}`,
    `# Target: ${change.target}`,
    `# Surface: ${change.surface}`,
    ...(proposal.targetArtifactVersion
      ? [`# Derived against: ${proposal.targetArtifactVersion} (${proposal.targetArtifactDigest || "digest not recorded"})`]
      : []),
    "--- current",
    change.current,
    "+++ proposed",
    change.proposed,
    `# Rationale: ${change.rationale}`,
    `# Evidence: ${(change.evidence || []).join(", ")}`,
  ].join("\n");
}

function assertVerifiedApprover(actor) {
  if (
    !actor ||
    typeof actor.subject !== "string" || !actor.subject ||
    typeof actor.issuer !== "string" || !actor.issuer ||
    actor.role !== "approver"
  ) {
    throw Object.assign(new Error("Verified release approver identity required"), { status: 403 });
  }
}


function metadataOnlyTrace(agentId, trace) {
  const metadata = {
    ...(trace.metadata?.via ? { via: trace.metadata.via } : {}),
    ...(trace.metadata?.mode ? { mode: trace.metadata.mode } : {}),
    ...(trace.metadata?.failed === true ? { failed: true } : {}),
    ...(typeof trace.metadata?.callCount === "number"
      ? { callCount: trace.metadata.callCount }
      : {}),
    ...(typeof trace.metadata?.gapsCount === "number"
      ? { gapsCount: trace.metadata.gapsCount }
      : {}),
  };
  // The checker's verdict survives the allowlist; free text does not. Both are
  // filtered through closed vocabularies/field allowlists, so an Anthropic
  // message or model output cannot reach the store if a future caller passes it.
  const checkResults = sanitizeCheckResults(trace.checkResults);
  const status = trace.status || "ok";
  const { failureReason } = ensureFailureCause(
    status,
    sanitizeFailureReason(trace.failureReason),
    checkResults,
  );
  const llmGroundingStatus = sanitizeLlmGroundingStatus(
    trace.llmGroundingStatus,
  );
  return {
    agentId,
    status,
    ...(typeof trace.latencyMs === "number"
      ? { latencyMs: trace.latencyMs }
      : {}),
    ...(typeof trace.costUsd === "number" ? { costUsd: trace.costUsd } : {}),
    ...(trace.source ? { source: trace.source } : {}),
    ...(trace.provider ? { provider: trace.provider } : {}),
    ...(trace.modelId ? { modelId: trace.modelId } : {}),
    ...(typeof trace.inputTokens === "number"
      ? { inputTokens: trace.inputTokens }
      : {}),
    ...(typeof trace.outputTokens === "number"
      ? { outputTokens: trace.outputTokens }
      : {}),
    ...(typeof trace.totalTokens === "number"
      ? { totalTokens: trace.totalTokens }
      : {}),
    ...(trace.agentVersion ? { agentVersion: trace.agentVersion } : {}),
    ...(trace.artifactDigest
      ? {
          artifactVersion: trace.artifactVersion,
          artifactDigest: trace.artifactDigest,
          artifactDigestAlgorithm: trace.artifactDigestAlgorithm,
        }
      : {}),
    ...(trace.outputDigest
      ? {
          outputDigest: trace.outputDigest,
          outputDigestAlgorithm: "sha256",
        }
      : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(checkResults.length ? { checkResults } : {}),
    ...(llmGroundingStatus ? { llmGroundingStatus } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function createLoopService({
  store,
  obs,
  optimizer,
  memory,
  verifier,
  config,
  openLoopPullRequest: openLoopPullRequestFn = openLoopPullRequest,
}) {
  const ns = (agentId) => `agent:${agentId}`;
  const convexAuthority = createConvexAuthorityClient({
    url: config?.convex?.url || "",
    deployKey: config?.convex?.deployKey || "",
  });

  async function recordHostedRunEvidenceBestEffort(agentId, result, digest) {
    if (agentId !== "A7" || !digest) return null;
    if (!convexAuthority.enabled()) return null;
    try {
      const cost =
        result.provider && result.modelId
          ? {
              amountUsd:
                typeof result.costUsd === "number" && Number.isFinite(result.costUsd)
                  ? result.costUsd
                  : 0,
              provider: String(result.provider),
              modelId: String(result.modelId),
              ...(typeof result.inputTokens === "number"
                ? { inputTokens: result.inputTokens }
                : {}),
              ...(typeof result.outputTokens === "number"
                ? { outputTokens: result.outputTokens }
                : {}),
              ...(typeof result.totalTokens === "number"
                ? { totalTokens: result.totalTokens }
                : {}),
            }
          : undefined;
      return await convexAuthority.recordHostedRunEvidence({
        displayId: "A7",
        artifactDigest: digest,
        cost,
      });
    } catch (error) {
      console.error(
        `[convex] hosted-run evidence for ${agentId} not recorded: ${String(error?.message || error)}`,
      );
      return null;
    }
  }

  const svc = {
    // ── Phase 2 migration discovery (read-only) ──
    async migrationExport() {
      return buildServiceMigrationSnapshot(store);
    },

    // ── agents ──
    async listAgents() { return store.all("agents"); },
    async getAgent(id) { return store.get("agents", id); },
    async putAgent(agent) {
      assertUsabilityModes(agent);
      return store.put("agents", agent);
    },
    /**
     * Catalogue PATCH via allowlist. Never body-spreads — prompt and loop
     * custody fields cannot be written through this path.
     */
    async putAgentAllowlisted(agentId, body) {
      const existing = await store.get("agents", agentId);
      const { applyAgentPutAllowlist } = await import("./agentPutAllowlist.js");
      const { next } = applyAgentPutAllowlist(existing, body, agentId);
      assertUsabilityModes(next);
      return store.put("agents", next);
    },
    async getInvocationCapability(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const invoker = getInvoker(agent, config);
      const artifactAvailable = invoker.canInvoke
        ? await invoker.canInvoke(agent)
        : true;
      const configured = invoker.isConfigured
        ? invoker.isConfigured()
        : true;
      const installArtifact = await getInstallArtifactCapability(agent);
      return {
        invocationType: agent.invocation?.type || "link",
        mode: invoker.mode || agent.invocation?.mode || null,
        serverRun: invoker.serverRun,
        artifactAvailable,
        configured,
        // Server-owned so the form is keyed by stable field ids, not by the
        // agent record's editable labels.
        inputContract: invoker.inputContract ? invoker.inputContract(agent) : null,
        feedbackNotes: config?.observability?.feedbackNotes !== false,
        feedbackNotesMaxChars: config?.observability?.feedbackNotesMaxChars || 2000,
        // Export affordances are driven by usability mode, not collapsed into
        // one gate: download-install gets the pinned artifact, prepared-handoff
        // gets a pinned briefing, and neither falls back to the other.
        installArtifact,
        handoff: getHandoffCapability(agent),
        runnable: invoker.serverRun && artifactAvailable && configured,
        unavailableReason: !configured
          ? "Runtime is not configured on the server"
          : !artifactAvailable
            ? "Server-owned runtime artifact is unavailable"
            : null,
      };
    },
    async getInstallSkill(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      return loadInstallSkill(agent);
    },
    async getInstallArtifactZip(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      return buildInstallArtifactZip(agent);
    },
    async getHandoffBriefing(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      return loadHandoffBriefing(agent);
    },

    // ── context / memory (the fourth pillar) ──
    async addContext(agentId, item) {
      if (!item?.content) throw httpError(400, "content required");
      return memory.ingest(ns(agentId), item);
    },
    async recallContext(agentId, query, opts) {
      return memory.search(ns(agentId), query, opts);
    },
    // Seed each agent's declared context[] into memory once (deterministic ids
    // so re-runs don't duplicate). Turns the static string list into recall.
    async seedContext() {
      const agents = await store.all("agents");
      let n = 0;
      for (const a of agents) {
        for (const [i, c] of (a.context || []).entries()) {
          await memory.ingest(ns(a.id), { id: `seed_${a.id}_${i}`, content: c, metadata: { agentId: a.id, seeded: true } });
          n++;
        }
      }
      return n;
    },

    // ── traces (observability) ──
    async recordTrace(agentId, trace) {
      return obs.recordTrace(metadataOnlyTrace(agentId, trace));
    },
    async listTraces(agentId, opts) { return obs.listTraces(agentId, opts); },
    async recordFeedback(agentId, traceId, feedback) {
      let trace = await store.get("traces", traceId);
      if (!trace) {
        const providerTraces = await obs.listTraces(agentId, { limit: 100 });
        trace = providerTraces.find((candidate) => candidate.id === traceId);
      }
      if (!trace || trace.agentId !== agentId) {
        throw httpError(404, "Trace not found");
      }
      const rating = Number(feedback?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw httpError(400, "Feedback rating must be an integer from 1 to 5");
      }
      const notesEnabled = config?.observability?.feedbackNotes !== false;
      const maxChars = config?.observability?.feedbackNotesMaxChars || 2000;
      const notes = String(feedback?.notes || "").trim();
      if (notes && !notesEnabled) {
        throw httpError(400, "Feedback notes are disabled on this deployment");
      }
      if (notes.length > maxChars) {
        throw httpError(400, `Feedback notes must be ${maxChars} characters or fewer`);
      }
      return store.append("feedback", {
        agentId,
        traceId,
        rating,
        // Lives here, not on the trace: this is the reviewer's judgement of the
        // agent, which the metadata-only trace rule was never meant to cover.
        ...(notes ? { notes } : {}),
        createdAt: new Date().toISOString(),
      });
    },

    // ── run an agent where it lives, and record the run as a trace ──
    // This is what makes the directory usable, not a shelf — and every run
    // feeds observability → the eval loop.
    async runAgent(agentId, inputs = {}) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const invoker = getInvoker(agent, config);
      const artifactDigest =
        typeof invoker.artifactDigest === "function"
          ? invoker.artifactDigest(agent)
          : null;
      const artifactDigestAlgorithm =
        typeof invoker.artifactDigestAlgorithm === "function"
          ? invoker.artifactDigestAlgorithm(agent)
          : null;
      const artifactVersion =
        typeof invoker.artifactVersion === "function"
          ? invoker.artifactVersion(agent)
          : null;
      if (
        (artifactDigest && artifactDigestAlgorithm !== "sha256") ||
        (!artifactDigest && artifactDigestAlgorithm) ||
        (artifactDigest && !artifactVersion)
      ) {
        throw httpError(
          500,
          `Runtime artifact for ${agentId} has an invalid digest reference`,
        );
      }
      if (!invoker.serverRun) {
        throw httpError(400, `"${agent.name}" is ${agent.invocation?.type || "link"}-invoked — open it where it lives or use its exported prompt/SKILL.md.`);
      }
      if (invoker.isConfigured && !invoker.isConfigured()) {
        throw httpError(503, "Runtime is not configured on the server");
      }
      if (invoker.canInvoke && !(await invoker.canInvoke(agent))) {
        throw httpError(503, `Runtime artifact unavailable for ${agentId}`);
      }
      const started = Date.now();
      // The invocation try wraps ONLY the invocation. Trace writes happen
      // outside it so a failing writer can never be mistaken for a run failure.
      let result;
      try {
        result = await invoker.invoke(agent, inputs);
      } catch (e) {
        const message = String(e.message || e);
        // Trace persistence is secondary; the invocation failure is the truth
        // the caller needs. A failing writer must not become the reported error.
        let trace = null;
        try {
          trace = await obs.recordTrace(metadataOnlyTrace(agentId, {
            agentId,
            status: "error",
            latencyMs:
              typeof e.latencyMs === "number" ? e.latencyMs : Date.now() - started,
            source: invoker.name === "mock" ? "mock" : "real",
            ...(invoker.provider ? { provider: invoker.provider } : {}),
            ...(invoker.modelId ? { modelId: invoker.modelId } : {}),
            // If the provider already answered, the tokens were billed. Carry
            // them so an error is still attributable spend, not a silent cost.
            ...(e.usage || {}),
            ...(typeof e.costUsd === "number" ? { costUsd: e.costUsd } : {}),
            failureReason: e.failureCode,
            agentVersion: agent.version,
            ...(artifactDigest
              ? { artifactVersion, artifactDigest, artifactDigestAlgorithm }
              : {}),
            metadata: {
              via: invoker.name,
              mode: invoker.mode,
              failed: true,
            },
          }), { persistRuntime: invoker.name === "runtime" });
        } catch (persistError) {
          console.error(
            `[loop] failed run for ${agentId} could not be traced. invocation error: ${message}; persistence error: ${String(persistError?.message || persistError)}`,
          );
        }
        const status =
          Number.isInteger(e.status) && e.status >= 400 && e.status <= 599
            ? e.status
            : 502;
        const error = httpError(status, message);
        error.runStatus = "error";
        error.traceId = trace?.id || null;
        error.tracePersisted =
          Boolean(trace) && trace.persisted !== false && Boolean(trace.id);
        throw error;
      }

      // Gap-fill Call 1 may stop for answers. That is a completed first turn,
      // not a draft, so mechanical checks and Convex hosted-run evidence wait.
      if (result.status === "needs_input") {
        let trace = null;
        try {
          trace = await obs.recordTrace(metadataOnlyTrace(agentId, {
            agentId,
            status: "needs_input",
            latencyMs:
              typeof result.latencyMs === "number"
                ? result.latencyMs
                : Date.now() - started,
            source: invoker.name === "mock" ? "mock" : "real",
            ...(typeof result.costUsd === "number"
              ? { costUsd: result.costUsd }
              : {}),
            ...(result.provider ? { provider: result.provider } : {}),
            ...(result.modelId ? { modelId: result.modelId } : {}),
            ...(typeof result.inputTokens === "number"
              ? { inputTokens: result.inputTokens }
              : {}),
            ...(typeof result.outputTokens === "number"
              ? { outputTokens: result.outputTokens }
              : {}),
            ...(typeof result.totalTokens === "number"
              ? { totalTokens: result.totalTokens }
              : {}),
            agentVersion: agent.version,
            ...(result.artifactDigest || artifactDigest
              ? {
                  artifactDigest: result.artifactDigest || artifactDigest,
                  artifactDigestAlgorithm:
                    result.artifactDigestAlgorithm || artifactDigestAlgorithm,
                  artifactVersion: result.artifactVersion || artifactVersion,
                }
              : {}),
            metadata: {
              via: invoker.name,
              mode: invoker.mode,
              ...(typeof result.callCount === "number"
                ? { callCount: result.callCount }
                : {}),
              ...(typeof result.gapsCount === "number"
                ? { gapsCount: result.gapsCount }
                : {}),
            },
          }), { persistRuntime: invoker.name === "runtime" });
        } catch (persistError) {
          console.error(
            `[loop] needs_input run for ${agentId} could not be traced; persistence error: ${String(persistError?.message || persistError)}`,
          );
        }

        return {
          status: "needs_input",
          gaps: Array.isArray(result.gaps) ? result.gaps : [],
          output: "",
          via: invoker.name,
          mode: invoker.mode || null,
          callCount: result.callCount || 1,
          gapsCount: result.gapsCount || 0,
          agentVersion: agent.version,
          artifactVersion: result.artifactVersion || artifactVersion || null,
          artifactDigest: result.artifactDigest || artifactDigest || null,
          artifactDigestAlgorithm:
            result.artifactDigestAlgorithm || artifactDigestAlgorithm || null,
          traceId: trace?.id || null,
          tracePersisted:
            Boolean(trace) && trace.persisted !== false && Boolean(trace.id),
        };
      }

      // The invocation returned. A failed mechanical check means it ran and
      // missed the bar — status "fail", distinct from "error", which means the
      // run did not happen. Grounding "unavailable" is a third outcome: the
      // draft was produced but truthfulness was never checked — never collapse
      // that into a clean "ok" / empty findings pass.
      const checkResults = Array.isArray(result.checkResults)
        ? result.checkResults
        : [];
      const failedChecks = checkResults.map((r) => r.checkId);
      const llmGroundingStatus = sanitizeLlmGroundingStatus(
        result.llmGroundingStatus,
      );
      const groundingUnavailable =
        llmGroundingStatus === LLM_GROUNDING_STATUS.UNAVAILABLE;
      let runStatus = "ok";
      let traceStatus = "ok";
      if (failedChecks.length) {
        runStatus = "checks_failed";
        traceStatus = "fail";
      } else if (groundingUnavailable) {
        runStatus = "grounding_unavailable";
        traceStatus = "grounding_unavailable";
      }

      // Tracing it is secondary bookkeeping: if the writer fails, the output
      // still has to reach the caller.
      let trace = null;
      try {
        trace = await obs.recordTrace(metadataOnlyTrace(agentId, {
          agentId,
          status: traceStatus,
          ...(failedChecks.length
            ? { failureReason: failedChecks.join(", "), checkResults }
            : groundingUnavailable
              ? { failureReason: "llm_grounding_unavailable" }
              : {}),
          ...(llmGroundingStatus ? { llmGroundingStatus } : {}),
          latencyMs:
            typeof result.latencyMs === "number"
              ? result.latencyMs
              : Date.now() - started,
          source: invoker.name === "mock" ? "mock" : "real",
          ...(typeof result.costUsd === "number"
            ? { costUsd: result.costUsd }
            : {}),
          ...(result.provider ? { provider: result.provider } : {}),
          ...(result.modelId ? { modelId: result.modelId } : {}),
          ...(typeof result.inputTokens === "number"
            ? { inputTokens: result.inputTokens }
            : {}),
          ...(typeof result.outputTokens === "number"
            ? { outputTokens: result.outputTokens }
            : {}),
          ...(typeof result.totalTokens === "number"
            ? { totalTokens: result.totalTokens }
            : {}),
          agentVersion: agent.version,
          ...(result.artifactDigest || artifactDigest
            ? {
                artifactDigest: result.artifactDigest || artifactDigest,
                artifactDigestAlgorithm:
                  result.artifactDigestAlgorithm || artifactDigestAlgorithm,
                artifactVersion: result.artifactVersion || artifactVersion,
              }
            : {}),
          outputDigest: outputDigest(result.output),
          metadata: {
            via: invoker.name,
            mode: invoker.mode,
            ...(typeof result.callCount === "number"
              ? { callCount: result.callCount }
              : {}),
            ...(typeof result.gapsCount === "number"
              ? { gapsCount: result.gapsCount }
              : {}),
          },
        }), { persistRuntime: invoker.name === "runtime" });
      } catch (persistError) {
        console.error(
          `[loop] successful run for ${agentId} could not be traced; persistence error: ${String(persistError?.message || persistError)}`,
        );
      }

      // Privileged span store for calibration — never returned on the fellow
      // run response or on public listTraces.
      const evidenceRows = Array.isArray(result.llmGroundingEvidence)
        ? result.llmGroundingEvidence
        : [];
      if (evidenceRows.length && trace?.id && trace.persisted !== false) {
        try {
          await store.append(GROUNDING_EVIDENCE_COLLECTION, {
            agentId,
            traceId: trace.id,
            ts: new Date().toISOString(),
            findings: evidenceRows,
          });
        } catch (evidenceError) {
          console.error(
            `[grounding] evidence for ${agentId}/${trace.id} not persisted: ${String(evidenceError?.message || evidenceError)}`,
          );
        }
      }

      const liveDigest = result.artifactDigest || artifactDigest || null;
      // Scored hosted run: invocation returned and mechanical checks ran.
      // Convex looks up the governed version by digest; never creates one.
      const convexEvidenceId = await recordHostedRunEvidenceBestEffort(
        agentId,
        result,
        liveDigest,
      );

      return {
        output: result.output,
        status: runStatus,
        ...(failedChecks.length
          ? {
              failedChecks,
              // Messages are for the reviewer reading this response; only the
              // structural facts above are persisted on the trace.
              checkFailures: checkResults.map((r) => ({
                checkId: r.checkId,
                message: r.message || null,
                ...(r.claimKind ? { claimKind: r.claimKind } : {}),
                ...(r.category ? { category: r.category } : {}),
              })),
            }
          : {}),
        ...(llmGroundingStatus ? { llmGroundingStatus } : {}),
        ...(groundingUnavailable
          ? {
              groundingNotice:
                "Grounding check unavailable for this run — truthfulness was not verified.",
            }
          : {}),
        via: invoker.name,
        mode: invoker.mode || null,
        ...(typeof result.callCount === "number"
          ? { callCount: result.callCount }
          : {}),
        ...(typeof result.gapsCount === "number"
          ? { gapsCount: result.gapsCount }
          : {}),
        agentVersion: agent.version,
        artifactVersion: result.artifactVersion || artifactVersion || null,
        artifactDigest: liveDigest,
        artifactDigestAlgorithm:
          result.artifactDigestAlgorithm || artifactDigestAlgorithm || null,
        traceId: trace?.id || null,
        tracePersisted:
          Boolean(trace) && trace.persisted !== false && Boolean(trace.id),
        ...(convexEvidenceId ? { convexEvidenceId } : {}),
      };
    },

    // ── evals (append-only history on the agent) ──
    async logEval(agentId, record) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const entry = { date: new Date().toISOString().slice(0, 10), ...record };
      agent.evalHistory = [...(agent.evalHistory || []), entry];
      await store.put("agents", agent);
      return entry;
    },

    // ── the loop: run the optimizer on failing signal ──
    async collectImprovementEvidence(agentId, agent) {
      const failingTracesRaw = await obs.getFailingTraces(agentId, { limit: 100 });
      const [traces, feedback, mechanicalResults] =
        await Promise.all([
          obs.listTraces(agentId, { limit: 100 }),
          store.query("feedback", (f) => f.agentId === agentId),
          store.query("mechanicalResults", (r) => r.agentId === agentId),
        ]);
      const latestEval = (agent.evalHistory || []).at(-1);

      await this.ensureGroundingCalibrationSeed();
      const calibrationRows = await store.query(
        GROUNDING_CALIBRATION_COLLECTION,
        (row) => !row.agentId || row.agentId === agentId,
      );
      const fpExclusions = falsePositiveExclusions(calibrationRows, {
        agentId,
      });
      const checkProblems = systematicFalsePositiveChecks(calibrationRows);
      const systematicIds = new Set(checkProblems.map((p) => p.checkId));
      const failingTraces = failingTracesRaw
        .map((trace) =>
          sanitizeFailingTraceForMaker(trace, fpExclusions, systematicIds),
        )
        .filter(Boolean);
      const falsePositivesExcludedCount =
        failingTracesRaw.length - failingTraces.length;

      // Golden-case mechanical failures reach the maker the same way run
      // failureReasons do — closed vocabulary, no draft text. Prefixed so they
      // are never mistaken for fleet-health eval scores.
      // Canned plumbing rows are structurally excluded from maker signals so
      // fixture failures cannot mint Approve-button proposals.
      const mechanicalDefects = mechanicalResults
        .filter((row) => row.outputSource === "live")
        .flatMap((row) =>
          (row.failed || []).map(
            (checkId) => `mechanical:${checkId}`,
          ),
        )
        .filter((signal) => {
          const checkId = String(signal).replace(/^mechanical:/, "");
          if (systematicIds.has(checkId)) return false;
          return true;
        });

      // A defect signal is a human-or-checker statement of what went wrong.
      // Runs alone are not one: a metadata trace records that the agent ran,
      // never that it ran badly. Closed-vocabulary failureReason survives on
      // failed traces; reviewer notes carry human judgement separately.
      // Calibrated false positives are excluded above — they must not teach
      // the agent to avoid an accurate claim.
      const defectSignals = [
        ...failingTraces.map((t) => t.failureReason).filter(Boolean),
        ...mechanicalDefects,
        ...feedback.map((f) => String(f.notes || "").trim()).filter(Boolean),
        String(latestEval?.knownIssues || "").trim(),
        String(latestEval?.notes || "").trim(),
        ...checkProblems.map((p) => `check-quality:${p.checkId}`),
      ].filter(Boolean);

      const lowRatings = feedback.filter(
        (f) => typeof f.rating === "number" && f.rating <= 3,
      );

      // The live artifact travels with the evidence so the optimizer can verify
      // a claim before making it. Without this an optimizer describes `current`
      // from a hardcoded string and can assert that a guardrail is missing when
      // the file plainly contains it. Custody stays here: the service resolves
      // the bytes by agent id, the optimizer only reads them.
      const artifact = await this.loadImprovementArtifact(agentId, agent);

      return {
        traces,
        failingTraces,
        feedback,
        lowRatings,
        defectSignals,
        latestEval,
        artifact,
        calibration: {
          falsePositiveExclusions: fpExclusions,
          falsePositivesExcludedCount,
          checkProblems,
        },
      };
    },

    /**
     * The authoritative definition of what this agent currently does.
     *
     * For a runtime agent that is the server-owned artifact bytes. For a
     * catalog-defined agent there is no artifact file, and the stored record is
     * the definition — so its own goals and guardrails are what a `current`
     * claim must be checked against. Returning null for those agents would make
     * the maker refuse every proposal it can legitimately raise.
     */
    async loadImprovementArtifact(agentId, agent) {
      const descriptor = getRuntimeArtifactDescriptor(agentId);
      if (descriptor) {
        try {
          return {
            source: "runtime-artifact",
            text: await loadRuntimeArtifact(agentId),
            checks: descriptor.checks || [],
            artifactVersion: descriptor.artifactVersion,
            artifactDigest: descriptor.artifactDigest,
          };
        } catch {
          // Unreadable bytes mean no verified `current`; the optimizer refuses
          // rather than describing a file it could not open.
          return null;
        }
      }
      if (!agent) return null;
      return {
        source: "agent-record",
        text: [
          agent.objective,
          ...(agent.successCriteria || []),
          ...(agent.guardrails || []),
          agent.sop,
        ]
          .filter(Boolean)
          .join("\n"),
        checks: [],
      };
    },

    async runImprovement(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const evidence = await this.collectImprovementEvidence(agentId, agent);
      const checkProblems = evidence.calibration?.checkProblems || [];
      const agentDefectSignals = (evidence.defectSignals || []).filter(
        (signal) => !String(signal).startsWith("check-quality:"),
      );

      // No agent-level evidence must refuse, naming what is absent — including
      // when the only remaining signals are calibrated false positives or
      // systematic check-quality problems (those are not agent defects).
      if (!agentDefectSignals.length) {
        agent.latestProposalAttempt = {
          outcome: "maker-refused-no-evidence",
          recordedAt: new Date().toISOString(),
          traces: evidence.traces.length,
          failingTraces: evidence.failingTraces.length,
          feedback: evidence.feedback.length,
          feedbackWithNotes: evidence.feedback.filter((f) => String(f.notes || "").trim()).length,
          hasEval: Boolean(evidence.latestEval),
          falsePositivesExcluded:
            evidence.calibration?.falsePositivesExcludedCount || 0,
          checkProblems: checkProblems.map((p) => p.checkId),
        };
        await store.put("agents", agent);
        const checkNote = checkProblems.length
          ? ` Check-quality problems (not agent defects): ${checkProblems
              .map((p) => p.message)
              .join("; ")}.`
          : "";
        const fpNote =
          (evidence.calibration?.falsePositivesExcludedCount || 0) > 0
            ? ` Excluded ${evidence.calibration.falsePositivesExcludedCount} failing trace(s) as calibrated false positives.`
            : "";
        throw httpError(
          422,
          `Cannot propose for ${agentId} without evidence of a defect. ` +
            `Found ${evidence.traces.length} trace(s) (${evidence.failingTraces.length} failing), ` +
            `${evidence.feedback.length} feedback record(s), ` +
            `${evidence.feedback.filter((f) => String(f.notes || "").trim()).length} with notes, ` +
            `${evidence.latestEval ? "a latest eval with no known issues" : "no eval history"}.` +
            fpNote +
            checkNote +
            ` Supply at least one of: a failing trace, feedback notes, or an eval with knownIssues.`,
        );
      }

      // Pass only agent defects to the maker — check-quality signals stay on
      // evidence.calibration for surfacing, not for Method/Guardrails edits.
      const makerEvidence = {
        ...evidence,
        defectSignals: agentDefectSignals,
      };

      const artifact = getRuntimeArtifactDescriptor(agentId);
      // Optimizers are untrusted adapter boundaries. A better model with an
      // untyped output is still unsafe: enforce concrete changes, bounded text,
      // and evidence ids that exist for this agent before anything is queued.
      let raw;
      try {
        raw = await optimizer.propose(agent, makerEvidence);
      } catch (error) {
        // Surface the refuse reason on the agent record so the UI does not
        // require curling the research-queue note.
        if (error?.status === 422) {
          agent.latestProposalAttempt = {
            outcome: "maker-refused",
            recordedAt: new Date().toISOString(),
            reason: String(error.message || "maker refused"),
            traces: evidence.traces.length,
            failingTraces: evidence.failingTraces.length,
            feedback: evidence.feedback.length,
            feedbackWithNotes: evidence.feedback.filter((f) => String(f.notes || "").trim()).length,
            hasEval: Boolean(evidence.latestEval),
          };
          await store.put("agents", agent);
        }
        throw error;
      }
      const proposals = (Array.isArray(raw) ? raw : [raw]).map((candidate, index) => {
        const proposal = validateProposal(candidate, makerEvidence);
        proposal.id = `imp_${Date.now().toString(36)}_${index}`;
        // Stamp what this proposal was derived against, so approval cannot be
        // applied to a build that has since changed underneath it.
        proposal.targetAgentVersion = agent.version;
        if (artifact) {
          proposal.targetArtifactVersion = artifact.artifactVersion;
          proposal.targetArtifactDigest = artifact.artifactDigest;
          proposal.targetArtifactDigestAlgorithm = artifact.artifactDigestAlgorithm;
        }
        return proposal;
      });
      writeProposals(agent, proposals);
      agent.latestProposalAttempt = {
        outcome: "proposals-created",
        recordedAt: new Date().toISOString(),
        proposalIds: proposals.map((proposal) => proposal.id),
      };
      await store.put("agents", agent);
      return proposals;
    },

    async approveImprovement(agentId, proposalId, actor) {
      assertVerifiedApprover(actor);
      const agent = await store.get("agents", agentId);
      const proposals = agent ? readProposals(agent) : [];
      const pending = proposals.filter((proposal) => proposal.status === "proposed");
      const prop = selectProposal(pending, proposalId);
      if (!agent || !pending.length) throw httpError(404, "No pending improvement");
      if (!prop) throw httpError(409, "Proposal id mismatch");
      // Defend the approval boundary too. This catches legacy or externally
      // written records that predate changes[] instead of treating them as
      // approvable proposals.
      validateProposal(
        prop,
        await this.collectImprovementEvidence(agentId, agent),
      );
      // A proposal is only valid against the build it was derived from. If the
      // artifact moved since, the evidence no longer describes what runs.
      const current = getRuntimeArtifactDescriptor(agentId);
      if (
        prop.targetArtifactDigest &&
        current &&
        prop.targetArtifactDigest !== current.artifactDigest
      ) {
        throw httpError(
          409,
          `Proposal targets artifact ${prop.targetArtifactVersion} ` +
            `(${prop.targetArtifactDigest.slice(0, 7)}) but the live artifact is ` +
            `${current.artifactVersion} (${current.artifactDigest.slice(0, 7)}). ` +
            `Re-run the proposal against the current build.`,
        );
      }

      // Evidence gate — in addition to human approval, never instead of it.
      const { evaluatePromotionGate, resolveLivePromotionPair } = await import(
        "../eval/promotionGate.js"
      );
      const mechanicalRows = await store.query(
        "mechanicalResults",
        (row) => row.agentId === agentId,
      );
      const incumbentVersion =
        current?.artifactVersion || prop.targetArtifactVersion || null;
      const pair = resolveLivePromotionPair(mechanicalRows, {
        incumbentVersion,
        challengerVersion: prop.challengerArtifactVersion || null,
      });
      const gate = evaluatePromotionGate(
        {
          ...(pair || {
            incumbentScore: null,
            candidateScore: null,
            outputSource: null,
          }),
          llmGroundingEnabled: config?.grounding?.llmEnabled === true,
        },
      );
      prop.promotionGate = {
        eligible: gate.eligible,
        failures: gate.failures,
        scoreDelta: gate.scoreDelta,
        checkedAt: new Date().toISOString(),
        evidenceSource: pair?.source || null,
        incumbentArtifactVersion: pair?.incumbentScore?.artifactVersion || incumbentVersion,
        candidateArtifactVersion: pair?.candidateScore?.artifactVersion || null,
      };
      if (!gate.eligible) {
        writeProposals(agent, proposals);
        await store.put("agents", agent);
        const detail = gate.failures
          .map((failure) => `${failure.code}: ${failure.message}`)
          .join(" | ");
        throw httpError(
          409,
          `Promotion evidence gate refused — proposal stays proposed. ${detail}`,
          {
            promotionGate: prop.promotionGate,
            proposal: prop,
          },
        );
      }

      // Approval means "open a PR", not "go live". PR must succeed before
      // status flips to approved — never claim a PR that does not exist.
      let loopPr;
      try {
        loopPr = await openLoopPullRequestFn({
          agent,
          proposal: prop,
          promotionGate: prop.promotionGate,
          incumbentScore: pair?.incumbentScore || null,
          candidateScore: pair?.candidateScore || null,
          token: config?.github?.loopToken || undefined,
          env: {
            GITHUB_LOOP_TOKEN: config?.github?.loopToken || process.env.GITHUB_LOOP_TOKEN,
            GITHUB_SKILLS_TOKEN: process.env.GITHUB_SKILLS_TOKEN,
          },
        });
      } catch (err) {
        const message =
          err instanceof LoopPullRequestError
            ? err.message
            : `Loop PR failed: ${err?.message || String(err)}. Proposal stays proposed.`;
        prop.loopPrError = {
          code: err?.code || "loop_pr_failed",
          message,
          at: new Date().toISOString(),
        };
        writeProposals(agent, proposals);
        await store.put("agents", agent);
        throw httpError(err?.status || 502, message, {
          promotionGate: prop.promotionGate,
          loopPrError: prop.loopPrError,
          proposal: prop,
        });
      }

      prop.loopPr = {
        number: loopPr.number,
        url: loopPr.url,
        branch: loopPr.branch || null,
        reused: Boolean(loopPr.reused),
        createdAt: new Date().toISOString(),
      };
      delete prop.loopPrError;

      const approvedAt = new Date().toISOString();
      prop.status = "approved";
      prop.approvedAt = approvedAt;
      prop.approvedBy = {
        subject: actor.subject,
        issuer: actor.issuer,
        role: actor.role,
        ...(actor.name ? { name: actor.name } : {}),
      };
      // Copyable handoff for a human commit remains as a record; the PR is
      // the primary output. Never merge; never bump the pinned SHA here.
      prop.patch = prop.diff || approvedChangePatch(prop);
      agent.latestProposalAttempt = {
        outcome: "human-approved-pull-request-opened",
        recordedAt: approvedAt,
        proposalId: prop.id,
        pullRequestNumber: loopPr.number,
        pullRequestUrl: loopPr.url,
      };
      // Retain the approved proposal and every still-pending sibling. Approval
      // is a review decision, not a deletion and not a Railway version release.
      writeProposals(agent, proposals);
      await store.put("agents", agent);
      return { version: agent.version, proposal: prop, agent };
    },

    // A manual rejection is deliberately destructive: the operator saw this
    // proposal and chose to clear it. The loop must use markVerifierRejected
    // below instead, so an unreliable checker cannot erase its own evidence.
    async rejectImprovement(agentId, proposalId) {
      const agent = await store.get("agents", agentId);
      const proposals = agent ? readProposals(agent) : [];
      const pending = proposals.filter((proposal) => proposal.status === "proposed");
      if (!pending.length) throw httpError(404, "No pending improvement");
      const prop = selectProposal(pending, proposalId);
      if (!prop) throw httpError(409, "Proposal id mismatch");
      writeProposals(agent, proposals.filter((candidate) => candidate.id !== prop.id));
      await store.put("agents", agent);
      return { ok: true };
    },

    // Checker rejection is evidence, not a review decision. Keep the full
    // proposal and its attached verdict so a human can see and reopen it.
    async markVerifierRejected(agentId, proposalId) {
      const agent = await store.get("agents", agentId);
      const proposals = agent ? readProposals(agent) : [];
      const prop = selectProposal(
        proposals.filter((candidate) => candidate?.status === "proposed"),
        proposalId,
      );
      if (!agent || !prop) throw httpError(404, "No pending improvement");
      if (prop.verdict?.verdict !== "reject") {
        throw httpError(409, "Only a verifier reject verdict can mark a proposal rejected");
      }
      prop.status = "rejected";
      prop.autoRejection = { by: "verifier", recordedAt: new Date().toISOString() };
      agent.latestProposalAttempt = {
        outcome: "verifier-rejected",
        recordedAt: prop.autoRejection.recordedAt,
        proposalId: prop.id,
      };
      writeProposals(agent, proposals);
      await store.put("agents", agent);
      return prop;
    },

    // This records only that the proposal re-entered the human review queue;
    // Railway has no authenticated user principal, so do not invent one.
    async reopenVerifierRejectedImprovement(agentId, proposalId) {
      const agent = await store.get("agents", agentId);
      const proposals = agent ? readProposals(agent) : [];
      const prop = proposals.find((candidate) => candidate?.id === proposalId);
      if (!agent || !prop) throw httpError(404, "No rejected improvement");
      if (prop.status !== "rejected" || prop.autoRejection?.by !== "verifier") {
        throw httpError(409, "Only a verifier-rejected proposal can be reopened");
      }
      prop.status = "proposed";
      prop.reopenedForHumanReviewAt = new Date().toISOString();
      delete prop.autoRejection;
      agent.latestProposalAttempt = {
        outcome: "reopened-for-human-review",
        recordedAt: prop.reopenedForHumanReviewAt,
        proposalId: prop.id,
      };
      writeProposals(agent, proposals);
      await store.put("agents", agent);
      return prop;
    },

    // Attach a verifier verdict to a pending proposal (maker/checker split).
    async attachVerdict(agentId, verdict, proposalId) {
      const agent = await store.get("agents", agentId);
      const proposals = agent ? readProposals(agent) : [];
      const pending = proposals.filter((proposal) => proposal.status === "proposed");
      const prop = selectProposal(pending, proposalId);
      if (!prop) return null;
      prop.verdict = verdict;
      writeProposals(agent, proposals);
      await store.put("agents", agent);
      return prop;
    },

    // ── the loop's state: triage inbox + run history ──
    async listInbox() {
      const agents = await store.all("agents");
      return agents.flatMap((a) =>
        readProposals(a)
          .filter((proposal) => proposal.status === "proposed")
          .map((proposal) => ({
            agentId: a.id,
            name: a.name,
            version: a.version,
            proposal,
          })),
      );
    },
    async recordLoopRun(run) {
      const saved = await store.append("loopRuns", { ...run, ts: run.ts || new Date().toISOString() });
      return saved;
    },
    async recentLoopRuns(limit = 20) {
      const runs = await store.all("loopRuns");
      return runs.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
    },

    // ── learnings: append-only memory of what failed / was blocked (SPF) ──
    // "The agent forgets, the repo doesn't." Also feeds the Context pillar.
    async recordLearning(entry) {
      const saved = await store.append("learnings", { date: new Date().toISOString().slice(0, 10), ...entry });
      // Mirror into the agent's memory so future runs recall the block.
      if (entry.agentId && memory) {
        await memory.ingest(ns(entry.agentId), {
          id: `learning_${saved.id}`,
          content: `LEARNING (${entry.loop}): ${entry.learning}${entry.doNot ? ` — Do not: ${entry.doNot}` : ""}`,
          metadata: { kind: "learning", agentId: entry.agentId },
        }).catch(() => {});
      }
      return saved;
    },
    async recentLearnings(limit = 20) {
      const rows = await store.all("learnings");
      return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
    },
    // Has this agent already been blocked on this failure signal? (don't retry forever)
    async isBlockedSignal(agentId, signal) {
      if (!signal) return false;
      const rows = await store.query("learnings", (l) => l.agentId === agentId && l.signal === signal);
      return rows.length > 0;
    },

    // ── research queue (SPF: discovery writes it, improve consumes it) ──
    async listResearchQueue(status) {
      const rows = await store.all("researchQueue");
      const filtered = status ? rows.filter((r) => r.status === status) : rows;
      return filtered.sort((a, b) => (b.score - a.score) || (a.ts < b.ts ? 1 : -1));
    },
    // Dedup by agentId+focus among non-done items; regressions get a fresh item.
    // Refused/blocked items with the same focus stay blocked — research must not
    // reopen them every cycle to refuse again (RQ-001 churn).
    async upsertResearchItem(item) {
      const rows = await store.all("researchQueue");
      const existing = rows.find((r) => r.agentId === item.agentId && r.focus === item.focus && r.status !== "done");
      if (existing) {
        let nextStatus = item.status || existing.status;
        if (
          existing.status === "blocked" &&
          item.status === "open" &&
          existing.focus === item.focus
        ) {
          nextStatus = "blocked";
        }
        return store.put("researchQueue", {
          ...existing,
          ...item,
          id: existing.id,
          status: nextStatus,
        });
      }
      const id = item.id || `RQ-${String(rows.length + 1).padStart(3, "0")}`;
      return store.append("researchQueue", { id, status: "open", ts: new Date().toISOString(), ...item });
    },
    async setResearchStatus(id, status, note) {
      const it = await store.get("researchQueue", id);
      if (!it) return null;
      it.status = status;
      if (note) it.note = note;
      return store.put("researchQueue", it);
    },

    /**
     * Mechanical-check inventory + score + compare.
     * Never writes evalHistory; never feeds fleet health.
     */
    async mechanicalInventory(agentId) {
      if (agentId !== "A7") {
        throw httpError(400, "Mechanical inventory is only wired for A7");
      }
      const { getMechanicalInventory } = await import(
        "../eval/mechanicalInventory.js"
      );
      return getMechanicalInventory(agentId);
    },

    async mechanicalScore(agentId, body = {}) {
      if (agentId !== "A7") {
        throw httpError(400, "Mechanical score is only wired for A7");
      }
      const {
        caseId = "a7-mira-okonkwo-v1",
        artifactVersion = "biocraft-singleshot-v7",
        outputSource = "canned",
      } = body;
      try {
        const { runMechanicalScore } = await import("../eval/runCompare.js");
        return await runMechanicalScore({
          caseId,
          artifactVersion,
          outputSource,
          agentId,
          config,
          store,
        });
      } catch (error) {
        throw httpError(error.status || 500, error.message);
      }
    },

    /**
     * Mechanical-check compare. Two experiments — never a bare score delta:
     *   check_coverage  — same output, different check sets (detection)
     *   output_quality  — different outputs, one ruler; canned = plumbing only,
     *                     live = may answer whether the prompt change helped
     */
    async mechanicalCompare(agentId, body = {}) {
      if (agentId !== "A7") {
        throw httpError(400, "Mechanical compare is only wired for A7");
      }
      const {
        experiment,
        caseId = "a7-mira-okonkwo-v1",
        leftVersion = "biocraft-singleshot-v6",
        rightVersion = "biocraft-singleshot-v7",
        rulerVersion,
        outputSource = "canned",
      } = body;
      if (!experiment) {
        throw httpError(
          400,
          "experiment is required: check_coverage or output_quality. " +
            "A bare score delta across versions is refused.",
        );
      }
      try {
        const { runMechanicalCompare } = await import("../eval/runCompare.js");
        return await runMechanicalCompare(store, {
          experiment,
          caseId,
          leftVersion,
          rightVersion,
          rulerVersion,
          outputSource,
          agentId,
          config,
        });
      } catch (error) {
        throw httpError(error.status || 500, error.message);
      }
    },

    async mechanicalComparePreview(agentId, query = {}) {
      if (agentId !== "A7") {
        throw httpError(400, "Mechanical compare is only wired for A7");
      }
      const leftVersion = query.leftVersion || "biocraft-singleshot-v6";
      const rightVersion = query.rightVersion || "biocraft-singleshot-v7";
      const { previewVersionComparability } = await import(
        "../eval/runCompare.js"
      );
      try {
        return previewVersionComparability(leftVersion, rightVersion);
      } catch (error) {
        throw httpError(error.status || 500, error.message);
      }
    },

    async listMechanicalResults(agentId, { limit = 20 } = {}) {
      const rows = await store.query(
        "mechanicalResults",
        (row) => row.agentId === agentId,
      );
      return rows
        .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
        .slice(0, limit);
    },

    /**
     * Approver-only purge of stored mechanical evidence for one agent.
     * Returns what was deleted and appends an adminAudit row — never a silent wipe.
     */
    async clearMechanicalResults(agentId, body = {}, actor = null) {
      assertVerifiedApprover(actor);
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);

      const reason = String(body?.reason || "").trim();
      if (!reason) {
        throw httpError(
          400,
          'Clearing mechanical results requires a non-empty "reason" (audit trail).',
        );
      }
      if (reason.length > 500) {
        throw httpError(400, "reason must be 500 characters or fewer");
      }

      const removed = await store.removeWhere(
        "mechanicalResults",
        (row) => row.agentId === agentId,
      );
      const deleted = removed
        .map((row) => ({
          id: row.id,
          ts: row.ts || null,
          artifactVersion: row.artifactVersion || null,
          checkSetId: row.checkSetId || null,
          rulerVersion: row.rulerVersion || null,
          experiment: row.experiment || null,
          outputSource: row.outputSource || null,
          provider: row.provider || null,
          modelId: row.modelId || null,
        }))
        .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

      const clearedAt = new Date().toISOString();
      const audit = await store.append("adminAudit", {
        kind: "mechanical_results_cleared",
        agentId,
        clearedAt,
        deletedCount: deleted.length,
        deletedIds: deleted.map((row) => row.id),
        reason,
        actor: {
          subject: actor.subject,
          issuer: actor.issuer,
          role: actor.role,
          ...(actor.name ? { name: actor.name } : {}),
        },
      });

      return {
        agentId,
        deletedCount: deleted.length,
        deleted,
        reason,
        clearedAt,
        clearedBy: audit.actor,
        auditId: audit.id,
      };
    },

    async listAdminAudit(agentId, { limit = 20 } = {}) {
      const rows = await store.query(
        "adminAudit",
        (row) => !agentId || row.agentId === agentId,
      );
      return rows
        .sort((a, b) =>
          String(b.clearedAt || b.ts || "").localeCompare(
            String(a.clearedAt || a.ts || ""),
          ),
        )
        .slice(0, limit);
    },

    async ensureGroundingCalibrationSeed() {
      for (const seed of SEED_CALIBRATION_FINDINGS) {
        const existing = await store.get(
          GROUNDING_CALIBRATION_COLLECTION,
          seed.id,
        );
        if (existing) continue;
        await store.put(GROUNDING_CALIBRATION_COLLECTION, { ...seed });
      }
    },

    async listCalibrationRows(agentId = null) {
      await this.ensureGroundingCalibrationSeed();
      return store.query(
        GROUNDING_CALIBRATION_COLLECTION,
        (row) => !agentId || !row.agentId || row.agentId === agentId,
      );
    },

    async listGroundingCalibration(agentId, { limit = 50 } = {}) {
      const rows = await this.listCalibrationRows(agentId);
      const sorted = rows
        .sort((a, b) =>
          String(b.reviewedAt || b.ts || "").localeCompare(
            String(a.reviewedAt || a.ts || ""),
          ),
        )
        .slice(0, limit);
      return {
        findings: sorted,
        summary: summarizeCalibration(rows),
      };
    },

    /**
     * Approver labels a live grounding finding true_positive | false_positive.
     * Optionally paste draft/source to recover span text for historical traces.
     */
    async recordGroundingCalibration(agentId, body = {}, actor = null) {
      assertVerifiedApprover(actor);
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);

      const verdict = String(body?.verdict || "").trim();
      if (
        verdict !== GROUNDING_VERDICT.TRUE_POSITIVE &&
        verdict !== GROUNDING_VERDICT.FALSE_POSITIVE
      ) {
        throw httpError(
          400,
          `verdict must be "${GROUNDING_VERDICT.TRUE_POSITIVE}" or "${GROUNDING_VERDICT.FALSE_POSITIVE}"`,
        );
      }

      const traceId = String(body?.traceId || "").trim();
      const checkId = String(body?.checkId || "").trim();
      const claimSpanDigest = String(body?.claimSpanDigest || "").trim();
      const sourceSpanDigest = String(body?.sourceSpanDigest || "").trim();
      if (!traceId || !checkId || !claimSpanDigest || !sourceSpanDigest) {
        throw httpError(
          400,
          "traceId, checkId, claimSpanDigest, and sourceSpanDigest are required",
        );
      }

      const notes = String(body?.notes || "").trim();
      if (notes.length > 2000) {
        throw httpError(400, "notes must be 2000 characters or fewer");
      }

      // Prefer privileged evidence from the run; fall back to pasted text.
      const evidenceDocs = await store.query(
        GROUNDING_EVIDENCE_COLLECTION,
        (row) => row.agentId === agentId && row.traceId === traceId,
      );
      let claimSpan = null;
      let sourceSpan = null;
      for (const doc of evidenceDocs) {
        for (const finding of doc.findings || []) {
          if (
            finding.claimSpanDigest === claimSpanDigest &&
            finding.sourceSpanDigest === sourceSpanDigest
          ) {
            claimSpan = finding.claimSpan || null;
            sourceSpan = finding.sourceSpan || null;
          }
        }
      }
      if (!claimSpan && body?.draftText) {
        claimSpan = findTextForDigest(body.draftText, claimSpanDigest);
      }
      if (!sourceSpan && body?.sourceText) {
        sourceSpan = findTextForDigest(body.sourceText, sourceSpanDigest);
      }

      const saved = await store.append(GROUNDING_CALIBRATION_COLLECTION, {
        agentId,
        traceId,
        checkId,
        claimKind: body?.claimKind ? String(body.claimKind) : null,
        claimSpanDigest,
        sourceSpanDigest,
        verdict,
        notes: notes || null,
        spansRecovered: Boolean(claimSpan && sourceSpan),
        ...(claimSpan ? { claimSpan } : {}),
        ...(sourceSpan ? { sourceSpan } : {}),
        reviewedAt: new Date().toISOString(),
        reviewedBy: {
          subject: actor.subject,
          issuer: actor.issuer,
          role: actor.role,
          ...(actor.name ? { name: actor.name } : {}),
        },
      });

      const listed = await this.listGroundingCalibration(agentId, { limit: 50 });
      return { recorded: saved, summary: listed.summary };
    },

    /** Approver-only: raw claim/source spans for one trace (calibration). */
    async getGroundingEvidence(agentId, traceId, actor = null) {
      assertVerifiedApprover(actor);
      const rows = await store.query(
        GROUNDING_EVIDENCE_COLLECTION,
        (row) => row.agentId === agentId && row.traceId === traceId,
      );
      return { traceId, evidence: rows };
    },

    // ── fleet health roll-up ──
    async fleetHealth() {
      const agents = await store.all("agents");
      const latest = (a) => (a.evalHistory || []).at(-1);
      const evaluated = agents.filter(latest);
      const scores = evaluated.map((a) => latest(a).score).filter((n) => typeof n === "number");
      const avg = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0;
      const needsReview = agents.filter((a) => {
        const e = latest(a);
        return !e || e.status === "Needs improvement" || (typeof e.score === "number" && e.score < 70);
      }).length;
      const proposals = agents.reduce(
        (count, a) =>
          count + readProposals(a).filter((p) => p.status === "proposed").length,
        0,
      );
      return {
        total: agents.length,
        evaluated: evaluated.length,
        coverage: agents.length ? Math.round((evaluated.length / agents.length) * 100) : 0,
        avgScore: avg,
        needsReview,
        pendingImprovements: proposals,
      };
    },

    async health() {
      return {
        ok: true,
        observability: { provider: obs.name, ...(await obs.health()) },
        optimizer: { provider: optimizer.name, ...(await optimizer.health()) },
        memory: { provider: memory.name, ...(await memory.health()) },
        verifier: verifier ? { provider: verifier.name, ...(await verifier.health()) } : null,
      };
    },
  };
  return svc;
}

export function httpError(status, message, extras = null) {
  const e = new Error(message);
  e.status = status;
  if (extras && typeof extras === "object") {
    for (const [key, value] of Object.entries(extras)) {
      e[key] = value;
    }
  }
  return e;
}
