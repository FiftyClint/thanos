import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertTriangle, OctagonAlert, Eye, Scissors, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePrep } from "@/hooks/use-prep";
import { cn } from "@/lib/utils";

type Verdict = "clear" | "monitor" | "tier_1" | "tier_2" | "hard_stop";

interface Trigger {
  id: string;
  tier: 1 | 2;
  rule: string;
  evidence: string;
  subject?: string;
}

interface Assessment {
  verdict: Verdict;
  triggers: Trigger[];
  hardStops: string[];
  confound: string | null;
  reductionPlan: string[];
  sessionsConsidered: number;
  unevaluated: string[];
  activeDeload: { id: string; tier: number; startedAt: string | null } | null;
}

const PRESENTATION: Record<Verdict, { title: string; icon: typeof ShieldCheck; className: string }> = {
  clear: { title: "Recovered — carry on", icon: ShieldCheck, className: "border-success/40 bg-success/5" },
  monitor: { title: "Monitor — don't deload yet", icon: Eye, className: "border-warning/40 bg-warning/5" },
  tier_1: { title: "Tier 1 — trim sets", icon: Scissors, className: "border-warning/50 bg-warning/10" },
  tier_2: { title: "Tier 2 — full deload", icon: AlertTriangle, className: "border-destructive/50 bg-destructive/10" },
  hard_stop: { title: "Hard stop", icon: OctagonAlert, className: "border-destructive bg-destructive/20" },
};

/**
 * Fatigue status, from the program's own deload triggers.
 *
 * Shows the verdict WITH the evidence behind it, and never acts on its own:
 * the RULES sheet's confound check turns on telling normal cut drift from
 * overreaching, and that judgment is the athlete's.
 */
export function FatigueStatus() {
  const { toast } = useToast();
  const { currentWeek } = usePrep();
  const [showDetail, setShowDetail] = useState(false);

  const { data, isLoading } = useQuery<Assessment>({ queryKey: ["/api/fatigue"] });

  const startDeload = useMutation({
    mutationFn: async (tier: 1 | 2) => {
      const subject = data?.triggers.find((t) => t.tier === tier)?.subject ?? null;
      const res = await apiRequest("POST", "/api/deloads", { tier, subject, week: currentWeek });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fatigue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deloads"] });
      toast({ title: "Deload started", description: "Volume and RIR targets now follow the deload prescription." });
    },
    onError: (error: Error) => toast({ title: "Couldn't start", description: error.message, variant: "destructive" }),
  });

  const endDeload = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/deloads/${id}`, { status: "completed" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fatigue"] });
      toast({
        title: "Deload complete",
        description: "Week 1 back: pre-deload loads at ~85% of prior set volume.",
      });
    },
  });

  if (isLoading || !data) return null;

  const { title, icon: Icon, className } = PRESENTATION[data.verdict];
  const canStart = data.verdict === "tier_1" || data.verdict === "tier_2";

  return (
    <Card className={cn("border", className)} data-testid="card-fatigue">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="w-4 h-4" />
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {data.activeDeload && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-card/60 p-3">
            <span className="text-sm">
              Tier {data.activeDeload.tier} deload is running.
              {data.activeDeload.tier === 2 && " Sets at 45% of normal, RIR 4–5 every set, no failure."}
            </span>
            <Button size="sm" variant="outline" onClick={() => endDeload.mutate(data.activeDeload!.id)}>
              Finish
            </Button>
          </div>
        )}

        {data.hardStops.map((stop) => (
          <p key={stop} className="text-sm text-destructive font-medium">
            {stop}
          </p>
        ))}

        {data.confound && <p className="text-sm text-muted-foreground">{data.confound}</p>}

        {data.triggers.length === 0 && data.hardStops.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing triggered across {data.sessionsConsidered} logged session
            {data.sessionsConsidered === 1 ? "" : "s"}.
          </p>
        )}

        {/* Evidence, not just a verdict — so the call can be argued with. */}
        {data.triggers.length > 0 && (
          <ul className="space-y-2">
            {data.triggers.map((trigger) => (
              <li key={trigger.id} className="text-sm">
                <span className="font-medium">{trigger.rule}</span>
                <span className="block text-muted-foreground text-xs mt-0.5">{trigger.evidence}</span>
              </li>
            ))}
          </ul>
        )}

        {data.reductionPlan.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Pull sets in this order:</p>
            {data.reductionPlan.map((step) => (
              <p key={step}>{step}</p>
            ))}
          </div>
        )}

        {canStart && !data.activeDeload && (
          <Button
            size="sm"
            className="w-full"
            disabled={startDeload.isPending}
            onClick={() => startDeload.mutate(data.verdict === "tier_2" ? 2 : 1)}
          >
            {startDeload.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Start {data.verdict === "tier_2" ? "full deload" : "set trim"}
          </Button>
        )}

        {data.unevaluated.length > 0 && (
          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setShowDetail((v) => !v)}
            >
              {showDetail ? "Hide" : `${data.unevaluated.length} signal(s) couldn't be checked`}
            </button>
            {showDetail && (
              <ul className="mt-2 space-y-1">
                {data.unevaluated.map((note) => (
                  <li key={note} className="text-xs text-muted-foreground">
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
