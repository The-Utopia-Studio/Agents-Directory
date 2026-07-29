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

export async function requireIdentity(ctx: AuthCtx): Promise<AuthorityActor> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      status: 401,
      message: "Authentication required",
    });
  }

  return {
    subject: identity.subject,
    issuer: identity.issuer,
    name: identity.name,
    email: identity.email,
  };
}
