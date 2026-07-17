// GEPA / DSPy optimizer adapter — real reflective prompt evolution.
//
// GEPA runs as a job, not an in-process call, so this adapter supports two
// wiring modes (pick one in .env):
//   GEPA_ENDPOINT  — POST the optimization task to an HTTP job runner
//   GEPA_CMD       — spawn a local CLI (e.g. `python -m gepa optimize`)
// Either way we hand it a dataset built from failing traces and parse an
// optimized prompt back into our Proposal shape. Unconfigured => clear error,
// and the factory falls back to the heuristic optimizer.
import { spawn } from "node:child_process";

function buildDataset(agent, traces, latestEval) {
  return {
    agentId: agent.id,
    objective: agent.objective,
    currentPrompt: agent.prompt || "",
    metric: "success_criteria",
    knownIssues: latestEval?.knownIssues || "",
    // GEPA optimizes against a rollout set — failing traces are the signal.
    examples: traces.map((t) => ({
      input: t.input,
      output: t.output,
      status: t.status,
      score: t.score,
      failureReason: t.failureReason,
    })),
  };
}

function toProposal(result, meta) {
  return {
    source: "GEPA",
    status: "proposed",
    date: new Date().toISOString().slice(0, 10),
    summary: result.summary || "GEPA-evolved prompt revision",
    detail: result.rationale || "Reflective evolutionary search produced a revised prompt on the Pareto front.",
    diff: result.diff || result.optimizedPrompt || "",
    expectedGain: result.expectedGain ?? result.deltaScore ?? undefined,
    evidence: { optimizer: "gepa", ...meta },
  };
}

async function runHttp(endpoint, task) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error(`GEPA endpoint ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

function runCmd(cmd, task) {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd.split(" ");
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`GEPA cmd exited ${code}: ${err}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`GEPA cmd bad JSON: ${e.message}\n${out}`)); }
    });
    child.stdin.end(JSON.stringify(task));
  });
}

export function createGepaOptimizer({ endpoint, cmd, model, budget }) {
  if (!endpoint && !cmd) {
    throw new Error("GEPA selected but neither GEPA_ENDPOINT nor GEPA_CMD is configured");
  }
  return {
    name: "gepa",

    async health() {
      return { ok: true, detail: endpoint ? `endpoint ${endpoint}` : `cmd ${cmd}` };
    },

    async propose(agent, traces, latestEval) {
      const task = { ...buildDataset(agent, traces, latestEval), model, budget };
      const result = endpoint ? await runHttp(endpoint, task) : await runCmd(cmd, task);
      return toProposal(result, { tracesReviewed: traces.length, model, budget });
    },
  };
}
