// Local-only Phase 2.5A manifest builder.
//
// Usage:
//   node server/src/scripts/buildMigrationManifest.js \
//     /path/to/phase2-export.json \
//     migration-output/phase2.5a-import-manifest.json
//
// The input is read once and never modified. Output is restricted to the
// repository's gitignored migration-output directory.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalImportManifest } from "../migration/manifest.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const outputRoot = resolve(repoRoot, "migration-output");

function assertLocalOutputPath(outputPath) {
  const resolved = resolve(outputPath);
  const withinRoot = relative(outputRoot, resolved);
  if (
    !withinRoot ||
    withinRoot.startsWith("..") ||
    withinRoot.includes(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(
      `Manifest output must be a file inside ${outputRoot}`,
    );
  }
  return resolved;
}

export async function writeDryRunManifest({
  inputPath,
  outputPath,
  generatedAt,
}) {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = assertLocalOutputPath(outputPath);
  if (resolvedInput === resolvedOutput) {
    throw new Error("Input export and output manifest must be different files");
  }

  const sourceBytes = await readFile(resolvedInput);
  const sourceData = JSON.parse(sourceBytes.toString("utf8"));
  const manifest = buildCanonicalImportManifest(sourceData, {
    generatedAt,
    sourceFilename: basename(resolvedInput),
    sourceFileSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  });

  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(
    resolvedOutput,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { outputPath: resolvedOutput, manifest };
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: node server/src/scripts/buildMigrationManifest.js <phase2-export.json> <migration-output/manifest.json>",
    );
  }
  const result = await writeDryRunManifest({ inputPath, outputPath });
  console.log(
    `Wrote dry-run manifest: ${result.outputPath}\n` +
      `Records: ${result.manifest.summary.totalRecords}; ` +
      `human decisions: ${result.manifest.summary.unresolvedHumanDecisions}; ` +
      `executable: ${result.manifest.executable}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
