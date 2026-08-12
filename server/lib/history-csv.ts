/**
 * Parsing for the training-history CSV exported by the app.
 *
 * Kept apart from the import script so it can be tested without a database.
 * Everything here is pure: text in, structured sessions out.
 */

/** The export's columns, in order. */
export const HISTORY_COLUMNS = [
  "Date",
  "Week",
  "Phase",
  "Day",
  "Exercise#",
  "Exercise",
  "Set",
  "Side",
  "Weight(lbs)",
  "Reps",
  "Duration(s)",
  "RIR",
  "Band",
] as const;

const COLUMN_COUNT = HISTORY_COLUMNS.length;

export interface HistoryRow {
  date: string;
  week: number;
  phase: string;
  day: number;
  exerciseNumber: string;
  exercise: string;
  setNumber: number;
  side: "left" | "right" | null;
  weightLbs: number | null;
  reps: number | null;
  durationSecs: number | null;
  rirActual: number | null;
  bandNote: string | null;
  /** 1-based line number in the source file, for error messages. */
  line: number;
}

export interface ParseReport {
  rows: HistoryRow[];
  /** Rows whose exercise name contained a comma and had to be reassembled. */
  repaired: number;
  /** Duplicate (day, exercise, set, side) rows dropped, by the old duplicate-append bug. */
  duplicatesCollapsed: number;
  /** Lines that could not be read at all, with the reason. */
  skipped: Array<{ line: number; reason: string; text: string }>;
}

function num(value: string): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Split one line into exactly the expected fields.
 *
 * The old app wrote this CSV by joining values with commas and never quoting
 * them, so any exercise name containing a comma — "1-Arm DB Row (strict, bench
 * supported)", "Pull Down Cycle (Wide, Normal, Reverse Grip)" — shifted every
 * later field one place right. Weight landed in Side, reps landed in Weight,
 * and the row silently became nonsense rather than failing.
 *
 * The column count is fixed and the exercise name is the only free-text field,
 * so the excess is exactly the number of commas inside the name and the split
 * is recoverable. Properly quoted files parse through the same path untouched,
 * because a quoted name yields no excess fields.
 */
export function splitHistoryLine(line: string): { fields: string[]; repaired: boolean } | null {
  // Handle a correctly quoted file too, so a fixed export doesn't need a
  // different code path.
  const quoted = line.match(/^(?:"(?:[^"]|"")*"|[^,]*)(?:,(?:"(?:[^"]|"")*"|[^,]*))*$/);
  if (quoted && line.includes('"')) {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else current += char;
    }
    fields.push(current);
    return fields.length === COLUMN_COUNT ? { fields, repaired: false } : null;
  }

  const raw = line.split(",");
  const excess = raw.length - COLUMN_COUNT;
  if (excess < 0) return null;
  if (excess === 0) return { fields: raw, repaired: false };

  // The name spans its own field plus one extra per embedded comma.
  const name = raw.slice(5, 6 + excess).join(",");
  return { fields: [...raw.slice(0, 5), name, ...raw.slice(6 + excess)], repaired: true };
}

/**
 * Parse an exported history CSV.
 *
 * Rows that can't be read are collected rather than thrown, so one malformed
 * line never costs six months of history — the caller reports them and imports
 * the rest.
 */
export function parseHistoryCsv(content: string): ParseReport {
  const lines = content.split(/\r?\n/);
  const rows: HistoryRow[] = [];
  const skipped: ParseReport["skipped"] = [];
  let repaired = 0;

  const seen = new Set<string>();
  let duplicatesCollapsed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (i === 0 && line.startsWith(HISTORY_COLUMNS[0])) continue; // header

    const split = splitHistoryLine(line);
    if (!split) {
      skipped.push({ line: i + 1, reason: `expected ${COLUMN_COUNT} columns`, text: line });
      continue;
    }
    if (split.repaired) repaired++;

    const [date, week, phase, day, exerciseNumber, exercise, setNumber, side, weight, reps, duration, rir, band] =
      split.fields;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      skipped.push({ line: i + 1, reason: `unreadable date "${date}"`, text: line });
      continue;
    }
    if (!exercise.trim()) {
      skipped.push({ line: i + 1, reason: "no exercise name", text: line });
      continue;
    }

    const sideValue = side.trim().toLowerCase();
    if (sideValue && sideValue !== "left" && sideValue !== "right") {
      // Reaching here means the row is still misaligned, so its numbers cannot
      // be trusted — importing it would invent a weight.
      skipped.push({ line: i + 1, reason: `unexpected side "${side}"`, text: line });
      continue;
    }

    const parsedWeek = num(week);
    const parsedDay = num(day);
    if (parsedWeek === null || parsedDay === null) {
      skipped.push({ line: i + 1, reason: "unreadable week or day", text: line });
      continue;
    }

    /*
     * A re-submitted workout appended a second copy of its sets in the old app
     * rather than replacing them. The repeats are identical, so the first wins.
     */
    const key = `${date}|${parsedDay}|${exercise.trim()}|${setNumber.trim()}|${sideValue}`;
    if (seen.has(key)) {
      duplicatesCollapsed++;
      continue;
    }
    seen.add(key);

    rows.push({
      date: date.trim(),
      week: parsedWeek,
      phase: phase.trim(),
      day: parsedDay,
      exerciseNumber: exerciseNumber.trim(),
      exercise: exercise.trim(),
      setNumber: num(setNumber) ?? 1,
      side: sideValue === "left" || sideValue === "right" ? sideValue : null,
      weightLbs: num(weight),
      reps: num(reps),
      durationSecs: num(duration),
      rirActual: num(rir),
      bandNote: text(band),
      line: i + 1,
    });
  }

  return { rows, repaired, duplicatesCollapsed, skipped };
}

export interface HistorySession {
  date: string;
  week: number;
  day: number;
  phase: string;
  rows: HistoryRow[];
}

/**
 * Group rows into sessions.
 *
 * Keyed by (week, day) rather than by date, because that is what the schema's
 * unique index on workout_logs enforces. Two dates sharing a (week, day) would
 * collide on insert, so they are merged here — deliberately, and reported —
 * instead of failing the import halfway through.
 */
export function groupIntoSessions(rows: HistoryRow[]): HistorySession[] {
  const byWeekDay = new Map<string, HistorySession>();

  for (const row of rows) {
    const key = `${row.week}|${row.day}`;
    const existing = byWeekDay.get(key);
    if (existing) existing.rows.push(row);
    else byWeekDay.set(key, { date: row.date, week: row.week, day: row.day, phase: row.phase, rows: [row] });
  }

  return [...byWeekDay.values()].sort((a, b) => a.week - b.week || a.day - b.day);
}

export interface SeedExercise {
  id: string;
  name: string;
  day: number;
  program: string;
}

export interface NameResolution {
  /** "name|day" → exercise id */
  resolved: Map<string, string>;
  /** Names with no counterpart anywhere in the seeded programs. */
  unresolved: string[];
}

/**
 * Point each historical exercise name at a row in the current database.
 *
 * Matching runs strictest first: the same name on the same day of the preferred
 * program, then the same name anywhere in that program, then the same name in
 * any program at all. The last step is safe here in a way it would not
 * ordinarily be, because autofill's fallback already looks history up BY NAME
 * across every program — so a weight attached to the phase-1 row of a movement
 * is still found when that movement comes round in phase 3.
 *
 * Ties are broken over a stably sorted list so two runs cannot disagree.
 */
export function resolveExerciseNames(
  names: Array<{ name: string; day: number }>,
  seeded: SeedExercise[],
  preferredProgram: string,
): NameResolution {
  const ordered = [...seeded].sort(
    (a, b) =>
      Number(b.program === preferredProgram) - Number(a.program === preferredProgram) ||
      a.program.localeCompare(b.program) ||
      a.day - b.day ||
      a.id.localeCompare(b.id),
  );

  const first = (predicate: (e: SeedExercise) => boolean): string | undefined =>
    ordered.find(predicate)?.id;

  const resolved = new Map<string, string>();
  const unresolved = new Set<string>();

  for (const { name, day } of names) {
    const key = `${name}|${day}`;
    if (resolved.has(key)) continue;

    const hit =
      first((e) => e.name === name && e.day === day && e.program === preferredProgram) ??
      first((e) => e.name === name && e.program === preferredProgram) ??
      first((e) => e.name === name && e.day === day) ??
      first((e) => e.name === name);

    if (hit) resolved.set(key, hit);
    else unresolved.add(name);
  }

  return { resolved, unresolved: [...unresolved].sort() };
}
