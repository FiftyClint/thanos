import { useQuery } from "@tanstack/react-query";
import type { PublicUser } from "@shared/schema";
import { getDaysUntilShow, getCurrentPhase } from "@/lib/utils";
import { programWeek, seasonOf } from "@shared/seasons";

/**
 * Where the prep is, according to the athlete's own dates.
 *
 * Every screen used to compute this from two hardcoded constants, so the
 * Prep Start Date and Show Date in Settings saved correctly and then did
 * nothing. This reads them, falling back to the constants when unset.
 */
export function usePrep() {
  const { data: user } = useQuery<PublicUser | null>({ queryKey: ["/api/user"] });

  const program = user?.activeProgram ?? "phase3";
  // Week of the ACTIVE program: Phase 4 counts from its own start (11/23/2026)
  // in the 2027 season; Phases 1-3 count from the Prep Start Date.
  const currentWeek = programWeek(program, user?.prepStartDate);
  const daysUntilShow = getDaysUntilShow(user?.showDate);

  return {
    currentWeek,
    daysUntilShow,
    phase: getCurrentPhase(currentWeek, program),
    season: seasonOf(program),
    /** True once the athlete has set their own dates rather than using defaults. */
    usingOwnDates: Boolean(user?.prepStartDate || user?.showDate),
    showDate: user?.showDate ?? null,
    prepStartDate: user?.prepStartDate ?? null,
  };
}
