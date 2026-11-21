// @vitest-environment node
/**
 * Source rules lint cannot express: the effect/timer budget, Tailwind display utilities doubled
 * on one element, custom CSS class names that Tailwind also generates, and eslint-disable reasons.
 * Plan: 2026-11-19-trust-foundation-plan.md (step 1).
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

// frontend/CLAUDE.md "one path" rules: each concern has one shared part, so a new screen cannot quietly grow a second one.
type PathRule = { name: string; pattern: RegExp; files: RegExp; allowed: Record<string, string>; fix: string };

const PATH_RULES: PathRule[] = [
  {
    name: "raw hex colors",
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    files: /\.css$/,
    allowed: { "src/styles/tokens.css": "the only home of raw colors; dark mode swaps tokens" },
    fix: "use a token from src/styles/tokens.css",
  },
  {
    name: "raw hex colors in code",
    pattern: /["'` ]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/,
    files: /\.tsx?$/,
    allowed: {},
    fix: "use a CSS variable token (var(--…)) instead of a hex string",
  },
  {
    name: "native <select>",
    pattern: /<select[\s>]/,
    files: /\.tsx$/,
    allowed: {},
    fix: "use components/ui/select.tsx Select (or Combobox)",
  },
  {
    name: "router.push",
    pattern: /\brouter\.push\(/,
    files: /\.tsx?$/,
    allowed: { "src/components/nav-host.tsx": "the shared navigation path (nav-buffer, leave guard)" },
    fix: "navigate with lib/nav-buffer.ts navigate() so the buffer and the unsaved-changes guard apply",
  },
  {
    name: "native checkbox",
    pattern: /type="checkbox"/,
    files: /\.tsx$/,
    allowed: {
      "src/components/ui/checkbox.tsx": "the shared Checkbox draws over a hidden native input",
      "src/components/paper/number-cell.tsx": "existing at the 2026-11-19 baseline; move to Checkbox in its own branch",
    },
    fix: "use components/ui/checkbox.tsx Checkbox",
  },
  {
    name: "dangerouslySetInnerHTML",
    pattern: /dangerouslySetInnerHTML/,
    files: /\.tsx$/,
    allowed: {
      "src/app/layout.tsx": "first-paint prefs boot script, a constant",
      "src/components/ui/markdown-view.tsx": "escapes the source first, then turns only formatting into tags",
    },
    fix: "render text as children, or Markdown through components/ui/markdown-view.tsx",
  },
  {
    name: "native title tooltip",
    pattern: /<[a-z][\w-]*\s[^>]*\btitle=/,
    files: /\.tsx$/,
    allowed: {},
    fix: "use components/ui/tooltip.tsx Tooltip (or useDelegatedTip for many marks)",
  },
];

describe("one path per concern", () => {
  const files = listFiles(SRC, /\.(tsx?|css)$/).filter((path) => !/\.test\.tsx?$/.test(path));

  it.each(PATH_RULES)("$name stays in its shared part", ({ pattern, files: only, allowed, fix }) => {
    const problems = files
      .filter((path) => only.test(path) && !(toKey(path) in allowed))
      .flatMap((path) =>
        stripComments(readFileSync(path, "utf8"))
          .split("\n")
          .flatMap((line, i) => (pattern.test(line) ? [`${toKey(path)}:${i + 1}`] : [])),
      );
    expect(problems, `Fix: ${fix}`).toEqual([]);
  });

  it("matches the bad forms it names", () => {
    const sample: Record<string, string> = {
      "raw hex colors": ".x { color: #1a2b3c; }",
      "raw hex colors in code": 'style={{ color: "#fff" }}',
      "native <select>": "<select value={v}>",
      "router.push": "router.push(`/bundles/${id}`)",
      "native checkbox": '<input type="checkbox" />',
      dangerouslySetInnerHTML: "<div dangerouslySetInnerHTML={{ __html: x }} />",
      "native title tooltip": '<span title="Delete">',
    };
    for (const rule of PATH_RULES) expect(rule.pattern.test(sample[rule.name]), rule.name).toBe(true);
    expect(PATH_RULES[6].pattern.test('<Tooltip title="Delete">')).toBe(false);
  });
});

describe("smoke scripts", () => {
  // 워크트리에는 backend/.venv가 없다 - 단계마다 venv를 찾으면 원본 체크아웃을 못 찾아 거짓 실패했다(2026-11-20)
  it("find the backend python only through findBackendPython", () => {
    const scripts = listFiles(join(FRONTEND, "scripts"), /\.mjs$/).filter((path) => !path.endsWith(join("smoke", "common.mjs")));
    const problems = scripts.filter((path) => /\.venv[/\\]|BACKEND_PYTHON \|\|/.test(stripComments(readFileSync(path, "utf8")))).map((path) => relative(FRONTEND, path));
    expect(problems, "Fix: import { findBackendPython } from ./smoke/common.mjs and call it - it falls back to the main checkout's backend/.venv").toEqual([]);
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
