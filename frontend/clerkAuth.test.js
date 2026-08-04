import { describe, expect, test, vi } from "vitest";
import { createDirectoryAuth } from "./clerkAuth";

function signedInClerk({ token = "signed-convex-jwt", tokenError } = {}) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockReturnValue(() => {}),
    user: { fullName: "Approver" },
    session: {
      getToken: vi.fn().mockImplementation(async (options) => {
        expect(options).toEqual({ template: "convex" });
        if (tokenError) throw tokenError;
        return token;
      }),
    },
  };
}

describe("Directory Clerk auth", () => {
  test("a missing publishable key is visibly unavailable, not silently signed out", async () => {
    const auth = createDirectoryAuth({ publishableKey: "" });
    await auth.ready;
    expect(auth.getState()).toMatchObject({
      status: "unavailable",
      detail: "Clerk is not configured for this deployment.",
    });
  });

  test("a signed session requests the convex template and supplies its token to Convex", async () => {
    const onToken = vi.fn();
    const clerk = signedInClerk();
    const verifyConvexIdentity = vi.fn().mockResolvedValue(undefined);
    const auth = createDirectoryAuth({
      publishableKey: "pk_test_example",
      clerkFactory: vi.fn(() => clerk),
      loadUi: vi.fn().mockResolvedValue(undefined),
      onToken,
      verifyConvexIdentity,
    });
    await auth.ready;
    expect(auth.getState()).toMatchObject({
      status: "signed-in",
      user: { name: "Approver" },
    });
    expect(onToken).toHaveBeenLastCalledWith("signed-convex-jwt");
    expect(verifyConvexIdentity).toHaveBeenCalledOnce();
  });

  test("a token fetch failure remains visibly unavailable instead of becoming a permission-looking read-only state", async () => {
    const onToken = vi.fn();
    const auth = createDirectoryAuth({
      publishableKey: "pk_test_example",
      clerkFactory: () => signedInClerk({ tokenError: new Error("expired") }),
      loadUi: vi.fn().mockResolvedValue(undefined),
      onToken,
    });
    await auth.ready;
    expect(auth.getState()).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("could not obtain a Convex sign-in token"),
    });
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  test("a token Convex refuses is visibly unavailable and clears the client token", async () => {
    const onToken = vi.fn();
    const auth = createDirectoryAuth({
      publishableKey: "pk_test_example",
      clerkFactory: () => signedInClerk(),
      loadUi: vi.fn().mockResolvedValue(undefined),
      onToken,
      verifyConvexIdentity: vi.fn().mockRejectedValue(new Error("401")),
    });
    await auth.ready;
    expect(auth.getState()).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("Convex did not accept it"),
    });
    expect(onToken).toHaveBeenLastCalledWith(null);
  });
});
