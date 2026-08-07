import { describe, it, expect } from "vitest";
import { analyseExercisePerformance, groupSetsByExercise } from "../server/lib/progressionAnalysis";

const exercise = { name: "Tricep Rope Pushdown", repRange: "10-15" };

function set(reps: number, rir: number, weight = 60) {
  return { exerciseId: "e1", setNumber: 1, weightLbs: weight, reps, rirActual: rir };
}

describe("analyseExercisePerformance", () => {
  it("recommends a load increase when every set tops the range with reps to spare", () => {
    const verdict = analyseExercisePerformance(exercise, [set(15, 2), set(15, 1)], []);
    expect(verdict?.type).toBe("weight_increase");
    expect(verdict?.message).toContain("Increase weight");
  });

  it("steps 5 lbs on light loads and 10 lbs on heavy ones", () => {
    const light = analyseExercisePerformance(exercise, [set(15, 2, 40)], []);
    expect(light?.message).toContain("5 lbs");
    expect(light?.newWeight).toBe(45);

    const heavy = analyseExercisePerformance(exercise, [set(15, 2, 200)], []);
    expect(heavy?.message).toContain("10 lbs");
    expect(heavy?.newWeight).toBe(210);
  });

  it("stores the target load as parseable JSON so autofill can apply it", () => {
    const verdict = analyseExercisePerformance(exercise, [set(15, 2, 100)], []);
    const details = JSON.parse(verdict!.details);
    expect(details.newWeight).toBe(110);
    expect(details.previousWeight).toBe(100);
  });

  it("says hold when the lifter went to failure but did add weight", () => {
    const verdict = analyseExercisePerformance(
      exercise,
      [set(12, 0, 70)],
      [{ weightLbs: 60, reps: 12 }],
    );
    expect(verdict?.type).toBe("maintain");
  });

  it("flags a form check when failure arrives before the rep target", () => {
    const verdict = analyseExercisePerformance(
      exercise,
      [set(8, 0, 60)],
      [{ weightLbs: 60, reps: 12 }],
    );
    expect(verdict?.type).toBe("form_check");
  });

  it("stays quiet on an ordinary mid-range session", () => {
    expect(analyseExercisePerformance(exercise, [set(12, 2)], [{ weightLbs: 60, reps: 12 }])).toBeNull();
  });

  it("stays quiet when there is nothing loaded to judge", () => {
    const bandSets = [{ exerciseId: "e1", setNumber: 1, weightLbs: null, reps: 20, rirActual: 1 }];
    expect(analyseExercisePerformance(exercise, bandSets, [])).toBeNull();
    expect(analyseExercisePerformance(exercise, [], [])).toBeNull();
  });

  it("treats an unrecorded RIR as comfortably short of failure", () => {
    // No RIR entered plus top-of-range reps should still earn an increase.
    const verdict = analyseExercisePerformance(
      exercise,
      [{ exerciseId: "e1", setNumber: 1, weightLbs: 60, reps: 15 }],
      [],
    );
    expect(verdict?.type).toBe("weight_increase");
  });

  it("does not recommend an increase when the top set fell short", () => {
    const verdict = analyseExercisePerformance(exercise, [set(15, 2), set(11, 2)], []);
    expect(verdict?.type).not.toBe("weight_increase");
  });
});

describe("groupSetsByExercise", () => {
  it("collects sets under their exercise, preserving order", () => {
    const grouped = groupSetsByExercise([
      { exerciseId: "a", setNumber: 1 },
      { exerciseId: "b", setNumber: 1 },
      { exerciseId: "a", setNumber: 2 },
    ]);
    expect([...grouped.keys()]).toEqual(["a", "b"]);
    expect(grouped.get("a")).toHaveLength(2);
    expect(grouped.get("a")!.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it("returns an empty map for no sets", () => {
    expect(groupSetsByExercise([]).size).toBe(0);
  });
});
