// Persistence for the file store. On Railway the container filesystem is
// ephemeral: every deploy wipes whatever lived under the image. Evidence
// (traces, feedback, scores, loop history) only accumulates if DATA_DIR points
// at a mounted volume — and the process must refuse to start when it does not,
// otherwise we silently write to disk that vanishes and the improvement loop
// looks like it has no memory.
import { access, constants, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAILWAY_VOLUME_MOUNT = "/data";

/** Railway injects these on every service. Present ⇒ volume required. */
export function isRailwayEnvironment(env = process.env) {
  return Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_SERVICE_ID);
}

/**
 * Resolve the store path. On Railway, DATA_DIR must be exactly the documented
 * volume mount (`/data`). Application code cannot prove a path is a volume,
 * but it can refuse an arbitrary ephemeral directory (`/tmp`, image-local
 * `server/data/`, …) that would look like persistence while wiping evidence
 * on every deploy.
 */
export function resolveDataDir(env = process.env) {
  const configured = typeof env.DATA_DIR === "string" ? env.DATA_DIR.trim() : "";
  if (isRailwayEnvironment(env)) {
    if (!configured) {
      throw new Error(
        "DATA_DIR must be set to the Railway volume mount path " +
          `(expected ${RAILWAY_VOLUME_MOUNT}). Refusing to start with ` +
          "ephemeral container storage — traces, feedback, and loop history " +
          "would be wiped on every deploy.",
      );
    }
    if (configured !== RAILWAY_VOLUME_MOUNT) {
      throw new Error(
        `DATA_DIR must be ${RAILWAY_VOLUME_MOUNT} on Railway (got ${configured}). ` +
          "Attach a Volume mounted at that path. Refusing an arbitrary directory " +
          "that may be ephemeral container storage.",
      );
    }
    return RAILWAY_VOLUME_MOUNT;
  }
  if (configured) return configured;
  return fileURLToPath(new URL("../../data/", import.meta.url));
}

/**
 * Verify the store directory before anything writes to it.
 *
 * When requireExisting is true (Railway), the path must already be present —
 * that is what a volume mount provides. Creating it with mkdir would succeed
 * on ephemeral disk and hide a missing volume, so we never create the root
 * in that mode. An empty mounted volume is fine: the directory exists, seed
 * then writes the first records into it.
 */
export async function assertDataDirReady(dataDir, { requireExisting = false } = {}) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("DATA_DIR is empty — cannot open the file store");
  }

  let info;
  try {
    info = await stat(dataDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      if (requireExisting) {
        throw new Error(
          `DATA_DIR ${dataDir} is missing or not mounted. Attach a Railway ` +
            `Volume at ${dataDir} (or set DATA_DIR to the volume mount path) ` +
            `and redeploy. Refusing to create it on ephemeral container storage.`,
        );
      }
      await mkdir(dataDir, { recursive: true });
      info = await stat(dataDir);
    } else {
      throw error;
    }
  }

  if (!info.isDirectory()) {
    throw new Error(`DATA_DIR ${dataDir} exists but is not a directory`);
  }

  try {
    await access(dataDir, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error(
      `DATA_DIR ${dataDir} is not writable. Check the Railway volume mount ` +
        `and the process user, then redeploy.`,
    );
  }

  // Prove a write survives far enough to matter. A directory that reports
  // writable but rejects create is the same class of silent failure.
  const probe = join(dataDir, `.data-dir-probe-${process.pid}`);
  try {
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
  } catch (error) {
    throw new Error(
      `DATA_DIR ${dataDir} rejected a write probe (${error.message}). ` +
        `Refusing to start — evidence would not persist.`,
    );
  }

  return dataDir;
}
