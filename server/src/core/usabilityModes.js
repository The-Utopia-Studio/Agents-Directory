export const USABILITY_MODES = Object.freeze([
  "hosted-run",
  "download-install",
  "prepared-handoff",
  "approval-queue",
]);

// One-time translation of the six records that predate persisted usability.
// Values preserve the former client mapping exactly; runtime code never infers
// usability from invocation.type.
export const LEGACY_USABILITY_BACKFILL = Object.freeze({
  A1: Object.freeze(["download-install"]),
  A2: Object.freeze(["hosted-run", "download-install"]),
  A3: Object.freeze(["download-install"]),
  A4: Object.freeze(["download-install"]),
  A5: Object.freeze(["download-install"]),
  A6: Object.freeze(["download-install"]),
});

export function assertUsabilityModes(agent) {
  const modes = agent?.usabilityModes;
  if (
    !Array.isArray(modes) ||
    modes.length === 0 ||
    new Set(modes).size !== modes.length ||
    modes.some((mode) => !USABILITY_MODES.includes(mode))
  ) {
    throw Object.assign(
      new Error(
        `Agent ${agent?.id || "(unknown)"} requires a non-empty, valid usabilityModes array`,
      ),
      { status: 400 },
    );
  }
  return agent;
}

export async function backfillStoredUsabilityModes(store) {
  const agents = await store.all("agents");
  let migrated = 0;
  for (const agent of agents) {
    if (Array.isArray(agent.usabilityModes) && agent.usabilityModes.length) {
      assertUsabilityModes(agent);
      continue;
    }
    const modes = LEGACY_USABILITY_BACKFILL[agent.id];
    if (!modes) {
      throw new Error(
        `Agent ${agent.id} has no usabilityModes and no reviewed backfill`,
      );
    }
    await store.put("agents", {
      ...agent,
      usabilityModes: [...modes],
    });
    migrated += 1;
  }
  return migrated;
}
