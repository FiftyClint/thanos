/**
 * Phase 4 — 16-week bulk, 2027 season. Week 1 is Monday 11/23/2026.
 *
 * The weekly structure is applied at read time from tags in each exercise's
 * notes, so the seed file stays declarative (the same approach as Phase 3's
 * "RAMP +N at WkX"):
 *
 *   [BLOCKS 1+3]  shown in weeks 1-6 and 13-16
 *   [BLOCK 2]     shown in weeks 7-12 (the exercise swaps)
 *   [PLUS1]       +1 working set in weeks 4-5, 10-11 and 15-16
 *
 * Week 1 is a re-entry week: every hypertrophy set targets RIR 3 while working
 * loads are found again after the photo shoot.
 *
 * There are no scheduled deloads. Deloads stay fatigue-triggered (see
 * server/lib/fatigue.ts), with the cut-only confound check switched off
 * because the bulk runs in a surplus.
 */

export const BULK_WEEKS = 16;
export const BLOCK_2_WEEKS = { from: 7, to: 12 } as const;
export const PLUS_ONE_WEEKS = [4, 5, 10, 11, 15, 16] as const;
export const REENTRY_WEEK = 1;
export const REENTRY_RIR = "3";

export const BLOCK_13_TAG = "[BLOCKS 1+3]";
export const BLOCK_2_TAG = "[BLOCK 2]";
export const PLUS_ONE_TAG = "[PLUS1]";

export function bulkBlock(week: number): 1 | 2 | 3 {
  if (week < BLOCK_2_WEEKS.from) return 1;
  if (week <= BLOCK_2_WEEKS.to) return 2;
  return 3;
}

export function isPlusOneWeek(week: number): boolean {
  return (PLUS_ONE_WEEKS as readonly number[]).includes(week);
}

export function bulkPhaseLabel(week: number): string {
  if (week > BULK_WEEKS) return "Reassess";
  if (week === REENTRY_WEEK) return "Re-entry";
  return `Block ${bulkBlock(week)}${isPlusOneWeek(week) ? " Build +" : " Build"}`;
}

/** A vacuum or other skill/mobility row is not hypertrophy work. */
function isHypertrophySet(e: { segment?: string; rir?: string }): boolean {
  return e.segment === "working" && /\d/.test(e.rir ?? "");
}

export function applyBulkRules<
  T extends { notes: string | null; defaultSets: number; rir?: string; segment?: string },
>(exercises: T[], week: number): T[] {
  const inBlock2 = bulkBlock(week) === 2;
  return exercises
    .filter((e) => {
      const notes = e.notes ?? "";
      if (notes.includes(BLOCK_2_TAG)) return inBlock2;
      if (notes.includes(BLOCK_13_TAG)) return !inBlock2;
      return true;
    })
    .map((e) => {
      let next = e;
      if (isPlusOneWeek(week) && (e.notes ?? "").includes(PLUS_ONE_TAG)) {
        next = { ...next, defaultSets: next.defaultSets + 1 };
      }
      if (week === REENTRY_WEEK && isHypertrophySet(e)) {
        next = { ...next, rir: REENTRY_RIR };
      }
      return next;
    });
}
