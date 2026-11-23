-- Seasons: every week-keyed row records which cycle its week belongs to.
-- Existing rows are the 2026 prep, so they backfill to 2026; the default is
-- then dropped so new rows must always state their season explicitly.
ALTER TABLE "cardio_sessions" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "cardio_sessions" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deload_events" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "deload_events" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_photos" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vacuum_sessions" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "vacuum_sessions" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "weekly_check_ins" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_check_ins" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "season" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_logs" ALTER COLUMN "season" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_check_ins_user_season_week_idx" ON "weekly_check_ins" USING btree ("user_id","season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_logs_user_season_day_week_idx" ON "workout_logs" USING btree ("user_id","season","day","week");--> statement-breakpoint
DROP INDEX "weekly_check_ins_user_week_idx";--> statement-breakpoint
DROP INDEX "workout_logs_user_day_week_idx";
