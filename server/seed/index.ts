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
}

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
 * Removal deletes that exercise's logged sets too, because a set row cannot
 * outlive the exercise it references. `dryRun` reports what would change so you
 * can see the damage before a content edit drops history.
 */
export async function syncProgram(
  program: ProgramId,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const desired = PROGRAMS[program];
  const existing = await storage.getAllExercisesByProgram(program);
  const existingByKey = new Map(existing.map((e) => [keyOf(e), e]));

  const result: SyncResult = { program, inserted: 0, updated: 0, removed: 0 };
  const seenKeys = new Set<string>();

  for (const exercise of desired) {
    const key = keyOf(exercise);
    seenKeys.add(key);
    if (existingByKey.has(key)) {
      result.updated++;
      if (!opts.dryRun) await storage.updateExerciseByKey(existingByKey.get(key)!.id, exercise);
    } else {
      result.inserted++;
      if (!opts.dryRun) await storage.createExercise(exercise);
    }
  }

  const staleIds = existing.filter((e) => !seenKeys.has(keyOf(e))).map((e) => e.id);
  result.removed = staleIds.length;
  if (staleIds.length > 0 && !opts.dryRun) {
    await storage.deleteExercisesByIds(staleIds);
  }

  return result;
}

export async function syncAllPrograms(opts: { dryRun?: boolean } = {}): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const program of PROGRAM_IDS) {
    const result = await syncProgram(program, opts);
    results.push(result);
    const verb = opts.dryRun ? "would sync" : "synced";
    logger.info(result, `${verb} ${program}: +${result.inserted} ~${result.updated} -${result.removed}`);
  }
  return results;
}
