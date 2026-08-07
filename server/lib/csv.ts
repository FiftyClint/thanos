/**
 * RFC 4180 CSV writing.
 *
 * The previous export built rows with raw string concatenation, so any exercise
 * name, note, or band note containing a comma silently shifted every later
 * column, and a newline in a note broke the row entirely. Almost every note in
 * the program contains a comma, so this mattered.
 *
 * Leading =, +, -, @ and control characters are also prefixed with a single
 * quote so a note is never interpreted as a formula when opened in Excel.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  let str: string;
  if (value instanceof Date) {
    str = Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  } else {
    str = String(value);
  }

  if (str === "") return "";

  if (FORMULA_PREFIX.test(str)) {
    str = `'${str}`;
  }

  if (NEEDS_QUOTING.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(escapeCsvValue).join(",");
}

/** Build a complete CSV document. Uses CRLF line endings per the spec. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** Format a date as YYYY-MM-DD for export columns. */
export function isoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
