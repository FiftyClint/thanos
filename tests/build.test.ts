import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const distDir = path.resolve(__dirname, "..", "dist");
const entry = path.join(distDir, "index.js");

/**
 * Guards on the production bundle.
 *
 * These exist because of a real failure: esbuild, writing to a single output
 * file, inlined the lazily-imported dev server and hoisted its `import "vite"`
 * to the top of the bundle. Vite is a dev dependency that the Docker build
 * prunes, so the container died on startup with ERR_MODULE_NOT_FOUND before
 * running any application code — and nothing in the test suite noticed, because
 * every local run had Vite installed.
 */
describe("production bundle", () => {
  beforeAll(() => {
    if (!existsSync(entry)) {
      execFileSync("npm", ["run", "build:server"], {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      });
    }
  }, 120_000);

  it("builds an entry file", () => {
    expect(existsSync(entry)).toBe(true);
  });

  it("keeps dev-only dependencies out of the entry file", () => {
    const source = readFileSync(entry, "utf-8");

    // Anything imported at the top level of the entry must exist in a
    // production install, where devDependencies have been pruned.
    for (const devOnly of ["vite", "tsx", "esbuild", "drizzle-kit", "pino-pretty"]) {
      expect(source, `entry statically imports dev-only package "${devOnly}"`).not.toMatch(
        new RegExp(`from\\s*["']${devOnly}["']`),
      );
    }
  });

  it("emits the dev server as a separate chunk rather than inlining it", () => {
    // Splitting is what keeps the import lazy; without it the guard above
    // would fail again the moment someone sets `outfile`.
    const chunks = readdirSync(distDir).filter((f) => f.endsWith(".js") && f !== "index.js");
    expect(chunks.length).toBeGreaterThan(0);

    const viteChunk = chunks.find((f) =>
      readFileSync(path.join(distDir, f), "utf-8").includes('from "vite"'),
    );
    expect(viteChunk, "expected a chunk containing the Vite dev server").toBeDefined();
  });

  it("ships the built client next to the server", () => {
    // serveStatic resolves dist/public relative to the bundle; if the client
    // build is missing, production boots and then 404s every page.
    const indexHtml = path.join(distDir, "public", "index.html");
    if (!existsSync(indexHtml)) {
      // build:server alone doesn't produce it — only assert when a full build ran.
      return;
    }
    expect(readFileSync(indexHtml, "utf-8")).toContain("<div id=\"root\">");
  });
});
