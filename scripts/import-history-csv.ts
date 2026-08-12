/**
 * Import training history from the app's exported CSV, from a terminal.
 *
 *   npm run import:history -- --file history.csv --email you@example.com --dry-run
 *   npm run import:history -- --file history.csv --email you@example.com
 *
 * The same import the app offers under Export → Import Training History, for
 * when you have a shell and would rather not use the file picker. Both call
 * importHistory() in server/lib/history-import.ts, so they cannot drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../server/logger";
import { db, closeDb } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { importHistory, LEGACY_PROGRAM } from "../server/lib/history-import";

interface Args {
  file: string;
  email: string;
  dryRun: boolean;
  replace: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = value("--file");
  const email = value("--email");
  if (!file || !email) {
    console.error(
      "Usage: npm run import:history -- --file history.csv --email you@example.com [--dry-run] [--replace]",
    );
    process.exit(1);
  }

  return {
    file,
    email: email.toLowerCase(),
    dryRun: argv.includes("--dry-run"),
    replace: argv.includes("--replace"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!fs.existsSync(args.file)) throw new Error(`No such file: ${args.file}`);

  const [user] = await db.select().from(users).where(eq(users.email, args.email));
  if (!user) throw new Error(`No account for ${args.email}. Register in the app first, then re-run.`);

  const report = await importHistory({
    userId: user.id,
    activeProgram: user.activeProgram ?? "phase3",
    csv: fs.readFileSync(args.file, "utf8"),
    dryRun: args.dryRun,
    replace: args.replace,
  });

  console.log(`\n${args.dryRun ? "DRY RUN — nothing was written" : "Import complete"}\n`);
  console.log(`  sessions           ${report.sessions}`);
  console.log(`  sets               ${report.sets}   (${report.setsWithWeight} carry a weight)`);
  console.log(`  weeks              ${report.firstWeek} – ${report.lastWeek}`);
  if (report.rowsRepaired > 0) {
    console.log(`  rows repaired      ${report.rowsRepaired}   (exercise name contained a comma)`);
  }
  if (report.duplicatesCollapsed > 0) {
    console.log(`  duplicates dropped ${report.duplicatesCollapsed}   (session saved twice in the old app)`);
  }
  if (report.clashes > 0) {
    console.log(
      `  already present    ${report.clashes}` +
        (report.clashesReplaced > 0 ? `   (replaced)` : `   (re-run with --replace to overwrite)`),
    );
  }
  if (report.retiredMovements.length > 0) {
    console.log(
      `  retired movements  ${report.retiredMovements.length}   (kept under "${LEGACY_PROGRAM}" so their sets survive):`,
    );
    for (const name of report.retiredMovements) console.log(`                       ${name}`);
  }
  if (report.skipped.length > 0) {
    console.log(`\n  SKIPPED ${report.skipped.length} unreadable lines:`);
    for (const s of report.skipped.slice(0, 20)) console.log(`    line ${s.line}: ${s.reason}`);
    if (report.skipped.length > 20) console.log(`    … and ${report.skipped.length - 20} more`);
  }
  console.log("");
}

const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then(() => closeDb())
    .catch(async (err) => {
      logger.fatal({ err }, "history import failed");
      console.error(`\n${(err as Error).message}\n`);
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
