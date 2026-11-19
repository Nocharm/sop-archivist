// SOP smoke steps for the shell screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import {
  BASE,
  T,
  check,
  runStep,
  wait,
  getText,
  getBox,
  halfBundleId,
} from "./common.mjs";


export async function run() {

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
}
