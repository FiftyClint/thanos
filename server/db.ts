import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { env } from "./env";
import { logger } from "./logger";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

/** The database host, with credentials stripped, for logging. */
export function describeDatabaseTarget(): string {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the database to accept a connection before doing anything with it.
 *
 * Containers start faster than the networks around them. Railway's private
 * network takes a moment to initialise after a container starts, Fly's Postgres
 * may still be booting, and `docker compose` can start the app before the
 * database finishes its first-run setup. Connecting immediately and exiting on
 * failure turns any of those into a crash loop that never recovers — the
 * platform restarts the container, it races the network again, and the health
 * check eventually gives up.
 *
 * Retrying costs a few seconds in the worst case and nothing in the normal one.
 */
export async function waitForDatabase(
  opts: { timeoutMs?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<void> {
  /*
   * Bounded by wall-clock time, not attempt count.
   *
   * Counting attempts is the obvious approach and the wrong one: a connection
   * that HANGS (misrouted private network, wrong port, packet-dropping
   * firewall) burns the full connect timeout each time, so "12 attempts" can
   * mean over two minutes — longer than the platform's health-check window.
   * Startup would then fail for taking too long to report a problem it had
   * already diagnosed. A deadline caps the worst case whatever the failure mode.
   */
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const baseDelay = opts.baseDelayMs ?? 400;
  const maxDelay = opts.maxDelayMs ?? 4_000;

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown;

  for (;;) {
    attempt++;
    try {
      const client = await pool.connect();
      try {
        await client.query("select 1");
      } finally {
        client.release();
      }
      if (attempt > 1) {
        logger.info({ attempt, target: describeDatabaseTarget() }, "database is reachable");
      }
      return;
    } catch (error) {
      lastError = error;

      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      if (Date.now() + delay >= deadline) break;

      logger.warn(
        {
          attempt,
          retryInMs: delay,
          msRemaining: Math.max(0, deadline - Date.now()),
          target: describeDatabaseTarget(),
          reason: (error as Error).message,
        },
        "database not reachable yet — retrying",
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Could not reach the database at ${describeDatabaseTarget()} within ${Math.round(timeoutMs / 1000)}s ` +
      `(${attempt} attempts). Last error: ${(lastError as Error)?.message}. ` +
      `Check DATABASE_URL, that the database service is running, and DATABASE_SSL ` +
      `(managed providers usually need it set to true).`,
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
