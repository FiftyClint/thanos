import { createServer } from "node:http";
import { env, isProduction } from "./env";
import { logger } from "./logger";
import { buildApp, finalizeApp } from "./app";
import { runMigrations } from "./migrate";
import { syncAllPrograms } from "./seed";
import { closeDb, waitForDatabase, describeDatabaseTarget } from "./db";

async function main(): Promise<void> {
  // Nothing below works without a database, so establish it first rather than
  // failing halfway through a migration.
  logger.info({ target: describeDatabaseTarget() }, "connecting to database");
  await waitForDatabase();

  if (env.AUTO_MIGRATE) {
    await runMigrations();
  }
  if (env.AUTO_SEED) {
    await syncAllPrograms();
  }

  const app = buildApp();
  const httpServer = createServer(app);

  if (isProduction) {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  finalizeApp(app);

  httpServer.listen({ port: env.PORT, host: env.HOST }, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `Thanos Program listening on ${env.HOST}:${env.PORT}`);
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then close the pool. Without this a deploy could cut a workout
   * save in half.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    const forceExit = setTimeout(() => {
      logger.warn("shutdown timed out; exiting");
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    httpServer.close(async () => {
      await closeDb().catch((err) => logger.error({ err }, "error closing database pool"));
      logger.info("shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
