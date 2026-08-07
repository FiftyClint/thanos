CREATE TABLE "cardio_sessions" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"date" timestamp NOT NULL,
	"week" integer NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"duration_min" integer NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" integer NOT NULL,
	"order" integer NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"default_sets" integer NOT NULL,
	"rep_range" text NOT NULL,
	"tempo" text NOT NULL,
	"rir" text NOT NULL,
	"rest_seconds" text NOT NULL,
	"notes" text DEFAULT '',
	"alternate" text DEFAULT '',
	"video_url" text DEFAULT '',
	"input_type" text DEFAULT 'weight_reps' NOT NULL,
	"is_superset_part" boolean DEFAULT false,
	"superset_group" text,
	"segment" text DEFAULT 'working' NOT NULL,
	"program" text DEFAULT 'phase1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_photos" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"check_in_id" varchar(36),
	"file_path" text NOT NULL,
	"pose_type" text NOT NULL,
	"week" integer NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"exercise_id" varchar(36),
	"type" text NOT NULL,
	"message" text NOT NULL,
	"details" text DEFAULT '',
	"week" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar(255) PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" varchar(36) NOT NULL,
	"exercise_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"set_number" integer NOT NULL,
	"weight_lbs" real,
	"reps" integer,
	"side" text,
	"duration_secs" integer,
	"rir_actual" integer,
	"is_failure" boolean DEFAULT false,
	"band_note" text,
	"cardio_notes" text,
	"recommended_weight" real,
	"user_override" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'athlete' NOT NULL,
	"active_program" text DEFAULT 'phase3' NOT NULL,
	"age" integer,
	"height_inches" integer,
	"show_date" timestamp,
	"prep_start_date" timestamp,
	"competition_name" text,
	"division" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vacuum_sessions" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"date" timestamp NOT NULL,
	"week" integer NOT NULL,
	"time_of_day" text NOT NULL,
	"sets" integer NOT NULL,
	"duration_sec" integer NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_check_ins" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"week" integer NOT NULL,
	"date" timestamp NOT NULL,
	"phase" text NOT NULL,
	"weight_lbs" real,
	"waist_relaxed" real,
	"waist_vacuum" real,
	"chest" real,
	"arms_left" real,
	"arms_right" real,
	"shoulders" real,
	"thighs_left" real,
	"thighs_right" real,
	"calves_left" real,
	"calves_right" real,
	"shoulder_to_waist" real,
	"sleep_quality" integer,
	"energy_levels" integer,
	"training_motivation" integer,
	"hunger_appetite" integer,
	"mood" integer,
	"notes" text DEFAULT '',
	"triggers_json" text DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"day" integer NOT NULL,
	"date" timestamp NOT NULL,
	"week" integer NOT NULL,
	"phase" text NOT NULL,
	"program" text DEFAULT 'phase3' NOT NULL,
	"duration" integer,
	"notes" text DEFAULT '',
	"completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cardio_sessions" ADD CONSTRAINT "cardio_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_check_in_id_weekly_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."weekly_check_ins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacuum_sessions" ADD CONSTRAINT "vacuum_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_check_ins" ADD CONSTRAINT "weekly_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cardio_sessions_user_date_idx" ON "cardio_sessions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "cardio_sessions_user_week_idx" ON "cardio_sessions" USING btree ("user_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_program_day_order_number_idx" ON "exercises" USING btree ("program","day","order","number");--> statement-breakpoint
CREATE INDEX "exercises_name_idx" ON "exercises" USING btree ("name");--> statement-breakpoint
CREATE INDEX "progress_photos_user_week_idx" ON "progress_photos" USING btree ("user_id","week");--> statement-breakpoint
CREATE INDEX "recommendations_user_status_idx" ON "recommendations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "recommendations_user_exercise_idx" ON "recommendations" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "session_expire_idx" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "set_logs_workout_idx" ON "set_logs" USING btree ("workout_log_id");--> statement-breakpoint
CREATE INDEX "set_logs_user_exercise_idx" ON "set_logs" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vacuum_sessions_user_date_idx" ON "vacuum_sessions" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_check_ins_user_week_idx" ON "weekly_check_ins" USING btree ("user_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_logs_user_day_week_idx" ON "workout_logs" USING btree ("user_id","day","week");--> statement-breakpoint
CREATE INDEX "workout_logs_user_date_idx" ON "workout_logs" USING btree ("user_id","date");