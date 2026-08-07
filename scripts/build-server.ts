/**
 * Bundle the server into dist/index.js.
 *
 * The original package.json pointed `build` at `script/build.ts`, a file that
 * did not exist in the repo — the production build only ever worked inside
 * Replit's own image. This replaces it with a self-contained esbuild step.
 */
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  await rm(path.join(root, "dist", "index.js"), { force: true });

  await build({
    entryPoints: [path.join(root, "server", "index.ts")],
    outfile: path.join(root, "dist", "index.js"),
    platform: "node",
    target: "node20",
    format: "esm",
    bundle: true,
    sourcemap: true,
    minify: false,
    // Keep dependencies external: they are installed in the image, and bundling
    // native bindings (pg) or optional requires (pino transports) breaks them.
    packages: "external",
    // ESM output that some CJS dependencies still expect to find.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'module';",
        "import { fileURLToPath as __fileURLToPath } from 'url';",
        "import { dirname as __dirname_fn } from 'path';",
        "const require = __createRequire(import.meta.url);",
        "const __filename = __fileURLToPath(import.meta.url);",
        "const __dirname = __dirname_fn(__filename);",
      ].join("\n"),
    },
    alias: {
      "@shared": path.join(root, "shared"),
    },
    logLevel: "info",
  });

  console.log("server bundled to dist/index.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
