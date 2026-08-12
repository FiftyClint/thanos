/**
 * Writing an exported training history into the database.
 *
 * Shared by the HTTP route (POST /api/history/import) and the command-line
 * script, so the two cannot drift. The parsing it builds on lives in
 * ./history-csv.ts and is pure.
 */
import { db } from "../db";
import { logger } from "../logger";
import { exercises, workoutLogs, setLogs, type InsertSetLog } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  parseHistoryCsv,
  groupIntoSessions,
  resolveExerciseNames,
  type SeedExercise,
} from "./history-csv";

/** Program id for movements that are no longer in any seeded program. */
export const LEGACY_PROGRAM = "legacy";

export interface ImportOptions {
  userId: string;
  activeProgram: string;
  csv: string;
  /** Parse and count, write nothing. */
  dryRun: boolean;
  /** Overwrite sessions that already exist for the same week and day. */
  replace: boolean;
}

export interface ImportReport {
  dryRun: boolean;
  sessions: number;
  sets: number;
  setsWithWeight: number;
  firstWeek: number | null;
  lastWeek: number | null;
  rowsRepaired: number;
  duplicatesCollapsed: number;
  /** Sessions already present for the same (week, day). */
  clashes: number;
  clashesReplaced: number;
  retiredMovements: string[];
  skipped: Array<{ line: number; reason: string }>;
}

export class ImportConflictError extends Error {
  constructor(public readonly clashes: number) {
    super(
      `${clashes} of these sessions already exist. Re-import with "replace existing" to overwrite them.`,
    );
    this.name = "ImportConflictError";
  }
}

export class ImportEmptyError extends Error {
  constructor(message = "No usable rows in that file.") {
    super(message);
    this.name = "ImportEmptyError";
  }
}

export async function importHistory(options: ImportOptions): Promise<ImportReport> {
  const { userId, activeProgram, csv, dryRun, replace } = options;

  const parsed = parseHistoryCsv(csv);
  if (parsed.rows.length === 0) throw new ImportEmptyError();

  const sessions = groupIntoSessions(parsed.rows);
  const seeded = (await db.select().from(exercises)) as unknown as SeedExercise[];

  const { resolved, unresolved } = resolveExerciseNames(
    parsed.rows.map((r) => ({ name: r.exercise, day: r.day })),
    seeded,
    activeProgram,
  );

  // ── Clashes ───────────────────────────────────────────────────────────────
  const existing = await db.select().from(workoutLogs).where(eq(workoutLogs.userId, userId));
  const sessionKeys = new Set(sessions.map((s) => `${s.week}|${s.day}`));
  const clashing = existing.filter((w) => sessionKeys.has(`${w.week}|${w.day}`));

  if (clashing.length > 0 && !replace && !dryRun) {
    throw new ImportConflictError(clashing.length);
  }

  const report: ImportReport = {
    dryRun,
    sessions: 0,
    sets: 0,
    setsWithWeight: parsed.rows.filter((r) => r.weightLbs !== null).length,
    firstWeek: sessions[0]?.week ?? null,
    lastWeek: sessions[sessions.length - 1]?.week ?? null,
    rowsRepaired: parsed.repaired,
    duplicatesCollapsed: parsed.duplicatesCollapsed,
    clashes: clashing.length,
    clashesReplaced: 0,
    retiredMovements: unresolved,
    skipped: parsed.skipped.map((s) => ({ line: s.line, reason: s.reason })),
  };

  if (dryRun) {
    // Count what a real run would write, without touching anything.
    for (const session of sessions) {
      const usable = session.rows.filter(
        (r) => resolved.has(`${r.exercise}|${r.day}`) || unresolved.includes(r.exercise),
      );
      if (usable.length === 0) continue;
      report.sessions++;
      report.sets += usable.length;
    }
    return report;
  }

  /*
   * Recreate retired movements rather than dropping their sets or attaching
   * them to a similarly-named exercise: "Single-Arm DB Preacher Curl" is a
   * dumbbell per side, "Preacher Curl (EZ or machine)" is a loaded bar, and
   * merging them would seed a confidently wrong starting weight. The legacy
   * program id is outside the set the seeder manages, so `db:seed` leaves
   * these alone.
   */
  const legacyIds = new Map<string, string>();
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
        // Whether rows carry a side is what decides how autofill looks their
        // history up, so it has to match.
        inputType: parsed.rows.some((r) => r.exercise === name && r.side)
          ? "weight_reps_unilateral"
          : "weight_reps",
        isSupersetPart: false,
        supersetGroup: null,
        segment: "working",
        program: LEGACY_PROGRAM,
      })
      .returning();
    legacyIds.set(name, created.id);
  }

  if (clashing.length > 0) {
    logger.warn({ userId, count: clashing.length }, "history import: replacing existing sessions");
    // set_logs cascade from workout_logs.
    await db.delete(workoutLogs).where(inArray(workoutLogs.id, clashing.map((w) => w.id)));
    report.clashesReplaced = clashing.length;
  }

  for (const session of sessions) {
    const rows: Array<Omit<InsertSetLog, "workoutLogId">> = [];

    for (const row of session.rows) {
      const exerciseId = resolved.get(`${row.exercise}|${row.day}`) ?? legacyIds.get(row.exercise);
      if (!exerciseId) continue;
      rows.push({
        exerciseId,
        userId,
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

    const [log] = await db
      .insert(workoutLogs)
      .values({
        userId,
        day: session.day,
        week: session.week,
        phase: session.phase,
        program: activeProgram,
        // Midday UTC, so the date cannot slide either way across a timezone.
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
    report.sessions++;
    report.sets += rows.length;
  }

  logger.info({ userId, ...report }, "history import complete");
  return report;
}
