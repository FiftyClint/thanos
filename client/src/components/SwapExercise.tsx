import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, RotateCcw, Search } from "lucide-react";
import type { Exercise } from "@shared/schema";

/**
 * Choose a different movement for one slot.
 *
 * The machine is taken, so you do something else. The old control only renamed
 * the card — sets still saved under the prescribed exercise, which taught it a
 * weight from a movement you did not perform. This one names a real substitute
 * that the session save records properly.
 *
 * Three ways in, cheapest first: the alternate the program itself lists, a
 * substitute you have used before, or anything in the program by search. A
 * typed name is the fallback for a movement the app has never seen.
 */

export interface SwapTarget {
  exercise: Exercise;
  /** Currently-chosen substitute name, or null when doing the prescribed movement. */
  current: string | null;
}

interface Props {
  target: SwapTarget | null;
  onClose: () => void;
  onChoose: (exerciseId: string, substituteName: string | null) => void;
}

export default function SwapExercise({ target, onClose, onChoose }: Props) {
  const [search, setSearch] = useState("");

  const { data: recent } = useQuery<Exercise[]>({
    queryKey: ["/api/substitutes/recent"],
    enabled: !!target,
  });

  const { data: allExercises } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
    enabled: !!target,
  });

  const catalogue = useMemo(() => {
    if (!target) return [];
    const seen = new Set<string>([target.exercise.name]);
    const out: string[] = [];

    const add = (name: string) => {
      const clean = name.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
    };

    // The program's own suggestion first — it is the considered answer.
    if (target.exercise.alternate) add(target.exercise.alternate);
    for (const e of recent ?? []) add(e.name);
    for (const e of allExercises ?? []) {
      // Warm-ups and cool-downs are not substitutes for working sets.
      if (e.segment === "working") add(e.name);
    }
    return out;
  }, [target, recent, allExercises]);

  const query = search.trim().toLowerCase();
  const matches = query ? catalogue.filter((n) => n.toLowerCase().includes(query)).slice(0, 40) : catalogue.slice(0, 12);

  const suggested = target?.exercise.alternate?.trim();
  const recentNames = new Set((recent ?? []).map((e) => e.name));

  const choose = (name: string | null) => {
    if (!target) return;
    onChoose(target.exercise.id, name);
    setSearch("");
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-swap-exercise">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-accent" />
            Swap exercise
          </DialogTitle>
          <DialogDescription>
            Logging something else for{" "}
            <span className="text-foreground font-medium">{target?.exercise.name}</span>. Your sets are
            saved under what you actually did, so each movement keeps its own weights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {target?.current && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => choose(null)}
              data-testid="button-swap-revert"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Back to {target.exercise.name}
            </Button>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search or type a movement"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-9"
              data-testid="input-swap-search"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {matches.map((name) => (
              <button
                key={name}
                onClick={() => choose(name)}
                className="flex w-full items-center justify-between gap-2 rounded-md bg-card-alt px-3 py-2.5 text-left text-sm hover:bg-card-alt/70"
                data-testid={`option-swap-${name}`}
              >
                <span className="truncate">{name}</span>
                {name === suggested ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    listed
                  </Badge>
                ) : recentNames.has(name) ? (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                    used before
                  </Badge>
                ) : null}
              </button>
            ))}

            {/* A movement the app has never seen is still a movement. */}
            {query && !catalogue.some((n) => n.toLowerCase() === query) && (
              <button
                onClick={() => choose(search.trim())}
                className="w-full rounded-md border border-dashed border-accent/50 px-3 py-2.5 text-left text-sm text-accent"
                data-testid="button-swap-custom"
              >
                Use “{search.trim()}”
              </button>
            )}

            {!query && matches.length === 0 && (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                Type the movement you did instead.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
