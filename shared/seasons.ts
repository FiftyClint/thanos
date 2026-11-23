/**
 * Seasons: the year a training week belongs to.
 *
 * A week number alone is not an identity. The 2026 prep ran from Week 1 in
 * February; the bulk that leads into the 2027 season starts again at Week 1 in
 * November 2026. Both cycles start in calendar 2026, so the calendar year
 * cannot tell them apart either — "Week 1" needs the SEASON it belongs to.
 *
 * Every week-keyed row (workouts, check-ins, cardio, vacuum, photos,
 * recommendations, deloads) carries the season of the program it was logged
 * under, and every lookup by week is scoped to a season. A new cycle then
 * restarts at Week 1 without touching, or being confused with, the last one.
 *
 * Shared by client and server so the two can never compute different weeks.
 */

export const LEGACY_SEASON = 2026;

/** Fallback start for programs that follow the athlete's own prep start date. */
export const DEFAULT_PREP_START = "2026-02-01";

export interface ProgramCalendar {
  /** The season (competition year) this program's weeks belong to. */
  season: number;
  /**
   * Fixed start date of Week 1, as YYYY-MM-DD. When null, Week 1 follows the
   * athlete's Prep Start Date from Settings, which is how Phases 1-3 always
   * worked.
   */
  startDate: string | null;
  /** Number of planned weeks, or null for an open-ended program. */
  weeks: number | null;
  /**
   * Whether the program runs in a calorie deficit. The fatigue confound check
   * ("normal cut drift, do NOT deload") only makes sense in a deficit; in a
   * surplus, declining performance is a real fatigue signal.
   */
  energyBalance: "deficit" | "surplus";
}

export const PROGRAM_CALENDARS: Record<string, ProgramCalendar> = {
  phase1: { season: 2026, startDate: null, weeks: null, energyBalance: "deficit" },
  phase2: { season: 2026, startDate: null, weeks: null, energyBalance: "deficit" },
  phase3: { season: 2026, startDate: null, weeks: null, energyBalance: "deficit" },
  phase4: { season: 2027, startDate: "2026-11-23", weeks: 16, energyBalance: "surplus" },
};

export function calendarOf(program: string | null | undefined): ProgramCalendar {
  return PROGRAM_CALENDARS[program ?? ""] ?? PROGRAM_CALENDARS.phase3;
}

export function seasonOf(program: string | null | undefined): number {
  return calendarOf(program).season;
}

/** Parse YYYY-MM-DD (or any Date-able value) as a local calendar date. */
function toLocalDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The date Week 1 of this program starts on, for this athlete. */
export function programStartDate(program: string | null | undefined, prepStartDate?: Date | string | null): Date {
  const fixed = calendarOf(program).startDate;
  return toLocalDate(fixed) ?? toLocalDate(prepStartDate) ?? toLocalDate(DEFAULT_PREP_START)!;
}

/**
 * Week of the program on `now`, counting the start date's week as Week 1.
 * Before the start date it is Week 1, so a program can be selected early.
 */
export function programWeek(
  program: string | null | undefined,
  prepStartDate?: Date | string | null,
  now: Date = new Date(),
): number {
  if (!calendarOf(program).startDate) {
    // Phases 1-3: exactly the formula the app always used, so weeks already
    // logged under those programs keep the numbers they were saved with.
    const parsed = prepStartDate ? new Date(prepStartDate) : null;
    const start = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(DEFAULT_PREP_START);
    const diffDays = Math.ceil((now.getTime() - start.getTime()) / 86_400_000);
    return Math.max(1, Math.ceil(diffDays / 7));
  }
  const start = programStartDate(program, prepStartDate);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((today - startDay) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/** "2026 season" style label for screens and exports. */
export function seasonLabel(season: number): string {
  return `${season} season`;
}
