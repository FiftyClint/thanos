import { describe, it, expect } from "vitest";
import { PROGRAMS, PROGRAM_IDS } from "../server/seed";
import { phase1Exercises } from "../server/seed/phase1";
import { phase2Exercises } from "../server/seed/phase2";
import { phase3Exercises } from "../server/seed/phase3";
import { SEGMENTS } from "@shared/schema";

/**
 * Guards on the program content itself.
 *
 * The seeder syncs on (program, day, order, number), so a duplicate key would
 * silently make one row overwrite another — these tests catch that at commit
 * time rather than after a deploy has already dropped an exercise.
 */
describe("program content", () => {
  it("carries the expected number of exercises", () => {
    expect(phase1Exercises).toHaveLength(117);
    expect(phase2Exercises).toHaveLength(66);
    expect(phase3Exercises).toHaveLength(129);
  });

  it("reuses the Phase 1 warm-ups and cool-downs for Phase 2", () => {
    const shared = phase1Exercises.filter((e) => e.segment === "warmup" || e.segment === "cooldown");
    expect(PROGRAMS.phase2).toHaveLength(phase2Exercises.length + shared.length);
  });

  for (const program of PROGRAM_IDS) {
    describe(program, () => {
      const exercises = PROGRAMS[program];

      it("has a unique (day, order, number) for every exercise", () => {
        const seen = new Map<string, string>();
        const duplicates: string[] = [];
        for (const e of exercises) {
          const key = `${e.day}|${e.order}|${e.number}`;
          if (seen.has(key)) duplicates.push(`${key} → "${seen.get(key)}" and "${e.name}"`);
          seen.set(key, e.name);
        }
        expect(duplicates).toEqual([]);
      });

      it("tags every exercise with this program", () => {
        expect(exercises.every((e) => e.program === program)).toBe(true);
      });

      it("covers all six training days", () => {
        expect([...new Set(exercises.map((e) => e.day))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
      });

      it("uses only known segments", () => {
        for (const e of exercises) {
          expect(SEGMENTS).toContain(e.segment as (typeof SEGMENTS)[number]);
        }
      });

      it("names every exercise", () => {
        for (const e of exercises) {
          expect(e.name.trim().length).toBeGreaterThan(0);
        }
      });

      it("only gives zero sets to duration-based work", () => {
        // Posing practice and LISS cardio are prescribed in minutes, not sets.
        for (const e of exercises) {
          if (e.defaultSets === 0) {
            expect(["cardio", "timed"], `${e.name} has 0 sets`).toContain(e.inputType);
          } else {
            expect(e.defaultSets).toBeGreaterThan(0);
          }
        }
      });

      it("keeps superset members grouped in pairs or larger", () => {
        const groups = new Map<string, number>();
        for (const e of exercises) {
          if (e.supersetGroup) groups.set(e.supersetGroup, (groups.get(e.supersetGroup) ?? 0) + 1);
        }
        for (const [group, count] of groups) {
          expect(count, `superset ${group} has a single member`).toBeGreaterThan(1);
        }
      });

      it("orders warm-ups before working sets and cool-downs after", () => {
        for (const e of exercises) {
          if (e.segment === "warmup") expect(e.order).toBeLessThan(0);
          if (e.segment === "cooldown") expect(e.order).toBeGreaterThanOrEqual(100);
        }
      });
    });
  }
});
