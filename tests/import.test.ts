import { describe, it, expect } from "vitest";
import { buildExerciseMap } from "../scripts/import-from-replit";

/**
 * Tests for the one part of the Replit import that can silently corrupt the
 * result: deciding which new exercise each old one is.
 *
 * Exercise ids are per-database UUIDs, so every imported set has to be
 * re-pointed by identity. Get that wrong and the import still "succeeds" —
 * months of sets land on the wrong movement, and the weight it suggests next
 * session is a weight for a different exercise. Nothing about the report would
 * look wrong.
 */

type Row = Record<string, unknown>;

function ex(overrides: Partial<Row> & { id: string; name: string }): Row {
  return {
    program: "phase3",
    day: 1,
    number: "1",
    order: 1,
    ...overrides,
  };
}

describe("buildExerciseMap", () => {
  it("matches an unchanged exercise on its exact slot", () => {
    const source = [ex({ id: "old-1", name: "Belt Squat" })];
    const target = [ex({ id: "new-1", name: "Belt Squat" })];

    const { matched, unmatched } = buildExerciseMap(source, target);
    expect(matched.get("old-1")).toBe("new-1");
    expect(unmatched).toEqual([]);
  });

  it("matches through a renumbering", () => {
    const source = [ex({ id: "old-1", name: "Belt Squat", number: "3" })];
    const target = [ex({ id: "new-1", name: "Belt Squat", number: "4" })];

    expect(buildExerciseMap(source, target).matched.get("old-1")).toBe("new-1");
  });

  it("matches a movement that changed day within the same program", () => {
    const source = [ex({ id: "old-1", name: "Seated Cable Row", day: 2 })];
    const target = [ex({ id: "new-1", name: "Seated Cable Row", day: 5, number: "7" })];

    expect(buildExerciseMap(source, target).matched.get("old-1")).toBe("new-1");
  });

  it("prefers the exercise's own program over a same-named row in another", () => {
    // The real hazard: the same movement exists in more than one phase. Before,
    // a single name-keyed map over every program resolved to whichever row the
    // unordered select returned last — so history could land in phase1.
    const source = [ex({ id: "old-1", name: "Cable Lateral Raise", program: "phase3", day: 4 })];
    const target = [
      ex({ id: "p1", name: "Cable Lateral Raise", program: "phase1", day: 2 }),
      ex({ id: "p3", name: "Cable Lateral Raise", program: "phase3", day: 6 }),
    ];

    expect(buildExerciseMap(source, target).matched.get("old-1")).toBe("p3");
  });

  it("resolves the same way regardless of the order rows come back", () => {
    // Postgres makes no ordering promise on an unqualified select, so the same
    // import must not map differently on a second run.
    const source = [ex({ id: "old-1", name: "Lat Pulldown", program: "legacy", day: 9 })];
    const target = [
      ex({ id: "a", name: "Lat Pulldown", program: "phase1", day: 3 }),
      ex({ id: "b", name: "Lat Pulldown", program: "phase2", day: 3 }),
      ex({ id: "c", name: "Lat Pulldown", program: "phase3", day: 3 }),
    ];

    const forward = buildExerciseMap(source, target).matched.get("old-1");
    const reversed = buildExerciseMap(source, [...target].reverse()).matched.get("old-1");
    const shuffled = buildExerciseMap(source, [target[1], target[2], target[0]]).matched.get("old-1");

    expect(forward).toBe(reversed);
    expect(forward).toBe(shuffled);
  });

  it("falls back to another program when the exercise's own has no such name", () => {
    const source = [ex({ id: "old-1", name: "BB Hip Thrust", program: "phase2" })];
    const target = [ex({ id: "new-1", name: "BB Hip Thrust", program: "phase3", day: 3 })];

    expect(buildExerciseMap(source, target).matched.get("old-1")).toBe("new-1");
  });

  it("reports a retired exercise instead of dropping it", () => {
    // These become rows under the "legacy" program. Losing them would lose
    // every set ever logged against them.
    const source = [ex({ id: "old-1", name: "Smith Machine Shrug" })];
    const target = [ex({ id: "new-1", name: "Belt Squat" })];

    const { matched, unmatched } = buildExerciseMap(source, target);
    expect(matched.size).toBe(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].name).toBe("Smith Machine Shrug");
  });

  it("never maps two old exercises onto one new row by accident", () => {
    // Distinct movements must stay distinct, or their histories merge.
    const source = [
      ex({ id: "old-1", name: "Incline DB Press", number: "1" }),
      ex({ id: "old-2", name: "Flat DB Press", number: "2" }),
    ];
    const target = [
      ex({ id: "new-1", name: "Incline DB Press", number: "1" }),
      ex({ id: "new-2", name: "Flat DB Press", number: "2" }),
    ];

    const { matched } = buildExerciseMap(source, target);
    expect(matched.get("old-1")).toBe("new-1");
    expect(matched.get("old-2")).toBe("new-2");
    expect(new Set(matched.values()).size).toBe(2);
  });

  it("handles an empty source without complaint", () => {
    expect(buildExerciseMap([], [ex({ id: "new-1", name: "Belt Squat" })])).toEqual({
      matched: new Map(),
      unmatched: [],
    });
  });

  it("treats every old exercise as retired when the target is empty", () => {
    const source = [ex({ id: "old-1", name: "Belt Squat" })];
    expect(buildExerciseMap(source, []).unmatched).toHaveLength(1);
  });
});
