import { describe, it, expect } from "vitest";
import {
  splitHistoryLine,
  parseHistoryCsv,
  groupIntoSessions,
  resolveExerciseNames,
  type SeedExercise,
} from "../scripts/lib/history-csv";

/**
 * Tests for reading the app's exported training history.
 *
 * The export was written by joining values with commas and never quoting them,
 * so an exercise name containing a comma shifts every later field one place
 * right: weight lands in Side, reps land in Weight. The row does not fail — it
 * silently becomes a different, plausible-looking row. That is the failure mode
 * worth testing hardest, because an import that "succeeds" with 127 corrupted
 * rows produces confident weight recommendations built on nonsense.
 */

const HEADER =
  "Date,Week,Phase,Day,Exercise#,Exercise,Set,Side,Weight(lbs),Reps,Duration(s),RIR,Band";

describe("splitHistoryLine", () => {
  it("reads an ordinary row", () => {
    const line = "2026-08-08,27,Cut 2,6,1,Stomach Vacuum,1,,,,12,,";
    const result = splitHistoryLine(line)!;
    expect(result.repaired).toBe(false);
    expect(result.fields[5]).toBe("Stomach Vacuum");
    expect(result.fields).toHaveLength(13);
  });

  it("reassembles a name broken by one comma", () => {
    const line = "2026-08-07,27,Cut 2,5,3,Cable Lateral Raise (lean-away, arm across body),1,left,100,12,,,";
    const result = splitHistoryLine(line)!;

    expect(result.repaired).toBe(true);
    expect(result.fields[5]).toBe("Cable Lateral Raise (lean-away, arm across body)");
    // The point of the repair: these are the values that were landing one
    // column to the right.
    expect(result.fields[7]).toBe("left");
    expect(result.fields[8]).toBe("100");
    expect(result.fields[9]).toBe("12");
  });

  it("reassembles a name broken by two commas", () => {
    const line = "2026-07-24,25,Cut 2,5,4,Pull Down Cycle (Wide, Normal, Reverse Grip),1,,121,21,,,";
    const result = splitHistoryLine(line)!;

    expect(result.fields[5]).toBe("Pull Down Cycle (Wide, Normal, Reverse Grip)");
    expect(result.fields[7]).toBe("");
    expect(result.fields[8]).toBe("121");
    expect(result.fields[9]).toBe("21");
  });

  it("reads a properly quoted file without inventing a repair", () => {
    const line = '2026-08-07,27,Cut 2,5,3,"Cable Lateral Raise (lean-away, arm across body)",1,left,100,12,,,';
    const result = splitHistoryLine(line)!;

    expect(result.repaired).toBe(false);
    expect(result.fields[5]).toBe("Cable Lateral Raise (lean-away, arm across body)");
    expect(result.fields[8]).toBe("100");
  });

  it("rejects a line with too few fields rather than guessing", () => {
    expect(splitHistoryLine("2026-08-08,27,Cut 2")).toBeNull();
  });
});

describe("parseHistoryCsv", () => {
  it("reads weights, reps and sides", () => {
    const csv = [
      HEADER,
      "2026-08-08,27,Cut 2,6,2,Bench-Supported Single-Arm High-Cable Pulldown,1,left,88,12,,,",
      "2026-08-08,27,Cut 2,6,2,Bench-Supported Single-Arm High-Cable Pulldown,1,right,88,12,,,",
    ].join("\n");

    const { rows, skipped } = parseHistoryCsv(csv);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-08-08",
      week: 27,
      day: 6,
      exercise: "Bench-Supported Single-Arm High-Cable Pulldown",
      setNumber: 1,
      side: "left",
      weightLbs: 88,
      reps: 12,
    });
    expect(rows[1].side).toBe("right");
  });

  it("leaves an absent value null rather than zero", () => {
    // A vacuum has reps and no weight. Coercing the blank to 0 would make it
    // look like a logged lift of nothing, and 0 reads as real history.
    const csv = [HEADER, "2026-08-08,27,Cut 2,6,1,Stomach Vacuum,1,,,,12,,"].join("\n");
    const [row] = parseHistoryCsv(csv).rows;

    expect(row.weightLbs).toBeNull();
    expect(row.reps).toBeNull();
    expect(row.durationSecs).toBe(12);
  });

  it("counts the rows it had to repair", () => {
    const csv = [
      HEADER,
      "2026-08-08,27,Cut 2,6,1,Stomach Vacuum,1,,,,12,,",
      "2026-02-05,1,Base,4,2a,1-Arm DB Row (strict, bench supported),1,left,90,12,,,",
    ].join("\n");

    const report = parseHistoryCsv(csv);
    expect(report.repaired).toBe(1);
    expect(report.rows[1].weightLbs).toBe(90);
  });

  it("collapses a session that was saved twice", () => {
    // The old app appended a second copy of the sets instead of replacing them.
    const set = "2026-06-05,20,Cut 1,5,3,Chest-Supported DB Shrug,1,,70,15,,,";
    const { rows, duplicatesCollapsed } = parseHistoryCsv([HEADER, set, set].join("\n"));

    expect(rows).toHaveLength(1);
    expect(duplicatesCollapsed).toBe(1);
  });

  it("keeps left and right of the same set number", () => {
    // These share everything but side; treating them as duplicates would halve
    // every unilateral exercise.
    const csv = [
      HEADER,
      "2026-06-05,20,Cut 1,5,3,1-Arm DB Row (strict, bench supported),1,left,90,12,,,",
      "2026-06-05,20,Cut 1,5,3,1-Arm DB Row (strict, bench supported),1,right,90,12,,,",
    ].join("\n");

    expect(parseHistoryCsv(csv).rows).toHaveLength(2);
  });

  it("skips a row still misaligned after repair instead of importing a bad weight", () => {
    // If Side holds something that is not a side, the numbers after it are in
    // the wrong columns. Importing would fabricate a weight.
    const csv = [HEADER, "2026-08-08,27,Cut 2,6,2,Some Exercise,1,sideways,88,12,,,"].join("\n");

    const { rows, skipped } = parseHistoryCsv(csv);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toContain("sideways");
  });

  it("skips an unreadable line without losing the rest of the file", () => {
    const csv = [
      HEADER,
      "not,a,row",
      "2026-08-08,27,Cut 2,6,1,Stomach Vacuum,1,,,,12,,",
    ].join("\n");

    const { rows, skipped } = parseHistoryCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].line).toBe(2);
  });

  it("ignores the header and blank lines", () => {
    expect(parseHistoryCsv([HEADER, "", ""].join("\n")).rows).toEqual([]);
  });
});

describe("groupIntoSessions", () => {
  it("groups by week and day, the way the unique index does", () => {
    const csv = [
      HEADER,
      "2026-08-08,27,Cut 2,6,1,Stomach Vacuum,1,,,,12,,",
      "2026-08-08,27,Cut 2,6,2,Hammer Curl,1,,35,10,,,",
      "2026-08-07,27,Cut 2,5,1,Belt Squat,1,,225,8,,,",
    ].join("\n");

    const sessions = groupIntoSessions(parseHistoryCsv(csv).rows);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ week: 27, day: 5 });
    expect(sessions[1].rows).toHaveLength(2);
  });

  it("merges two dates that share a week and day", () => {
    // workout_logs is unique on (user_id, day, week); two rows would be
    // rejected mid-import, so they are merged here instead.
    const csv = [
      HEADER,
      "2026-08-01,27,Cut 2,6,1,Hammer Curl,1,,35,10,,,",
      "2026-08-08,27,Cut 2,6,1,Hammer Curl,2,,35,10,,,",
    ].join("\n");

    const sessions = groupIntoSessions(parseHistoryCsv(csv).rows);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rows).toHaveLength(2);
  });

  it("orders sessions by week then day", () => {
    const csv = [
      HEADER,
      "2026-08-08,27,Cut 2,6,1,A,1,,10,10,,,",
      "2026-02-02,1,Base,3,1,B,1,,10,10,,,",
      "2026-02-02,1,Base,1,1,C,1,,10,10,,,",
    ].join("\n");

    expect(groupIntoSessions(parseHistoryCsv(csv).rows).map((s) => [s.week, s.day])).toEqual([
      [1, 1],
      [1, 3],
      [27, 6],
    ]);
  });
});

describe("resolveExerciseNames", () => {
  const seeded: SeedExercise[] = [
    { id: "p1-d2-curl", name: "Hammer Curl", day: 2, program: "phase1" },
    { id: "p2-d5-curl", name: "Hammer Curl", day: 5, program: "phase2" },
    { id: "p3-d6-curl", name: "Hammer Curl", day: 6, program: "phase3" },
    { id: "p3-d4-squat", name: "Belt Squat", day: 4, program: "phase3" },
  ];

  it("prefers the same day of the preferred program", () => {
    const { resolved } = resolveExerciseNames([{ name: "Hammer Curl", day: 6 }], seeded, "phase3");
    expect(resolved.get("Hammer Curl|6")).toBe("p3-d6-curl");
  });

  it("stays in the preferred program when the day has moved", () => {
    const { resolved } = resolveExerciseNames([{ name: "Hammer Curl", day: 2 }], seeded, "phase3");
    expect(resolved.get("Hammer Curl|2")).toBe("p3-d6-curl");
  });

  it("reaches into another program only when the preferred one lacks the name", () => {
    const onlyPhase1: SeedExercise[] = [seeded[0]];
    const { resolved } = resolveExerciseNames([{ name: "Hammer Curl", day: 6 }], onlyPhase1, "phase3");
    expect(resolved.get("Hammer Curl|6")).toBe("p1-d2-curl");
  });

  it("resolves the same way whatever order the rows arrive in", () => {
    const forward = resolveExerciseNames([{ name: "Hammer Curl", day: 3 }], seeded, "phase1");
    const reversed = resolveExerciseNames([{ name: "Hammer Curl", day: 3 }], [...seeded].reverse(), "phase1");
    expect(forward.resolved.get("Hammer Curl|3")).toBe(reversed.resolved.get("Hammer Curl|3"));
  });

  it("reports a retired movement instead of guessing at a similar one", () => {
    // "Single-Arm DB Preacher Curl" is not "Preacher Curl (EZ or machine)":
    // one is a 30 lb dumbbell per side, the other a loaded EZ bar. Matching
    // them would seed a wrong — and confidently displayed — starting weight.
    const { resolved, unresolved } = resolveExerciseNames(
      [{ name: "Single-Arm DB Preacher Curl", day: 4 }],
      [...seeded, { id: "p3-d6-preacher", name: "Preacher Curl (EZ or machine)", day: 6, program: "phase3" }],
      "phase3",
    );

    expect(resolved.size).toBe(0);
    expect(unresolved).toEqual(["Single-Arm DB Preacher Curl"]);
  });

  it("keeps distinct movements distinct", () => {
    const { resolved } = resolveExerciseNames(
      [
        { name: "Hammer Curl", day: 6 },
        { name: "Belt Squat", day: 4 },
      ],
      seeded,
      "phase3",
    );
    expect(new Set(resolved.values()).size).toBe(2);
  });
});
