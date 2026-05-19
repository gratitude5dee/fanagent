import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".tanstack",
      "supabase/.temp",
      "supabase/functions/*/index.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  {
    files: ["supabase/functions/_shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.serviceworker,
        Deno: "readonly",
      },
    },
    rules: {
      "prettier/prettier": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node-fetch",
              message: "Supabase Edge shared code runs on Deno. Use the runtime fetch instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message: "Supabase Edge shared code must not depend on browser window.",
        },
        {
          name: "document",
          message: "Supabase Edge shared code must not depend on browser document.",
        },
        {
          name: "localStorage",
          message: "Supabase Edge shared code must not depend on browser localStorage.",
        },
        {
          name: "sessionStorage",
          message: "Supabase Edge shared code must not depend on browser sessionStorage.",
        },
        {
          name: "HTMLElement",
          message: "Supabase Edge shared code must not depend on DOM element globals.",
        },
      ],
    },
  },
  {
    files: ["playwright.config.ts", "tests-e2e/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
