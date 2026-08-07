/**
 * Test bootstrap.
 *
 * Runs before any test file imports the app, so `server/env.ts` sees a valid
 * configuration. Integration tests need a real Postgres — set TEST_DATABASE_URL
 * (or DATABASE_URL) and they run; leave it unset and they skip while the pure
 * unit tests still execute.
 */
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.LOG_LEVEL ??= "silent";
process.env.AUTO_MIGRATE ??= "false";
process.env.AUTO_SEED ??= "false";
process.env.UPLOAD_DIR ??= "./data/test-uploads";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/thanos_test";

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL);
