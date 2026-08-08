import { describe, it, expect } from "vitest";
import {
  getCurrentPhase,
  isDeloadWeek,
  setsForWeek,
  applyRampSets,
  applyProgramRules,
  parseRepRangeMin,
  parseRepRangeMax,
  getIncrement,
  getIncrementForExercise,
  isUnilateralInputType,
  isUnloadedInputType,
} from "../server/lib/program";

describe("getCurrentPhase", () => {
  it("maps the 36-week macrocycle to its phases", () => {
    expect(getCurrentPhase(1)).toBe("Base");
    expect(getCurrentPhase(10)).toBe("Base");
    expect(getCurrentPhase(11)).toBe("Diet Break 1");
    expect(getCurrentPhase(12)).toBe("Cut 1");
    expect(getCurrentPhase(21)).toBe("Cut 1");
    expect(getCurrentPhase(22)).toBe("Diet Break 2");
    expect(getCurrentPhase(23)).toBe("Cut 2");
    expect(getCurrentPhase(31)).toBe("Cut 2");
    expect(getCurrentPhase(32)).toBe("Peak");
    expect(getCurrentPhase(36)).toBe("Peak");
  });

  it("has no gap between phases", () => {
    for (let week = 1; week <= 36; week++) {
      expect(getCurrentPhase(week)).toBeTruthy();
    }
  });
});

describe("isDeloadWeek", () => {
  it("marks only the scheduled deloads", () => {
    const deloads = [4, 8, 16, 24, 32];
    for (let week = 1; week <= 36; week++) {
      expect(isDeloadWeek(week)).toBe(deloads.includes(week));
    }
  });
});

describe("setsForWeek", () => {
  it("leaves volume alone in a normal week", () => {
    expect(setsForWeek(4, 5)).toBe(4);
    expect(setsForWeek(3, 5)).toBe(3);
  });

  it("drops two sets from high-volume work on a deload", () => {
    expect(setsForWeek(5, 4)).toBe(3);
    expect(setsForWeek(4, 8)).toBe(2);
  });

  it("drops one set from low-volume work on a deload", () => {
    expect(setsForWeek(3, 4)).toBe(2);
    expect(setsForWeek(2, 4)).toBe(2);
  });

  it("never goes below two working sets", () => {
    for (const sets of [1, 2, 3, 4, 5, 6]) {
      expect(setsForWeek(sets, 16)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("rep range parsing", () => {
  it("reads both ends of a range", () => {
    expect(parseRepRangeMin("8-12")).toBe(8);
    expect(parseRepRangeMax("8-12")).toBe(12);
  });

  it("handles a single number", () => {
    expect(parseRepRangeMin("10")).toBe(10);
    expect(parseRepRangeMax("10")).toBe(10);
  });

  it("reads a range that carries a suffix", () => {
    // Real values from the seed: "15-20/side", "30-45s".
    expect(parseRepRangeMin("15-20/side")).toBe(15);
    expect(parseRepRangeMax("15-20/side")).toBe(20);
    expect(parseRepRangeMin("30-45s")).toBe(30);
    expect(parseRepRangeMax("30-45s")).toBe(45);
  });

  it("takes the leading number of a prose range, defaulting the other end", () => {
    // "2 × 20 yds" has no dash, so the leading 2 is both ends of the range.
    expect(parseRepRangeMin("2 × 20 yds")).toBe(2);
    expect(parseRepRangeMax("2 × 20 yds")).toBe(2);
  });

  it("falls back when there is no number at all", () => {
    expect(parseRepRangeMin("to failure")).toBe(6);
    expect(parseRepRangeMax("to failure")).toBe(12);
  });
});

describe("load increments", () => {
  it("uses 5 lb steps for standard loaded work", () => {
    expect(getIncrement("weight_reps")).toBe(5);
    expect(getIncrement("weight_reps_db")).toBe(5);
  });

  it("uses 2.5 lb steps for bodyweight progressions", () => {
    expect(getIncrement("bodyweight_reps")).toBe(2.5);
  });

  it("gives no increment to unloaded movements", () => {
    expect(getIncrement("band_reps")).toBe(0);
    expect(getIncrement("timed")).toBe(0);
    expect(getIncrement("cardio")).toBe(0);
  });

  it("jumps 10 lbs on the big braced lifts", () => {
    expect(getIncrementForExercise({ name: "Belt Squat", inputType: "weight_reps" })).toBe(10);
    expect(getIncrementForExercise({ name: "BB Hip Thrust", inputType: "weight_reps" })).toBe(10);
    expect(getIncrementForExercise({ name: "Leg Press (Wide)", inputType: "weight_reps" })).toBe(10);
    expect(getIncrementForExercise({ name: "Cable Lateral Raise", inputType: "weight_reps" })).toBe(5);
  });
});

describe("input type classification", () => {
  it("recognises unilateral work", () => {
    expect(isUnilateralInputType("weight_reps_unilateral")).toBe(true);
    expect(isUnilateralInputType("weight_reps_unilateral_db")).toBe(true);
    expect(isUnilateralInputType("weight_reps")).toBe(false);
  });

  it("recognises movements with no load to recommend", () => {
    expect(isUnloadedInputType("band_reps")).toBe(true);
    expect(isUnloadedInputType("timed")).toBe(true);
    expect(isUnloadedInputType("cardio")).toBe(true);
    expect(isUnloadedInputType("reps_unilateral_band")).toBe(true);
    expect(isUnloadedInputType("weight_reps")).toBe(false);
  });
});

describe("applyRampSets", () => {
  const exercise = { notes: "Constant tension. RAMP +2 sets at Wk13", defaultSets: 3 };

  it("holds volume before the ramp week", () => {
    expect(applyRampSets(exercise, 12).defaultSets).toBe(3);
  });

  it("adds the sets from the ramp week onward", () => {
    expect(applyRampSets(exercise, 13).defaultSets).toBe(5);
    expect(applyRampSets(exercise, 30).defaultSets).toBe(5);
  });

  it("accepts the singular 'set' spelling", () => {
    expect(applyRampSets({ notes: "RAMP +1 set at Wk9", defaultSets: 4 }, 9).defaultSets).toBe(5);
  });

  it("ignores notes without a ramp instruction", () => {
    expect(applyRampSets({ notes: "Slow eccentric, full ROM", defaultSets: 3 }, 30).defaultSets).toBe(3);
    expect(applyRampSets({ notes: null, defaultSets: 3 }, 30).defaultSets).toBe(3);
  });

  it("does not mutate the input", () => {
    const original = { ...exercise };
    applyRampSets(exercise, 20);
    expect(exercise).toEqual(original);
  });
});

describe("applyProgramRules", () => {
  const exercises = [{ notes: "RAMP +2 sets at Wk13", defaultSets: 3 }];

  it("applies ramps only to phase 3", () => {
    expect(applyProgramRules(exercises, "phase3", 20)[0].defaultSets).toBe(5);
    expect(applyProgramRules(exercises, "phase1", 20)[0].defaultSets).toBe(3);
    expect(applyProgramRules(exercises, "phase2", 20)[0].defaultSets).toBe(3);
  });
});

describe("deload schedule is defined once", () => {
  it("matches the shared definition the client also uses", async () => {
    // The client and server each had their own rule, sharing no weeks. Both now
    // import this one, so they cannot drift apart again.
    const shared = await import("@shared/program-rules");
    for (let week = 1; week <= 52; week++) {
      expect(isDeloadWeek(week), `week ${week}`).toBe(shared.isDeloadWeek(week));
    }
  });

  it("is a documented list, not an arithmetic accident", async () => {
    const { SCHEDULED_DELOAD_WEEKS } = await import("@shared/program-rules");
    expect([...SCHEDULED_DELOAD_WEEKS]).toEqual([4, 8, 16, 24, 32]);
  });
});

describe("reduction order matching", () => {
  it("does not mistake lateral delt work for lat work", async () => {
    // /lat/ matches "LATeral", so a lateral-delt stall was recommending cutting
    // lats — the sheet's priority muscle and the one it says to cut LAST.
    const { REDUCTION_ORDER } = await import("@shared/program-rules");
    const lats = REDUCTION_ORDER.find((r) => r.rank === 5)!;
    const laterals = REDUCTION_ORDER.find((r) => r.rank === 6)!;

    expect(lats.match.test("Single-Arm Behind-Body Cable Lateral Raise")).toBe(false);
    expect(laterals.match.test("Single-Arm Behind-Body Cable Lateral Raise")).toBe(true);

    // Still matches actual lat work.
    for (const name of ["Lat Pulldown", "Bench-Supported Pullover", "Seated Cable Row", "Lats"]) {
      expect(lats.match.test(name), name).toBe(true);
    }
  });

  it("keeps lateral delt work last in the order", async () => {
    // RULES: REDUCTION | order_last — priority muscle, cut only if it deteriorates.
    const { REDUCTION_ORDER } = await import("@shared/program-rules");
    expect(REDUCTION_ORDER[REDUCTION_ORDER.length - 1].target).toContain("Lateral delt");
  });
});
