// SOP 화면 스모크(Playwright + 시스템 Chrome) - 묶음 목록, 개요, 단계 이동(레일·상단 탭), 배치 메뉴, 첫 페인트 전 설정.
// 전제: backend/에서 reset_db → seed_sop_demo(합성 묶음 3개) 직후, backend 8777 + frontend 3777. 고친 값은 시나리오 안에서 되돌린다.
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
  await page.locator('[data-testid="top-bar-layout"]').click();
  await wait(page, "layout-menu");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="layout-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc returns focus to the layout button", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "top-bar-layout"));
  await page.locator('[data-testid="top-bar-layout"]').click();
  await page.locator('[data-testid="layout-menu-shell-bar"]').click();
  const navBox = await getBox(page, "stage-nav");
  check("top tabs span the width", navBox.width > 1000 && Math.round(navBox.height) === 39, JSON.stringify(navBox));
  await page.mouse.click(600, 600);
  await page.locator('[data-testid="layout-menu"]').waitFor({ state: "detached", timeout: T });
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
  const version = page.locator(`[data-testid="documents-${docId}-version"]`);
  const before = (await version.innerText()).trim();
  const rowY = (await firstRow.boundingBox()).y;
  await version.click();
  const input = page.locator(`[data-testid="documents-${docId}-version-input"]`);
  await input.fill("R09");
  await input.press("Enter");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForFunction((id) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.textContent?.trim() === "R09", docId, { timeout: T });
  check("version saved inline", true);
  check("row did not move while editing", Math.abs((await firstRow.boundingBox()).y - rowY) < 1);
  await takeShot("sop-documents.png");
  // 되돌린다 - 원래 빈 값이면 비운다
  await page.locator(`[data-testid="documents-${docId}-version"]`).click();
  await input.fill(before === "Add version" ? "" : before);
  await input.press("Enter");
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="documents-${id}-version-input"]`), docId, { timeout: T });
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
  // 영어 문장 하나를 찾아 고른다 - 두 번째 누름이 나눌 선을 만든다
  const target = page.locator('[data-testid^="split-paper-unit-"].su[lang="en"]', { hasText: " " }).nth(2);
  const unitId = (await target.getAttribute("data-testid")).replace("split-paper-unit-", "");
  await target.click();
  check("first click selects", (await target.getAttribute("data-sel")) === "");
  const primary = page.locator('[data-testid="split-primary"]');
  const primaryBox = await primary.boundingBox();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
  await page.locator(`[data-testid="split-paper-unit-${unitId}"][data-cut]`).waitFor({ timeout: T });
  check("second click draws the cut", true);
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
  await page.locator(`[data-testid="tobe-${newKey}-parent"]`).selectOption("");
  await page.locator('[data-testid="tobe-save"]').click();
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("server rejection reads as a sentence", (await getText(page, "toast-error")).includes("WI-99"), await getText(page, "toast-error"));
  await page.locator('[data-testid="tobe-discard"]').click();
  await page.locator('[data-testid="tobe-dirty"]').waitFor({ state: "detached", timeout: T });
});

await runStep("classify: choose, confirm, delete with reason, edit, clear, bulk", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/classify`);
  const rows = page.locator('[data-testid^="classify-row-u"]');
  await rows.first().waitFor({ timeout: T });
  check("unassigned filter first", (await page.locator('[data-testid="classify-filter-unassigned"]').getAttribute("aria-selected")) === "true");
  const firstKey = (await rows.first().getAttribute("data-testid")).replace("classify-row-", "");
  const rowBox = await rows.first().boundingBox();
  const primary = page.locator('[data-testid="classify-primary"]');
  const primaryBox = await primary.boundingBox();
  const ids = await page.locator('[data-testid^="classify-row-u"] .font-mono').allInnerTexts();
  check("pair rows carry both IDs", ids.some((text) => text.includes(" · ")), ids.slice(0, 4).join(" | "));
  await page.keyboard.press("Enter");
  await wait(page, "classify-destination-menu");
  check("Enter opens the destination menu", true);
  await page.locator('[data-testid^="classify-dest-slot:"]:not([disabled])').first().click();
  check("primary turns into Confirm", (await primary.getAttribute("data-state")) === "confirm");
  await takeShot("sop-classify-chosen.png");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForFunction((key) => document.querySelector(`[data-testid="classify-row-${key}"]`)?.getAttribute("data-status") === "confirmed", firstKey, { timeout: T });
  check("confirmed row stays in place", Math.abs((await rows.first().boundingBox()).y - rowBox.y) < 1);
  check("selection moved to the next row", (await rows.first().getAttribute("aria-current")) !== "true");
  const after = await primary.boundingBox();
  check("primary button did not move", Math.abs(after.y - primaryBox.y) < 1 && Math.abs(after.width - primaryBox.width) < 1);

  // 삭제 - 사유 없이는 저장하지 않는다
  await page.locator('[data-testid="classify-destination"]').click();
  await page.locator('[data-testid="classify-dest-delete"]').click();
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("delete without a reason is stopped", true);
  await page.locator('[data-testid="classify-reason"]').fill("Structural heading");
  await page.locator('[data-testid="classify-primary"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((el) => el.textContent?.includes("Confirmed")), null, { timeout: T });

  // 고쳐서 확정 - 바뀐 글은 변경 종류를 묻는다
  await page.locator('[data-testid="classify-destination"]').click();
  await page.locator('[data-testid^="classify-dest-slot:"]:not([disabled])').nth(1).click();
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="classify-text-"]').last();
  await textarea.waitFor({ timeout: T });
  await textarea.fill("Edited sentence for the smoke test.");
  await page.locator('[data-testid^="classify-change-"]').first().waitFor({ timeout: T });
  check("save-and-confirm label while editing", (await primary.getAttribute("data-state")) === "save");
  await takeShot("sop-classify-edit.png");
  await textarea.press("Control+Enter");
  await page.locator('[data-testid="classify-primary"][data-state="choose"]').waitFor({ timeout: T });
  check("Ctrl+Enter saves the edit and moves on", true);

  // 배정 지우기
  await page.locator(`[data-testid="classify-row-${firstKey}"]`).click();
  await page.keyboard.press("u");
  await page.waitForFunction((key) => document.querySelector(`[data-testid="classify-row-${key}"]`)?.getAttribute("data-status") === "unassigned", firstKey, { timeout: T });
  check("U clears the assignment", true);

  // 여러 줄 삭제
  await rows.nth(4).click();
  await rows.nth(5).click({ modifiers: ["Control"] });
  await wait(page, "classify-bulk");
  await page.locator('[data-testid="classify-bulk-delete"]').click();
  await page.locator('[data-testid="classify-bulk-reason"]').fill("Header text");
  await page.locator('[data-testid="classify-bulk-confirm"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((el) => /units confirmed/.test(el.textContent ?? "")), null, { timeout: T });
  check("bulk delete confirms the picked rows", true);
  await takeShot("sop-classify.png");
});

await runStep("classify in list and detail layout", { storage: { "sopa.classifyLayout": "list" } }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/classify`);
  await page.locator('[data-testid="classify"][data-layout="list"]').waitFor({ timeout: T });
  check("list layout is used", true);
  await takeShot("sop-classify-list.png");
});

await runStep("match: identical candidates, link a source, mark new", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  for (const id of [halfBundleId, freshId]) {
    await page.goto(`${BASE}/bundles/${id}/match`);
    await wait(page, "match");
    const rows = await page.locator('[data-testid^="match-row-"]').count();
    console.log(`  bundle ${id}: ${rows} open new sentences, identical ${await page.locator('[data-testid="match-identical"]').count()}`);
  }
  await page.goto(`${BASE}/bundles/${halfBundleId}/match`);
  await wait(page, "match");
  await page.locator('[data-testid="match-filter-all"]').click();
  check("new-document sentences are listed", (await page.locator('[data-testid^="match-row-"]').count()) > 0);
  await takeShot("sop-match.png");
  await page.locator('[data-testid="match-identical-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator('[data-testid="match-identical"]').waitFor({ state: "detached", timeout: T });
  check("identical matches confirm together", true);
  const open = page.locator('[data-testid="match-filter-open"]');
  await open.click();
  const first = page.locator('[data-testid^="match-row-"]').first();
  await first.click();
  await page.locator('[data-testid^="match-candidate-"]').first().check();
  await page.locator('[data-testid="match-link"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="match-sources"] li').length > 0, null, { timeout: T });
  check("a picked old unit becomes the source", true);
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
  await page.waitForFunction(() => document.querySelector('[data-testid="review-status"]')?.textContent?.includes("Review complete"), null, { timeout: T });
  check("status reads Review complete", true);
});

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
