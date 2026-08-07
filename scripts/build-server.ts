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
    outdir: path.join(root, "dist"),
    entryNames: "index",
    platform: "node",
    target: "node20",
    format: "esm",
    bundle: true,
    sourcemap: true,
    minify: false,
    /*
     * Code splitting is required here, not a nicety.
     *
     * server/index.ts reaches the Vite dev server through `await import()`, and
     * with a single output file esbuild inlines that module and HOISTS its
     * `import ... from "vite"` to the top of the bundle. Vite is a dev
     * dependency that `npm prune --omit=dev` removes from the production image,
     * so the container would die on startup with ERR_MODULE_NOT_FOUND before
     * running a line of application code — in production, where it is never
     * even meant to load the dev server.
     *
     * Splitting emits the dev-server branch as its own chunk that is only
     * fetched if that code path actually runs. tests/build.test.ts asserts the
     * entry file stays free of Vite.
     */
    splitting: true,
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
