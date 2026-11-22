import { describe, it, expect } from "vitest";
import { PROGRAMS } from "../server/seed";
import { applyProgramRules, getCurrentPhase } from "../server/lib/program";
import { bulkPhaseLabel, PLUS_ONE_TAG } from "@shared/bulk-rules";
import { programWeek, seasonOf, calendarOf, LEGACY_SEASON } from "@shared/seasons";
import { assessFatigue, type SessionSignal } from "../server/lib/fatigue";

const phase4 = PROGRAMS.phase4;
const working = (day: number, week: number) =>
  applyProgramRules(
    phase4
      .filter((e) => e.day === day && e.segment === "working")
      .map((e) => ({ ...e, notes: e.notes ?? null, segment: e.segment ?? "working" })),
    "phase4",
    week,
  ).sort((a, b) => a.order - b.order);

describe("seasons", () => {
  it("puts Phases 1-3 in the 2026 season and Phase 4 in 2027", () => {
    expect(seasonOf("phase1")).toBe(LEGACY_SEASON);
    expect(seasonOf("phase3")).toBe(2026);
    expect(seasonOf("phase4")).toBe(2027);
  });

  it("starts Phase 4 at Week 1 on Monday 11/23/2026", () => {
    expect(programWeek("phase4", null, new Date(2026, 10, 23, 5, 40))).toBe(1);
    expect(programWeek("phase4", null, new Date(2026, 10, 29, 23, 0))).toBe(1);
    expect(programWeek("phase4", null, new Date(2026, 10, 30, 5, 40))).toBe(2);
    expect(programWeek("phase4", null, new Date(2027, 2, 8, 5, 40))).toBe(16);
  });

  it("ignores the Prep Start Date for Phase 4 but keeps it for Phase 3", () => {
    expect(programWeek("phase4", "2026-02-01", new Date(2026, 11, 7))).toBe(3);
    // The legacy formula, unchanged, so logged Phase 3 weeks keep their numbers.
    const now = new Date("2026-03-01T12:00:00Z");
    const diffDays = Math.ceil((now.getTime() - new Date("2026-02-01").getTime()) / 86_400_000);
    expect(programWeek("phase3", "2026-02-01", now)).toBe(Math.ceil(diffDays / 7));
  });

  it("treats the bulk as a surplus and the cut as a deficit", () => {
    expect(calendarOf("phase4").energyBalance).toBe("surplus");
    expect(calendarOf("phase3").energyBalance).toBe("deficit");
  });
});

describe("Phase 4 program", () => {
  it("opens every day with the stomach vacuum", () => {
    for (let day = 1; day <= 6; day++) expect(working(day, 2)[0].name).toBe("Stomach Vacuum");
  });

  it("has no Smith machine squat", () => {
    expect(phase4.some((e) => /smith/i.test(e.name) && /squat/i.test(e.name))).toBe(false);
  });

  it("swaps to the Block 2 exercises in weeks 7-12 only", () => {
    const names = (week: number) => working(1, week).map((e) => e.name);
    expect(names(6)).toContain("Hack Squat");
    expect(names(6)).not.toContain("Pendulum Squat");
    expect(names(7)).toContain("Pendulum Squat");
    expect(names(7)).not.toContain("Hack Squat");
    expect(names(12)).toContain("Pendulum Squat");
    expect(names(13)).toContain("Hack Squat");
  });

  it("shows exactly one movement per slot every week", () => {
    for (let week = 1; week <= 16; week++) {
      for (let day = 1; day <= 6; day++) {
        const orders = working(day, week).map((e) => e.order);
        expect(new Set(orders).size).toBe(orders.length);
      }
    }
  });

  it("adds one set to the first lift Mon, Tue, Thu, Fri in the + weeks", () => {
    for (const day of [1, 2, 4, 5]) {
      const first = (week: number) => working(day, week)[1];
      expect(first(3).defaultSets + 1).toBe(first(4).defaultSets);
      expect(first(6).defaultSets).toBe(first(3).defaultSets);
      expect(first(11).defaultSets).toBe(first(9).defaultSets + 1);
      expect(first(16).defaultSets).toBe(first(14).defaultSets + 1);
    }
    for (const day of [3, 6]) {
      expect(working(day, 4).every((e) => !(e.notes ?? "").includes(PLUS_ONE_TAG))).toBe(true);
    }
  });

  it("sets RIR 3 on every hypertrophy set in Week 1 and leaves the vacuum alone", () => {
    const week1 = working(2, 1);
    expect(week1[0].rir).toBe("skill");
    expect(week1.slice(1).every((e) => e.rir === "3")).toBe(true);
    expect(working(2, 2)[1].rir).toBe("1-2");
  });

  it("matches the planned weekly sets for the priority muscles", () => {
    const total = (day: number) => working(day, 2).slice(1).reduce((n, e) => n + e.defaultSets, 0);
    expect([1, 2, 3, 4, 5, 6].map(total)).toEqual([20, 18, 20, 22, 21, 17]);
  });

  it("labels the weeks", () => {
    expect(bulkPhaseLabel(1)).toBe("Re-entry");
    expect(bulkPhaseLabel(4)).toBe("Block 1 Build +");
    expect(bulkPhaseLabel(7)).toBe("Block 2 Build");
    expect(bulkPhaseLabel(13)).toBe("Block 3 Build");
    expect(bulkPhaseLabel(17)).toBe("Reassess");
    expect(getCurrentPhase(4, "phase4")).toBe("Block 1 Build +");
    expect(getCurrentPhase(4, "phase3")).toBe("Base");
  });
});

describe("fatigue in a surplus", () => {
  const session = (week: number, day: number, load: number, reps: number): SessionSignal => {
    const primary = { exerciseId: `p${day}`, name: `Primary ${day}`, topLoad: load, repsAtTopLoad: reps, totalReps: reps, lastSetRir: 2 };
    return {
    workoutId: `${week}-${day}`,
    day,
    week,
    date: new Date(2026, 11, week * 7 + day),
    jointStatus: "clean",
    jointAreas: [],
    warmupFeel: "normal",
    pumpQuality: "normal",
    sessionDread: false,
    primary,
    lifts: [primary],
    };
  };
  // Two primaries regressing across consecutive sessions: a Tier 2 pattern.
  const sessions = [
    session(3, 1, 300, 24), session(3, 2, 200, 24),
    session(2, 1, 300, 30), session(2, 2, 200, 30),
    session(1, 1, 300, 36), session(1, 2, 200, 36),
  ];

  it("does not excuse a Tier 2 pattern as cut drift during a bulk", () => {
    const cut = assessFatigue(sessions, { energyBalance: "deficit" });
    const bulk = assessFatigue(sessions, { energyBalance: "surplus" });
    expect(cut.triggers.some((t) => t.tier === 2)).toBe(true);
    expect(cut.verdict).toBe("monitor");
    expect(bulk.confound).toBeNull();
    expect(bulk.verdict).toBe("tier_2");
  });
});
