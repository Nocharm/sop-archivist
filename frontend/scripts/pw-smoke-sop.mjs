// SOP 화면 스모크(Playwright + 시스템 Chrome) - 묶음 목록, 개요, 단계 이동(레일·상단 탭), 배치 메뉴, 첫 페인트 전 설정.
// 전제: backend/에서 reset_db → seed_sop_demo(합성 묶음 4개) 직후, backend 8777 + frontend 3777. 고친 값은 시나리오 안에서 되돌린다.
// AI 나눔 확정 시나리오는 backend가 AI를 켜고 가짜 AI(FAKE_AI_SPLIT=1 node scripts/fake-ai-server.mjs)를 볼 때만 돈다 - 꺼져 있으면 건너뛴다.
// 실행(frontend/ 에서): node scripts/pw-smoke-sop.mjs   환경 변수: BASE_URL, CHROME_PATH
// playwright-core는 저장소 의존성이 아니다: `npm i --no-save playwright-core` (package.json 불변)
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const SHOT_DIR = resolve(SCRIPT_DIR, "../../.shots");
const T = 15000;
// 시안의 모든 수치는 1248 × 720 프레임 기준이다(디자인 문서 15절)
const VIEWPORT = { width: 1248, height: 720 };

mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).replace(/\s+/g, " ").trim()}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function runStep(name, { devUser = "qa.member", storage = {}, allowConsoleErrors = false } = {}, run) {
  console.log(`\n# ${name}`);
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
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await run({ page, takeShot: (file) => page.screenshot({ path: resolve(SHOT_DIR, file) }) });
    if (!allowConsoleErrors) check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (err) {
    check(`${name}: completed`, false, err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.close();
  }
}

const wait = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().waitFor({ timeout: T });
const getText = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().innerText();
const getBox = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().boundingBox();

// --- 시나리오 ---

let halfBundleId = null;

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
  check("half-classified row shows KO 21 / 45", (await getText(page, `bundles-ko-${halfBundleId}`)).includes("21 / 45"));
  check("no stage nav outside a bundle", (await page.locator('[data-testid="stage-nav"]').count()) === 0);
  check("synthetic bundles are marked in the list", (await page.locator(`[data-testid="bundles-synthetic-${halfBundleId}"]`).count()) === 1);
  await takeShot("sop-bundle-list.png");
});

await runStep("overview in rail", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-gate-units");
  check("top bar shows the bundle title", (await getText(page, "top-bar-bundle-title")).includes("분류 절반"));
  check("synthetic mark in the top bar", (await page.locator('[data-testid="top-bar-synthetic"]').count()) === 1);
  check("next action is deciding units", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "decide_units");
  check("KO rate 47%", (await getText(page, "overview-rate-ko")).includes("47"), await getText(page, "overview-rate-ko"));
  check("units gate is open", (await page.locator('[data-testid="overview-gate-units"]').getAttribute("data-ok")) === null);
  check("request review is disabled", await page.locator('[data-testid="overview-request-review"]').isDisabled());
  const overview = page.locator('[data-testid="stage-nav-overview"]');
  check("overview is the current step", (await overview.getAttribute("aria-current")) === "page");
  const navBox = await getBox(page, "stage-nav");
  check("rail is 72px wide", Math.round(navBox.width) === 72, JSON.stringify(navBox));
  const barBox = await getBox(page, "top-bar");
  check("top bar is 44px", Math.round(barBox.height) === 44, JSON.stringify(barBox));
  await takeShot("sop-overview-rail.png");
});

await runStep("layout menu switches to top tabs and keeps it", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-gate-units");
  // 레이아웃은 사용자 메뉴 안의 하위 메뉴다(2026-11-09 개편)
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="user-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc returns focus to the user button", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "top-bar-user"));
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-layout"]').hover();
  await wait(page, "user-menu-layout-flyout");
  check("layout flyout opens on hover", true);
  await page.locator('[data-testid="layout-menu-shell-bar"]').click();
  const navBox = await getBox(page, "stage-nav");
  check("top tabs span the width", navBox.width > 1000 && Math.round(navBox.height) === 39, JSON.stringify(navBox));
  await page.mouse.click(600, 600);
  await page.locator('[data-testid="user-menu"]').waitFor({ state: "detached", timeout: T });
  await takeShot("sop-overview-bar.png");
  // 새로 열 때 첫 HTML 파싱 직후(React 전)에 이미 상단 탭이어야 한다
  await page.goto(`${BASE}/bundles/${halfBundleId}`, { waitUntil: "commit" });
  const early = await page.evaluate(
    () =>
      new Promise((done) => {
        if (document.readyState !== "loading") done(document.documentElement.getAttribute("data-shell"));
        else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.getAttribute("data-shell")), { once: true });
      }),
  );
  check("stored layout applies before the app mounts", early === "bar", String(early));
});

await runStep("Korean before first paint", { storage: { "sopa.lang": "ko" } }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  const lang = await page.evaluate(
    () =>
      new Promise((done) => {
        if (document.readyState !== "loading") done(document.documentElement.lang);
        else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.lang), { once: true });
      }),
  );
  check("html lang is ko before mount", lang === "ko", String(lang));
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const text = await getText(page, "bundles-list");
  check("columns are Korean, statuses stay English", text.includes("제목") && text.includes("In progress"), text);
  await takeShot("sop-bundle-list-ko.png");
});

await runStep("reviewer sees the bundle in review", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  await review.locator("a").click();
  await wait(page, "overview-next");
  check("waiting for review", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "await_review");
  check("role tag reads Reviewer", (await getText(page, "overview-role")).includes("Reviewer"));
});

await runStep("documents list, inline edit and delete prompt", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="documents-"]').first().waitFor({ timeout: T });
  check("documents is the current step", (await page.locator('[data-testid="stage-nav-documents"]').getAttribute("aria-current")) === "page");
  const list = await getText(page, "documents-list");
  // 정상 상태는 글자 없이 아이콘(aria-label "Ready"/"Checked", data-state="ok"), 예외만 글자 알약
  const okStatus = page.locator('[data-testid^="documents-"][data-testid$="-status"][data-state="ok"]').first();
  check("extraction status icon reads Ready", (await okStatus.getAttribute("aria-label")) === "Ready");
  const okAux = page.locator('[data-testid^="documents-"][data-testid$="-aux"][data-state="ok"]');
  check("aux check label", (await okAux.count()) > 0 ? (await okAux.first().getAttribute("aria-label")) === "Checked" : list.includes("Aux check unavailable"), list);
  const firstRow = page.locator('[data-testid$="-row"][data-testid^="documents-"]').first();
  const docId = (await firstRow.getAttribute("data-testid")).replace("documents-", "").replace("-row", "");
  // 버전 칸 - 숫자와 점만 받고, 위 단추는 소수점 아래가 0이면 앞자리를 올린다
  const version = page.locator(`[data-testid="documents-${docId}-version"]`);
  const before = await version.inputValue();
  const rowY = (await firstRow.boundingBox()).y;
  await version.fill("v2.9a");
  check("version keeps only digits and a dot", (await version.inputValue()) === "2.9", await version.inputValue());
  await version.press("Enter");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator(`[data-testid="documents-${docId}-version-up"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === "2.10", docId, { timeout: T });
  check("version up moves the minor number", true);
  check("row did not move while editing", Math.abs((await firstRow.boundingBox()).y - rowY) < 1);
  await takeShot("sop-documents.png");
  // 되돌린다 - 원래 빈 값이면 x로 비운다
  await firstRow.hover();
  if (before === "") await page.locator(`[data-testid="documents-${docId}-version-clear"]`).click();
  else {
    await version.fill(before);
    await version.press("Enter");
  }
  await page.waitForFunction(([id, value]) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === value, [docId, before], { timeout: T });
  await page.locator(`[data-testid="documents-${docId}-delete"]`).click();
  await wait(page, "delete-document");
  await takeShot("sop-documents-delete.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="delete-document"]').waitFor({ state: "detached", timeout: T });
  check("delete prompt closes with Esc", true);
});

await runStep("split: select, cut, split, undo, check boundary", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/split`);
  const units = page.locator('[data-testid^="split-paper-unit-"].su');
  await units.first().waitFor({ timeout: T });
  const before = await units.count();
  // Unit마다 종이 조각 하나 - 확인하기 전부터 나뉘어 있고, 글 조각 사이에는 늘 합치기가 있다
  const pieces = page.locator('[data-testid^="split-paper-piece-"].strip');
  check("every unit is its own piece from the start", (await pieces.count()) > 10 && (await page.locator('[data-testid^="split-paper-mark-checked-"]').count()) === 0, String(await pieces.count()));
  check("merge controls sit between text pieces", (await page.locator('.strip-gap [data-testid^="split-paper-merge-"]').count()) > 5);
  // 절 번호는 앞머리 번호 칸에 한 번만 - 머리 줄 글 앞의 같은 번호는 그리지 않고(표시만) 첫 글자 조각의 data-start가 그만큼 밀린다
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="split-paper-num-"]')].map((num) => {
      const id = num.getAttribute("data-testid").replace("split-paper-num-", "");
      const first = document.querySelector(`[data-testid="split-paper-piece-${id}"] .su [data-start]`);
      return { number: num.textContent.trim(), text: first?.textContent.trim() ?? "", start: Number(first?.getAttribute("data-start") ?? 0) };
    }),
  );
  const doubled = heads.filter((head) => head.text.startsWith(head.number));
  check("head rows do not repeat their section number", heads.length > 0 && doubled.length === 0, doubled.map((head) => `${head.number}|${head.text.slice(0, 20)}`).join(", "));
  check("a head row hides its leading number", heads.some((head) => head.start > 0), String(heads.length));
  // 영어 문장 하나를 찾아 고른다 - 한 번 더 누르면 아무것도 안 하고, 두 번 누르기(더블클릭)가 나눌 선을 만든다
  const target = page.locator('[data-testid^="split-paper-unit-"].su[lang="en"]', { hasText: " " }).nth(2);
  const unitId = (await target.getAttribute("data-testid")).replace("split-paper-unit-", "");
  await target.click();
  check("first click selects", (await target.getAttribute("data-sel")) === "");
  check("first click shows the check under the unit", (await page.locator('[data-testid^="split-act-check-"]').count()) === 1);
  // 윤곽은 다음 프레임에 재서 그리므로 바로 세면 0일 수 있다 - 그려질 때까지 기다린다
  await page.locator(".sel-contour path").first().waitFor({ timeout: T });
  check("selection is drawn as one contour", (await page.locator(".sel-contour path").count()) === 1);
  const primary = page.locator('[data-testid="split-primary"]');
  const primaryBox = await primary.boundingBox();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
  await page.waitForTimeout(300);
  check("a second single click does not cut", (await page.locator(`[data-testid="split-paper-unit-${unitId}"][data-cut]`).count()) === 0);
  // 고른 조각 곁 틈이 늦게 벌어지며 조각이 밀리니, 벌어진 뒤 자리를 다시 잰다
  await page.waitForTimeout(700);
  const settled = await target.boundingBox();
  await page.mouse.dblclick(settled.x + Math.min(settled.width / 2, 120), settled.y + settled.height / 2);
  await page.locator(`[data-testid="split-paper-unit-${unitId}"][data-cut]`).waitFor({ timeout: T });
  check("double-click draws the cut with the split popup", (await page.locator('[data-testid="split-cut-run"]').count()) === 1);
  await takeShot("sop-split-cut.png");
  await page.keyboard.press("s");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-unit-"].su').length === n + 1, before, { timeout: T });
  check("S splits into two units", true);
  const after = await primary.boundingBox();
  check("primary button stays in place", Math.abs(after.y - primaryBox.y) < 1 && Math.abs(after.width - primaryBox.width) < 1);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-unit-"].su').length === n, before, { timeout: T });
  check("Ctrl+Z undoes the split", true);
  // 나눈 뒤 사이의 합치기를 누르면 원래 한 조각으로 돌아온다. 나누기 팝업은 잠깐 뒤에 뜬다
  const targetText = (await target.innerText()).trim();
  await page.waitForTimeout(700);
  const again = await target.boundingBox();
  await page.mouse.dblclick(again.x + Math.min(again.width / 2, 120), again.y + again.height / 2);
  const cutRun = page.locator('[data-testid="split-cut-run"]');
  await cutRun.waitFor({ timeout: T });
  check("the cut can be dragged", (await page.locator('[data-testid="split-paper-cut-handle"]').count()) === 1);
  await page.waitForTimeout(700);
  const piecesBefore = await pieces.count();
  await cutRun.click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-piece-"].strip').length === n + 1, piecesBefore, { timeout: T });
  check("a split unit becomes two pieces at once", true);
  const selectedId = await page.locator('[data-testid^="split-paper-unit-"].su[data-sel]').first().getAttribute("data-testid");
  const mergeBack = page.locator(`[data-testid^="split-paper-merge-${selectedId.replace("split-paper-unit-", "")}-"], [data-testid^="split-paper-merge-"][data-testid$="-${selectedId.replace("split-paper-unit-", "")}"]`).and(page.locator(':not([aria-disabled="true"])'));
  // 나눈 뒤 고른 조각 아래 단추 줄이 펼쳐지며(Collapse appear) 바로 아래 틈을 33px 밀어 내린다 - 펼쳐지기 전에 올리면 틈이 포인터 밑에서 빠져나가
  // 머묾(--gap-open-delay)이 끊기므로, 다 펼쳐진 뒤에 올린다
  await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts !== null && acts.getAnimations().length === 0; }, null, { timeout: T });
  // 틈의 합치기는 포인터가 틈에 머물러 단추가 나타난 뒤에야 눌린다(사람처럼 틈에 올렸다가 누른다)
  await page.locator(".strip-gap", { has: mergeBack.first() }).hover({ position: { x: 300, y: 2 } });
  await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
  await mergeBack.first().click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-piece-"].strip').length === n, piecesBefore, { timeout: T });
  check("merging the two pieces gives the unit back", (await page.locator('[data-testid^="split-paper-unit-"].su', { hasText: targetText }).count()) >= 1, targetText.slice(0, 30));
  const first = units.first();
  await first.click();
  const firstId = (await first.getAttribute("data-testid")).replace("split-paper-unit-", "");
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => document.querySelector('[data-testid="split-unit-id"]')?.textContent && !document.querySelector(`[data-testid="split-paper-unit-${id}"][data-sel]`), firstId, { timeout: T });
  check("Enter checks and moves to the next unit", true);
  await page.keyboard.press("k");
  await page.locator(`[data-testid="split-paper-unit-${firstId}"][data-sel]`).waitFor({ timeout: T });
  check("K goes back", (await getText(page, "split-boundary-state")).includes("Checked"), await getText(page, "split-boundary-state"));
  await page.keyboard.press("u");
  await page.waitForFunction(() => document.querySelector('[data-testid="split-boundary-state"]')?.textContent?.includes("Not checked"), null, { timeout: T });
  check("U unchecks", true);
  await takeShot("sop-split.png");
  // 남은 경계 - 문서마다 수가 보이고, Check the rest가 지금 문서의 나머지를 한 번에 확인한다
  const left = await getText(page, "split-unchecked-count");
  check("the remaining boundaries are counted", /^\d+ left to check$/.test(left.trim()), left);
  const docLeft = page.locator('[data-testid^="split-doc-left-"]');
  check("every document shows what is left", (await docLeft.count()) >= 1 && /\d/.test(await docLeft.first().innerText()), String(await docLeft.count()));
  await page.locator('[data-testid="split-check-rest"]').click();
  await wait(page, "split-check-rest-modal");
  const modalBox = await page.locator('[data-testid="split-check-rest-modal"]').boundingBox();
  check("confirm windows are narrow", modalBox.width <= 384, String(modalBox.width));
  await takeShot("sop-split-check-rest.png");
  await page.locator('[data-testid="split-check-rest-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="split-unchecked-count"]')?.textContent?.includes("All boundaries checked"), null, { timeout: T });
  check("Check the rest checks every remaining boundary", true);
  check("the button leaves when nothing is left", (await page.locator('[data-testid="split-check-rest"]').count()) === 0);
  await page.goto(`${BASE}/bundles/${freshId}/history`);
  await page.waitForFunction(() => document.body.textContent?.includes("Checked all remaining boundaries"), null, { timeout: T });
  check("history records the bulk check", true);
  // 다른 문서의 경계가 남아 있어 다음 할 일은 여전히 경계 확인이고 검토 요청 조건도 열려 있다
  await page.goto(`${BASE}/bundles/${freshId}`);
  await wait(page, "overview-gate-boundaries");
  check("next action is checking boundaries", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "check_boundaries");
  check("boundaries gate is open", (await page.locator('[data-testid="overview-gate-boundaries"]').getAttribute("data-ok")) === null);
});

await runStep("split: per-sentence AI split, whole-document request, tab stack", {}, async ({ page, takeShot }) => {
  const status = await page.request.get(`${BASE}/api/bundles/1/ai/status`, { headers: { "X-Dev-User": "qa.member" } });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/split`);
  const units = page.locator('[data-testid^="split-paper-unit-"].su');
  await units.first().waitFor({ timeout: T });
  check("the whole-document button says so", (await getText(page, "split-ai-request")).includes("whole document"));
  const long = units.filter({ hasText: /\S{3,}.{40,}/ }).first();
  const unitId = (await long.getAttribute("data-testid")).replace("split-paper-unit-", "");
  await long.click();
  await wait(page, "split-ai-unit");
  check("the right panel offers AI split for this sentence", (await page.locator('[data-testid="split-ai-unit"]').isEnabled()));
  await page.locator('[data-testid="split-ai-unit"]').click();
  const tab = page.locator(`[data-testid="split-ai-tab-${unitId}"]`);
  await tab.waitFor({ timeout: 30000 });
  check("a tab for that sentence appears without a reload", true);
  check("a single request is not marked as a whole-document result", (await tab.getAttribute("data-batch")) === null);
  check("the selected sentence's tab is already seen", (await tab.getAttribute("data-unseen")) === null);
  check("the button is off while the sentence has a suggestion", await page.locator('[data-testid="split-ai-unit"]').isDisabled());
  // 일괄 요청 - 여러 탭이 쌓이고 머리에 일괄 표시가 붙는다
  await page.locator('[data-testid="split-ai-request"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="split-ai-tab-"][data-batch="true"]').length >= 2, null, { timeout: 40000 });
  check("whole-document results stack as batch tabs", true);
  check("the header counts the whole-document results", /Whole document · \d+ left/.test(await getText(page, "split-ai-batch-head")));
  const unseen = page.locator('[data-testid^="split-ai-tab-"][data-unseen="true"]').first();
  const unseenId = (await unseen.getAttribute("data-testid")).replace("split-ai-tab-", "");
  await unseen.click();
  await page.locator(`[data-testid="split-paper-unit-${unseenId}"][data-sel]`).waitFor({ timeout: T });
  check("a tab selects its sentence", true);
  check("opening a tab clears its dot", (await page.locator(`[data-testid="split-ai-tab-${unseenId}"]`).getAttribute("data-unseen")) === null);
  await wait(page, "split-ai-suggestion");
  await takeShot("v014-task7-tabs.png");
  // 단일 요청의 제안을 적용하면 탭이 빠지고 조각이 늘며, 되돌리면 돌아온다
  await page.locator(`[data-testid="split-ai-tab-${unitId}"]`).click();
  const before = await units.count();
  await page.locator('[data-testid="split-ai-apply"]').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-unit-"].su').length > n, before, { timeout: T });
  check("apply splits the sentence", true);
  await page.locator(`[data-testid="split-ai-tab-${unitId}"]`).waitFor({ state: "detached", timeout: T });
  check("the applied tab leaves the stack", true);
  await page.keyboard.press("Control+z");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="split-paper-unit-"].su').length === n, before, { timeout: T });
  check("Ctrl+Z undoes the AI split", true);
});

// 일부러 거절당하는 저장이 있어 콘솔 오류를 허용한다
await runStep("to-be: nested rows, N/A detail, edit and save", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/tobe`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-"]').first().waitFor({ timeout: T });
  const codes = await page.locator('[data-testid$="-code"][data-testid^="tobe-"]').evaluateAll((els) => els.map((el) => el.value));
  check("SOP first, its WIs under it", codes[0] === "SOP-CF" && codes.slice(1).every((code) => code.startsWith("WI-")), codes.join(","));
  check("save is off until something changes", await page.locator('[data-testid="tobe-save"]').isDisabled());
  const sopRow = page.locator('[data-testid$="-row"][data-testid^="tobe-"]').first();
  const sopKey = (await sopRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${sopKey}-toggle"]`).click();
  check("troubleshooting is N/A with its reason", await page.locator(`[data-testid="tobe-${sopKey}-na-procedures.troubleshooting"]`).isChecked());
  await takeShot("sop-tobe.png");
  const title = page.locator(`[data-testid="tobe-${sopKey}-title"]`);
  const before = await title.inputValue();
  await title.fill(`${before} (edited)`);
  await wait(page, "tobe-dirty");
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
  check("saved and clean again", (await title.inputValue()) === `${before} (edited)`);
  await title.fill(before);
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
  // 잘못된 줄 - 부모 없는 WI는 서버가 거절하고 사람 말로 보인다
  await page.locator('[data-testid="tobe-add"]').click();
  const newCode = page.locator('[data-testid^="tobe-new-"][data-testid$="-code"]');
  await newCode.fill("WI-99");
  const newKey = (await newCode.getAttribute("data-testid")).replace("tobe-", "").replace("-code", "");
  // 값 고르기는 기본 <select>가 아니다 - 트리거를 누르고 "없음" 항목을 누른다
  await page.locator(`[data-testid="tobe-${newKey}-parent"]`).click();
  await page.locator(`[data-testid="tobe-${newKey}-parent-option-none"]`).click();
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("server rejection reads as a sentence", (await getText(page, "toast-error")).includes("WI-99"), await getText(page, "toast-error"));
  await page.locator('[data-testid="tobe-discard"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
});

// 검토 v0.4.0: 앞 단계를 지워도 뒤 단계 번호가 그대로여야 한다(분류한 문장이 단계 번호를 가리킨다), 저장 안 한 편집은 나갈 때 묻는다
await runStep("to-be: removing a step keeps the other numbers, leaving asks first", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/tobe`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-"]').first().waitFor({ timeout: T });
  const wiRow = page.locator('[data-testid$="-row"][data-testid^="tobe-"]').nth(1);
  const wiKey = (await wiRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  await wait(page, `tobe-${wiKey}-add-step`);
  const readNumbers = async () =>
    (await page.locator(`[data-testid^="tobe-${wiKey}-step-"]`).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))).map((id) => Number(id.split("-step-")[1]));
  const before = await readNumbers();
  const top = Math.max(0, ...before);
  await page.locator(`[data-testid="tobe-${wiKey}-add-step"]`).click();
  await page.locator(`[data-testid="tobe-${wiKey}-add-step"]`).click();
  await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 1}"]`).fill("Smoke step A");
  await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).fill("Smoke step B");
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
  await page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 1}"]`).click();
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
  const after = await readNumbers();
  check("the later step keeps its number after an earlier one is removed", after.includes(top + 2) && !after.includes(top + 1), after.join(","));
  check("its title stays with its number", (await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).inputValue()) === "Smoke step B");
  check("the steps that were there are untouched", before.every((no) => after.includes(no)), `${before} -> ${after}`);

  // 저장 안 한 편집 - 단계 링크를 누르면 먼저 묻는다
  await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).fill("Smoke step B (unsaved)");
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await wait(page, "tobe-leave");
  check("leaving with unsaved edits asks first", page.url().endsWith("/tobe"));
  await page.locator('[data-testid="tobe-leave-cancel"]').click();
  check("cancel stays on To-Be with the edit", (await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).inputValue()) === "Smoke step B (unsaved)");
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await page.locator('[data-testid="tobe-leave-confirm"]').click();
  await page.waitForURL(/\/assign$/, { timeout: T });
  check("confirm discards and leaves", true);

  // 되돌리기
  await page.goto(`${BASE}/bundles/${halfBundleId}/tobe`);
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  await page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 2}"]`).click();
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
  check("restored the step list", (await readNumbers()).join(",") === before.join(","));
});

// Assign(v0.10.0) - Old 원문 조각이 곧 목록이다. 줄은 ↑↓·J/K로 옮기고, 지금 줄은 오른쪽 머리(assign-row-id·assign-row-status)로 읽는다
// 상태 칩은 대문자를 CSS(text-transform)로만 그린다 - innerText는 대문자가 되니 DOM 글자(textContent)로 읽는다
const rowStatus = async (page) => ((await page.locator('[data-testid="assign-row-status"]').first().textContent()) ?? "").trim();
const rowIds = async (page) => (await getText(page, "assign-row-id")).trim();
async function selectRowById(page, id) {
  await page.locator('[data-testid="assign-filter-all"]').click();
  // ↓로 끝까지, 못 찾으면 ↑로 처음까지 - 지금 줄이 어디든 한 번은 지난다
  for (const key of ["j", "k"]) {
    let last = "";
    for (let step = 0; step < 400; step += 1) {
      await page.keyboard.press(key);
      await page.locator('[data-testid="assign-row-id"]').waitFor({ timeout: T });
      const ids = await rowIds(page);
      if (ids.includes(id)) return;
      if (ids === last) break;
      last = ids;
    }
  }
  throw new Error(`row ${id} not reached`);
}
async function pickFirstPlace(page) {
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator('[data-testid^="assign-tree-p"]').first().click();
  await page.locator('[data-testid^="assign-tree-place-"]:not([disabled])').first().click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
}
const progressDone = async (page) => Number((await getText(page, "assign-progress")).split("/")[0]);
let freshBundleId = null;

await runStep("assign: legend first, place, delete with reason, edit, clear, bulk", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  check("help panel sits at the bottom of the inspector, folded by default", (await page.locator('[data-testid="assign-inspector"] [data-testid="assign-help"]').count()) === 1 && (await page.locator('[data-testid="assign-help-toggle"]').getAttribute("aria-expanded")) === "false");
  await page.locator('[data-testid="assign-help-toggle"]').click();
  check("help keys tab lists shortcuts", (await page.locator('[data-testid="assign-help-keys"] kbd').count()) >= 8);
  await page.locator('[data-testid="assign-help-tab-marks"]').click();
  check("help marks tab lists marks", (await page.locator('[data-testid="assign-help-marks"] .help-panel-row').count()) >= 10);
  await page.reload();
  await wait(page, "assign-pick-prompt");
  check("help open state and tab are remembered", (await page.locator('[data-testid="assign-help-toggle"]').getAttribute("aria-expanded")) === "true" && (await page.locator('[data-testid="assign-help-tab-marks"]').getAttribute("aria-selected")) === "true");
  // 첫 진입은 All - 용지 전부, 접힘 없음(2026-11-12)
  check("All filter first, nothing folded", (await page.locator('[data-testid="assign-filter-all"]').getAttribute("aria-selected")) === "true" && (await page.locator('[data-testid^="assign-paper-fold-run-"]').count()) === 0);
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  check("J picks the first open unit", (await rowStatus(page)) === "Unassigned", await rowStatus(page));
  check("help panel stays while a unit is picked", (await page.locator('[data-testid="assign-help"]').count()) === 1);
  const firstIds = await rowIds(page);
  const before = await progressDone(page);
  await pickFirstPlace(page);
  await takeShot("sop-assign-chosen.png");
  await page.locator('[data-testid="assign-primary"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 1, before, { timeout: T });
  check("Enter-path confirm moves on to the next unit", (await rowIds(page)) !== firstIds);
  // 삭제는 사유가 있어야 한다
  await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  await page.locator('[data-testid="assign-primary"]').click();
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("delete without a reason is refused", true);
  await page.locator('[data-testid="assign-reason"]').fill("Structural heading");
  await page.locator('[data-testid="assign-primary"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 2, before, { timeout: T });
  check("delete with a reason confirms", true);
  // 고쳐 확정 - E로 새 문장을 고치면 변경 종류를 고른다
  await pickFirstPlace(page);
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="assign-text-"]').first();
  await textarea.fill("Smoke: rewritten sentence");
  await page.locator('[data-testid^="assign-slot-change-"]').first().waitFor({ timeout: T });
  check("an edited sentence asks for a change type", true);
  await page.keyboard.press("Escape");
  // 비우기
  await selectRowById(page, firstIds.split(" · ")[0]);
  check("the first unit is confirmed", (await rowStatus(page)) === "Confirmed", await rowStatus(page));
  await page.keyboard.press("u");
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Unassigned"), null, { timeout: T });
  check("U clears the unit", true);
  // 일괄 - Shift+클릭으로 여럿(All이라 용지 전부 - 필터를 걸면 맞지 않는 조각은 접힌다)
  await page.locator('[data-testid="assign-filter-all"]').click();
  const units = page.locator('[data-testid^="assign-paper-unit-"]');
  await units.nth(4).click({ modifiers: ["Shift"] });
  await units.nth(6).click({ modifiers: ["Shift"] });
  await wait(page, "assign-bulk");
  await page.locator('[data-testid="assign-bulk-delete"]').click();
  await page.locator('[data-testid="assign-bulk-reason"]').fill("Header text");
  await page.locator('[data-testid="assign-bulk-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("bulk delete with Shift+click", true);
  await takeShot("sop-assign.png");
});

await runStep("split: H holds a unit without a destination", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  freshBundleId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshBundleId}/split`);
  const unit = page.locator('[data-testid^="split-paper-unit-"]:not(.ptbl-cap)').nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  const heldId = await getText(page, "split-unit-id");
  await page.keyboard.press("h");
  await wait(page, "split-hold-modal");
  check("hold needs a reason", await page.locator('[data-testid="split-hold-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="split-hold-reason"]').fill("Smoke: not sure where it goes");
  await page.locator('[data-testid="split-hold-modal-confirm"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((el) => el.textContent?.includes("Held")), null, { timeout: T });
  check("H holds the unit", true);
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, heldId.trim());
  await page.waitForLoadState("networkidle");
  check("held unit shows on Assign with its reason", (await page.locator('[data-testid="assign-reason"]').inputValue()) === "Smoke: not sure where it goes");
  check("it has no destination", (await page.locator('[data-testid="assign-chosen"].is-empty').count()) === 1);
  // 저장된 사유를 지우면 빈 채로 남는다
  await page.locator('[data-testid="assign-reason"]').fill("");
  check("a cleared reason stays empty", (await page.locator('[data-testid="assign-reason"]').inputValue()) === "");
});

await runStep("split: right-click menu shows reasons for blocked actions and runs an enabled one", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/split`);
  const units = page.locator('[data-testid^="split-paper-unit-"]:not(.ptbl-cap)');
  await units.nth(9).waitFor({ timeout: T });
  const first = units.nth(4);
  await first.click();
  // 고른 채 먼 문장을 우클릭 - 두 문장 메뉴
  await units.nth(9).click({ button: "right" });
  await wait(page, "split-menu");
  check("right-click opens the two-sentence menu", (await page.locator('[data-testid^="split-menu-"]').count()) === 4, String(await page.locator('[data-testid^="split-menu-"]').count()));
  const merge = page.locator('[data-testid="split-menu-merge"]');
  check("merge is disabled for non-neighbours", (await merge.getAttribute("aria-disabled")) === "true");
  await merge.hover();
  await page.locator('[data-testid="paper-tip"]').waitFor({ timeout: T });
  check("hovering a disabled item shows why", ((await page.locator('[data-testid="paper-tip"]').innerText()) ?? "").length > 0, await page.locator('[data-testid="paper-tip"]').innerText());
  await takeShot("sop-split-menu.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="split-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc closes the menu", true);
  // 고른 문장 자신을 우클릭 - 한 문장 메뉴, 경계 확인이 바로 된다
  await first.click({ button: "right" });
  await wait(page, "split-menu-check");
  check("right-click on the selected sentence lists the single actions", (await page.locator('[data-testid="split-menu-ai_split"]').count()) === 1);
  // 앞 단계가 경계를 이미 확인해 두었을 수 있다 - 항목은 지금 상태를 뒤집는다(확인하면 다음 확인 안 된 문장으로 넘어가니 줄의 확인 표시로 본다)
  const firstUnitId = (await first.getAttribute("data-testid")).replace("split-paper-unit-", "");
  const mark = page.locator(`[data-testid="split-paper-mark-checked-${firstUnitId}"]`);
  const wasChecked = (await mark.count()) > 0;
  await page.locator('[data-testid="split-menu-check"]').click();
  await page.waitForFunction(([id, was]) => (document.querySelector(`[data-testid="split-paper-mark-checked-${id}"]`) !== null) !== was, [firstUnitId, wasChecked], { timeout: T });
  // 짝 풀기 → 짝 만들기: 짝이 있는 문장을 고르고 그 짝(다른 문장)을 우클릭한다
  const toastOk = (text) => page.waitForFunction((word) => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((el) => el.textContent?.includes(word)), text, { timeout: T });
  let partnerId = null;
  for (let at = 0; at < 8 && partnerId === null; at += 1) {
    await units.nth(at).click();
    const partner = page.locator('[data-testid^="split-pair-unit-"]').first();
    if (await partner.count()) partnerId = (await partner.getAttribute("data-testid")).replace("split-pair-unit-", "");
  }
  check("found a selected sentence with a pair", partnerId !== null);
  const partnerUnit = page.locator(`[data-testid="split-paper-unit-${partnerId}"]`).first();
  await partnerUnit.click({ button: "right" });
  await wait(page, "split-menu-unpair");
  check("pair is off for an existing pair, unpair is on", (await page.locator('[data-testid="split-menu-pair"]').getAttribute("aria-disabled")) === "true" && (await page.locator('[data-testid="split-menu-unpair"]').getAttribute("aria-disabled")) === null);
  await page.locator('[data-testid="split-menu-unpair"]').click();
  await toastOk("Pair removed");
  await page.waitForFunction(() => document.querySelector('[data-testid="split-pair-status"]') === null, null, { timeout: T });
  await partnerUnit.click({ button: "right" });
  await wait(page, "split-menu-pair");
  check("pair is on for an unpaired KO/EN couple", (await page.locator('[data-testid="split-menu-pair"]').getAttribute("aria-disabled")) === null);
  await page.locator('[data-testid="split-menu-pair"]').click();
  await toastOk("Pair confirmed");
  await page.locator('[data-testid="split-pair-status"]').waitFor({ timeout: T });
  check("Make pair confirms at once", (await getText(page, "split-pair-status")).trim() === "Confirmed", await getText(page, "split-pair-status"));
});

await runStep("assign: hold an unassigned unit without a destination", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  check("hold is available with no destination", !(await page.locator('[data-testid="assign-hold"]').isDisabled()));
  await page.locator('[data-testid="assign-reason"]').fill("Smoke: decide later");
  await page.locator('[data-testid="assign-hold"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("the unit is on hold", true);
});

await runStep("assign: an edit survives looking at another unit", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  await pickFirstPlace(page);
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="assign-text-"]').first();
  await textarea.fill("Smoke: edit kept across units");
  await page.locator('[data-testid="assign-help-toggle"]').focus();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await textarea.waitFor({ timeout: T });
  check("the edit is still there", (await textarea.inputValue()) === "Smoke: edit kept across units");
});

await runStep("split rows of a table, then assign a row as a table", { allowConsoleErrors: true }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/split`);
  const cap = page.locator('button.ptbl-cap[data-testid^="split-paper-unit-"]').first();
  await cap.waitFor({ timeout: T });
  await cap.click();
  await page.locator('[data-testid="split-table-rows"]').click();
  // 판단이 걸린 단위가 있으면 서버가 먼저 묻는다
  const confirm = page.locator('[data-testid="split-confirm-confirm"]');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.locator('[data-testid="split-table-merge"]').waitFor({ timeout: T });
  const rowId = await getText(page, "split-unit-id");
  check("rows are split", rowId.length > 0, rowId);
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, rowId.trim());
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("a table row confirms as a one-row table", true);
});

await runStep("assign: an AI split keeps both sentences when confirmed", {}, async ({ page }) => {
  const status = await page.request.get(`${BASE}/api/bundles/${freshBundleId}/ai/status`, { headers: { "X-Dev-User": "qa.member" } });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.locator('[data-testid="assign-ai-request"]').click();
  // 상단 바 표시가 대기·실행 중을 보인다(워커가 2초마다 꺼내므로 요청 직후에는 대기 중이다)
  await page.locator('[data-testid="top-bar-ai"][data-state="active"]').waitFor({ timeout: T });
  check("the top bar shows the AI job in progress", (await getText(page, "top-bar-ai-active")).trim() === "1");
  // 폴링으로 제안이 저절로 들어온다(새로고침 없이)
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("AI suggested"), null, { timeout: 30000 });
  check("the AI suggestion appears without a reload", true);
  // 내가 한 요청이 끝나면 알림이 뜨고, 목록에는 끝난 요청이 n / N과 함께 남는다
  await page.locator('[data-testid="toast-ok"]', { hasText: /^AI Classify finished · BND-/ }).first().waitFor({ timeout: 30000 });
  check("a toast says the request finished", true);
  await page.locator('[data-testid="top-bar-ai"]:not([data-state="active"])').waitFor({ timeout: T });
  await page.locator('[data-testid="top-bar-ai"]').click();
  await wait(page, "ai-jobs-popover");
  const doneRow = page.locator('[data-testid^="ai-jobs-request-"][data-outcome="done"]').first();
  await doneRow.waitFor({ timeout: T });
  const progress = (await doneRow.locator('[data-testid$="-progress"]').innerText()).trim();
  check("the job list shows the finished request with its progress", /^(\d+) \/ \1$/.test(progress), progress);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="ai-jobs-popover"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid^="assign-text-t"]').nth(1).waitFor({ timeout: T });
  const slots = await page.locator('[data-testid^="assign-text-t"]').count();
  check("both split sentences are shown", slots >= 2, String(slots));
  const ids = await rowIds(page);
  await page.locator('[data-testid="assign-primary"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await selectRowById(page, ids.split(" · ")[0]);
  await page.locator('[data-testid^="assign-text-t"]').first().waitFor({ timeout: T });
  check("both sentences are still there after confirming", (await page.locator('[data-testid^="assign-text-t"]').count()) === slots);
});

await runStep("assign: written New document - identical, link by clicking, split with Ctrl, zoom, width, mark new", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-identical");
  await page.locator('[data-testid="assign-identical"]').click();
  // 여러 줄을 한 번에 확정하므로 확인 창을 거친다
  await page.locator('[data-testid="assign-identical-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator('[data-testid="assign-identical"]').waitFor({ state: "detached", timeout: T });
  check("identical matches confirm together", true);
  // 쓴 문서의 문장에 잇기 - 원문에서 직접 누른다
  // 비슷한 New 문장 후보(점선)가 있는 Old 조각까지 옮긴다 - 후보는 같은 언어만 나온다(짝 맞추기는 같은 언어끼리)
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  const candidate = page.locator('[data-testid="assign-new"] .new-line[data-state="candidate"]');
  // 줄을 옮길 때마다 그 줄의 후보 요청이 끝나기를 기다린다 - networkidle은 첫 로드 뒤로는 곧바로 풀려서,
  // 기다리지 않으면 응답보다 먼저 다음 줄로 넘어가 닿는 줄이 실행 속도에 따라 달라진다
  let openCandidateRequests = 0;
  const countCandidateRequest = (delta) => (request) => {
    if (request.url().includes("/new-candidates")) openCandidateRequests += delta;
  };
  page.on("request", countCandidateRequest(1));
  page.on("requestfinished", countCandidateRequest(-1));
  page.on("requestfailed", countCandidateRequest(-1));
  for (let step = 0; step < 40 && (await candidate.count()) === 0; step += 1) {
    await page.keyboard.press("j");
    // 요청이 나갈 틈(문장이 없는 줄은 요청이 없다) → 걸린 요청이 없을 때까지 → 응답을 그릴 틈
    await page.waitForTimeout(150);
    while (openCandidateRequests > 0) await page.waitForTimeout(50);
    await page.waitForTimeout(100);
  }
  // 누르면 후보가 아니라 고른 문장이 된다 - 같은 줄을 계속 가리키게 testid로 붙잡는다
  const firstLine = page.locator(`[data-testid="${await candidate.first().getAttribute("data-testid")}"]`);
  const lang = (await firstLine.getAttribute("data-lang"));
  // 줄 가운데를 누르면 오른쪽 출처 칩에 닿을 수 있다 - 고르는 단추를 누른다
  await firstLine.locator(".new-hit").click();
  check("clicking a New sentence picks it", (await firstLine.getAttribute("data-state")) === "picked");
  // 맥에서 Ctrl+클릭은 오른쪽 클릭이다 - 화면은 ⌘도 같은 뜻으로 받는다
  const multi = process.platform === "darwin" ? "Meta" : "Control";
  const sameLang = page.locator(`[data-testid="assign-new"] .new-line[data-lang="${lang}"]:not([data-state="picked"])`);
  const second = page.locator(`[data-testid="${await sameLang.first().getAttribute("data-testid")}"]`);
  await second.locator(".new-hit").click({ modifiers: [multi] });
  await page.locator('[data-testid^="assign-link-"]').nth(1).waitFor({ timeout: T });
  check("Ctrl+click adds a second sentence", (await page.locator('[data-testid^="assign-link-"]').count()) >= 2);
  await takeShot("sop-assign-link.png");
  await second.locator(".new-hit").click({ modifiers: [multi] });
  const linkedId = (await firstLine.getAttribute("data-testid")).replace("assign-new-", "");
  const readSources = async () => {
    const response = await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers: { "X-Dev-User": "qa.member" } });
    return ((await response.json()).find((row) => String(row.target_id) === linkedId)?.source_unit_ids ?? []).length;
  };
  const sourcesBefore = await readSources();
  // 앞 단계의 토스트가 아직 떠 있을 수 있다 - 저장 응답을 기다린다
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const savedResponse = await saved;
  check("the link saves", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  await page.waitForLoadState("networkidle");
  check("linking to a written sentence adds the Old source", (await readSources()) > sourcesBefore, String(sourcesBefore));
  // 문서별 확대 - Old 위에서 Ctrl+휠, New는 그대로
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await wait(page, "assign-new-zoom-value");
  const oldZoom = await getText(page, "assign-old-zoom-value");
  const newZoom = await getText(page, "assign-new-zoom-value");
  await page.locator('[data-testid="assign-old"] .pane-body').hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForFunction((value) => document.querySelector('[data-testid="assign-old-zoom-value"]')?.textContent !== value, oldZoom, { timeout: T });
  check("Ctrl+wheel zooms only the hovered document", (await getText(page, "assign-new-zoom-value")) === newZoom);
  const width = await page.locator('[data-testid="assign-divider"]').getAttribute("aria-valuenow");
  await page.locator('[data-testid="assign-divider"]').focus();
  await page.keyboard.press("ArrowRight");
  check("the divider moves with the arrow keys", (await page.locator('[data-testid="assign-divider"]').getAttribute("aria-valuenow")) !== width);
  // 출처 없는 New - 신규로 표시
  await page.locator('[data-testid="assign-filter-unsourced"]').click();
  await wait(page, "assign-mark-new");
  await page.locator('[data-testid="assign-mark-new"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("an unsourced New sentence is marked new", true);
});

// 한 언어만 잇기(v0.11.1) - Old는 한/영 짝인데 쓴 New에는 한 언어만 있는 예외. 있는 언어만 이어 확정하면 짝이 풀리고
// 남은 문장이 제 줄이 되어 사람이 삭제(사유)나 보류로 끝낸다
await runStep("assign: a one-language link on a KO/EN pair row unpairs it and leaves the other sentence open", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 둘 다 판단이 없는 한/영 짝 가운데 한 언어에만 New 후보가 있고, 그 New 문장에 다른 언어 짝이 없는 것
  const written = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  let found = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const unitOf = new Map(view.units.map((unit) => [unit.id, unit]));
    for (const pair of view.pairs) {
      const members = pair.unit_ids.map((id) => unitOf.get(id));
      if (members.length !== 2 || members.some((unit) => !unit || unit.status !== "unassigned")) continue;
      const candidates = [];
      for (const unit of members) candidates.push((await getJson(`/units/${unit.id}/new-candidates`)).filter((item) => written.get(item.target_id)?.partner_target_id == null));
      const linkedAt = candidates.findIndex((list) => list.length > 0);
      if (linkedAt === -1 || candidates[1 - linkedAt].length > 0) continue;
      found = { docId: doc.id, pairId: pair.id, linked: members[linkedAt], leftover: members[1 - linkedAt], targetId: candidates[linkedAt][0].target_id };
      break;
    }
    if (found) break;
  }
  check("the synthetic bundle has a pair with a one-language New candidate", found !== null);
  if (!found) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.linked.display_id);
  check("the row holds both languages", (await rowIds(page)).includes(found.leftover.display_id), await rowIds(page));
  const line = page.locator(`[data-testid="assign-new-pick-${found.targetId}"]`);
  await line.waitFor({ timeout: T });
  await line.click();
  await wait(page, "assign-link-leftover");
  check("the chosen box names the sentence it leaves out", (await getText(page, "assign-link-leftover")).includes(found.leftover.display_id));
  await takeShot("sop-assign-link-leftover.png");
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  const unpaired = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/pairs/"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const savedResponse = await saved;
  check("the one-language link saves", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  const unpairedResponse = await unpaired;
  check("the pair is dissolved after the save", unpairedResponse.ok(), unpairedResponse.ok() ? "" : (await unpairedResponse.text()).slice(0, 300));
  // 남은 문장이 제 줄로 골라진다 - 다음 줄로 넘어가지 않는다
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, found.leftover.display_id, { timeout: T });
  check("the leftover sentence is picked as its own open row", (await rowStatus(page)) === "Unassigned", await rowStatus(page));
  await takeShot("sop-assign-link-leftover-row.png");
  const readUnits = async () => new Map((await getJson("/units?limit=1000")).items.map((unit) => [unit.unit_id, unit]));
  let units = await readUnits();
  const stateOf = (unit) => `${units.get(unit.id)?.status}/${units.get(unit.id)?.pair_id}`;
  check("the linked sentence is confirmed and the other stays open, both unpaired", stateOf(found.linked) === "confirmed/null" && stateOf(found.leftover) === "unassigned/null", `${stateOf(found.linked)} ${stateOf(found.leftover)}`);
  const events = await getJson("/events?limit=5");
  check("history records the unpair", events.some((event) => event.action === "pair.delete" && event.target_ids.includes(found.pairId)));
  // 사람이 삭제(사유)로 끝낸다
  if ((await page.locator('[data-testid="assign-pick-delete"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  await page.locator('[data-testid="assign-reason"]').fill("No counterpart in the new document");
  const closed = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const closedResponse = await closed;
  check("the leftover closes with Deleted and a reason", closedResponse.ok(), closedResponse.ok() ? "" : (await closedResponse.text()).slice(0, 300));
  await page.waitForLoadState("networkidle");
  units = await readUnits();
  check("the leftover sentence is confirmed", units.get(found.leftover.id)?.status === "confirmed", units.get(found.leftover.id)?.status);
});

// 그 자리 메뉴·고른 표시(v0.13) - 한/영 짝 줄에서 추천을 누르면(New도 한/영 짝이면 짝 문장까지 골라져) 카드에 고른 표시와 "저장 안 됨"이 보이고,
// 누른 곳 옆 메뉴의 Confirm(↵)으로 저장된다. 저장한 줄의 "→ 간 곳"과 New의 "← 출처"는 맞은편으로 가서 끊기 메뉴를 띄운다.
// 합성 묶음의 OLD-6 한/영 짝 줄 → WI-05 한/영 짝 문장이 이 길이다. 한/영 짝 New 후보가 없는 자료면 한 언어로 잇는다(짝 비교는 assign-model 단위 시험도 본다)
await runStep("assign: KO/EN pair - recommendation shows picked, in-place menu confirms, links navigate", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 둘 다 판단이 없는 한/영 짝 가운데 New 후보가 있는 것 - New 쪽도 한/영 짝인 후보를 먼저 찾는다
  const written = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  let found = null;
  let fallback = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const unitOf = new Map(view.units.map((unit) => [unit.id, unit]));
    for (const pair of view.pairs) {
      const members = pair.unit_ids.map((id) => unitOf.get(id));
      if (members.length !== 2 || members.some((unit) => !unit || unit.status !== "unassigned")) continue;
      const langs = new Set(members.map((unit) => unit.lang));
      const tops = [];
      for (const unit of members) tops.push((await getJson(`/units/${unit.id}/new-candidates`))[0]?.target_id ?? null);
      for (const [index, unit] of members.entries()) {
        const targetId = tops[index];
        if (targetId === null) continue;
        if (!fallback) fallback = { unit, other: members[1 - index], targetId, partnerId: null };
        // 두 언어의 첫 후보가 서로 New 짝이어야 한다 - 글자 2-gram은 언어 끝말만 같아도 먼 문장을 후보로 올린다(합성 OLD-6 → WI-05)
        const partnerId = written.get(targetId)?.partner_target_id ?? null;
        const partner = written.get(partnerId ?? -1);
        if (partner && langs.has(partner.lang) && partner.lang !== unit.lang && tops[1 - index] === partnerId) {
          found = { unit, other: members[1 - index], targetId, partnerId };
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  found ??= fallback;
  check("the synthetic bundle has a KO/EN pair row with a New candidate", found !== null);
  check("the candidate is a KO/EN New pair (OLD-6 → WI-05)", found?.partnerId != null);
  if (!found) return;
  console.log(`  (New pair candidate: ${found.partnerId !== null ? "yes" : "no - one-language link"})`);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.unit.display_id);
  const targetText = written.get(found.targetId).text;
  const cards = page.locator('[data-testid^="assign-rec-"]:not([data-testid$="-pending"])');
  await cards.first().waitFor({ timeout: T });
  let card = null;
  for (let index = 0; index < (await cards.count()); index += 1) {
    if ((await cards.nth(index).innerText()).includes(targetText)) card = cards.nth(index);
  }
  check("the candidate is one of the recommendations", card !== null);
  if (!card) return;
  await card.click();
  // 짝 문장이 더해져도 고른 표시가 켜진다(예전에는 ID 비교라 영영 꺼져 있었다)
  check("the recommendation shows as picked on a KO/EN pair row", (await card.getAttribute("aria-pressed")) === "true");
  check("the card says it is not saved yet", (await card.locator('[data-testid$="-pending"]').count()) === 1);
  if (found.partnerId !== null) check("both New sentences of the pair are picked", (await page.locator(`[data-testid="assign-new-pick-${found.partnerId}"]`).getAttribute("aria-pressed")) === "true");
  await wait(page, "assign-link-menu-confirm");
  await page.locator('[data-testid="assign-link-menu-confirm"]').waitFor({ state: "visible", timeout: T });
  check("the in-place menu says the pick is not saved", (await page.locator('[data-testid="assign-link-menu-unsaved"]').count()) === 1);
  await takeShot("sop-assign-menu-confirm.png");
  // 메뉴는 380ms에 보이고 400ms에 첫 항목으로 포커스를 옮긴다 - 그 사이에 누르면 Enter가 아직 추천 카드에 간다
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "assign-link-menu-confirm", null, { timeout: T });
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  const savedResponse = await saved;
  check("Enter in the menu saves the link", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  const after = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  check("the New sentence gets its Old source", after.get(found.targetId)?.source_unit_ids.includes(found.unit.id), JSON.stringify(after.get(found.targetId)?.source_unit_ids));
  if (found.partnerId !== null) check("the partner New sentence gets the other Old source", after.get(found.partnerId)?.source_unit_ids.includes(found.other.id), JSON.stringify(after.get(found.partnerId)?.source_unit_ids));
  // Old 조각 아래 "→ 간 곳"을 누르면 New의 그 문장으로 가고 끊기 메뉴가 뜬다
  const note = page.locator(`[data-testid="assign-note-${found.unit.id}"]`);
  await note.waitFor({ timeout: T });
  await note.click();
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  check("the jump lands on the linked New sentence", (await page.locator(`[data-pane="new"] [data-flash]`).getAttribute("data-target")) !== null);
  check("lines are drawn between the two documents", (await page.locator('[data-testid="assign-link-lines"] g').count()) > 0);
  await takeShot("sop-assign-jump-new.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc closes the menu", true);
  // New 문장의 "← 출처"를 누르면 Old의 그 조각으로
  await page.locator(`[data-testid="assign-new-src-${found.targetId}-${found.unit.id}"]`).click();
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  check("the source chip jumps to the Old unit", (await page.locator(`[data-pane="old"] [data-flash] [data-unit="${found.unit.id}"]`).count()) === 1);
  // 마우스를 올리면 맞은편이 강조된다
  await page.locator('[data-testid="assign-link-menu-close"]').click();
  await page.locator(`[data-testid="assign-new-${found.targetId}"]`).hover();
  await page.locator(`[data-pane="old"] [data-link-hover]`).first().waitFor({ timeout: T });
  check("hovering a New sentence highlights its Old source", (await page.locator(`[data-pane="old"] [data-link-hover] [data-unit="${found.unit.id}"]`).count()) === 1);
  // 다시 불러와도 저장된 곳이 보인다 - 줄은 확정, 짝 New 두 문장이 이 줄의 곳으로 골라져 있다
  await page.reload();
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.unit.display_id);
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Confirmed"), null, { timeout: T });
  const linkedLines = [found.targetId, found.partnerId].filter((id) => id !== null);
  for (const id of linkedLines) await page.locator(`[data-testid="assign-new-${id}"][data-state="picked"]`).waitFor({ timeout: T });
  check("after reload the row is confirmed and its New sentences are shown as its place", true);
});

await runStep("outputs: A, B, C in both editions and Excel", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  check("C shows the new documents", (await getText(page, "output-c")).includes("SOP-CF"));
  await takeShot("sop-outputs-c.png");
  await page.locator('[data-testid="outputs-tab-a"]').click();
  await wait(page, "output-a");
  check("A lists unit rows", (await page.locator('[data-testid="output-a"] tbody tr').count()) > 10);
  await page.locator('[data-testid="outputs-lang-en"]').click();
  await page.locator('[data-testid="outputs-tab-b"]').click();
  await wait(page, "output-b");
  check("B shows flows from old documents", (await getText(page, "output-b")).includes("OLD-1"));
  const download = page.waitForEvent("download", { timeout: T });
  await page.locator('[data-testid="outputs-export-en"]').click();
  // 헤드리스 Chrome은 blob 내려받기 이름을 "download"로 알린다 - 이름 규칙은 download-name 단위 테스트가 본다
  await download;
  check("Excel download starts", true);
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === true, null, { timeout: T });
  check("meaning check saves", true);
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === false, null, { timeout: T });
});

await runStep("outputs: indent a line on C and its section number changes", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  // 들일 수 있는 첫 줄(앞줄이 있고 번호가 있는 줄)
  const button = page.locator('[data-testid^="output-c-indent-"]:not([disabled])').first();
  const targetId = (await button.getAttribute("data-testid")).replace("output-c-indent-", "");
  const number = page.locator(`[data-testid="output-c-number-${targetId}"]`);
  const before = (await number.innerText()).trim();
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).hover();
  await button.click();
  await page.waitForFunction(({ id, old }) => {
    const text = document.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim();
    return text && text !== old;
  }, { id: targetId, old: before }, { timeout: T });
  const after = (await number.innerText()).trim();
  check("indenting adds a level to the number", after.split(".").length === before.split(".").length + 1, `${before} -> ${after}`);
  await takeShot("sop-outputs-c-indent.png");
  // 줄을 눌러 고른 뒤 Shift+Tab이 내어 쓴다
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Shift+Tab");
  await page.waitForFunction(({ id, old }) => document.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim() === old, { id: targetId, old: before }, { timeout: T });
  check("Shift+Tab on the picked row outdents it back", true);
});

await runStep("outputs: mark a line as a note on C, the count continues and the note is italic", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  // 같은 칸에서 같은 깊이로 이어지는 번호 줄 둘(X, Y) - X를 주석으로 바꾸면 Y가 X의 번호를 이어 받는다
  const pair = await page.evaluate(() => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => {
        const id = row.getAttribute("data-testid").replace("output-c-row-", "");
        return { id, number: row.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim() ?? null, markable: !!row.querySelector(`[data-testid="output-c-mark-note-${id}"]`) };
      });
      for (let i = 0; i + 1 < rows.length; i += 1) {
        const [x, y] = [rows[i], rows[i + 1]];
        if (x.markable && x.number && y.number && x.number.split(".").length === y.number.split(".").length) return { x: x.id, y: y.id, xNumber: x.number, yNumber: y.number };
      }
    }
    return null;
  });
  check("C has two numbered lines in a row to mark", pair !== null);
  await page.locator(`[data-testid="output-c-row-${pair.x}"]`).hover();
  await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="output-c-number-${id}"]`) === null, pair.x, { timeout: T });
  const yAfter = (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim();
  check("the next numbered line continues the count", yAfter === pair.xNumber, `${pair.yNumber} -> ${yAfter} (expected ${pair.xNumber})`);
  const fontStyle = await page.locator(`[data-testid="output-c-item-${pair.x}"]`).evaluate((node) => getComputedStyle(node).fontStyle);
  check("the note is shown in italics", fontStyle === "italic", fontStyle);
  check("the note button shows as picked", (await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).getAttribute("aria-pressed")) === "true");
  await takeShot("sop-outputs-c-note.png");
  // 되돌려 둔다 - 아래 단계와 다시 돌리기가 같은 번호를 본다
  await page.locator(`[data-testid="output-c-row-${pair.x}"]`).hover();
  await page.locator(`[data-testid="output-c-mark-numbered-${pair.x}"]`).click();
  await page.waitForFunction(({ id, number }) => document.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim() === number, { id: pair.x, number: pair.xNumber }, { timeout: T });
  check("Numbered brings the number back", (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim() === pair.yNumber);
});

// 작성자가 요청을 거둔 뒤 다시 요청해 둔다 - 아래 검토자 단계가 같은 Bundle을 검토 대기로 받는다
await runStep("review: author withdraws the request and asks again", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/review`);
  await wait(page, "review-withdraw");
  check("the review page offers withdraw to the author", true);
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await wait(page, "overview-withdraw-review");
  await takeShot("sop-overview-in-review.png");
  await page.locator('[data-testid="overview-withdraw-review"]').click();
  await wait(page, "overview-withdraw-review-modal");
  await page.locator('[data-testid="overview-withdraw-review-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="overview-return-note"]')?.dataset.action === "review.withdraw", null, { timeout: T });
  check("withdrawing leaves a note on the overview", true);
  check("the withdraw note carries no reason", (await page.locator('[data-testid="overview-return-reason"]').count()) === 0);
  check("withdrawing clears the meaning checks", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "semantic_checks");
  check("the withdraw button leaves with the status", (await page.locator('[data-testid="overview-withdraw-review"]').count()) === 0);
  await page.goto(`${BASE}/bundles/${reviewId}/history`);
  await page.waitForFunction(() => document.body.textContent?.includes("Withdrew the review request"), null, { timeout: T });
  check("history records the withdrawal", true);
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  for (const key of ["numbers", "conditions", "tables", "figures"]) {
    await page.locator(`[data-testid="outputs-check-${key}"]`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.checked === true, `outputs-check-${key}`, { timeout: T });
  }
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await page.locator('[data-testid="overview-request-review"]').click();
  await wait(page, "request-review");
  const requestBox = await page.locator('[data-testid="request-review"]').boundingBox();
  check("the request window is narrow", requestBox.width <= 384, String(requestBox.width));
  await takeShot("sop-request-review.png");
  await page.locator('[data-testid="request-review-confirm"]').click();
  await wait(page, "overview-withdraw-review");
  check("the bundle is in review again", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "await_review");
});

await runStep("review: reviewer does not see withdraw", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/review`);
  await wait(page, "review-return");
  check("no withdraw on the review page", (await page.locator('[data-testid="review-withdraw"]').count()) === 0);
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await wait(page, "overview-next");
  check("no withdraw on the overview", (await page.locator('[data-testid="overview-withdraw-review"]').count()) === 0);
});

await runStep("review: reviewer completes the bundle in review", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/review`);
  await wait(page, "output-c");
  await takeShot("sop-review.png");
  await page.locator('[data-testid="review-return"]').click();
  await wait(page, "review-reason");
  check("return needs a reason", await page.locator('[data-testid="review-reason-confirm"]').isDisabled());
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="review-complete"]').click();
  // 검토 완료는 확인 창을 거친다
  await page.locator('[data-testid="review-complete-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="review-status"]')?.textContent?.includes("Review complete"), null, { timeout: T });
  check("status reads Review complete", true);
});

await runStep("assign: AI suggestions come first and confirm one by one", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  if ((await aiRow.count()) === 0) {
    console.log("  (no AI demo bundle in this seed - skipped)");
    return;
  }
  const aiId = Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${aiId}/assign`);
  await wait(page, "assign-bar");
  check("opens on All", (await page.locator('[data-testid="assign-filter-all"]').getAttribute("aria-selected")) === "true");
  await page.locator('[data-testid="assign-filter-ai_suggested"]').click();
  // 필터 단추에 포커스가 남으면 아래 Enter가 필터를 다시 누른다
  await page.locator('[data-testid="assign-filter-ai_suggested"]').blur();
  await page.keyboard.press("j");
  await wait(page, "assign-rec-0");
  check("the AI suggestion is the first card", (await getText(page, "assign-rec-0")).includes("AI"));
  await takeShot("sop-assign-ai.png");
  const before = await progressDone(page);
  await page.keyboard.press("Enter");
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 1, before, { timeout: T });
  check("Enter confirms the AI suggestion", true);
  await page.goto(`${BASE}/bundles/${halfBundleId}/split`);
  await page.locator('[data-testid^="figure-"]').first().waitFor({ timeout: T });
  check("figure image loads on the paper", true);
});

// 필터 접기(2026-11-12) - 필터를 걸면 맞는 문장만 제 모양, 앞뒤 한 줄, 나머지는 묶음 한 줄. 목록은 걸 때의 스냅숏이라 확정해도 접히지 않는다
await runStep("assign: a status filter folds the Old paper", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  const bundleId = (await aiRow.count()) > 0 ? Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", "")) : halfBundleId;
  await page.goto(`${BASE}/bundles/${bundleId}/assign`);
  await wait(page, "assign-bar");
  const old = '[data-testid="assign-old"]';
  const countOf = (selector) => page.locator(selector).count();
  const holdCount = Number(await page.locator('[data-testid="assign-filter-on_hold"] .schip-n').textContent());
  const filter = holdCount > 0 ? "on_hold" : "unassigned";
  const filterCount = Number(await page.locator(`[data-testid="assign-filter-${filter}"] .schip-n`).textContent());
  // 맞는 줄 = 엿보기가 아닌 조각(이웃한 짝 카드의 아래 줄은 위 줄과 한 줄)
  const fullCards = `${old} .strip-row:not([data-peek]) > .strip:not([data-bracket="bottom"])`;
  await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
  // 문서·부분마다 맞는 줄을 더하면 필터 수 - 맞는 것이 없는 곳은 빈 상태와 바로 가기
  const docTrigger = page.locator('[data-testid="assign-old-doc"]');
  const docValues = (await docTrigger.count()) > 0 ? await (async () => {
    await docTrigger.click();
    const values = await page.locator('[data-testid^="assign-old-doc-option-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    await page.keyboard.press("Escape");
    return values;
  })() : [null];
  let drawn = 0;
  let sawEmpty = false;
  for (const value of docValues) {
    if (value) {
      await docTrigger.click();
      await page.locator(`[data-testid="${value}"]`).click();
    }
    const tabs = await page.locator('[data-testid^="assign-tab-"]:not([data-testid="assign-tabs"])').evaluateAll((els) => els.map((el) => el.dataset.testid));
    for (const tab of tabs.length > 0 ? tabs : [null]) {
      if (tab) await page.locator(`[data-testid="${tab}"]`).click();
      await page.locator(`${old} .strip-row, [data-testid="assign-fold-empty"]`).first().waitFor({ timeout: T });
      if ((await countOf('[data-testid="assign-fold-empty"]')) > 0) {
        if (!sawEmpty) await takeShot("sop-assign-fold-empty.png");
        sawEmpty = true;
        continue;
      }
      drawn += await countOf(fullCards);
    }
  }
  check("matched rows over all documents and parts equal the filter count", drawn === filterCount, `${drawn} / ${filterCount}`);
  // 맞는 것이 있는 곳으로 - 빈 상태면 바로 가기, 아니면 첫 문서
  const go = page.locator('[data-testid^="assign-fold-go-"]').first();
  if (sawEmpty && (await go.count()) > 0) {
    check("an empty part offers where the matches are", true);
    await go.click();
  } else if (docValues[0]) {
    await docTrigger.click();
    await page.locator(`[data-testid="${docValues[0]}"]`).click();
  }
  await page.locator(fullCards).first().waitFor({ timeout: T });
  check("the filter folds the rest into runs", (await countOf('[data-testid^="assign-paper-fold-run-"]')) >= 1 || (await countOf('[data-testid^="assign-paper-fold-line-"]')) >= 1);
  await takeShot("sop-assign-fold.png");
  // 묶음 한 줄 - 키보드로 펼치면 한 줄 판들과 접기 손잡이
  const run = page.locator('[data-testid^="assign-paper-fold-run-"]').first();
  if ((await run.count()) > 0) {
    const linesBefore = await countOf('[data-testid^="assign-paper-fold-line-"]');
    const runKey = ((await run.getAttribute("data-testid")) ?? "").replace("assign-paper-fold-run-", "");
    await run.focus();
    await page.keyboard.press("Enter");
    await wait(page, `assign-paper-fold-head-${runKey}`);
    check("Enter on a run opens its lines under a collapse handle", (await countOf('[data-testid^="assign-paper-fold-line-"]')) > linesBefore);
  }
  // 한 줄 판을 누르면 엿보기 - 고르지는 않는다
  await page.locator('[data-testid^="assign-paper-fold-line-"]').first().click();
  await page.locator(`${old} .strip-row[data-peek]`).first().waitFor({ timeout: T });
  check("a line opens as a peek without picking it", (await countOf('[data-testid="assign-row-id"]')) === 0);
  await page.locator(`${old} .strip-row[data-peek]`).first().scrollIntoViewIfNeeded();
  await takeShot("sop-assign-fold-peek.png");
  // 같은 필터를 다시 누르면 모두 접힌다
  await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
  await page.locator(`${old} .strip-row[data-peek]`).first().waitFor({ state: "detached", timeout: T });
  check("clicking the same filter folds everything again", (await countOf('[data-testid^="assign-paper-fold-head-"]')) === 0);
  // 맞는 줄을 확정해도 그 자리에 제 모양으로 남는다(스냅숏)
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  const pickedId = await page.locator(`${old} .strip[data-sel]`).first().getAttribute("data-strip-unit");
  await pickFirstPlace(page);
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  check("the matched row confirms", (await saved).ok());
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  // 확정하면 다음 미확정 줄(다른 문서일 수 있다)로 간다 - K로 돌아오면 목록에 그대로 있고 제 모양이다
  await page.waitForFunction((id) => document.querySelector('[data-pane="old"] .strip[data-sel]')?.getAttribute("data-strip-unit") !== id, pickedId, { timeout: T });
  await page.keyboard.press("k");
  await page.locator(`${old} .strip[data-sel][data-strip-unit="${pickedId}"]`).waitFor({ timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Confirmed"), null, { timeout: T });
  check("a confirmed matched row stays in the list in full, not folded", (await countOf(`${old} .strip-row:not([data-peek]) > .strip[data-sel][data-strip-unit="${pickedId}"]`)) === 1);
  // New 출처 칩으로 필터 밖(접힌) Unit에 가면 저절로 엿보기로 펼쳐 보인다 - 고른 줄을 따라 New 문서가 바뀌므로 다 받은 뒤에 칩을 찾는다
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const chips = await page.locator('[data-testid^="assign-new-src-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
  let target = null;
  for (const chip of chips) {
    const unitId = chip.split("-").pop();
    if ((await countOf(`${old} [data-unit="${unitId}"]`)) === 0) {
      target = { chip, unitId };
      break;
    }
  }
  check("a New source chip points at a folded Old unit", target !== null);
  if (target) {
    await page.locator(`[data-testid="${target.chip}"]`).click();
    await page.locator(`${old} [data-flash] [data-unit="${target.unitId}"]`).waitFor({ timeout: T });
    check("the folded source opens as a peek and flashes", (await countOf(`${old} .strip-row[data-peek] [data-unit="${target.unitId}"]`)) >= 1);
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
    await page.keyboard.press("j");
    await page.waitForFunction((id) => document.querySelector('[data-pane="old"] .strip[data-sel]')?.getAttribute("data-strip-unit") !== id, target.unitId, { timeout: T });
    check("J from a peek goes to a matched row", (await countOf(`${old} .strip-row:not([data-peek]) > .strip[data-sel]`)) === 1);
  }
});

await runStep("assign: reset a document, then the whole bundle, after a dry-run count", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-reset");
  const before = await progressDone(page);
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-document"]').click();
  // 확인 창이 먼저 dry_run으로 센 건수를 보이고, 그때까지 확정 단추를 막는다
  await wait(page, "assign-reset-counts");
  const counts = await getText(page, "assign-reset-count-unassigned");
  check("the document reset shows the dry-run count first", /\d/.test(counts), counts);
  await takeShot("sop-assign-reset.png");
  await page.locator('[data-testid="assign-reset-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) < done, before, { timeout: T });
  check("resetting the document lowers the progress", true);
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-counts");
  await page.locator('[data-testid="assign-reset-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-progress"]')?.textContent?.trim().startsWith("0"), null, { timeout: T });
  check("resetting the whole bundle leaves nothing confirmed", true);
  // 다시 열면 지울 것이 없다고 말하고 확정 단추를 막는다
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-nothing");
  check("nothing left to reset disables the confirm button", await page.locator('[data-testid="assign-reset-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="assign-reset-modal-cancel"]').click();
});

await runStep("dark theme from the layout menu, before first paint next time", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-layout"]').hover();
  await page.locator('[data-testid="layout-menu-theme-dark"]').click();
  check("dark applies at once", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.keyboard.press("Escape");
  await takeShot("sop-assign-dark.png");
  await page.goto(`${BASE}/bundles/${halfBundleId}`, { waitUntil: "commit" });
  const early = await page.evaluate(() => new Promise((done) => {
    if (document.readyState !== "loading") done(document.documentElement.dataset.theme);
    else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.dataset.theme), { once: true });
  }));
  check("stored theme applies before the app mounts", early === "dark", String(early));
});

// 멤버 피커(2026-11-09 운영 버그): 이름을 고르면 "추가" 단추가 피커 칸 안에 보이고 눌러 목록에 들어간다.
// 긴 부서 경로는 HR 데이터에서만 나온다 - 로컬에서는 employees 표에 긴 경로 직원을 넣고 돌리면 같은 조건이 된다.
await runStep("members picker keeps Add inside the panel and adds the person", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-members-manage");
  await page.locator('[data-testid="overview-members-manage"]').click();
  await page.locator('[data-testid="overview-members-modal-add"]').click();
  await wait(page, "overview-members-modal-picker-list");
  const first = page.locator('[data-testid^="overview-members-modal-picker-option-"]').first();
  check("empty search lists my department first", (await first.getAttribute("data-testid")).endsWith("qa.member"));
  await page.locator('[data-testid="overview-members-modal-picker-search"]').fill("prod");
  await page.locator('[data-testid="overview-members-modal-picker-option-prod.member"]').click();
  const add = await getBox(page, "overview-members-modal-add-confirm");
  const panel = await getBox(page, "overview-members-modal-picker");
  check("Add stays inside the picker panel", add.x + add.width <= panel.x + panel.width + 1, JSON.stringify({ add, panel }));
  await page.locator('[data-testid="overview-members-modal-add-confirm"]').click();
  check("picked person joins the list", (await page.locator('[data-testid="overview-members-modal-row-prod.member"]').count()) === 1);
  check("Save turns on", await page.locator('[data-testid="overview-members-modal-save"]').isEnabled());
  await page.keyboard.press("Escape");
});

// 바로 생성(2026-11-09): 이름 없이 BND 코드로 만들고, 문서가 없으면 Split~Review는 잠기고 To-Be는 열려 있다
await runStep("new bundle in one click, locked stages, empty assign", { devUser: "dev.admin" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid="bundles-new"]').click();
  await page.waitForURL(/\/bundles\/\d+$/, { timeout: T });
  const code = (await getText(page, "overview-code")).trim();
  check("new bundle shows its BND code", /^BND-\d{4,}$/.test(code), code);
  check("Split is locked without documents", (await page.locator('[data-testid="stage-nav-split"][aria-disabled="true"]').count()) === 1);
  check("To-Be stays open without documents", (await page.locator('a[data-testid="stage-nav-tobe"]').count()) === 1);
  await page.locator('[data-testid="overview-menu"]').click();
  await page.locator('[data-testid="overview-menu-synthetic"]').click();
  await page.locator('[data-testid="top-bar-synthetic"]').waitFor({ timeout: T });
  check("test-data mark set from the menu", true);
  await page.goto(`${page.url()}/assign`);
  await wait(page, "assign-empty");
  check("empty state instead of an endless skeleton", true);
});

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
