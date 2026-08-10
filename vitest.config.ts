import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /*
   * JSX for the .tsx rendering tests. Configured through esbuild rather than
   * @vitejs/plugin-react because vitest bundles its own vite, and the two
   * Plugin types are not assignable to one another.
   */
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // The integration suite shares one database; running files in parallel
    // would have them truncating each other's tables mid-assertion.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["server/seed/phase*.ts", "server/vite.ts"],
    },
  },
});
