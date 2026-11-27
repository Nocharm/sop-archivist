import { readFileSync } from "node:fs";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Files that already used effects or timers when the budget started (2026-11-19). New files may not;
// `src/source-rules.test.ts` keeps these files from growing. Plan: 2026-11-19-trust-foundation-plan.md
const baseline = JSON.parse(readFileSync(new URL("./effect-baseline.json", import.meta.url), "utf8"));
// Next route folders like `[id]` are glob classes in ESLint patterns, so escape them.
const toPatterns = (record) => Object.keys(record).map((path) => path.replace(/[[\]()]/g, "\\$&"));
const SHARED_HOOKS = "src/lib/use-*.ts";
const TESTS = "src/**/*.test.ts";

const EFFECT_MESSAGE =
  "useEffect/useLayoutEffect is limited to shared hooks (src/lib/use-*.ts) and the baseline files in effect-baseline.json. " +
  "Derive the value during render, act in the event handler, or put the subscription in a shared hook.";
const TIMER_MESSAGE =
  "setTimeout/setInterval/requestAnimationFrame is limited to shared hooks (src/lib/use-*.ts) and the baseline files in effect-baseline.json. " +
  "A timer usually hides an ordering problem: wait on the real event (a promise, ResizeObserver, transitionend) or use a shared hook.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [SHARED_HOOKS, TESTS, ...toPatterns(baseline.effects)],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name=/^(useEffect|useLayoutEffect)$/]", message: EFFECT_MESSAGE },
        { selector: "CallExpression[callee.property.name=/^(useEffect|useLayoutEffect)$/]", message: EFFECT_MESSAGE },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [SHARED_HOOKS, TESTS, ...toPatterns(baseline.timers)],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: TIMER_MESSAGE },
        { name: "setInterval", message: TIMER_MESSAGE },
        { name: "requestAnimationFrame", message: TIMER_MESSAGE },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "setTimeout", message: TIMER_MESSAGE },
        { object: "window", property: "setInterval", message: TIMER_MESSAGE },
        { object: "window", property: "requestAnimationFrame", message: TIMER_MESSAGE },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
