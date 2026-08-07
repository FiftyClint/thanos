import { db } from "../db";
import { setLogs, exercises, workoutLogs, recommendations } from "@shared/schema";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  getIncrementForExercise,
  parseRepRangeMax,
  parseRepRangeMin,
  isDeloadWeek,
  isUnloadedInputType,
} from "./program";

export type WeightSource =
  | "accepted_recommendation"
  | "pending_recommendation"
  | "last_session"
  | "auto_reduce"
  | "no_history"
  | "deload";

export interface WeightRecommendation {
  weight: number | null;
  reps: number | null;
  source: WeightSource;
  reason?: string;
  lastSessionDate?: Date;
}

export interface SetRecommendation extends WeightRecommendation {
  setNumber: number;
  side?: string;
}

async function getAcceptedWeight(userId: string, exerciseId: string): Promise<number | null> {
  const accepted = await db
    .select()
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.exerciseId, exerciseId),
        eq(recommendations.status, "accepted"),
        eq(recommendations.type, "weight_increase"),
      ),
    )
    .orderBy(desc(recommendations.createdAt))
    .limit(1);

  if (accepted.length > 0 && accepted[0].details) {
    try {
      const details = JSON.parse(accepted[0].details);
      return typeof details.newWeight === "number" ? details.newWeight : null;
    } catch {
      return null;
    }
  }
  return null;
}

function sideCondition(side: string | null) {
  return side ? eq(setLogs.side, side) : isNull(setLogs.side);
}

/** Sets from the most recent completed session of this exercise. */
async function getLastSessionSets(userId: string, exerciseId: string, side: string | null) {
  const rows = await db
    .select({ setLog: setLogs, workoutLog: workoutLogs })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(
      and(
        eq(setLogs.userId, userId),
        eq(setLogs.exerciseId, exerciseId),
        sideCondition(side),
        eq(workoutLogs.completed, true),
      ),
    )
    .orderBy(desc(workoutLogs.date), desc(setLogs.setNumber))
    .limit(30);

  if (rows.length === 0) return { sets: [], date: null };

  const lastWorkoutId = rows[0].workoutLog.id;
  return {
    sets: rows.filter((r) => r.workoutLog.id === lastWorkoutId).map((r) => r.setLog),
    date: rows[0].workoutLog.date,
  };
}

/**
 * Fallback lookup by exercise NAME rather than id.
 *
 * Switching programs (phase1 → phase3) gives the same movement a new exercise
 * row, so history keyed by id disappears. Matching on name carries the working
 * weight across the switch.
 */
async function getLastSessionSetsByName(userId: string, exerciseName: string, side: string | null) {
  const matching = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.name, exerciseName));
  if (matching.length === 0) return { sets: [], date: null };

  const rows = await db
    .select({ setLog: setLogs, workoutLog: workoutLogs })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(
      and(
        inArray(setLogs.exerciseId, matching.map((e) => e.id)),
        eq(setLogs.userId, userId),
        sideCondition(side),
        eq(workoutLogs.completed, true),
      ),
    )
    .orderBy(desc(workoutLogs.date), desc(setLogs.setNumber))
    .limit(30);

  if (rows.length === 0) return { sets: [], date: null };

  const lastWorkoutId = rows[0].workoutLog.id;
  return {
    sets: rows.filter((r) => r.workoutLog.id === lastWorkoutId).map((r) => r.setLog),
    date: rows[0].workoutLog.date,
  };
}

/** The session before `excludeWorkoutId`, used to detect two bad sessions in a row. */
async function getPreviousSessionSets(
  userId: string,
  exerciseId: string,
  excludeWorkoutId: string,
  side: string | null,
) {
  const rows = await db
    .select({ setLog: setLogs, workoutLog: workoutLogs })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(
      and(
        eq(setLogs.userId, userId),
        eq(setLogs.exerciseId, exerciseId),
        sideCondition(side),
        eq(workoutLogs.completed, true),
      ),
    )
    .orderBy(desc(workoutLogs.date))
    .limit(50);

  const filtered = rows.filter((r) => r.workoutLog.id !== excludeWorkoutId);
  if (filtered.length === 0) return null;

  const prevWorkoutId = filtered[0].workoutLog.id;
  return filtered.filter((r) => r.workoutLog.id === prevWorkoutId).map((r) => r.setLog);
}

/**
 * What weight to put in the box before the user touches it.
 *
 * Precedence: deload hold → accepted increase → pending increase (hold) →
 * auto-reduce after two sessions short of the rep range → repeat last session.
 */
export async function getRecommendedWeight(
  userId: string,
  exerciseId: string,
  setNumber: number,
  currentWeek: number,
  side?: string | null,
): Promise<WeightRecommendation> {
  const [ex] = await db.select().from(exercises).where(eq(exercises.id, exerciseId)).limit(1);
  if (!ex) return { weight: null, reps: null, source: "no_history" };

  const repMin = parseRepRangeMin(ex.repRange);
  const repMax = parseRepRangeMax(ex.repRange);
  const targetReps = Math.round((repMin + repMax) / 2);

  // Bands, holds and cardio have no load to recommend.
  if (isUnloadedInputType(ex.inputType)) {
    return { weight: null, reps: null, source: "no_history" };
  }

  const { sets: lastSets, date: lastDate } = await getLastSessionSets(userId, exerciseId, side || null);

  if (lastSets.length === 0) {
    const { sets: fallbackSets, date: fallbackDate } = await getLastSessionSetsByName(
      userId,
      ex.name,
      side || null,
    );
    if (fallbackSets.length > 0) {
      const fallbackSet = fallbackSets.find((s) => s.setNumber === setNumber) ?? fallbackSets[0];
      const fbWeight = fallbackSet?.weightLbs ?? null;
      if (fbWeight !== null) {
        return {
          weight: fbWeight,
          reps: fallbackSet?.reps ?? targetReps,
          source: "last_session",
          lastSessionDate: fallbackDate || undefined,
        };
      }
    }
    return { weight: null, reps: targetReps, source: "no_history" };
  }

  const setForNumber = lastSets.find((s) => s.setNumber === setNumber);
  const lastWeight = setForNumber?.weightLbs ?? lastSets[0].weightLbs ?? null;
  const lastReps = setForNumber?.reps ?? lastSets[0].reps ?? null;
  const suggestedReps = lastReps ?? targetReps;

  if (lastWeight === null) {
    return { weight: null, reps: suggestedReps, source: "no_history" };
  }

  if (isDeloadWeek(currentWeek)) {
    return {
      weight: lastWeight,
      reps: suggestedReps,
      source: "deload",
      reason: "Deload week — maintaining weight",
      lastSessionDate: lastDate || undefined,
    };
  }

  const acceptedWeight = await getAcceptedWeight(userId, exerciseId);
  if (acceptedWeight !== null) {
    return {
      weight: acceptedWeight,
      reps: repMin,
      source: "accepted_recommendation",
      reason: `Increased from ${lastWeight}`,
    };
  }

  const allSetsHitMax = lastSets.every((s) => (s.reps ?? 0) >= repMax);
  if (allSetsHitMax) {
    const pendingRec = await db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, userId),
          eq(recommendations.exerciseId, exerciseId),
          eq(recommendations.status, "pending"),
          eq(recommendations.type, "weight_increase"),
        ),
      )
      .orderBy(desc(recommendations.createdAt))
      .limit(1);

    if (pendingRec.length > 0) {
      return {
        weight: lastWeight,
        reps: suggestedReps,
        source: "pending_recommendation",
        reason: "Weight increase pending approval",
        lastSessionDate: lastDate || undefined,
      };
    }
  }

  const currentBelowMin = lastSets.some((s) => (s.reps ?? repMax) < repMin);
  if (currentBelowMin && lastSets[0]?.workoutLogId) {
    const prevSets = await getPreviousSessionSets(
      userId,
      exerciseId,
      lastSets[0].workoutLogId,
      side || null,
    );

    if (prevSets && prevSets.some((s) => (s.reps ?? repMax) < repMin)) {
      const increment = getIncrementForExercise(ex);
      return {
        weight: Math.max(0, lastWeight - increment),
        reps: targetReps,
        source: "auto_reduce",
        reason: `Reps below ${repMin} for 2 sessions. Reduced from ${lastWeight}.`,
      };
    }
  }

  return {
    weight: lastWeight,
    reps: suggestedReps,
    source: "last_session",
    lastSessionDate: lastDate || undefined,
  };
}

export async function getRecommendedWeightsForExercise(
  userId: string,
  exerciseId: string,
  numSets: number,
  currentWeek: number,
  isUnilateral: boolean,
): Promise<SetRecommendation[]> {
  const result: SetRecommendation[] = [];

  for (let i = 1; i <= numSets; i++) {
    if (isUnilateral) {
      const [left, right] = await Promise.all([
        getRecommendedWeight(userId, exerciseId, i, currentWeek, "left"),
        getRecommendedWeight(userId, exerciseId, i, currentWeek, "right"),
      ]);
      result.push({ setNumber: i, side: "left", ...left });
      result.push({ setNumber: i, side: "right", ...right });
    } else {
      const rec = await getRecommendedWeight(userId, exerciseId, i, currentWeek);
      result.push({ setNumber: i, ...rec });
    }
  }

  return result;
}
