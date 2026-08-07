import { z } from "zod";

/**
 * Environment configuration, validated once at boot.
 *
 * The app refuses to start on bad config rather than failing later at the first
 * request that happens to need it. In particular SESSION_SECRET has no default
 * in production — a shared fallback secret would let anyone forge a session.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    HOST: z.string().default("0.0.0.0"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    SESSION_SECRET: z.string().min(32).optional(),
    /** Days a login stays valid. */
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    /** Set false to keep an instance private after you've made your account. */
    ALLOW_REGISTRATION: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    /** Run pending SQL migrations on boot. Handy for single-instance deploys. */
    AUTO_MIGRATE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /** Sync program seed data into the DB on boot. */
    AUTO_SEED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    /** Where progress photos live. */
    FILE_STORE: z.enum(["local", "s3"]).default("local"),
    /** Volume root. Object keys are "uploads/<userId>/<uuid>", so files land in <UPLOAD_DIR>/uploads/. */
    UPLOAD_DIR: z.string().default("./data"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    /** Optional mirror of workouts/check-ins into Notion. Off unless a key is set. */
    NOTION_API_KEY: z.string().optional(),
    NOTION_DB_TRAINING_SESSIONS: z.string().optional(),
    NOTION_DB_BODY_COMPOSITION: z.string().optional(),
    NOTION_DB_BODY_MEASUREMENTS: z.string().optional(),
    NOTION_DB_DAILY_VITALS: z.string().optional(),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    /** Behind a reverse proxy (Fly, Railway, nginx) so secure cookies work. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === "production" && !cfg.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message:
          "SESSION_SECRET must be set in production (32+ chars). Generate one with: openssl rand -hex 32",
      });
    }
    if (cfg.FILE_STORE === "s3") {
      for (const key of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when FILE_STORE=s3`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * Turn a validation failure into something actionable in a deploy log.
 *
 * The distinction that matters: a variable set to an empty string is, to Zod,
 * identical to one that was never set — both report "is required". On a hosting
 * platform those are very different situations. Railway's `${{Service.VAR}}`
 * syntax resolves to an empty string when the service name doesn't match, so
 * "I definitely set that one" and "the app says it's missing" are both true at
 * once. Say so, rather than making someone guess.
 */
export function formatEnvError(error: z.ZodError, source: Record<string, string | undefined>): string {
  const lines = ["Invalid environment configuration:"];

  for (const issue of error.issues) {
    const name = issue.path.join(".") || "(root)";
    lines.push(`  - ${name}: ${issue.message}`);

    if (source[name] === "") {
      lines.push(
        `      ${name} is set but EMPTY. If it holds a platform variable reference`,
        `      (e.g. Railway's \${{Postgres.DATABASE_URL}}), the referenced service`,
        `      name probably doesn't match — a bad reference resolves to "".`,
      );
    } else if (!(name in source)) {
      lines.push(`      ${name} is not set at all.`);
    }
  }

  lines.push("", "See .env.example for what each variable does.");
  return lines.join("\n");
}

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Thrown before the logger exists, so write plainly and exit.
    console.error(formatEnvError(parsed.error, process.env));
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Dev/test fall back to a fixed secret; production is required to set one (see above). */
export const sessionSecret = env.SESSION_SECRET ?? "thanos-dev-only-session-secret-not-for-production";

export const notionEnabled = Boolean(env.NOTION_API_KEY);
