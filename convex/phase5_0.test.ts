/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { APPROVED_IMPORT_MANIFEST_DIGEST } from "./importSpec";
import { approveWithPromotionEval } from "./lib/seedPromotionEval";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const issuer = "https://valid-collie-71.clerk.accounts.dev";
const owner = { subject: "owner", issuer, name: "Owner", role: "member" };
const other = { subject: "other", issuer, name: "Other", role: "member" };
const approver = {
  subject: "approver",
  issuer,
  name: "Approver",
  role: "approver",
};

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: "Owned fixture",
    tagline: "Tests Phase 5 authority",
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

async function importedA7A8(t: any) {
  return await t.mutation(
    authorityApi.imports.executeApprovedCanonicalImport,
    { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
  );
}

describe("Phase 5.0 authority contracts", () => {
  test("simultaneous registration callers receive distinct display ids under the Convex test harness", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        t.mutation(
          authorityApi.agents.registerAgent,
          registration({ name: `Concurrent fixture ${index + 1}` }),
        ),
      ),
    );
    const ids = created.map((row) => row.displayId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice().sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `A${index + 1}`).sort(),
    );
  });

  test("registration derives owner identity and agent edits are owner-or-approver only", async () => {
    const base = convexTest(schema, modules);
    await expect(
      base.mutation(authorityApi.agents.registerAgent, registration()),
    ).rejects.toMatchObject({ data: expect.objectContaining({ status: 401 }) });

    const owned = base.withIdentity(owner);
    const created = await owned.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );
    const record = await owned.query(authorityApi.agents.getAgent, {
      id: created.agentId,
    });
    expect(record.ownerIdentity).toMatchObject({ subject: "owner", issuer });

    await owned.mutation(authorityApi.agents.updateAgent, {
      agentId: created.agentId,
      description: "Owner edit",
    });
    await expect(
      base.withIdentity(other).mutation(authorityApi.agents.updateAgent, {
        agentId: created.agentId,
        description: "Unauthorised edit",
      }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ status: 403 }) });
    await base.withIdentity(approver).mutation(authorityApi.agents.updateAgent, {
      agentId: created.agentId,
      description: "Approver edit",
    });
    expect(
      (await owned.query(authorityApi.agents.getAgent, { id: created.agentId }))
        .description,
    ).toBe("Approver edit");
  });

  test("agent update is allowlisted and cannot patch identity, release, version, or artifact fields", async () => {
    const t = convexTest(schema, modules).withIdentity(owner);
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );
    for (const forbidden of [
      { displayId: "A999" },
      { initials: "XX" },
      { createdBy: { subject: "forged", issuer } },
      { ownerIdentity: { subject: "forged", issuer } },
      { currentApprovedVersionId: created.draftVersionId },
      { artifact: { locator: "forged" } },
      { version: "99.0.0" },
    ]) {
      await expect(
        t.mutation(authorityApi.agents.updateAgent, {
          agentId: created.agentId,
          ...forbidden,
        }),
      ).rejects.toThrow();
    }
    const after = await t.query(authorityApi.agents.getAgent, {
      id: created.agentId,
    });
    expect(after.displayId).toBe(created.displayId);
    expect(after.ownerIdentity).toMatchObject({ subject: "owner", issuer });
  });

  test("unassigned imported agents are approver-editable only and an artifact-backed contract cannot drift", async () => {
    const base = convexTest(schema, modules);
    const imported = await importedA7A8(base.withIdentity(approver));
    await approveWithPromotionEval(base.withIdentity(approver), imported.A7.proposalId);
    const a7 = await base.withIdentity(approver).query(authorityApi.agents.getAgent, {
      id: imported.A7.agentId,
    });
    const a8 = await base.withIdentity(approver).query(authorityApi.agents.getAgent, {
      id: imported.A8.agentId,
    });
    expect(a7.ownerIdentity).toBeUndefined();
    expect(a8.ownerIdentity).toBeUndefined();
    await expect(
      base.withIdentity(owner).mutation(authorityApi.agents.updateAgent, {
        agentId: a7._id,
        description: "Ordinary user cannot edit an unassigned agent",
      }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ status: 403 }) });
    await expect(
      base.withIdentity(approver).mutation(authorityApi.agents.updateAgent, {
        agentId: a7._id,
        guardrails: [],
      }),
    ).rejects.toThrow(/Artifact-backed guardrails/);
    await base.withIdentity(approver).mutation(authorityApi.agents.updateAgent, {
      agentId: a7._id,
      objective: "Directory-owned objective update",
    });
  });

  test("ownership transfer accepts a claimant's signed identity and appends an event", async () => {
    const base = convexTest(schema, modules);
    const imported = await importedA7A8(base.withIdentity(approver));
    const claimId = await base.withIdentity(owner).mutation(
      authorityApi.agents.requestOwnershipClaim,
      { agentId: imported.A8.agentId },
    );
    await expect(
      base.withIdentity(other).mutation(authorityApi.agents.transferOwnership, {
        claimId,
      }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ status: 403 }) });
    const transferred = await base.withIdentity(approver).mutation(
      authorityApi.agents.transferOwnership,
      { claimId },
    );
    const state = await base.withIdentity(approver).run(async (ctx: any) => ({
      agent: await ctx.db.get(transferred.agentId),
      claim: await ctx.db.get(claimId),
      event: await ctx.db.get(transferred.eventId),
    }));
    expect(state.agent.ownerIdentity).toMatchObject({ subject: "owner", issuer });
    expect(state.claim).toMatchObject({ status: "accepted" });
    expect(state.event).not.toHaveProperty("previousOwnerIdentity");
    expect(state.event).toMatchObject({
      newOwnerIdentity: { subject: "owner", issuer, name: "Owner" },
      transferredBy: { subject: "approver", issuer, name: "Approver" },
    });
  });

  test("requests are private, carry creator/update provenance, and are creator-or-approver editable", async () => {
    const base = convexTest(schema, modules);
    await expect(base.query(authorityApi.requests.listRequests, {})).rejects.toMatchObject({
      data: expect.objectContaining({ status: 401 }),
    });
    const requestId = await base.withIdentity(owner).mutation(
      authorityApi.requests.createRequest,
      {
        title: "Request fixture",
        desc: "Tests request provenance",
        requestedBy: "Display requester",
        priority: "Important",
      },
    );
    await expect(
      base.withIdentity(other).mutation(authorityApi.requests.updateRequest, {
        id: requestId,
        notes: "Unauthorised",
      }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ status: 403 }) });
    await base.withIdentity(approver).mutation(authorityApi.requests.updateRequest, {
      id: requestId,
      status: "Approved",
    });
    const rows = await base.withIdentity(owner).query(authorityApi.requests.listRequests, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      createdBy: { subject: "owner", issuer, name: "Owner" },
      updatedBy: { subject: "approver", issuer, name: "Approver" },
      status: "Approved",
    });
    expect(typeof rows[0].updatedAt).toBe("number");
  });
});
