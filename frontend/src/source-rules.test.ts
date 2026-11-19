// @vitest-environment node
/**
 * Source rules lint cannot express: the effect/timer budget, Tailwind display utilities doubled
 * on one element, custom CSS class names that Tailwind also generates, and eslint-disable reasons.
 * Plan: docs/superpowers/plans/2026-11-19-trust-foundation-plan.md (step 1).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const FRONTEND = resolve(__dirname, "..");
const SRC = join(FRONTEND, "src");
const BASELINE_PATH = join(FRONTEND, "effect-baseline.json");
const UPDATE_COMMAND = "UPDATE_EFFECT_BASELINE=1 npx vitest run src/source-rules.test.ts";

type Baseline = { effects: Record<string, number>; timers: Record<string, number> };

function listFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

function stripComments(code: string): string {
  // `[^:]` keeps `http://` inside strings; good enough for counting calls.
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const toKey = (path: string) => relative(FRONTEND, path).split("\\").join("/");
const allSources = listFiles(SRC, /\.tsx?$/);
const productSources = allSources.filter((path) => !/\.test\.tsx?$/.test(path));

// Shared hooks are the sanctioned home for effects and timers (the "framework" layer).
const isSharedHook = (key: string) => /^src\/lib\/use-[\w-]+\.ts$/.test(key);

const COUNTERS = {
  effects: /\b(?:useEffect|useLayoutEffect)\s*\(/g,
  timers: /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/g,
} as const;

function countCalls(): Baseline {
  const counts: Baseline = { effects: {}, timers: {} };
  for (const path of productSources) {
    const key = toKey(path);
    if (isSharedHook(key)) continue;
    const code = stripComments(readFileSync(path, "utf8"));
    for (const kind of ["effects", "timers"] as const) {
      const n = code.match(COUNTERS[kind])?.length ?? 0;
      if (n > 0) counts[kind][key] = n;
    }
  }
  const sortKeys = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return { effects: sortKeys(counts.effects), timers: sortKeys(counts.timers) };
}

describe("effect and timer budget", () => {
  it("keeps every file at or under its baseline, and the baseline tight", () => {
    const actual = countCalls();
    if (process.env.UPDATE_EFFECT_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
    const problems: string[] = [];
    for (const kind of ["effects", "timers"] as const) {
      const keys = new Set([...Object.keys(actual[kind]), ...Object.keys(baseline[kind])]);
      for (const key of keys) {
        const now = actual[kind][key] ?? 0;
        const allowed = baseline[kind][key] ?? 0;
        if (now > allowed) {
          problems.push(
            `${key}: ${now} ${kind} > baseline ${allowed}. Derive the value during render, act in the event ` +
              `handler, or move the subscription into a shared hook (src/lib/use-*.ts). Raising the baseline ` +
              `needs the user's approval.`,
          );
        } else if (now < allowed) {
          problems.push(`${key}: ${kind} dropped to ${now} (baseline ${allowed}) — lower the baseline: ${UPDATE_COMMAND}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

// docs/lessons/react-ts-patterns.md §9 — the winner between two display utilities is CSS order, not intent.
const DISPLAY_UTILITIES = new Set([
  "hidden", "block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid",
  "table", "inline-table", "contents", "flow-root", "list-item",
]);
const CLASS_TOKEN = /^!?[a-z0-9][a-z0-9:[\]()/._%#&>*=!-]*$/;

function findDisplayDoubles(code: string): string[] {
  const found: string[] = [];
  const literals = code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g);
  for (const match of literals) {
    const body = match[1] ?? match[2] ?? match[3] ?? "";
    for (const chunk of body.split(/\$\{[^}]*\}/)) {
      const tokens = chunk.trim().split(/\s+/).filter(Boolean);
      // Only class lists: every token class-shaped and at least one Tailwind-looking token.
      if (tokens.length < 2 || !tokens.every((t) => CLASS_TOKEN.test(t))) continue;
      if (!tokens.some((t) => t.includes("-") || t.includes(":"))) continue;
      const displays = tokens.filter((t) => DISPLAY_UTILITIES.has(t.replace(/^!/, "")));
      if (displays.length >= 2) found.push(`${displays.join(" + ")} in "${chunk.trim()}"`);
    }
  }
  return found;
}

describe("Tailwind display utilities", () => {
  it("never puts two unprefixed display utilities on one class list", () => {
    const problems = productSources
      .filter((path) => path.endsWith(".tsx"))
      .flatMap((path) => findDisplayDoubles(stripComments(readFileSync(path, "utf8"))).map((m) => `${toKey(path)}: ${m}`));
    // Fix: pick one display conditionally — `${shown ? "inline-flex" : "hidden"}` — or render conditionally.
    expect(problems).toEqual([]);
  });

  it("catches the doubled form and lets the conditional form through", () => {
    expect(findDisplayDoubles('className="inline-flex hidden items-center"')).toHaveLength(1);
    expect(findDisplayDoubles("className={`${shown ? \"inline-flex\" : \"hidden\"} items-center`}")).toEqual([]);
    expect(findDisplayDoubles('className="hidden sm:flex items-center"')).toEqual([]);
  });
});

// docs/lessons/react-ts-patterns.md §10 — Tailwind v4 generates a utility for any matching word in the source,
// and the utilities layer beats our component class (`.collapse` became `visibility: collapse`).
async function findUtilityCollisions(names: string[]): Promise<string[]> {
  const compiler = await compile("@tailwind utilities;");
  const css = compiler.build(names);
  const generated = new Set([...css.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\/g, "")));
  return names.filter((name) => generated.has(name));
}

function collectCustomClasses(): string[] {
  const names = new Set<string>();
  for (const path of listFiles(SRC, /\.css$/)) {
    const css = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "")
      .replace(/"[^"]*"|'[^']*'/g, "");
    // Selectors only: drop declaration blocks' values by reading text before each `{`.
    for (const selector of css.matchAll(/([^{};]+)\{/g)) {
      for (const m of selector[1].matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) names.add(m[1]);
    }
  }
  return [...names].sort();
}

// Selectors that style an existing utility on purpose (not our own class with a clashing name).
const INTENTIONAL_UTILITY_SELECTORS: Record<string, string> = {
  truncate: "card and modal titles override the one-line utility (lessons §11)",
  "flex-1": "the manual unit head resets every child to flex: none, then restores flex-1",
  "overflow-auto": "scroll containers keep a stable gutter (motion.css)",
  "overflow-y-auto": "scroll containers keep a stable gutter (motion.css)",
};

describe("custom CSS class names", () => {
  it("never reuse a Tailwind utility name", async () => {
    const names = collectCustomClasses().filter((name) => !(name in INTENTIONAL_UTILITY_SELECTORS));
    const collisions = await findUtilityCollisions(names);
    // Fix: rename the class (this repo's fold is `.fold`, not `.collapse`).
    expect(collisions).toEqual([]);
  });

  it("detects a utility name and passes our own", async () => {
    expect(await findUtilityCollisions(["collapse", "fold"])).toEqual(["collapse"]);
  });
});

describe("eslint-disable comments", () => {
  it("always give a reason after `--`", () => {
    const problems = allSources.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /(?:\/\/|\/\*)\s*eslint-disable/.test(line) && !/eslint-disable[^\n]*\s--\s*\S/.test(line))
        .map(({ i }) => `${toKey(path)}:${i + 1}`),
    );
    // Fix: `// eslint-disable-next-line <rule> -- <why the rule does not apply here>`.
    expect(problems).toEqual([]);
  });
});
