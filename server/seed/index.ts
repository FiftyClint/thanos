import type { InsertExercise } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { phase1Exercises } from "./phase1";
import { phase2Exercises } from "./phase2";
import { phase3Exercises } from "./phase3";

export type ProgramId = "phase1" | "phase2" | "phase3";

export const PROGRAM_IDS: ProgramId[] = ["phase1", "phase2", "phase3"];

export const PROGRAM_LABELS: Record<ProgramId, string> = {
  phase1: "Phase 1 — Base Block",
  phase2: "Phase 2 — Build Block",
  phase3: "Phase 3 — Cut Block",
};

/** Phase 2 defines its own working sets but reuses the Phase 1 warm-up/cool-down blocks. */
const phase1WarmupCooldown = phase1Exercises.filter(
  (e) => e.segment === "warmup" || e.segment === "cooldown",
);

export const PROGRAMS: Record<ProgramId, InsertExercise[]> = {
  phase1: phase1Exercises.map((e) => ({ ...e, program: "phase1" })),
  phase2: [...phase2Exercises, ...phase1WarmupCooldown].map((e) => ({ ...e, program: "phase2" })),
  phase3: phase3Exercises.map((e) => ({ ...e, program: "phase3" })),
};

/** Identity of an exercise row within a program. Stable across content edits. */
function keyOf(e: { day: number; order: number; number: string }): string {
  return `${e.day}|${e.order}|${e.number}`;
}

export interface SyncResult {
  program: ProgramId;
  inserted: number;
  updated: number;
  removed: number;
  /** Moved to the legacy program to keep their logged sets. */
  retired: number;
}

/** Program id that retired exercises are parked under, outside every sync. */
export const LEGACY_PROGRAM = "legacy";

/**
 * Make the database match the seed files for one program, exactly.
 *
 * This replaces the old seeder, which decided whether to re-seed by looking for
 * "sentinel" exercise names that a previous bad deploy might have left behind —
 * a workaround for a database that had drifted, not a design. Here the seed
 * files are the source of truth and the sync is unconditional and idempotent:
 *
 *   - a row whose (day, order, number) exists is UPDATED in place, so its id
 *     survives and any set_logs pointing at it stay valid;
 *   - a row that is new is INSERTED;
 *   - a row in the DB that is no longer in the seed is REMOVED.
 *
 * Two cases would otherwise damage history, because (day, order, number) is a
 * SLOT and the movement occupying it can change:
 *
 *   - Swapping the exercise in a slot. Updating in place keeps the row id, so
 *     every set logged against the old movement silently reappears under the
 *     new name — 100 lb lateral raises become 100 lb upright rows, and the
 *     weight suggested for the new movement is a weight for a different one.
 *   - Dropping an exercise. A set row cannot outlive the exercise it points at,
 *     so removal takes the logged sets with it.
 *
 * In both cases, when the old exercise has logged sets it is RETIRED instead:
 * moved to the legacy program, keeping its id, its name and its history. The
 * new movement is inserted fresh and starts, correctly, with no history.
 *
 * `dryRun` reports what would change without writing.
 */
export async function syncProgram(
  program: ProgramId,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const desired = PROGRAMS[program];
  const existing = await storage.getAllExercisesByProgram(program);
  const existingByKey = new Map(existing.map((e) => [keyOf(e), e]));

  const result: SyncResult = { program, inserted: 0, updated: 0, removed: 0, retired: 0 };

  // A slot whose movement changed, and any slot that vanished, is only safe to
  // overwrite when nothing has been logged against what was there.
  const desiredKeys = new Set(desired.map(keyOf));
  const stale = existing.filter((e) => !desiredKeys.has(keyOf(e)));

  const hasHistory = await storage.exercisesWithLoggedSets([
    ...desired.flatMap((e) => {
      const current = existingByKey.get(keyOf(e));
      return current && current.name !== e.name ? [current.id] : [];
    }),
    ...stale.map((e) => e.id),
  ]);

  const swapsToRetire = desired.flatMap((e) => {
    const current = existingByKey.get(keyOf(e));
    return current && current.name !== e.name && hasHistory.has(current.id) ? [current.id] : [];
  });
  const staleToRetire = stale.filter((e) => hasHistory.has(e.id)).map((e) => e.id);
  const staleToDelete = stale.filter((e) => !hasHistory.has(e.id)).map((e) => e.id);

  result.retired = swapsToRetire.length + staleToRetire.length;
  result.removed = staleToDelete.length;

  /*
   * Retire BEFORE inserting. exercises is unique on (program, day, order,
   * number), so the replacement for a swapped slot collides with the row it
   * replaces until that row has left this program.
   */
  if (!opts.dryRun) {
    await storage.retireExercises([...swapsToRetire, ...staleToRetire], LEGACY_PROGRAM);
    await storage.deleteExercisesByIds(staleToDelete);
  }

  const retired = new Set(swapsToRetire);
  for (const exercise of desired) {
    const current = existingByKey.get(keyOf(exercise));
    if (current && !retired.has(current.id)) {
      result.updated++;
      if (!opts.dryRun) await storage.updateExerciseByKey(current.id, exercise);
    } else {
      result.inserted++;
      if (!opts.dryRun) await storage.createExercise(exercise);
    }
  }

  return result;
}

export async function syncAllPrograms(opts: { dryRun?: boolean } = {}): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const program of PROGRAM_IDS) {
    const result = await syncProgram(program, opts);
    results.push(result);
    const verb = opts.dryRun ? "would sync" : "synced";
    logger.info(
      result,
      `${verb} ${program}: +${result.inserted} ~${result.updated} -${result.removed} retired:${result.retired}`,
    );
  }
  return results;
}
