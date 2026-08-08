/**
 * Program rules shared by the client and the server.
 *
 * This file exists because the two halves of the app disagreed. The deload
 * schedule was defined twice — `week % 9 === 0` in the client, an explicit list
 * of weeks on the server — and the two shared no weeks in common. Anything both
 * sides act on belongs here, defined once.
 *
 * Everything below is transcribed from the program's own RULES sheet. Where a
 * value comes from that sheet the rule id is quoted, so a future change can be
 * checked against the source rather than argued about.
 */

// ── Session inputs ──────────────────────────────────────────────────────────

/**
 * RULES: STANDING | tracked_inputs — "Every session: load x reps on the day's
 * primary | actual RIR on its last set | AM fasted weight | joint status
 * (clean/achy/painful)."
 *
 * Load, reps and RIR already come from the set log. Joint status did not exist
 * as a field, which is why the fatigue triggers below could not be evaluated.
 */
export const JOINT_STATUSES = ["clean", "achy", "painful"] as const;
export type JointStatus = (typeof JOINT_STATUSES)[number];

/** RULES: DELOAD_T2 | trigger_any_one — "Warm-ups feel heavy 2 sessions". */
export const WARMUP_FEELS = ["normal", "heavy"] as const;
export type WarmupFeel = (typeof WARMUP_FEELS)[number];

/** RULES: DELOAD_T1 | trigger_any_one — "Pump/MMC gone on one muscle 2 sessions". */
export const PUMP_QUALITIES = ["good", "normal", "absent"] as const;
export type PumpQuality = (typeof PUMP_QUALITIES)[number];

/** Joint areas, for "2+ joints achy" and the same-side shoulder hard stop. */
export const JOINT_AREAS = [
  "left shoulder",
  "right shoulder",
  "left elbow",
  "right elbow",
  "left wrist",
  "right wrist",
  "left knee",
  "right knee",
  "left hip",
  "right hip",
  "lower back",
] as const;
export type JointArea = (typeof JOINT_AREAS)[number];

// ── Deload tiers ────────────────────────────────────────────────────────────

export type DeloadTier = 1 | 2;

/** What the athlete has decided about a recommendation. */
export const DELOAD_STATUSES = ["recommended", "active", "completed", "dismissed"] as const;
export type DeloadStatus = (typeof DELOAD_STATUSES)[number];

/**
 * RULES: DELOAD_T2 | week_sets / week_load / week_rir / week_other.
 *
 * "40-50% of normal" sets; load same or 5-10% lighter; RIR 4-5 on EVERY set —
 * and if load is held, reps must drop enough to reach it.
 */
export const DELOAD_PRESCRIPTION = {
  /** Fraction of normal working sets. Midpoint of the sheet's 40–50%. */
  setFraction: 0.45,
  /** Load stays, or comes down by up to this fraction. */
  maxLoadReduction: 0.1,
  rirTarget: { min: 4, max: 5 },
  noFailure: true,
  notes: "No failure. No intensifiers. Vacuums only for abs. Hold cardio. HOLD CALORIES.",
} as const;

/**
 * RULES: RETURN | week_1_back / week_2_back / if_not_normalized.
 *
 * Coming back is a prescription too, not just "resume". Week one is 80–90% of
 * prior set volume at pre-deload loads; full volume only once primary
 * performance, warm-up perception AND joint status have all normalised.
 */
export const RETURN_PRESCRIPTION = {
  weekOneVolumeFraction: 0.85,
  compoundRir: { min: 2, max: 3 },
  isolationRir: { min: 1, max: 2 },
  fullVolumeRequires: ["primary performance", "warm-up perception", "joint status"],
  twoFailedDeloadsMeans: "the problem is calories/cardio/sleep, not volume",
} as const;

/**
 * RULES: REDUCTION | order_1 … order_last.
 *
 * Which sets to pull first when trimming. Lateral delt work is last on purpose
 * — it is the priority muscle of this block (VOLUME | lateral_delts, PRIORITY).
 */
export const REDUCTION_ORDER = [
  { rank: 1, target: "Adductor + Abductor (Day 4)", match: /adduct|abduct/i },
  { rank: 2, target: "One Leg Press set", match: /leg press/i },
  { rank: 3, target: "One cable fly set", match: /cable fly|fly/i },
  { rank: 4, target: "One triceps set + one biceps set", match: /tricep|bicep|curl/i },
  // \blat\b, not /lat/ — the loose form matches "LATeral delt", which is the
  // muscle the sheet says to cut LAST. A lateral-delt stall was recommending
  // cutting lats.
  { rank: 5, target: "Lats 21 → 18, ONLY if lat performance is declining", match: /\blats?\b|pulldown|pullover|\brow\b/i },
  { rank: 6, target: "Lateral delt work — cut ONLY if lateral performance or shoulder joints deteriorate", match: /lateral|delt/i },
] as const;

/** RULES: HARD_STOP | any_one. These stop training, they do not trim it. */
export const HARD_STOPS = [
  "Sharp joint pain that changes form",
  "Same-side shoulder pain on BOTH pressing and laterals",
  "Resting HR elevated 7+ days",
] as const;

// ── RIR targets ─────────────────────────────────────────────────────────────

/** RULES: RIR | compounds 2-3, isolation 1-2. */
export const RIR_TARGETS = {
  compound: { min: 2, max: 3 },
  isolation: { min: 1, max: 2 },
} as const;

/**
 * RULES: PROGRESSION | add_load_when — "Total reps across all sets reach top of
 * range (~38-40 on 4x6-10) AND all sets in range AND final set meets RIR".
 *
 * Note this is a TOTAL-reps rule, not an every-set-at-the-top rule.
 */
export const PROGRESSION_MODEL = "double progression" as const;

// ── Scheduled deloads (legacy) ──────────────────────────────────────────────

/**
 * The old calendar deload.
 *
 * The RULES sheet prescribes no calendar deload at all — deloads there are
 * fatigue-triggered (see server/lib/fatigue.ts). This is retained only so that
 * history logged under the old behaviour still reads consistently, and is not
 * consulted when fatigue monitoring is enabled.
 *
 * @deprecated Superseded by fatigue detection. Do not add new callers.
 */
export const SCHEDULED_DELOAD_WEEKS = [4, 8, 16, 24, 32] as const;

/** @deprecated See SCHEDULED_DELOAD_WEEKS. */
export function isDeloadWeek(week: number): boolean {
  return (SCHEDULED_DELOAD_WEEKS as readonly number[]).includes(week);
}

/**
 * Working sets to run, given whether a deload is in force.
 *
 * `deloadActive` comes from an actual deload event now, not the calendar.
 * RULES: DELOAD_T2 | week_sets — 40–50% of normal.
 */
export function setsForDeload(defaultSets: number): number {
  return Math.max(1, Math.round(defaultSets * DELOAD_PRESCRIPTION.setFraction));
}

/** @deprecated Calendar-based. Use setsForDeload with a real deload event. */
export function setsForWeek(defaultSets: number, week: number): number {
  if (!isDeloadWeek(week)) return defaultSets;
  return Math.max(2, defaultSets - (defaultSets > 3 ? 2 : 1));
}
