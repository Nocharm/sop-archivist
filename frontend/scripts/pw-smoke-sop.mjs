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
  check("half-classified row shows KO 21 / 43", (await getText(page, `bundles-ko-${halfBundleId}`)).includes("21 / 43"));
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
  check("KO rate 49%", (await getText(page, "overview-rate-ko")).includes("49"), await getText(page, "overview-rate-ko"));
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
  check("extraction status is English", list.includes("Ready"), list);
  check("aux check label", list.includes("Checked") || list.includes("Aux check unavailable"), list);
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
  // 영어 문장 하나를 찾아 고른다 - 한 번 더 누르면 아무것도 안 하고, 두 번 누르기(더블클릭)가 나눌 선을 만든다
  const target = page.locator('[data-testid^="split-paper-unit-"].su[lang="en"]', { hasText: " " }).nth(2);
  const unitId = (await target.getAttribute("data-testid")).replace("split-paper-unit-", "");
  await target.click();
  check("first click selects", (await target.getAttribute("data-sel")) === "");
  check("first click shows the inline confirm", (await page.locator('[data-testid="split-inline-check"]').count()) === 1);
  check("selection is drawn as one contour", (await page.locator(".sel-contour path").count()) === 1);
  const primary = page.locator('[data-testid="split-primary"]');
  const primaryBox = await primary.boundingBox();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
  await page.waitForTimeout(300);
  check("a second single click does not cut", (await page.locator(`[data-testid="split-paper-unit-${unitId}"][data-cut]`).count()) === 0);
  await page.mouse.dblclick(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
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
  await page.mouse.dblclick(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
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
const rowStatus = async (page) => (await getText(page, "assign-row-status")).trim();
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
  check("unassigned filter first", (await page.locator('[data-testid="assign-filter-unassigned"]').getAttribute("aria-selected")) === "true");
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
  // 일괄 - Shift+클릭으로 여럿
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
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
  // 폴링으로 제안이 저절로 들어온다(새로고침 없이)
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("AI suggested"), null, { timeout: 30000 });
  check("the AI suggestion appears without a reload", true);
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
  const lang = (await firstLine.locator(".ptag").innerText()).trim().toLowerCase();
  // 줄 가운데를 누르면 오른쪽 출처 칩에 닿을 수 있다 - 고르는 단추를 누른다
  await firstLine.locator(".new-hit").click();
  check("clicking a New sentence picks it", (await firstLine.getAttribute("data-state")) === "picked");
  // 맥에서 Ctrl+클릭은 오른쪽 클릭이다 - 화면은 ⌘도 같은 뜻으로 받는다
  const multi = process.platform === "darwin" ? "Meta" : "Control";
  const sameLang = page.locator(`[data-testid="assign-new"] .new-line:has(.ptag.${lang}):not([data-state="picked"])`);
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
  // 문서별 확대 - Old 위에서 Ctrl+휠, New는 그대로(다음 조각으로 넘어가 New 원문이 닫혔으면 연다)
  // 다음 조각의 후보가 늦게 오면 New 원문이 저절로 열렸다 닫힌다 - 자리 잡을 때까지 기다렸다가 닫혀 있으면 연다
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-toggle-new"]').click();
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
// 지금 합성 묶음의 쓴 New 문서는 영어뿐이라 New 짝이 없다 - 그때는 한 언어로 잇고(남은 문장은 짝이 풀린다) 짝 비교는 assign-model 단위 시험이 본다
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
      for (const unit of members) {
        const candidates = await getJson(`/units/${unit.id}/new-candidates`);
        const hit = candidates.find((item) => {
          const partner = written.get(written.get(item.target_id)?.partner_target_id ?? -1);
          return partner && langs.has(partner.lang) && partner.lang !== unit.lang;
        });
        if (!fallback && candidates.length > 0) fallback = { unit, other: members.find((item) => item !== unit), targetId: candidates[0].target_id, partnerId: null };
        if (hit) {
          found = { unit, other: members.find((item) => item !== unit), targetId: hit.target_id, partnerId: written.get(hit.target_id).partner_target_id };
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  found ??= fallback;
  check("the synthetic bundle has a KO/EN pair row with a New candidate", found !== null);
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
  check("AI suggested filter opens first", (await page.locator('[data-testid="assign-filter-ai_suggested"]').getAttribute("aria-selected")) === "true");
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
