// SOP 화면 스모크(Playwright + 시스템 Chrome) - 묶음 목록, 개요, 단계 이동(레일·상단 탭), 배치 메뉴, 첫 페인트 전 설정.
// 전제: backend/에서 reset_db → seed_sop_demo(합성 묶음 4개) 직후, backend 8777 + frontend 3777. 고친 값은 시나리오 안에서 되돌린다.
// AI 나눔 확정 시나리오는 backend가 AI를 켜고 가짜 AI(FAKE_AI_SPLIT=1 node scripts/fake-ai-server.mjs)를 볼 때만 돈다 - 꺼져 있으면 건너뛴다.
// PREPARE=1이면 "배정 화면 첫 진입 미리 분류" 시나리오 하나만 돈다(나머지는 건너뛴다). 전제: reset_db → seed_sop_demo 직후(시드는 AI_AUTO_PREPARE=false),
// 가짜 AI(node scripts/fake-ai-server.mjs)를 보는 backend를 AI_ENABLED=true AI_AUTO_PREPARE=true로 띄운다. 이 backend에서는 작성자가 배정 화면에 들어갈 때마다
// 남은 줄이 저절로 분류돼 다른 단계의 전제가 깨지므로 같이 돌리지 않는다. 끝에 DB가 바뀐다(분류 절반 묶음의 남은 줄에 AI 제안이 붙는다) - 다시 돌리려면 reset_db부터.
// 실행(frontend/ 에서): node scripts/pw-smoke-sop.mjs   환경 변수: BASE_URL, CHROME_PATH
// ONLY="이름 조각,…"이면 이름에 그 조각이 든 단계만 돈다. 묶음 id를 잡는 첫 단계("bundle list")는 늘 함께 돈다. 화면 하나만 보려면 이름 머리로 고른다: ONLY="assign:" · "documents:" · "new documents:" · "outputs"
// QUIET=1이면 통과한 줄을 찍지 않는다 - 실패한 줄과 마지막 한 줄(통과 수·실패 수)만 나온다.
// 평소(변경마다)는 고친 화면만: QUIET=1 ONLY="<화면>" node scripts/pw-smoke-sop.mjs  — 전부 돌리는 것은 dev→main 정식 업데이트 전, 또는 여러 화면이 같이 쓰는 것(공용 부품·API 층·이 스크립트의 틀)을 고쳤을 때만이다(사용자 결정 2026-11-16).
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
const ONLY = (process.env.ONLY ?? "").split(",").map((part) => part.trim()).filter(Boolean);
const PREPARE = process.env.PREPARE === "1";
const PREPARE_STEP = "assign: first entry classifies the remaining rows in the background";
// 시안의 모든 수치는 1248 × 720 프레임 기준이다(디자인 문서 15절)
const VIEWPORT = { width: 1248, height: 720 };

mkdirSync(SHOT_DIR, { recursive: true });

const QUIET = process.env.QUIET === "1";
// 묶음 id를 잡아 두는 단계 - 뒤 단계가 모두 여기에 기댄다
const SETUP_STEP = "bundle list";
let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes += 1;
  else failures += 1;
  if (ok && QUIET) return;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).replace(/\s+/g, " ").trim()}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function runStep(name, { devUser = "qa.member", storage = {}, allowConsoleErrors = false } = {}, run) {
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

const wait = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().waitFor({ timeout: T });
const getText = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().innerText();
const getBox = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().boundingBox();
// 결과물 C의 순서·깊이·표시 저장 - 화면은 먼저 바뀌고 저장은 뒤에서 하므로 응답을 기다린 뒤에 저장된 값을 본다
const isOrderSave = (request) => request.method() === "PUT" && /\/targets\/order/.test(request.url());
const waitOrderSave = (page) => page.waitForResponse((response) => isOrderSave(response.request()), { timeout: T });
// 순서·문단번호 화면은 New 문서를 하나씩 연다 - 문서를 차례로 열어 probe가 값을 돌려주는 문서를 모은다([문서 id, 값]). limit만큼 찾으면 멈춘다
async function findOrderDocs(page, probe, limit = 1) {
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

// --- 시나리오 ---

let halfBundleId = null;
// 방금 올린 합성 묶음("쪼개기 직후") - 옛 주소 단계가 찾아 두고 뒤 단계들이 쓴다
let freshBundleId = null;

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
  const listApi = await page.request.get(`${BASE}/api/bundles`, { headers: { "X-Dev-User": "qa.member" } });
  const listed = (await listApi.json()).find((bundle) => bundle.id === halfBundleId);
  check("half-classified row shows confirmed / total rows", (await getText(page, `bundles-confirmed-${halfBundleId}`)).includes(`/ ${listed.progress.total}`), String(listed.progress.total));
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
  check("overview rate shows a percent", (await getText(page, "overview-rate")).includes("%"), await getText(page, "overview-rate"));
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
  // 검토는 결과 화면 위의 띠에서 한다 - 레일에 Review 칸이 없고 옛 주소는 결과 화면으로 넘어간다
  check("the rail has no Review item", (await page.locator('[data-testid="stage-nav-review"]').count()) === 0);
  const reviewUrl = page.url();
  await page.goto(`${reviewUrl}/review`);
  await page.waitForURL(/\/outputs$/, { timeout: T });
  await wait(page, "review-complete");
  check("the old Review address lands on Outputs with the review bar", (await getText(page, "review-status")).includes("In review"));
  check("the reviewer gets Return and Complete review", (await page.locator('[data-testid="review-return"]').count()) === 1);
  check("the reviewer cannot request or withdraw", (await page.locator('[data-testid="review-request"], [data-testid="review-withdraw"]').count()) === 0);
});

// 작성자는 결과 화면에서 검토를 요청한다 - 조건이 남아 있으면 단추가 꺼져 있고 남은 조건으로 가는 길이 옆에 있다
await runStep("outputs: the review bar tells the author what is left", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "review-open-conditions");
  check("Request review is off while conditions are open", await page.locator('[data-testid="review-request"]').isDisabled());
  check("the bar shows the bundle status", (await getText(page, "review-status")).includes("In progress"));
  await page.locator('[data-testid="review-open-conditions"]').click();
  await page.waitForURL(new RegExp(`/bundles/${halfBundleId}$`), { timeout: T });
  await wait(page, "overview-gate-units");
  check("See what is left opens the conditions on Overview", true);
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

await runStep("old Edit original addresses open the document in the one-document view", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  freshBundleId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const oldDocs = docs.filter((doc) => doc.side === "old" && doc.status === "ready");
  const newDoc = docs.find((doc) => doc.side === "new" && doc.status === "ready");
  // 옛 쪼개기 주소(/split) → 원문 고치기 주소(?edit=first) → 첫 Old 문서가 한 단으로, 주소에서는 값이 떨어진다
  await page.goto(`${BASE}/bundles/${freshBundleId}/split`);
  await wait(page, "assign-bar");
  await page.waitForURL(/\/assign$/, { timeout: T });
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  check("the old Split address lands on Assign with one document wide", (await getText(page, "assign-old-tag")) === "Old" && (await page.locator('[data-testid="assign-new"]').count()) === 0);
  check("no separate tool screen is left", (await page.locator('[data-testid="split-back-assign"], [data-testid="assign-open-split"]').count()) === 0);
  // 문서를 가리키면 그 문서가 열린다 - 둘째 Old 문서
  const second = oldDocs[1] ?? oldDocs[0];
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign?edit=${second.id}`);
  await page.waitForURL(/\/assign$/, { timeout: T });
  await page.waitForFunction((label) => document.querySelector('[data-testid="assign-old"] .pane-head')?.textContent?.includes(label), second.doc_code || second.file_name, { timeout: T });
  check("an address that names an Old document opens that document", true);
  // 이미 쓴 New 문서를 가리키면 그 원문이 한 단으로 열린다
  if (newDoc) {
    await page.goto(`${BASE}/bundles/${freshBundleId}/assign?edit=${newDoc.id}`);
    await wait(page, "assign-solo");
    await page.waitForURL(/\/assign$/, { timeout: T });
    check("an address that names a written New document opens its original", (await getText(page, "assign-old-tag")).includes("New"));
    await takeShot("sop-assign-from-edit-address.png");
  }
  // Documents의 미리 보기에서도 같은 곳으로 온다
  await page.goto(`${BASE}/bundles/${freshBundleId}/documents`);
  await page.locator(`[data-testid="documents-${oldDocs[0].id}-preview"]`).click();
  await wait(page, "documents-preview-split");
  check("the preview's button says where it goes", (await getText(page, "documents-preview-split")).trim() === "Open in Assign");
  await page.locator('[data-testid="documents-preview-split"]').click();
  await wait(page, "assign-bar");
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  check("Open in Assign opens the document wide", true);
  // 뒤 단계들은 양 단에서 시작한다
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
});


// 일부러 거절당하는 저장이 있어 콘솔 오류를 허용한다
// New 문서 목록은 칸마다 바로 저장한다(v1.0.33) - Save 단추와 초안이 없다. 떠나거나 Enter를 누르면 그 칸이 저장된다
const settleToBe = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-testid="tobe-saving"]')?.textContent === "", null, { timeout: T });
  await page.waitForLoadState("networkidle");
};
const readToBe = async (page, bundleId) => (await page.request.get(`${BASE}/api/bundles/${bundleId}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();

await runStep("new documents: nested rows, N/A detail, each cell saves as you leave it", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first().waitFor({ timeout: T });
  const codes = await page.locator('[data-testid$="-code"][data-testid^="tobe-id-"]').evaluateAll((els) => els.map((el) => el.value));
  check("SOP first, its WIs under it", codes[0] === "SOP-CF" && codes.slice(1).every((code) => code.startsWith("WI-")), codes.join(","));
  check("there is no Save button and no draft bar", (await page.locator('[data-testid="tobe-save"], [data-testid="tobe-dirty"]').count()) === 0);
  const sopRow = page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first();
  const sopKey = (await sopRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${sopKey}-toggle"]`).click();
  check("troubleshooting is N/A with its reason", await page.locator(`[data-testid="tobe-${sopKey}-na-procedures.troubleshooting"]`).isChecked());
  await takeShot("sop-tobe.png");
  const title = page.locator(`[data-testid="tobe-${sopKey}-title"]`);
  const before = await title.inputValue();
  const readTitle = async () => (await readToBe(page, halfBundleId)).docs.find((doc) => `id-${doc.id}` === sopKey).title;
  await title.fill(`${before} (edited)`);
  check("typing alone does not save", (await readTitle()) === before);
  await page.keyboard.press("Enter");
  await settleToBe(page);
  check("Enter saves the cell", (await readTitle()) === `${before} (edited)`);
  // Esc는 고치던 것을 버린다
  await title.fill("thrown away");
  await page.keyboard.press("Escape");
  check("Esc puts the saved text back", (await title.inputValue()) === `${before} (edited)`);
  await title.fill(before);
  await page.keyboard.press("Tab");
  await settleToBe(page);
  check("leaving the cell saves it too", (await readTitle()) === before);
  // N/A는 사유를 적어야 저장된다 - 체크만 하고 떠나면 거둔다
  // 문장이 들지 않은 칸으로 한다(문장이 든 칸은 서버가 N/A를 거절한다)
  const naBox = page.locator(`[data-testid="tobe-${sopKey}-na-document_relationships.appendices"]`);
  const wasNa = await naBox.isChecked();
  if (!wasNa) {
    await naBox.click();
    await wait(page, `tobe-${sopKey}-na-document_relationships.appendices-reason`);
    const countNa = async () => (await readToBe(page, halfBundleId)).na_slots.filter((slot) => slot.slot_key === "document_relationships.appendices").length;
    check("a checked N/A section is not saved before its reason", (await countNa()) === 0);
    await page.locator(`[data-testid="tobe-${sopKey}-na-document_relationships.appendices-reason"]`).fill("Smoke: covered elsewhere");
    await page.keyboard.press("Enter");
    await settleToBe(page);
    check("the reason saves the N/A section", (await countNa()) === 1);
    await naBox.click();
    await settleToBe(page);
    check("unchecking removes it at once", (await countNa()) === 0);
  }
  // 번호로 더하기 - Enter면 줄이 저장된다. 종류와 상위 SOP는 앱이 고르고 사람이 고친다
  const rowsBefore = (await readToBe(page, halfBundleId)).docs.length;
  await page.locator('[data-testid="tobe-add-code"]').fill("WI-99");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  const added = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "WI-99");
  check("a number and Enter add a saved row, as a WI under the SOP", added !== undefined && added.doc_type === "wi" && added.parent_code === "SOP-CF");
  // 이미 있는 번호는 더하지 않고 알린다
  await page.locator('[data-testid="tobe-add-code"]').fill("WI-99");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("a number already on the list is refused in words", (await getText(page, "toast-error")).includes("Already on the list"));
  // 번호를 고쳐도 같은 줄이다(줄 id가 그대로)
  await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).fill("WI-98");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  check("renaming keeps the same row", (await readToBe(page, halfBundleId)).docs.some((doc) => doc.id === added.id && doc.code === "WI-98"));
  // 다른 줄의 번호로는 못 고친다 - 서버가 거절하고 칸이 저장된 번호로 돌아간다
  await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).fill("SOP-CF");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]').last().waitFor({ timeout: T });
  await settleToBe(page);
  check("a refused change puts the saved number back", (await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).inputValue()) === "WI-98");
  // 장비 SOP로 표시한 줄을 WI로 바꾼다 - 표시가 함께 꺼져야 서버가 받는다(v1.0.36, 전에는 "Only an SOP can be an equipment SOP"로 거절됐다)
  await page.locator('[data-testid="tobe-add-code"]').fill("SOP-97");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  const marked = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "SOP-97");
  await page.locator(`[data-testid="tobe-id-${marked.id}-equipment"]`).click();
  await settleToBe(page);
  await page.locator(`[data-testid="tobe-id-${marked.id}-type"]`).click();
  await page.locator(`[data-testid="tobe-id-${marked.id}-type-option-wi"]`).click();
  await settleToBe(page);
  const markedAfter = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.id === marked.id);
  check("an equipment SOP turns into a WI and the mark goes off with it", markedAfter.doc_type === "wi" && markedAfter.is_equipment_sop === false, JSON.stringify({ type: markedAfter.doc_type, equipment: markedAfter.is_equipment_sop }));
  const removeMarked = page.locator(`[data-testid="tobe-id-${marked.id}-remove"]`);
  await removeMarked.scrollIntoViewIfNeeded();
  await removeMarked.hover();
  await removeMarked.click();
  await settleToBe(page);
  const remove = page.locator(`[data-testid="tobe-id-${added.id}-remove"]`);
  await remove.scrollIntoViewIfNeeded();
  await remove.hover();
  await remove.click();
  await settleToBe(page);
  check("removing the row saves at once", (await readToBe(page, halfBundleId)).docs.length === rowsBefore);
});

// 검토 v0.4.0: 앞 단계를 지워도 뒤 단계 번호가 그대로여야 한다(분류한 문장이 단계 번호를 가리킨다)
await runStep("new documents: removing a step keeps the other numbers", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first().waitFor({ timeout: T });
  const wiRow = page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').nth(1);
  const wiKey = (await wiRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  await wait(page, `tobe-${wiKey}-add-step`);
  const readNumbers = async () =>
    (await page.locator(`[data-testid^="tobe-${wiKey}-step-"]`).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))).map((id) => Number(id.split("-step-")[1]));
  const before = await readNumbers();
  const top = Math.max(0, ...before);
  for (const [offset, text] of [[1, "Smoke step A"], [2, "Smoke step B"]]) {
    await page.locator(`[data-testid="tobe-${wiKey}-add-step"]`).click();
    await wait(page, `tobe-${wiKey}-step-${top + offset}`);
    await settleToBe(page);
    await page.locator(`[data-testid="tobe-${wiKey}-step-${top + offset}"]`).fill(text);
    await page.keyboard.press("Enter");
    await settleToBe(page);
  }
  const removeFirst = page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 1}"]`);
  await removeFirst.hover();
  await removeFirst.click();
  await settleToBe(page);
  const after = await readNumbers();
  check("the later step keeps its number after an earlier one is removed", after.includes(top + 2) && !after.includes(top + 1), after.join(","));
  check("its title stays with its number", (await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).inputValue()) === "Smoke step B");
  check("the steps that were there are untouched", before.every((no) => after.includes(no)), `${before} -> ${after}`);
  // 저장이 끝난 목록이라 떠날 때 묻지 않는다
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await page.waitForURL(/\/assign$/, { timeout: T });
  check("leaving does not ask - nothing is left unsaved", (await page.locator('[data-testid="tobe-leave"]').count()) === 0);
  // 되돌리기
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  const removeSecond = page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 2}"]`);
  await removeSecond.waitFor({ timeout: T });
  await removeSecond.hover();
  await removeSecond.click();
  await settleToBe(page);
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
// 칸 줄을 고른다 - 나무는 칸마다 칸 제목 자리(assign-tree-place-heading:…)를 칸 줄 바로 앞에 두므로 그것은 건너뛴다(칸 제목은 고쳐 쓰기가 없다)
async function pickFirstPlace(page) {
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator('[data-testid^="assign-tree-p"]').first().click();
  await page.locator('[data-testid^="assign-tree-place-"]:not([data-testid^="assign-tree-place-heading:"]):not([disabled])').first().click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
}
const progressDone = async (page) => Number((await getText(page, "assign-progress")).split("/")[0]);

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
  // 삭제는 사유가 있어야 한다 - 사유 없이 저장하면 Remark 창이 열리고, 확인하면 저장을 잇는다
  await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  await page.locator('[data-testid="assign-primary"]').click();
  await wait(page, "assign-remark-modal");
  check("delete without a reason opens the Remark window, confirm off", await page.locator('[data-testid="assign-remark-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Structural heading");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 2, before, { timeout: T });
  check("delete with a reason confirms", true);
  // 고쳐 확정 - E로 새 문장을 고치면 변경 종류를 고른다. 고쳐 쓰기는 문장 줄에서만 되니 그림·표 줄이면 다음 줄로 넘어간다(합성 문서의 줄 순서에 기대지 않게)
  const isSentenceRow = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"][data-sel]').evaluateAll((els) => els.length > 0 && els.every((el) => ["ko", "en"].includes(el.getAttribute("lang") ?? "")));
  for (let step = 0; step < 10 && !(await isSentenceRow()); step += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
  }
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

await runStep("assign: H holds a unit without a destination, with a reason typed in", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  const unit = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]:not(.ptbl-cap)').nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  // 짝 줄이면 번호가 둘이다 - 첫 번호로 다시 찾는다
  const heldId = (await getText(page, "assign-row-id")).trim().split(" · ")[0];
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("h");
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Smoke: not sure where it goes");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("H holds the unit", true);
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, heldId);
  await page.waitForLoadState("networkidle");
  check("held unit shows on Assign with its reason", (await page.locator('[data-testid="assign-reason"]').textContent()) === "Smoke: not sure where it goes");
  check("it has no destination", (await page.locator('[data-testid="assign-chosen"].is-empty').count()) === 1);
  // 저장된 사유를 창에서 지우면 빈 채로 남는다
  await page.locator('[data-testid="assign-reason-edit"]').click();
  await wait(page, "assign-remark-modal");
  const listed = await page.locator('[data-testid="assign-remark-modal-recent-0"]').waitFor({ timeout: T }).then(() => true, () => false);
  check("the Remark window lists my recent remarks", listed);
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  check("a cleared reason stays empty", (await page.locator('[data-testid="assign-reason"]').textContent()) === "–");
});


await runStep("assign: hold an unassigned unit without a destination", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  check("hold is available with no destination", !(await page.locator('[data-testid="assign-hold"]').isDisabled()));
  // 사유 없이 보류하면 Remark 창이 열린다 - 최근 사유를 골라 확인하면 보류가 이어진다
  // 그 줄의 정보를 다 받은 뒤에 누른다 - 받는 동안의 Hold는 아무 일도 하지 않는다(느린 기계에서 이 단계가 떨어졌다)
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-hold"]').click();
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-recent-0"]').click();
  check("a recent remark fills the field", (await page.locator('[data-testid="assign-remark-modal-text"]').inputValue()).length > 0);
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("the unit is on hold", true);
});

await runStep("assign: a reference line asks for its number before it can be decided", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  // 위쪽 줄의 남은 수를 누르면 확인이 남은 참조 줄로 간다(합성 문서 7절의 한 줄)
  await page.locator('[data-testid="assign-ref-pending"]').click();
  await wait(page, "assign-ref");
  check("the pill goes to the proposed reference line", (await getText(page, "assign-ref-title")) === "Reference line?" && (await getText(page, "assign-ref-number")).includes("SOP-ABC-1016"), await getText(page, "assign-ref-number"));
  check("the paper marks the proposal", (await page.locator('.strip-lang[data-proposed]').count()) === 1);
  await pickFirstPlace(page);
  check("Confirm stays off until the number is checked", await page.locator('[data-testid="assign-primary"]').isDisabled());
  await page.locator('[data-testid="assign-ref-confirm"]').click();
  await page.locator('[data-testid="assign-ref"][data-state="confirmed"]').waitFor({ timeout: T });
  check("confirming the number makes it a reference line", (await getText(page, "assign-ref-title")) === "Reference line" && (await page.locator('[data-testid="assign-ref-pending"]').count()) === 0);
  check("the paper shows REF where KO or EN would be", (await page.locator('.strip[data-sel] .lang-token[data-lang="ref"]:not([data-proposed])').count()) === 1);
  await takeShot("sop-assign-ref.png");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator('[data-testid="assign-ref"][data-state="proposed"]').waitFor({ timeout: T });
  check("undo brings the proposal back", true);
  // 참조 아님 - 카드와 남은 수가 사라지고 다시 제안하지 않는다
  await page.locator('[data-testid="assign-ref-reject"]').click();
  await page.locator('[data-testid="assign-ref"]').waitFor({ state: "detached", timeout: T });
  // 원문을 다시 받은 뒤에 남은 수가 사라진다
  const isCountGone = await page.locator('[data-testid="assign-ref-pending"]').waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  check("Not a reference removes the card and the count", isCountGone);
});

await runStep("assign: move picks its target doc from the dropdown", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  if ((await page.locator('[data-testid="assign-pick-move"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-move"]').click();
  // 다른 Bundle의 To-Be 문서가 추천으로 뜬다(데모 Bundle 넷 모두 qa.member가 멤버)
  await page.locator('[data-testid="assign-move-code"]').click();
  await page.locator('[data-testid="assign-move-code"]').fill("SOP");
  const option = page.locator('[data-testid^="assign-move-code-option-"]:not([data-testid$="-typed"])').first();
  await option.waitFor({ timeout: T });
  const code = (await option.getAttribute("data-testid")).replace("assign-move-code-option-", "");
  await takeShot("sop-assign-move-dropdown.png");
  await option.click();
  check("a suggested target doc fills the field", (await page.locator('[data-testid="assign-move-code"]').inputValue()) === code, code);
  await page.locator('[data-testid="assign-primary"]').click();
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Smoke: belongs to another bundle");
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  check("move saves with the picked target", (await saved).ok());
});

// Old 문장 우클릭 메뉴(배정 + 문장 고치기) - 미배정 문장은 여기서 나누고 언어를 바꾸며, 배정된 문장의 고치기는 까닭과 함께 꺼져 있다
await runStep("assign: right-click an Old sentence to split it or change its language", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  const rows = (await getJson("/units?limit=1000")).items;
  const docId = rows[0].document_id;
  const viewUnits = async () => (await getJson(`/documents/${docId}/view`)).units;
  const target = (await viewUnits()).find((unit) => unit.kind === "sentence" && unit.text.length > 20 && rows.find((row) => row.unit_id === unit.id)?.status === "unassigned");
  const openMenu = async (unitId) => {
    const el = page.locator(`[data-testid="assign-paper-unit-${unitId}"]`).first();
    await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const box = await el.boundingBox();
    await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(12, box.height / 2), { button: "right" });
    await wait(page, "assign-ctx-menu");
  };
  await openMenu(target.id);
  await takeShot("sop-assign-context-menu.png");
  check("the menu has assign and edit groups", (await page.locator('[data-testid="assign-ctx-confirm"]').count()) === 1 && (await page.locator('[data-testid="assign-ctx-split"]').count()) === 1);
  check("confirm is off with no destination", (await page.locator('[data-testid="assign-ctx-confirm"]').getAttribute("aria-disabled")) === "true");
  // 언어 바꾸기
  const other = target.lang === "en" ? "ko" : "en";
  await page.locator(`[data-testid="assign-ctx-lang-${other}"]`).click();
  await page.waitForFunction(async ([path, id, lang]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.find((unit) => unit.id === id)?.lang === lang, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, target.id, other], { timeout: T });
  check("Language changes the unit's language from Assign", true);
  // 고친 뒤 화면이 원문을 다시 받아 그 줄을 다시 고른다 - 그 전에 메뉴를 열면 줄을 다시 고를 때 메뉴가 닫힌다
  await page.waitForLoadState("networkidle");
  await wait(page, "assign-row-id");
  // 여기서 나누기 - 선을 놓고 Split here
  const before = (await viewUnits()).length;
  await openMenu(target.id);
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  await page.waitForFunction(async ([path, count]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.length === count + 1, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, before], { timeout: T });
  check("Split here splits the sentence from Assign", true);
  await wait(page, "assign-row-id");
  check("the first piece's row is selected after the split", (await page.locator('[data-testid="assign-row-id"]').count()) === 1);
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

// 배정 화면에서 표를 행으로 나누거나 다시 합치고 되돌리기 - 우클릭 메뉴(전에는 쪼개기 화면에서만 했다). Ctrl+Z로 처음 모양으로 돌아온다
await runStep("assign: table rows from the right-click menu, then undo", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  // 배정이 없는 표 - 통째면 행으로 나누고, 앞 시나리오가 이미 나눠 두었으면 다시 합친다
  let doc = null;
  let holder = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.find((unit) => (unit.kind === "table" || unit.kind === "table_row") && unit.status === "unassigned");
    if (!found) continue;
    doc = candidate;
    holder = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id) ?? null;
    break;
  }
  check("the fresh bundle has an unassigned table", holder !== null);
  const action = holder.kind === "table" ? "table_rows" : "table_merge";
  const countKinds = async () => {
    const view = await readView(doc.id);
    return `${view.units.filter((unit) => unit.kind === "table").length} tables, ${view.units.filter((unit) => unit.kind === "table_row").length} rows`;
  };
  const before = await countKinds();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  // 표·행 단위는 제 조각이 없을 수 있다 - 그러면 그 표의 칸 문장을 누른다(그 문장의 줄이 골라지며 문서도 그리로 넘어간다)
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  if ((await pieceOf(holder.id).count()) === 0 && (cell === null || (await pieceOf(cell.id).count()) === 0)) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  }
  const target = (await pieceOf(holder.id).count()) > 0 || cell === null ? pieceOf(holder.id) : pieceOf(cell.id);
  await target.waitFor({ timeout: T });
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await wait(page, `assign-ctx-${action}`);
  check("the menu offers one direction only", (await page.locator(`[data-testid="assign-ctx-${action === "table_rows" ? "table_merge" : "table_rows"}"]`).count()) === 0);
  await takeShot("sop-assign-table-menu.png");
  if ((await page.locator(`[data-testid="assign-ctx-${action}"]`).getAttribute("aria-disabled")) === "true") {
    // 다른 행에 배정이 있는 표는 다시 합치지 못한다 - 항목이 잠기고 까닭이 붙는다
    check("a table with an assigned row keeps Merge rows back locked, with the reason", ((await page.locator(`[data-testid="assign-ctx-${action}"]`).getAttribute("data-tip")) ?? "").includes("row"));
    return;
  }
  await page.locator(`[data-testid="assign-ctx-${action}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-undo"]')?.disabled === false, null, { timeout: T });
  const changed = await countKinds();
  check(action === "table_rows" ? "the table becomes rows" : "the rows become one table again", changed !== before, `${before} -> ${changed}`);
  // 화면이 새 줄을 고른 뒤에 되돌린다 - 그 전에 되돌리면 막 사라진 단위의 정보를 한 번 불러 404가 콘솔에 찍힌다(사람 손으로는 나오지 않는 속도)
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => /table rows/i.test(toast.textContent ?? "")), null, { timeout: T });
  check("Undo puts the table back as it was", (await countKinds()) === before, await countKinds());
});

await runStep("split rows of a table, then assign a row as a table", { allowConsoleErrors: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents/${docId}/view`, { headers })).json();
  // 통째인 표가 있는 Old 문서 - 그 표의 칸 문장을 우클릭해 행으로 나눈다
  let doc = null;
  let table = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.find((unit) => unit.kind === "table");
    if (!found) continue;
    doc = candidate;
    table = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id) ?? null;
    break;
  }
  check("the fresh bundle has a whole table", table !== null);
  if (table === null) return;
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const target = (await pieceOf(table.id).count()) > 0 || cell === null ? pieceOf(table.id) : pieceOf(cell.id);
  await target.waitFor({ timeout: T });
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await wait(page, "assign-ctx-table_rows");
  await page.locator('[data-testid="assign-ctx-table_rows"]').click();
  // 판단이 걸린 표면 서버가 먼저 묻는다
  const confirm = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirm.click();
  let row = null;
  for (let tries = 0; tries < 60 && row === null; tries += 1) {
    row = (await readView(doc.id)).units.find((unit) => unit.kind === "table_row" && unit.table_id === table.table_id) ?? null;
    if (row === null) await page.waitForTimeout(250);
  }
  check("rows are split", row !== null, row?.display_id);
  if (row === null) return;
  await page.waitForLoadState("networkidle");
  await selectRowById(page, row.display_id);
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
  // 앞 단계가 첫 줄들을 보류로 둔다(H 보류·Assign 보류, AI 나눔을 되돌린 문장은 짝이 풀려 제 줄) - 요청 단추가 있는 미배정 줄까지 내려간다
  const aiRequest = page.locator('[data-testid="assign-ai-request"]');
  for (let step = 0; step < 10 && (await aiRequest.count()) === 0; step += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
  }
  await aiRequest.click();
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

// 한 단 · 양 단 보기(v1.0.20) - 문서 하나만 넓게 보고 돌아온다. 고른 보기는 브라우저에 기억된다
await runStep("assign: one document wide, then two again", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-new");
  const readOldWidth = async () => (await page.locator('[data-pane="old"]').boundingBox()).width;
  const twoWidth = await readOldWidth();
  // 보기를 바꾸면 Old 용지가 새 자리로 미끄러진다(v1.0.35) - 움직이는 동안의 표시는 금방 지워져서 누르기 전부터 지켜본다
  await page.evaluate(() => {
    window.__paneMotions = [];
    const panes = document.querySelector(".assign-panes");
    new MutationObserver(() => panes.dataset.motion && window.__paneMotions.push(panes.dataset.motion)).observe(panes, { attributes: true, attributeFilter: ["data-motion"] });
    // 접을 때 New 칸의 복제본이 잠깐 붙었다 떨어진다(v1.0.36)
    window.__paneGhosts = 0;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && "ghost" in node.dataset) window.__paneGhosts += 1;
    }).observe(panes, { childList: true });
  });
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  await page.locator(".assign-panes:not([data-motion])").waitFor({ timeout: T });
  check("switching the view slides the paper and then settles", (await page.evaluate(() => window.__paneMotions.join(","))) === "one" && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-pane="old"] .sheet')).transform)) === "none");
  check("the folded New pane fades out as a picture and is removed", (await page.evaluate(() => window.__paneGhosts)) === 1 && (await page.locator("[data-ghost]").count()) === 0);
  check("one view hides the New pane and the divider", (await page.locator('[data-testid="assign-divider"]').count()) === 0);
  check("the Old pane takes the freed width", (await readOldWidth()) > twoWidth * 1.5);
  // 한 단에서도 줄을 고르면 보낼 곳이 보이고, 직접 잇기는 양 단이 필요하다는 안내가 뜬다
  await page.locator(".strip[data-strip-unit]").first().click();
  await wait(page, "assign-single-hint");
  check("the destination list still works in one view", (await page.locator('[data-testid="assign-pick"]').count()) === 1);
  await takeShot("sop-assign-single.png");
  await page.reload();
  await wait(page, "assign-view-one");
  check("the view is remembered after a reload", (await page.locator('[data-testid="assign-view-one"]').getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="assign-new"]').count()) === 0);
  await page.locator(".strip[data-strip-unit]").first().click();
  await wait(page, "assign-single-hint-two");
  await page.locator('[data-testid="assign-single-hint-two"]').click();
  await wait(page, "assign-new");
  check("the hint's button brings both documents back", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === "true");
  // 글쇠 V로 오간다 - 입력 칸 밖에서
  await page.locator('[data-testid="assign-view-two"]').blur();
  await page.keyboard.press("v");
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  // 출처 없는 New 문장은 New 칸에서 보므로 양 단으로 편다
  await page.locator('[data-testid="assign-filter-unsourced"]').click();
  await wait(page, "assign-new");
  check("New without source opens both documents", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === "true");
  // 세로선을 오른쪽 끝까지 끌어 놓으면 한 단
  const panes = await page.locator(".assign-panes").boundingBox();
  const divider = await page.locator('[data-testid="assign-divider"]').boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(panes.x + panes.width - 8, divider.y + divider.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  check("dragging the divider to the right edge folds the New pane", (await page.locator('[data-testid="assign-view-one"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
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
  // 비슷한 New 문장 후보(점선)가 있는 Old 조각까지 옮긴다
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
  // 고른 Old 줄의 언어들 - 줄에 없는 언어의 New 문장도 이을 수 있는지(언어 잠금 없음) 보려면 한 언어 줄이어야 한다
  const readRowLangs = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"][data-sel]').evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("lang") ?? "neutral"))]);
  const otherLangLines = async () => {
    const langs = await readRowLangs();
    if (langs.length !== 1 || langs[0] === "neutral") return null;
    return page.locator(`[data-testid="assign-new"] .new-line:not([data-state="picked"]):not([data-lang="${langs[0]}"]):not([data-lang="neutral"])`);
  };
  // 참조 줄 제안이 남은 줄은 번호를 확인하기 전에는 확정되지 않는다 - 이 단계는 그런 줄을 건너뛴다
  const isReady = async () => (await candidate.count()) > 0 && (await page.locator('[data-testid="assign-ref"]').count()) === 0 && (await (await otherLangLines())?.count() ?? 0) > 0;
  for (let step = 0; step < 40 && !(await isReady()); step += 1) {
    await page.keyboard.press("j");
    // 요청이 나갈 틈(문장이 없는 줄은 요청이 없다) → 걸린 요청이 없을 때까지 → 응답을 그릴 틈
    await page.waitForTimeout(150);
    while (openCandidateRequests > 0) await page.waitForTimeout(50);
    await page.waitForTimeout(100);
  }
  // 누르면 후보가 아니라 고른 문장이 된다 - 같은 줄을 계속 가리키게 testid로 붙잡는다
  const firstLine = page.locator(`[data-testid="${await candidate.first().getAttribute("data-testid")}"]`);
  // 줄 가운데를 누르면 오른쪽 출처 칩에 닿을 수 있다 - 고르는 단추를 누른다
  await firstLine.locator(".new-hit").click();
  check("clicking a New sentence picks it", (await firstLine.getAttribute("data-state")) === "picked");
  // 맥에서 Ctrl+클릭은 오른쪽 클릭이다 - 화면은 ⌘도 같은 뜻으로 받는다
  const multi = process.platform === "darwin" ? "Meta" : "Control";
  // 둘째 줄은 줄에 없는 언어의 문장을 고른다 - 언어로 막지 않고 이을 수 있다(번역)
  const rowLangs = await readRowLangs();
  const unpicked = await otherLangLines();
  const second = page.locator(`[data-testid="${await unpicked.first().getAttribute("data-testid")}"]`);
  const secondLang = await second.getAttribute("data-lang");
  await second.locator(".new-hit").click({ modifiers: [multi] });
  await page.locator('[data-testid^="assign-link-"]').nth(1).waitFor({ timeout: T });
  check("Ctrl+click adds a second sentence", (await page.locator('[data-testid^="assign-link-"]').count()) >= 2);
  check(
    "a sentence in another language is not locked",
    !rowLangs.includes(secondLang) && (await second.getAttribute("data-state")) === "picked",
    `row ${rowLangs.join("+")}, picked ${secondLang}`,
  );
  await takeShot("sop-assign-link.png");
  // 첫 줄만 다시 누르면 고름이 그 문장(과 New 짝)으로 돌아간다 - 둘째의 짝이 함께 붙었을 수 있어 Ctrl로 하나씩 빼지 않는다
  await firstLine.locator(".new-hit").click();
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

// 한 언어만 잇기(v0.11.1) - Old는 한/영 짝인데 쓴 New에는 한 언어만 있는 예외. 있는 언어만 이어 확정하면 서버가 같은 저장 안에서
// 짝을 풀고(release_unit_ids - 화면이 짝 풀기를 따로 부르지 않는다) 남은 문장이 제 줄이 되어 사람이 삭제(Remark)나 보류로 끝낸다
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
  const pairDeletes = [];
  const countPairDelete = (request) => {
    if (request.method() === "DELETE" && request.url().includes("/pairs/")) pairDeletes.push(request.url());
  };
  page.on("request", countPairDelete);
  await page.locator('[data-testid="assign-primary"]').click();
  const savedResponse = await saved;
  check("the one-language link saves", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  const savedBody = savedResponse.ok() ? await savedResponse.json() : {};
  check("the save sends the leftover and the server dissolves the pair", JSON.parse(savedResponse.request().postData() ?? "{}").release_unit_ids?.includes(found.leftover.id) && (savedBody.pairs_dissolved ?? []).includes(found.pairId), JSON.stringify(savedBody.pairs_dissolved));
  // 남은 문장이 제 줄로 골라진다 - 다음 줄로 넘어가지 않는다
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, found.leftover.display_id, { timeout: T });
  check("the leftover sentence is picked as its own open row", (await rowStatus(page)) === "Unassigned", await rowStatus(page));
  page.off("request", countPairDelete);
  check("the screen sends no separate unpair request", pairDeletes.length === 0, pairDeletes.join(", "));
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
  await page.locator('[data-testid="assign-reason-edit"]').click();
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("No counterpart in the new document");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
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
  // 번쩍임은 1.3초 뒤 꺼지고 메뉴는 1초쯤 뒤에 뜬다 - 메뉴를 기다린 뒤에 찾으면 놓칠 수 있어 누르기 전부터 지켜본다
  await page.evaluate(() => {
    window.__flashedTarget = null;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target.hasAttribute("data-flash") && record.target.closest('[data-pane="new"]')) window.__flashedTarget = record.target.getAttribute("data-target");
      }
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-flash"] });
  });
  await note.click();
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  check("the jump lands on the linked New sentence", (await page.evaluate(() => window.__flashedTarget)) !== null);
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

// 칸 제목(제품 명세 §7.13 칸 제목) -옛 제목 짝을 SOP 칸의 칸 제목 자리로 확정하면 결과물 C와 Assign의 엮은 문서 미리 보기에서 칸 머리 옆에 "← OLD-1 §1"로 보인다. 끝에 원래 처분(지우기)으로 되돌린다
await runStep("assign: an old heading confirmed as a slot heading shows on C and on the composed New pane", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
  const headingRow = (await getJson("/units?limit=1000")).items.find((unit) => unit.kind === "heading" && unit.pair_id !== null);
  check("the bundle has an SOP to write and an old heading pair", Boolean(sop && headingRow), `${sop?.code} ${headingRow?.display_id}`);
  const before = headingRow.decision;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, headingRow.display_id);
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator(`[data-testid="assign-tree-p${sop.code}"]`).click();
  const headingPlace = page.locator(`[data-testid^="assign-tree-place-heading:${sop.id}:"]:not([disabled])`).first();
  const slotKey = (await headingPlace.getAttribute("data-testid")).split(":").at(-1);
  await headingPlace.click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
  const chosen = await getText(page, "assign-chosen");
  check("the chosen place reads as the slot heading of that SOP", chosen.includes("Slot heading") && chosen.includes(sop.code), chosen);
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  check("the slot heading saves", (await saved).ok());
  const c = await getJson("/outputs/c?lang=en");
  const section = c.docs.find((doc) => doc.target_doc_id === sop.id)?.sections.find((item) => item.location_key === slotKey);
  check("C carries the heading note for that slot", section?.heading_note.startsWith("←") && section.heading_note.includes("OLD-1"), section?.heading_note);
  // 엮은 문서 미리 보기 - 문서 고르기에서 그 "not written" 문서를 연다
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
  const paneNote = page.locator(`[data-testid="assign-new-heading-note-${section.number}"]`);
  await paneNote.waitFor({ timeout: T });
  check("the composed New pane shows the same note after the slot name", ((await paneNote.textContent()) ?? "").trim() === section.heading_note, await paneNote.textContent());
  await takeShot("sop-assign-slot-heading.png");
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await page.locator('[data-testid="outputs-tab-c"]').click();
  const cNote = page.locator(`[data-testid="output-c-heading-note-${sop.id}-${slotKey}"]`);
  await cNote.waitFor({ timeout: T });
  check("C shows the note next to the slot head", ((await cNote.textContent()) ?? "").trim().startsWith("←"), await cNote.textContent());
  await takeShot("sop-outputs-c-heading.png");
  // 되돌린다 - 원래 지우기(사유가 남아 있지 않으면 Remark 창에 적는다)
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, headingRow.display_id);
  if ((await page.locator('[data-testid="assign-pick-delete"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  const restored = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const modal = page.locator('[data-testid="assign-remark-modal"]');
  if (await modal.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await page.locator('[data-testid="assign-remark-modal-text"]').fill(before.reason || "Structural heading");
    await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  }
  check("the heading goes back to deleted", (await restored).ok());
  const after = (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === headingRow.unit_id);
  check("its decision is deleted and confirmed again", after.decision.disposition === "delete" && after.decision.status === "confirmed", JSON.stringify(after.decision));
});

await runStep("outputs: A, B, C and the Excel preview", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  check("C shows the new documents", (await getText(page, "output-c")).includes("SOP-CF"));
  check("no edition toggle on the outputs screen", (await page.locator('[data-testid^="outputs-lang"]').count()) === 0);
  await takeShot("sop-outputs-c.png");
  await page.locator('[data-testid="outputs-tab-a"]').click();
  await wait(page, "output-a");
  check("A lists unit rows", (await page.locator('[data-testid="output-a"] tbody tr').count()) > 10);
  check("A's first Row cell is 1", (await getText(page, "output-a-row-no-0")).trim() === "1", await getText(page, "output-a-row-no-0"));
  await page.locator('[data-testid="outputs-tab-b"]').click();
  await wait(page, "output-b");
  check("B shows flows from old documents", (await getText(page, "output-b")).includes("OLD-1"));
  // Export Excel은 미리보기 창을 먼저 연다 - 파일과 같은 시트 다섯 장, 받기는 창에서
  await page.locator('[data-testid="outputs-export-open"]').click();
  await wait(page, "export-preview");
  await wait(page, "export-preview-sheet");
  const tabs = await page.locator('[data-testid^="export-preview-tab-"]').allInnerTexts();
  check("the preview has the five sheet tabs in file order", JSON.stringify(tabs.map((name) => name.trim())) === JSON.stringify(["A Comparison", "B Flow", "C New documents", "Info", "Documents"]), JSON.stringify(tabs));
  await takeShot("sop-outputs-preview.png");
  const download = page.waitForEvent("download", { timeout: T });
  await page.locator('[data-testid="export-preview-download"]').click();
  // 헤드리스 Chrome은 blob 내려받기 이름을 "download"로 알린다 - 이름 규칙은 단위 테스트가 본다
  await download;
  check("Excel download starts", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="export-preview"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === true, null, { timeout: T });
  check("meaning check saves", true);
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === false, null, { timeout: T });
});

await runStep("order: indent a line on C and its section number changes", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 들일 수 있는 첫 줄(앞줄이 있고 번호가 있는 줄)
  const button = page.locator('[data-testid^="output-c-indent-"]:not([disabled])').first();
  const targetId = (await button.getAttribute("data-testid")).replace("output-c-indent-", "");
  const number = page.locator(`[data-testid="output-c-number-${targetId}"]`);
  const before = (await number.innerText()).trim();
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).hover();
  const indented = waitOrderSave(page);
  await button.click();
  check("the indent saves", (await indented).ok());
  const after = (await number.innerText()).trim();
  check("indenting adds a level to the number", after.split(".").length === before.split(".").length + 1, `${before} -> ${after}`);
  await takeShot("sop-outputs-c-indent.png");
  // 줄을 눌러 고른 뒤 Shift+Tab이 내어 쓴다
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).click({ position: { x: 4, y: 4 } });
  const outdented = waitOrderSave(page);
  await page.keyboard.press("Shift+Tab");
  check("the outdent saves", (await outdented).ok());
  check("Shift+Tab on the picked row outdents it back", (await number.innerText()).trim() === before);
});

await runStep("order: mark a line as a note on C, the count continues and the note is italic", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
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
  const marked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).click();
  check("the note mark saves", (await marked).ok());
  check("the note has no number", (await page.locator(`[data-testid="output-c-number-${pair.x}"]`).count()) === 0);
  const yAfter = (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim();
  check("the next numbered line continues the count", yAfter === pair.xNumber, `${pair.yNumber} -> ${yAfter} (expected ${pair.xNumber})`);
  const fontStyle = await page.locator(`[data-testid="output-c-item-${pair.x}"]`).evaluate((node) => getComputedStyle(node).fontStyle);
  check("the note is shown in italics", fontStyle === "italic", fontStyle);
  check("the note button shows as picked", (await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).getAttribute("aria-pressed")) === "true");
  await takeShot("sop-outputs-c-note.png");
  // 되돌려 둔다 - 아래 단계와 다시 돌리기가 같은 번호를 본다
  await page.locator(`[data-testid="output-c-row-${pair.x}"]`).hover();
  const unmarked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-mark-numbered-${pair.x}"]`).click();
  check("the Numbered mark saves", (await unmarked).ok());
  check("Numbered brings the number back", (await page.locator(`[data-testid="output-c-number-${pair.x}"]`).innerText()).trim() === pair.xNumber);
  check("the next line gets its number back", (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim() === pair.yNumber);
});

// 순서 바꾸기는 화면에서 먼저 자리를 바꾸고 저장은 뒤에서 한 번에 하나씩 보낸다(제품 명세 §7.13 C 순서 바꾸기). 실패하면 되돌리고 알림을 띄운다
await runStep("order: C reorder moves at once, saves one request at a time and rolls back a failed save", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 위·아래 단추가 있는 줄이 넷 이상인 칸 - 첫 줄을 세 번 내릴 수 있다
  const [reorderHit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')]
        .filter((row) => row.querySelector('[data-testid^="output-c-move-down-"]'))
        .map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  });
  check("a New document has a section with four movable lines", reorderHit !== undefined);
  const [reorderDoc, sectionRows] = reorderHit;
  const readOrder = () => page.evaluate((first) => {
    const section = document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section");
    return [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
  }, sectionRows[0]);
  const id = sectionRows[0];
  const start = await readOrder();
  const startIndex = start.indexOf(id);

  // 1. 바로 반영·한 번에 하나 - 응답을 600ms 늦추고 동시에 날아가는 PUT과 C·요약 다시 받기를 센다
  let inFlight = 0;
  let maxInFlight = 0;
  let puts = 0;
  let refetches = 0;
  page.on("request", (request) => {
    if (isOrderSave(request)) {
      puts += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    }
    if (request.method() === "GET" && /\/outputs\/c(\?|$)|\/summary(\?|$)/.test(request.url())) refetches += 1;
  });
  const settle = (request) => {
    if (isOrderSave(request)) inFlight -= 1;
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  // 응답 처리가 다음 요청을 보내기 전 잠깐 0이 될 수 있어, 늦춘 시간보다 길게 0이 이어질 때까지 본다
  const waitSavesIdle = async () => {
    const until = Date.now() + T;
    let quietSince = null;
    while (Date.now() < until) {
      if (inFlight === 0) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince > 900) return true;
      } else {
        quietSince = null;
      }
      await page.waitForTimeout(50);
    }
    return false;
  };
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  const down = page.locator(`[data-testid="output-c-move-down-${id}"]`);
  // 기다림 없이 세 번 - 미끄러지는 동안에도 눌린다(좌표 대신 그 단추에 바로 보낸다)
  for (let n = 0; n < 3; n += 1) await down.dispatchEvent("click");
  const moved = await readOrder();
  check("three presses move the line three places before the first response", moved.indexOf(id) === startIndex + 3, `${startIndex} -> ${moved.indexOf(id)} (puts ${puts})`);
  await takeShot("sop-outputs-c-reorder.png");
  check("the saves finish", await waitSavesIdle());
  check("no more than one save is in flight at a time", maxInFlight <= 1, `max ${maxInFlight}`);
  check("the presses merge into at most two saves", puts >= 1 && puts <= 2, `${puts} PUT`);
  check("reordering refetches neither C nor the summary", refetches === 0, `${refetches} GET`);
  await page.reload();
  // 새로 고치면 첫 문서부터 열린다 - 옮긴 문서를 다시 연다
  await page.locator(`[data-testid="order-doc-${reorderDoc}"]`).click();
  await wait(page, `output-c-row-${id}`);
  check("after reload the order is the saved one", JSON.stringify(await readOrder()) === JSON.stringify(moved));

  // 2. 키보드 - 위 단추에 포커스를 두고 Enter 두 번. 포커스는 옮긴 줄의 그 단추에 남는다
  await page.locator(`[data-testid="output-c-move-up-${id}"]`).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const afterKeys = await readOrder();
  check("two Enters move the line up two places", afterKeys.indexOf(id) === startIndex + 1, `${afterKeys.indexOf(id)}`);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("focus stays on the pressed button", focused === `output-c-move-up-${id}`, focused);
  check("the keyboard saves finish", await waitSavesIdle());

  // 3. 실패 되돌림 - 한 번만 500(늦춰서 되돌리기 전의 옮긴 자리를 본다)
  await page.unroute("**/targets/order**");
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  }, { times: 1 });
  const failed = waitOrderSave(page);
  // 5xx는 서버가 저장했을 수 있어 C를 다시 받아 서버 값을 보인다
  const refetchedAfterError = page.waitForResponse((response) => response.request().method() === "GET" && /\/outputs\/c\?/.test(response.url()), { timeout: T });
  await down.dispatchEvent("click");
  check("the line moves at once even when the save will fail", (await readOrder()).indexOf(id) === startIndex + 2);
  await failed;
  await wait(page, "toast-error");
  check("a server error reads C again", (await refetchedAfterError).ok());
  await page.waitForFunction(({ first, index }) => {
    const section = document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section");
    const ids = [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
    return ids.indexOf(first) === index;
  }, { first: id, index: startIndex + 1 }, { timeout: T });
  check("a failed save puts the line back and shows an error", true);
  await takeShot("sop-outputs-c-rollback.png");
  await page.unroute("**/targets/order**");

  // 되돌려 둔다 - 다시 돌려도 같은 자리에서 시작한다
  const restored = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-move-up-${id}"]`).dispatchEvent("click");
  check("the line goes back to where it started", (await restored).ok() && (await readOrder()).indexOf(id) === startIndex);
});

// 저장과 다시 받기가 엇갈려도 저장된 바뀜이 사라지지 않고, 한 번의 409는 알림 하나이며, 떠났다 돌아와도 저장이 겹치지 않는다
await runStep("order: C saves survive a slow refetch, one conflict toasts once, leaving does not race", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 문서마다 위·아래 단추가 있는 줄이 셋 이상인 첫 칸 - 그 칸의 첫 줄을 옮긴다
  const raceDocs = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].filter((row) => row.querySelector('[data-testid^="output-c-move-down-"]')).map((row) => row.getAttribute("data-flip-key"));
      if (ids.length >= 3) return ids;
    }
    return null;
  }, 2);
  check("two New documents have a section of three movable lines", raceDocs.length >= 2, `${raceDocs.length}`);
  const [[firstDoc, first], [secondDoc, second]] = raceDocs;
  // 줄이 든 문서를 먼저 연다 - 화면에는 한 문서만 있다. 문서를 바꿔도 저장을 기다리는 바뀜은 남는다
  const openDocOf = (id) => page.locator(`[data-testid="order-doc-${first.includes(id) ? firstDoc : secondDoc}"]`).click();
  const orderOf = async (id) => {
    await openDocOf(id);
    return page.evaluate((key) => {
      const section = document.querySelector(`[data-testid="output-c-row-${key}"]`)?.closest("section");
      return [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-flip-key"));
    }, id);
  };
  const press = async (dir, id) => {
    await openDocOf(id);
    await page.locator(`[data-testid="output-c-move-${dir}-${id}"]`).dispatchEvent("click");
  };
  let inFlight = 0;
  let maxInFlight = 0;
  page.on("request", (request) => {
    if (isOrderSave(request)) maxInFlight = Math.max(maxInFlight, (inFlight += 1));
  });
  const settle = (request) => {
    if (isOrderSave(request)) inFlight -= 1;
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  const waitIdle = async () => {
    for (let quiet = 0; quiet < 12; ) {
      await page.waitForTimeout(100);
      quiet = inFlight === 0 ? quiet + 1 : 0;
    }
  };
  // 오류 알림이 몇 번 떴는지 - 알림은 몇 초 뒤 사라지므로 나타날 때마다 센다(새로 고치면 다시 건다)
  const countErrorToasts = () => page.evaluate(() => {
    window.__errorToasts = 0;
    const isErrorToast = (node) => node instanceof Element && (node.matches('[data-testid="toast-error"]') || node.querySelector('[data-testid="toast-error"]') !== null);
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (isErrorToast(node)) window.__errorToasts += 1;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await countErrorToasts();
  const errorToasts = () => page.evaluate(() => window.__errorToasts);

  // 1. 다시 받는 C가 저장보다 늦게 오면 - 서버는 바로 읽고(저장 전) 화면에는 1.5초 늦게 준다. 언어를 바꿔 C를 다시 받기 시작한 뒤 누른다
  const firstIndex = (await orderOf(first[0])).indexOf(first[0]);
  let delayedC = 0;
  let deliveredC = 0;
  await page.route(/\/outputs\/c\?/, async (route) => {
    delayedC += 1;
    const response = await route.fetch();
    await new Promise((done) => setTimeout(done, 1500));
    await route.fulfill({ response });
    delayedC -= 1;
    deliveredC += 1;
  });
  await page.locator('[data-testid="top-bar-lang-ko"]').click();
  const savedFirst = waitOrderSave(page);
  await press("down", first[0]);
  check("the save during a refetch is answered", (await savedFirst).ok());
  // 저장 전에 읽은 C와 저장 뒤 다시 받는 C가 모두 도착할 때까지 - 시간만 기다리면 늦은 C가 오기 전에 보고 지나갈 수 있다
  const deliveredBy = Date.now() + T;
  while ((deliveredC === 0 || delayedC > 0) && Date.now() < deliveredBy) await page.waitForTimeout(50);
  check("the delayed C reads arrive", deliveredC > 0 && delayedC === 0, `${deliveredC} delivered, ${delayedC} waiting`);
  await page.waitForTimeout(300);
  check("a C read before the save does not undo the moved line", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 1, JSON.stringify(await orderOf(first[0])));
  await page.unroute(/\/outputs\/c\?/);
  await page.locator('[data-testid="top-bar-lang-en"]').click();
  await page.waitForTimeout(800);
  const backFirst = waitOrderSave(page);
  await press("up", first[0]);
  check("the line moves back", (await backFirst).ok() && (await orderOf(first[0])).indexOf(first[0]) === firstIndex);

  // 2. 한 번의 409 - 날아가는 첫 문서 저장이 409, 두 번째 문서는 기다리다 다시 읽은 C 위에서 저장된다. 알림은 하나
  await waitIdle();
  const toastsBefore = await errorToasts();
  let conflicted = false;
  await page.route("**/targets/order**", async (route) => {
    if (conflicted) return route.continue();
    conflicted = true;
    await new Promise((done) => setTimeout(done, 600));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "revision_conflict", conflicts: [] } }) });
  });
  const secondIndex = (await orderOf(second[0])).indexOf(second[0]);
  await press("down", first[0]);
  await press("down", second[0]);
  await page.waitForTimeout(3000);
  await waitIdle();
  check("one conflict shows one error", (await errorToasts()) - toastsBefore === 1, `${(await errorToasts()) - toastsBefore} errors`);
  check("the conflicted line is put back", (await orderOf(first[0])).indexOf(first[0]) === firstIndex);
  check("the other document's waiting move is saved after the reload", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  await page.unroute("**/targets/order**");
  await page.reload();
  await openDocOf(second[0]);
  await wait(page, `output-c-row-${second[0]}`);
  check("after reload the other document keeps its move", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  const backSecond = waitOrderSave(page);
  await press("up", second[0]);
  check("the other line moves back", (await backSecond).ok());

  // 3. 떠났다 금방 돌아오기 - 저장이 3초 걸리는 동안 개요로 갔다가 돌아와 또 누른다. 떠난 뒤 알림이 없고, 두 저장이 겹치지 않으며, 둘 다 남는다
  await countErrorToasts();
  maxInFlight = 0;
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue();
  });
  await press("down", first[0]);
  await page.locator('[data-testid="stage-nav-overview"]').click();
  await wait(page, "overview-gate-units");
  await page.locator('[data-testid="stage-nav-order"]').click();
  await openDocOf(first[0]);
  await wait(page, `output-c-row-${first[0]}`);
  check("after returning the line shows the first move", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 1, JSON.stringify(await orderOf(first[0])));
  await press("down", first[0]);
  await page.waitForTimeout(3500);
  await waitIdle();
  check("leaving and returning never sends two saves at once", maxInFlight <= 1, `max ${maxInFlight}`);
  check("no error after leaving and returning", (await errorToasts()) === 0, `${await errorToasts()} errors`);
  await page.unroute("**/targets/order**");
  await page.reload();
  await openDocOf(first[0]);
  await wait(page, `output-c-row-${first[0]}`);
  check("both moves are kept", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 2, JSON.stringify(await orderOf(first[0])));
  await takeShot("sop-outputs-c-races.png");
  for (let n = 0; n < 2; n += 1) {
    const back = waitOrderSave(page);
    await press("up", first[0]);
    await back;
  }
  check("the line goes back to where it started", (await orderOf(first[0])).indexOf(first[0]) === firstIndex);

  // 4. 409 뒤 다시 받는 C가 실패하면 - 기다리는 저장은 낡은 C 위에서 나가지 않고 멈춘 채 알림과 다시 시도가 보이며, 떠나려 하면 묻는다
  await waitIdle();
  let conflictedAgain = false;
  let heldPuts = 0;
  const countHeldPut = (request) => {
    if (isOrderSave(request)) heldPuts += 1;
  };
  page.on("request", countHeldPut);
  await page.route("**/targets/order**", async (route) => {
    if (conflictedAgain) return route.continue();
    conflictedAgain = true;
    await new Promise((done) => setTimeout(done, 600));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "revision_conflict", conflicts: [] } }) });
  });
  await page.route(/\/outputs\/c\?/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }), { times: 1 });
  await press("down", first[0]);
  await press("down", second[0]);
  await wait(page, "output-c-reload-error");
  await page.waitForTimeout(800);
  check("a failed C read after a conflict shows a notice with a retry", await page.locator('[data-testid="output-c-reload-retry"]').isVisible());
  check("the waiting move stays on screen", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  check("the held save is not sent on the old C", heldPuts === 1, `${heldPuts} PUT`);
  await takeShot("sop-outputs-c-reload-error.png");
  await page.locator('[data-testid="stage-nav-overview"]').click();
  await wait(page, "outputs-leave");
  check("leaving with a waiting save asks first", true);
  await page.locator('[data-testid="outputs-leave-cancel"]').click();
  const heldSaved = waitOrderSave(page);
  await page.locator('[data-testid="output-c-reload-retry"]').click();
  check("after retry the held move is saved on the fresh C", (await heldSaved).ok());
  await waitIdle();
  page.off("request", countHeldPut);
  await page.unroute("**/targets/order**");
  check("the conflicted line is back and the held move kept", (await orderOf(first[0])).indexOf(first[0]) === firstIndex && (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);

  // 5. 저장을 기다리는 바뀜이 남은 채 브라우저 뒤로 - 이탈 확인 창이 막지 못하는 길이라 떠난 뒤 알린다. 날아가던 저장만 남는다
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 2000));
    await route.continue();
  });
  // 위(날아감) 다음 아래(기다림) - 그 줄은 칸의 첫 줄 바로 아래라 위로 두 번은 칸 끝에 걸린다
  const leftSave = waitOrderSave(page);
  await press("up", second[0]);
  await press("down", second[0]);
  await page.goBack();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-error"]')].some((toast) => toast.textContent?.includes("Some changes in C were not saved.")), null, { timeout: T });
  check("leaving with an unsent change says so", true);
  check("the save in flight when leaving still lands", (await leftSave).ok());
  await page.unroute("**/targets/order**");
  await page.locator('[data-testid="stage-nav-order"]').click();
  await openDocOf(second[0]);
  await wait(page, `output-c-row-${second[0]}`);
  check("only the save in flight when leaving is kept", (await orderOf(second[0])).indexOf(second[0]) === secondIndex, JSON.stringify(await orderOf(second[0])));
});

// 작성자가 요청을 거둔 뒤 다시 요청해 둔다 - 아래 검토자 단계가 같은 Bundle을 검토 대기로 받는다
await runStep("review: author withdraws the request and asks again", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
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
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
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
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  await wait(page, "output-c");
  check("the review page has no edition toggle", (await page.locator('[data-testid^="review-lang"]').count()) === 0);
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
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign?edit=first`);
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
  // 맞는 줄 = 엿보기가 아닌 조각(이웃한 짝 카드의 둘째 줄부터는 첫 줄과 한 줄)
  const fullCards = `${old} .strip-row:not([data-peek]) > .strip:not([data-bracket="middle"]):not([data-bracket="bottom"])`;
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
        // 필터 수가 0보다 크니 맞는 곳이 어딘가에 있다 - 빈 상태마다 바로 가기가 있어야 한다
        if (!sawEmpty) check("an empty part offers where the matches are", (await countOf('[data-testid^="assign-fold-go-"]')) > 0);
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
    // 잇기 메뉴는 누른 뒤 1초쯤 지나 뜬다 - 뜨기 전에 Esc를 누르면 닫을 것이 없고 뒤늦게 뜬 메뉴가 남는다
    await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
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
// 배정 화면에서 AI 나누기 제안 받기·적용·되돌리기(전에는 요청만 되고 적용은 쪼개기 화면에서 했다). AI가 꺼져 있으면 건너뛴다
// 배정된 문장에 적용하면 서버가 먼저 묻는다(409 confirm_required) - 콘솔에 오류로 찍히는 그 응답은 이 단계가 일부러 받는 것이다
await runStep("assign: AI split suggestions - ask for the whole document, apply one, undo", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const status = await page.request.get(`${BASE}/api/bundles/1/ai/status`, { headers });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-ai-menu"]').click();
  const wholeDoc = page.locator('[role="menuitem"]', { hasText: "AI split whole document" });
  check("the AI menu offers the whole-document split", (await wholeDoc.count()) === 1);
  await wholeDoc.click();
  // 앞 시나리오가 남긴 제안이 있으면 바로, 없으면 방금 보낸 작업이 끝난 뒤 뜬다
  const pill = page.locator('[data-testid="assign-split-pending"]');
  await pill.waitFor({ timeout: 90000 });
  await pill.click();
  await wait(page, "assign-split-suggestion");
  const pieces = await page.locator('[data-testid^="assign-split-piece-"]').count();
  check("the card previews the pieces", pieces >= 2, String(pieces));
  await takeShot("sop-assign-ai-split.png");
  const applyButton = page.locator('[data-testid="assign-split-apply"]');
  // 저장하지 않은 고름이 있는 문장은 적용이 잠긴다(다른 문장 고치기와 같은 규칙) - 적용할 수 있는 제안이 나올 때까지 다음으로 넘긴다
  let sawLocked = false;
  for (let step = 0; step < 40 && (await applyButton.getAttribute("aria-disabled")) === "true"; step += 1) {
    sawLocked = true;
    const next = page.locator('[data-testid="assign-split-next"]');
    if ((await next.count()) === 0) break;
    const row = (await getText(page, "assign-row-id")).trim();
    await next.click();
    await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before, row, { timeout: T });
    await wait(page, "assign-split-suggestion");
  }
  if (sawLocked) check("a sentence with an unsaved choice keeps Apply split locked", true);
  if ((await applyButton.getAttribute("aria-disabled")) === "true") {
    console.log("  (every suggested sentence is assigned - apply and undo not exercised)");
    return;
  }
  const rowBefore = (await getText(page, "assign-row-id")).trim();
  await applyButton.click();
  // 배정된 문장이면 한 번 묻는다(v1.0.21) - 확인하고 적용한다
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2500 }).then(() => true, () => false)) await confirmEdit.click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before && document.querySelector('[data-testid="assign-undo"]')?.disabled === false, rowBefore, { timeout: T });
  check("Apply split cuts the sentence and moves to the new piece", true);
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => toast.textContent?.includes("Cut")), null, { timeout: T });
  check("Undo takes the cut back", true);
});

// 오른쪽 칸의 세 걸음(v1.0.23) - 1 다듬기 · 2 보낼 곳 · 3 결정. 다듬기 줄의 단추는 우클릭 메뉴와 같은 일을 한다
await runStep("assign: the inspector walks Shape, Where it goes, Decide", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await wait(page, "assign-shape");
  const steps = await page.locator('[data-testid="assign-inspector"] .assign-step').allInnerTexts();
  check("the inspector has three numbered steps", steps.length === 3 && steps[0].includes("SHAPE") && steps[2].includes("DECIDE"), steps.join(" | "));
  const lines = page.locator('[data-testid^="assign-shape-line-"]');
  check("every sentence of the row has its own tool line", (await lines.count()) >= 1);
  // 머리의 아랫줄 - 고른 문장이 원문에서 놓인 쪽(v1.0.26)
  check("the head says which page of the original the sentence is on", /^(≈ )?p\.\d+$/.test((await getText(page, "assign-row-page")).trim()), await getText(page, "assign-row-page"));
  // 다듬기 줄에서 자를 자리를 놓는다 - 우클릭 메뉴의 Split here와 같은 일
  const split = page.locator('[data-testid^="assign-shape-split-"]:not([aria-disabled="true"])').first();
  await split.click();
  await wait(page, "assign-cut-run");
  check("Split in the Shape line places the cut on the paper", (await split.getAttribute("data-on")) !== null);
  await takeShot("sop-assign-shape.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-cut-run"]').waitFor({ state: "detached", timeout: T });
  // 앞·다음 줄 단추
  const rowBefore = (await getText(page, "assign-row-id")).trim();
  await page.locator('[data-testid="assign-row-next"]').click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before, rowBefore, { timeout: T });
  await page.locator('[data-testid="assign-row-prev"]').click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === before, rowBefore, { timeout: T });
  check("the head's arrows move to the next row and back", true);
});

// 이미 쓴 New 문서의 원문 다듬기(v1.0.27) - 전에는 원문 고치기 화면에서만 했다. New 칸 머리의 가위 단추가 그 문서를 한 단으로 열고, Old 문서와 같은 도구로 자르고 되돌린다
await runStep("assign: a written New document opens on its own with the same tools", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const newDoc = docs.find((doc) => doc.side === "new" && doc.status === "ready");
  check("the fresh bundle has a written New document", newDoc !== undefined);
  if (newDoc === undefined) return;
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${newDoc.id}/view`, { headers })).json()).units;
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readUnits()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const before = await readUnits();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-new-edit-original"]').click();
  await wait(page, "assign-solo");
  check("the scissors button opens the New document alone, in the one-document view", (await page.locator(".assign-panes").getAttribute("data-single")) !== null && (await getText(page, "assign-old-tag")).includes("New"));
  check("nothing is picked yet, and the panel says what to do", (await page.locator('[data-testid^="assign-shape-line-"]').count()) === 0 && (await getText(page, "assign-solo-note")).length > 0);
  const unit = before.find((item) => item.kind === "sentence" && item.pair_id === null && item.text.trim().split(" ").length >= 6);
  check("the New document has a sentence long enough to cut", unit !== undefined);
  if (unit === undefined) return;
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"], [data-testid="assign-paper-unit-${unit.id}"]`).first();
  await piece.waitFor({ timeout: T });
  await piece.click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, unit.display_id, { timeout: T });
  check("clicking a sentence picks it and offers its Shape line only", (await page.locator(`[data-testid="assign-shape-line-${unit.id}"]`).count()) === 1 && (await page.locator('[data-testid="assign-decide"]').count()) === 0);
  await takeShot("sop-assign-solo.png");
  // 우클릭 메뉴에는 고치기 항목만 있다(보낼 곳이 없는 문서다)
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-split");
  check("the right-click menu has no assignment items", (await page.locator('[data-testid="assign-ctx-confirm"], [data-testid="assign-ctx-clear"]').count()) === 0);
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  // 옛 문서의 문장이 이어져 있으면 한 번 묻는다
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirmEdit.click();
  check("Split here cuts the New sentence in two", await waitCount(before.length + 1));
  await page.waitForFunction((id) => { const now = document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim(); return now !== undefined && now !== "" && now !== id; }, unit.display_id, { timeout: T });
  check("the screen follows to the new piece", true);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo puts the sentence back", await waitCount(before.length));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="assign-paper-piece-"]').length > 0 && document.querySelector('[data-testid="assign-solo"]') !== null, null, { timeout: T });
  await page.waitForLoadState("networkidle");
  // 문서 고르기 한 칸에 옛 문서와 이미 쓴 New 문서가 함께 있다
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${oldDoc.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-old-tag"]')?.textContent === "Old", null, { timeout: T });
  check("picking an Old document in the same list goes back to assigning", (await page.locator('[data-testid="assign-solo"]').count()) === 0 && (await page.locator(".assign-panes").getAttribute("data-single")) !== null);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${newDoc.id}"]`).click();
  await wait(page, "assign-solo");
  check("the one-document list also offers the written New document", true);
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
  check("two documents closes it - the left side is an Old document again", (await page.locator('[data-testid="assign-solo"]').count()) === 0 && (await getText(page, "assign-old-tag")) === "Old");
});

// 양 단에서 New 문장 바로 다듬기(v1.0.29) - Old 줄을 고르지 않은 채 New 문장을 누르면 그 문장이 골라지고, 그 자리에서 자르고 되돌린다. Old 줄을 고른 채면 전처럼 잇는다
await runStep("assign: shape a written New sentence in place, in the two-document view", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const readWritten = async () => (await page.request.get(`${BASE}/api/bundles/${freshId}/written-sentences`, { headers })).json();
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readWritten()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const before = await readWritten();
  const target = before.find((item) => item.kind === "sentence" && item.new_unit_id !== null && item.partner_target_id === null && item.text.trim().split(" ").length >= 6);
  check("the written New document has a sentence that knows its unit", target !== undefined);
  if (target === undefined) return;
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.waitForLoadState("networkidle");
  const line = page.locator(`[data-testid="assign-new-${target.target_id}"]`);
  await line.waitFor({ timeout: T });
  await page.locator(`[data-testid="assign-new-pick-${target.target_id}"]`).click();
  await wait(page, "assign-solo");
  check("with no Old row picked, clicking a New sentence picks it for shaping", (await line.getAttribute("data-state")) === "shape" && (await page.locator(".assign-panes").getAttribute("data-single")) === null && (await getText(page, "assign-old-tag")) === "Old");
  const splitButton = page.locator('[data-testid^="assign-shape-split-"]:not([aria-disabled="true"])').first();
  await splitButton.waitFor({ timeout: T });
  check("the panel shows its Shape line and nothing to decide", (await page.locator('[data-testid^="assign-shape-line-"]').count()) === 1 && (await page.locator('[data-testid="assign-decide"]').count()) === 0);
  await splitButton.click();
  const cut = page.locator(`[data-testid="assign-new-cut-${target.target_id}"]`);
  await cut.waitFor({ timeout: T });
  const readCut = () => page.evaluate((id) => document.querySelector(`[data-testid="assign-new-cut-${id}"]`)?.previousSibling?.textContent?.length ?? -1, target.target_id);
  const placed = await readCut();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(({ id, was }) => (document.querySelector(`[data-testid="assign-new-cut-${id}"]`)?.previousSibling?.textContent?.length ?? -1) > was, { id: target.target_id, was: placed }, { timeout: T });
  check("the cut sits inside the sentence and the arrow keys move it", placed > 0 && (await readCut()) > placed);
  await takeShot("sop-assign-new-inplace.png");
  await page.locator('[data-testid="assign-cut-run"]').click();
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirmEdit.click();
  check("Split here cuts the New sentence where it stands", await waitCount(before.length + 1));
  await page.waitForFunction(() => document.querySelector('.new-line[data-state="shape"]') !== null, null, { timeout: T });
  check("the new piece is picked in the New pane", true);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo puts the sentence back", await waitCount(before.length));
  await page.waitForLoadState("networkidle");
  // Old 줄을 고른 채여도 우클릭은 그 New 문장의 고치기 메뉴다(보낼 곳 항목은 없다)
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-decide");
  const again = (await readWritten()).find((item) => item.text === target.text);
  await page.locator(`[data-testid="assign-new-${again.target_id}"]`).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  check("right-click on a New sentence opens its shaping menu, without assignment items", (await page.locator('[data-testid="assign-ctx-confirm"], [data-testid="assign-ctx-clear"]').count()) === 0);
  // 떨어진 문장과 짝 맺기도 이 칸에서 된다(v1.0.36 - 전에는 한 단으로 열어야 했다)
  check("the menu offers pairing with a distant sentence", (await page.locator('[data-testid="assign-ctx-pair_pick"]').count()) === 1);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-ctx-menu"]').waitFor({ state: "detached", timeout: T });
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-solo"]').waitFor({ state: "detached", timeout: T });
  check("Esc lets the New sentence go", true);
  // Old 줄을 고른 채 그냥 누르면 전처럼 그 줄에 잇는다
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-decide");
  await page.locator(`[data-testid="assign-new-pick-${again.target_id}"]`).click();
  await page.locator(".link-menu").waitFor({ timeout: T });
  check("with an Old row picked, clicking a New sentence still links", (await page.locator('[data-testid="assign-solo"]').count()) === 0);
  await page.keyboard.press("Escape");
});

// 머리말·꼬리말 탭의 설명 줄(v1.0.28) - 전에는 원문 고치기 화면에만 있었다. 장마다 어느 구역의 머리말인지 적힌다
await runStep("assign: header and footer sheets say where they are used", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  // 머리말이 있는 문서가 나올 때까지 Old 문서를 넘긴다
  const options = await (async () => {
    await page.locator('[data-testid="assign-old-doc"]').click();
    const ids = await page.locator('[data-testid^="assign-old-doc-option-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    await page.keyboard.press("Escape");
    return ids;
  })();
  let hasHeader = false;
  for (const option of options) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="${option}"]`).click();
    await page.waitForTimeout(400);
    if ((await page.locator('[data-testid="assign-tab-header"]').count()) > 0) {
      hasHeader = true;
      break;
    }
  }
  check("an Old document of the fresh bundle has a header", hasHeader);
  if (!hasHeader) return;
  check("the body has no caption", (await page.locator('[data-testid^="assign-sheet-cap-"]').count()) === 0);
  await page.locator('[data-testid="assign-tab-header"]').click();
  await page.locator('[data-testid^="assign-sheet-cap-"]').first().waitFor({ timeout: T });
  const caption = (await page.locator('[data-testid^="assign-sheet-cap-"]').first().innerText()).trim();
  check("each header sheet says which section uses it", /^(Section \d+ · |Header \d+)/.test(caption), caption);
  // 설명 줄이 붙어도 그 장의 문장은 전처럼 골라진다
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-row-id");
  check("a sentence on the header sheet is still picked as a row", (await getText(page, "assign-row-id")).trim().length > 0);
});

// 한 문장 ↔ 한/영 짝 바꾸기(v1.0.24) - 전에는 원문 고치기 화면에만 있었다. 짝인 줄을 한 문장으로 합치고, 합친 문장을 다시 짝으로 돌린다(풀기 + 짝 맺기를 한 번에)
await runStep("assign: switch a KO/EN pair to one sentence and back", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const toOne = page.locator('[data-testid="assign-shape-mode-one"]');
  const toPair = page.locator('[data-testid="assign-shape-mode-pair"]');
  let doc = null;
  let members = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const byPair = new Map();
    for (const item of view.units.filter((unit) => unit.pair_id !== null)) byPair.set(item.pair_id, [...(byPair.get(item.pair_id) ?? []), item]);
    const pairs = [...byPair.values()].filter((group) => group.length === 2 && group.every((unit) => unit.kind === "sentence" && unit.status === "unassigned"));
    if (pairs.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.waitForTimeout(600);
    for (const group of pairs) {
      if ((await pieceOf(group[0].id).count()) === 0) continue;
      await pieceOf(group[0].id).click();
      if (!(await toOne.waitFor({ timeout: 2500 }).then(() => true, () => false))) continue;
      // 떨어진 짝은 한 문장으로 합치지 않는다 - 이웃한 짝이 나올 때까지 넘긴다
      if ((await toOne.getAttribute("aria-disabled")) === "true") continue;
      doc = candidate;
      members = group;
      break;
    }
    if (members !== null) break;
  }
  check("the fresh bundle has a neighbouring KO/EN pair on screen", members !== null);
  if (members === null) return;
  const readUnits = async () => (await readView(doc.id)).units;
  const waitUnits = async (test) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const units = await readUnits();
      if (test(units)) return units;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const before = await readUnits();
  check("a pair row shows KO/EN pair as its shape", (await toPair.getAttribute("aria-pressed")) === "true" && (await toOne.getAttribute("aria-pressed")) === "false");
  await takeShot("sop-assign-shape-mode.png");
  await toOne.click();
  const merged = await waitUnits((units) => units.length === before.length - 1);
  check("One sentence merges the pair", merged !== null);
  if (merged === null) return;
  const one = merged.find((unit) => !before.some((item) => item.id === unit.id));
  check("the merged sentence holds both texts and can be taken apart", one !== undefined && one.can_unmerge === true && members.every((unit) => one.text.includes(unit.text.trim())));
  // 화면이 합친 문장의 줄을 고른 뒤 전환이 한 문장 쪽으로 눌려 있다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("the merged row shows One sentence as its shape", (await toPair.getAttribute("aria-disabled")) === null);
  await page.waitForLoadState("networkidle");
  await toPair.click();
  const back = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null));
  check("KO/EN pair takes it apart and pairs the two again", back !== null);
  if (back === null) return;
  const again = back.filter((unit) => members.some((item) => item.text === unit.text));
  check("the two sentences keep their languages and share one pair", again.length === 2 && new Set(again.map((unit) => unit.pair_id)).size === 1 && again.map((unit) => unit.lang).sort().join() === "en,ko");
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-pair"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("the row is a pair again on screen", true);
  // 배정된 한 문장을 짝으로 돌리면 한 번 묻는다 - 풀기가 배정을 지우기 때문이다(예상한 409가 콘솔에 찍힌다)
  await page.waitForLoadState("networkidle");
  await toOne.click();
  const mergedAgain = await waitUnits((units) => units.length === before.length - 1);
  check("the pair merges a second time", mergedAgain !== null);
  if (mergedAgain === null) return;
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  const assigned = await waitUnits((units) => units.some((unit) => unit.can_unmerge && unit.status === "confirmed" && members.every((item) => unit.text.includes(item.text.trim()))));
  check("the merged sentence is assigned", assigned !== null);
  if (assigned === null) return;
  // 확정하면 다음 줄로 넘어간다 - 합친 문장으로 돌아와서 누른다
  await page.waitForLoadState("networkidle");
  await pieceOf(assigned.find((unit) => unit.can_unmerge && unit.status === "confirmed" && members.every((item) => unit.text.includes(item.text.trim()))).id).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("KO/EN pair stays offered on an assigned sentence", (await toPair.getAttribute("aria-disabled")) === null);
  await toPair.click();
  await wait(page, "assign-edit-confirm");
  await page.locator('[data-testid="assign-edit-confirm-confirm"]').click();
  const cleared = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null && unit.status === "unassigned"));
  check("after asking once it is a pair again, with the assignment cleared", cleared !== null);
  // 확인 창을 거친 뒤에도 화면이 새 줄을 따라가 고른다(묻는 사이에 다시 받은 값으로 고르면 놓친다)
  // 되돌리면 풀기 앞으로 - 합친 한 문장이 돌아온다(짝은 사라진 조각과 함께 없어진다). 다시 눌러 처음 모양으로 둔다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-pair"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo brings the merged sentence back", (await waitUnits((units) => units.length === before.length - 1)) !== null);
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await toPair.click();
  const restored = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null));
  check("the pair is back as the step found it", restored !== null);
});

// 조각 사이의 붙이기 단추와 합친 문장 풀기(v1.0.22) - 전에는 원문 고치기 화면에만 있었다. 자른 두 조각을 틈의 단추로 붙이고, 붙인 문장을 조각 아래 단추로 다시 푼다
await runStep("assign: join two pieces from the gap between them, then unmerge", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  let doc = null;
  let unit = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.filter((item) => item.kind === "sentence" && item.status === "unassigned" && item.lang === "en" && item.pair_id === null && item.text.trim().split(" ").length >= 6);
    if (found.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.waitForTimeout(600);
    for (const item of found) {
      if ((await pieceOf(item.id).count()) === 0) continue;
      doc = candidate;
      unit = item;
      break;
    }
    if (unit !== null) break;
  }
  check("the fresh bundle has an unpaired English sentence on screen", unit !== null);
  if (unit === null) return;
  const readIds = async () => (await readView(doc.id)).units.map((item) => item.id);
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readIds()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const beforeIds = await readIds();
  const before = beforeIds.length;
  // 먼저 자른다 - 우클릭 메뉴
  await pieceOf(unit.id).scrollIntoViewIfNeeded();
  await pieceOf(unit.id).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  check("the sentence is cut in two", await waitCount(before + 1));
  const halves = (await readView(doc.id)).units.filter((item) => !beforeIds.includes(item.id)).sort((a, b) => a.pos_seq - b.pos_seq);
  // 틈의 붙이기 단추 - 포인터가 틈에 머물러 단추가 나타난 뒤에 누른다(사람처럼)
  const join = page.locator(`[data-testid="assign-paper-join-${halves[0].id}-${halves[1].id}"]`);
  await join.waitFor({ state: "attached", timeout: T });
  check("the gap between the two pieces offers Join", (await join.getAttribute("aria-disabled")) === null);
  await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts === null || acts.getAnimations().length === 0; }, null, { timeout: T });
  await page.locator(".strip-gap", { has: join }).hover({ position: { x: 200, y: 2 } });
  await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
  await takeShot("sop-assign-gap-join.png");
  await join.click();
  check("Join merges the two pieces back into one sentence", await waitCount(before));
  const merged = (await readView(doc.id)).units.find((item) => !beforeIds.includes(item.id) && item.kind === "sentence");
  check("the merged sentence can be taken apart again", merged !== undefined && merged.can_unmerge === true);
  // 붙인 문장을 고르면 글 아래에 풀기 단추가 생긴다
  await pieceOf(merged.id).click();
  const unmerge = page.locator(`[data-testid="assign-act-unmerge-${merged.id}"]`);
  await unmerge.waitFor({ timeout: T });
  await takeShot("sop-assign-unmerge.png");
  await unmerge.click();
  check("Unmerge gives the two pieces back", await waitCount(before + 1));
  // 되돌리기 세 번으로 처음 모양까지(풀기 → 붙이기 → 자르기)
  // 화면이 풀린 조각의 줄을 고른 뒤에 누른다 - 그 전에 되돌리면 화면이 막 사라진 조각의 정보를 한 번 불러 404가 콘솔에 찍힌다(사람 손으로는 나오지 않는 속도)
  await wait(page, "assign-row-id");
  await page.waitForLoadState("networkidle");
  for (const expected of [before, before + 1, before]) {
    await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
    if (!(await waitCount(expected))) break;
    await page.waitForLoadState("networkidle");
  }
  check("three undos return to the original sentence", (await readIds()).length === before);
});

// 배정 화면에서 고른 글자로 새 Unit 만들기(전에는 쪼개기 화면에서만 했다) - 끌어 고르면 용지 위에 줄이 뜨고, 만들고, 되돌린다
await runStep("assign: make a unit from a dragged selection, then undo", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${oldDoc.id}/view`, { headers })).json()).units;
  const before = await readUnits();
  const unit = before.find((item) => item.kind === "sentence" && item.lang === "en" && item.status === "unassigned" && item.text.length > 40);
  check("the fresh bundle has a long unassigned sentence", unit !== undefined);
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const span = page.locator(`[data-testid="assign-paper-unit-${unit.id}"]`).first();
  await span.waitFor({ timeout: T });
  await span.scrollIntoViewIfNeeded();
  const box = await span.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 10, { steps: 10 });
  await page.mouse.up();
  await wait(page, "assign-carve");
  const picked = (await getText(page, "assign-carve-text")).trim();
  check("the bar above the paper shows the picked text", picked.length > 0 && unit.text.startsWith(picked), picked);
  await takeShot("sop-assign-carve.png");
  await page.locator('[data-testid="assign-carve-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-undo"]')?.disabled === false, null, { timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-carve"]') === null, null, { timeout: T });
  const after = await readUnits();
  check("the picked text becomes its own unit", after.length === before.length + 1 && after.some((item) => item.text.trim() === picked), `${before.length} -> ${after.length}`);
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => toast.textContent?.includes("New unit from selection")), null, { timeout: T });
  check("Undo puts the sentence back", (await readUnits()).length === before.length);
});

// 배정 화면에서 한/영 짝 풀고 다시 맺기 - 우클릭 메뉴(전에는 쪼개기 화면에서만 했다). 끝에는 다시 짝이다
await runStep("assign: separate and pair KO/EN from the right-click menu", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  const readPairs = async (ids) => {
    const view = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${oldDoc.id}/view`, { headers })).json();
    return ids === undefined ? view.units : view.units.filter((unit) => ids.includes(unit.id)).map((unit) => unit.pair_id);
  };
  // 한글 문장 바로 뒤에 영어 짝이 오는 미배정 짝
  const sentences = (await readPairs()).filter((unit) => unit.kind === "sentence");
  const ko = sentences.find((unit, index) => unit.lang === "ko" && unit.pair_id !== null && unit.status === "unassigned" && sentences[index + 1]?.pair_id === unit.pair_id && sentences[index + 1].lang === "en");
  check("the fresh bundle has an unassigned KO/EN pair", ko !== undefined);
  const en = sentences[sentences.indexOf(ko) + 1];
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const piece = page.locator(`[data-testid="assign-paper-piece-${ko.id}"], [data-testid="assign-paper-unit-${ko.id}"]`).first();
  await piece.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-unpair");
  check("a paired sentence cannot be paired again", (await page.locator('[data-testid="assign-ctx-pair_next"]').getAttribute("aria-disabled")) === "true" || (await page.locator('[data-testid="assign-ctx-pair_next"]').isDisabled()));
  const separated = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-unpair"]').click();
  check("Separate saves", (await separated).ok());
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
  check("the two sentences are no longer a pair", (await readPairs([ko.id, en.id])).every((pairId) => pairId === null));
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-pair_next");
  check("Separate leaves the menu once the pair is gone", (await page.locator('[data-testid="assign-ctx-unpair"]').count()) === 0);
  await takeShot("sop-assign-pair-menu.png");
  const joined = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-pair_next"]').click();
  check("Pair with next saves", (await joined).ok());
  await page.waitForFunction((ids) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(ids[1]), [ko.display_id, en.display_id], { timeout: T });
  const again = await readPairs([ko.id, en.id]);
  check("the two sentences are a pair again and share a row", again[0] !== null && again[0] === again[1]);
  // 떨어진 문장과 짝 맺기 - 다시 풀고, 메뉴에서 시작해 영어 문장을 눌러 맺는다. 같은 문장·같은 언어는 맺지 않는다
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-unpair");
  const separatedAgain = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-unpair"]').click();
  await separatedAgain;
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-pair_pick");
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  check("the bar above the paper says which sentence is waiting for a partner", (await getText(page, "assign-pair-pick")).includes(ko.display_id));
  await page.keyboard.press("Escape");
  check("Esc leaves the pick", (await page.locator('[data-testid="assign-pair-pick"]').count()) === 0);
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  const picked = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click();
  check("clicking the other sentence pairs them", (await picked).ok());
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-pair-pick"]') === null, null, { timeout: T });
  const pickedPair = await readPairs([ko.id, en.id]);
  check("the picked sentences are a pair", pickedPair[0] !== null && pickedPair[0] === pickedPair[1]);
  // 셋 이상을 한 짝으로(v1.0.25) - 다시 풀고, Shift+클릭으로 모은 뒤 줄의 단추로 한 번에 맺는다. 끝에는 처음의 두 문장 짝으로 돌려 둔다
  const third = sentences.find((unit) => unit.status === "unassigned" && unit.pair_id === null && (unit.lang === "ko" || unit.lang === "en") && unit.id !== ko.id && unit.id !== en.id);
  if (third === undefined || (await page.locator(`[data-testid="assign-paper-unit-${third.id}"]`).count()) === 0) {
    console.log("  (no third free sentence on screen - pairing three not exercised)");
    return;
  }
  const unpair = async () => {
    await piece.click({ button: "right" });
    await wait(page, "assign-ctx-unpair");
    const gone = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
    await page.locator('[data-testid="assign-ctx-unpair"]').click();
    await gone;
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
    await page.waitForLoadState("networkidle");
  };
  await unpair();
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  check("nothing is offered to run until a sentence is picked", (await page.locator('[data-testid="assign-pair-pick-run"]').count()) === 0);
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click({ modifiers: ["Shift"] });
  await page.locator(`[data-testid="assign-paper-unit-${third.id}"]`).first().click({ modifiers: ["Shift"] });
  await wait(page, "assign-pair-pick-run");
  check("Shift+click collects sentences and marks them on the paper", (await getText(page, "assign-pair-pick-run")).includes("3") && (await page.locator(`[data-testid="assign-paper-unit-${third.id}"][data-pick]`).count()) > 0, await getText(page, "assign-pair-pick-text"));
  await takeShot("sop-assign-pair-many.png");
  const three = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-pair-pick-run"]').click();
  check("Pair 3 saves", (await three).ok());
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-pair-pick"]') === null, null, { timeout: T });
  const trio = await readPairs([ko.id, en.id, third.id]);
  check("the three sentences share one pair", trio[0] !== null && trio.every((pairId) => pairId === trio[0]), trio.join(","));
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id), ko.display_id, { timeout: T });
  await page.waitForLoadState("networkidle");
  await unpair();
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  const restored = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click();
  await restored;
  const after = await readPairs();
  const pairOf = (id) => after.find((unit) => unit.id === id)?.pair_id ?? null;
  check("the first two are a pair again and the third is free", pairOf(ko.id) !== null && pairOf(ko.id) === pairOf(en.id) && pairOf(third.id) === null);
});

// 배정 화면에서 보낼 곳 더하고 지우기 - All 목록에서 SOP·WI·단계를 만들고(한 줄씩 바로 저장), 두 번 눌러 지운다. 끝에는 목록이 처음과 같다
await runStep("assign: add and delete destinations from the All list", {}, async ({ page, takeShot }) => {
  const readTobe = async () => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const before = (await readTobe()).docs.map((doc) => doc.code);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  await page.locator('[data-testid="assign-acc-all"]').click();
  await wait(page, "assign-tree-add-doc");
  await page.locator('[data-testid="assign-tree-add-doc"]').click();
  await wait(page, "assign-tree-doc-code");
  check("the number box takes the focus", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assign-tree-doc-code");
  await page.keyboard.type(before[0]);
  check("a number already in the list cannot be added", await page.locator('[data-testid="assign-tree-doc-add"]').isDisabled());
  await page.locator('[data-testid="assign-tree-doc-code"]').fill("SOP-SMOKE");
  await page.keyboard.press("Enter");
  await wait(page, "assign-tree-pSOP-SMOKE");
  check("the new SOP opens in the list", (await page.locator('[data-testid="assign-tree-pSOP-SMOKE"]').getAttribute("aria-expanded")) === "true");
  await page.locator('[data-testid="assign-tree-add-doc"]').click();
  await page.locator('[data-testid="assign-tree-doc-type-wi"]').click();
  await page.locator('[data-testid="assign-tree-doc-parent"]').click();
  await page.locator('[role="option"]', { hasText: "SOP-SMOKE" }).click();
  await page.locator('[data-testid="assign-tree-doc-code"]').fill("WI-SMOKE");
  await page.locator('[data-testid="assign-tree-doc-add"]').click();
  await wait(page, "assign-tree-pWI-SMOKE");
  const added = await readTobe();
  const sop = added.docs.find((doc) => doc.code === "SOP-SMOKE");
  const wi = added.docs.find((doc) => doc.code === "WI-SMOKE");
  check("the WI is saved under its parent SOP", wi?.parent_code === "SOP-SMOKE" && wi.doc_type === "wi", JSON.stringify(wi));
  check("an SOP with a WI under it cannot be deleted", (await page.locator(`[data-testid="assign-tree-remove-doc-${sop.id}"]`).getAttribute("aria-disabled")) === "true");
  await page.locator(`[data-testid="assign-tree-add-step-${wi.id}"]`).click();
  await page.locator('[data-testid="assign-tree-step-title"]').fill("Smoke step");
  await page.keyboard.press("Enter");
  await wait(page, `assign-tree-remove-step-${wi.id}-1`);
  check("the new step becomes the chosen place", (await getText(page, "assign-chosen")).includes("Smoke step"), await getText(page, "assign-chosen"));
  check("Confirm is ready for it", (await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")) === "confirm");
  await takeShot("sop-assign-add-place.png");
  const removeStep = page.locator(`[data-testid="assign-tree-remove-step-${wi.id}-1"]`);
  await removeStep.click();
  check("the first press only arms the delete", (await removeStep.getAttribute("data-armed")) === "" && (await readTobe()).wi_steps.some((step) => step.code === "WI-SMOKE"));
  await removeStep.click();
  await removeStep.waitFor({ state: "detached", timeout: T });
  check("deleting the chosen step drops the pick", await page.locator('[data-testid="assign-primary"]').isDisabled());
  for (const doc of [wi, sop]) {
    const remove = page.locator(`[data-testid="assign-tree-remove-doc-${doc.id}"]`);
    await remove.click();
    await remove.click();
    await remove.waitFor({ state: "detached", timeout: T });
  }
  const after = (await readTobe()).docs.map((doc) => doc.code);
  check("the list is back to where it started", JSON.stringify(after) === JSON.stringify(before), after.join(","));
  check("a document holding sentences keeps its delete locked", (await page.locator('[data-testid^="assign-tree-remove-doc-"][aria-disabled="true"]').count()) > 0);
});

// 네 단계 워크플로우 - 레일은 Documents·Assign·Order·Outputs, 원문 고치기(옛 쪼개기 화면)는 배정 화면 안에서 열린다. C는 Order에서만 고친다
await runStep("four steps: rail, Order edits C and Outputs reads it", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "stage-nav");
  const rail = await page.locator('[data-testid="stage-nav"] .stg-n').evaluateAll((els) => els.map((el) => `${el.textContent}:${el.parentElement.dataset.stage}`));
  check("the rail numbers Documents, Assign, Order, Outputs", rail.join(" ") === "1:documents 2:assign 3:order 4:outputs", rail.join(" "));
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await wait(page, "assign-bar");
  check("the rail has no Split step and Assign has no separate tool screen", (await page.locator('[data-testid="stage-nav-split"]').count()) === 0 && (await page.locator('[data-testid="assign-open-split"]').count()) === 0);
  await page.locator('[data-testid="stage-nav-order"]').click();
  await wait(page, "order-docs");
  await wait(page, "output-c");
  check("Order opens one New document", (await page.locator('[data-testid="output-c"] article').count()) === 1);
  check("Order leaves out the deleted and moved lists", (await page.locator('[data-testid^="output-c-deleted-"], [data-testid^="output-c-moved-"]').count()) === 0);
  // 앞 시나리오들이 배정을 바꿔 두므로 문장이 든 문서를 찾아 연다(첫 문서가 비어 있을 수 있다)
  const [movable] = await findOrderDocs(page, () => (document.querySelector('[data-testid^="output-c-move-"]') ? true : null));
  check("Order lets the author move lines", movable !== undefined);
  const picked = `order-doc-${movable?.[0]}`;
  check("picking a document opens it", (await page.locator(`[data-testid="${picked}"]`).getAttribute("aria-current")) === "true");
  await takeShot("sop-order.png");
  await page.locator('[data-testid="stage-nav-outputs"]').click();
  await page.locator('[data-testid="outputs-tab-c"]').click();
  await wait(page, "output-c");
  check("Outputs shows every New document on C", (await page.locator('[data-testid="output-c"] article').count()) > 1);
  check("C is read-only on Outputs", (await page.locator('[data-testid^="output-c-move-"], [data-testid^="output-c-indent-"]').count()) === 0);
  await page.locator('[data-testid="outputs-edit-order"]').click();
  await page.waitForURL(/\/order$/, { timeout: T });
  await wait(page, "order-docs");
  check("Edit order returns to the document last opened", (await page.locator('[data-testid^="order-doc-"][aria-current="true"]').getAttribute("data-testid")) === picked);
});

// 배정된 문장도 자른다(v1.0.21) - 한 번 묻고 배정을 풀며 자른다(원문 고치기와 같은 규칙). 전에는 "먼저 배정을 지우라"며 막았다
// 서버의 물음(409 confirm_required)이 콘솔에 오류로 찍힌다 - 이 단계가 일부러 받는 응답이다
await runStep("assign: cutting an assigned sentence asks once, then clears its assignment", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  // 화면의 본문에 조각이 있는 영어 문장을 골라 먼저 배정해 확정한다(앞 단계들이 이 Bundle의 배정을 모두 지웠을 수 있다. 머리말·꼬리말의 문장은 다른 탭에 있다)
  let doc = null;
  let unit = null;
  let piece = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.filter((item) => item.kind === "sentence" && item.status === "unassigned" && item.lang === "en" && item.text.trim().split(" ").length >= 4);
    if (found.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of found) {
      const locator = page.locator(`[data-testid="assign-paper-piece-${item.id}"], [data-testid="assign-paper-unit-${item.id}"]`).first();
      if ((await locator.count()) === 0) continue;
      doc = candidate;
      unit = item;
      piece = locator;
      break;
    }
    if (unit !== null) break;
  }
  check("the bundle has an open English sentence on screen", unit !== null);
  if (unit === null) return;
  await piece.click();
  await wait(page, "assign-row-id");
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  let assigned = false;
  for (let tries = 0; tries < 60 && !assigned; tries += 1) {
    assigned = (await readView(doc.id)).units.some((item) => item.id === unit.id && item.status === "confirmed");
    if (!assigned) await page.waitForTimeout(250);
  }
  check("the sentence is assigned first", assigned);
  const countUnits = async () => (await readView(doc.id)).units.length;
  // 저장이 끝날 때까지 서버 값을 직접 다시 읽는다
  const waitUnits = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await countUnits()) === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const beforeIds = new Set((await readView(doc.id)).units.map((item) => item.id));
  const before = beforeIds.size;
  const openSplit = async () => {
    await piece.scrollIntoViewIfNeeded();
    await piece.click({ button: "right" });
    await wait(page, "assign-ctx-split");
  };
  await openSplit();
  check("Split is offered on an assigned sentence", (await page.locator('[data-testid="assign-ctx-split"]').getAttribute("aria-disabled")) === null);
  check("changing its language stays locked", (await page.locator('[data-testid="assign-ctx-lang-ko"]').getAttribute("aria-disabled")) === "true");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  await wait(page, "assign-edit-confirm");
  await takeShot("sop-assign-edit-confirm.png");
  // 그만두면 아무것도 바뀌지 않는다
  await page.locator('[data-testid="assign-edit-confirm-cancel"]').click();
  await page.locator('[data-testid="assign-edit-confirm"]').waitFor({ state: "detached", timeout: T });
  check("cancelling leaves the sentence as it was", (await countUnits()) === before);
  if ((await page.locator('[data-testid="assign-cut-run"]').count()) === 0) {
    await openSplit();
    await page.locator('[data-testid="assign-ctx-split"]').click();
    await wait(page, "assign-cut-run");
  }
  await page.locator('[data-testid="assign-cut-run"]').click();
  await wait(page, "assign-edit-confirm");
  await page.locator('[data-testid="assign-edit-confirm-confirm"]').click();
  check("confirming cuts the sentence in two", await waitUnits(before + 1));
  const after = await readView(doc.id);
  check("the cut sentence is no longer among the units", !after.units.some((item) => item.id === unit.id));
  const pieces = after.units.filter((item) => !beforeIds.has(item.id));
  check("its two pieces are unassigned again", pieces.length === 2 && pieces.every((item) => item.status === "unassigned"), pieces.map((item) => item.status).join(", "));
  // 되돌리면 글은 한 문장으로 돌아온다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the sentence back as one", await waitUnits(before));
});

await runStep("new bundle in one click, locked stages, empty assign", { devUser: "dev.admin" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid="bundles-new"]').click();
  await page.waitForURL(/\/bundles\/\d+$/, { timeout: T });
  const code = (await getText(page, "overview-code")).trim();
  check("new bundle shows its BND code", /^BND-\d{4,}$/.test(code), code);
  check("Assign and Order are locked without documents", (await page.locator('[data-testid="stage-nav-assign"][aria-disabled="true"], [data-testid="stage-nav-order"][aria-disabled="true"]').count()) === 2);
  check("Split is not on the rail", (await page.locator('[data-testid="stage-nav-split"]').count()) === 0);
  // To-Be 목록은 Documents 화면 안에 있다 - 문서가 없어도 Documents는 열려 있다
  check("Documents (with the To-Be list) stays open without documents", (await page.locator('a[data-testid="stage-nav-documents"]').count()) === 1);
  await page.locator('[data-testid="overview-menu"]').click();
  await page.locator('[data-testid="overview-menu-synthetic"]').click();
  await page.locator('[data-testid="top-bar-synthetic"]').waitFor({ timeout: T });
  check("test-data mark set from the menu", true);
  await page.goto(`${page.url()}/assign`);
  await wait(page, "assign-empty");
  check("empty state instead of an endless skeleton", true);
});

// 목록 둘(v1.0.32) - 위는 Old 문서, 아래는 New 문서. 이미 쓴 New 문서의 파일은 따로 줄을 차지하지 않고 New 목록의 그 줄에 붙어 보인다
await runStep("documents: an Old list and a New list, with written files on their rows", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const tobe = await (await page.request.get(`${BASE}/api/bundles/${freshId}/tobe`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/documents`);
  await wait(page, "tobe-list");
  await page.locator('[data-testid$="-row"][data-testid^="documents-"]').first().waitFor({ timeout: T });
  check("the two lists are named Old documents and New documents", (await getText(page, "documents-old-title")) === "Old documents" && (await page.locator('[data-testid="tobe-section"] h2').innerText()) === "New documents");
  const oldRows = await page.locator('[data-testid="documents-list"] [data-testid$="-row"]').count();
  check("the top list holds the Old documents only", oldRows === docs.filter((doc) => doc.side === "old").length, String(oldRows));
  check("the table and card switch and the jump button are gone", (await page.locator('[data-testid="documents-view"], [data-testid="documents-jump-tobe"]').count()) === 0);
  const written = tobe.docs.find((doc) => doc.document_id !== null);
  const file = docs.find((doc) => doc.id === written.document_id);
  const cell = page.locator('[data-testid="tobe-list"] [data-testid$="-written"]:not([data-testid$="-not-written"])').first();
  check("a written file shows on its New row", (await cell.innerText()).includes(file.file_name.slice(0, 12)));
  check("rows without a file say so", (await page.locator('[data-testid$="-not-written"]').count()) === tobe.docs.filter((doc) => doc.document_id === null).length);
  await takeShot("sop-documents-two-lists.png");
  await cell.locator('[data-testid$="-written-preview"]').click();
  await wait(page, "documents-preview-split");
  check("the file's preview opens from the row", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="documents-preview-split"]').waitFor({ state: "detached", timeout: T });
  // Excel 템플릿·가져오기는 메뉴에 있다
  await page.locator('[data-testid="tobe-more"]').click();
  await wait(page, "tobe-more-menu");
  check("the Excel template and import sit in the menu", (await page.locator('[data-testid="tobe-template"]').count()) === 1 && (await page.locator('[data-testid="tobe-import"]').count()) === 1);
  await page.keyboard.press("Escape");
  // 줄을 펼치면 그 파일의 버전과 언어 배치가 있다
  await cell.locator("xpath=ancestor::tr").locator('[data-testid$="-toggle"]').click();
  await page.locator('[data-testid$="-written-detail"]').first().waitFor({ timeout: T });
  check("opening the row shows the file's version and language layout", (await page.locator('[data-testid$="-written-version"]').count()) === 1 && (await page.locator('[data-testid$="-written-layout"]').count()) === 1);
});

// 올리는 창구 하나(v1.0.31) - Old와 New 파일을 한 창에서 올린다. 앱이 파일 이름의 번호로 쪽을 먼저 고르고, New 파일은 번호가 같은 빈 줄에 붙는다.
// 묶음을 만들 권한이 있는 사람으로 새 묶음에서 하고, 끝에 그 묶음을 지운다(저장소의 합성 샘플 파일을 쓴다)
await runStep("documents: one upload window takes Old and New files", { devUser: "dev.admin" }, async ({ page, takeShot }) => {
  const samples = resolve(SCRIPT_DIR, "../../samples");
  const headers = { "X-Dev-User": "dev.admin", "Content-Type": "application/json" };
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC upload window", is_synthetic: true } })).json();
  const docs = [{ code: "SOP-01", doc_type: "sop", title: "Synthetic SOP" }, { code: "WI-05", doc_type: "wi", parent_code: "SOP-01", title: "Synthetic listed WI" }];
  const listed = await page.request.put(`${BASE}/api/bundles/${created.id}/tobe`, { headers, data: { revision: created.revision, docs, na_slots: [], wi_steps: [{ code: "WI-05", step_no: 1, title: "Clean" }] } });
  check("a new bundle with two listed New documents is ready", listed.ok());
  const readTobe = async () => (await (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe`, { headers })).json()).docs;
  await page.goto(`${BASE}/bundles/${created.id}/documents`);
  await wait(page, "documents-empty-upload");
  check("the New list no longer has its own upload button", (await page.locator('[data-testid="tobe-upload-written"]').count()) === 0);
  await page.locator('[data-testid="documents-empty-upload"]').click();
  await page.locator('[data-testid="upload-files"]').setInputFiles([`${samples}/SYNTHETIC_OLD-6_Hanil_Centrifuge_Cleaning.docx`, `${samples}/SYNTHETIC_WI-05_Hanil_Centrifuge_Cleaning.docx`, `${samples}/SYNTHETIC_WI-04_Labogene_Centrifuge_Operation.docx`]);
  await wait(page, "upload-picked");
  // New 목록을 읽은 뒤에 쪽이 정해진다
  await page.waitForFunction(() => document.querySelector('[data-testid="upload-side-1-new"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  const pressed = async (index) => ((await page.locator(`[data-testid="upload-side-${index}-new"]`).getAttribute("aria-pressed")) === "true" ? "new" : "old");
  check("the app picks New for a number on the New list and Old for the rest", (await pressed(0)) === "old" && (await pressed(1)) === "new" && (await pressed(2)) === "old");
  check("it says which row the New file attaches to", (await getText(page, "upload-note-1")).includes("WI-05"));
  // 사람이 뒤집는다 - 목록에 없는 번호라 줄이 새로 생기고, WI는 상위 SOP를 골라야 올릴 수 있다
  await page.locator('[data-testid="upload-side-2-new"]').click();
  await page.locator('[data-testid="upload-kind-2"]').click();
  await page.locator('[data-testid="upload-kind-2-option-wi"]').click();
  check("a WI that makes a new row needs its parent SOP first", await page.locator('[data-testid="upload-submit"]').isDisabled());
  await page.locator('[data-testid="upload-parent-2"]').click();
  await page.locator('[data-testid="upload-parent-2-option-SOP-01"]').click();
  await takeShot("sop-upload-one-window.png");
  await page.locator('[data-testid="upload-submit"]').click();
  await page.locator('[data-testid="upload-done"]:not([disabled])').waitFor({ timeout: 120000 });
  const rows = Object.fromEntries((await readTobe()).map((doc) => [doc.code, doc]));
  check("the New file attached to its listed row", rows["WI-05"]?.entrance === "match" && rows["WI-05"]?.document_id !== null && rows["WI-05"]?.parent_code === "SOP-01");
  check("the other New file made a row under the SOP picked in the window", rows["WI-04"]?.entrance === "match" && rows["WI-04"]?.doc_type === "wi" && rows["WI-04"]?.parent_code === "SOP-01");
  const documents = await (await page.request.get(`${BASE}/api/bundles/${created.id}/documents`, { headers })).json();
  check("the Old file became an Old document", documents.some((doc) => doc.side === "old" && doc.doc_code === "OLD-6" && doc.status === "ready"));
  await page.locator('[data-testid="upload-done"]').click();
  // 화면 아무 데나 파일을 끌어다 놓으면 같은 창이 그 파일을 담아 열린다
  const dragged = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "SYNTHETIC_OLD-9 dropped.docx"));
    return data;
  });
  await page.dispatchEvent('[data-testid="documents-drop"]', "dragover", { dataTransfer: dragged });
  await wait(page, "documents-drop-veil");
  check("dragging a file over the screen shows where it will go", true);
  await page.dispatchEvent('[data-testid="documents-drop"]', "drop", { dataTransfer: dragged });
  await wait(page, "upload-picked-0");
  check("dropping it opens the same window with the file in it", (await getText(page, "upload-picked-0")).includes("dropped.docx"));
  await page.locator('[data-testid="upload-cancel"]').click();
  // 파일을 지워도 목록 줄은 남는다(배정으로 엮는 줄로 돌아간다)
  const written = documents.find((doc) => doc.doc_code === "WI-05");
  const removed = await page.request.delete(`${BASE}/api/bundles/${created.id}/documents/${written.id}?revision=${written.revision}`, { headers });
  const after = Object.fromEntries((await readTobe()).map((doc) => [doc.code, doc]));
  check("deleting the written file keeps its row on the New list", removed.status() === 204 && after["WI-05"]?.entrance === "assign" && after["WI-05"]?.document_id === null);
  const bundle = await (await page.request.get(`${BASE}/api/bundles/${created.id}`, { headers })).json();
  await page.request.delete(`${BASE}/api/bundles/${created.id}?revision=${bundle.revision}`, { headers });
});

// AI로 목록 읽기(v1.0.34) - 템플릿에 맞지 않는 글을 붙여 넣으면 AI가 줄을 제안하고, 사람이 보고 고친 뒤 목록에 더한다.
// 글에 없는 번호는 서버가 버린다(가짜 AI가 일부러 하나를 지어낸다). AI가 꺼진 백엔드에서는 메뉴에 항목이 없는 것만 본다.
await runStep("documents: AI reads a free-form list into New rows", { devUser: "dev.admin" }, async ({ page }) => {
  const headers = { "X-Dev-User": "dev.admin", "Content-Type": "application/json" };
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC list reading", is_synthetic: true } })).json();
  await page.request.put(`${BASE}/api/bundles/${created.id}/tobe`, { headers, data: { revision: created.revision, docs: [{ code: "SOP-01", doc_type: "sop", title: "Synthetic SOP" }], na_slots: [], wi_steps: [] } });
  const readTobe = async () => (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe`, { headers })).json();
  const removeBundle = async () => {
    const bundle = await (await page.request.get(`${BASE}/api/bundles/${created.id}`, { headers })).json();
    await page.request.delete(`${BASE}/api/bundles/${created.id}?revision=${bundle.revision}`, { headers });
  };
  const status = await page.request.get(`${BASE}/api/bundles/${created.id}/ai/status`, { headers });
  const isAiOn = status.ok() && (await status.json()).ai_enabled;
  await page.goto(`${BASE}/bundles/${created.id}/documents`);
  await wait(page, "tobe-add-code");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="tobe-more"]').click();
  await wait(page, "tobe-more-menu");
  if (!isAiOn) {
    check("without AI the menu has no list reading", (await page.locator('[data-testid="tobe-read-open"]').count()) === 0);
    console.log("  (AI is off in this backend - the rest is skipped)");
    await removeBundle();
    return;
  }
  await page.locator('[data-testid="tobe-read-open"]').click();
  await wait(page, "tobe-read-ask");
  check("nothing can be sent before a file or text is given", await page.locator('[data-testid="tobe-read-submit"]').isDisabled());
  await page.locator('[data-testid="tobe-read-text"]').fill("Synthetic restructuring plan\nSOP-QC-0300 | Synthetic cold storage\nWI-QC-0301 | Synthetic storage operation\nQC-0400 | Synthetic checklist");
  await page.locator('[data-testid="tobe-read-submit"]').click();
  await page.locator('[data-testid="tobe-read-preview"]').waitFor({ timeout: 60000 });
  const codes = await page.locator('[data-testid="tobe-read-list"] tbody tr').evaluateAll((rows) => rows.map((row) => row.dataset.testid));
  check("the preview lists the numbers found in the text", ["SOP-QC-0300", "WI-QC-0301", "QC-0400"].every((code) => codes.includes(`tobe-read-${code}-row`)), codes.join(","));
  check("a number that is not in the text is dropped", !codes.some((id) => id.includes("INVENTED")));
  check("a row without a kind blocks adding and says why", (await page.locator('[data-testid="tobe-read-add"]').isDisabled()) && (await getText(page, "tobe-read-problem")).includes("QC-0400"));
  check("nothing is written before the person adds", (await readTobe()).docs.length === 1);
  await page.locator('[data-testid="tobe-read-QC-0400-type"]').click();
  await page.locator('[data-testid="tobe-read-QC-0400-type-option-sop"]').click();
  await page.locator('[data-testid="tobe-read-problem"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="tobe-read-add"]').click();
  await page.locator('[data-testid="tobe-read"]').waitFor({ state: "detached", timeout: 30000 });
  await page.waitForLoadState("networkidle");
  const after = await readTobe();
  const byCode = Object.fromEntries(after.docs.map((doc) => [doc.code, doc]));
  check("the picked rows are on the New list with kind, parent and title", after.docs.length === 4 && byCode["WI-QC-0301"]?.parent_code === "SOP-QC-0300" && byCode["QC-0400"]?.doc_type === "sop" && byCode["SOP-QC-0300"]?.title === "Synthetic cold storage", JSON.stringify(after.docs.map((doc) => [doc.code, doc.doc_type, doc.parent_code])));
  check("the WI's steps came with it", after.wi_steps.filter((item) => item.code === "WI-QC-0301").length > 0);
  // 목록은 창이 닫힌 뒤 다시 받는다 - 넷째 줄이 그려질 때까지 기다린다
  await page.locator('[data-testid^="tobe-id-"][data-testid$="-code"]').nth(3).waitFor({ timeout: T });
  const shownCodes = await page.locator('[data-testid^="tobe-id-"][data-testid$="-code"]').evaluateAll((cells) => cells.map((cell) => cell.value ?? cell.textContent));
  check("the new rows show on the list without a reload", ["SOP-QC-0300", "WI-QC-0301", "QC-0400"].every((code) => shownCodes.includes(code)), shownCodes.join(","));
  const left = await (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe/read`, { headers })).json();
  check("the proposal is closed once it is used", left === null && (await page.locator('[data-testid="tobe-proposal"]').count()) === 0);
  await removeBundle();
});

// 배정 화면 첫 진입(설계 2026-11-15-ai-prepare-queue §5.2·§8) - PREPARE=1일 때만(머리말의 전제). 알림 → 상단 바 목록의 Background 줄 → 끝나면 AI suggested 수
await runStep(PREPARE_STEP, {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  const bundleId = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const status = await (await page.request.get(`${BASE}/api/bundles/${bundleId}/ai/status`, { headers })).json();
  check("backend has AI on (PREPARE=1 needs the fake AI and AI_AUTO_PREPARE=true)", status.ai_enabled === true);
  const before = await (await page.request.get(`${BASE}/api/bundles/${bundleId}`, { headers })).json();
  check("no AI suggestion before the first entry", before.progress.ai_suggested === 0, String(before.progress.ai_suggested));

  await page.goto(`${BASE}/bundles/${bundleId}/assign`);
  const toast = page.locator('[data-testid="toast-ok"]', { hasText: "in the background" });
  await toast.first().waitFor({ timeout: T });
  check("a toast says the remaining rows are classified in the background", /remaining \d+ rows/.test(await toast.first().innerText()), await toast.first().innerText());

  await page.locator('[data-testid="top-bar-ai"]').click();
  const mark = page.locator('[data-testid="ai-jobs-popover"] [data-testid^="ai-jobs-request-"][data-testid$="-background"]');
  await mark.first().waitFor({ timeout: T });
  check("the AI job list marks the request as Background", (await mark.first().innerText()).trim() === "Background");
  await mark.first().hover();
  const tip = page.locator('[role="tooltip"]', { hasText: "Started automatically" });
  await tip.first().waitFor({ timeout: T });
  check("the mark explains itself on hover", true);
  await takeShot("sop-assign-prepare-popover.png");
  const requestRow = (await mark.first().getAttribute("data-testid")).replace(/-background$/, "");
  // 묶기 계획이 먼저 짝을 찾은 줄의 분류는 낡음(stale)으로 끝난다(설계 §5.2) - 실패·취소만 아니면 된다
  const row = page.locator(`[data-testid="${requestRow}"]`);
  await page.locator(`[data-testid="${requestRow}"]:not([data-outcome="running"]):not([data-outcome="queued"])`).waitFor({ timeout: 60000 });
  const outcome = await row.getAttribute("data-outcome");
  check("the background request finishes", outcome === "done" || outcome === "stale", outcome);
  await page.keyboard.press("Escape");

  // 끝나면 화면이 단위를 다시 받는다 - AI suggested 탭 수가 0보다 커진다
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="assign-filter-ai_suggested"] .schip-n')?.textContent ?? 0) > 0, null, { timeout: 30000 });
  check("AI suggested tab count is above zero", true, await page.locator('[data-testid="assign-filter-ai_suggested"] .schip-n').textContent());
  await takeShot("sop-assign-prepare-done.png");
});

await browser.close();
console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} check(s) FAILED, ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
