import express, { type Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import compression from "compression";
import { pinoHttp } from "pino-http";
import { pool } from "./db";
import { env, isProduction, isTest, sessionSecret } from "./env";
import { logger } from "./logger";
import { apiRouter, objectRouter } from "./routes";
import { errorHandler } from "./middleware/error";
import { applySecurityHeaders, apiLimiter, verifySameOrigin } from "./middleware/security";

const PgStore = connectPgSimple(session);

/**
 * Build the Express app without starting a server.
 *
 * Keeping `listen` out of here is what lets the integration tests drive the
 * real app over supertest instead of mocking the routes.
 */
export function buildApp(): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  applySecurityHeaders(app);
  app.use(compression());

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks and static assets would otherwise dominate the log.
        autoLogging: { ignore: (req) => !req.url?.startsWith("/api") || req.url === "/api/health" },
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      }),
    );
  }

  /*
   * Body parsing, skipping the raw photo upload.
   *
   * PUT /api/uploads/put streams image bytes and parses them in its own route.
   * Both parsers have to stand aside: whichever one matches the request's
   * Content-Type consumes the stream first, leaving the route an empty body.
   */
  const jsonParser = express.json({ limit: "1mb" });
  const formParser = express.urlencoded({ extended: false, limit: "1mb" });
  const RAW_BODY_PATHS = new Set(["/api/uploads/put"]);

  app.use((req, res, next) => {
    if (RAW_BODY_PATHS.has(req.path)) return next();
    jsonParser(req, res, (err) => (err ? next(err) : formParser(req, res, next)));
  });

  app.use(
    session({
      name: "thanos.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new PgStore({
        pool,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 15,
      }),
      cookie: {
        maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      },
    }),
  );

  app.use(verifySameOrigin);
  app.use("/api", apiLimiter, apiRouter);
  app.use(objectRouter);

  // Unmatched /api paths answer as JSON rather than falling through to the SPA.
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
  });

  return app;
}

/** Attach the error handler last, after the SPA/static routes are mounted. */
export function finalizeApp(app: Express): void {
  app.use(errorHandler);
}
