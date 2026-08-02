// GEPA / DSPy optimizer adapter — real reflective prompt evolution.
//
// GEPA runs as a job, not an in-process call, so this adapter supports two
// wiring modes (pick one in .env):
//   GEPA_ENDPOINT  — POST the optimization task to an HTTP job runner
//   GEPA_CMD       — spawn a local CLI (e.g. `python -m gepa optimize`)
// This integration predates the structured ProposalChange contract and its
// external endpoint/CLI returns only an optimized prompt/diff. A prompt diff
// cannot honestly represent a checker or runtime fix, so `propose` refuses
// until that external contract emits validated `changes[]`. It must never wrap
// a prompt diff in a fake checker/runtime change.

export function createGepaOptimizer({ endpoint, cmd, model, budget }) {
  if (!endpoint && !cmd) {
    throw new Error("GEPA selected but neither GEPA_ENDPOINT nor GEPA_CMD is configured");
  }
  return {
    name: "gepa",

    async health() {
      return { ok: true, detail: endpoint ? `endpoint ${endpoint}` : `cmd ${cmd}` };
    },

    async propose(agent, evidence) {
      if (!evidence?.defectSignals?.length) {
        throw Object.assign(
          new Error("GEPA has no defect signal to optimize against — refusing"),
          { status: 422 },
        );
      }
      throw Object.assign(
        new Error(
          "GEPA adapter is prompt-only and cannot emit the required structured changes[] contract; refusing until the GEPA endpoint/CLI is upgraded",
        ),
        { status: 422 },
      );
    },
  };
}
