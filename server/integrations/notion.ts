import { Client } from "@notionhq/client";
import type { WorkoutLog, WeeklyCheckIn } from "@shared/schema";
import { env, notionEnabled } from "../env";
import { logger } from "../logger";

/**
 * Optional mirror of training data into Notion. Postgres stays the source of
 * truth; this is a one-way copy for reporting.
 *
 * Everything is off unless NOTION_API_KEY is set, and each database is off
 * unless its id is configured. The database ids used to be hardcoded into the
 * source, which meant this file only worked for one person's workspace and
 * leaked those ids to anyone reading the repo.
 */
const DB = {
  trainingSessions: () => env.NOTION_DB_TRAINING_SESSIONS,
  bodyComposition: () => env.NOTION_DB_BODY_COMPOSITION,
  bodyMeasurements: () => env.NOTION_DB_BODY_MEASUREMENTS,
  dailyVitals: () => env.NOTION_DB_DAILY_VITALS,
};

const DAY_TYPE: Record<number, string> = {
  1: "Delts + Triceps",
  2: "Lat Width + Biceps",
  3: "Posing",
  4: "Upper Chest + Core",
  5: "Back Thickness + Rear Delts + Arms",
  6: "Legs",
};

let client: Client | null = null;

function getClient(): Client | null {
  if (!notionEnabled) return null;
  if (!client) client = new Client({ auth: env.NOTION_API_KEY });
  return client;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const num = (value: number | null | undefined) => ({ number: value ?? null });
const richText = (value: string | null | undefined) =>
  value ? [{ text: { content: String(value).slice(0, 2000) } }] : [];
const select = (value: string | null | undefined) => (value ? { name: value } : null);

/** Upsert a page identified by its title, so re-syncing a day doesn't duplicate it. */
async function upsertByTitle(
  databaseId: string,
  titleProperty: string,
  titleValue: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const notion = getClient();
  if (!notion) return;

  const existing = await notion.databases.query({
    database_id: databaseId,
    filter: { property: titleProperty, title: { equals: titleValue } },
    page_size: 1,
  });

  const pageId = existing.results[0]?.id;
  if (pageId) {
    await notion.pages.update({ page_id: pageId, properties: properties as never });
  } else {
    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties as never,
    });
  }
}

export async function syncTrainingSession(workoutLog: WorkoutLog): Promise<void> {
  const databaseId = DB.trainingSessions();
  if (!getClient() || !databaseId) return;

  const dateStr = isoDay(new Date(workoutLog.date));
  const dayType = DAY_TYPE[workoutLog.day] ?? "Cardio Only";
  const title = `${dayType} - ${dateStr}`;

  await upsertByTitle(databaseId, "Session", title, {
    Session: { title: [{ text: { content: title } }] },
    Date: { date: { start: dateStr } },
    "Day Type": { select: select(dayType) },
    "Duration (min)": num(workoutLog.duration),
    Notes: { rich_text: richText(workoutLog.notes) },
  });
}

export async function syncBodyComposition(checkIn: WeeklyCheckIn): Promise<void> {
  const databaseId = DB.bodyComposition();
  if (!getClient() || !databaseId) return;

  const dateStr = isoDay(new Date(checkIn.date));
  await upsertByTitle(databaseId, "Date", dateStr, {
    Date: { title: [{ text: { content: dateStr } }] },
    "Weight (lbs)": num(checkIn.weightLbs),
    Source: { select: select("Manual") },
    Notes: { rich_text: richText(checkIn.notes) },
  });
}

export async function syncBodyMeasurements(checkIn: WeeklyCheckIn): Promise<void> {
  const databaseId = DB.bodyMeasurements();
  if (!getClient() || !databaseId) return;

  const dateStr = isoDay(new Date(checkIn.date));
  await upsertByTitle(databaseId, "Date", dateStr, {
    Date: { title: [{ text: { content: dateStr } }] },
    "Shoulder Width": num(checkIn.shoulders),
    Chest: num(checkIn.chest),
    "Upper Waist": num(checkIn.waistRelaxed),
    "Lower Waist": num(checkIn.waistVacuum),
    "Upper Arm R": num(checkIn.armsRight),
    "Upper Arm L": num(checkIn.armsLeft),
    "Thigh R": num(checkIn.thighsRight),
    "Thigh L": num(checkIn.thighsLeft),
    "Calf R": num(checkIn.calvesRight),
    "Calf L": num(checkIn.calvesLeft),
    Source: { select: select("Tape") },
    Notes: { rich_text: richText(checkIn.notes) },
  });
}

export async function syncDailyVitals(checkIn: WeeklyCheckIn): Promise<void> {
  const databaseId = DB.dailyVitals();
  if (!getClient() || !databaseId) return;

  const dateStr = isoDay(new Date(checkIn.date));
  await upsertByTitle(databaseId, "Date", dateStr, {
    Date: { title: [{ text: { content: dateStr } }] },
    "Sleep Quality 1-10": num(checkIn.sleepQuality),
    "Energy 1-10": num(checkIn.energyLevels),
    "Mood 1-10": num(checkIn.mood),
    Notes: { rich_text: richText(checkIn.notes) },
  });
}

/** Mirror a check-in into all configured databases. Failures are logged, never thrown. */
export async function syncCheckIn(checkIn: WeeklyCheckIn): Promise<void> {
  if (!getClient()) return;

  const results = await Promise.allSettled([
    syncBodyComposition(checkIn),
    syncBodyMeasurements(checkIn),
    syncDailyVitals(checkIn),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason }, "notion check-in sync failed");
    }
  }
}
