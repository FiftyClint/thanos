/**
 * Pure program rules: phases, deloads, ramp sets, rep ranges, load increments.
 *
 * Everything here is a pure function of its inputs so it can be unit-tested
 * without a database. See tests/program.test.ts.
 */
import type { Exercise } from "@shared/schema";

/** Barbell/loaded-carry style lifts that move in bigger jumps than isolation work. */
const COMPOUND_EXERCISES = [
  "Belt Squat",
  "BB Hip Thrust",
  "Sumo Belt Squat",
  "Hip Thrust",
  "Leg Press",
];

/** Input types that have no external load to progress. */
const UNLOADED_INPUT_TYPES = new Set(["band_reps", "reps_unilateral_band", "timed", "cardio"]);

export function isUnloadedInputType(inputType: string): boolean {
  return UNLOADED_INPUT_TYPES.has(inputType);
}

export function isUnilateralInputType(inputType: string): boolean {
  return inputType === "weight_reps_unilateral" || inputType === "weight_reps_unilateral_db";
}

export function getIncrement(inputType: string): number {
  switch (inputType) {
    case "weight_reps_db":
    case "weight_reps_unilateral":
    case "weight_reps":
      return 5;
    case "bodyweight_reps":
      return 2.5;
    case "bodyweight_reps_weighted":
      return 5;
    default:
      return 0;
  }
}

export function getIncrementForExercise(exercise: Pick<Exercise, "name" | "inputType">): number {
  if (COMPOUND_EXERCISES.some((name) => exercise.name.includes(name))) {
    return 10;
  }
  return getIncrement(exercise.inputType);
}

export function parseRepRangeMax(repRange: string): number {
  const parts = repRange.split("-");
  if (parts.length === 2) {
    return parseInt(parts[1], 10) || 12;
  }
  const num = parseInt(repRange, 10);
  return Number.isNaN(num) ? 12 : num;
}

export function parseRepRangeMin(repRange: string): number {
  const parts = repRange.split("-");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) || 6;
  }
  const num = parseInt(repRange, 10);
  return Number.isNaN(num) ? 6 : num;
}

export function isDeloadWeek(week: number): boolean {
  return week === 4 || week === 8 || week === 16 || week === 24 || week === 32;
}

/** Sets for a given week, trimmed on deload weeks. */
export function setsForWeek(defaultSets: number, week: number): number {
  if (!isDeloadWeek(week)) return defaultSets;
  return Math.max(2, defaultSets - (defaultSets > 3 ? 2 : 1));
}

/** The 36-week prep macrocycle. */
export function getCurrentPhase(week: number): string {
  if (week <= 10) return "Base";
  if (week === 11) return "Diet Break 1";
  if (week >= 12 && week <= 21) return "Cut 1";
  if (week === 22) return "Diet Break 2";
  if (week >= 23 && week <= 31) return "Cut 2";
  return "Peak";
}

const RAMP_PATTERN = /RAMP \+(\d+)(?:\s+sets?)?\s+at\s+Wk(\d+)/i;

/**
 * Phase 3 exercises can carry a "RAMP +N at WkX" note, meaning volume steps up
 * from week X onward. Applied at read time so the seed data stays declarative.
 */
export function applyRampSets<T extends { notes: string | null; defaultSets: number }>(
  exercise: T,
  currentWeek: number,
): T {
  if (!exercise.notes) return exercise;
  const match = exercise.notes.match(RAMP_PATTERN);
  if (!match) return exercise;

  const addSets = parseInt(match[1], 10);
  const atWeek = parseInt(match[2], 10);
  if (currentWeek >= atWeek) {
    return { ...exercise, defaultSets: exercise.defaultSets + addSets };
  }
  return exercise;
}

/** Ramp notes only apply to the Phase 3 program. */
export function applyProgramRules<T extends { notes: string | null; defaultSets: number }>(
  exercises: T[],
  program: string,
  week: number,
): T[] {
  if (program !== "phase3") return exercises;
  return exercises.map((e) => applyRampSets(e, week));
}
