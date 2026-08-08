import { Router } from "express";
import { z } from "zod";
import {
  workoutCompleteSchema,
  dayParamSchema,
  weekParamSchema,
  listQuerySchema,
  type InsertSetLog,
  type WorkoutLog,
} from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, notFound } from "../middleware/error";
import { getCurrentPhase, applyProgramRules, isUnilateralInputType } from "../lib/program";
import { setsForDeload } from "@shared/program-rules";
import { getRecommendedWeightsForExercise } from "../lib/autofill";
import { analyseExercisePerformance, groupSetsByExercise } from "../lib/progressionAnalysis";
import { syncTrainingSession } from "../integrations/notion";

export const workoutRouter = Router();

async function activeProgram(userId: string): Promise<string> {
  const user = await storage.getUser(userId);
  return user?.activeProgram ?? "phase3";
}

// ── Exercises ───────────────────────────────────────────────────────────────

workoutRouter.get(
  "/exercises",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Was public before; the program content is the user's own, so it needs auth.
    const program = z.enum(["phase1", "phase2", "phase3"]).optional().parse(req.query.program);
    res.json(await storage.getAllExercises(program ?? (await activeProgram(userIdOf(req)))));
  }),
);

workoutRouter.get(
  "/exercises/:day",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day } = dayParamSchema.parse(req.params);
    const { week } = weekParamSchema.parse(req.query);
    const userId = userIdOf(req);

    const program = await activeProgram(userId);
    const exercises = await storage.getExercisesByDay(day, program);
    res.json(applyProgramRules(exercises, program, week));
  }),
);

// ── Workouts ────────────────────────────────────────────────────────────────

workoutRouter.get(
  "/workouts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { week } = listQuerySchema.parse(req.query);
    res.json(await storage.getWorkoutLogsByUser(userIdOf(req), week));
  }),
);

workoutRouter.get(
  "/workouts/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workouts = await storage.getWorkoutLogsByUser(userIdOf(req));
    // One batched query rather than one per workout.
    const setsByWorkout = await storage.getSetLogsByWorkouts(workouts.map((w) => w.id));
    res.json(workouts.map((w) => ({ ...w, sets: setsByWorkout.get(w.id) ?? [] })));
  }),
);

workoutRouter.get(
  "/workouts/current/:day/:week",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day } = dayParamSchema.parse(req.params);
    const { week } = weekParamSchema.parse({ week: req.params.week });
    res.json((await storage.getCurrentWorkoutLog(userIdOf(req), day, week)) ?? null);
  }),
);

workoutRouter.post(
  "/workouts/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day, week, phase, program, duration, notes, sets, jointStatus, jointAreas, warmupFeel, pumpQuality, sessionDread } =
      workoutCompleteSchema.parse(req.body);
    const userId = userIdOf(req);
    const resolvedProgram = program ?? (await activeProgram(userId));

    // Only accept sets for exercises that belong to this day's program. Without
    // this a client could attribute sets to any exercise id it liked.
    const dayExercises = await storage.getExercisesByDay(day, resolvedProgram);
    const exerciseById = new Map(dayExercises.map((e) => [e.id, e]));
    const acceptedSets = (sets ?? []).filter((s) => exerciseById.has(s.exerciseId));
    const rejected = (sets?.length ?? 0) - acceptedSets.length;
    if (rejected > 0) {
      logger.warn({ userId, day, rejected }, "dropped sets referencing exercises outside this day");
    }

    let workoutLog = await storage.getCurrentWorkoutLog(userId, day, week);
    if (workoutLog) {
      workoutLog = await storage.updateWorkoutLog(workoutLog.id, {
        completed: true,
        date: new Date(),
        program: resolvedProgram,
        duration: duration ?? workoutLog.duration,
        notes: notes ?? workoutLog.notes,
        jointStatus: jointStatus ?? workoutLog.jointStatus,
        jointAreas: jointAreas ?? workoutLog.jointAreas,
        warmupFeel: warmupFeel ?? workoutLog.warmupFeel,
        pumpQuality: pumpQuality ?? workoutLog.pumpQuality,
        sessionDread: sessionDread ?? workoutLog.sessionDread,
      });
      // Re-submitting a session replaces its sets instead of appending a second
      // copy, which is what happened before when a save was retried.
      await storage.deleteSetLogsByWorkout(workoutLog.id);
    } else {
      workoutLog = await storage.createWorkoutLog({
        userId,
        day,
        week,
        phase: phase ?? getCurrentPhase(week),
        program: resolvedProgram,
        date: new Date(),
        duration: duration ?? null,
        notes: notes ?? "",
        completed: true,
        jointStatus: jointStatus ?? null,
        jointAreas: jointAreas ?? [],
        warmupFeel: warmupFeel ?? null,
        pumpQuality: pumpQuality ?? null,
        sessionDread: sessionDread ?? null,
      });
    }

    if (acceptedSets.length > 0) {
      const rows: InsertSetLog[] = acceptedSets.map((s) => ({
        workoutLogId: workoutLog!.id,
        exerciseId: s.exerciseId,
        userId,
        setNumber: s.setNumber,
        weightLbs: s.weightLbs ?? null,
        reps: s.reps ?? null,
        side: s.side ?? null,
        durationSecs: s.durationSecs ?? null,
        rirActual: s.rirActual ?? null,
        isFailure: s.isFailure ?? false,
        bandNote: s.bandNote ?? null,
        cardioNotes: s.cardioNotes ?? null,
      }));
      await storage.createSetLogs(rows);
      await generateRecommendations(userId, week, day, acceptedSets, exerciseById);
    }

    res.json(workoutLog);

    void mirrorToNotion(workoutLog);
  }),
);

async function mirrorToNotion(workoutLog: WorkoutLog): Promise<void> {
  try {
    await syncTrainingSession(workoutLog);
  } catch (err) {
    logger.error({ err }, "notion training session sync failed");
  }
}

/** Compare this session against the last one and record any coaching cues. */
async function generateRecommendations(
  userId: string,
  week: number,
  day: number,
  sets: Array<{ exerciseId: string; setNumber: number; weightLbs?: number | null; reps?: number | null; rirActual?: number | null }>,
  exerciseById: Map<string, { id: string; name: string; repRange: string }>,
): Promise<void> {
  try {
    const previousSets = await storage.getPreviousSetLogs(userId, day);
    const prevByExercise = groupSetsByExercise(previousSets);

    for (const [exerciseId, currentSets] of groupSetsByExercise(sets)) {
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) continue;

      const verdict = analyseExercisePerformance(exercise, currentSets, prevByExercise.get(exerciseId) ?? []);
      if (!verdict) continue;

      await storage.createRecommendation({
        userId,
        exerciseId,
        type: verdict.type,
        message: verdict.message,
        details: verdict.details,
        week,
        status: "pending",
      });
    }
  } catch (err) {
    // Coaching cues are a nicety; never fail a saved workout over them.
    logger.error({ err, userId, day }, "failed to generate progression recommendations");
  }
}

// ── Sets & weight recommendations ───────────────────────────────────────────

workoutRouter.get(
  "/sets/previous/:day",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day } = dayParamSchema.parse(req.params);
    res.json(await storage.getPreviousSetLogs(userIdOf(req), day));
  }),
);

workoutRouter.get(
  "/sets/recommendations/:day",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day } = dayParamSchema.parse(req.params);
    const { week } = weekParamSchema.parse(req.query);
    const userId = userIdOf(req);

    const program = await activeProgram(userId);
    const exercises = applyProgramRules(await storage.getExercisesByDay(day, program), program, week);

    /*
     * Volume follows an ACTIVE deload event, not the calendar.
     *
     * The deload used to be a function of the week number; the program's RULES
     * sheet has no calendar deload at all, only fatigue-triggered ones the
     * athlete activates. RULES: DELOAD_T2 | week_sets — 40-50% of normal.
     */
    const deload = await storage.getActiveDeload(userId);
    const onFullDeload = deload?.tier === 2;

    const result: Record<string, unknown[]> = {};
    for (const exercise of exercises) {
      const numSets = onFullDeload ? setsForDeload(exercise.defaultSets) : exercise.defaultSets;
      result[exercise.id] = await getRecommendedWeightsForExercise(
        userId,
        exercise.id,
        numSets,
        week,
        isUnilateralInputType(exercise.inputType),
      );
    }
    res.json(result);
  }),
);

// ── Recommendations ─────────────────────────────────────────────────────────

export const recommendationRouter = Router();

recommendationRouter.get(
  "/recommendations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = listQuerySchema.parse(req.query);
    res.json(await storage.getRecommendationsByUser(userIdOf(req), status));
  }),
);

recommendationRouter.get(
  "/recommendations/pending",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await storage.getRecommendationsByUser(userIdOf(req), "pending"));
  }),
);

recommendationRouter.patch(
  "/recommendations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(["pending", "accepted", "dismissed", "completed"]) }).parse(req.body);
    const id = z.string().uuid().parse(req.params.id);

    // Confirm ownership before updating; the id alone used to be enough.
    const existing = await storage.getRecommendation(id);
    if (!existing || existing.userId !== userIdOf(req)) throw notFound("Recommendation not found");

    res.json(await storage.updateRecommendation(id, status));
  }),
);
