/**
 * Fatigue monitoring — the deload triggers from the program's RULES sheet.
 *
 * The app previously called a deload on a fixed calendar. The sheet prescribes
 * no such thing: deloads there are FATIGUE-TRIGGERED, in two tiers, off signals
 * the athlete actually produces.
 *
 * Everything here is a pure function of logged data. Nothing auto-applies — the
 * output is a recommendation with its evidence attached, because
 * DELOAD_T2 | confound_check requires telling normal cut drift from
 * overreaching, and that is a judgment the athlete makes, not the app.
 *
 * Read alongside shared/program-rules.ts, which holds the transcribed rules.
 */
import type { DeloadTier, JointStatus, PumpQuality, WarmupFeel } from "@shared/program-rules";
import { REDUCTION_ORDER } from "@shared/program-rules";

/** One lift's performance within a session, reduced to what the triggers need. */
export interface LiftPerformance {
  exerciseId: string;
  name: string;
  /** Heaviest working-set load in the session. */
  topLoad: number;
  /** Total reps completed at that load. */
  repsAtTopLoad: number;
  /** Total reps across all working sets — the sheet's progression unit. */
  totalReps: number;
  /** RIR on the final set, which is the sheet's reference point. */
  lastSetRir: number | null;
}

/** A completed session, plus the subjective inputs the triggers require. */
export interface SessionSignal {
  workoutId: string;
  day: number;
  week: number;
  date: Date;
  jointStatus: JointStatus | null;
  /** Which joints, for "2+ joints achy" and the same-side shoulder hard stop. */
  jointAreas: string[];
  warmupFeel: WarmupFeel | null;
  pumpQuality: PumpQuality | null;
  sessionDread: boolean | null;
  /** The day's primary lift: first working exercise, excluding the vacuum. */
  primary: LiftPerformance | null;
  lifts: LiftPerformance[];
}

export type TriggerId =
  | "primary_stall"
  | "pump_absent"
  | "local_joint_ache"
  | "multiple_primary_regression"
  | "rir_inflation"
  | "joint_pain"
  | "multiple_joints_achy"
  | "warmups_heavy"
  | "session_dread"
  | "tier_1_failed";

export interface FiredTrigger {
  id: TriggerId;
  tier: DeloadTier;
  /** The sheet's own wording, so the app never invents a rule. */
  rule: string;
  /** What in the data made it fire. */
  evidence: string;
  /** For Tier 1, which muscle or lift to trim. */
  subject?: string;
}

export type Verdict = "clear" | "monitor" | "tier_1" | "tier_2" | "hard_stop";

export interface FatigueAssessment {
  verdict: Verdict;
  triggers: FiredTrigger[];
  hardStops: string[];
  /** Why a Tier 2 trigger was held at "monitor" — the confound check. */
  confound: string | null;
  /** Ordered set-reduction guidance for a Tier 1 trim. */
  reductionPlan: string[];
  /** Sessions the assessment could draw on. Too few and it says so. */
  sessionsConsidered: number;
  /** Signals that could not be evaluated because the input was never recorded. */
  unevaluated: string[];
}

/** Most recent first, for a single training day. */
function byDayDescending(sessions: SessionSignal[], day: number): SessionSignal[] {
  return sessions
    .filter((s) => s.day === day)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** A lift regressed if load dropped, or load held and reps fell. */
function regressed(current: LiftPerformance, previous: LiftPerformance): boolean {
  if (current.topLoad < previous.topLoad) return true;
  return current.topLoad === previous.topLoad && current.totalReps < previous.totalReps;
}

/** Stalled per DELOAD_T1: same load, fewer reps. Not a load drop — that is regression. */
function stalled(current: LiftPerformance, previous: LiftPerformance): boolean {
  return current.topLoad === previous.topLoad && current.totalReps < previous.totalReps;
}

function findLift(session: SessionSignal, exerciseId: string): LiftPerformance | undefined {
  return session.lifts.find((l) => l.exerciseId === exerciseId);
}

// ── Tier 1 ──────────────────────────────────────────────────────────────────

/**
 * "One muscle's primary stalls (same load, fewer reps, 2 consecutive sessions)".
 *
 * Two consecutive stalls means three sessions of that day: the two most recent
 * each worse than the one before.
 */
function checkPrimaryStall(daySessions: SessionSignal[]): FiredTrigger | null {
  const [latest, previous, before] = daySessions;
  if (!latest?.primary || !previous || !before) return null;

  const latestLift = latest.primary;
  const previousLift = findLift(previous, latestLift.exerciseId);
  const beforeLift = findLift(before, latestLift.exerciseId);
  if (!previousLift || !beforeLift) return null;

  if (stalled(latestLift, previousLift) && stalled(previousLift, beforeLift)) {
    return {
      id: "primary_stall",
      tier: 1,
      rule: "One muscle's primary stalls (same load, fewer reps, 2 consecutive sessions)",
      evidence:
        `${latestLift.name} held ${latestLift.topLoad} lb across three sessions ` +
        `while total reps fell ${beforeLift.totalReps} → ${previousLift.totalReps} → ${latestLift.totalReps}.`,
      subject: latestLift.name,
    };
  }
  return null;
}

/** "Pump/MMC gone on one muscle 2 sessions". */
function checkPumpAbsent(daySessions: SessionSignal[]): FiredTrigger | null {
  const [latest, previous] = daySessions;
  if (latest?.pumpQuality !== "absent" || previous?.pumpQuality !== "absent") return null;

  return {
    id: "pump_absent",
    tier: 1,
    rule: "Pump/MMC gone on one muscle 2 sessions",
    evidence: `Pump reported absent on the last two day ${latest.day} sessions.`,
    subject: latest.primary?.name,
  };
}

/** "Localized joint ACHE 2 sessions" — one joint, achy not painful. */
function checkLocalJointAche(daySessions: SessionSignal[]): FiredTrigger | null {
  const [latest, previous] = daySessions;
  if (latest?.jointStatus !== "achy" || previous?.jointStatus !== "achy") return null;
  // Two or more achy joints is a Tier 2 signal, handled separately.
  if (latest.jointAreas.length > 1) return null;

  const joint = latest.jointAreas[0] ?? "a joint";
  return {
    id: "local_joint_ache",
    tier: 1,
    rule: "Localized joint ACHE 2 sessions",
    evidence: `${joint} reported achy on the last two day ${latest.day} sessions.`,
    subject: joint,
  };
}

// ── Tier 2 ──────────────────────────────────────────────────────────────────

/** "2+ primaries regress 2 consecutive sessions" — across days, not within one. */
function checkMultiplePrimaryRegression(sessions: SessionSignal[]): FiredTrigger | null {
  const days = [...new Set(sessions.map((s) => s.day))];
  const regressing: string[] = [];

  for (const day of days) {
    const [latest, previous, before] = byDayDescending(sessions, day);
    if (!latest?.primary || !previous || !before) continue;

    const latestLift = latest.primary;
    const previousLift = findLift(previous, latestLift.exerciseId);
    const beforeLift = findLift(before, latestLift.exerciseId);
    if (!previousLift || !beforeLift) continue;

    if (regressed(latestLift, previousLift) && regressed(previousLift, beforeLift)) {
      regressing.push(latestLift.name);
    }
  }

  if (regressing.length < 2) return null;
  return {
    id: "multiple_primary_regression",
    tier: 2,
    rule: "2+ primaries regress 2 consecutive sessions",
    evidence: `${regressing.length} primaries regressing two sessions running: ${regressing.join(", ")}.`,
  };
}

/**
 * "RIR inflation across multiple lifts".
 *
 * The same load feeling further from failure than it did — the last set's RIR
 * rising while load is unchanged or lower. One lift is noise; several is a
 * systemic signal.
 */
function checkRirInflation(sessions: SessionSignal[]): FiredTrigger | null {
  const days = [...new Set(sessions.map((s) => s.day))];
  const inflating: string[] = [];

  for (const day of days) {
    const [latest, previous] = byDayDescending(sessions, day);
    if (!latest || !previous) continue;

    for (const lift of latest.lifts) {
      const before = findLift(previous, lift.exerciseId);
      if (!before || lift.lastSetRir === null || before.lastSetRir === null) continue;
      if (lift.topLoad > before.topLoad) continue; // heavier: a higher RIR is expected

      if (lift.lastSetRir > before.lastSetRir) inflating.push(lift.name);
    }
  }

  if (inflating.length < 2) return null;
  return {
    id: "rir_inflation",
    tier: 2,
    rule: "RIR inflation across multiple lifts",
    evidence: `Last-set RIR rose at the same or lower load on ${inflating.length} lifts: ${[...new Set(inflating)].join(", ")}.`,
  };
}

/** "Joint PAIN in a working set". */
function checkJointPain(sessions: SessionSignal[]): FiredTrigger | null {
  const painful = sessions.find((s) => s.jointStatus === "painful");
  if (!painful) return null;

  return {
    id: "joint_pain",
    tier: 2,
    rule: "Joint PAIN in a working set",
    evidence: `Pain reported on day ${painful.day}, week ${painful.week}${
      painful.jointAreas.length ? ` (${painful.jointAreas.join(", ")})` : ""
    }.`,
  };
}

/** "…or 2+ joints achy". */
function checkMultipleJointsAchy(sessions: SessionSignal[]): FiredTrigger | null {
  const latest = [...sessions].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (!latest || latest.jointStatus !== "achy" || latest.jointAreas.length < 2) return null;

  return {
    id: "multiple_joints_achy",
    tier: 2,
    rule: "2+ joints achy",
    evidence: `${latest.jointAreas.length} joints achy in the same session: ${latest.jointAreas.join(", ")}.`,
  };
}

/** "Warm-ups feel heavy 2 sessions". */
function checkWarmupsHeavy(sessions: SessionSignal[]): FiredTrigger | null {
  const recent = [...sessions].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 2);
  if (recent.length < 2 || !recent.every((s) => s.warmupFeel === "heavy")) return null;

  return {
    id: "warmups_heavy",
    tier: 2,
    rule: "Warm-ups feel heavy 2 sessions",
    evidence: "Warm-ups reported heavy in the last two sessions.",
  };
}

/** "Session dread 3+ days". */
function checkSessionDread(sessions: SessionSignal[]): FiredTrigger | null {
  const dreadDays = new Set(
    sessions.filter((s) => s.sessionDread === true).map((s) => s.date.toISOString().slice(0, 10)),
  );
  if (dreadDays.size < 3) return null;

  return {
    id: "session_dread",
    tier: 2,
    rule: "Session dread 3+ days",
    evidence: `Dread reported on ${dreadDays.size} separate days.`,
  };
}

// ── Hard stops ──────────────────────────────────────────────────────────────

/**
 * RULES: HARD_STOP | any_one.
 *
 * Resting HR is the third hard stop and is deliberately absent: the app does
 * not collect it, and inferring one would be worse than reporting the gap.
 */
function checkHardStops(sessions: SessionSignal[]): string[] {
  const stops: string[] = [];
  const recent = [...sessions].sort((a, b) => b.date.getTime() - a.date.getTime());

  const painful = recent.find((s) => s.jointStatus === "painful");
  if (painful) {
    stops.push(
      `Sharp joint pain that changes form — pain logged on day ${painful.day}, week ${painful.week}. ` +
        `Confirm whether it altered your form.`,
    );
  }

  // "Same-side shoulder pain on BOTH pressing and laterals". Days 1, 3 and 5
  // are the pressing/lateral days in this split (RULES: SPLIT).
  const PRESS_OR_LATERAL_DAYS = [1, 3, 5];
  for (const side of ["left", "right"]) {
    const affected = recent.filter(
      (s) =>
        PRESS_OR_LATERAL_DAYS.includes(s.day) &&
        (s.jointStatus === "painful" || s.jointStatus === "achy") &&
        s.jointAreas.some((a) => a.toLowerCase().includes(`${side} shoulder`)),
    );
    if (new Set(affected.map((s) => s.day)).size >= 2) {
      stops.push(`Same-side shoulder pain on both pressing and lateral days (${side} shoulder).`);
    }
  }

  return stops;
}

// ── Confound check ──────────────────────────────────────────────────────────

/**
 * RULES: DELOAD_T2 | confound_check.
 *
 * "NORMAL CUT DRIFT (gradual over 3-4 wks, isolated, no joint signal) = DO NOT
 * DELOAD. OVERREACHING (abrupt, multiple lifts, joints, motivation gone) =
 * DELOAD."
 *
 * Returns an explanation when the pattern looks like ordinary drift, which
 * holds a Tier 2 recommendation at "monitor" instead of calling a deload during
 * a cut where some decline is expected.
 */
function assessConfound(triggers: FiredTrigger[], sessions: SessionSignal[]): string | null {
  const tier2 = triggers.filter((t) => t.tier === 2);
  if (tier2.length === 0) return null;

  const hasJointSignal = sessions.some((s) => s.jointStatus === "achy" || s.jointStatus === "painful");
  const hasMotivationSignal = sessions.some((s) => s.sessionDread === true);
  const affectsMultipleLifts = tier2.some(
    (t) => t.id === "multiple_primary_regression" || t.id === "rir_inflation",
  );

  // Overreaching per the sheet: abrupt, multiple lifts, joints, motivation gone.
  if (hasJointSignal || hasMotivationSignal) return null;

  if (affectsMultipleLifts && !hasJointSignal && !hasMotivationSignal) {
    return (
      "Looks like normal cut drift rather than overreaching: performance is declining, but with " +
      "no joint signal and no motivation signal. The RULES sheet says do NOT deload on this pattern. " +
      "Hold, and re-check after the next two sessions."
    );
  }
  return null;
}

// ── Reduction plan ──────────────────────────────────────────────────────────

/** RULES: REDUCTION | order_1 … order_last, filtered to what actually fired. */
function buildReductionPlan(triggers: FiredTrigger[]): string[] {
  if (!triggers.some((t) => t.tier === 1)) return [];

  const subjects = triggers
    .filter((t) => t.tier === 1 && t.subject)
    .map((t) => t.subject!.toLowerCase());

  const plan = REDUCTION_ORDER.filter((entry) =>
    subjects.some((subject) => entry.match.test(subject)),
  ).map((entry) => `${entry.rank}. ${entry.target}`);

  // Nothing matched the affected muscle: give the order as written so the
  // athlete still trims in the prescribed sequence.
  if (plan.length === 0) {
    return REDUCTION_ORDER.map((entry) => `${entry.rank}. ${entry.target}`);
  }
  return plan;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface AssessOptions {
  /** A Tier 1 trim was actioned and its trigger still fires — escalates to Tier 2. */
  tier1Actioned?: { trigger: TriggerId; subject?: string; actionedAt: Date } | null;
}

/**
 * Evaluate every trigger the recorded data supports.
 *
 * Signals whose inputs were never filled in are reported as unevaluated rather
 * than silently treated as absent — a trigger that cannot fire because nobody
 * answered the question is not the same as one that did not fire.
 */
export function assessFatigue(
  sessions: SessionSignal[],
  options: AssessOptions = {},
): FatigueAssessment {
  const triggers: FiredTrigger[] = [];
  const unevaluated: string[] = [];

  if (sessions.length === 0) {
    return {
      verdict: "clear",
      triggers: [],
      hardStops: [],
      confound: null,
      reductionPlan: [],
      sessionsConsidered: 0,
      unevaluated: ["No completed sessions yet — nothing to assess."],
    };
  }

  const days = [...new Set(sessions.map((s) => s.day))];

  for (const day of days) {
    const daySessions = byDayDescending(sessions, day);
    const stall = checkPrimaryStall(daySessions);
    if (stall) triggers.push(stall);
    const pump = checkPumpAbsent(daySessions);
    if (pump) triggers.push(pump);
    const ache = checkLocalJointAche(daySessions);
    if (ache) triggers.push(ache);
  }

  for (const check of [
    checkMultiplePrimaryRegression,
    checkRirInflation,
    checkJointPain,
    checkMultipleJointsAchy,
    checkWarmupsHeavy,
    checkSessionDread,
  ]) {
    const fired = check(sessions);
    if (fired) triggers.push(fired);
  }

  // "Tier 1 failed" — a trim was actioned and its trigger is still firing.
  if (options.tier1Actioned) {
    const stillFiring = triggers.some(
      (t) => t.id === options.tier1Actioned!.trigger && t.subject === options.tier1Actioned!.subject,
    );
    if (stillFiring) {
      triggers.push({
        id: "tier_1_failed",
        tier: 2,
        rule: "Tier 1 failed",
        evidence:
          `A Tier 1 trim was actioned on ${options.tier1Actioned.actionedAt.toISOString().slice(0, 10)} ` +
          `and ${options.tier1Actioned.subject ?? "the same signal"} is still triggering.`,
      });
    }
  }

  // Report the questions nobody answered, so a quiet result is honest.
  if (sessions.every((s) => s.jointStatus === null)) {
    unevaluated.push("Joint status was never recorded — joint ache, joint pain and the shoulder hard stop cannot fire.");
  }
  if (sessions.every((s) => s.warmupFeel === null)) {
    unevaluated.push("Warm-up feel was never recorded — 'warm-ups feel heavy' cannot fire.");
  }
  if (sessions.every((s) => s.pumpQuality === null)) {
    unevaluated.push("Pump quality was never recorded — 'pump/MMC gone' cannot fire.");
  }
  if (sessions.every((s) => s.sessionDread === null)) {
    unevaluated.push("Session dread was never recorded — 'session dread 3+ days' cannot fire.");
  }
  unevaluated.push("Resting HR is not tracked by this app — the 'RHR elevated 7+ days' hard stop cannot fire.");

  const hardStops = checkHardStops(sessions);
  const confound = assessConfound(triggers, sessions);

  let verdict: Verdict = "clear";
  if (hardStops.length > 0) verdict = "hard_stop";
  else if (triggers.some((t) => t.tier === 2)) verdict = confound ? "monitor" : "tier_2";
  else if (triggers.some((t) => t.tier === 1)) verdict = "tier_1";

  return {
    verdict,
    triggers,
    hardStops,
    confound,
    reductionPlan: buildReductionPlan(triggers),
    sessionsConsidered: sessions.length,
    unevaluated,
  };
}
