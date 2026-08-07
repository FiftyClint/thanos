import type { Express } from "express";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { logger } from "./logger";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mount Vite in middleware mode for development, so the client and API are
 * served from one origin with HMR.
 *
 * Only imported when NODE_ENV !== production — Vite is a dev dependency and is
 * not present in the production image.
 */
export async function setupVite(server: Server, app: Express): Promise<void> {
  const vite = await createViteServer({
    configFile: path.resolve(here, "..", "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server, path: "/vite-hmr" },
      allowedHosts: true,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use(async (req, res, next) => {
    try {
      const templatePath = path.resolve(here, "..", "client", "index.html");
      // Re-read each request so edits to index.html show up without a restart.
      let template = await fs.readFile(templatePath, "utf-8");
      template = template.replace(
        'src="/src/main.tsx"',
        `src="/src/main.tsx?v=${crypto.randomUUID()}"`,
      );
      const page = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      // A dev-server template failure is worth surfacing loudly, not exiting on.
      logger.error({ err }, "vite failed to transform index.html");
      next(err);
    }
  });
}
