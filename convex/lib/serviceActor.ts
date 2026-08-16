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

// ── Merged-PR release identity ───────────────────────────────────────────────

export const GITHUB_APPROVER_ISSUER = "https://github.com";

/**
 * The human a service release acted for, derived from the merge event.
 *
 * Subject is `github:<numeric database id>`, not the login: logins are
 * renameable and reusable, so a login-keyed row would silently re-point at a
 * different person. The login travels in `name` for reading, never as identity.
 *
 * Refuses a Clerk-shaped identity outright — a merged PR never produces a
 * signed-in Clerk session, and a row claiming one would be a fabrication.
 */
export function assertGithubApproverIdentity(
  actor: AuthorityActor | undefined | null,
): AuthorityActor {
  const subject = String(actor?.subject || "").trim();
  const issuer = String(actor?.issuer || "").trim();
  if (!subject || !issuer) {
    throw new Error(
      "Merged-PR release requires a resolved GitHub approver (subject + issuer); refusing the release",
    );
  }
  if (issuer !== GITHUB_APPROVER_ISSUER) {
    throw new Error(
      `Merged-PR approver issuer must be ${GITHUB_APPROVER_ISSUER}, got ${issuer}`,
    );
  }
  if (!/^github:[0-9]+$/.test(subject)) {
    throw new Error(
      "Merged-PR approver subject must be github:<numeric id> — a login is not an identity",
    );
  }
  if (/clerk/i.test(issuer) || /clerk/i.test(subject)) {
    throw new Error("Merged-PR approver must not wear a Clerk-shaped identity");
  }
  return {
    subject,
    issuer,
    ...(actor?.name ? { name: actor.name } : {}),
    ...(actor?.email ? { email: actor.email } : {}),
  };
}

/**
 * Identity pair for a service-written review event.
 *
 * `actor` is always the declared loop principal. `onBehalfOf` is REQUIRED for
 * any decision that moves the pointer: a service approval with an unresolved
 * human must fail validation rather than persist. A `release-refused` row may
 * omit it only when identity resolution is the thing that failed — that row
 * records the refusal, it does not release anything.
 */
export function assertServiceReviewIdentity(args: {
  decision: string;
  onBehalfOf?: AuthorityActor | null;
}): { actor: AuthorityActor; onBehalfOf?: AuthorityActor } {
  const actor = declaredLoopServiceActor();
  if (args.decision === "release-refused") {
    return args.onBehalfOf
      ? { actor, onBehalfOf: assertGithubApproverIdentity(args.onBehalfOf) }
      : { actor };
  }
  if (!args.onBehalfOf) {
    throw new Error(
      `A service-written "${args.decision}" review event requires onBehalfOf; refusing to record an approval with no human behind it`,
    );
  }
  return { actor, onBehalfOf: assertGithubApproverIdentity(args.onBehalfOf) };
}
