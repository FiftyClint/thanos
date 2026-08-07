import { useQuery } from "@tanstack/react-query";
import type { PublicUser } from "@shared/schema";
import { getCurrentWeek, getDaysUntilShow, getCurrentPhase } from "@/lib/utils";

/**
 * Where the prep is, according to the athlete's own dates.
 *
 * Every screen used to compute this from two hardcoded constants, so the
 * Prep Start Date and Show Date in Settings saved correctly and then did
 * nothing. This reads them, falling back to the constants when unset.
 */
export function usePrep() {
  const { data: user } = useQuery<PublicUser | null>({ queryKey: ["/api/user"] });

  const currentWeek = getCurrentWeek(user?.prepStartDate);
  const daysUntilShow = getDaysUntilShow(user?.showDate);

  return {
    currentWeek,
    daysUntilShow,
    phase: getCurrentPhase(currentWeek),
    /** True once the athlete has set their own dates rather than using defaults. */
    usingOwnDates: Boolean(user?.prepStartDate || user?.showDate),
    showDate: user?.showDate ?? null,
    prepStartDate: user?.prepStartDate ?? null,
  };
}
