import pino from "pino";
import { env, isProduction } from "./env";

/**
 * Structured logging.
 *
 * Note this deliberately does NOT log response bodies. The previous version
 * appended `JSON.stringify(body)` to every /api log line, which wrote password
 * hashes, session ids, and every measurement the user entered into the logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      },
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "password", "passwordHash"],
    remove: true,
  },
});

export type Logger = typeof logger;
