// 여럿 고른 표시의 테(--accent 3px)가 용지 바탕과 제 칠(--accent-tint) 위에서 3:1 이상 읽히는지 - 토큰 파일의 oklch를 직접 sRGB로 바꿔 잰다
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];
type Lab = [number, number, number];

const TOKENS = readFileSync(join(__dirname, "tokens.css"), "utf8");
// 라이트는 첫 :root 블록, 다크는 :root[data-theme="dark"] 블록 - 다크에 없는 토큰은 라이트 값을 쓴다
const BLOCKS = { light: TOKENS.slice(TOKENS.indexOf(":root {"), TOKENS.indexOf(':root[data-theme="dark"]')), dark: TOKENS.slice(TOKENS.indexOf(':root[data-theme="dark"]')) };

function token(theme: "light" | "dark", name: string): string {
  for (const block of theme === "dark" ? [BLOCKS.dark, BLOCKS.light] : [BLOCKS.light]) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
    if (match) return match[1].trim();
  }
  throw new Error(`token ${name} not found in tokens.css (${theme})`);
}

function oklchToOklab(value: string): Lab {
  const [l, c, h] = /oklch\(([^)]+)\)/.exec(value)![1].split(/\s+/).map(Number);
  return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
}
function hexToOklab(hex: string): Lab {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((ch) => ch + ch).join("")}` : hex;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(full.slice(at, at + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function toOklab(value: string): Lab {
  return value.startsWith("#") ? hexToOklab(value) : oklchToOklab(value);
}
function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.min(1, Math.max(0, v))) as Rgb;
}
function luminance(lab: Lab): number {
  const [r, g, b] = oklabToLinear(lab);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(one: Lab, other: Lab): number {
  const [hi, lo] = [luminance(one), luminance(other)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** --accent-tint: color-mix(in oklab, var(--accent) 9%, var(--surface)) - tokens.css의 식과 같다 */
function mixTint(theme: "light" | "dark"): Lab {
  const accent = toOklab(token(theme, "--accent"));
  const surface = toOklab(token(theme, "--surface"));
  return [0, 1, 2].map((at) => accent[at] * 0.09 + surface[at] * 0.91) as Lab;
}

describe("the picked-together ring", () => {
  it("mixes the tint like tokens.css does", () => expect(token("light", "--accent-tint")).toBe("color-mix(in oklab, var(--accent) 9%, var(--surface))"));
  it.each(["light", "dark"] as const)("%s ring reads at 3:1 on the paper and on its own fill", (theme) => {
    const ring = toOklab(token(theme, "--accent"));
    expect(contrast(ring, toOklab(token(theme, "--paper")))).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, mixTint(theme))).toBeGreaterThanOrEqual(3);
  });
});

// 떨어진 짝 괄호선(11-23 명세 E1) - 안내 줄을 대신하는 유일한 표시라 1.5px 선이 둘레 바탕(용지 · 칸 · 화면)에서 비텍스트 3:1 이상이어야 한다.
// components.css의 .pair-bracket 선색을 그대로 읽는다 - color-mix 토큰이면 tokens.css의 식대로 섞는다
const COMPONENTS = readFileSync(join(__dirname, "components.css"), "utf8");

function resolveColor(theme: "light" | "dark", name: string): Lab {
  const value = token(theme, name);
  const mix = /color-mix\(in oklab, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)/.exec(value);
  if (!mix) return toOklab(value);
  const [one, other, share] = [resolveColor(theme, mix[1]), resolveColor(theme, mix[3]), Number(mix[2]) / 100];
  return [0, 1, 2].map((at) => one[at] * share + other[at] * (1 - share)) as Lab;
}

describe("the far pair bracket", () => {
  const stroke = /\.pair-bracket path \{[^}]*stroke: var\((--[\w-]+)\)/.exec(COMPONENTS)?.[1] ?? "";
  it("strokes with a token", () => expect(stroke).toMatch(/^--/));
  it.each(["light", "dark"] as const)("%s bracket line reads at 3:1 on the paper, the pane and the page", (theme) => {
    const line = resolveColor(theme, stroke);
    for (const ground of ["--paper", "--surface", "--bg"]) expect(contrast(line, toOklab(token(theme, ground))), `${stroke} on ${ground}`).toBeGreaterThanOrEqual(3);
  });
});
