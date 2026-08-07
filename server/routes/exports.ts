import { Router, type Response } from "express";
import { z } from "zod";
import * as XLSX from "xlsx";
import { PROGRAMS } from "@shared/schema";
import { storage } from "../storage";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { toCsv, isoDate } from "../lib/csv";
import { getCurrentPhase } from "../lib/program";

export const exportRouter = Router();

function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Byte-order mark so Excel reads the UTF-8 exercise names correctly (the
  // program is full of "—" and "×").
  res.send("﻿" + body);
}

exportRouter.get(
  "/export/workouts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const workouts = await storage.getWorkoutLogsByUser(userId);
    const [allExercises, setsByWorkout] = await Promise.all([
      storage.getAllExercises(),
      storage.getSetLogsByWorkouts(workouts.map((w) => w.id)),
    ]);
    const exerciseById = new Map(allExercises.map((e) => [e.id, e]));

    const rows = workouts.flatMap((workout) =>
      (setsByWorkout.get(workout.id) ?? []).map((set) => {
        const exercise = exerciseById.get(set.exerciseId);
        return [
          isoDate(workout.date),
          workout.week,
          workout.phase,
          workout.day,
          exercise?.number ?? "",
          exercise?.name ?? "",
          set.setNumber,
          set.side ?? "",
          set.weightLbs ?? "",
          set.reps ?? "",
          set.durationSecs ?? "",
          set.rirActual ?? "",
          set.isFailure ? "yes" : "",
          set.bandNote ?? "",
        ];
      }),
    );

    sendCsv(
      res,
      "thanos_workouts.csv",
      toCsv(
        ["Date", "Week", "Phase", "Day", "Exercise#", "Exercise", "Set", "Side", "Weight(lbs)", "Reps", "Duration(s)", "RIR", "Failure", "Band"],
        rows,
      ),
    );
  }),
);

exportRouter.get(
  "/export/checkins",
  requireAuth,
  asyncHandler(async (req, res) => {
    const checkIns = await storage.getCheckInsByUser(userIdOf(req));
    const rows = checkIns.map((c) => [
      isoDate(c.date), c.week, c.phase, c.weightLbs, c.waistRelaxed, c.waistVacuum, c.chest,
      c.armsLeft, c.armsRight, c.shoulders, c.thighsLeft, c.thighsRight, c.calvesLeft, c.calvesRight,
      c.shoulderToWaist, c.sleepQuality, c.energyLevels, c.trainingMotivation, c.hungerAppetite, c.mood, c.notes,
    ]);

    sendCsv(
      res,
      "thanos_checkins.csv",
      toCsv(
        ["Date", "Week", "Phase", "Weight", "Waist_Relaxed", "Waist_Vacuum", "Chest", "Arms_L", "Arms_R", "Shoulders", "Thighs_L", "Thighs_R", "Calves_L", "Calves_R", "SW_Ratio", "Sleep", "Energy", "Motivation", "Hunger", "Mood", "Notes"],
        rows,
      ),
    );
  }),
);

exportRouter.get(
  "/export/recommendations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const recs = await storage.getRecommendationsByUser(userIdOf(req));
    const rows = recs.map((r) => [isoDate(r.createdAt), r.week, r.type, r.message, r.status]);
    sendCsv(res, "thanos_recommendations.csv", toCsv(["Date", "Week", "Type", "Message", "Status"], rows));
  }),
);

exportRouter.get(
  "/export/cardio",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await storage.getCardioSessionsByUser(userIdOf(req));
    const rows = sessions.map((s) => [
      isoDate(s.date), s.week, getCurrentPhase(s.week), s.type, s.subtype, s.durationMin, s.notes,
    ]);
    sendCsv(res, "thanos_cardio.csv", toCsv(["Date", "Week", "Phase", "Type", "Subtype", "Duration_Min", "Notes"], rows));
  }),
);

exportRouter.get(
  "/export/vacuum",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await storage.getVacuumSessionsByUser(userIdOf(req));
    const rows = sessions.map((s) => [
      isoDate(s.date), s.week, getCurrentPhase(s.week), s.timeOfDay, s.sets, s.durationSec, s.sets * s.durationSec, s.notes,
    ]);
    sendCsv(
      res,
      "thanos_vacuum.csv",
      toCsv(["Date", "Week", "Phase", "Time_of_Day", "Sets", "Duration_Sec", "Total_Sec", "Notes"], rows),
    );
  }),
);

const SEGMENT_LABELS: Record<string, string> = {
  warmup: "Warm-up",
  working: "Working Sets",
  finisher: "Finisher",
  cooldown: "Cool-down",
};

/** The program itself as a workbook, one sheet per training day. */
exportRouter.get(
  "/export/program",
  requireAuth,
  asyncHandler(async (req, res) => {
    const program = z.enum(PROGRAMS).catch("phase3").parse(req.query.program);
    const allExercises = await storage.getAllExercises(program);

    const workbook = XLSX.utils.book_new();
    for (let day = 1; day <= 6; day++) {
      const dayExercises = allExercises.filter((e) => e.day === day).sort((a, b) => a.order - b.order);
      if (dayExercises.length === 0) continue;

      const sheet = XLSX.utils.json_to_sheet(
        dayExercises.map((e) => ({
          "#": e.number,
          Segment: SEGMENT_LABELS[e.segment] ?? e.segment,
          Exercise: e.name,
          Sets: e.defaultSets,
          "Rep Range": e.repRange,
          Tempo: e.tempo,
          RIR: e.rir,
          "Rest (s)": e.restSeconds,
          Notes: e.notes ?? "",
          Alternate: e.alternate ?? "",
          "Video URL": e.videoUrl ?? "",
        })),
      );
      sheet["!cols"] = [
        { wch: 5 }, { wch: 14 }, { wch: 32 }, { wch: 6 }, { wch: 12 },
        { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 40 }, { wch: 24 }, { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, `Day ${day}`);
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="thanos_program_${program}.xlsx"`);
    res.send(buffer);
  }),
);
