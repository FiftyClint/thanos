/**
 * One-time import of training history from the old Replit database.
 *
 *   SOURCE_DATABASE_URL=postgres://…  npm run import:replit -- --email you@example.com --dry-run
 *   SOURCE_DATABASE_URL=postgres://…  npm run import:replit -- --email you@example.com
 *
 * Reads the old database, writes into the current one. The source is only ever
 * read from.
 *
 * Three things make this more than an INSERT … SELECT:
 *
 * 1. Exercise ids differ. The new database seeded its own UUIDs, so every
 *    set_log's exercise_id has to be remapped by (program, day, number, name).
 *    Anything that can't be matched is preserved under a "legacy" program
 *    rather than dropped — see resolveExercise below.
 *
 * 2. The old app had no uniqueness constraints, and two of its bugs produced
 *    duplicates that the new schema rejects: a re-submitted workout appended a
 *    second copy of its sets, and a re-submitted check-in inserted a second row
 *    for the same week. Both are collapsed here, and counted in the report.
 *
 * 3. Progress photos are skipped. Their rows would import fine, but the image
 *    files live in Replit's object storage and would 404 forever.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { env } from "../server/env";
import { logger } from "../server/logger";
import { db, closeDb } from "../server/db";
import {
  users,
  exercises,
  workoutLogs,
  setLogs,
  weeklyCheckIns,
  recommendations,
  cardioSessions,
  vacuumSessions,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

/** Program id used for exercises that no longer exist in the seed files. */
const LEGACY_PROGRAM = "legacy";

interface Args {
  email: string;
  dryRun: boolean;
  replace: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const emailIndex = argv.indexOf("--email");
  const email = emailIndex >= 0 ? argv[emailIndex + 1] : undefined;

  if (!email) {
    console.error(
      "Usage: SOURCE_DATABASE_URL=… npm run import:replit -- --email you@example.com [--dry-run] [--replace]",
    );
    process.exit(1);
  }

  return { email, dryRun: argv.includes("--dry-run"), replace: argv.includes("--replace") };
}

interface Report {
  exercisesMatched: number;
  exercisesLegacy: number;
  workouts: number;
  sets: number;
  duplicateSetsCollapsed: number;
  checkIns: number;
  duplicateCheckInsCollapsed: number;
  cardio: number;
  vacuum: number;
  recommendations: number;
  photosSkipped: number;
}

type Row = Record<string, unknown>;

/**
 * Open the source database, working out TLS rather than asking.
 *
 * Replit's Postgres (Neon) requires SSL; a database on your own machine
 * usually refuses it. Guessing wrong produces an error that reads like a
 * credentials problem, so try the common case and fall back once.
 */
async function connectToSource(connectionString: string): Promise<Pool> {
  const withSsl = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await withSsl.query("select 1");
    return withSsl;
  } catch (error) {
    await withSsl.end().catch(() => undefined);
    if (!/does not support SSL/i.test((error as Error).message)) throw error;

    const plain = new Pool({ connectionString });
    await plain.query("select 1");
    logger.info("source database does not use SSL — connected without it");
    return plain;
  }
}

function exerciseKey(e: Row): string {
  return `${e.program}|${e.day}|${e.number}|${e.name}`;
}

export interface ExerciseMapping {
  /** old exercise id → new exercise id */
  matched: Map<string, string>;
  /** Old exercises with no counterpart, to be recreated under the legacy program. */
  unmatched: Row[];
}

/**
 * Work out which new exercise row each old one corresponds to.
 *
 * Exercise ids are per-database UUIDs, so nothing carries over by id; every
 * imported set has to be re-pointed by identity. Matching runs from strictest
 * to loosest and stops at the first hit:
 *
 *   1. program + day + number + name — the same slot in the same program
 *   2. program + day + name         — the movement was renumbered
 *   3. name within the same program — it moved to a different day
 *   4. name anywhere                — it exists only in another phase
 *
 * Steps 3 and 4 are deliberately separate. The old code had a single
 * name-keyed map built over every program at once, so a name appearing in more
 * than one phase resolved to whichever row Postgres happened to return last —
 * an unordered select, meaning the same import could map the same exercise
 * differently on two runs. Preferring the exercise's own program first makes
 * it deterministic and puts the history where it belongs.
 *
 * Anything still unmatched is returned rather than dropped: a movement that
 * was renamed or retired must not take months of logged sets with it.
 */
export function buildExerciseMap(sourceExercises: Row[], targetExercises: Row[]): ExerciseMapping {
  const byFullKey = new Map<string, string>();
  const byProgramDayName = new Map<string, string>();
  const byProgramName = new Map<string, string>();
  const byName = new Map<string, string>();

  // First write wins, over a stably sorted list, so a duplicate name resolves
  // to the same row on every run.
  const ordered = [...targetExercises].sort((a, b) =>
    exerciseKey(a).localeCompare(exerciseKey(b)),
  );
  const remember = (map: Map<string, string>, key: string, id: string) => {
    if (!map.has(key)) map.set(key, id);
  };

  for (const e of ordered) {
    const id = e.id as string;
    remember(byFullKey, exerciseKey(e), id);
    remember(byProgramDayName, `${e.program}|${e.day}|${e.name}`, id);
    remember(byProgramName, `${e.program}|${e.name}`, id);
    remember(byName, e.name as string, id);
  }

  const matched = new Map<string, string>();
  const unmatched: Row[] = [];

  for (const old of sourceExercises) {
    const hit =
      byFullKey.get(exerciseKey(old)) ??
      byProgramDayName.get(`${old.program}|${old.day}|${old.name}`) ??
      byProgramName.get(`${old.program}|${old.name}`) ??
      byName.get(old.name as string);

    if (hit) matched.set(old.id as string, hit);
    else unmatched.push(old);
  }

  return { matched, unmatched };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error("SOURCE_DATABASE_URL is not set — that's the OLD Replit database.");
    process.exit(1);
  }
  if (sourceUrl === env.DATABASE_URL) {
    console.error("SOURCE_DATABASE_URL and DATABASE_URL are the same database. Refusing to run.");
    process.exit(1);
  }

  const source = await connectToSource(sourceUrl);
  const report: Report = {
    exercisesMatched: 0,
    exercisesLegacy: 0,
    workouts: 0,
    sets: 0,
    duplicateSetsCollapsed: 0,
    checkIns: 0,
    duplicateCheckInsCollapsed: 0,
    cardio: 0,
    vacuum: 0,
    recommendations: 0,
    photosSkipped: 0,
  };

  try {
    // ── Locate the athlete in both databases ────────────────────────────────
    const { rows: sourceUsers } = await source.query(
      "select * from users where lower(email) = lower($1) limit 1",
      [args.email],
    );
    if (sourceUsers.length === 0) {
      const { rows: all } = await source.query("select email from users");
      throw new Error(
        `No user with email "${args.email}" in the old database. It has: ${all.map((u) => u.email).join(", ") || "(none)"}`,
      );
    }
    const sourceUser = sourceUsers[0];

    let [targetUser] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${args.email})`)
      .limit(1);

    if (!targetUser) {
      // Carry the old password hash across, so the Replit password still works.
      logger.info({ email: args.email }, "no matching account here — recreating it from the old database");
      if (!args.dryRun) {
        [targetUser] = await db
          .insert(users)
          .values({
            email: sourceUser.email,
            name: sourceUser.name,
            passwordHash: sourceUser.password_hash,
            role: sourceUser.role ?? "athlete",
            activeProgram: sourceUser.active_program ?? "phase3",
            age: sourceUser.age,
            heightInches: sourceUser.height_inches,
            showDate: sourceUser.show_date,
            prepStartDate: sourceUser.prep_start_date,
            competitionName: sourceUser.competition_name,
            division: sourceUser.division,
          })
          .returning();
      }
    }

    /*
     * On a dry run against an account that doesn't exist yet there is no id to
     * reference. Use a placeholder: nothing is written, and every insert below
     * is skipped, but the counting still has to run to produce the report.
     */
    const targetUserId = targetUser?.id ?? "(would be created)";

    // Refuse to merge into an account that already has history, unless told to.
    if (targetUser) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workoutLogs)
        .where(eq(workoutLogs.userId, targetUser.id));


      if (count > 0 && !args.replace && !args.dryRun) {
        throw new Error(
          `That account already has ${count} workout(s). Importing on top would interleave two histories. ` +
            `Re-run with --replace to delete the existing ones first, or --dry-run to preview.`,
        );
      }
      if (count > 0 && args.replace && !args.dryRun) {
        logger.warn({ count }, "--replace: deleting existing workouts before import");
        await db.delete(workoutLogs).where(eq(workoutLogs.userId, targetUser.id));
        await db.delete(weeklyCheckIns).where(eq(weeklyCheckIns.userId, targetUser.id));
        await db.delete(cardioSessions).where(eq(cardioSessions.userId, targetUser.id));
        await db.delete(vacuumSessions).where(eq(vacuumSessions.userId, targetUser.id));
        await db.delete(recommendations).where(eq(recommendations.userId, targetUser.id));
      }
    }

    // ── Map old exercise ids onto new ones ──────────────────────────────────
    const { rows: sourceExercises } = await source.query("select * from exercises");
    const targetExercises = await db.select().from(exercises);

    /*
     * The legacy program id is outside the set the seeder manages, so a future
     * `npm run db:seed` will leave any rows created below alone.
     */
    const { matched: exerciseIdMap, unmatched: legacyToCreate } = buildExerciseMap(
      sourceExercises,
      targetExercises as unknown as Row[],
    );
    report.exercisesMatched = exerciseIdMap.size;
    report.exercisesLegacy = legacyToCreate.length;

    if (legacyToCreate.length > 0 && args.dryRun) {
      /*
       * A dry run creates nothing, but it must still COUNT what a real run
       * would import. Without a placeholder mapping, every set logged against
       * a retired exercise looks unmappable and the preview under-reports the
       * total — telling you data will be lost when in fact it survives.
       */
      for (const old of legacyToCreate) {
        exerciseIdMap.set(old.id as string, `(legacy: ${old.name})`);
      }
    }

    if (legacyToCreate.length > 0 && !args.dryRun) {
      for (const old of legacyToCreate) {
        const [created] = await db
          .insert(exercises)
          .values({
            day: old.day as number,
            order: old.order as number,
            number: old.number as string,
            name: old.name as string,
            defaultSets: (old.default_sets as number) ?? 1,
            repRange: (old.rep_range as string) ?? "",
            tempo: (old.tempo as string) ?? "",
            rir: (old.rir as string) ?? "",
            restSeconds: (old.rest_seconds as string) ?? "",
            notes: (old.notes as string) ?? "",
            alternate: (old.alternate as string) ?? "",
            videoUrl: (old.video_url as string) ?? "",
            inputType: (old.input_type as string) ?? "weight_reps",
            isSupersetPart: (old.is_superset_part as boolean) ?? false,
            supersetGroup: old.superset_group as string | null,
            segment: (old.segment as string) ?? "working",
            program: LEGACY_PROGRAM,
          })
          .returning();
        exerciseIdMap.set(old.id as string, created.id);
      }
    }

    // ── Workouts and their sets ─────────────────────────────────────────────
    const { rows: sourceWorkouts } = await source.query(
      "select * from workout_logs where user_id = $1 order by date asc",
      [sourceUser.id],
    );

    // The new schema allows one workout per (user, day, week). The old one had
    // no such constraint; keep the most recent if it ever produced two.
    const workoutByDayWeek = new Map<string, Row>();
    for (const w of sourceWorkouts) {
      const key = `${w.day}|${w.week}`;
      const existing = workoutByDayWeek.get(key);
      if (!existing || new Date(w.date as string) >= new Date(existing.date as string)) {
        workoutByDayWeek.set(key, w);
      }
    }

    const { rows: sourceSets } = await source.query("select * from set_logs where user_id = $1", [
      sourceUser.id,
    ]);
    const setsByWorkout = new Map<string, Row[]>();
    for (const s of sourceSets) {
      const list = setsByWorkout.get(s.workout_log_id as string);
      if (list) list.push(s);
      else setsByWorkout.set(s.workout_log_id as string, [s]);
    }

    for (const old of workoutByDayWeek.values()) {
      report.workouts++;

      let newWorkoutId = "(dry-run)";
      if (!args.dryRun) {
        const [created] = await db
          .insert(workoutLogs)
          .values({
            userId: targetUserId,
            day: old.day as number,
            date: new Date(old.date as string),
            week: old.week as number,
            phase: (old.phase as string) ?? "",
            program: (old.program as string) ?? "phase3",
            duration: old.duration as number | null,
            notes: (old.notes as string) ?? "",
            completed: (old.completed as boolean) ?? true,
          })
          .returning();
        newWorkoutId = created.id;
      }

      // Collapse the duplicate sets the old re-submit bug produced: identical
      // (exercise, set number, side) within one workout. Keep the newest.
      const seen = new Map<string, Row>();
      for (const s of setsByWorkout.get(old.id as string) ?? []) {
        const key = `${s.exercise_id}|${s.set_number}|${s.side ?? ""}`;
        const existing = seen.get(key);
        if (existing) {
          report.duplicateSetsCollapsed++;
          const newer =
            new Date((s.created_at as string) ?? 0) >= new Date((existing.created_at as string) ?? 0);
          if (!newer) continue;
        }
        seen.set(key, s);
      }

      const rows = [];
      for (const s of seen.values()) {
        const exerciseId = exerciseIdMap.get(s.exercise_id as string);
        if (!exerciseId) continue; // unreachable: every source exercise is mapped above
        rows.push({
          workoutLogId: newWorkoutId,
          exerciseId,
          userId: targetUserId,
          setNumber: s.set_number as number,
          weightLbs: s.weight_lbs as number | null,
          reps: s.reps as number | null,
          side: s.side as string | null,
          durationSecs: s.duration_secs as number | null,
          rirActual: s.rir_actual as number | null,
          isFailure: (s.is_failure as boolean) ?? false,
          bandNote: s.band_note as string | null,
          cardioNotes: s.cardio_notes as string | null,
          recommendedWeight: s.recommended_weight as number | null,
          userOverride: (s.user_override as boolean) ?? false,
        });
      }
      report.sets += rows.length;
      if (!args.dryRun && rows.length > 0) {
        await db.insert(setLogs).values(rows);
      }
    }

    // ── Check-ins ───────────────────────────────────────────────────────────
    const { rows: sourceCheckIns } = await source.query(
      "select * from weekly_check_ins where user_id = $1 order by date asc",
      [sourceUser.id],
    );

    // One per week now. The old app inserted a new row on every submission.
    const checkInByWeek = new Map<number, Row>();
    for (const c of sourceCheckIns) {
      const week = c.week as number;
      if (checkInByWeek.has(week)) report.duplicateCheckInsCollapsed++;
      const existing = checkInByWeek.get(week);
      if (!existing || new Date(c.date as string) >= new Date(existing.date as string)) {
        checkInByWeek.set(week, c);
      }
    }

    for (const c of checkInByWeek.values()) {
      report.checkIns++;
      if (args.dryRun) continue;
      await db.insert(weeklyCheckIns).values({
        userId: targetUserId,
        week: c.week as number,
        date: new Date(c.date as string),
        phase: (c.phase as string) ?? "",
        weightLbs: c.weight_lbs as number | null,
        waistRelaxed: c.waist_relaxed as number | null,
        waistVacuum: c.waist_vacuum as number | null,
        chest: c.chest as number | null,
        armsLeft: c.arms_left as number | null,
        armsRight: c.arms_right as number | null,
        shoulders: c.shoulders as number | null,
        thighsLeft: c.thighs_left as number | null,
        thighsRight: c.thighs_right as number | null,
        calvesLeft: c.calves_left as number | null,
        calvesRight: c.calves_right as number | null,
        shoulderToWaist: c.shoulder_to_waist as number | null,
        sleepQuality: c.sleep_quality as number | null,
        energyLevels: c.energy_levels as number | null,
        trainingMotivation: c.training_motivation as number | null,
        hungerAppetite: c.hunger_appetite as number | null,
        mood: c.mood as number | null,
        notes: (c.notes as string) ?? "",
        triggersJson: (c.triggers_json as string) ?? "[]",
      });
    }

    // ── Cardio, vacuum, recommendations ─────────────────────────────────────
    const { rows: sourceCardio } = await source.query("select * from cardio_sessions where user_id = $1", [
      sourceUser.id,
    ]);
    for (const s of sourceCardio) {
      report.cardio++;
      if (args.dryRun) continue;
      await db.insert(cardioSessions).values({
        userId: targetUserId,
        date: new Date(s.date as string),
        week: s.week as number,
        type: s.type as string,
        subtype: s.subtype as string | null,
        durationMin: s.duration_min as number,
        notes: (s.notes as string) ?? "",
      });
    }

    const { rows: sourceVacuum } = await source.query("select * from vacuum_sessions where user_id = $1", [
      sourceUser.id,
    ]);
    for (const s of sourceVacuum) {
      report.vacuum++;
      if (args.dryRun) continue;
      await db.insert(vacuumSessions).values({
        userId: targetUserId,
        date: new Date(s.date as string),
        week: s.week as number,
        timeOfDay: s.time_of_day as string,
        sets: s.sets as number,
        durationSec: s.duration_sec as number,
        notes: (s.notes as string) ?? "",
      });
    }

    const { rows: sourceRecs } = await source.query("select * from recommendations where user_id = $1", [
      sourceUser.id,
    ]);
    for (const r of sourceRecs) {
      report.recommendations++;
      if (args.dryRun) continue;
      await db.insert(recommendations).values({
        userId: targetUserId,
        exerciseId: exerciseIdMap.get(r.exercise_id as string) ?? null,
        type: r.type as string,
        message: r.message as string,
        details: (r.details as string) ?? "",
        week: r.week as number,
        status: (r.status as string) ?? "pending",
      });
    }

    const { rows: photoCount } = await source.query(
      "select count(*)::int as n from progress_photos where user_id = $1",
      [sourceUser.id],
    );
    report.photosSkipped = photoCount[0]?.n ?? 0;

    // ── Report ──────────────────────────────────────────────────────────────
    const heading = args.dryRun ? "DRY RUN — nothing was written" : "Import complete";
    console.log(`\n${heading}\n${"─".repeat(heading.length)}`);
    console.log(`  account            ${args.email} (${targetUserId})`);
    console.log(`  workouts           ${report.workouts}`);
    console.log(`  sets               ${report.sets}`);
    console.log(`  check-ins          ${report.checkIns}`);
    console.log(`  cardio sessions    ${report.cardio}`);
    console.log(`  vacuum sessions    ${report.vacuum}`);
    console.log(`  recommendations    ${report.recommendations}`);
    console.log(`  exercises matched  ${report.exercisesMatched}`);

    if (report.exercisesLegacy > 0) {
      console.log(
        `  exercises legacy   ${report.exercisesLegacy}  (no longer in the program — kept under "${LEGACY_PROGRAM}" so their sets survive)`,
      );
    }
    if (report.duplicateSetsCollapsed > 0) {
      console.log(
        `  duplicate sets     ${report.duplicateSetsCollapsed} collapsed  (from the old re-submit bug)`,
      );
    }
    if (report.duplicateCheckInsCollapsed > 0) {
      console.log(
        `  duplicate check-ins ${report.duplicateCheckInsCollapsed} collapsed  (kept the latest for each week)`,
      );
    }
    if (report.photosSkipped > 0) {
      console.log(
        `  photos skipped     ${report.photosSkipped}  (files are in Replit's object storage, not the database)`,
      );
    }
    console.log("");
  } finally {
    await source.end();
    await closeDb();
  }
}

/*
 * Only run when invoked as a script. Without this guard, importing anything
 * from this file — as the tests do — would connect to both databases and start
 * a live import as a side effect of the import statement.
 */
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch(async (err) => {
    logger.fatal({ err }, "import failed");
    console.error(`\n${(err as Error).message}\n`);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
}
