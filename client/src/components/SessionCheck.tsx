import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOINT_AREAS, JOINT_STATUSES, PUMP_QUALITIES, WARMUP_FEELS } from "@shared/program-rules";
import type { JointStatus, PumpQuality, WarmupFeel } from "@shared/program-rules";

export interface SessionCheckValue {
  jointStatus: JointStatus | null;
  jointAreas: string[];
  warmupFeel: WarmupFeel | null;
  pumpQuality: PumpQuality | null;
  sessionDread: boolean | null;
}

export const EMPTY_SESSION_CHECK: SessionCheckValue = {
  jointStatus: null,
  jointAreas: [],
  warmupFeel: null,
  pumpQuality: null,
  sessionDread: null,
};

interface Props {
  value: SessionCheckValue;
  onChange: (value: SessionCheckValue) => void;
}

function Choice({
  selected,
  onClick,
  children,
  tone = "neutral",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-2 rounded-md text-sm font-medium border transition-colors flex-1 min-w-0",
        selected
          ? tone === "bad"
            ? "bg-destructive/20 border-destructive text-destructive"
            : tone === "warn"
              ? "bg-warning/20 border-warning text-warning"
              : "bg-accent/20 border-accent text-accent"
          : "bg-card border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The four session inputs the deload triggers need.
 *
 * The program's RULES sheet lists joint status as something to record every
 * session (STANDING | tracked_inputs), and the Tier 1/2 triggers key on
 * warm-up feel, pump and session dread. None of it had anywhere to go, which
 * is why the app fell back to calling deloads off the calendar.
 *
 * Every field is optional. Skipping one doesn't block the save — it just means
 * the assessment will report that trigger as unevaluated rather than clear.
 */
export function SessionCheck({ value, onChange }: Props) {
  const set = (patch: Partial<SessionCheckValue>) => onChange({ ...value, ...patch });

  const toggleJoint = (area: string) => {
    const next = value.jointAreas.includes(area)
      ? value.jointAreas.filter((a) => a !== area)
      : [...value.jointAreas, area];
    set({ jointAreas: next });
  };

  return (
    <Card data-testid="card-session-check">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-accent" />
          Session check
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Feeds deload detection. Skip anything you'd rather not answer.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Joints</Label>
          <div className="flex gap-2">
            {JOINT_STATUSES.map((status) => (
              <Choice
                key={status}
                selected={value.jointStatus === status}
                onClick={() => set({ jointStatus: value.jointStatus === status ? null : status })}
                tone={status === "painful" ? "bad" : status === "achy" ? "warn" : "neutral"}
              >
                {status === "clean" ? "Clean" : status === "achy" ? "Achy" : "Painful"}
              </Choice>
            ))}
          </div>

          {/* Which joints matters: "2+ joints achy" is a Tier 2 trigger, and
              same-side shoulder trouble across pressing and laterals is a hard stop. */}
          {(value.jointStatus === "achy" || value.jointStatus === "painful") && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {JOINT_AREAS.map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => toggleJoint(area)}
                  className={cn(
                    "px-2 py-1 rounded text-[11px] border",
                    value.jointAreas.includes(area)
                      ? "bg-warning/20 border-warning text-warning"
                      : "bg-card border-border text-muted-foreground",
                  )}
                >
                  {area}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Warm-ups felt</Label>
          <div className="flex gap-2">
            {WARMUP_FEELS.map((feel) => (
              <Choice
                key={feel}
                selected={value.warmupFeel === feel}
                onClick={() => set({ warmupFeel: value.warmupFeel === feel ? null : feel })}
                tone={feel === "heavy" ? "warn" : "neutral"}
              >
                {feel === "normal" ? "Normal" : "Heavy"}
              </Choice>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Pump / mind-muscle</Label>
          <div className="flex gap-2">
            {PUMP_QUALITIES.map((quality) => (
              <Choice
                key={quality}
                selected={value.pumpQuality === quality}
                onClick={() => set({ pumpQuality: value.pumpQuality === quality ? null : quality })}
                tone={quality === "absent" ? "warn" : "neutral"}
              >
                {quality === "good" ? "Good" : quality === "normal" ? "Normal" : "Gone"}
              </Choice>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Dreaded this session</Label>
          <div className="flex gap-2">
            <Choice
              selected={value.sessionDread === false}
              onClick={() => set({ sessionDread: value.sessionDread === false ? null : false })}
            >
              No
            </Choice>
            <Choice
              selected={value.sessionDread === true}
              onClick={() => set({ sessionDread: value.sessionDread === true ? null : true })}
              tone="warn"
            >
              Yes
            </Choice>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
