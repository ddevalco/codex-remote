import { defineConfig } from "eslint/config";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import prettierConfig from "eslint-config-prettier";

const baseRules = {
  "prefer-const": "error",
};

const tsRules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
};

export default defineConfig([
  {
    ignores: [
      ".ideas/**",
      "node_modules/**",
      "dist/**",
      ".docs/**",
      ".wrangler/**",
      ".svelte-kit/**",
      "services/**/node_modules/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: baseRules,
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      ...baseRules,
      ...tsRules,
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: typescriptParser,
        extraFileExtensions: [".svelte"],
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      svelte: sveltePlugin,
    },
    rules: {
      ...baseRules,
      ...tsRules,
      ...sveltePlugin.configs["flat/recommended"].rules,
    },
  },
  prettierConfig,
]);
