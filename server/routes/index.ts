import { Router } from "express";
import { authRouter } from "./auth";
import { workoutRouter, recommendationRouter } from "./workouts";
import { checkInRouter } from "./checkins";
import { conditioningRouter } from "./conditioning";
import { exportRouter } from "./exports";
import { uploadRouter } from "./uploads";
import { fatigueRouter } from "./fatigue";

/** Everything mounted under /api. */
export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: Math.round(process.uptime()) });
});

apiRouter.use(authRouter);
apiRouter.use(workoutRouter);
apiRouter.use(recommendationRouter);
apiRouter.use(checkInRouter);
apiRouter.use(conditioningRouter);
apiRouter.use(exportRouter);
apiRouter.use(uploadRouter);
apiRouter.use(fatigueRouter);

export { objectRouter } from "./uploads";
