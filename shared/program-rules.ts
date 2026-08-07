/**
 * Program rules shared by the client and the server.
 *
 * This file exists because the two halves of the app disagreed. The deload
 * schedule was defined twice — `week % 9 === 0` in the client, an explicit
 * list of weeks on the server — and the two shared no weeks in common. The
 * dashboard would show a deload banner and trim set counts on a week the
 * weight engine treated as normal, and vice versa. Anything both sides act on
 * belongs here, defined once.
 */

/**
 * Scheduled deload weeks.
 *
 * NOTE: the program's own RULES sheet does not prescribe a calendar deload at
 * all. It defines deloads as FATIGUE-TRIGGERED, in two tiers:
 *
 *   Tier 1 (trim sets, local)   — one muscle's primary stalls for 2 sessions,
 *                                 pump/MMC gone for 2 sessions, or a localised
 *                                 joint ache for 2 sessions.
 *   Tier 2 (full deload)        — 2+ primaries regress for 2 sessions, RIR
 *                                 inflation across lifts, joint pain in a
 *                                 working set, warm-ups feeling heavy, session
 *                                 dread 3+ days, or Tier 1 having failed.
 *
 * This calendar is therefore a stand-in, kept only so the two halves agree
 * while the fatigue-triggered version is designed. The server's list is used
 * because it already drove weight recommendations, and so actual training load.
 */
export const SCHEDULED_DELOAD_WEEKS = [4, 8, 16, 24, 32] as const;

export function isDeloadWeek(week: number): boolean {
  return (SCHEDULED_DELOAD_WEEKS as readonly number[]).includes(week);
}

/**
 * Sets to run on a deload week.
 *
 * The RULES sheet specifies 40–50% of normal volume. This trims by one or two
 * sets, which lands near that for typical prescriptions (4 sets → 2 is 50%)
 * but is not the same rule. Flagged rather than silently approximated.
 */
export function setsForWeek(defaultSets: number, week: number): number {
  if (!isDeloadWeek(week)) return defaultSets;
  return Math.max(2, defaultSets - (defaultSets > 3 ? 2 : 1));
}
