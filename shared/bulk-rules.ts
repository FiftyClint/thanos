/**
 * Phase 4 — 16-week bulk, 2027 season. Week 1 is Monday 11/23/2026.
 *
 * Program revised 11/26/2026 (the merged program): arms move to the leg and
 * pull days, and volume ramps in stages instead of exercise-swap blocks.
 *
 * The weekly structure is applied at read time from tags in each exercise's
 * notes, so the seed file stays declarative:
 *
 *   [PLUS1 WK5]  +1 working set from week 5 on (first lift Days 1, 3, 4, 6)
 *   [PLUS1 WK9]  +1 working set from week 9 on (first lateral raise Days 2
 *                and 5, first arm exercise Days 1, 3, 4, 6)
 *   [ISO]        isolation exercise: lengthened partials on the last set from
 *                week 9, last set to true failure from week 13
 *
 *   Week 1       re-entry, every hypertrophy set at RIR 3
 *   Weeks 2-4    Base
 *   Weeks 5-8    Build 1
 *   Weeks 9-12   Build 2
 *   Weeks 13-16  Peak (volume holds; compounds stay at their prescribed RIR)
 *
 * There are no scheduled deloads. Deloads stay fatigue-triggered (see
 * server/lib/fatigue.ts), with the cut-only confound check switched off
 * because the bulk runs in a surplus. The plan's rule that a deload before
 * week 9 holds volume at the weeks 5-8 level is not automated.
 */

export const BULK_WEEKS = 16;
export const REENTRY_WEEK = 1;
export const REENTRY_RIR = "3";
export const BUILD_1_FROM = 5;
export const BUILD_2_FROM = 9;
export const PEAK_FROM = 13;

export const PLUS1_WK5_TAG = "[PLUS1 WK5]";
export const PLUS1_WK9_TAG = "[PLUS1 WK9]";
export const ISO_TAG = "[ISO]";

export const PARTIALS_NOTE = "LAST SET: after full-range failure, add lengthened partials.";
export const FAILURE_NOTE = "LAST SET: take full-range reps to true failure, then lengthened partials.";

export function bulkPhaseLabel(week: number): string {
  if (week > BULK_WEEKS) return "Reassess";
  if (week <= REENTRY_WEEK) return "Re-entry";
  if (week < BUILD_1_FROM) return "Base";
  if (week < BUILD_2_FROM) return "Build 1";
  if (week < PEAK_FROM) return "Build 2";
  return "Peak";
}

/** Extra working sets this exercise gets in this week. */
export function extraSets(notes: string | null | undefined, week: number): number {
  const n = notes ?? "";
  let extra = 0;
  if (n.includes(PLUS1_WK5_TAG) && week >= BUILD_1_FROM) extra++;
  if (n.includes(PLUS1_WK9_TAG) && week >= BUILD_2_FROM) extra++;
  return extra;
}

/** A vacuum or other skill/mobility row is not hypertrophy work. */
function isHypertrophySet(e: { segment?: string; rir?: string }): boolean {
  return e.segment === "working" && /\d/.test(e.rir ?? "");
}

export function applyBulkRules<
  T extends { notes: string | null; defaultSets: number; rir?: string; segment?: string },
>(exercises: T[], week: number): T[] {
  return exercises.map((e) => {
    let next = e;
    const extra = extraSets(e.notes, week);
    if (extra) next = { ...next, defaultSets: next.defaultSets + extra };

    if ((e.notes ?? "").includes(ISO_TAG) && week >= BUILD_2_FROM && week <= BULK_WEEKS) {
      const add = week >= PEAK_FROM ? FAILURE_NOTE : PARTIALS_NOTE;
      next = { ...next, notes: `${next.notes ?? ""} ${add}`.trim() };
    }

    if (week === REENTRY_WEEK && isHypertrophySet(e)) {
      next = { ...next, rir: REENTRY_RIR };
    }
    return next;
  });
}
