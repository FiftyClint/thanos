/**
 * Sync program content into the database.
 *
 *   npm run db:seed            apply changes
 *   npm run db:seed:dry        report what would change, touch nothing
 *
 * The dry run exists because removing an exercise from a seed file also removes
 * the sets logged against it. Check the "-N" column before applying a content edit.
 */
import { syncAllPrograms } from "../server/seed";
import { closeDb } from "../server/db";
import { logger } from "../server/logger";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const results = await syncAllPrograms({ dryRun });

  const removed = results.reduce((sum, r) => sum + r.removed, 0);
  if (dryRun && removed > 0) {
    logger.warn(
      { removed },
      `${removed} exercise(s) would be removed — their logged sets would go with them`,
    );
  }
  await closeDb();
}

main().catch(async (err) => {
  logger.fatal({ err }, "seed failed");
  await closeDb().catch(() => undefined);
  process.exit(1);
});
