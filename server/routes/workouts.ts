import { Router } from "express";
import { z } from "zod";
import {
  workoutCompleteSchema,
  dayParamSchema,
  weekParamSchema,
  listQuerySchema,
  MAX_WEEK,
  PROGRAMS,
  type InsertSetLog,
  type WorkoutLog,
  type Exercise,
} from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, notFound } from "../middleware/error";
import { getCurrentPhase, applyProgramRules, isUnilateralInputType } from "../lib/program";
import { setsForDeload } from "@shared/program-rules";
import { getRecommendedWeightsForExercise } from "../lib/autofill";
import {
  resolveSubstitute,
  getLastPerformedBySlot,
  getRecentSubstitutes,
  normaliseSubstituteName,
} from "../lib/substitutions";
import { analyseExercisePerformance, groupSetsByExercise } from "../lib/progressionAnalysis";
import { syncTrainingSession } from "../integrations/notion";
import { activeSeason } from "../lib/season";
import { seasonOf } from "@shared/seasons";

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
    const program = z.enum(PROGRAMS).optional().parse(req.query.program);
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
    const userId = userIdOf(req);
    // A week is only meaningful inside a season; without one, every season.
    const scope = week ? { season: (await activeSeason(userId)).season, week } : undefined;
    res.json(await storage.getWorkoutLogsByUser(userId, scope));
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
    const userId = userIdOf(req);
    const { season } = await activeSeason(userId);
    res.json((await storage.getCurrentWorkoutLog(userId, season, day, week)) ?? null);
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
    // The season follows the program the session was logged under.
    const season = seasonOf(resolvedProgram);

    // Only accept sets for exercises that belong to this day's program. Without
    // this a client could attribute sets to any exercise id it liked.
    const dayExercises = await storage.getExercisesByDay(day, resolvedProgram);
    const exerciseById = new Map(dayExercises.map((e) => [e.id, e]));
    const acceptedSets = (sets ?? []).filter((s) => exerciseById.has(s.exerciseId));
    const rejected = (sets?.length ?? 0) - acceptedSets.length;
    if (rejected > 0) {
      logger.warn({ userId, day, rejected }, "dropped sets referencing exercises outside this day");
    }

    let workoutLog = await storage.getCurrentWorkoutLog(userId, season, day, week);
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
        season,
        phase: phase ?? getCurrentPhase(week, resolvedProgram),
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
      /*
       * Re-point substituted sets at the movement that was actually performed.
       *
       * The set arrives naming the PLANNED exercise — that is what the day
       * check above validated — plus the substitute's name. Saving it under the
       * planned id would teach that exercise a weight from a different
       * movement; saving it with no record of the slot would lose what the
       * swap was for. It gets both: exerciseId = substitute, and the slot in
       * substitutedForExerciseId.
       *
       * Names are resolved once each, so eight sets of one substitute do not
       * create eight rows or eight lookups.
       */
      const substitutes = new Map<string, Exercise>();
      const cacheKey = (plannedId: string, name: string) => `${plannedId}|${name.toLowerCase()}`;

      for (const set of acceptedSets) {
        const name = set.substituteName?.trim();
        if (!name) continue;
        const key = cacheKey(set.exerciseId, name);
        if (substitutes.has(key)) continue;
        substitutes.set(key, await resolveSubstitute(name, exerciseById.get(set.exerciseId)!, resolvedProgram));
      }

      const rows: InsertSetLog[] = acceptedSets.map((s) => {
        const name = s.substituteName?.trim();
        const substitute = name ? substitutes.get(cacheKey(s.exerciseId, name)) : undefined;

        return {
          workoutLogId: workoutLog!.id,
          exerciseId: substitute?.id ?? s.exerciseId,
          substitutedForExerciseId: substitute ? s.exerciseId : null,
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
        };
      });
      await storage.createSetLogs(rows);

      // Progression cues compare like with like, so a substituted set is judged
      // against that substitute's own history, not the planned exercise's.
      const forAnalysis = acceptedSets.map((s, i) => ({ ...s, exerciseId: rows[i].exerciseId }));
      const analysisExercises = new Map(exerciseById);
      for (const substitute of substitutes.values()) analysisExercises.set(substitute.id, substitute);
      await generateRecommendations(userId, season, week, day, forAnalysis, analysisExercises);
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
  season: number,
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
        season,
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

/**
 * What was actually performed in each of this day's slots, last time.
 *
 * Keyed by the PLANNED exercise id, so the workout screen can say "last week
 * you did X here" against the row you are looking at — including when X was a
 * substitute for something else.
 */
workoutRouter.get(
  "/sets/last-performed/:day",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { day } = dayParamSchema.parse(req.params);
    const userId = userIdOf(req);
    const program = await activeProgram(userId);
    const exercises = await storage.getExercisesByDay(day, program);
    res.json(await getLastPerformedBySlot(userId, exercises));
  }),
);

/** Substitutes this athlete has used before — the top of the swap picker. */
workoutRouter.get(
  "/substitutes/recent",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getRecentSubstitutes(userIdOf(req)));
  }),
);

/**
 * Weight suggestion for a movement chosen mid-session.
 *
 * Swapping to a substitute has to answer "what did I do on THIS last time",
 * and the day's recommendation payload was built before the swap existed. The
 * name is resolved the same way the save path resolves it, so the weight shown
 * is the weight of the row the sets will land on.
 */
workoutRouter.get(
  "/substitutes/recommendation",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, plannedExerciseId, week, sets } = z
      .object({
        name: z.string().trim().min(1).max(120),
        plannedExerciseId: z.string().uuid(),
        week: z.coerce.number().int().min(1).max(MAX_WEEK),
        sets: z.coerce.number().int().min(1).max(20).default(3),
      })
      .parse(req.query);

    const userId = userIdOf(req);
    const program = await activeProgram(userId);
    const dayExercises = await storage.getAllExercises(program);
    const planned = dayExercises.find((e) => e.id === plannedExerciseId);
    if (!planned) throw notFound("Exercise not found");

    // Read-only: resolve by name without creating a row for a substitute the
    // athlete is only browsing. Nothing is written until the session is saved.
    const existing = await storage.findExercisesByName(normaliseSubstituteName(name));
    if (existing.length === 0) {
      res.json({ exerciseId: null, recommendations: [] });
      return;
    }

    const match =
      existing.find((e) => e.program === program) ??
      [...existing].sort((a, b) => a.program.localeCompare(b.program) || a.id.localeCompare(b.id))[0];

    res.json({
      exerciseId: match.id,
      name: match.name,
      recommendations: await getRecommendedWeightsForExercise(
        userId,
        match.id,
        sets,
        week,
        isUnilateralInputType(planned.inputType),
      ),
    });
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
