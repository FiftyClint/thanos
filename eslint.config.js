import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "migrations/**",
      // Generated program content: 300+ single-line object literals.
      "server/seed/phase*.ts",
      // Vendored shadcn/ui primitives, kept as shipped.
      "client/src/components/ui/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        TypeError: "readonly",
        __dirname: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint, "react-hooks": reactHooks },
    rules: {
      ...tseslint.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "no-undef": "off", // TypeScript already checks this, and knows the DOM lib.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Scripts and tests legitimately write to stdout.
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "no-console": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // The service worker runs in its own global scope, not the window's.
    files: ["client/public/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Response: "readonly",
        Headers: "readonly",
        console: "readonly",
      },
    },
    rules: { "no-console": "off", "no-unused-vars": ["warn", { caughtErrors: "none" }] },
  },
  {
    // Tailwind's plugin array is CommonJS by design.
    files: ["tailwind.config.ts", "postcss.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];
