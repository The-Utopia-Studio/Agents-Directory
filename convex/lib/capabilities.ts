export type Runner =
  | "native"
  | "api"
  | "foreign-runtime-handoff"
  | "scheduled-worker"
  | "none";

export type InvocationType = "runtime" | "mock" | "http" | "mcp";

const ALLOWED_INVOCATIONS: Record<Runner, readonly InvocationType[]> = {
  native: ["runtime", "mock"],
  api: ["http", "mcp"],
  "foreign-runtime-handoff": [],
  "scheduled-worker": [],
  none: [],
};

export function assertRunnerInvocation(
  runner: Runner,
  invocation: { type: InvocationType } | undefined,
): void {
  const allowed = ALLOWED_INVOCATIONS[runner];
  if (!invocation) return;
  if (!allowed.includes(invocation.type)) {
    throw new Error(
      `Invocation type ${invocation.type} is incompatible with runner ${runner}`,
    );
  }
}

export function assertUsabilityModes(
  runner: Runner,
  modes: string[],
): void {
  if (
    runner === "foreign-runtime-handoff" &&
    !modes.includes("prepared-handoff")
  ) {
    throw new Error(
      "foreign-runtime-handoff requires prepared-handoff usability",
    );
  }
  if (
    (runner === "scheduled-worker" || runner === "none") &&
    modes.includes("hosted-run")
  ) {
    throw new Error(`${runner} cannot offer hosted-run usability`);
  }
}
