// Shared parts of the SOP smoke: settings, check/runStep, browser, helpers used by more than one screen, and the setup step.
// Split from pw-smoke-sop.mjs (2026-11-19). Screen steps live in ./<screen>.mjs; the runner is ../pw-smoke-sop.mjs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";


export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = resolve(SCRIPT_DIR, "../../../backend");
export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const BASE = process.env.BASE_URL ?? "http://localhost:3777";
export const SHOT_DIR = resolve(SCRIPT_DIR, "../../../.shots");
export const T = 15000;
export const PREPARE = process.env.PREPARE === "1";
export const PREPARE_STEP = "assign: first entry classifies the remaining rows in the background";
// 지난 실행에서 실패한 단계 이름(.dev/는 git 밖) - ONLY_FAILED=1이면 그 단계만 다시 돈다.
// 하나 고치고 화면 전체(Assign은 수 분)를 다시 돌지 않게(2026-11-20~22 세션 기록: 스모크가 도구 시간의 38%, 실패 뒤 다시 돌기가 잦았다)
export const FAILED_FILE = resolve(SCRIPT_DIR, "../../../.dev/smoke-failed.txt");
const ONLY_FAILED = process.env.ONLY_FAILED === "1";

function readFailedSteps() {
  return existsSync(FAILED_FILE) ? readFileSync(FAILED_FILE, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : [];
}

function readOnly() {
  if (!ONLY_FAILED) return (process.env.ONLY ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const steps = readFailedSteps();
  if (steps.length === 0) {
    console.error(`ONLY_FAILED=1 but ${FAILED_FILE} lists no failed step (the last runs passed). Run the screen you changed instead: QUIET=1 ONLY="<screen>:" node scripts/pw-smoke-sop.mjs`);
    process.exit(2);
  }
  return steps;
}

export const ONLY = readOnly();

// 전부 돌리는 것은 정식 업데이트 전 · 공용 부품을 고쳤을 때만(사용자 결정 2026-11-16) - 규칙만으로는 ONLY 없는 실행이 이어져(11-20~22 세션 217번 중 71번) 실행기가 막는다
if (ONLY.length === 0 && !PREPARE && process.env.FULL !== "1") {
  console.error(
    'Pick what to run. One screen changed: QUIET=1 ONLY="<screen>:" (assign: · documents: · new documents: · order · outputs · map). ' +
      "Before dev→main, or after changing parts several screens share (common components, API layer, this runner): FULL=1.",
  );
  process.exit(2);
}
// 시안의 모든 수치는 1248 × 720 프레임 기준이다(디자인 문서 15절)
export const VIEWPORT = { width: 1248, height: 720 };

mkdirSync(SHOT_DIR, { recursive: true });

/** backend 파이썬(xlsx 읽기 · 합성 SOP 만들기) - BACKEND_PYTHON → 이 체크아웃의 backend/.venv → 원본 체크아웃(git common dir의 부모)의 backend/.venv.
 *  워크트리에는 venv가 없어, BACKEND_PYTHON을 빠뜨리면 xlsx 단계가 "file argument … undefined"로 거짓 실패했다(2026-11-20) */
export function findBackendPython() {
  if (process.env.BACKEND_PYTHON) return process.env.BACKEND_PYTHON;
  const findVenv = (root) => [".venv/bin/python", ".venv/Scripts/python.exe"].map((path) => resolve(root, "backend", path)).find(existsSync);
  const own = findVenv(resolve(BACKEND_DIR, ".."));
  if (own) return own;
  const common = String(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: SCRIPT_DIR })).trim();
  const main = findVenv(dirname(common));
  if (main) return main;
  throw new Error(`backend venv python not found in ${resolve(BACKEND_DIR, ".venv")} or ${resolve(dirname(common), "backend/.venv")}. Fix: in backend/ run python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt, or set BACKEND_PYTHON=<absolute path>`);
}

// 시드 지문 - scripts/dev-worktree.sh가 DB를 시드 스냅숏으로 되돌릴 때마다 묶음별 "updated_at#마지막 History 사건 id"를 여기에 적는다(.dev/는 git 밖).
// 판단 · 편집은 묶음 updated_at을 바꾸지 않아 사건 id가 필요하다
const SEED_FINGERPRINT = resolve(SCRIPT_DIR, "../../../.dev/seed-fingerprint.json");

/** 스모크는 시드 직후 DB를 전제한다 - 되돌린 뒤 무엇이든(앞선 스모크 · 화면 확인) 묶음을 바꿨으면 몇 분 뒤 거짓 실패 대신 처음에 멈춘다(B1 · B4에서 두 번, 2026-11-20).
 *  지문이 없거나(스크립트 없이 손으로 띄운 DB) 다른 BASE_URL의 지문이면 검사하지 않는다 */
export async function checkSeedFingerprint() {
  if (!existsSync(SEED_FINGERPRINT)) return;
  const saved = JSON.parse(readFileSync(SEED_FINGERPRINT, "utf8"));
  if (saved.base !== BASE) return;
  if (process.env.DIRTY_DB_OK === "1") {
    console.log("note: DIRTY_DB_OK=1 - running on a DB changed since the last seed reset");
    return;
  }
  const getJson = async (path) => {
    const response = await fetch(`${BASE}/api${path}`, { headers: { "X-Dev-User": "qa.member" } });
    if (!response.ok) throw new Error(`seed check: GET ${BASE}/api${path} → ${response.status}`);
    return response.json();
  };
  const now = {};
  for (const bundle of await getJson("/bundles")) {
    const events = await getJson(`/bundles/${bundle.id}/events?limit=1`);
    now[bundle.code] = `${bundle.updated_at}#${events[0]?.id ?? 0}`;
  }
  const changed = [...new Set([...Object.keys(saved.bundles), ...Object.keys(now)])].filter((code) => saved.bundles[code] !== now[code]);
  if (changed.length === 0) return;
  console.error(
    `The DB is no longer the fresh seed - changed since the last reset: ${changed.join(", ")}.\n` +
      "Fix: run scripts/dev-worktree.sh reset at the worktree root, then run the smoke again. To run on this DB anyway (e.g. re-running one step you are writing): DIRTY_DB_OK=1",
  );
  process.exit(2);
}

export const QUIET = process.env.QUIET === "1";
// 묶음 id를 잡아 두는 단계 - 뒤 단계가 모두 여기에 기댄다
export const SETUP_STEP = "bundle list";
export let failures = 0;
export let passes = 0;
let currentStep = null;
const ranSteps = new Set();
const failedSteps = new Set();
export const check = (name, ok, detail = "") => {
  if (ok) passes += 1;
  else {
    failures += 1;
    if (currentStep) failedSteps.add(currentStep);
  }
  if (ok && QUIET) return;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).replace(/\s+/g, " ").trim()}` : ""}`);
};

/** 첫 잇기 추천 카드의 New 문서를 New 칸에 연다 - New 칸은 Old 줄을 따라가지 않는다(1.2.0 피드백) */

export const browser = await chromium.launch({ executablePath: CHROME, headless: true });

export async function runStep(name, { devUser = "qa.member", storage = {}, allowConsoleErrors = false } = {}, run) {
  // ONLY_FAILED는 적어 둔 이름 그대로만 - 조각 맞추기면 이름이 겹치는 다른 단계까지 돈다
  const picked = ONLY_FAILED ? ONLY.includes(name) : ONLY.some((part) => name.includes(part));
  if (ONLY.length > 0 && name !== SETUP_STEP && !picked) return;
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
  currentStep = name;
  ranSteps.add(name);
  try {
    await run({ page, takeShot: (file) => page.screenshot({ path: resolve(SHOT_DIR, file) }) });
    if (!allowConsoleErrors) check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (err) {
    check(`${name}: completed`, false, err instanceof Error ? err.message : String(err));
  } finally {
    currentStep = null;
    await ctx.close();
  }
}

/** 실패한 단계 이름을 적는다 - 이번에 돈 단계는 결과로 바꾸고, 돌지 않은 단계의 지난 실패는 남긴다(다른 화면을 ONLY로 돌려도 지워지지 않게).
 *  ONLY_FAILED 실행은 적힌 이름을 모두 찾아봤으니 맞는 단계가 없던 이름(이름을 바꾼 단계)도 지운다 */
export function saveFailedSteps() {
  const earlier = ONLY_FAILED ? [] : readFailedSteps().filter((step) => !ranSteps.has(step));
  const steps = [...earlier, ...failedSteps];
  if (steps.length === 0) {
    rmSync(FAILED_FILE, { force: true });
    return;
  }
  mkdirSync(dirname(FAILED_FILE), { recursive: true });
  writeFileSync(FAILED_FILE, `${steps.join("\n")}\n`);
  const what = failedSteps.size > 0 ? `${failedSteps.size} failed step(s) saved` : `${earlier.length} step(s) that failed in an earlier run (not run this time) are still listed`;
  console.log(`\n${what} in ${FAILED_FILE}. After fixing: scripts/dev-worktree.sh reset (from the repo root), then QUIET=1 ONLY_FAILED=1 node scripts/pw-smoke-sop.mjs`);
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
