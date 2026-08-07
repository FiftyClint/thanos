import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildApp, finalizeApp } from "../server/app";
import { syncAllPrograms } from "../server/seed";
import { runMigrations } from "../server/migrate";
import { closeDb } from "../server/db";
import {
  hasTestDatabase,
  resetDatabase,
  createUser,
  firstWorkingExerciseId,
  firstLoadedExerciseId,
  firstUnilateralExerciseId,
  type TestUser,
} from "./helpers/db";

const suite = hasTestDatabase ? describe : describe.skip;

suite("API", () => {
  let app: Express;

  beforeAll(async () => {
    await runMigrations();
    await syncAllPrograms();
    app = buildApp();
    finalizeApp(app);
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe("health", () => {
    it("reports ok without a session", async () => {
      const res = await request(app).get("/api/health").expect(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("auth", () => {
    it("registers, then recognises the session", async () => {
      const user = await createUser(app);
      const res = await user.agent.get("/api/user").expect(200);
      expect(res.body.id).toBe(user.id);
    });

    it("never returns the password hash", async () => {
      const user = await createUser(app);
      const res = await user.agent.get("/api/user").expect(200);
      expect(res.body).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(res.body)).not.toContain("$2");
    });

    it("rejects a password under eight characters", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "Short", email: "short@example.com", password: "abc123" })
        .expect(400);
    });

    it("refuses a duplicate email regardless of case", async () => {
      await createUser(app, { email: "Dup@Example.com" });
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Copy", email: "dup@example.com", password: "correct horse battery" });
      expect(res.status).toBe(400);
    });

    it("logs in case-insensitively", async () => {
      await createUser(app, { email: "Mixed@Case.com", password: "correct horse battery" });
      await request(app)
        .post("/api/auth/login")
        .send({ email: "mixed@case.com", password: "correct horse battery" })
        .expect(200);
    });

    it("rejects a wrong password", async () => {
      const { email } = await createUser(app);
      await request(app).post("/api/auth/login").send({ email, password: "wrong password" }).expect(401);
    });

    it("gives 401 on protected routes without a session", async () => {
      for (const path of ["/api/exercises/1", "/api/workouts", "/api/checkins", "/api/cardio", "/api/photos", "/api/export/workouts"]) {
        await request(app).get(path).expect(401);
      }
    });

    it("ends the session on logout", async () => {
      const user = await createUser(app);
      await user.agent.post("/api/auth/logout").expect(200);
      await user.agent.get("/api/user").expect(401);
    });

    it("changes a password only with the current one", async () => {
      const user = await createUser(app, { password: "correct horse battery" });
      await user.agent
        .put("/api/user/password")
        .send({ currentPassword: "wrong", newPassword: "a new long password" })
        .expect(401);
      await user.agent
        .put("/api/user/password")
        .send({ currentPassword: "correct horse battery", newPassword: "a new long password" })
        .expect(200);
    });
  });

  describe("exercises", () => {
    it("returns a day's exercises in order", async () => {
      const user = await createUser(app);
      const res = await user.agent.get("/api/exercises/1?week=1").expect(200);
      expect(res.body.length).toBeGreaterThan(0);

      const orders = res.body.map((e: { order: number }) => e.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it("rejects a day outside 1-6", async () => {
      const user = await createUser(app);
      await user.agent.get("/api/exercises/0").expect(400);
      await user.agent.get("/api/exercises/7").expect(400);
      await user.agent.get("/api/exercises/abc").expect(400);
    });

    it("follows the user's active program", async () => {
      const user = await createUser(app);
      await user.agent.put("/api/user/program").send({ program: "phase1" }).expect(200);

      const res = await user.agent.get("/api/exercises/1?week=1").expect(200);
      expect(res.body.every((e: { program: string }) => e.program === "phase1")).toBe(true);
    });

    it("rejects an unknown program", async () => {
      const user = await createUser(app);
      await user.agent.put("/api/user/program").send({ program: "phase9" }).expect(400);
    });
  });

  describe("workouts", () => {
    it("saves a session and its sets", async () => {
      const user = await createUser(app);
      const exerciseId = await firstWorkingExerciseId(app, user);

      const res = await user.agent
        .post("/api/workouts/complete")
        .send({
          day: 1,
          week: 1,
          duration: 61,
          sets: [
            { exerciseId, setNumber: 1, weightLbs: 135, reps: 10, rirActual: 2 },
            { exerciseId, setNumber: 2, weightLbs: 135, reps: 9, rirActual: 1 },
          ],
        })
        .expect(200);

      expect(res.body.completed).toBe(true);
      expect(res.body.phase).toBe("Base");

      const history = await user.agent.get("/api/workouts/history").expect(200);
      expect(history.body[0].sets).toHaveLength(2);
    });

    it("replaces sets when the same session is submitted twice", async () => {
      const user = await createUser(app);
      const exerciseId = await firstWorkingExerciseId(app, user);
      const body = {
        day: 1,
        week: 1,
        sets: [{ exerciseId, setNumber: 1, weightLbs: 135, reps: 10 }],
      };

      await user.agent.post("/api/workouts/complete").send(body).expect(200);
      await user.agent.post("/api/workouts/complete").send(body).expect(200);

      const history = await user.agent.get("/api/workouts/history").expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].sets).toHaveLength(1);
    });

    it("drops sets that name an exercise from another day", async () => {
      const user = await createUser(app);
      const day2Exercise = await firstWorkingExerciseId(app, user, 2);

      await user.agent
        .post("/api/workouts/complete")
        .send({ day: 1, week: 1, sets: [{ exerciseId: day2Exercise, setNumber: 1, weightLbs: 999, reps: 1 }] })
        .expect(200);

      const history = await user.agent.get("/api/workouts/history").expect(200);
      expect(history.body[0].sets).toHaveLength(0);
    });

    it("rejects a nonsense week", async () => {
      const user = await createUser(app);
      await user.agent.post("/api/workouts/complete").send({ day: 1, week: 0 }).expect(400);
      await user.agent.post("/api/workouts/complete").send({ day: 1, week: 999 }).expect(400);
    });

    it("accepts a prep longer than 36 weeks", async () => {
      // The cap used to be 36 — one prep's length used as a data constraint.
      // A prep running past it started failing every save with a bare 400.
      const user = await createUser(app);
      const exerciseId = await firstWorkingExerciseId(app, user);

      await user.agent
        .post("/api/workouts/complete")
        .send({ day: 1, week: 41, sets: [{ exerciseId, setNumber: 1, weightLbs: 100, reps: 8 }] })
        .expect(200);

      const history = await user.agent.get("/api/workouts/history").expect(200);
      expect(history.body[0].week).toBe(41);
    });

    it("keeps one athlete's workouts out of another's history", async () => {
      const a = await createUser(app);
      const b = await createUser(app);
      const exerciseId = await firstWorkingExerciseId(app, a);

      await a.agent
        .post("/api/workouts/complete")
        .send({ day: 1, week: 1, sets: [{ exerciseId, setNumber: 1, weightLbs: 100, reps: 10 }] })
        .expect(200);

      expect((await b.agent.get("/api/workouts/history").expect(200)).body).toHaveLength(0);
    });
  });

  describe("weight recommendations", () => {
    it("suggests last session's weight the next time round", async () => {
      const user = await createUser(app);
      const exerciseId = await firstLoadedExerciseId(app, user);

      await user.agent
        .post("/api/workouts/complete")
        .send({
          day: 1,
          week: 1,
          sets: [{ exerciseId, setNumber: 1, weightLbs: 145, reps: 8, rirActual: 2 }],
        })
        .expect(200);

      const res = await user.agent.get("/api/sets/recommendations/1?week=2").expect(200);
      const forExercise = res.body[exerciseId];
      expect(forExercise[0].weight).toBe(145);
      expect(forExercise[0].source).toBe("last_session");
    });

    it("keeps left and right history separate for unilateral work", async () => {
      const user = await createUser(app);
      const exerciseId = await firstUnilateralExerciseId(app, user);

      await user.agent
        .post("/api/workouts/complete")
        .send({
          day: 1,
          week: 1,
          sets: [
            { exerciseId, setNumber: 1, side: "left", weightLbs: 30, reps: 12, rirActual: 2 },
            { exerciseId, setNumber: 1, side: "right", weightLbs: 35, reps: 12, rirActual: 2 },
          ],
        })
        .expect(200);

      const res = await user.agent.get("/api/sets/recommendations/1?week=2").expect(200);
      const sides = res.body[exerciseId] as Array<{ side: string; weight: number }>;
      expect(sides.find((s) => s.side === "left")?.weight).toBe(30);
      expect(sides.find((s) => s.side === "right")?.weight).toBe(35);
    });

    it("reports no history for a first session", async () => {
      const user = await createUser(app);
      const exerciseId = await firstLoadedExerciseId(app, user);
      const res = await user.agent.get("/api/sets/recommendations/1?week=1").expect(200);
      expect(res.body[exerciseId][0].source).toBe("no_history");
    });

    it("holds weight on a deload week", async () => {
      const user = await createUser(app);
      const exerciseId = await firstLoadedExerciseId(app, user);

      await user.agent
        .post("/api/workouts/complete")
        .send({ day: 1, week: 3, sets: [{ exerciseId, setNumber: 1, weightLbs: 150, reps: 10, rirActual: 2 }] })
        .expect(200);

      const res = await user.agent.get("/api/sets/recommendations/1?week=4").expect(200);
      expect(res.body[exerciseId][0].source).toBe("deload");
      expect(res.body[exerciseId][0].weight).toBe(150);
    });
  });

  describe("check-ins", () => {
    it("saves a check-in and returns it as the latest", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/checkins")
        .send({ week: 1, date: "2026-01-05", phase: "Base", weightLbs: 205.4, waistRelaxed: 33 })
        .expect(201);

      const latest = await user.agent.get("/api/checkins/latest").expect(200);
      expect(latest.body.weightLbs).toBeCloseTo(205.4, 1);
    });

    it("corrects the existing check-in when a week is submitted twice", async () => {
      const user = await createUser(app);
      const body = { week: 2, date: "2026-01-12", phase: "Base", weightLbs: 200 };

      await user.agent.post("/api/checkins").send(body).expect(201);
      await user.agent.post("/api/checkins").send({ ...body, weightLbs: 201 }).expect(200);

      const all = await user.agent.get("/api/checkins").expect(200);
      expect(all.body).toHaveLength(1);
      expect(all.body[0].weightLbs).toBeCloseTo(201, 1);
    });

    it("rejects a rating outside 1-10", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/checkins")
        .send({ week: 1, date: "2026-01-05", phase: "Base", sleepQuality: 42 })
        .expect(400);
    });

    it("rejects an unparseable date", async () => {
      const user = await createUser(app);
      await user.agent.post("/api/checkins").send({ week: 1, date: "whenever", phase: "Base" }).expect(400);
    });
  });

  describe("cardio and vacuum", () => {
    it("saves a cardio session", async () => {
      const user = await createUser(app);
      const res = await user.agent
        .post("/api/cardio")
        .send({ date: "2026-01-05", week: 1, type: "LISS", subtype: "Ruck", durationMin: 45 })
        .expect(201);
      expect(res.body.subtype).toBe("Ruck");
    });

    it("clears the subtype on HIIT, where it means nothing", async () => {
      const user = await createUser(app);
      const res = await user.agent
        .post("/api/cardio")
        .send({ date: "2026-01-05", week: 1, type: "HIIT", subtype: "Ruck", durationMin: 20 })
        .expect(201);
      expect(res.body.subtype).toBeNull();
    });

    it("rejects a body with no duration instead of writing a broken row", async () => {
      const user = await createUser(app);
      await user.agent.post("/api/cardio").send({ date: "2026-01-05", week: 1, type: "LISS" }).expect(400);
      await user.agent.post("/api/cardio").send({ type: "NONSENSE" }).expect(400);
    });

    it("refuses to delete another athlete's session", async () => {
      const a = await createUser(app);
      const b = await createUser(app);

      const created = await a.agent
        .post("/api/cardio")
        .send({ date: "2026-01-05", week: 1, type: "HIIT", durationMin: 20 })
        .expect(201);

      await b.agent.delete(`/api/cardio/${created.body.id}`).expect(404);
      expect((await a.agent.get("/api/cardio").expect(200)).body).toHaveLength(1);
    });

    it("counts a vacuum streak from today backwards", async () => {
      const user = await createUser(app);
      const today = new Date().toISOString();
      await user.agent
        .post("/api/vacuum")
        .send({ date: today, week: 1, timeOfDay: "Morning", sets: 3, durationSec: 40 })
        .expect(201);

      const stats = await user.agent.get("/api/stats/vacuum").expect(200);
      expect(stats.body.todayCompleted).toBe(true);
      expect(stats.body.streak).toBe(1);
      expect(stats.body.todayTotalSets).toBe(3);
    });

    it("reports a zero streak with no sessions", async () => {
      const user = await createUser(app);
      const stats = await user.agent.get("/api/stats/vacuum").expect(200);
      expect(stats.body.streak).toBe(0);
      expect(stats.body.todayCompleted).toBe(false);
    });
  });

  describe("exports", () => {
    it("quotes fields containing commas so columns stay aligned", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/cardio")
        .send({ date: "2026-01-05", week: 1, type: "LISS", durationMin: 45, notes: 'Hills, wind, and "rain"' })
        .expect(201);

      const res = await user.agent.get("/api/export/cardio").expect(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toContain('"Hills, wind, and ""rain"""');

      const dataLine = res.text.trim().split("\r\n")[1];
      const headerCols = res.text.trim().split("\r\n")[0].split(",").length;
      expect(dataLine.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(headerCols);
    });

    it("exports the program as a workbook", async () => {
      const user = await createUser(app);
      const res = await user.agent
        .get("/api/export/program?program=phase3")
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers["content-type"]).toContain("spreadsheetml");
      const workbook = res.body as Buffer;
      expect(workbook.length).toBeGreaterThan(1000);
      // A .xlsx is a zip archive; check the magic bytes rather than just a size.
      expect(workbook.subarray(0, 2).toString()).toBe("PK");
    });
  });

  describe("uploads", () => {
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    async function upload(user: TestUser) {
      const ticket = await user.agent
        .post("/api/uploads/request-url")
        .send({ name: "front.png", size: onePixelPng.length, contentType: "image/png" })
        .expect(200);

      await user.agent
        .put(ticket.body.uploadURL.replace(/^\/api/, "/api"))
        .set("Content-Type", "image/png")
        .send(onePixelPng)
        .expect(200);

      return ticket.body.objectPath as string;
    }

    it("round-trips a photo byte-for-byte", async () => {
      const user = await createUser(app);
      const objectPath = await upload(user);

      const res = await user.agent.get(objectPath).expect(200);
      expect(Buffer.from(res.body)).toEqual(onePixelPng);
    });

    it("refuses a non-image", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/uploads/request-url")
        .send({ name: "payload.exe", size: 10, contentType: "application/x-msdownload" })
        .expect(400);
    });

    it("refuses a file over the size limit", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/uploads/request-url")
        .send({ name: "huge.png", size: 999_999_999, contentType: "image/png" })
        .expect(400);
    });

    it("keeps a photo private to its owner", async () => {
      const owner = await createUser(app);
      const other = await createUser(app);
      const objectPath = await upload(owner);

      await other.agent.get(objectPath).expect(403);
      await request(app).get(objectPath).expect(401);
    });

    it("will not attach another athlete's photo to a check-in", async () => {
      const owner = await createUser(app);
      const other = await createUser(app);
      const objectPath = await upload(owner);

      await other.agent
        .post("/api/checkins")
        .send({
          week: 1,
          date: "2026-01-05",
          phase: "Base",
          photos: [{ poseType: "front", objectPath }],
        })
        .expect(400);
    });

    it("attaches the owner's own photo to their check-in", async () => {
      const user = await createUser(app);
      const objectPath = await upload(user);

      await user.agent
        .post("/api/checkins")
        .send({ week: 1, date: "2026-01-05", phase: "Base", photos: [{ poseType: "front", objectPath }] })
        .expect(201);

      const photos = await user.agent.get("/api/photos").expect(200);
      expect(photos.body).toHaveLength(1);
      expect(photos.body[0].filePath).toBe(objectPath);
    });
  });

  describe("hardening", () => {
    it("refuses a cross-origin write", async () => {
      const user = await createUser(app);
      await user.agent
        .post("/api/cardio")
        .set("Origin", "https://evil.example.com")
        .send({ date: "2026-01-05", week: 1, type: "HIIT", durationMin: 20 })
        .expect(403);
    });

    it("sets security headers", async () => {
      const res = await request(app).get("/api/health").expect(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBeTruthy();
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("answers unknown API paths as JSON, not HTML", async () => {
      const res = await request(app).get("/api/does-not-exist").expect(404);
      expect(res.headers["content-type"]).toContain("application/json");
    });
  });
});
