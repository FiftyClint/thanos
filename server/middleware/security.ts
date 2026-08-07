import type { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { isProduction, isTest } from "../env";

/**
 * Security headers.
 *
 * The CSP allows inline styles (Tailwind and Radix set them) but nothing from
 * a third-party origin, and `connect-src 'self'` keeps a compromised dependency
 * from exfiltrating training data. In development it is relaxed enough for
 * Vite's HMR websocket and eval-based sourcemaps.
 */
export function applySecurityHeaders(app: Express): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: isProduction ? ["'self'"] : ["'self'", "ws:", "wss:"],
          frameSrc: ["'self'", "https://www.youtube.com", "https://youtube.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      // Progress photos are served same-origin but read cross-origin by the
      // service worker cache; COEP would block that with no benefit here.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
}

const skipWhenTesting = () => isTest;

/**
 * Brute-force protection on the credential endpoints.
 *
 * Login was previously unlimited, so a six-character password could be attacked
 * as fast as the server would answer.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipWhenTesting,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipWhenTesting,
  message: { error: "Too many accounts created from this address. Try again later." },
});

/** A generous ceiling for everything else — catches runaway clients, not real use. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipWhenTesting,
  message: { error: "Slow down a moment." },
});

/**
 * Reject cross-site state-changing requests.
 *
 * Session cookies are SameSite=Lax, which already blocks cross-site POSTs from
 * forms and fetch. This is a second, explicit check on the Origin header so a
 * browser bug or a future SameSite=None change cannot silently open a CSRF hole.
 */
export function verifySameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin) {
    // Native app / curl / same-origin navigation — no Origin to check.
    next();
    return;
  }

  const host = req.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    res.status(403).json({ error: "Invalid Origin header" });
    return;
  }

  if (originHost !== host) {
    res.status(403).json({ error: "Cross-origin request refused" });
    return;
  }
  next();
}
