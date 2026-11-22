import type { InsertExercise } from "@shared/schema";
import { BLOCK_13_TAG, BLOCK_2_TAG, PLUS_ONE_TAG } from "@shared/bulk-rules";
import { phase3Exercises } from "./phase3";

/**
 * PHASE 4 - BULK - 16 weeks, 2027 season. Week 1 = Monday 11/23/2026.
 *
 * Men's Physique, with leg size and back width as the priorities. 6 days,
 * about 75-85 minutes a session. Built from the APEX Bulk Plan.
 *
 * Weekly structure is applied at read time (shared/bulk-rules.ts) from tags in
 * the notes:
 *   [BLOCKS 1+3]  weeks 1-6 and 13-16
 *   [BLOCK 2]     weeks 7-12, the exercise swaps
 *   [PLUS1]       +1 set in weeks 4-5, 10-11, 15-16 (first exercise Mon, Tue, Thu, Fri)
 * Week 1 is re-entry at RIR 3. Deloads are fatigue-triggered, not scheduled.
 *
 * Where a movement already exists in Phases 1-3 it keeps the SAME NAME, so the
 * name fallback in server/lib/autofill.ts carries the working weight across.
 *
 * Block 2 swaps occupy the same order as the movement they replace, under
 * number "<n>B", so each variation keeps its own history and weights.
 */

type Row = Omit<InsertExercise, "program">;

interface Slot {
  name: string;
  /** Block 2 swap; omit when the movement stays the same all 16 weeks. */
  block2?: string;
  block2InputType?: string;
  sets: number;
  reps: string;
  rir: string;
  rest: string;
  tempo?: string;
  inputType: string;
  notes?: string;
  plusOne?: boolean;
}

function working(day: number, slots: Slot[]): Row[] {
  const rows: Row[] = [
    {
      day,
      order: 0,
      number: "1",
      name: "Stomach Vacuum",
      defaultSets: 3,
      repRange: "30-45s",
      tempo: "—",
      rir: "skill",
      restSeconds: "30s",
      notes: "EVERY DAY, FIRST. Posing practice. NOT counted as volume.",
      alternate: "",
      videoUrl: "https://youtube.com/shorts/rmllHP_DHvQ",
      inputType: "timed",
      isSupersetPart: false,
      supersetGroup: null,
      segment: "working",
    },
  ];

  slots.forEach((slot, i) => {
    const order = i + 1;
    const number = String(i + 2);
    const tags = [slot.plusOne ? PLUS_ONE_TAG : null].filter(Boolean).join(" ");
    const base = {
      day,
      order,
      defaultSets: slot.sets,
      repRange: slot.reps,
      tempo: slot.tempo ?? "2-0-1-1",
      rir: slot.rir,
      restSeconds: slot.rest,
      videoUrl: "",
      isSupersetPart: false,
      supersetGroup: null,
      segment: "working",
    };
    const note = (blockTag: string | null) =>
      [blockTag, tags, slot.notes].filter(Boolean).join(" ").trim();

    if (!slot.block2) {
      rows.push({ ...base, number, name: slot.name, notes: note(null), alternate: "", inputType: slot.inputType });
      return;
    }
    rows.push({
      ...base,
      number,
      name: slot.name,
      notes: note(BLOCK_13_TAG),
      alternate: slot.block2,
      inputType: slot.inputType,
    });
    rows.push({
      ...base,
      number: `${number}B`,
      name: slot.block2,
      notes: note(BLOCK_2_TAG),
      alternate: slot.name,
      inputType: slot.block2InputType ?? slot.inputType,
    });
  });

  return rows;
}

/**
 * Warm-up and cool-down blocks reused from Phase 3, moved onto the Phase 4 day
 * and with the two ramp sets pointed at that day's first lift.
 */
function warmupCooldown(fromDay: number, toDay: number, rampName: string, rampInputType = "weight_reps"): Row[] {
  return phase3Exercises
    .filter((e) => e.day === fromDay && (e.segment === "warmup" || e.segment === "cooldown"))
    .map((e) => {
      const isRamp = /RAMP SET/.test(e.name);
      return {
        ...e,
        day: toDay,
        name: isRamp ? `${rampName} — RAMP SET` : e.name,
        inputType: isRamp ? rampInputType : e.inputType,
        notes: isRamp ? (e.number === "R1" ? "Light. Groove the pattern." : "Moderate.") : e.notes,
      };
    });
}

const BACK_BRACE = "** BACK BRACE ** Straight sets, never supersetted.";

export const phase4Exercises: Row[] = [
  // ===== DAY 1 — Monday — Legs A (Quads) =====
  ...warmupCooldown(4, 1, "Hack Squat"),
  ...working(1, [
    { name: "Hack Squat", block2: "Pendulum Squat", sets: 4, reps: "6-10", rir: "1-2", rest: "180s", tempo: "2-1-1-0", inputType: "weight_reps", notes: `PRIORITY. ${BACK_BRACE}`, plusOne: true },
    { name: "Leg Press", block2: "Belt Squat", sets: 3, reps: "10-15", rir: "1-2", rest: "150s", tempo: "2-1-1-0", inputType: "weight_reps", notes: `${BACK_BRACE} Feet mid-platform, full depth.` },
    { name: "Leg Extension", block2: "Single-Leg Leg Extension", block2InputType: "weight_reps_unilateral", sets: 3, reps: "12-15", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Seated Leg Curl", block2: "Lying Leg Curl", sets: 3, reps: "10-15", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Standing Calf Raise", block2: "Leg Press Calf Raise", sets: 4, reps: "8-12", rir: "0-1", rest: "90s", inputType: "weight_reps", notes: "Pause at the bottom." },
    { name: "Cable Crunch", sets: 3, reps: "10-15", rir: "1", rest: "60s", inputType: "weight_reps", notes: "AB FINISHER." },
  ]),

  // ===== DAY 2 — Tuesday — Back A (Width) =====
  ...warmupCooldown(2, 2, "Wide-Grip Lat Pulldown"),
  ...working(2, [
    { name: "Wide-Grip Lat Pulldown", block2: "Neutral / Semi-Pronated Pulldown (shoulder-width)", sets: 4, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-1", inputType: "weight_reps", notes: "PRIORITY LAT. Full stretch, cue the ELBOW not the hand.", plusOne: true },
    { name: "Chest-Supported Upper-Back Row (elbows 45-70 deg)", block2: "Seal Row", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-0", inputType: "weight_reps" },
    { name: "1-Arm Cable Lat Pulldown", block2: "1-Arm Half-Kneeling Cable Lat Pulldown", sets: 3, reps: "10-15", rir: "1", rest: "90s", inputType: "weight_reps_unilateral", notes: "Elbow to hip." },
    { name: "Straight-Arm Cable Pulldown", block2: "Rope Lat Pullover", sets: 2, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Reverse Pec Deck", block2: "Single-Arm Cross-Body Cable Rear-Delt Fly", block2InputType: "weight_reps_unilateral", sets: 3, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Incline DB Curl", block2: "Bench-Supported Bayesian Cable Curl", block2InputType: "weight_reps", sets: 3, reps: "8-12", rir: "0-1", rest: "90s", tempo: "3-0-1-1", inputType: "weight_reps_db", notes: "Failure OK last set." },
  ]),

  // ===== DAY 3 — Wednesday — Chest + Delts + Triceps =====
  ...warmupCooldown(3, 3, "Low-Incline Smith Press"),
  ...working(3, [
    { name: "Low-Incline Smith Press", block2: "Incline Barbell Press", sets: 4, reps: "6-10", rir: "1-2", rest: "180s", tempo: "2-1-1-0", inputType: "weight_reps", notes: "30 degree bench. Upper chest." },
    { name: "Neutral Grip Seated DB Shoulder Press", block2: "Machine Shoulder Press", block2InputType: "weight_reps", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-0", inputType: "weight_reps_db" },
    { name: "Bench-Supported Low-to-High Cable Fly", block2: "Incline DB Fly", block2InputType: "weight_reps_db", sets: 3, reps: "12-15", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Cable Lateral Raise", block2: "DB Lateral Raise", block2InputType: "weight_reps_db", sets: 4, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps_unilateral" },
    { name: "Overhead Cable Triceps Extension", sets: 3, reps: "10-15", rir: "0-1", rest: "90s", tempo: "3-0-1-1", inputType: "weight_reps" },
    { name: "Triceps Pushdown", block2: "Dip Machine", sets: 3, reps: "10-15", rir: "0-1", rest: "60s", inputType: "weight_reps" },
  ]),

  // ===== DAY 4 — Thursday — Legs B (Posterior + Quads) =====
  ...warmupCooldown(4, 4, "Romanian Deadlift"),
  ...working(4, [
    { name: "Romanian Deadlift", block2: "DB Romanian Deadlift", block2InputType: "weight_reps_db", sets: 4, reps: "6-10", rir: "2", rest: "180s", tempo: "3-1-1-0", inputType: "weight_reps", notes: "PRIORITY HAMSTRINGS.", plusOne: true },
    { name: "Lying Leg Curl", block2: "Seated Leg Curl", sets: 3, reps: "10-15", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Belt Squat", block2: "Hack Squat", sets: 3, reps: "8-12", rir: "1-2", rest: "150s", tempo: "2-1-1-0", inputType: "weight_reps", notes: "No Smith machine squat anywhere in this program." },
    { name: "Leg Extension", sets: 3, reps: "12-15", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Adductor Machine", sets: 2, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Seated Calf Raise", sets: 4, reps: "10-15", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Hanging Leg Raise", sets: 3, reps: "10-15", rir: "1", rest: "60s", inputType: "bodyweight_reps", notes: "AB FINISHER." },
  ]),

  // ===== DAY 5 — Friday — Back B (Width + Thickness) =====
  ...warmupCooldown(6, 5, "Pull-Up", "bodyweight_reps"),
  ...working(5, [
    { name: "Weighted Pull-Up", block2: "Neutral-Grip Strict Pull-Up", sets: 4, reps: "6-10", rir: "1-2", rest: "150s", tempo: "2-1-1-1", inputType: "bodyweight_reps_weighted", notes: "PRIORITY LAT. Add weight once 10 reps is easy.", plusOne: true },
    { name: "Wide-Grip Seated Cable Row (elbows high, 60-70 deg)", block2: "Seated Cable Row (neutral)", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-0", inputType: "weight_reps" },
    { name: "Machine High Row", block2: "Iso-Lateral Pulldown", sets: 3, reps: "8-12", rir: "1", rest: "120s", inputType: "weight_reps" },
    { name: "1-Arm DB Row (strict, bench supported)", block2: "Meadows Row", block2InputType: "weight_reps_unilateral", sets: 3, reps: "8-12", rir: "1", rest: "90s", inputType: "weight_reps_unilateral_db" },
    { name: "Cable Y-Raise", sets: 3, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Preacher Curl (EZ or machine)", block2: "Spider Curl", block2InputType: "weight_reps_db", sets: 3, reps: "8-12", rir: "0-1", rest: "90s", inputType: "weight_reps" },
    { name: "Hammer Curl", block2: "Rope Hammer Curl", block2InputType: "weight_reps", sets: 2, reps: "10-12", rir: "0-1", rest: "60s", inputType: "weight_reps_db" },
  ]),

  // ===== DAY 6 — Saturday — Delts + Upper Chest + Arms =====
  ...warmupCooldown(1, 6, "Machine Shoulder Press"),
  ...working(6, [
    { name: "Machine Shoulder Press", block2: "Smith Seated Press", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-0", inputType: "weight_reps" },
    { name: "DB Lateral Raise", block2: "Machine Lateral Raise", block2InputType: "weight_reps", sets: 4, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps_db" },
    { name: "Incline DB Bench Press", block2: "Incline Machine Press", block2InputType: "weight_reps", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", tempo: "2-1-1-0", inputType: "weight_reps_db" },
    { name: "Reverse Pec Deck", sets: 2, reps: "15-20", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "EZ-Bar Curl", block2: "Cable Curl", sets: 2, reps: "8-12", rir: "0-1", rest: "60s", inputType: "weight_reps" },
    { name: "Skull Crusher", block2: "Seated DB Overhead Triceps Ext (two-hand)", block2InputType: "weight_reps_db", sets: 3, reps: "8-12", rir: "0-1", rest: "90s", tempo: "3-0-1-1", inputType: "weight_reps" },
  ]),
];
