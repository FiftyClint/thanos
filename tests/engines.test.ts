import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";

/**
 * Guards the Node version floor.
 *
 * This exists because a dev dependency was added that required a newer Node
 * than CI runs. Locally it worked (Node 22); in CI (Node 20) jsdom's transitive
 * undici blew up with `webidl.util.markAsUncloneable is not a function` — an
 * error that says nothing about the actual cause. npm only WARNS about an
 * engine mismatch, so nothing failed until a module was imported at runtime.
 *
 * This checks the installed tree against the floor declared in package.json,
 * turning that class of failure into a named test rather than a mystery
 * TypeError two pushes later.
 */

const repoRoot = path.resolve(__dirname, "..");

function declaredNodeFloor(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const range: string = pkg.engines?.node ?? ">=20";
  const floor = semver.minVersion(range);
  if (!floor) throw new Error(`Cannot read a minimum Node version from engines.node "${range}"`);
  return floor.version;
}

interface Offender {
  name: string;
  version: string;
  requires: string;
}

/**
 * Optional native binaries are resolved per-platform and skipped when they
 * don't apply, so their engine ranges never gate an install.
 */
function isOptionalNative(name: string): boolean {
  return /^@(napi-rs|esbuild|rollup|swc|img)\//.test(name) || /-(linux|darwin|win32)-/.test(name);
}

function collectOffenders(floor: string): Offender[] {
  const offenders: Offender[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > 2 || !fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const packageDir = path.join(dir, entry);

      // Scoped packages nest one level deeper.
      if (entry.startsWith("@")) {
        walk(packageDir, depth);
        continue;
      }

      const manifest = path.join(packageDir, "package.json");
      if (fs.existsSync(manifest)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
          const required: string | undefined = pkg.engines?.node;
          if (
            required &&
            pkg.name &&
            !isOptionalNative(pkg.name) &&
            !semver.satisfies(floor, required, { includePrerelease: true })
          ) {
            offenders.push({ name: pkg.name, version: pkg.version, requires: required });
          }
        } catch {
          // An unreadable manifest is not this test's problem.
        }
      }

      walk(path.join(packageDir, "node_modules"), depth + 1);
    }
  };

  walk(path.join(repoRoot, "node_modules"), 0);
  return offenders;
}

describe("Node version floor", () => {
  it("declares a floor in package.json", () => {
    const floor = declaredNodeFloor();
    expect(semver.valid(floor)).toBeTruthy();
  });

  it("has no dependency requiring a newer Node than the declared floor", () => {
    const floor = declaredNodeFloor();
    const offenders = collectOffenders(floor);

    const detail = offenders.map((o) => `  ${o.name}@${o.version} requires ${o.requires}`).join("\n");
    expect(
      offenders,
      offenders.length
        ? `These need a newer Node than the declared floor (${floor}).\n` +
            `Either pin them to a compatible version, or raise engines.node AND the CI\n` +
            `node-version together:\n${detail}`
        : "",
    ).toEqual([]);
  });

  it("matches the Node version CI installs with", () => {
    // A floor the CI runner does not satisfy makes every other check here moot.
    const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    const match = workflow.match(/node-version:\s*['"]?(\d+)/);
    expect(match, "could not find node-version in the CI workflow").toBeTruthy();

    const ciMajor = Number(match![1]);
    const floorMajor = semver.major(declaredNodeFloor());
    expect(
      ciMajor,
      `CI runs Node ${ciMajor} but package.json requires >=${declaredNodeFloor()}`,
    ).toBeGreaterThanOrEqual(floorMajor);
  });
});
