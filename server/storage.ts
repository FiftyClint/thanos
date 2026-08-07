import {
  type User, type InsertUser,
  type Exercise, type InsertExercise,
  type WorkoutLog, type InsertWorkoutLog,
  type SetLog, type InsertSetLog,
  type WeeklyCheckIn, type InsertWeeklyCheckIn,
  type ProgressPhoto, type InsertProgressPhoto,
  type Recommendation, type InsertRecommendation,
  type CardioSession, type InsertCardioSession,
  type VacuumSession, type InsertVacuumSession,
  users, exercises, workoutLogs, setLogs, weeklyCheckIns, progressPhotos, recommendations,
  cardioSessions, vacuumSessions,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, asc, inArray, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  countUsers(): Promise<number>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
  setUserActiveProgram(userId: string, program: string): Promise<void>;

  // Exercises
  getExercisesByDay(day: number, program: string): Promise<Exercise[]>;
  getAllExercises(program?: string): Promise<Exercise[]>;
  getAllExercisesByProgram(program: string): Promise<Exercise[]>;
  createExercise(exercise: InsertExercise): Promise<Exercise>;
  updateExerciseByKey(id: string, exercise: InsertExercise): Promise<Exercise>;
  deleteExercisesByIds(ids: string[]): Promise<void>;

  // Workout Logs
  getWorkoutLog(id: string): Promise<WorkoutLog | undefined>;
  getWorkoutLogsByUser(userId: string, week?: number): Promise<WorkoutLog[]>;
  getCurrentWorkoutLog(userId: string, day: number, week: number): Promise<WorkoutLog | undefined>;
  createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog>;
  updateWorkoutLog(id: string, updates: Partial<WorkoutLog>): Promise<WorkoutLog>;

  // Set Logs
  getSetLogsByWorkout(workoutLogId: string): Promise<SetLog[]>;
  getSetLogsByWorkouts(workoutLogIds: string[]): Promise<Map<string, SetLog[]>>;
  getPreviousSetLogs(userId: string, day: number): Promise<SetLog[]>;
  deleteSetLogsByWorkout(workoutLogId: string): Promise<void>;
  createSetLogs(logs: InsertSetLog[]): Promise<SetLog[]>;

  // Weekly Check-Ins
  getCheckInsByUser(userId: string): Promise<WeeklyCheckIn[]>;
  getLatestCheckIn(userId: string): Promise<WeeklyCheckIn | undefined>;
  getCheckInByWeek(userId: string, week: number): Promise<WeeklyCheckIn | undefined>;
  createCheckIn(checkIn: InsertWeeklyCheckIn): Promise<WeeklyCheckIn>;
  updateCheckIn(id: string, updates: Partial<WeeklyCheckIn>): Promise<WeeklyCheckIn>;

  // Progress Photos
  getPhotosByUser(userId: string): Promise<ProgressPhoto[]>;
  getPhotoByPath(userId: string, filePath: string): Promise<ProgressPhoto | undefined>;
  createPhoto(photo: InsertProgressPhoto): Promise<ProgressPhoto>;

  // Recommendations
  getRecommendationsByUser(userId: string, status?: string): Promise<Recommendation[]>;
  getRecommendation(id: string): Promise<Recommendation | undefined>;
  createRecommendation(rec: InsertRecommendation): Promise<Recommendation>;
  updateRecommendation(id: string, status: string): Promise<Recommendation>;

  // Cardio Sessions
  getCardioSessionsByUser(userId: string, week?: number, type?: string): Promise<CardioSession[]>;
  getCardioSession(id: string): Promise<CardioSession | undefined>;
  createCardioSession(session: InsertCardioSession): Promise<CardioSession>;
  deleteCardioSession(id: string): Promise<void>;

  // Vacuum Sessions
  getVacuumSessionsByUser(userId: string, week?: number, timeOfDay?: string): Promise<VacuumSession[]>;
  getVacuumSession(id: string): Promise<VacuumSession | undefined>;
  getVacuumSessionsBetween(userId: string, from: Date, to: Date): Promise<VacuumSession[]>;
  getVacuumSessionsByDate(userId: string, date: Date): Promise<VacuumSession[]>;
  createVacuumSession(session: InsertVacuumSession): Promise<VacuumSession>;
  deleteVacuumSession(id: string): Promise<void>;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export class DatabaseStorage implements IStorage {
  // ── Users ────────────────────────────────────────────────────────────────
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Emails are stored as entered but matched case-insensitively, so
    // "Clint@x.com" and "clint@x.com" are the same account at login.
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return user;
  }

  async countUsers(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return row?.count ?? 0;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return updated;
  }

  async setUserActiveProgram(userId: string, program: string): Promise<void> {
    await db.update(users).set({ activeProgram: program }).where(eq(users.id, userId));
  }

  // ── Exercises ────────────────────────────────────────────────────────────
  async getExercisesByDay(day: number, program: string): Promise<Exercise[]> {
    return db
      .select()
      .from(exercises)
      .where(and(eq(exercises.day, day), eq(exercises.program, program)))
      .orderBy(asc(exercises.order));
  }

  async getAllExercises(program?: string): Promise<Exercise[]> {
    const q = db.select().from(exercises);
    const rows = program ? q.where(eq(exercises.program, program)) : q;
    return rows.orderBy(asc(exercises.day), asc(exercises.order));
  }

  async getAllExercisesByProgram(program: string): Promise<Exercise[]> {
    return db
      .select()
      .from(exercises)
      .where(eq(exercises.program, program))
      .orderBy(asc(exercises.day), asc(exercises.order));
  }

  async createExercise(exercise: InsertExercise): Promise<Exercise> {
    const [created] = await db.insert(exercises).values(exercise).returning();
    return created;
  }

  /** Update every content field in place, keeping the row id so set_logs stay valid. */
  async updateExerciseByKey(id: string, exercise: InsertExercise): Promise<Exercise> {
    const [updated] = await db
      .update(exercises)
      .set({
        name: exercise.name,
        defaultSets: exercise.defaultSets,
        repRange: exercise.repRange,
        tempo: exercise.tempo,
        rir: exercise.rir,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes,
        alternate: exercise.alternate,
        videoUrl: exercise.videoUrl,
        inputType: exercise.inputType,
        isSupersetPart: exercise.isSupersetPart,
        supersetGroup: exercise.supersetGroup,
        segment: exercise.segment,
      })
      .where(eq(exercises.id, id))
      .returning();
    return updated;
  }

  async deleteExercisesByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    // set_logs reference exercises, so they must go first.
    await db.transaction(async (tx) => {
      await tx.delete(setLogs).where(inArray(setLogs.exerciseId, ids));
      await tx.delete(exercises).where(inArray(exercises.id, ids));
    });
  }

  // ── Workout Logs ─────────────────────────────────────────────────────────
  async getWorkoutLog(id: string): Promise<WorkoutLog | undefined> {
    const [log] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, id)).limit(1);
    return log;
  }

  async getWorkoutLogsByUser(userId: string, week?: number): Promise<WorkoutLog[]> {
    const where =
      week !== undefined
        ? and(eq(workoutLogs.userId, userId), eq(workoutLogs.week, week))
        : eq(workoutLogs.userId, userId);
    return db.select().from(workoutLogs).where(where).orderBy(desc(workoutLogs.date));
  }

  async getCurrentWorkoutLog(userId: string, day: number, week: number): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), eq(workoutLogs.day, day), eq(workoutLogs.week, week)))
      .limit(1);
    return log;
  }

  async createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog> {
    const [created] = await db.insert(workoutLogs).values(log).returning();
    return created;
  }

  async updateWorkoutLog(id: string, updates: Partial<WorkoutLog>): Promise<WorkoutLog> {
    const [updated] = await db.update(workoutLogs).set(updates).where(eq(workoutLogs.id, id)).returning();
    return updated;
  }

  // ── Set Logs ─────────────────────────────────────────────────────────────
  async getSetLogsByWorkout(workoutLogId: string): Promise<SetLog[]> {
    return db
      .select()
      .from(setLogs)
      .where(eq(setLogs.workoutLogId, workoutLogId))
      .orderBy(asc(setLogs.setNumber));
  }

  /**
   * Fetch sets for many workouts in one query.
   *
   * History and CSV export previously looped over every workout and issued a
   * query each, so a full season of training meant hundreds of round trips per
   * page load. One `IN (...)` covers all of them.
   */
  async getSetLogsByWorkouts(workoutLogIds: string[]): Promise<Map<string, SetLog[]>> {
    const grouped = new Map<string, SetLog[]>();
    if (workoutLogIds.length === 0) return grouped;

    const rows = await db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.workoutLogId, workoutLogIds))
      .orderBy(asc(setLogs.setNumber));

    for (const row of rows) {
      const list = grouped.get(row.workoutLogId);
      if (list) list.push(row);
      else grouped.set(row.workoutLogId, [row]);
    }
    return grouped;
  }

  async getPreviousSetLogs(userId: string, day: number): Promise<SetLog[]> {
    const [prevWorkout] = await db
      .select()
      .from(workoutLogs)
      .where(
        and(eq(workoutLogs.userId, userId), eq(workoutLogs.day, day), eq(workoutLogs.completed, true)),
      )
      .orderBy(desc(workoutLogs.date))
      .limit(1);

    if (!prevWorkout) return [];
    return this.getSetLogsByWorkout(prevWorkout.id);
  }

  async deleteSetLogsByWorkout(workoutLogId: string): Promise<void> {
    await db.delete(setLogs).where(eq(setLogs.workoutLogId, workoutLogId));
  }

  async createSetLogs(logs: InsertSetLog[]): Promise<SetLog[]> {
    if (logs.length === 0) return [];
    return db.insert(setLogs).values(logs).returning();
  }

  // ── Weekly Check-Ins ─────────────────────────────────────────────────────
  async getCheckInsByUser(userId: string): Promise<WeeklyCheckIn[]> {
    return db
      .select()
      .from(weeklyCheckIns)
      .where(eq(weeklyCheckIns.userId, userId))
      .orderBy(desc(weeklyCheckIns.week));
  }

  async getLatestCheckIn(userId: string): Promise<WeeklyCheckIn | undefined> {
    const [checkIn] = await db
      .select()
      .from(weeklyCheckIns)
      .where(eq(weeklyCheckIns.userId, userId))
      .orderBy(desc(weeklyCheckIns.week))
      .limit(1);
    return checkIn;
  }

  async getCheckInByWeek(userId: string, week: number): Promise<WeeklyCheckIn | undefined> {
    const [checkIn] = await db
      .select()
      .from(weeklyCheckIns)
      .where(and(eq(weeklyCheckIns.userId, userId), eq(weeklyCheckIns.week, week)))
      .limit(1);
    return checkIn;
  }

  async createCheckIn(checkIn: InsertWeeklyCheckIn): Promise<WeeklyCheckIn> {
    const [created] = await db.insert(weeklyCheckIns).values(checkIn).returning();
    return created;
  }

  async updateCheckIn(id: string, updates: Partial<WeeklyCheckIn>): Promise<WeeklyCheckIn> {
    const [updated] = await db
      .update(weeklyCheckIns)
      .set(updates)
      .where(eq(weeklyCheckIns.id, id))
      .returning();
    return updated;
  }

  // ── Progress Photos ──────────────────────────────────────────────────────
  async getPhotosByUser(userId: string): Promise<ProgressPhoto[]> {
    return db
      .select()
      .from(progressPhotos)
      .where(eq(progressPhotos.userId, userId))
      .orderBy(desc(progressPhotos.week));
  }

  async getPhotoByPath(userId: string, filePath: string): Promise<ProgressPhoto | undefined> {
    const [photo] = await db
      .select()
      .from(progressPhotos)
      .where(and(eq(progressPhotos.userId, userId), eq(progressPhotos.filePath, filePath)))
      .limit(1);
    return photo;
  }

  async createPhoto(photo: InsertProgressPhoto): Promise<ProgressPhoto> {
    const [created] = await db.insert(progressPhotos).values(photo).returning();
    return created;
  }

  // ── Recommendations ──────────────────────────────────────────────────────
  async getRecommendationsByUser(userId: string, status?: string): Promise<Recommendation[]> {
    const where = status
      ? and(eq(recommendations.userId, userId), eq(recommendations.status, status))
      : eq(recommendations.userId, userId);
    return db.select().from(recommendations).where(where).orderBy(desc(recommendations.createdAt));
  }

  async getRecommendation(id: string): Promise<Recommendation | undefined> {
    const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id)).limit(1);
    return rec;
  }

  async createRecommendation(rec: InsertRecommendation): Promise<Recommendation> {
    const [created] = await db.insert(recommendations).values(rec).returning();
    return created;
  }

  async updateRecommendation(id: string, status: string): Promise<Recommendation> {
    const [updated] = await db
      .update(recommendations)
      .set({ status })
      .where(eq(recommendations.id, id))
      .returning();
    return updated;
  }

  // ── Cardio Sessions ──────────────────────────────────────────────────────
  async getCardioSessionsByUser(userId: string, week?: number, type?: string): Promise<CardioSession[]> {
    const conditions = [eq(cardioSessions.userId, userId)];
    if (week !== undefined) conditions.push(eq(cardioSessions.week, week));
    if (type) conditions.push(eq(cardioSessions.type, type));
    return db.select().from(cardioSessions).where(and(...conditions)).orderBy(desc(cardioSessions.date));
  }

  async getCardioSession(id: string): Promise<CardioSession | undefined> {
    const [session] = await db.select().from(cardioSessions).where(eq(cardioSessions.id, id)).limit(1);
    return session;
  }

  async createCardioSession(session: InsertCardioSession): Promise<CardioSession> {
    const [created] = await db.insert(cardioSessions).values(session).returning();
    return created;
  }

  async deleteCardioSession(id: string): Promise<void> {
    await db.delete(cardioSessions).where(eq(cardioSessions.id, id));
  }

  // ── Vacuum Sessions ──────────────────────────────────────────────────────
  async getVacuumSessionsByUser(userId: string, week?: number, timeOfDay?: string): Promise<VacuumSession[]> {
    const conditions = [eq(vacuumSessions.userId, userId)];
    if (week !== undefined) conditions.push(eq(vacuumSessions.week, week));
    if (timeOfDay) conditions.push(eq(vacuumSessions.timeOfDay, timeOfDay));
    return db.select().from(vacuumSessions).where(and(...conditions)).orderBy(desc(vacuumSessions.date));
  }

  async getVacuumSession(id: string): Promise<VacuumSession | undefined> {
    const [session] = await db.select().from(vacuumSessions).where(eq(vacuumSessions.id, id)).limit(1);
    return session;
  }

  /**
   * Sessions in a date window, filtered by the database.
   *
   * The streak calculation used to call a per-day helper in an unbounded loop,
   * and that helper loaded the user's entire vacuum history each time and
   * filtered it in JS. One range query replaces all of it.
   */
  async getVacuumSessionsBetween(userId: string, from: Date, to: Date): Promise<VacuumSession[]> {
    return db
      .select()
      .from(vacuumSessions)
      .where(
        and(
          eq(vacuumSessions.userId, userId),
          gte(vacuumSessions.date, from),
          lte(vacuumSessions.date, to),
        ),
      )
      .orderBy(desc(vacuumSessions.date));
  }

  async getVacuumSessionsByDate(userId: string, date: Date): Promise<VacuumSession[]> {
    return this.getVacuumSessionsBetween(userId, startOfDay(date), endOfDay(date));
  }

  async createVacuumSession(session: InsertVacuumSession): Promise<VacuumSession> {
    const [created] = await db.insert(vacuumSessions).values(session).returning();
    return created;
  }

  async deleteVacuumSession(id: string): Promise<void> {
    await db.delete(vacuumSessions).where(eq(vacuumSessions.id, id));
  }
}

export const storage = new DatabaseStorage();
