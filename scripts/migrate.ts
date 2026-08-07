/** Apply pending migrations and exit. Used by CI, Docker and `npm run db:migrate`. */
import { runMigrations } from "../server/migrate";
import { closeDb } from "../server/db";
import { logger } from "../server/logger";

runMigrations()
  .then(() => closeDb())
  .catch(async (err) => {
    logger.fatal({ err }, "migration failed");
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
