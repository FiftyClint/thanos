import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  root: path.resolve(root, "client"),
  build: {
    outDir: path.resolve(root, "dist", "public"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app bundle so a
        // code change doesn't force phones to re-download all of it.
        //
        // recharts is deliberately NOT listed: naming it here would create an
        // eagerly-preloaded chunk, undoing the lazy-loading of the two chart
        // routes. Left alone, Rollup puts it inside those routes' chunks.
        manualChunks: {
          react: ["react", "react-dom", "wouter"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    fs: { strict: true, deny: ["**/.*"] },
  },
});
