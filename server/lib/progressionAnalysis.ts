/**
 * Post-session analysis: turn a completed workout into coaching recommendations.
 *
 * The decision function is pure (`analyseExercisePerformance`) so its rules can
 * be tested directly; the caller does the database work.
 */
import type { Exercise, SetLog } from "@shared/schema";
import { parseRepRangeMax } from "./program";

export interface LoggedSet {
  exerciseId: string;
  setNumber: number;
  weightLbs?: number | null;
  reps?: number | null;
  rirActual?: number | null;
}

export type RecommendationType = "weight_increase" | "maintain" | "form_check";

export interface ProgressionVerdict {
  type: RecommendationType;
  message: string;
  details: string;
  /** Populated for weight_increase so autofill can apply it once accepted. */
  newWeight?: number;
}

/**
 * Decide whether a session earns a load increase, a hold, or a form check.
 *
 * Returns null when nothing is worth saying — no weighted sets, or a normal
 * session in the middle of the rep range.
 */
export function analyseExercisePerformance(
  exercise: Pick<Exercise, "name" | "repRange">,
  currentSets: LoggedSet[],
  previousSets: Pick<SetLog, "weightLbs" | "reps">[],
): ProgressionVerdict | null {
  const weightedSets = currentSets.filter((s) => s.weightLbs != null && s.reps != null);
  if (weightedSets.length === 0) return null;

  const maxReps = parseRepRangeMax(exercise.repRange);
  const allHitTopReps = weightedSets.every((s) => (s.reps ?? 0) >= maxReps);

  // An unset RIR is treated as 2 (comfortably short of failure).
  const avgRir = weightedSets.reduce((sum, s) => sum + (s.rirActual ?? 2), 0) / weightedSets.length;
  const avgWeight = weightedSets.reduce((sum, s) => sum + (s.weightLbs ?? 0), 0) / weightedSets.length;

  const prevWeighted = previousSets.filter((s) => s.weightLbs != null && s.reps != null);
  const prevAvgWeight =
    prevWeighted.length > 0
      ? prevWeighted.reduce((sum, s) => sum + (s.weightLbs ?? 0), 0) / prevWeighted.length
      : 0;

  if (allHitTopReps && avgRir >= 1) {
    const increment = avgWeight <= 50 ? 5 : 10;
    return {
      type: "weight_increase",
      message: `${exercise.name}: Increase weight by ${increment} lbs next session`,
      details: JSON.stringify({
        reason: `You hit ${maxReps} reps on all sets with ${avgRir.toFixed(1)} RIR. Ready to progress!`,
        previousWeight: Number(avgWeight.toFixed(1)),
        increment,
        newWeight: Number((avgWeight + increment).toFixed(1)),
      }),
      newWeight: Number((avgWeight + increment).toFixed(1)),
    };
  }

  if (avgRir <= 0.5 && avgWeight > prevAvgWeight) {
    return {
      type: "maintain",
      message: `${exercise.name}: Great progress! Maintain current weight next session`,
      details: JSON.stringify({
        reason: `Weight increased from ${prevAvgWeight.toFixed(1)} to ${avgWeight.toFixed(1)} lbs. Consolidate gains.`,
      }),
    };
  }

  if (avgRir <= 0 && !allHitTopReps) {
    return {
      type: "form_check",
      message: `${exercise.name}: Consider a slight weight reduction or form check`,
      details: JSON.stringify({
        reason: "Reaching failure before hitting target reps. Focus on quality reps.",
      }),
    };
  }

  return null;
}

export function groupSetsByExercise<T extends { exerciseId: string }>(sets: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const set of sets) {
    const list = grouped.get(set.exerciseId);
    if (list) list.push(set);
    else grouped.set(set.exerciseId, [set]);
  }
  return grouped;
}
