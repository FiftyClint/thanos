/**
 * Import training history from the app's exported CSV.
 *
 *   npm run import:history -- --file history.csv --email you@example.com --dry-run
 *   npm run import:history -- --file history.csv --email you@example.com
 *
 * The alternative to import-from-replit.ts: same destination, but reading an
 * export rather than connecting to the old database. Use this when you have the
 * CSV and not the connection string.
 *
 * What it has to deal with:
 *
 * 1. The export is unquoted, so exercise names containing a comma shift every
 *    later field one place right. See scripts/lib/history-csv.ts — the repair
 *    is exact, not a guess, because the column count is fixed.
 *
 * 2. Exercise ids are per-database, so every row is re-pointed by name.
 *    Movements that no longer exist in any seeded program are recreated under
 *    a "legacy" program rather than dropped or guessed at.
 *
 * 3. The old app appended a second copy of a re-saved session's sets. Those
 *    duplicates are collapsed and counted.
 *
 * Sessions are written as completed workouts, which is what makes their sets
 * visible to autofill: getLastSessionSets requires completed = true.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../server/logger";
import { db, closeDb } from "../server/db";
import { users, exercises, workoutLogs, setLogs, type InsertSetLog } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  parseHistoryCsv,
  groupIntoSessions,
  resolveExerciseNames,
  type SeedExercise,
} from "./lib/history-csv";

/** Program id for movements that are no longer in any seeded program. */
const LEGACY_PROGRAM = "legacy";

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

  return { file, email: email.toLowerCase(), dryRun: argv.includes("--dry-run"), replace: argv.includes("--replace") };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!fs.existsSync(args.file)) {
    throw new Error(`No such file: ${args.file}`);
  }

  const parsed = parseHistoryCsv(fs.readFileSync(args.file, "utf8"));
  if (parsed.rows.length === 0) {
    throw new Error("No usable rows in that file.");
  }

  const [user] = await db.select().from(users).where(eq(users.email, args.email));
  if (!user) {
    throw new Error(`No account for ${args.email}. Register in the app first, then re-run.`);
  }

  const seeded = (await db.select().from(exercises)) as unknown as SeedExercise[];
  const sessions = groupIntoSessions(parsed.rows);

  const { resolved, unresolved } = resolveExerciseNames(
    parsed.rows.map((r) => ({ name: r.exercise, day: r.day })),
    seeded,
    user.activeProgram ?? "phase3",
  );

  /*
   * Recreate retired movements rather than dropping their sets or attaching
   * them to a similarly-named exercise. The legacy program id is outside the
   * set the seeder manages, so `npm run db:seed` will leave these alone.
   */
  const legacyIds = new Map<string, string>();
  if (unresolved.length > 0 && !args.dryRun) {
    for (const name of unresolved) {
      const sample = parsed.rows.find((r) => r.exercise === name)!;
      const [created] = await db
        .insert(exercises)
        .values({
          day: sample.day,
          order: 999,
          number: sample.exerciseNumber || "?",
          name,
          defaultSets: 1,
          repRange: "",
          tempo: "",
          rir: "",
          restSeconds: "",
          notes: "Imported from training history; no longer in the program.",
          alternate: "",
          videoUrl: "",
          // Unilateral rows carry a side, which is what decides how autofill
          // looks their history up.
          inputType: parsed.rows.some((r) => r.exercise === name && r.side) ? "weight_reps_unilateral" : "weight_reps",
          isSupersetPart: false,
          supersetGroup: null,
          segment: "working",
          program: LEGACY_PROGRAM,
        })
        .returning();
      legacyIds.set(name, created.id);
    }
  }

  const idFor = (name: string, day: number): string | undefined =>
    resolved.get(`${name}|${day}`) ?? legacyIds.get(name);

  // ── Existing data ─────────────────────────────────────────────────────────
  const existing = await db.select().from(workoutLogs).where(eq(workoutLogs.userId, user.id));
  const existingKeys = new Set(existing.map((w) => `${w.week}|${w.day}`));

  if (existing.length > 0 && !args.replace && !args.dryRun) {
    const clashes = sessions.filter((s) => existingKeys.has(`${s.week}|${s.day}`)).length;
    if (clashes > 0) {
      throw new Error(
        `${clashes} of these sessions already exist for ${args.email}.\n` +
          `Re-run with --replace to overwrite them, or --dry-run to preview.`,
      );
    }
  }

  if (args.replace && !args.dryRun) {
    const doomed = existing.filter((w) => existingKeys.has(`${w.week}|${w.day}`)).map((w) => w.id);
    if (doomed.length > 0) {
      logger.warn({ count: doomed.length }, "--replace: deleting existing sessions that clash");
      // set_logs cascade on workout_logs delete.
      await db.delete(workoutLogs).where(inArray(workoutLogs.id, doomed));
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  let sessionsWritten = 0;
  let setsWritten = 0;
  let setsUnmapped = 0;

  for (const session of sessions) {
    const rows: Array<Omit<InsertSetLog, "workoutLogId">> = [];

    for (const row of session.rows) {
      const exerciseId = idFor(row.exercise, row.day);
      if (!exerciseId) {
        setsUnmapped++;
        continue;
      }
      rows.push({
        exerciseId,
        userId: user.id,
        setNumber: row.setNumber,
        weightLbs: row.weightLbs,
        reps: row.reps,
        side: row.side,
        durationSecs: row.durationSecs,
        rirActual: row.rirActual,
        isFailure: false,
        bandNote: row.bandNote,
        cardioNotes: null,
      });
    }

    if (rows.length === 0) continue;
    sessionsWritten++;
    setsWritten += rows.length;
    if (args.dryRun) continue;

    const [log] = await db
      .insert(workoutLogs)
      .values({
        userId: user.id,
        day: session.day,
        week: session.week,
        phase: session.phase,
        program: user.activeProgram ?? "phase3",
        date: new Date(`${session.date}T12:00:00Z`),
        duration: null,
        notes: "Imported from training history export.",
        // Autofill only reads completed sessions; an import that left this
        // false would load the data and change nothing the athlete can see.
        completed: true,
        jointStatus: null,
        jointAreas: [],
        warmupFeel: null,
        pumpQuality: null,
        sessionDread: null,
      })
      .returning();

    await db.insert(setLogs).values(rows.map((r) => ({ ...r, workoutLogId: log.id })));
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const weighted = parsed.rows.filter((r) => r.weightLbs !== null).length;
  const heading = args.dryRun ? "DRY RUN — nothing was written" : "Import complete";
  console.log(`\n${heading}\n`);
  console.log(`  sessions           ${sessionsWritten}`);
  console.log(`  sets               ${setsWritten}   (${weighted} carry a weight)`);
  console.log(`  weeks              ${sessions[0]?.week} – ${sessions[sessions.length - 1]?.week}`);
  if (parsed.repaired > 0) {
    console.log(`  rows repaired      ${parsed.repaired}   (exercise name contained a comma)`);
  }
  if (parsed.duplicatesCollapsed > 0) {
    console.log(`  duplicates dropped ${parsed.duplicatesCollapsed}   (session saved twice in the old app)`);
  }
  if (unresolved.length > 0) {
    console.log(
      `  retired movements  ${unresolved.length}   (kept under "${LEGACY_PROGRAM}" so their sets survive):`,
    );
    for (const name of unresolved) console.log(`                       ${name}`);
  }
  if (setsUnmapped > 0) console.log(`  sets unmapped      ${setsUnmapped}`);
  if (parsed.skipped.length > 0) {
    console.log(`\n  SKIPPED ${parsed.skipped.length} unreadable lines:`);
    for (const s of parsed.skipped.slice(0, 20)) console.log(`    line ${s.line}: ${s.reason}`);
    if (parsed.skipped.length > 20) console.log(`    … and ${parsed.skipped.length - 20} more`);
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
