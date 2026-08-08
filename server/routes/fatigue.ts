import { Router } from "express";
import { z } from "zod";
import { deloadDecisionSchema, startDeloadSchema, type WorkoutLog, type SetLog, type Exercise } from "@shared/schema";
import { DELOAD_PRESCRIPTION, RETURN_PRESCRIPTION } from "@shared/program-rules";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, badRequest, notFound } from "../middleware/error";
import { assessFatigue, type SessionSignal, type LiftPerformance, type TriggerId } from "../lib/fatigue";

export const fatigueRouter = Router();

/** How far back the assessment looks. Enough for "gradual over 3-4 wks". */
const LOOKBACK_SESSIONS = 24;

/**
 * The day's primary lift.
 *
 * RULES: vacuum_position — "Stomach Vacuum is ALWAYS row 1 of Working Sets,
 * every day. Not counted as volume." So the primary is the first working
 * exercise after it, by order.
 */
function findPrimaryExercise(exercises: Exercise[]): Exercise | undefined {
  return exercises
    .filter((e) => e.segment === "working" && !/stomach vacuum/i.test(e.name))
    .sort((a, b) => a.order - b.order)[0];
}

/** Reduce one exercise's sets in a session to the shape the triggers need. */
function summariseLift(exercise: Exercise, sets: SetLog[]): LiftPerformance | null {
  const working = sets.filter((s) => s.weightLbs != null && s.reps != null);
  if (working.length === 0) return null;

  const topLoad = Math.max(...working.map((s) => s.weightLbs ?? 0));
  const atTopLoad = working.filter((s) => s.weightLbs === topLoad);
  const lastSet = working.reduce((a, b) => (b.setNumber > a.setNumber ? b : a));

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    topLoad,
    repsAtTopLoad: atTopLoad.reduce((sum, s) => sum + (s.reps ?? 0), 0),
    totalReps: working.reduce((sum, s) => sum + (s.reps ?? 0), 0),
    lastSetRir: lastSet.rirActual ?? null,
  };
}

/** Turn stored workouts into the engine's input. */
async function buildSignals(userId: string): Promise<SessionSignal[]> {
  const workouts = (await storage.getWorkoutLogsByUser(userId))
    .filter((w) => w.completed)
    .slice(0, LOOKBACK_SESSIONS);

  if (workouts.length === 0) return [];

  const [setsByWorkout, allExercises] = await Promise.all([
    storage.getSetLogsByWorkouts(workouts.map((w) => w.id)),
    storage.getAllExercises(),
  ]);
  const exerciseById = new Map(allExercises.map((e) => [e.id, e]));

  return workouts.map((workout: WorkoutLog) => {
    const sets = setsByWorkout.get(workout.id) ?? [];

    const byExercise = new Map<string, SetLog[]>();
    for (const set of sets) {
      const list = byExercise.get(set.exerciseId);
      if (list) list.push(set);
      else byExercise.set(set.exerciseId, [set]);
    }

    const lifts: LiftPerformance[] = [];
    for (const [exerciseId, exerciseSets] of byExercise) {
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) continue;
      const summary = summariseLift(exercise, exerciseSets);
      if (summary) lifts.push(summary);
    }

    const dayExercises = allExercises.filter(
      (e) => e.day === workout.day && e.program === workout.program,
    );
    const primaryExercise = findPrimaryExercise(dayExercises);
    const primary = primaryExercise ? (lifts.find((l) => l.exerciseId === primaryExercise.id) ?? null) : null;

    return {
      workoutId: workout.id,
      day: workout.day,
      week: workout.week,
      date: new Date(workout.date),
      jointStatus: (workout.jointStatus as SessionSignal["jointStatus"]) ?? null,
      jointAreas: workout.jointAreas ?? [],
      warmupFeel: (workout.warmupFeel as SessionSignal["warmupFeel"]) ?? null,
      pumpQuality: (workout.pumpQuality as SessionSignal["pumpQuality"]) ?? null,
      sessionDread: workout.sessionDread ?? null,
      primary,
      lifts,
    };
  });
}

/**
 * Current fatigue status.
 *
 * Returns the verdict WITH its evidence. Nothing is applied automatically —
 * DELOAD_T2 | confound_check requires telling normal cut drift from
 * overreaching, which is the athlete's call.
 */
fatigueRouter.get(
  "/fatigue",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);

    const [signals, activeDeload, lastTier1] = await Promise.all([
      buildSignals(userId),
      storage.getActiveDeload(userId),
      storage.getLatestActionedTier1(userId),
    ]);

    const assessment = assessFatigue(signals, {
      tier1Actioned:
        lastTier1 && lastTier1.startedAt
          ? {
              trigger: (lastTier1.triggers as { id: TriggerId }[])?.[0]?.id ?? "primary_stall",
              subject: lastTier1.subject ?? undefined,
              actionedAt: new Date(lastTier1.startedAt),
            }
          : null,
    });

    res.json({
      ...assessment,
      activeDeload: activeDeload ?? null,
      prescription: activeDeload
        ? activeDeload.tier === 2
          ? DELOAD_PRESCRIPTION
          : null
        : null,
      returnProtocol: RETURN_PRESCRIPTION,
    });
  }),
);

fatigueRouter.get(
  "/deloads",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await storage.getDeloadEvents(userIdOf(req)));
  }),
);

/** Start a deload the athlete has decided to take. */
fatigueRouter.post(
  "/deloads",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = startDeloadSchema.parse(req.body);
    const userId = userIdOf(req);

    if (await storage.getActiveDeload(userId)) {
      throw badRequest("A deload is already active. Complete it before starting another.");
    }

    // Record the triggers as they stood, so the decision stays auditable even
    // after more sessions change what the live assessment says.
    const assessment = assessFatigue(await buildSignals(userId));

    const event = await storage.createDeloadEvent({
      userId,
      tier: data.tier,
      status: "active",
      subject: data.subject ?? null,
      // Serialised through JSON so the jsonb column takes it as plain data
      // rather than a typed interface with no index signature.
      triggers: JSON.parse(JSON.stringify(assessment.triggers)),
      week: data.week,
      startedAt: new Date(),
      notes: data.notes ?? "",
    });

    logger.info({ userId, tier: data.tier, triggers: assessment.triggers.length }, "deload started");
    res.status(201).json(event);
  }),
);

fatigueRouter.patch(
  "/deloads/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { status, notes } = deloadDecisionSchema.parse(req.body);

    const existing = await storage.getDeloadEvent(id);
    if (!existing || existing.userId !== userIdOf(req)) throw notFound("Deload not found");

    const updates: Record<string, unknown> = { status };
    if (notes !== undefined) updates.notes = notes;
    if (status === "active" && !existing.startedAt) updates.startedAt = new Date();
    if (status === "completed" || status === "dismissed") updates.endedAt = new Date();

    res.json(await storage.updateDeloadEvent(id, updates));
  }),
);
