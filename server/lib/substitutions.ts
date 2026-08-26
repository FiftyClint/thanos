/**
 * Logging a different movement than the one the program prescribed.
 *
 * The machine is taken, the cable station is busy, a joint objects — so you do
 * something else in that slot. The app has to record what was ACTUALLY done, or
 * three things go wrong at once: the weight it suggests for the planned
 * movement is a weight from a different exercise, the substitute never builds
 * a history of its own, and next week there is nothing to tell you what you
 * swapped to.
 *
 * So a substituted set points at the substitute (`exerciseId`) and remembers
 * the slot (`substitutedForExerciseId`). Every existing weight lookup keys on
 * `exerciseId` and therefore stays correct with no change at all.
 */
import { db } from "../db";
import { exercises, setLogs, workoutLogs, type Exercise, type SetLog } from "@shared/schema";
import { eq, and, or, desc, inArray, isNotNull, sql } from "drizzle-orm";

/** Program id holding movements that exist only as substitutes. */
export const ALTERNATE_PROGRAM = "alternate";

/** Names longer than this are almost certainly a paste accident, not an exercise. */
export const MAX_SUBSTITUTE_NAME = 120;

export function normaliseSubstituteName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/**
 * Find or create the exercise row a substitute name refers to.
 *
 * An existing movement is REUSED wherever the name already exists — swapping
 * Day 5's upright row for a Cable Crunch that Day 4 already prescribes should
 * build one Cable Crunch history, not two. The user's own program wins ties so
 * a name appearing in several phases resolves the same way every time.
 *
 * Only when nothing matches is a row created, under a program outside every
 * seed sync so `db:seed` will not remove it.
 */
export async function resolveSubstitute(
  name: string,
  planned: Exercise,
  preferredProgram: string,
): Promise<Exercise> {
  const clean = normaliseSubstituteName(name);

  const matches = await db.select().from(exercises).where(eq(exercises.name, clean));
  if (matches.length > 0) {
    const ordered = [...matches].sort(
      (a, b) =>
        Number(b.program === preferredProgram) - Number(a.program === preferredProgram) ||
        a.program.localeCompare(b.program) ||
        a.day - b.day ||
        a.id.localeCompare(b.id),
    );
    return ordered[0];
  }

  /*
   * exercises is unique on (program, day, order, number). A substitute keeps
   * the day it was performed on, so it needs an order of its own rather than
   * the planned exercise's.
   */
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number | null>`max(${exercises.order})` })
    .from(exercises)
    .where(and(eq(exercises.program, ALTERNATE_PROGRAM), eq(exercises.day, planned.day)));

  const [created] = await db
    .insert(exercises)
    .values({
      day: planned.day,
      order: (maxOrder ?? 0) + 1,
      number: planned.number,
      name: clean,
      // Inherit the slot's prescription: a substitute is doing that slot's job,
      // so its sets, rep range and rest are the ones to work to.
      defaultSets: planned.defaultSets,
      repRange: planned.repRange,
      tempo: planned.tempo,
      rir: planned.rir,
      restSeconds: planned.restSeconds,
      notes: `Logged as a substitute for ${planned.name}.`,
      alternate: "",
      videoUrl: "",
      inputType: planned.inputType,
      isSupersetPart: false,
      supersetGroup: null,
      segment: planned.segment,
      program: ALTERNATE_PROGRAM,
    })
    .returning();

  return created;
}

export interface LastPerformed {
  /** The exercise actually performed in this slot. */
  exerciseId: string;
  name: string;
  /** True when it was not the prescribed movement. */
  wasSubstitute: boolean;
  week: number;
  date: Date;
  sets: Array<Pick<SetLog, "setNumber" | "side" | "weightLbs" | "reps" | "durationSecs">>;
}

/**
 * What was actually done in each of a day's slots, last time.
 *
 * Keyed by PLANNED exercise id, which is the slot. A set counts as belonging to
 * a slot either because it was logged against the planned exercise directly, or
 * because it was logged as a substitute for it — the union is what makes the
 * answer "what did I do here last week" rather than "what did I do on this
 * exercise last week".
 */
export async function getLastPerformedBySlot(
  userId: string,
  plannedExercises: Exercise[],
): Promise<Record<string, LastPerformed>> {
  const plannedIds = plannedExercises.map((e) => e.id);
  if (plannedIds.length === 0) return {};

  const rows = await db
    .select({ set: setLogs, workout: workoutLogs, exercise: exercises })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .innerJoin(exercises, eq(setLogs.exerciseId, exercises.id))
    .where(
      and(
        eq(setLogs.userId, userId),
        eq(workoutLogs.completed, true),
        or(
          inArray(setLogs.exerciseId, plannedIds),
          inArray(setLogs.substitutedForExerciseId, plannedIds),
        ),
      ),
    )
    .orderBy(desc(workoutLogs.date), desc(setLogs.setNumber));

  const bySlot: Record<string, LastPerformed> = {};
  /** The workout each slot's answer came from, so older sessions are ignored. */
  const sourceWorkout = new Map<string, string>();
  const plannedSet = new Set(plannedIds);

  for (const row of rows) {
    // A directly-logged set belongs to its own exercise's slot; a substituted
    // one belongs to the slot it replaced.
    const slotId = row.set.substitutedForExerciseId ?? row.set.exerciseId;
    if (!plannedSet.has(slotId)) continue;

    // Rows arrive newest-first, so the first workout seen for a slot is the
    // most recent; every later one for that slot is older.
    const chosen = sourceWorkout.get(slotId);
    if (chosen && chosen !== row.workout.id) continue;

    if (!chosen) {
      sourceWorkout.set(slotId, row.workout.id);
      bySlot[slotId] = {
        exerciseId: row.exercise.id,
        name: row.exercise.name,
        wasSubstitute: row.set.substitutedForExerciseId !== null,
        week: row.workout.week,
        date: row.workout.date,
        sets: [],
      };
    }

    bySlot[slotId].sets.push({
      setNumber: row.set.setNumber,
      side: row.set.side,
      weightLbs: row.set.weightLbs,
      reps: row.set.reps,
      durationSecs: row.set.durationSecs,
    });
  }

  for (const entry of Object.values(bySlot)) {
    entry.sets.sort((a, b) => a.setNumber - b.setNumber || (a.side ?? "").localeCompare(b.side ?? ""));
  }

  return bySlot;
}

/** Distinct substitutes this user has logged before, newest first — for the picker. */
export async function getRecentSubstitutes(userId: string, limit = 25): Promise<Exercise[]> {
  const rows = await db
    .selectDistinct({ exerciseId: setLogs.exerciseId })
    .from(setLogs)
    .where(and(eq(setLogs.userId, userId), isNotNull(setLogs.substitutedForExerciseId)));

  const ids = rows.map((r) => r.exerciseId).slice(0, limit);
  if (ids.length === 0) return [];
  return db.select().from(exercises).where(inArray(exercises.id, ids));
}
