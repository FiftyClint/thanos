import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
  programSchema,
  type PublicUser,
  type User,
} from "@shared/schema";
import { storage } from "../storage";
import { env } from "../env";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, badRequest, forbidden, HttpError } from "../middleware/error";
import { authLimiter, registrationLimiter } from "../middleware/security";

const BCRYPT_ROUNDS = 12;

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

/** Promisified session regenerate/destroy so route handlers stay linear. */
function regenerateSession(req: Parameters<typeof requireAuth>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export const authRouter = Router();

authRouter.post(
  "/auth/register",
  registrationLimiter,
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    // ALLOW_REGISTRATION=false locks the instance down once you have an account,
    // but the very first registration is always permitted so a fresh deploy is usable.
    if (!env.ALLOW_REGISTRATION && (await storage.countUsers()) > 0) {
      throw forbidden("Registration is closed on this instance");
    }

    if (await storage.getUserByEmail(data.email)) {
      throw badRequest("Email already registered");
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const user = await storage.createUser({
      email: data.email,
      name: data.name,
      passwordHash,
      role: "athlete",
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    logger.info({ userId: user.id }, "user registered");
    res.status(201).json(toPublicUser(user));
  }),
);

authRouter.post(
  "/auth/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await storage.getUserByEmail(data.email);

    // Compare against a dummy hash when the account doesn't exist so the
    // response time doesn't reveal which emails are registered.
    const hash = user?.passwordHash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
    const valid = await bcrypt.compare(data.password, hash);

    if (!user || !valid) {
      throw new HttpError(401, "Invalid credentials");
    }

    // New session id on login defeats session fixation.
    await regenerateSession(req);
    req.session.userId = user.id;
    logger.info({ userId: user.id }, "user logged in");
    res.json(toPublicUser(user));
  }),
);

authRouter.post("/auth/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("thanos.sid");
    res.json({ success: true });
  });
});

authRouter.get(
  "/user",
  asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      res.status(401).json(null);
      return;
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      // Session outlived the account.
      req.session.destroy(() => undefined);
      res.status(401).json(null);
      return;
    }
    res.json(toPublicUser(user));
  }),
);

authRouter.put(
  "/user/program",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { program } = programSchema.parse(req.body);
    await storage.setUserActiveProgram(userIdOf(req), program);
    res.json({ activeProgram: program });
  }),
);

authRouter.put(
  "/user/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = updateProfileSchema.parse(req.body);

    const updates: Partial<User> = { ...data } as Partial<User>;
    if (data.showDate !== undefined) {
      updates.showDate = data.showDate ? new Date(data.showDate) : null;
    }
    if (data.prepStartDate !== undefined) {
      updates.prepStartDate = data.prepStartDate ? new Date(data.prepStartDate) : null;
    }

    const updated = await storage.updateUser(userIdOf(req), updates);
    res.json(toPublicUser(updated));
  }),
);

authRouter.put(
  "/user/password",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = userIdOf(req);

    const user = await storage.getUser(userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new HttpError(401, "Current password is incorrect");
    }

    await storage.updateUser(userId, { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) });
    logger.info({ userId }, "password changed");
    res.json({ success: true });
  }),
);
