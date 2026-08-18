import { Clerk } from "@clerk/clerk-js";

const CONVEX_TEMPLATE = "convex";

/**
 * Read the claims out of the token we are actually going to send.
 *
 * The maintainer surface gates on `role === "approver"`, and that claim exists
 * ONLY on the named `convex` template — Clerk's default __session cookie
 * carries sub/sid/iss/exp and nothing else, which is why the CLI and the Convex
 * dashboard both fail requireApprover. Decoding here lets the UI say which
 * claim is missing instead of rendering a button that 403s.
 *
 * Decode only, never verify: Convex and Railway verify the signature. This is
 * a UI affordance and is not trusted for authority.
 */
function decodeClaims(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function publicMessage(error, stage = "clerk") {
  // Do not put provider/network error strings into the page: they may expose
  // deployment details. The state is still explicit and actionable.
  if (stage === "convex") {
    return "Your Clerk token was obtained, but Convex did not accept it. Check the issuer and convex audience, then retry."
  }
  return error
    ? "We could not obtain a Convex sign-in token. Sign out and sign in again, then retry."
    : "Clerk is not configured for this deployment.";
}

async function loadClerkUi(publishableKey) {
  if (window.__internal_ClerkUICtor) return;
  const encodedDomain = publishableKey.split("_")[2];
  if (!encodedDomain) throw new Error("Invalid Clerk publishable key");
  const domain = atob(encodedDomain).slice(0, -1);
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load Clerk UI"));
    document.head.appendChild(script);
  });
}

export function createDirectoryAuth({
  publishableKey,
  clerkFactory = (key) => new Clerk(key),
  loadUi = loadClerkUi,
  onToken = () => {},
  verifyConvexIdentity = async () => {},
} = {}) {
  let clerk = null;
  let unsubscribe = null;
  let state = {
    status: "initializing",
    detail: "Checking your sign-in state…",
    user: null,
  };
  const listeners = new Set();

  function publish(next, token = null) {
    state = { ...next };
    onToken(token);
    for (const listener of listeners) listener({ ...state });
  }

  async function syncSession() {
    if (!clerk?.session || !clerk?.user) {
      publish({ status: "signed-out", detail: "Sign in to register, edit, or request.", user: null });
      return;
    }
    try {
      const token = await clerk.session.getToken({ template: CONVEX_TEMPLATE });
      if (!token) {
        publish({
          status: "unavailable",
          detail: "Your signed-in session did not provide the required Convex token. Sign out and sign in again.",
          user: null,
        });
        return;
      }
      onToken(token);
      try {
        await verifyConvexIdentity();
      } catch (error) {
        publish({ status: "unavailable", detail: publicMessage(error, "convex"), user: null });
        return;
      }
      publish({
        status: "signed-in",
        detail: "Signed in. Convex writes use your signed identity.",
        user: (() => {
          const claims = decodeClaims(token) || {};
          return {
            name: clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || "Signed-in user",
            // The role as the token carries it — absent means absent, never "".
            role: typeof claims.role === "string" ? claims.role : null,
            claimNames: Object.keys(claims).sort(),
            template: CONVEX_TEMPLATE,
          };
        })(),
      }, token);
    } catch (error) {
      publish({ status: "unavailable", detail: publicMessage(error), user: null });
    }
  }

  const api = {
    getState: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    async signIn() {
      if (!clerk) return;
      clerk.openSignIn({ forceRedirectUrl: window.location.href });
    },
    async signOut() {
      if (!clerk) return;
      await clerk.signOut({ redirectUrl: window.location.href });
    },
    async retry() {
      if (!clerk) {
        publish({ status: "unavailable", detail: publicMessage(), user: null });
        return;
      }
      publish({ status: "initializing", detail: "Retrying sign-in…", user: null });
      await syncSession();
    },
    ready: null,
  };

  api.ready = (async () => {
    const key = typeof publishableKey === "string" ? publishableKey.trim() : "";
    if (!key) {
      publish({ status: "unavailable", detail: publicMessage(), user: null });
      return api;
    }
    try {
      await loadUi(key);
      clerk = clerkFactory(key);
      await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      unsubscribe = clerk.addListener(() => {
        void syncSession();
      });
      await syncSession();
    } catch (error) {
      if (unsubscribe) unsubscribe();
      publish({ status: "unavailable", detail: publicMessage(error), user: null });
    }
    return api;
  })();

  return api;
}

if (typeof window !== "undefined" && typeof window.document !== "undefined") {
  window.DirectoryAuth = createDirectoryAuth({
    publishableKey: window.DIRECTORY_CLERK_PUBLISHABLE_KEY,
    onToken(token) {
      window.ConvexDirectory?.setAuthToken?.(token);
      window.DirectoryAPI?.setIdentityToken?.(token);
    },
    verifyConvexIdentity() {
      const directory = window.ConvexDirectory;
      if (!directory?.enabled || typeof directory.verifySignedIdentity !== "function") {
        return Promise.reject(new Error("Convex directory is unavailable"));
      }
      return directory.verifySignedIdentity();
    },
  });
}
