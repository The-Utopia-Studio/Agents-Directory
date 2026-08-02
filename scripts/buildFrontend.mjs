import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rawUrl = String(process.env.CONVEX_URL ?? "").trim();
if (rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(
      "CONVEX_URL must be a public HTTPS deployment URL without credentials",
    );
  }
}

await writeFile(
  new URL("../deployment-config.js", import.meta.url),
  `// Generated at deploy/build time from the non-secret CONVEX_URL.\n` +
    `window.DIRECTORY_CONVEX_URL = ${JSON.stringify(rawUrl)};\n`,
  "utf8",
);

await build({
  entryPoints: [
    fileURLToPath(new URL("../frontend/convexDirectory.js", import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL("../convex-directory.bundle.js", import.meta.url),
  ),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
});
