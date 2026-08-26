import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

/**
 * "Last week you did X here."
 *
 * Keyed by SLOT rather than by exercise, so it answers the question actually
 * being asked mid-session — what went in this position last time — including
 * when that was a substitute for the prescribed movement.
 */

export interface LastPerformedData {
  exerciseId: string;
  name: string;
  wasSubstitute: boolean;
  week: number;
  date: string;
  sets: Array<{
    setNumber: number;
    side: string | null;
    weightLbs: number | null;
    reps: number | null;
    durationSecs: number | null;
  }>;
}

/** "88×12, 88×12, 80×10" — or per-side when the movement is unilateral. */
export function summariseSets(sets: LastPerformedData["sets"]): string {
  // One side is enough to read at a glance; both would double the length.
  const shown = sets.filter((s) => !s.side || s.side === "left");

  return shown
    .map((s) => {
      if (s.weightLbs != null && s.reps != null) return `${s.weightLbs}×${s.reps}`;
      if (s.weightLbs != null) return `${s.weightLbs}`;
      if (s.durationSecs != null) return `${s.durationSecs}s`;
      if (s.reps != null) return `${s.reps}`;
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

export default function LastPerformed({
  data,
  plannedName,
}: {
  data: LastPerformedData | undefined;
  plannedName: string;
}) {
  if (!data) return null;

  const summary = summariseSets(data.sets);
  // A substitute is worth naming; the prescribed movement is not — the card
  // already says what it is.
  const changed = data.wasSubstitute && data.name !== plannedName;

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
      data-testid="text-last-performed"
    >
      <History className="w-3 h-3 shrink-0" />
      <span>Wk {data.week}:</span>
      {changed && (
        <>
          <span className="text-foreground/80">{data.name}</span>
          <Badge
            variant="outline"
            className="px-1 py-0 text-[9px] leading-4 text-muted-foreground border-muted-foreground/40"
          >
            SWAPPED
          </Badge>
        </>
      )}
      {summary ? <span className="font-mono">{summary}</span> : <span>logged, no numbers</span>}
    </div>
  );
}
