import { Router } from "express";
import express from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, badRequest, conflict } from "../middleware/error";
import { importHistory, ImportConflictError, ImportEmptyError } from "../lib/history-import";

export const historyImportRouter = Router();

/**
 * Upload an exported history CSV.
 *
 * This exists because the alternative was a command-line script, and the person
 * who needs it runs this app as a PWA on a phone. A migration you cannot
 * perform from the device you use is not a migration.
 *
 * The body is the raw CSV rather than JSON so the browser can post a File
 * directly with no encoding step. Its own parser, with a larger limit than the
 * global one: six months of training is ~100 KB and a full prep is more.
 */
const csvParser = express.text({ type: ["text/csv", "text/plain"], limit: "8mb" });

/** An import is a heavy, destructive-ish write; a handful an hour is plenty. */
const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const optionsSchema = z.object({
  dryRun: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  replace: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

historyImportRouter.post(
  "/history/import",
  requireAuth,
  importLimiter,
  csvParser,
  asyncHandler(async (req, res) => {
    const { dryRun, replace } = optionsSchema.parse(req.query);
    const csv = typeof req.body === "string" ? req.body : "";

    if (!csv.trim()) {
      throw badRequest("No CSV was received. Send the file as text/csv.");
    }

    const userId = userIdOf(req);
    const user = await storage.getUser(userId);

    try {
      const report = await importHistory({
        userId,
        activeProgram: user?.activeProgram ?? "phase3",
        csv,
        dryRun,
        replace,
      });
      res.json(report);
    } catch (err) {
      // Both are the user's problem to resolve, not a server fault.
      if (err instanceof ImportConflictError) throw conflict(err.message);
      if (err instanceof ImportEmptyError) throw badRequest(err.message);
      throw err;
    }
  }),
);
