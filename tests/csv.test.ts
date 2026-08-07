import { describe, it, expect } from "vitest";
import { escapeCsvValue, csvRow, toCsv, isoDate } from "../server/lib/csv";

describe("escapeCsvValue", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvValue("Belt Squat")).toBe("Belt Squat");
    expect(escapeCsvValue(135)).toBe("135");
    expect(escapeCsvValue(0)).toBe("0");
  });

  it("renders empty for null and undefined", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("quotes values containing a comma", () => {
    // The program notes are full of these — "Light load. Controlled pace, blood flow."
    expect(escapeCsvValue("Lock in elbows, full extension")).toBe('"Lock in elbows, full extension"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvValue('Say "go"')).toBe('"Say ""go"""');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCsvValue("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises spreadsheet formulas", () => {
    // A note beginning with = would otherwise execute when opened in Excel.
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvValue("-2")).toBe("'-2");
    expect(escapeCsvValue("@import")).toBe("'@import");
  });

  it("quotes a formula that also contains a comma", () => {
    expect(escapeCsvValue("=HYPERLINK(a,b)")).toBe(`"'=HYPERLINK(a,b)"`);
  });

  it("formats dates as YYYY-MM-DD", () => {
    expect(escapeCsvValue(new Date("2026-03-14T12:30:00Z"))).toBe("2026-03-14");
  });
});

describe("csvRow", () => {
  it("keeps column alignment when a field contains a comma", () => {
    const row = csvRow(["2026-01-01", 3, "Row, strict", 135]);
    expect(row).toBe('2026-01-01,3,"Row, strict",135');
    // Four fields in, four fields out — the bug the old exporter had.
    expect(row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(4);
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF-terminated rows", () => {
    const csv = toCsv(["Date", "Exercise"], [["2026-01-01", "Belt Squat"]]);
    expect(csv).toBe("Date,Exercise\r\n2026-01-01,Belt Squat\r\n");
  });

  it("writes just a header when there are no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B\r\n");
  });
});

describe("isoDate", () => {
  it("accepts Date objects and date strings", () => {
    expect(isoDate(new Date("2026-05-01T08:00:00Z"))).toBe("2026-05-01");
    expect(isoDate("2026-05-01T08:00:00Z")).toBe("2026-05-01");
  });

  it("returns empty for missing or unparseable values", () => {
    expect(isoDate(null)).toBe("");
    expect(isoDate(undefined)).toBe("");
    expect(isoDate("not a date")).toBe("");
  });
});
