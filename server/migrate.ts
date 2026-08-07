import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import { logger } from "./logger";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apply pending SQL migrations.
 *
 * The Replit version ran `drizzle-kit push`, which diffs the schema against the
 * live database and applies whatever it infers — fine for a scratch database,
 * risky for one holding a season of training data, since a rename reads as
 * "drop the old column". Migrations are checked-in SQL files instead: reviewable,
 * ordered, and identical in every environment.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(here, "..", "migrations");
  logger.info({ migrationsFolder }, "applying database migrations");
  await migrate(db, { migrationsFolder });
  logger.info("migrations up to date");
}
