import type { InsertExercise } from "@shared/schema";
import { ISO_TAG, PLUS1_WK5_TAG, PLUS1_WK9_TAG } from "@shared/bulk-rules";
import { phase3Exercises } from "./phase3";

/**
 * PHASE 4 - BULK - 16 weeks, 2027 season. Week 1 = Monday 11/23/2026.
 *
 * Merged program, revised 11/26/2026. Men's Physique with leg size and back
 * width as the priorities. 6 days: Legs A + biceps, Push A, Pull A + triceps,
 * Legs B + biceps, Push B, Pull B + triceps. Direct arm work never falls the
 * day before a pressing or rowing day.
 *
 * Weekly direct sets, weeks 2-4 -> weeks 13-16:
 *   quads 16 -> 17, hamstrings 12 -> 13, back 27 -> 29, side delts 13 -> 15,
 *   chest 12, biceps 10 -> 12, triceps 10 -> 12, rear delts 6, calves 8,
 *   abs 6 plus the daily vacuum.
 *
 * The ramp is applied at read time (shared/bulk-rules.ts) from tags:
 *   [PLUS1 WK5]  +1 set from week 5 (hack squat D1, lying curl D4, first
 *                pulldown D3 and D6)
 *   [PLUS1 WK9]  +1 set from week 9 (first lateral raise D2 and D5, first arm
 *                exercise D1, D3, D4, D6)
 *   [ISO]        lengthened partials on the last set from week 9, last set to
 *                true failure from week 13
 * Week 1 is re-entry at RIR 3. Deloads are fatigue-triggered, not scheduled.
 *
 * Where a movement already exists in Phases 1-3 it keeps the SAME NAME, so the
 * name fallback in server/lib/autofill.ts carries the working weight across.
 */

type Row = Omit<InsertExercise, "program">;

interface Slot {
  name: string;
  /** Backup movement when the gym does not have the first choice. */
  alternate?: string;
  sets: number;
  reps: string;
  rir: string;
  rest: string;
  tempo?: string;
  inputType: string;
  notes?: string;
  plus?: "wk5" | "wk9";
  iso?: boolean;
}

/** Machine and isolation work: 3 s lowering, 1 s pause in the stretch. */
const STRETCH = "3-1-1-0";
/** Free-weight compounds: controlled 3 s lowering, no dead stop. */
const FREE = "3-0-1-0";

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
    const tags = [
      slot.plus === "wk5" ? PLUS1_WK5_TAG : null,
      slot.plus === "wk9" ? PLUS1_WK9_TAG : null,
      slot.iso ? ISO_TAG : null,
    ];
    rows.push({
      day,
      order: i + 1,
      number: String(i + 2),
      name: slot.name,
      defaultSets: slot.sets,
      repRange: slot.reps,
      tempo: slot.tempo ?? STRETCH,
      rir: slot.rir,
      restSeconds: slot.rest,
      notes: [...tags, slot.notes].filter(Boolean).join(" ").trim(),
      alternate: slot.alternate ?? "",
      videoUrl: "",
      inputType: slot.inputType,
      isSupersetPart: false,
      supersetGroup: null,
      segment: "working",
    });
  });

  return rows;
}

/**
 * Warm-up and cool-down blocks reused from Phase 3, moved onto the Phase 4 day
 * and with the two ramp sets pointed at that day's main compound.
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
  // ===== DAY 1 — Monday — Legs A (quad stretch) + biceps =====
  ...warmupCooldown(4, 1, "Hack Squat"),
  ...working(1, [
    { name: "Seated Leg Curl", sets: 4, reps: "8-12", rir: "1", rest: "90s", inputType: "weight_reps", iso: true, notes: "Hamstrings first. Hips back, full stretch." },
    { name: "Hack Squat", alternate: "Leg Press", sets: 4, reps: "6-10", rir: "1-2", rest: "180s", inputType: "weight_reps", plus: "wk5", notes: `PRIORITY QUADS. Heels elevated, full depth. ${BACK_BRACE}` },
    { name: "Bar-Supported DB Deficit RDL", alternate: "RDL", sets: 2, reps: "8-10", rir: "2", rest: "120s", tempo: FREE, inputType: "weight_reps_db", notes: "One hand on a fixed bar for balance. Hinge to a full hamstring stretch." },
    { name: "Leg Extension", sets: 4, reps: "10-12", rir: "0-1", rest: "90s", inputType: "weight_reps", iso: true },
    { name: "Standing Calf Raise", sets: 4, reps: "10-15", rir: "0-1", rest: "90s", inputType: "weight_reps", iso: true, notes: "Pause at the bottom." },
    { name: "Incline DB Curl", sets: 3, reps: "8-10", rir: "0-1", rest: "90s", inputType: "weight_reps_db", plus: "wk9", iso: true },
    { name: "Bench-Supported Bayesian Cable Curl", sets: 2, reps: "10-12", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
  ]),

  // ===== DAY 2 — Tuesday — Push A (mid chest, side delts) =====
  ...warmupCooldown(3, 2, "Machine Chest Press"),
  ...working(2, [
    { name: "Machine Chest Press", alternate: "Split-Handle Converging Machine Press", sets: 3, reps: "6-10", rir: "1-2", rest: "150s", inputType: "weight_reps" },
    { name: "Incline Cable / DB Fly", sets: 2, reps: "8-12", rir: "0-1", rest: "90s", inputType: "weight_reps", iso: true },
    { name: "Machine Lateral Raise", alternate: "Braced Cable Lateral Raise", sets: 4, reps: "10-15", rir: "0-1", rest: "60s", inputType: "weight_reps", plus: "wk9", iso: true },
    { name: "Single-Arm Behind-Body Cable Lateral Raise", sets: 3, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps_unilateral", iso: true },
    { name: "Cable Crunch", sets: 3, reps: "10-15", rir: "1", rest: "60s", inputType: "weight_reps", notes: "AB FINISHER." },
  ]),

  // ===== DAY 3 — Wednesday — Pull A (lat width) + triceps =====
  ...warmupCooldown(2, 3, "1-Arm Cable Lat Pulldown", "weight_reps_unilateral"),
  ...working(3, [
    { name: "1-Arm Cable Lat Pulldown", sets: 4, reps: "8-12", rir: "1", rest: "90s", inputType: "weight_reps_unilateral", plus: "wk5", notes: "PRIORITY LAT. Elbow to hip, full stretch at the top." },
    { name: "Neutral / Semi-Pronated Pulldown (shoulder-width)", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", inputType: "weight_reps" },
    { name: "Chest-Supported Low Row (elbow to hip)", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", inputType: "weight_reps", notes: "Lat-biased. Low elbow path." },
    { name: "Chest-Supported Upper-Back Row (elbows 60-75 deg)", sets: 3, reps: "8-12", rir: "1-2", rest: "120s", inputType: "weight_reps" },
    { name: "Straight-Arm Cable Pulldown", sets: 2, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
    { name: "Single-Arm Cross-Body Cable Rear-Delt Fly", sets: 3, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps_unilateral", iso: true },
    { name: "Overhead Cable Triceps Extension", sets: 3, reps: "8-12", rir: "0-1", rest: "90s", inputType: "weight_reps", plus: "wk9", iso: true },
    { name: "Bench-Supported Cable Triceps Pushdown", sets: 3, reps: "8-12", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
  ]),

  // ===== DAY 4 — Thursday — Legs B (posterior chain + quads) + biceps =====
  ...warmupCooldown(4, 4, "RDL"),
  ...working(4, [
    { name: "Lying Leg Curl", sets: 3, reps: "8-12", rir: "0-1", rest: "90s", inputType: "weight_reps", plus: "wk5", iso: true },
    { name: "RDL", sets: 3, reps: "6-10", rir: "2", rest: "180s", tempo: FREE, inputType: "weight_reps", notes: `PRIORITY HAMSTRINGS. ${BACK_BRACE}` },
    { name: "Pendulum Squat", alternate: "Hack Squat (narrow stance) or Belt Squat", sets: 3, reps: "8-10", rir: "1-2", rest: "150s", inputType: "weight_reps", notes: "Narrow stance. No Smith machine squat anywhere in this program." },
    { name: "Leg Press", sets: 3, reps: "10-15", rir: "1-2", rest: "150s", inputType: "weight_reps", notes: `${BACK_BRACE} Feet mid-platform, full depth.` },
    { name: "DB Bulgarian Split Squat", sets: 2, reps: "10-12", rir: "1-2", rest: "90s", tempo: FREE, inputType: "weight_reps_unilateral_db", notes: "Per leg." },
    { name: "Seated Calf Raise", sets: 4, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
    { name: "Preacher Curl (EZ or machine)", sets: 3, reps: "8-10", rir: "0-1", rest: "90s", inputType: "weight_reps", plus: "wk9", iso: true },
    { name: "Hammer Curl", sets: 2, reps: "8-10", rir: "0-1", rest: "60s", inputType: "weight_reps_db", iso: true },
  ]),

  // ===== DAY 5 — Friday — Push B (upper chest, side delts) =====
  ...warmupCooldown(3, 5, "Low-Incline Smith Press"),
  ...working(5, [
    { name: "Low-Incline Smith Press", alternate: "Plate-Loaded Incline Press", sets: 3, reps: "6-10", rir: "1-2", rest: "150s", inputType: "weight_reps", notes: "30 degree bench. Upper chest." },
    { name: "Flat / Slight-Incline Machine Press", sets: 2, reps: "8-10", rir: "1-2", rest: "120s", inputType: "weight_reps" },
    { name: "Bench-Supported Low-to-High Cable Fly", sets: 2, reps: "10-12", rir: "0-1", rest: "90s", inputType: "weight_reps", iso: true },
    { name: "Seated DB Side Lateral Raise", sets: 4, reps: "10-15", rir: "0-1", rest: "60s", inputType: "weight_reps_db", plus: "wk9", iso: true },
    { name: "Hanging Leg Raise", sets: 3, reps: "10-15", rir: "1", rest: "60s", inputType: "bodyweight_reps", notes: "AB FINISHER." },
  ]),

  // ===== DAY 6 — Saturday — Pull B (lat thickness, rear delts) + triceps =====
  ...warmupCooldown(6, 6, "Dual-Cable Neutral-Grip Pulldown"),
  ...working(6, [
    { name: "Dual-Cable Neutral-Grip Pulldown", alternate: "Neutral / Semi-Pronated Pulldown (shoulder-width)", sets: 4, reps: "8-10", rir: "1", rest: "120s", inputType: "weight_reps", plus: "wk5", notes: "PRIORITY LAT." },
    { name: "T-Bar Row", alternate: "Chest-Supported Row (lat-biased)", sets: 3, reps: "8-10", rir: "1-2", rest: "120s", inputType: "weight_reps" },
    { name: "1-Arm DB Row (strict, bench supported)", sets: 3, reps: "8-12", rir: "1", rest: "90s", tempo: FREE, inputType: "weight_reps_unilateral_db" },
    { name: "Machine / Cable Pullover", sets: 2, reps: "10-12", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
    { name: "Reverse Pec Deck", sets: 3, reps: "12-15", rir: "0-1", rest: "60s", inputType: "weight_reps", iso: true },
    { name: "Cable Lateral Raise", sets: 2, reps: "12-20", rir: "0-1", rest: "60s", inputType: "weight_reps_unilateral", iso: true },
    { name: "JM Press (Smith)", alternate: "Close-Grip Machine Press", sets: 2, reps: "6-10", rir: "1", rest: "90s", inputType: "weight_reps", plus: "wk9" },
    { name: "Incline DB Overhead Triceps Extension", sets: 2, reps: "8-12", rir: "0-1", rest: "60s", inputType: "weight_reps_db", iso: true },
  ]),
];
