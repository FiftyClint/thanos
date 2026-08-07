import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Serve the built client and fall through to index.html for SPA routes. */
export function serveStatic(app: Express): void {
  const distPath = path.resolve(here, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(`Client build not found at ${distPath}. Run "npm run build" first.`);
  }

  // Hashed asset filenames can be cached forever; index.html and the service
  // worker must not be, or a deploy never reaches an installed PWA.
  app.use(
    express.static(distPath, {
      maxAge: "1y",
      index: false,
      setHeaders: (res, filePath) => {
        const name = path.basename(filePath);
        if (name === "index.html" || name === "sw.js" || name === "manifest.json") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
