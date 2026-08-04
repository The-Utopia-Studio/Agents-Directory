// Declared loop-service principal for Convex evidence writes (state B).
// Same durable shape as the intended end state (D): short-lived JWTs from an
// issuer we control, verified by Convex. B records the shape without verifying
// a service JWT; D upgrades verification without rewriting rows.
import type { AuthorityActor } from "./auth";

export const LOOP_SERVICE_ISSUER = "service:agents-directory";
export const LOOP_SERVICE_SUBJECT = "agents-directory-loop";

/** The only service actor the loop may record. Not a Clerk principal. */
export const LOOP_SERVICE_ACTOR: AuthorityActor = {
  subject: LOOP_SERVICE_SUBJECT,
  issuer: LOOP_SERVICE_ISSUER,
};

function configuredClerkIssuer(): string {
  return String(process.env.CLERK_JWT_ISSUER_DOMAIN || "").replace(/\/+$/, "");
}

/**
 * Hard guard: a service write must never wear a Clerk-shaped issuer.
 * Makes "service row pointing at a Clerk principal" structurally impossible.
 */
export function assertDeclaredServiceActor(actor: AuthorityActor): AuthorityActor {
  const issuer = String(actor?.issuer || "");
  if (!issuer || !String(actor?.subject || "").trim()) {
    throw new Error("Service actor requires subject and issuer");
  }
  if (/clerk\.accounts\.dev/i.test(issuer)) {
    throw new Error(
      "Service evidence path refuses a Clerk-shaped issuer (clerk.accounts.dev)",
    );
  }
  const clerkIssuer = configuredClerkIssuer();
  if (clerkIssuer && issuer.replace(/\/+$/, "") === clerkIssuer) {
    throw new Error(
      "Service evidence path refuses the configured CLERK_JWT_ISSUER_DOMAIN",
    );
  }
  if (/^https:\/\//i.test(issuer) && /clerk/i.test(issuer)) {
    throw new Error("Service evidence path refuses a Clerk HTTPS issuer");
  }
  if (
    issuer !== LOOP_SERVICE_ISSUER ||
    actor.subject !== LOOP_SERVICE_SUBJECT
  ) {
    throw new Error(
      `Service actor must be ${LOOP_SERVICE_SUBJECT} @ ${LOOP_SERVICE_ISSUER}`,
    );
  }
  return {
    subject: LOOP_SERVICE_SUBJECT,
    issuer: LOOP_SERVICE_ISSUER,
  };
}

/** Declared service principal for internal writers. Does not call requireIdentity. */
export function declaredLoopServiceActor(): AuthorityActor {
  return assertDeclaredServiceActor(LOOP_SERVICE_ACTOR);
}
