import { Router } from "express";
import { z } from "zod";
import {
  cardioSessionRequestSchema,
  vacuumSessionRequestSchema,
  listQuerySchema,
} from "@shared/schema";
import { storage } from "../storage";
import { activeSeason } from "../lib/season";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, notFound } from "../middleware/error";

export const CARDIO_WEEKLY_GOAL = 3;

export const conditioningRouter = Router();

const idParam = z.string().uuid();

// ── Cardio ──────────────────────────────────────────────────────────────────

conditioningRouter.get(
  "/cardio",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { week, type } = listQuerySchema.parse(req.query);
    const userId = userIdOf(req);
    // A week is scoped to the current season; with no week, every season.
    const scope = week ? { season: (await activeSeason(userId)).season, week } : undefined;
    res.json(await storage.getCardioSessionsByUser(userId, scope, type));
  }),
);

conditioningRouter.post(
  "/cardio",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = cardioSessionRequestSchema.parse(req.body);
    const userId = userIdOf(req);
    const { season } = await activeSeason(userId);
    const session = await storage.createCardioSession({
      userId,
      date: new Date(data.date),
      week: data.week,
      season,
      type: data.type,
      // A subtype only means something for LISS.
      subtype: data.type === "LISS" ? (data.subtype ?? null) : null,
      durationMin: data.durationMin,
      notes: data.notes ?? "",
    });
    res.status(201).json(session);
  }),
);

conditioningRouter.delete(
  "/cardio/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    // Delete used to accept any id from any account.
    const existing = await storage.getCardioSession(id);
    if (!existing || existing.userId !== userIdOf(req)) throw notFound("Cardio session not found");

    await storage.deleteCardioSession(id);
    res.json({ success: true });
  }),
);

conditioningRouter.get(
  "/stats/cardio",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { week } = listQuerySchema.parse(req.query);
    const userId = userIdOf(req);

    // Stats are computed over the current season's history; `week` selects
    // which week the goal and streak are measured against. Week numbers repeat
    // across seasons, so mixing seasons would count two weeks as one.
    const sessions = await storage.getCardioSessionsByUser(userId, { season: (await activeSeason(userId)).season });

    const byWeek = new Map<number, number>();
    for (const s of sessions) byWeek.set(s.week, (byWeek.get(s.week) ?? 0) + 1);

    const currentWeekSessions = week ? (byWeek.get(week) ?? 0) : 0;

    let streak = 0;
    if (week) {
      for (let w = week; w >= 1; w--) {
        if ((byWeek.get(w) ?? 0) >= CARDIO_WEEKLY_GOAL) streak++;
        else break;
      }
    }

    const scoped = week ? sessions.filter((s) => s.week === week) : sessions;

    res.json({
      totalSessions: scoped.length,
      totalDuration: scoped.reduce((sum, s) => sum + s.durationMin, 0),
      hiitCount: scoped.filter((s) => s.type === "HIIT").length,
      lissCount: scoped.filter((s) => s.type === "LISS").length,
      weeklyGoal: CARDIO_WEEKLY_GOAL,
      currentWeekSessions,
      isGoalMet: currentWeekSessions >= CARDIO_WEEKLY_GOAL,
      streak,
    });
  }),
);

// ── Vacuum ──────────────────────────────────────────────────────────────────

conditioningRouter.get(
  "/vacuum",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { week, timeOfDay } = listQuerySchema.parse(req.query);
    const userId = userIdOf(req);
    const scope = week ? { season: (await activeSeason(userId)).season, week } : undefined;
    res.json(await storage.getVacuumSessionsByUser(userId, scope, timeOfDay));
  }),
);

conditioningRouter.post(
  "/vacuum",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = vacuumSessionRequestSchema.parse(req.body);
    const userId = userIdOf(req);
    const { season } = await activeSeason(userId);
    const session = await storage.createVacuumSession({
      userId,
      date: new Date(data.date),
      week: data.week,
      season,
      timeOfDay: data.timeOfDay,
      sets: data.sets,
      durationSec: data.durationSec,
      notes: data.notes ?? "",
    });
    res.status(201).json(session);
  }),
);

conditioningRouter.delete(
  "/vacuum/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const existing = await storage.getVacuumSession(id);
    if (!existing || existing.userId !== userIdOf(req)) throw notFound("Vacuum session not found");

    await storage.deleteVacuumSession(id);
    res.json({ success: true });
  }),
);

/** Local calendar day key, used to group sessions into days. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

conditioningRouter.get(
  "/stats/vacuum",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const today = new Date();

    /*
     * Streaks used to be computed by querying the database once per day walked
     * backwards, in a `while (true)` loop with no bound — a 200-day streak meant
     * 200 queries, each loading the user's whole vacuum history. Here a single
     * ranged query covers the window and the walk happens in memory.
     */
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 400);
    windowStart.setHours(0, 0, 0, 0);

    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    const sessions = await storage.getVacuumSessionsBetween(userId, windowStart, endOfToday);

    const daysWithSessions = new Set(sessions.map((s) => dayKey(new Date(s.date))));

    let streak = 0;
    const cursor = new Date(today);
    while (daysWithSessions.has(dayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    const todayKey = dayKey(today);
    const todaySessions = sessions.filter((s) => dayKey(new Date(s.date)) === todayKey);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const weekSessions = sessions.filter((s) => new Date(s.date) >= startOfWeek);

    res.json({
      todayCompleted: todaySessions.length > 0,
      todaySessions: todaySessions.length,
      todayTotalSets: todaySessions.reduce((sum, s) => sum + s.sets, 0),
      todayTotalSeconds: todaySessions.reduce((sum, s) => sum + s.sets * s.durationSec, 0),
      todayLongestHold: todaySessions.length ? Math.max(...todaySessions.map((s) => s.durationSec)) : 0,
      streak,
      daysPracticed: new Set(weekSessions.map((s) => dayKey(new Date(s.date)))).size,
      weekTotalSets: weekSessions.reduce((sum, s) => sum + s.sets, 0),
      avgHoldDuration: weekSessions.length
        ? Math.round(weekSessions.reduce((sum, s) => sum + s.durationSec, 0) / weekSessions.length)
        : 0,
      bestHold: weekSessions.length ? Math.max(...weekSessions.map((s) => s.durationSec)) : 0,
    });
  }),
);
