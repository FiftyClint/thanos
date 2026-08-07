import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Prep start date: February 1, 2026
export const PREP_START_DATE = new Date("2026-02-01");
// Show date: October 10, 2026
export const SHOW_DATE = new Date("2026-10-10");

export function getCurrentWeek(): number {
  const now = new Date();
  const diffTime = now.getTime() - PREP_START_DATE.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}

export function getDaysUntilShow(): number {
  const now = new Date();
  const diffTime = SHOW_DATE.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function getCurrentPhase(weekNumber: number): string {
  if (weekNumber <= 10) return "Base";
  if (weekNumber === 11) return "Diet Break 1";
  if (weekNumber >= 12 && weekNumber <= 21) return "Cut 1";
  if (weekNumber === 22) return "Diet Break 2";
  if (weekNumber >= 23 && weekNumber <= 31) return "Cut 2";
  return "Peak";
}

export function getPhaseColor(phase: string): string {
  switch (phase) {
    case "Base":
      return "bg-blue-600";
    case "Diet Break 1":
    case "Diet Break 2":
      return "bg-green-600";
    case "Cut 1":
    case "Cut 2":
      return "bg-yellow-600";
    case "Peak":
      return "bg-red-600";
    default:
      return "bg-gray-600";
  }
}

export function isDeloadWeek(weekNumber: number): boolean {
  return weekNumber % 9 === 0 && weekNumber > 0;
}

export function getDayName(day: number): string {
  const days: Record<number, string> = {
    1: "Monday",
    2: "Tuesday", 
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  };
  return days[day] || "";
}

export function getDayFocus(day: number, program?: string): string {
  if (program === 'phase3') {
    const focuses: Record<number, string> = {
      1: "Side Delts + Triceps",
      2: "Lats + Biceps",
      3: "Upper Chest + Rear Delts",
      4: "Legs Braced",
      5: "Side Delt Specialization + Triceps",
      6: "Lats + Upper Back + Chest + Biceps",
    };
    return focuses[day] || "";
  }
  if (program === 'phase2') {
    const focuses: Record<number, string> = {
      1: "Push A — Side Delts + Triceps + Chest",
      2: "Pull A — Lat Width + Biceps + Rear Delts",
      3: "Legs A — Quads + Posing + LISS",
      4: "Push B — Upper Chest + Side Delts + Triceps",
      5: "Pull B — Back Thickness + Lats + Arms",
      6: "Legs B — Hamstrings + Posing + LISS",
    };
    return focuses[day] || "";
  }
  const focuses: Record<number, string> = {
    1: "Delt Dominant + Triceps + Core",
    2: "Lat Width + Biceps",
    3: "Posing + LISS",
    4: "Upper Chest + Core",
    5: "Back Thickness + Rear Delts + Arms",
    6: "Legs (Maintenance) + Core",
  };
  return focuses[day] || "";
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function parseRestSeconds(restStr: string): number {
  // Handle formats like "120s", "60-75s", "—"
  if (!restStr || restStr === "—") return 60;
  const match = restStr.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 60;
}

export function getInputTypeLabel(inputType: string): string {
  const labels: Record<string, string> = {
    weight_reps: "Weight + Reps",
    weight_reps_db: "Weight + Reps (DB)",
    weight_reps_unilateral: "Weight + Reps (L/R)",
    bodyweight_reps: "Bodyweight + Reps",
    bodyweight_reps_weighted: "Bodyweight + Weight",
    band_reps: "Band + Reps",
    reps_unilateral_band: "Band + Reps (L/R)",
    timed: "Timed (seconds)",
    timed_reps: "Reps + Time (L/R)",
    cardio: "Duration + Notes",
  };
  return labels[inputType] || inputType;
}

export function calculateShoulderToWaist(shoulders?: number, waist?: number): number | null {
  if (!shoulders || !waist || waist === 0) return null;
  return Math.round((shoulders / waist) * 100) / 100;
}
