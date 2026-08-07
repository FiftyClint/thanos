import { Router } from "express";
import { checkInDataSchema } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, badRequest } from "../middleware/error";
import { ownerOfKey } from "../files";
import { syncCheckIn } from "../integrations/notion";

export const checkInRouter = Router();

checkInRouter.get(
  "/checkins",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await storage.getCheckInsByUser(userIdOf(req)));
  }),
);

checkInRouter.get(
  "/checkins/latest",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json((await storage.getLatestCheckIn(userIdOf(req))) ?? null);
  }),
);

checkInRouter.post(
  "/checkins",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    // The original client wrapped the body in `{ data: ... }`; accept both.
    const data = checkInDataSchema.parse(req.body?.data ?? req.body);

    const values = {
      userId,
      week: data.week,
      date: new Date(data.date),
      phase: data.phase,
      weightLbs: data.weightLbs ?? null,
      waistRelaxed: data.waistRelaxed ?? null,
      waistVacuum: data.waistVacuum ?? null,
      chest: data.chest ?? null,
      armsLeft: data.armsLeft ?? null,
      armsRight: data.armsRight ?? null,
      shoulders: data.shoulders ?? null,
      thighsLeft: data.thighsLeft ?? null,
      thighsRight: data.thighsRight ?? null,
      calvesLeft: data.calvesLeft ?? null,
      calvesRight: data.calvesRight ?? null,
      shoulderToWaist: data.shoulderToWaist ?? null,
      sleepQuality: data.sleepQuality ?? null,
      energyLevels: data.energyLevels ?? null,
      trainingMotivation: data.trainingMotivation ?? null,
      hungerAppetite: data.hungerAppetite ?? null,
      mood: data.mood ?? null,
      notes: data.notes ?? "",
      triggersJson: "[]",
    };

    // One check-in per week: submitting again corrects that week rather than
    // adding a second row that then fights the first one on every chart.
    const existing = await storage.getCheckInByWeek(userId, data.week);
    const checkIn = existing
      ? await storage.updateCheckIn(existing.id, values)
      : await storage.createCheckIn(values);

    for (const photo of data.photos ?? []) {
      // Photo keys embed their owner, so a forged path from another account is
      // refused rather than being attached to this check-in.
      const key = photo.objectPath.replace(/^\/objects\//, "");
      if (ownerOfKey(key) !== userId) {
        throw badRequest("Photo does not belong to this account");
      }
      await storage.createPhoto({
        userId,
        checkInId: checkIn.id,
        filePath: photo.objectPath,
        poseType: photo.poseType,
        week: data.week,
      });
    }

    res.status(existing ? 200 : 201).json(checkIn);

    void syncCheckIn(checkIn).catch((err) => logger.error({ err }, "notion check-in sync failed"));
  }),
);

checkInRouter.get(
  "/photos",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await storage.getPhotosByUser(userIdOf(req)));
  }),
);
