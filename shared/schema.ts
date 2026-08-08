import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { JOINT_STATUSES, WARMUP_FEELS, PUMP_QUALITIES } from "./program-rules";

export const PROGRAMS = ["phase1", "phase2", "phase3"] as const;
export const SEGMENTS = ["warmup", "working", "finisher", "cooldown"] as const;
export const CARDIO_TYPES = ["HIIT", "LISS"] as const;
export const CARDIO_SUBTYPES = ["Walking", "Incline Treadmill", "Ruck"] as const;
export const TIMES_OF_DAY = ["Morning", "Afternoon", "Evening"] as const;
export const SIDES = ["left", "right"] as const;
/**
 * Upper bound for a week number, as INPUT VALIDATION — not a program length.
 *
 * This was 36, taken from the length of one prep, which made it a time bomb:
 * a prep running longer than 36 weeks would start failing every workout save
 * once it passed that week, with a 400 and no explanation. A prep is as long
 * as it is; this only needs to reject nonsense.
 */
export const MAX_WEEK = 104;
export const TRAINING_DAYS = 6;

// ── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("athlete"), // "athlete" | "partner"
    activeProgram: text("active_program").notNull().default("phase3"),
    age: integer("age"),
    heightInches: integer("height_inches"),
    showDate: timestamp("show_date"),
    prepStartDate: timestamp("prep_start_date"),
    competitionName: text("competition_name"),
    division: text("division"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Case-insensitive uniqueness: Clint@x.com and clint@x.com are one account.
    emailLowerIdx: uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`),
  }),
);

// ── Exercises (seeded program content) ──────────────────────────────────────
export const exercises = pgTable(
  "exercises",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    day: integer("day").notNull(), // 1-6
    order: integer("order").notNull(),
    number: text("number").notNull(), // "1", "2a", "2b", "W1", "C3"...
    name: text("name").notNull(),
    defaultSets: integer("default_sets").notNull(),
    repRange: text("rep_range").notNull(),
    tempo: text("tempo").notNull(),
    rir: text("rir").notNull(),
    restSeconds: text("rest_seconds").notNull(),
    notes: text("notes").default(""),
    alternate: text("alternate").default(""),
    videoUrl: text("video_url").default(""),
    inputType: text("input_type").notNull().default("weight_reps"),
    isSupersetPart: boolean("is_superset_part").default(false),
    supersetGroup: text("superset_group"),
    segment: text("segment").notNull().default("working"),
    program: text("program").notNull().default("phase1"),
  },
  (table) => ({
    // The identity the seeder syncs on, and the lookup every workout page does.
    programDayOrderIdx: uniqueIndex("exercises_program_day_order_number_idx").on(
      table.program,
      table.day,
      table.order,
      table.number,
    ),
    nameIdx: index("exercises_name_idx").on(table.name),
  }),
);

// ── Workout logs (one per training session) ─────────────────────────────────
export const workoutLogs = pgTable(
  "workout_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    date: timestamp("date").notNull(),
    week: integer("week").notNull(),
    phase: text("phase").notNull(),
    program: text("program").notNull().default("phase3"),
    duration: integer("duration"), // minutes
    notes: text("notes").default(""),
    completed: boolean("completed").default(false),

    /*
     * Fatigue inputs, per RULES: STANDING | tracked_inputs — "Every session:
     * load x reps on the day's primary | actual RIR on its last set | AM fasted
     * weight | joint status (clean/achy/painful)".
     *
     * Load, reps and RIR come from set_logs. These four are what the deload
     * triggers need and the app had no way to record, which is why the deload
     * was a calendar instead.
     */
    jointStatus: text("joint_status"), // "clean" | "achy" | "painful"
    jointAreas: text("joint_areas").array().default([]),
    warmupFeel: text("warmup_feel"), // "normal" | "heavy"
    pumpQuality: text("pump_quality"), // "good" | "normal" | "absent"
    sessionDread: boolean("session_dread"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // At most one log per user/day/week — enforced here rather than only in code,
    // so a double submit from a flaky gym connection cannot create a duplicate.
    userDayWeekIdx: uniqueIndex("workout_logs_user_day_week_idx").on(table.userId, table.day, table.week),
    userDateIdx: index("workout_logs_user_date_idx").on(table.userId, table.date),
  }),
);

// ── Set logs ────────────────────────────────────────────────────────────────
export const setLogs = pgTable(
  "set_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    workoutLogId: varchar("workout_log_id", { length: 36 })
      .notNull()
      .references(() => workoutLogs.id, { onDelete: "cascade" }),
    exerciseId: varchar("exercise_id", { length: 36 })
      .notNull()
      .references(() => exercises.id),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    weightLbs: real("weight_lbs"),
    reps: integer("reps"),
    side: text("side"), // "left" | "right" | null
    durationSecs: integer("duration_secs"),
    rirActual: integer("rir_actual"),
    isFailure: boolean("is_failure").default(false),
    bandNote: text("band_note"),
    cardioNotes: text("cardio_notes"),
    recommendedWeight: real("recommended_weight"),
    userOverride: boolean("user_override").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workoutIdx: index("set_logs_workout_idx").on(table.workoutLogId),
    // Drives the autofill lookup: "what did I do on this exercise last time?"
    userExerciseIdx: index("set_logs_user_exercise_idx").on(table.userId, table.exerciseId),
  }),
);

// ── Weekly check-ins ────────────────────────────────────────────────────────
export const weeklyCheckIns = pgTable(
  "weekly_check_ins",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    date: timestamp("date").notNull(),
    phase: text("phase").notNull(),
    weightLbs: real("weight_lbs"),
    waistRelaxed: real("waist_relaxed"),
    waistVacuum: real("waist_vacuum"),
    chest: real("chest"),
    armsLeft: real("arms_left"),
    armsRight: real("arms_right"),
    shoulders: real("shoulders"),
    thighsLeft: real("thighs_left"),
    thighsRight: real("thighs_right"),
    calvesLeft: real("calves_left"),
    calvesRight: real("calves_right"),
    shoulderToWaist: real("shoulder_to_waist"),
    sleepQuality: integer("sleep_quality"),
    energyLevels: integer("energy_levels"),
    trainingMotivation: integer("training_motivation"),
    hungerAppetite: integer("hunger_appetite"),
    mood: integer("mood"),
    notes: text("notes").default(""),
    triggersJson: text("triggers_json").default("[]"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // One check-in per week; a re-submit updates rather than duplicating.
    userWeekIdx: uniqueIndex("weekly_check_ins_user_week_idx").on(table.userId, table.week),
  }),
);

// ── Progress photos ─────────────────────────────────────────────────────────
export const progressPhotos = pgTable(
  "progress_photos",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    checkInId: varchar("check_in_id", { length: 36 }).references(() => weeklyCheckIns.id, {
      onDelete: "set null",
    }),
    filePath: text("file_path").notNull(),
    poseType: text("pose_type").notNull(),
    week: integer("week").notNull(),
    date: timestamp("date").defaultNow().notNull(),
  },
  (table) => ({
    userWeekIdx: index("progress_photos_user_week_idx").on(table.userId, table.week),
  }),
);

// ── Recommendations ─────────────────────────────────────────────────────────
export const recommendations = pgTable(
  "recommendations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: varchar("exercise_id", { length: 36 }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    details: text("details").default(""),
    week: integer("week").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("recommendations_user_status_idx").on(table.userId, table.status),
    userExerciseIdx: index("recommendations_user_exercise_idx").on(table.userId, table.exerciseId),
  }),
);

// ── Cardio sessions ─────────────────────────────────────────────────────────
export const cardioSessions = pgTable(
  "cardio_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    week: integer("week").notNull(),
    type: text("type").notNull(),
    subtype: text("subtype"),
    durationMin: integer("duration_min").notNull(),
    notes: text("notes").default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userDateIdx: index("cardio_sessions_user_date_idx").on(table.userId, table.date),
    userWeekIdx: index("cardio_sessions_user_week_idx").on(table.userId, table.week),
  }),
);

// ── Vacuum sessions ─────────────────────────────────────────────────────────
export const vacuumSessions = pgTable(
  "vacuum_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    week: integer("week").notNull(),
    timeOfDay: text("time_of_day").notNull(),
    sets: integer("sets").notNull(),
    durationSec: integer("duration_sec").notNull(),
    notes: text("notes").default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // The streak query scans by user and date; without this it is a seq scan.
    userDateIdx: index("vacuum_sessions_user_date_idx").on(table.userId, table.date),
  }),
);

// ── Deload events ───────────────────────────────────────────────────────────
/**
 * A deload the athlete was recommended, and what they decided.
 *
 * Deloads are fatigue-triggered (RULES: DELOAD_T1 / DELOAD_T2), so they are
 * events with a start and an end — not a property of the calendar. Recording
 * the decision is what makes "Tier 1 failed" and the RETURN protocol
 * evaluable at all.
 */
export const deloadEvents = pgTable(
  "deload_events",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: integer("tier").notNull(), // 1 = trim sets, 2 = full deload
    status: text("status").notNull().default("recommended"),
    /** Which muscle or lift a Tier 1 trim applies to. */
    subject: text("subject"),
    /** The triggers that fired, with their evidence, as recorded at the time. */
    triggers: jsonb("triggers").default([]),
    week: integer("week").notNull(),
    recommendedAt: timestamp("recommended_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    notes: text("notes").default(""),
  },
  (table) => ({
    userStatusIdx: index("deload_events_user_status_idx").on(table.userId, table.status),
  }),
);

// ── Session store (connect-pg-simple) ───────────────────────────────────────
export const sessions = pgTable(
  "session",
  {
    sid: varchar("sid", { length: 255 }).primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => ({
    expireIdx: index("session_expire_idx").on(table.expire),
  }),
);

// ── Insert schemas & row types ──────────────────────────────────────────────
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertExerciseSchema = createInsertSchema(exercises).omit({ id: true });
export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({ id: true, createdAt: true });
export const insertSetLogSchema = createInsertSchema(setLogs).omit({ id: true, createdAt: true });
export const insertWeeklyCheckInSchema = createInsertSchema(weeklyCheckIns).omit({ id: true, createdAt: true });
export const insertProgressPhotoSchema = createInsertSchema(progressPhotos).omit({ id: true, date: true });
export const insertRecommendationSchema = createInsertSchema(recommendations).omit({ id: true, createdAt: true });
export const insertCardioSessionSchema = createInsertSchema(cardioSessions).omit({ id: true, createdAt: true });
export const insertDeloadEventSchema = createInsertSchema(deloadEvents).omit({ id: true, recommendedAt: true });
export const insertVacuumSessionSchema = createInsertSchema(vacuumSessions).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type Exercise = typeof exercises.$inferSelect;
export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type InsertSetLog = z.infer<typeof insertSetLogSchema>;
export type SetLog = typeof setLogs.$inferSelect;
export type InsertWeeklyCheckIn = z.infer<typeof insertWeeklyCheckInSchema>;
export type WeeklyCheckIn = typeof weeklyCheckIns.$inferSelect;
export type InsertProgressPhoto = z.infer<typeof insertProgressPhotoSchema>;
export type ProgressPhoto = typeof progressPhotos.$inferSelect;
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type InsertCardioSession = z.infer<typeof insertCardioSessionSchema>;
export type CardioSession = typeof cardioSessions.$inferSelect;
export type InsertVacuumSession = z.infer<typeof insertVacuumSessionSchema>;
export type VacuumSession = typeof vacuumSessions.$inferSelect;
export type InsertDeloadEvent = z.infer<typeof insertDeloadEventSchema>;
export type DeloadEvent = typeof deloadEvents.$inferSelect;

/** The user object the API returns — never includes the password hash. */
export type PublicUser = Omit<User, "passwordHash">;

// ── Request validation ──────────────────────────────────────────────────────
const week = z.coerce.number().int().min(1).max(MAX_WEEK);
const trainingDay = z.coerce.number().int().min(1).max(TRAINING_DAYS);
/** An ISO date string or anything `new Date()` accepts, rejected if unparseable. */
const dateString = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date");

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1, "Password is required").max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const programSchema = z.object({ program: z.enum(PROGRAMS) });

export const workoutCompleteSchema = z.object({
  day: trainingDay,
  week,
  phase: z.string().max(60).optional(),
  program: z.enum(PROGRAMS).optional(),
  duration: z.number().int().min(0).max(600).optional(),
  notes: z.string().max(5000).optional(),

  // Fatigue inputs. All optional: a session logged without them still saves,
  // and the assessment reports which triggers it therefore could not evaluate.
  jointStatus: z.enum(JOINT_STATUSES).nullable().optional(),
  jointAreas: z.array(z.string().max(40)).max(12).optional(),
  warmupFeel: z.enum(WARMUP_FEELS).nullable().optional(),
  pumpQuality: z.enum(PUMP_QUALITIES).nullable().optional(),
  sessionDread: z.boolean().nullable().optional(),

  sets: z
    .array(
      z.object({
        exerciseId: z.string().uuid(),
        setNumber: z.number().int().min(1).max(50),
        weightLbs: z.number().min(0).max(2000).nullable().optional(),
        reps: z.number().int().min(0).max(500).nullable().optional(),
        side: z.enum(SIDES).nullable().optional(),
        durationSecs: z.number().int().min(0).max(36_000).nullable().optional(),
        rirActual: z.number().int().min(0).max(10).nullable().optional(),
        isFailure: z.boolean().optional(),
        bandNote: z.string().max(500).nullable().optional(),
        cardioNotes: z.string().max(500).nullable().optional(),
      }),
    )
    .max(500)
    .optional(),
});

const measurement = z.number().min(0).max(500).nullable().optional();
const rating = z.number().int().min(1).max(10).nullable().optional();

export const checkInDataSchema = z.object({
  week,
  date: dateString,
  phase: z.string().min(1).max(60),
  weightLbs: measurement,
  waistRelaxed: measurement,
  waistVacuum: measurement,
  chest: measurement,
  armsLeft: measurement,
  armsRight: measurement,
  shoulders: measurement,
  thighsLeft: measurement,
  thighsRight: measurement,
  calvesLeft: measurement,
  calvesRight: measurement,
  shoulderToWaist: z.number().min(0).max(10).nullable().optional(),
  sleepQuality: rating,
  energyLevels: rating,
  trainingMotivation: rating,
  hungerAppetite: rating,
  mood: rating,
  notes: z.string().max(5000).optional(),
  photos: z
    .array(
      z.object({
        poseType: z.string().min(1).max(50),
        objectPath: z.string().min(1).max(500),
      }),
    )
    .max(20)
    .optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  age: z.number().int().min(1).max(120).nullable().optional(),
  heightInches: z.number().int().min(36).max(96).nullable().optional(),
  showDate: dateString.nullable().optional(),
  prepStartDate: dateString.nullable().optional(),
  competitionName: z.string().max(200).nullable().optional(),
  division: z.string().max(100).nullable().optional(),
});

/**
 * Cardio and vacuum bodies used to be inserted straight from `req.body`. A
 * missing or non-numeric `durationMin` reached Postgres as NaN/undefined and
 * either threw a raw driver error or wrote a nonsense row.
 */
export const cardioSessionRequestSchema = z.object({
  date: dateString,
  week,
  type: z.enum(CARDIO_TYPES),
  subtype: z.enum(CARDIO_SUBTYPES).nullable().optional(),
  durationMin: z.number().int().min(1).max(600),
  notes: z.string().max(2000).optional(),
});

export const vacuumSessionRequestSchema = z.object({
  date: dateString,
  week,
  timeOfDay: z.enum(TIMES_OF_DAY),
  sets: z.number().int().min(1).max(50),
  durationSec: z.number().int().min(1).max(600),
  notes: z.string().max(2000).optional(),
});

export const recommendationStatusSchema = z.object({
  status: z.enum(["pending", "accepted", "dismissed", "completed"]),
});

export const uploadRequestSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(120),
});

/** Query params shared by list endpoints. */
export const listQuerySchema = z.object({
  week: week.optional(),
  type: z.enum(CARDIO_TYPES).optional(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
  status: z.string().max(30).optional(),
});

export const weekParamSchema = z.object({ week: week.default(1) });
export const dayParamSchema = z.object({ day: trainingDay });

export const deloadDecisionSchema = z.object({
  status: z.enum(["active", "completed", "dismissed"]),
  notes: z.string().max(2000).optional(),
});

export const startDeloadSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2)]),
  subject: z.string().max(120).nullable().optional(),
  week,
  notes: z.string().max(2000).optional(),
});
