import { sql } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { db } from "../../server/db";

/**
 * Integration tests need a real Postgres. Point TEST_DATABASE_URL at a
 * throwaway database and they run; leave it unset and they skip.
 */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDatabase(): Promise<void> {
  // Exercises are left in place — the seeder owns them and every test needs them.
  await db.execute(
    sql`TRUNCATE TABLE set_logs, workout_logs, progress_photos, weekly_check_ins, recommendations, cardio_sessions, vacuum_sessions, session, users RESTART IDENTITY CASCADE`,
  );
}

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  id: string;
  email: string;
}

let counter = 0;

/** Register a fresh user and return an agent that carries their session cookie. */
export async function createUser(app: Express, overrides: Partial<{ email: string; password: string }> = {}): Promise<TestUser> {
  const email = overrides.email ?? `athlete${++counter}@example.com`;
  const password = overrides.password ?? "correct horse battery";

  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ name: `Athlete ${counter}`, email, password })
    .expect(201);

  return { agent, id: res.body.id, email };
}

export async function firstWorkingExerciseId(app: Express, user: TestUser, day = 1): Promise<string> {
  const res = await user.agent.get(`/api/exercises/${day}?week=1`).expect(200);
  const working = res.body.find((e: { segment: string }) => e.segment === "working");
  if (!working) throw new Error(`no working exercise seeded for day ${day}`);
  return working.id;
}

/**
 * A working exercise that actually carries external load.
 *
 * Some working-segment entries are timed holds or band work (Stomach Vacuum,
 * for one), and those correctly have no weight to recommend — picking one of
 * them would make a recommendation test assert the wrong thing.
 */
/** Bilateral only — unilateral work keeps separate history per side. */
const BILATERAL_LOADED_INPUT_TYPES = [
  "weight_reps",
  "weight_reps_db",
  "weight_reps_barbell",
  "bodyweight_reps_weighted",
];

const UNILATERAL_LOADED_INPUT_TYPES = ["weight_reps_unilateral", "weight_reps_unilateral_db"];

export async function firstLoadedExerciseId(app: Express, user: TestUser, day = 1): Promise<string> {
  const res = await user.agent.get(`/api/exercises/${day}?week=1`).expect(200);
  const loaded = res.body.find(
    (e: { segment: string; inputType: string }) =>
      e.segment === "working" && BILATERAL_LOADED_INPUT_TYPES.includes(e.inputType),
  );
  if (!loaded) throw new Error(`no bilateral loaded exercise seeded for day ${day}`);
  return loaded.id;
}

export async function firstUnilateralExerciseId(app: Express, user: TestUser, day = 1): Promise<string> {
  const res = await user.agent.get(`/api/exercises/${day}?week=1`).expect(200);
  const loaded = res.body.find(
    (e: { segment: string; inputType: string }) =>
      e.segment === "working" && UNILATERAL_LOADED_INPUT_TYPES.includes(e.inputType),
  );
  if (!loaded) throw new Error(`no unilateral exercise seeded for day ${day}`);
  return loaded.id;
}

/**
 * The day's primary lift, resolved the way the server does.
 *
 * RULES: vacuum_position — Stomach Vacuum is always row 1 of working sets and
 * is not counted as volume, so the primary is the first working exercise after
 * it by order. Tests that exercise the fatigue triggers must log against THIS
 * exercise, or `primary` comes back null and nothing fires.
 */
export async function primaryExerciseId(app: Express, user: TestUser, day = 1): Promise<string> {
  const res = await user.agent.get(`/api/exercises/${day}?week=1`).expect(200);
  const working = (res.body as Array<{ id: string; name: string; segment: string; order: number }>)
    .filter((e) => e.segment === "working" && !/stomach vacuum/i.test(e.name))
    .sort((a, b) => a.order - b.order);
  if (working.length === 0) throw new Error(`no working exercise for day ${day}`);
  return working[0].id;
}
