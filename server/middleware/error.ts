import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";
import { isProduction } from "../env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

function zodMessage(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid request";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * Single place where errors become responses.
 *
 * Client mistakes (validation, not found) return their message. Anything
 * unexpected is logged in full and answered with a generic message, so an
 * internal failure never leaks a stack trace or SQL text to the browser.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: zodMessage(err), issues: err.issues });
    return;
  }

  const status =
    err instanceof HttpError
      ? err.status
      : typeof (err as { status?: unknown })?.status === "number"
        ? ((err as { status: number }).status)
        : 500;

  if (status >= 500) {
    logger.error({ err, method: req.method, path: req.path }, "request failed");
    res.status(status).json({
      error: isProduction ? "Internal Server Error" : (err as Error)?.message ?? "Internal Server Error",
    });
    return;
  }

  logger.warn({ method: req.method, path: req.path, status }, (err as Error)?.message ?? "request rejected");
  res.status(status).json({
    error: (err as Error)?.message ?? "Request failed",
    ...(err instanceof HttpError && err.details ? { details: err.details } : {}),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
}
