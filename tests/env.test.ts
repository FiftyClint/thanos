import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatEnvError } from "../server/env";

/**
 * The boot-time config error is often the only thing a deploy log shows before
 * the container dies, so it has to carry enough to act on.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  S3_ENDPOINT: z.string().url().optional(),
});

function failureFor(source: Record<string, string | undefined>): string {
  const result = schema.safeParse(source);
  if (result.success) throw new Error("expected the config to be rejected");
  return formatEnvError(result.error, source);
}

describe("formatEnvError", () => {
  it("names the variable and the reason", () => {
    // An absent key reports Zod's own "Required"; the schema's custom message
    // only fires when the key is present but fails a rule.
    const absent = failureFor({});
    expect(absent).toContain("Invalid environment configuration:");
    expect(absent).toContain("DATABASE_URL: Required");

    const empty = failureFor({ DATABASE_URL: "" });
    expect(empty).toContain("DATABASE_URL: DATABASE_URL is required");
  });

  it("distinguishes 'never set' from 'set but empty'", () => {
    // Two very different fixes, previously reported with identical text.
    expect(failureFor({})).toContain("is not set at all");

    const empty = failureFor({ DATABASE_URL: "" });
    expect(empty).toContain("set but EMPTY");
    expect(empty).not.toContain("is not set at all");
  });

  it("points an empty value at the likely cause: a bad service reference", () => {
    const message = failureFor({ DATABASE_URL: "" });
    expect(message).toContain("${{Postgres.DATABASE_URL}}");
    expect(message).toContain("service");
  });

  it("reports every broken variable at once, not just the first", () => {
    const message = failureFor({ DATABASE_URL: "", S3_ENDPOINT: "VALUE or ${{REF}}" });
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("S3_ENDPOINT");
  });

  it("adds no empty-value note when the value is merely wrong", () => {
    const message = failureFor({ DATABASE_URL: "ok", S3_ENDPOINT: "not-a-url" });
    expect(message).toContain("S3_ENDPOINT");
    expect(message).not.toContain("set but EMPTY");
  });

  it("points at the documentation", () => {
    expect(failureFor({})).toContain(".env.example");
  });
});
