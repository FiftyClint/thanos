import { describe, it, expect } from "vitest";
import { assessFatigue, type SessionSignal, type LiftPerformance } from "../server/lib/fatigue";

/**
 * Every trigger here is checked against the RULES sheet's own wording, in both
 * directions: it fires when the sheet says it should, and — more importantly —
 * it stays quiet when it shouldn't. A deload monitor that cries wolf gets
 * ignored, which is worse than not having one.
 */

let clock = 0;
function session(overrides: Partial<SessionSignal> = {}): SessionSignal {
  clock += 1;
  return {
    workoutId: `w${clock}`,
    day: 1,
    week: clock,
    // Later `week` means later date, so ordering is predictable in tests.
    date: new Date(2026, 0, 1 + (overrides.week ?? clock) * 7),
    jointStatus: "clean",
    jointAreas: [],
    warmupFeel: "normal",
    pumpQuality: "good",
    sessionDread: false,
    primary: null,
    lifts: [],
    ...overrides,
  };
}

function lift(name: string, topLoad: number, totalReps: number, lastSetRir: number | null = 2): LiftPerformance {
  return { exerciseId: name, name, topLoad, repsAtTopLoad: totalReps, totalReps, lastSetRir };
}

/** Three sessions of one day, primary going from `reps[0]` to `reps[2]`. */
function dayHistory(day: number, name: string, loads: number[], reps: number[], rirs: (number | null)[] = [2, 2, 2]) {
  return loads.map((load, i) => {
    const l = lift(name, load, reps[i], rirs[i]);
    return session({ day, week: i + 1, primary: l, lifts: [l] });
  });
}

describe("no data", () => {
  it("is clear, and says why it cannot assess", () => {
    const result = assessFatigue([]);
    expect(result.verdict).toBe("clear");
    expect(result.unevaluated[0]).toContain("No completed sessions");
  });
});

describe("Tier 1 — trim sets", () => {
  it("fires on a primary stalling: same load, fewer reps, two sessions running", () => {
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 135, 135], [40, 36, 33]));
    expect(result.verdict).toBe("tier_1");
    expect(result.triggers.map((t) => t.id)).toContain("primary_stall");
    expect(result.triggers[0].evidence).toContain("40");
  });

  it("stays quiet when reps are still climbing", () => {
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 135, 135], [33, 36, 40]));
    expect(result.verdict).toBe("clear");
  });

  it("stays quiet on a single bad session", () => {
    // The sheet says TWO consecutive. One is noise.
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 135, 135], [40, 40, 36]));
    expect(result.verdict).toBe("clear");
  });

  it("does not treat a load increase as a stall", () => {
    // Fewer reps at heavier load is progress, not fatigue.
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 145, 155], [40, 36, 33]));
    expect(result.triggers.map((t) => t.id)).not.toContain("primary_stall");
  });

  it("fires when the pump is gone two sessions running", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, pumpQuality: "good" }),
      session({ day: 1, week: 2, pumpQuality: "absent" }),
      session({ day: 1, week: 3, pumpQuality: "absent" }),
    ]);
    expect(result.verdict).toBe("tier_1");
    expect(result.triggers.map((t) => t.id)).toContain("pump_absent");
  });

  it("fires on a single joint achy two sessions running", () => {
    const result = assessFatigue([
      session({ day: 1, week: 2, jointStatus: "achy", jointAreas: ["right elbow"] }),
      session({ day: 1, week: 3, jointStatus: "achy", jointAreas: ["right elbow"] }),
    ]);
    expect(result.verdict).toBe("tier_1");
    const trigger = result.triggers.find((t) => t.id === "local_joint_ache");
    expect(trigger?.subject).toBe("right elbow");
  });

  it("gives a reduction plan in the sheet's order", () => {
    const result = assessFatigue(dayHistory(1, "Tricep Rope Pushdown", [60, 60, 60], [40, 36, 33]));
    expect(result.reductionPlan.join(" ")).toContain("triceps");
  });
});

describe("Tier 2 — full deload", () => {
  it("fires when two primaries regress two sessions running", () => {
    const result = assessFatigue([
      ...dayHistory(1, "Incline Press", [135, 130, 125], [40, 36, 33]),
      ...dayHistory(2, "Pulldown", [180, 175, 170], [42, 38, 35]),
      // A joint signal makes this overreaching rather than cut drift.
      session({ day: 3, week: 4, jointStatus: "achy", jointAreas: ["left shoulder", "right elbow"] }),
    ]);
    expect(result.verdict).toBe("tier_2");
    expect(result.triggers.map((t) => t.id)).toContain("multiple_primary_regression");
  });

  it("does not fire on a single regressing primary", () => {
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 130, 125], [40, 36, 33]));
    expect(result.triggers.map((t) => t.id)).not.toContain("multiple_primary_regression");
  });

  it("fires on RIR inflation across multiple lifts", () => {
    const before = session({
      day: 1,
      week: 1,
      lifts: [lift("Press", 135, 30, 1), lift("Raise", 30, 40, 1), lift("Pushdown", 60, 36, 1)],
    });
    const after = session({
      day: 1,
      week: 2,
      jointStatus: "achy",
      jointAreas: ["left shoulder", "right elbow"],
      lifts: [lift("Press", 135, 30, 3), lift("Raise", 30, 40, 3), lift("Pushdown", 60, 36, 2)],
    });
    const result = assessFatigue([before, after]);
    expect(result.triggers.map((t) => t.id)).toContain("rir_inflation");
  });

  it("ignores a higher RIR at a heavier load", () => {
    // Expected when you add weight — not a fatigue signal.
    const before = session({ day: 1, week: 1, lifts: [lift("Press", 135, 30, 1), lift("Raise", 30, 40, 1)] });
    const after = session({ day: 1, week: 2, lifts: [lift("Press", 145, 30, 3), lift("Raise", 35, 40, 3)] });
    expect(assessFatigue([before, after]).triggers.map((t) => t.id)).not.toContain("rir_inflation");
  });

  it("fires on joint pain in a working set", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: "painful", jointAreas: ["left knee"] }),
    ]);
    expect(result.triggers.map((t) => t.id)).toContain("joint_pain");
  });

  it("fires when two or more joints are achy in one session", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: "achy", jointAreas: ["left shoulder", "right knee"] }),
    ]);
    expect(result.triggers.map((t) => t.id)).toContain("multiple_joints_achy");
  });

  it("fires when warm-ups feel heavy two sessions running", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, warmupFeel: "heavy", jointStatus: "achy", jointAreas: ["left hip"] }),
      session({ day: 2, week: 2, warmupFeel: "heavy" }),
    ]);
    expect(result.triggers.map((t) => t.id)).toContain("warmups_heavy");
  });

  it("fires on session dread across three separate days", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, sessionDread: true }),
      session({ day: 2, week: 2, sessionDread: true }),
      session({ day: 3, week: 3, sessionDread: true }),
    ]);
    expect(result.triggers.map((t) => t.id)).toContain("session_dread");
  });

  it("does not fire on dread across only two days", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, sessionDread: true }),
      session({ day: 2, week: 2, sessionDread: true }),
    ]);
    expect(result.triggers.map((t) => t.id)).not.toContain("session_dread");
  });

  it("escalates when an actioned Tier 1 trim did not resolve it", () => {
    const sessions = dayHistory(1, "Incline Press", [135, 135, 135], [40, 36, 33]);
    const result = assessFatigue(sessions, {
      tier1Actioned: { trigger: "primary_stall", subject: "Incline Press", actionedAt: new Date(2026, 0, 15) },
    });
    expect(result.triggers.map((t) => t.id)).toContain("tier_1_failed");
    expect(result.verdict).toBe("tier_2");
  });
});

describe("confound check — normal cut drift vs overreaching", () => {
  it("holds at monitor when performance drifts with no joint or motivation signal", () => {
    // RULES: DELOAD_T2 | confound_check — this pattern is explicitly DO NOT DELOAD.
    const result = assessFatigue([
      ...dayHistory(1, "Incline Press", [135, 130, 125], [40, 36, 33]),
      ...dayHistory(2, "Pulldown", [180, 175, 170], [42, 38, 35]),
    ]);
    expect(result.verdict).toBe("monitor");
    expect(result.confound).toContain("normal cut drift");
    // The trigger still fired — it is the verdict that is held back.
    expect(result.triggers.map((t) => t.id)).toContain("multiple_primary_regression");
  });

  it("calls a deload once a joint signal appears alongside the decline", () => {
    const result = assessFatigue([
      ...dayHistory(1, "Incline Press", [135, 130, 125], [40, 36, 33]),
      ...dayHistory(2, "Pulldown", [180, 175, 170], [42, 38, 35]),
      session({ day: 3, week: 4, jointStatus: "achy", jointAreas: ["left shoulder"] }),
    ]);
    expect(result.verdict).toBe("tier_2");
    expect(result.confound).toBeNull();
  });

  it("calls a deload once motivation is gone alongside the decline", () => {
    const result = assessFatigue([
      ...dayHistory(1, "Incline Press", [135, 130, 125], [40, 36, 33]),
      ...dayHistory(2, "Pulldown", [180, 175, 170], [42, 38, 35]),
      session({ day: 3, week: 4, sessionDread: true }),
    ]);
    expect(result.verdict).toBe("tier_2");
  });
});

describe("hard stops", () => {
  it("raises a hard stop on joint pain, above any deload verdict", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: "painful", jointAreas: ["right shoulder"] }),
    ]);
    expect(result.verdict).toBe("hard_stop");
    expect(result.hardStops[0]).toContain("Sharp joint pain");
  });

  it("catches same-side shoulder trouble across pressing and lateral days", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: "achy", jointAreas: ["left shoulder"] }),
      session({ day: 5, week: 1, jointStatus: "achy", jointAreas: ["left shoulder"] }),
    ]);
    expect(result.hardStops.join(" ")).toContain("left shoulder");
  });

  it("does not raise it for opposite shoulders", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: "achy", jointAreas: ["left shoulder"] }),
      session({ day: 5, week: 1, jointStatus: "achy", jointAreas: ["right shoulder"] }),
    ]);
    expect(result.hardStops.join(" ")).not.toContain("Same-side");
  });
});

describe("honesty about missing inputs", () => {
  it("says which triggers could not be evaluated", () => {
    const result = assessFatigue([
      session({ day: 1, week: 1, jointStatus: null, warmupFeel: null, pumpQuality: null, sessionDread: null }),
    ]);
    const text = result.unevaluated.join(" ");
    expect(text).toContain("Joint status");
    expect(text).toContain("Warm-up feel");
    expect(text).toContain("Pump quality");
    expect(text).toContain("Session dread");
  });

  it("always notes that resting HR is not tracked", () => {
    // The third hard stop in the sheet. Reported as a gap rather than faked.
    const result = assessFatigue([session()]);
    expect(result.unevaluated.join(" ")).toContain("Resting HR");
  });

  it("is clear, not silent, when everything is filled in and fine", () => {
    const result = assessFatigue(dayHistory(1, "Incline Press", [135, 140, 145], [33, 36, 40]));
    expect(result.verdict).toBe("clear");
    expect(result.triggers).toHaveLength(0);
  });
});
