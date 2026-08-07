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
  opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 12;
  const baseDelay = opts.baseDelayMs ?? 400;
  const maxDelay = opts.maxDelayMs ?? 5_000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
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
      if (attempt === attempts) break;

      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      logger.warn(
        {
          attempt,
          of: attempts,
          retryInMs: delay,
          target: describeDatabaseTarget(),
          reason: (error as Error).message,
        },
        "database not reachable yet — retrying",
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Could not reach the database at ${describeDatabaseTarget()} after ${attempts} attempts. ` +
      `Last error: ${(lastError as Error)?.message}. ` +
      `Check DATABASE_URL, that the database service is running, and DATABASE_SSL ` +
      `(managed providers usually need it set to true).`,
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
