// Shared parts of the SOP smoke: settings, check/runStep, browser, helpers used by more than one screen, and the setup step.
// Split from pw-smoke-sop.mjs (2026-11-19). Screen steps live in ./<screen>.mjs; the runner is ../pw-smoke-sop.mjs.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";


export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const BASE = process.env.BASE_URL ?? "http://localhost:3777";
export const SHOT_DIR = resolve(SCRIPT_DIR, "../../../.shots");
export const T = 15000;
export const ONLY = (process.env.ONLY ?? "").split(",").map((part) => part.trim()).filter(Boolean);
export const PREPARE = process.env.PREPARE === "1";
export const PREPARE_STEP = "assign: first entry classifies the remaining rows in the background";
// 시안의 모든 수치는 1248 × 720 프레임 기준이다(디자인 문서 15절)
export const VIEWPORT = { width: 1248, height: 720 };

mkdirSync(SHOT_DIR, { recursive: true });

export const QUIET = process.env.QUIET === "1";
// 묶음 id를 잡아 두는 단계 - 뒤 단계가 모두 여기에 기댄다
export const SETUP_STEP = "bundle list";
export let failures = 0;
export let passes = 0;
export const check = (name, ok, detail = "") => {
  if (ok) passes += 1;
  else failures += 1;
  if (ok && QUIET) return;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).replace(/\s+/g, " ").trim()}` : ""}`);
};

/** 첫 잇기 추천 카드의 New 문서를 New 칸에 연다 - New 칸은 Old 줄을 따라가지 않는다(1.2.0 피드백) */

export const browser = await chromium.launch({ executablePath: CHROME, headless: true });

export async function runStep(name, { devUser = "qa.member", storage = {}, allowConsoleErrors = false } = {}, run) {
  if (ONLY.length > 0 && name !== SETUP_STEP && !ONLY.some((part) => name.includes(part))) return;
  // 미리 분류 시나리오는 PREPARE=1일 때만, 그때는 그것만(머리말)
  if (PREPARE !== (name === PREPARE_STEP)) return;
  if (!QUIET) console.log(`\n# ${name}`);
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await ctx.addInitScript(
    ({ loginId, extra }) => {
      if (location.protocol === "about:") return;
      if (!window.localStorage.getItem("sopa.devUser")) window.localStorage.setItem("sopa.devUser", loginId);
      for (const [key, value] of Object.entries(extra)) {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      }
    },
    { loginId: devUser, extra: storage },
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  // 개발 서버 전용 잡음 - 옛 주소를 넘기는 서버 컴포넌트(redirect)의 실행 시간을 React 개발 도구가 재다가 가끔 음수 시각으로 실패한다.
  // 빌드한 앱에는 없는 측정이라 화면 오류로 세지 않는다
  const isDevTimingNoise = (text) => text.includes("Failed to execute 'measure' on 'Performance'");
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isDevTimingNoise(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (!isDevTimingNoise(String(err))) consoleErrors.push(String(err));
  });
  try {
    await run({ page, takeShot: (file) => page.screenshot({ path: resolve(SHOT_DIR, file) }) });
    if (!allowConsoleErrors) check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (err) {
    check(`${name}: completed`, false, err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.close();
  }
}

export const wait = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().waitFor({ timeout: T });
export const getText = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().innerText();
export const getBox = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().boundingBox();
// 순서·문단번호 화면은 New 문서를 하나씩 연다 - 문서를 차례로 열어 probe가 값을 돌려주는 문서를 모은다([문서 id, 값]). limit만큼 찾으면 멈춘다
export async function findOrderDocs(page, probe, limit = 1) {
  await page.locator('[data-testid^="order-doc-"]').first().waitFor({ timeout: T });
  const docIds = await page.locator('[data-testid^="order-doc-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid").replace("order-doc-", "")));
  const found = [];
  for (const docId of docIds) {
    await page.locator(`[data-testid="order-doc-${docId}"]`).click();
    const value = await page.evaluate(probe);
    if (value !== null) found.push([docId, value]);
    if (found.length >= limit) break;
  }
  return found;
}

// --- Order 끌기 장면이 같이 쓰는 도우미 ---

// React 커밋 수 - 끄는 동안 다시 그리지 않는지 본다(G11). renderers·onScheduleFiberRoot는 개발 서버의 React Refresh가 읽는다
export async function installCommitCounter(page) {
  await page.addInitScript(() => {
    const renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      inject(internals) {
        renderers.set(renderers.size + 1, internals);
        return renderers.size;
      },
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onCommitFiberRoot() { window.__commits = (window.__commits ?? 0) + 1; },
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}
// 누르고 문턱을 넘긴 뒤 점들을 차례로 지나간다(사람처럼 여러 걸음)
export async function dragThrough(page, from, points) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 5 });
  for (const point of points) await page.mouse.move(point.x, point.y, { steps: 12 });
}

// --- 시나리오 ---

export let halfBundleId = null;
// 방금 올린 합성 묶음("쪼개기 직후") - 첫 단계가 찾아 두고 뒤 단계들이 쓴다
export let freshBundleId = null;
export const readToBe = async (page, bundleId) => (await page.request.get(`${BASE}/api/bundles/${bundleId}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();
export const WI_LIST_KEY = "document_relationships.work_instructions";
/** 그 SOP의 골격 항목 - 뺀 항목 제외, 서버 순서(부모 바로 뒤에 하위) */
export const readOutline = (tobe, code) => tobe.outline_items.filter((item) => item.code === code && !item.is_removed);
/** 이름 앞에 적는 번호 - 번호 없는 항목(범주 등)과 번호를 따로 적지 않는 항목(부록 - shows_number false)은 빈 글 */
export function findRemovableChapter(tobe, sop) {
  const tops = readOutline(tobe, sop.code).filter((item) => item.parent_key === null);
  const isWithin = (key, top) => key === top || key.startsWith(`${top}.`);
  const hasNa = (key) => tobe.na_slots.some((na) => na.code === sop.code && isWithin(na.slot_key, key));
  const held = (key) => (tobe.slot_counts ?? []).some((row) => row.target_doc_id === sop.id && isWithin(row.slot_key, key) && row.count + row.heading_count > 0);
  const index = tops.slice(0, -1).findIndex((item) => item.origin === "standard" && item.is_required && !hasNa(item.key) && !held(item.key));
  return index < 0 ? null : { target: tops[index], next: tops[index + 1] };
}
export const rowIds = async (page) => (await getText(page, "assign-row-id")).trim();

// --- 목차 블록(MD 1 F6) - 시드 7번 묶음 "SYNTHETIC 7 목차": 목차 스타일 줄 7(한글 4 · 영어 3)과 그 뒤 점 끌기 보통 줄 1이 목차로 잡히고 본문 4줄(띠 표 제목 줄 하나 포함) ---
export const TOC_TITLE = "SYNTHETIC 7 목차";
export const TOC_LINES = 8;

export async function findTocBundle(page) {
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers: { "X-Dev-User": "qa.member" } })).json();
  return bundles.find((bundle) => bundle.title === TOC_TITLE) ?? null;
}
export const readStyle = (locator, prop) => locator.evaluate((el, name) => getComputedStyle(el)[name], prop);

// Setup step: finds the seed bundles every screen uses (always runs, even with ONLY).
export async function runSetup() {

await runStep("bundle list", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const rows = page.locator('[data-testid^="bundles-row-"]');
  check("seeded bundles are listed", (await rows.count()) >= 3, String(await rows.count()));
  const text = await getText(page, "bundles-list");
  check("status labels are English", text.includes("In progress") && text.includes("In review"), text);
  check("role is shown", text.includes("Author"), text);
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  halfBundleId = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  // ONLY로 고른 단계(Assign 등)도 쓰니 이 단계에서 잡는다
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  freshBundleId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const listApi = await page.request.get(`${BASE}/api/bundles`, { headers: { "X-Dev-User": "qa.member" } });
  const listed = (await listApi.json()).find((bundle) => bundle.id === halfBundleId);
  check("half-classified row shows confirmed / total rows", (await getText(page, `bundles-confirmed-${halfBundleId}`)).includes(`/ ${listed.progress.total}`), String(listed.progress.total));
  check("no stage nav outside a bundle", (await page.locator('[data-testid="stage-nav"]').count()) === 0);
  check("synthetic bundles are marked in the list", (await page.locator(`[data-testid="bundles-synthetic-${halfBundleId}"]`).count()) === 1);
  await takeShot("sop-bundle-list.png");
});
}
