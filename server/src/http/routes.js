// REST surface. Thin — each route delegates to the loop service. This is the
// contract the front-end's api.js talks to.
import { binaryReply, reply } from "./router.js";
import {
  requireClerkApprover,
  requireClerkIdentity,
} from "../auth/clerkJwt.js";
import { verifyGithubSignature } from "../github/webhookSignature.js";

/**
 * Bulk metadata export is the one read that hands over the whole catalogue at
 * once, so it is authenticated separately from the per-agent routes the static
 * front-end needs. Without a configured API_TOKEN a deployed service cannot
 * authenticate anyone, and an anonymous bulk read is worse than no export — so
 * it answers 401 rather than serving it.
 *
 * Rule: any route that can cause a paid model call or mutate a record requires
 * a verified Clerk JWT via x-directory-identity-token. Do NOT use API_TOKEN —
 * it is browser-visible and not a secret.
 */
function migrationExportDenial(req, { apiToken = "", requireAuthenticatedExport = false } = {}) {
  if (apiToken) {
    return (req?.headers?.authorization || "") === `Bearer ${apiToken}`
      ? null
      : "Unauthorized";
  }
  return requireAuthenticatedExport
    ? "Migration export is disabled until API_TOKEN is configured on this deployment"
    : null;
}

/** Await Clerk identity; failures become HTTP errors with a visible reason. */
async function withIdentity(req, config, handler) {
  const actor = await requireClerkIdentity(req, config.clerk);
  return handler(actor);
}

/**
 * Catalogue reads must not serve repo-owned prompt text. The live prompt for
 * runtime agents is the server artifact (install/ZIP), not agent.prompt.
 */
function publicAgentView(agent) {
  if (!agent || typeof agent !== "object") return agent;
  const { prompt: _prompt, ...rest } = agent;
  return rest;
}

export function registerRoutes(router, svc, engine, config = {}) {
  // ── Public reads (no paid call, no mutation) ──
  router.get("/api/health", async () => svc.health());
  router.get("/api/fleet/health", async () => svc.fleetHealth());
  router.get("/api/migration/export", async ({ req }) => {
    const denial = migrationExportDenial(req, config);
    return denial ? reply(401, { error: denial }) : svc.migrationExport();
  });

  router.get("/api/loop/queue", async ({ query }) => ({ queue: await svc.listResearchQueue(query.status) }));
  router.get("/api/loop/runs", async ({ query }) => ({ runs: await svc.recentLoopRuns(Number(query.limit) || 20) }));
  router.get("/api/loop/inbox", async () => ({ inbox: await svc.listInbox() }));
  router.get("/api/loop/learnings", async ({ query }) => ({ learnings: await svc.recentLearnings(Number(query.limit) || 20) }));

  router.get("/api/agents", async () => ({
    agents: (await svc.listAgents()).map(publicAgentView),
  }));
  router.get("/api/agents/:id", async ({ params }) => {
    const a = await svc.getAgent(params.id);
    return a ? publicAgentView(a) : reply(404, { error: "Not found" });
  });
  router.get("/api/agents/:id/invocation-capability", async ({ params }) =>
    svc.getInvocationCapability(params.id)
  );
  router.get("/api/agents/:id/install-artifact/skill", async ({ params }) =>
    svc.getInstallSkill(params.id)
  );
  router.get("/api/agents/:id/install-artifact/download", async ({ params }) => {
    const artifact = await svc.getInstallArtifactZip(params.id);
    return binaryReply(artifact.data, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${artifact.filename}"`,
      "x-artifact-digest": artifact.artifactDigest,
      "x-artifact-digest-algorithm": artifact.artifactDigestAlgorithm,
    });
  });
  router.get("/api/agents/:id/handoff-briefing", async ({ params }) =>
    svc.getHandoffBriefing(params.id)
  );
  router.get("/api/agents/:id/traces", async ({ params, query }) => ({
    traces: await svc.listTraces(params.id, { limit: Number(query.limit) || 50 }),
  }));
  router.get("/api/agents/:id/context/search", async ({ params, query }) => ({
    results: await svc.recallContext(params.id, query.q || "", { limit: Number(query.limit) || 5 }),
  }));
  router.get("/api/agents/:id/mechanical-inventory", async ({ params }) =>
    svc.mechanicalInventory(params.id)
  );
  router.get("/api/agents/:id/mechanical-compare/preview", async ({ params, query }) =>
    svc.mechanicalComparePreview(params.id, query || {})
  );
  router.get("/api/agents/:id/mechanical-results", async ({ params, query }) => ({
    results: await svc.listMechanicalResults(params.id, {
      limit: Number(query.limit) || 20,
    }),
  }));
  router.get("/api/agents/:id/admin-audit", async ({ params, query }) => ({
    audits: await svc.listAdminAudit(params.id, {
      limit: Number(query.limit) || 20,
    }),
  }));
  router.get("/api/agents/:id/grounding-calibration", async ({ params, query }) =>
    svc.listGroundingCalibration(params.id, {
      limit: Number(query.limit) || 50,
    }),
  );

  // ── Identity-gated: paid model calls and/or mutations ──
  router.post("/api/loop/run", async ({ req }) =>
    withIdentity(req, config, async () => reply(201, await engine.runCycle())),
  );
  router.post("/api/loop/research", async ({ req }) =>
    withIdentity(req, config, async () =>
      reply(201, { discovered: await engine.runResearch() }),
    ),
  );
  router.post("/api/agents/:id/goal", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await engine.runGoal(params.id, body || {})),
    ),
  );
  router.put("/api/agents/:id", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      publicAgentView(await svc.putAgentAllowlisted(params.id, body || {})),
    ),
  );
  router.post("/api/agents/:id/run", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.runAgent(params.id, (body && body.inputs) || {})),
    ),
  );
  router.post("/api/agents/:id/traces", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.recordTrace(params.id, body || {})),
    ),
  );
  router.post("/api/agents/:id/traces/:traceId/feedback", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.recordFeedback(params.id, params.traceId, body || {})),
    ),
  );
  router.post("/api/agents/:id/evals", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.logEval(params.id, body || {})),
    ),
  );
  router.post("/api/agents/:id/context", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.addContext(params.id, body || {})),
    ),
  );
  router.post("/api/agents/:id/improvements", async ({ params, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.runImprovement(params.id)),
    ),
  );
  router.post("/api/agents/:id/improvements/:pid/approve", async ({ params, req }) => {
    const actor = await requireClerkApprover(req, config.clerk);
    return svc.approveImprovement(
      params.id,
      params.pid === "current" ? null : params.pid,
      actor,
    );
  });
  router.post("/api/agents/:id/improvements/:pid/reject", async ({ params, req }) =>
    withIdentity(req, config, async () =>
      svc.rejectImprovement(params.id, params.pid === "current" ? null : params.pid),
    ),
  );
  router.post("/api/agents/:id/improvements/:pid/reopen", async ({ params, req }) =>
    withIdentity(req, config, async () =>
      svc.reopenVerifierRejectedImprovement(params.id, params.pid),
    ),
  );
  router.post("/api/agents/:id/mechanical-score", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.mechanicalScore(params.id, body || {})),
    ),
  );
  router.post("/api/agents/:id/mechanical-compare", async ({ params, body, req }) =>
    withIdentity(req, config, async () =>
      reply(201, await svc.mechanicalCompare(params.id, body || {})),
    ),
  );
  // Approver-only: purge stale mechanical evidence with an audit trail.
  router.post("/api/agents/:id/mechanical-results/clear", async ({ params, body, req }) => {
    const actor = await requireClerkApprover(req, config.clerk);
    return reply(200, await svc.clearMechanicalResults(params.id, body || {}, actor));
  });
  router.post("/api/agents/:id/grounding-calibration", async ({ params, body, req }) => {
    const actor = await requireClerkApprover(req, config.clerk);
    return reply(201, await svc.recordGroundingCalibration(params.id, body || {}, actor));
  });
  router.get("/api/agents/:id/traces/:traceId/grounding-evidence", async ({ params, req }) => {
    const actor = await requireClerkApprover(req, config.clerk);
    return svc.getGroundingEvidence(params.id, params.traceId, actor);
  });

  // Approver-only: link the Convex proposal a loop branch releases on merge.
  router.post("/api/agents/:id/improvements/:pid/link-convex-proposal", async ({ params, body, req }) => {
    await requireClerkApprover(req, config.clerk);
    return reply(
      200,
      await svc.linkConvexProposal(
        params.id,
        params.pid === "current" ? null : params.pid,
        (body && body.convexProposalId) || "",
      ),
    );
  });

  // ── Merged loop/ PR → Convex release ──
  //
  // The only route on this service that can move currentApprovedVersionId
  // without a signed-in human. It is exempt from the API_TOKEN gate (GitHub
  // cannot send our bearer token) and authenticated by HMAC over the raw body
  // instead — see SELF_AUTHENTICATED_PATHS in router.js.
  //
  // Refusals answer with their code and a reason. A delivery this endpoint is
  // not for answers 200 with an explicit `reason`, so an ignore is still
  // reported rather than looking like a success.
  router.post("/api/github/webhook", async ({ body, req }) => {
    verifyGithubSignature({
      rawBody: req.rawBody,
      signatureHeader: req.headers["x-hub-signature-256"],
      secret: config?.github?.webhookSecret || "",
    });
    const eventName = String(req.headers["x-github-event"] || "");
    const delivery = String(req.headers["x-github-delivery"] || "");
    try {
      const result = await svc.releaseFromMergedLoopPullRequest({
        eventName,
        payload: body || {},
      });
      return reply(200, { delivery, ...result });
    } catch (err) {
      // Refusals are answers, not crashes. Return the code and the reason so
      // the GitHub delivery log shows exactly why the pointer did not move.
      return reply(err?.status || 500, {
        delivery,
        released: false,
        error: err?.message || String(err),
        code: err?.code || "loop_release_failed",
        pointerMoved: false,
        ...(err?.refusalEvent ? { refusalEvent: err.refusalEvent } : {}),
        ...(err?.refusalRecordError
          ? { refusalRecordError: err.refusalRecordError }
          : {}),
      });
    }
  });
}

export { publicAgentView };
