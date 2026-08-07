import type { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

/** An authenticated request — `userId` is guaranteed present past requireAuth. */
export interface AuthedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).userId = req.session.userId;
  next();
}

/** Read the user id inside a route that sits behind requireAuth. */
export function userIdOf(req: Request): string {
  const userId = (req as AuthedRequest).userId ?? req.session?.userId;
  if (!userId) {
    // Only reachable if a route is mounted without requireAuth — a wiring bug.
    throw Object.assign(new Error("Route requires authentication"), { status: 401 });
  }
  return userId;
}
