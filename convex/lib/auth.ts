import { ConvexError } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

export type AuthorityActor = {
  subject: string;
  issuer: string;
  name?: string;
  email?: string;
};

type AuthCtx = Pick<GenericQueryCtx<DataModel>, "auth">;

async function authenticatedIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      status: 401,
      message: "Authentication required",
    });
  }
  return identity;
}

function authorityActor(
  identity: Awaited<ReturnType<AuthCtx["auth"]["getUserIdentity"]>> & {},
): AuthorityActor {
  return {
    subject: identity.subject,
    issuer: identity.issuer,
    name: identity.name,
    email: identity.email,
  };
}

export async function requireIdentity(ctx: AuthCtx): Promise<AuthorityActor> {
  return authorityActor(await authenticatedIdentity(ctx));
}

/**
 * Central approval policy boundary.
 *
 * V1 uses a user-level Clerk role. The signed top-level `role` claim must equal
 * `approver`. Keeping this role-based means adding an approver is a Clerk
 * assignment, not a code change; no subject id or fallback identity exists.
 */
export async function requireApprover(ctx: AuthCtx): Promise<AuthorityActor> {
  const identity = await authenticatedIdentity(ctx);
  if (identity.role !== "approver") {
    throw new ConvexError({
      code: "FORBIDDEN",
      status: 403,
      message: "Release approver role required",
    });
  }
  return authorityActor(identity);
}
