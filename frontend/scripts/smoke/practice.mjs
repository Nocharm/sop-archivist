// SOP smoke steps for the practice screen /practice (design 2026-11-26-practice-page §10). Run through ../pw-smoke-sop.mjs (ONLY="practice:").
// The practice screen writes nothing to the server, so these steps need no seed reset.
// Step bodies sit at column 0 inside run() on purpose, like the other screen files.

import { BASE, T, check, runStep, wait, getText, getBox } from "./common.mjs";


// Real requests allowed on /practice (practice-route.ts REAL_ON_PRACTICE plus the sign-in mode probe) - anything under /api/bundles/ or any other path is a leak
const REAL_PATHS = new Set(["/api/me", "/api/auth/mode", "/api/ai/jobs/recent"]);

const PRACTICE_UNIT = '[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]';

async function openPractice(page) {
  await page.goto(`${BASE}/practice`);
  await wait(page, "practice-band");
  // Assign draws its frame once the fake server has answered the bundle read
  await wait(page, "assign-bar");
}

export async function run() {

await runStep("practice: entry and band", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "top-bar-user");
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu-practice");
  check("the user menu lists Practice right after the manual", (await getText(page, "user-menu-practice")).trim() === "Practice");
  await page.locator('[data-testid="user-menu-practice"]').click();
  await page.waitForURL(/\/practice$/, { timeout: T });
  await wait(page, "practice-band");
  await wait(page, "assign-bar");
  check("the band says nothing is saved", (await getText(page, "practice-band")).includes("Practice — nothing is saved"), await getText(page, "practice-band"));
  check("Start over is on the band", await page.locator('[data-testid="practice-start-over"]').isVisible());
  check("the task column is on the right of the band's row", (await getBox(page, "practice-tasks")).x > (await getBox(page, "assign")).x);
  check("Assign is the real one (its frame is drawn)", (await page.locator('[data-testid="assign"]').count()) === 1);
  // the user menu on /practice has no Practice item, and the book button opens the practice piece
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu-manual");
  check("the user menu has no Practice item on the practice screen", (await page.locator('[data-testid="user-menu-practice"]').count()) === 0);
  await page.keyboard.press("Escape");
  check("the help link points at the practice piece", (await page.locator('[data-testid="top-bar-manual"]').getAttribute("href")) === "/manual#practice");
  // fold and unfold the task column
  const open = await getBox(page, "practice-tasks");
  await page.locator('[data-testid="practice-tasks-fold"]').click();
  await page.locator('[data-testid="practice-tasks"][data-folded]').waitFor({ timeout: T });
  const folded = await getBox(page, "practice-tasks");
  check("folding leaves a 36px bar", Math.round(folded.width) === 36 && folded.width < open.width, `${open.width} -> ${folded.width}`);
  await page.locator('[data-testid="practice-tasks-fold"]').click();
  await page.locator('[data-testid="practice-tasks"]:not([data-folded])').waitFor({ timeout: T });
  check("unfolding brings the column back", Math.round((await getBox(page, "practice-tasks")).width) === Math.round(open.width));
  await takeShot("sop-practice-band.png");
  // the second entry: the head of the manual
  await page.goto(`${BASE}/manual`);
  await wait(page, "manual-practice");
  check("the manual head links to the practice screen", (await page.locator('[data-testid="manual-practice"]').getAttribute("href")) === "/practice");
  await page.locator('[data-testid="manual-practice"]').click();
  await page.waitForURL(/\/practice$/, { timeout: T });
  await wait(page, "practice-band");
  check("the manual link lands on the practice screen", true);
});

await runStep("practice: nothing reaches the backend", {}, async ({ page }) => {
  const leaks = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && !REAL_PATHS.has(url.pathname)) leaks.push(`${request.method()} ${url.pathname}`);
  });
  await openPractice(page);
  const unit = page.locator(PRACTICE_UNIT).nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  await page.waitForLoadState("networkidle");
  // reload = Start over's same road: the read path runs again against the fake server
  await page.reload();
  await wait(page, "assign-bar");
  await page.locator(PRACTICE_UNIT).nth(2).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  check("no request left for the backend except me, auth mode and the AI job poll", leaks.length === 0, leaks.join(" | "));
});

await runStep("practice: reload starts over", {}, async ({ page }) => {
  await openPractice(page);
  const unit = page.locator(PRACTICE_UNIT).nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  const heldId = (await getText(page, "assign-row-id")).trim().split(" · ")[0];
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Shift+H");
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Practice: hold this");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.locator('[data-testid="assign-reason"]', { hasText: "Practice: hold this" }).waitFor({ timeout: T });
  check("H holds the unit with the reason in the practice screen", true);
  await page.locator('[data-testid="practice-start-over"]').click();
  await wait(page, "assign-bar");
  await page.locator(PRACTICE_UNIT).nth(2).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  const again = page.locator(PRACTICE_UNIT).nth(2);
  await again.click();
  await wait(page, "assign-row-id");
  check("the same unit is back after Start over", (await getText(page, "assign-row-id")).trim().split(" · ")[0] === heldId, await getText(page, "assign-row-id"));
  check("it is unassigned again - no reason and no destination", (await page.locator('[data-testid="assign-reason"]').textContent()) === "–" && (await page.locator('[data-testid="assign-chosen"].is-empty').count()) === 1);
});

}
