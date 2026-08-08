CREATE TABLE "deload_events" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"tier" integer NOT NULL,
	"status" text DEFAULT 'recommended' NOT NULL,
	"subject" text,
	"triggers" jsonb DEFAULT '[]'::jsonb,
	"week" integer NOT NULL,
	"recommended_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"notes" text DEFAULT ''
);
--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "joint_status" text;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "joint_areas" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "warmup_feel" text;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "pump_quality" text;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "session_dread" boolean;--> statement-breakpoint
ALTER TABLE "deload_events" ADD CONSTRAINT "deload_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deload_events_user_status_idx" ON "deload_events" USING btree ("user_id","status");