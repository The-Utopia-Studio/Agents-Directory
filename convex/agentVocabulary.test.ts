/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

/**
 * `rung` and `harness` are carried verbatim from the AgentManifest
 * (studio-agent-framework/schemas/agent-manifest.schema.json) rather than
 * re-derived here. They are optional until the TUS-2749 projection backfills
 * them, so these tests exist to prove three things the schema claims:
 *
 *   1. an absent rung stays absent — it must never default to 1, because
 *      "not yet declared" and "this is a skill" are different facts
 *   2. the unions actually bite, so a bad value is refused at the boundary
 *      rather than stored and surfaced in the directory
 *   3. `rung` and `autonomyLevel` are independent axes and can be set to
 *      contradictory-looking combinations, because they measure different things
 */

const authorityApi = api as any;
const issuer = "https://valid-collie-71.clerk.accounts.dev";
const owner = { subject: "owner", issuer, name: "Owner", role: "member" };

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: "Vocabulary fixture",
    tagline: "Tests manifest-carried fields",
    platform: "Claude" as const,
    status: "Experimental" as const,
    category: "Other" as const,
    owner: "Display owner",
    runner: "none" as const,
    usabilityModes: ["prepared-handoff"] as const,
    executionContract: { inputs: [], runnerConfig: [] },
    evidenceContract: { acceptedTypes: [], requiredReturnArtifact: false },
    outcomeContract: { successCriteria: [], evalSetId: null },
    guardrails: [],
    draftVersion: "0.1.0",
    ...overrides,
  };
}

async function register(t: any, overrides: Record<string, unknown> = {}) {
  return await t.mutation(authorityApi.agents.registerAgent, registration(overrides));
}

async function readBack(t: any, displayId: string) {
  const rows = await t.query(authorityApi.agents.listAgents, {});
  return rows.find((row: any) => row.displayId === displayId);
}

describe("manifest-carried vocabulary fields", () => {
  test("an agent registered without a rung has no rung — it does not default to 1", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    const created = await register(t);
    const row = await readBack(t, created.displayId);

    expect(row).toBeDefined();
    expect(row.rung).toBeUndefined();
    expect(row.harness).toBeUndefined();
  });

  test("stores a declared rung and harness verbatim", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    const created = await register(t, { rung: 4, harness: "mastra-convex" });
    const row = await readBack(t, created.displayId);

    expect(row.rung).toBe(4);
    expect(row.harness).toBe("mastra-convex");
  });

  test("refuses a rung outside the manifest's 1-4 ladder", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    await expect(register(t, { rung: 5 })).rejects.toThrow();
    await expect(register(t, { rung: 0 })).rejects.toThrow();
  });

  test("refuses a harness the manifest does not name", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    await expect(register(t, { harness: "langgraph" })).rejects.toThrow();
  });

  test("rung and autonomyLevel are independent axes, not one scale", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);

    // A rung-1 skill trusted to act broadly, and a rung-4 coded agent kept on
    // suggest-and-confirm. Both are legitimate; a single scale could express
    // neither, which is why the two fields both exist.
    const skill = await register(t, {
      name: "Broad skill",
      rung: 1,
      autonomyLevel: "L3",
    });
    const coded = await register(t, {
      name: "Gated coded agent",
      rung: 4,
      autonomyLevel: "L1",
    });

    const skillRow = await readBack(t, skill.displayId);
    const codedRow = await readBack(t, coded.displayId);

    expect(skillRow.rung).toBe(1);
    expect(skillRow.autonomyLevel).toBe("L3");
    expect(codedRow.rung).toBe(4);
    expect(codedRow.autonomyLevel).toBe("L1");
  });
});
