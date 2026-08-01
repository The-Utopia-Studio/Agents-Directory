// REST surface. Thin — each route delegates to the loop service. This is the
// contract the front-end's api.js talks to.
import { binaryReply, reply } from "./router.js";

export function registerRoutes(router, svc, engine) {
  // health / status of the wired providers
  router.get("/api/health", async () => svc.health());
  router.get("/api/fleet/health", async () => svc.fleetHealth());

  // ── the loop / automations (the heartbeat) ──
  router.post("/api/loop/run", async () => reply(201, await engine.runCycle()));
  router.post("/api/loop/research", async () => reply(201, { discovered: await engine.runResearch() }));
  router.get("/api/loop/queue", async ({ query }) => ({ queue: await svc.listResearchQueue(query.status) }));
  router.get("/api/loop/runs", async ({ query }) => ({ runs: await svc.recentLoopRuns(Number(query.limit) || 20) }));
  router.get("/api/loop/inbox", async () => ({ inbox: await svc.listInbox() }));
  router.get("/api/loop/learnings", async ({ query }) => ({ learnings: await svc.recentLearnings(Number(query.limit) || 20) }));
  // run-until-done on one agent (the /goal primitive)
  router.post("/api/agents/:id/goal", async ({ params, body }) =>
    reply(201, await engine.runGoal(params.id, body || {}))
  );

  // agents
  router.get("/api/agents", async () => ({ agents: await svc.listAgents() }));
  router.get("/api/agents/:id", async ({ params }) => {
    const a = await svc.getAgent(params.id);
    return a || reply(404, { error: "Not found" });
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
  router.put("/api/agents/:id", async ({ params, body }) =>
    svc.putAgent({ ...body, id: params.id })
  );

  // run the agent where it lives (records a trace → feeds the loop)
  router.post("/api/agents/:id/run", async ({ params, body }) =>
    reply(201, await svc.runAgent(params.id, (body && body.inputs) || {}))
  );

  // traces (observability write + read)
  router.post("/api/agents/:id/traces", async ({ params, body }) =>
    reply(201, await svc.recordTrace(params.id, body || {}))
  );
  router.get("/api/agents/:id/traces", async ({ params, query }) => ({
    traces: await svc.listTraces(params.id, { limit: Number(query.limit) || 50 }),
  }));
  router.post("/api/agents/:id/traces/:traceId/feedback", async ({ params, body }) =>
    reply(201, await svc.recordFeedback(params.id, params.traceId, body || {}))
  );

  // evals (append-only)
  router.post("/api/agents/:id/evals", async ({ params, body }) =>
    reply(201, await svc.logEval(params.id, body || {}))
  );

  // context / memory (the fourth pillar)
  router.post("/api/agents/:id/context", async ({ params, body }) =>
    reply(201, await svc.addContext(params.id, body || {}))
  );
  router.get("/api/agents/:id/context/search", async ({ params, query }) => ({
    results: await svc.recallContext(params.id, query.q || "", { limit: Number(query.limit) || 5 }),
  }));

  // the loop
  router.post("/api/agents/:id/improvements", async ({ params }) =>
    reply(201, await svc.runImprovement(params.id))
  );
  router.post("/api/agents/:id/improvements/:pid/approve", async ({ params }) =>
    svc.approveImprovement(params.id, params.pid === "current" ? null : params.pid)
  );
  router.post("/api/agents/:id/improvements/:pid/reject", async ({ params }) =>
    svc.rejectImprovement(params.id, params.pid === "current" ? null : params.pid)
  );
}
