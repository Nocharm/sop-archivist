// SOP smoke steps for the practice screen /practice (design 2026-11-26-practice-page §10). Run through ../pw-smoke-sop.mjs (ONLY="practice:").
// The practice screen writes nothing to the server, so these steps need no seed reset.
// Step bodies sit at column 0 inside run() on purpose, like the other screen files.

import { BASE, T, check, runStep, wait, getText, getBox } from "./common.mjs";


// Real requests allowed on /practice (practice-route.ts REAL_ON_PRACTICE plus the sign-in mode probe) - anything under /api/bundles/ or any other path is a leak
const REAL_PATHS = new Set(["/api/me", "/api/auth/mode", "/api/ai/jobs/recent"]);

const PRACTICE_UNIT = '[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]';

// The task column starts folded below this width (practice-frame.tsx PRACTICE_NARROW_QUERY) - the smoke window (1248) is under it
const WIDE = { width: 1600, height: 900 };

// Leaks seen while following the tasks - the backend step reports them too (each step has its own browser context)
let followLeaks = null;

function watchLeaks(page) {
  const leaks = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && !REAL_PATHS.has(url.pathname)) leaks.push(`${request.method()} ${url.pathname}`);
  });
  return leaks;
}

async function openPractice(page) {
  await page.goto(`${BASE}/practice`);
  await wait(page, "practice-band");
  // Assign draws its frame once the fake server has answered the bundle read
  await wait(page, "assign-bar");
}

const task = (page, id) => page.locator(`[data-testid="practice-task-${id}"]`);
const waitDone = (page, id) => page.locator(`[data-testid="practice-task-${id}"][data-done="true"]`).waitFor({ timeout: T });
const readOpenTask = (page) => page.evaluate(() => document.querySelector('[data-testid^="practice-task-"][data-open]')?.getAttribute("data-testid") ?? null);
const countOld = (page) => page.locator(PRACTICE_UNIT).count();
const oldUnit = (page, text) => page.locator(PRACTICE_UNIT, { hasText: text }).first();

// Click the first text line of the Old unit holding this text (away from the lead and badges), then wait for its box to be picked
async function clickOld(page, text) {
  const unit = oldUnit(page, text);
  await unit.waitFor({ timeout: T });
  await unit.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const point = await unit.evaluate((el) => {
    const rect = el.getClientRects()[0];
    return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator('[data-testid="assign-old"] [data-sel]', { hasText: text }).first().waitFor({ timeout: T });
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
  // the smoke window is under 1280px - the task column starts as the folded bar, still showing how many tasks are done
  await page.locator('[data-testid="practice-tasks"][data-folded]').waitFor({ timeout: T });
  const startBar = await getBox(page, "practice-tasks");
  check("a narrow window starts with the task column folded to a 36px bar", Math.round(startBar.width) === 36, String(startBar.width));
  check("the folded bar shows the progress 0/12", (await page.locator('[data-testid="practice-progress"]').isVisible()) && (await getText(page, "practice-progress")).trim() === "0/12", await getText(page, "practice-progress"));
  // unfold - twelve tasks, none done, the first one open with its keys and the manual link
  await page.locator('[data-testid="practice-tasks-fold"]').click();
  await page.locator('[data-testid="practice-tasks"]:not([data-folded])').waitFor({ timeout: T });
  const open = await getBox(page, "practice-tasks");
  check("unfolding opens the column wider than the bar", open.width > startBar.width, `${startBar.width} -> ${open.width}`);
  check("the column lists twelve tasks, none done", (await page.locator('[data-testid^="practice-task-"][data-done]').count()) === 12 && (await page.locator('[data-testid^="practice-task-"][data-done="true"]').count()) === 0);
  check("the progress reads 0/12", (await getText(page, "practice-progress")).trim() === "0/12", await getText(page, "practice-progress"));
  check("the first task is open with its keys", (await readOpenTask(page)) === "practice-task-pick" && (await task(page, "pick").locator("kbd").count()) > 0, String(await readOpenTask(page)));
  const manual = page.locator('[data-testid="practice-task-manual"]');
  check("the open task links to its place in the manual in a new tab", (await manual.getAttribute("href")) === "/manual#assign" && (await manual.getAttribute("target")) === "_blank", String(await manual.getAttribute("href")));
  // fold and unfold the task column
  await page.locator('[data-testid="practice-tasks-fold"]').click();
  await page.locator('[data-testid="practice-tasks"][data-folded]').waitFor({ timeout: T });
  const folded = await getBox(page, "practice-tasks");
  check("folding leaves a 36px bar", Math.round(folded.width) === 36 && folded.width < open.width, `${open.width} -> ${folded.width}`);
  await page.locator('[data-testid="practice-tasks-fold"]').click();
  await page.locator('[data-testid="practice-tasks"]:not([data-folded])').waitFor({ timeout: T });
  check("unfolding brings the column back", Math.round((await getBox(page, "practice-tasks")).width) === Math.round(open.width));
  await takeShot("sop-practice-band.png");
  // U5: the Assign help (?) has no practice link - only the user menu and the manual head lead here
  // pick a line first so the key lands in Assign (focus is on the fold button now)
  await clickOld(page, "연습용 SOP — Assign 따라 하기");
  await page.keyboard.press("?");
  await wait(page, "assign-help-keys");
  check("the Assign help has no link to the practice screen", (await page.locator('[data-testid="assign-help"] a[href*="/practice"]').count()) === 0);
  // the second entry: the head of the manual
  await page.goto(`${BASE}/manual`);
  await wait(page, "manual-practice");
  check("the manual head links to the practice screen", (await page.locator('[data-testid="manual-practice"]').getAttribute("href")) === "/practice");
  await page.locator('[data-testid="manual-practice"]').click();
  await page.waitForURL(/\/practice$/, { timeout: T });
  await wait(page, "practice-band");
  check("the manual link lands on the practice screen", true);
});

await runStep("practice: follow tasks", {}, async ({ page }) => {
  const leaks = watchLeaks(page);
  await page.setViewportSize(WIDE);
  await openPractice(page);
  await page.locator('[data-testid="practice-tasks"]:not([data-folded])').waitFor({ timeout: T });
  check("a wide window starts with the task column open", true);
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator(PRACTICE_UNIT).first().waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");

  // Split first (any order works): double-click the two-sentence box to put a cut, then Split here
  const before = await countOld(page);
  const twoSentences = oldUnit(page, "보류한 Unit은 On hold에 모입니다.");
  await twoSentences.scrollIntoViewIfNeeded({ timeout: T });
  await twoSentences.dblclick();
  await page.locator('[data-testid="assign-cut-run"]').waitFor({ timeout: T });
  await page.locator('[data-testid="assign-cut-run"]').click();
  await waitDone(page, "split");
  await page.waitForFunction(([sel, count]) => document.querySelectorAll(sel).length === count + 1, [PRACTICE_UNIT, before], { timeout: T });
  check("Split: the box is two boxes and the task is ticked", true);
  check("Split was not the first open task, so the first task stays open", (await readOpenTask(page)) === "practice-task-pick", String(await readOpenTask(page)));

  // Pick and move: click a line, J
  await clickOld(page, "연습용 SOP — Assign 따라 하기");
  await page.keyboard.press("j");
  await waitDone(page, "pick");
  check("Pick: J in Assign ticks the task and the next open task opens", (await readOpenTask(page)) === "practice-task-link", String(await readOpenTask(page)));

  // Confirm with a card: pick pair B, wait for its suggestion card, Enter
  const pairB = "추천 카드를 누르면 고르기만 하고, 이어서 Enter로 바로 확정합니다.";
  await clickOld(page, pairB);
  await wait(page, "assign-rec-0");
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
  await page.keyboard.press("Enter");
  await waitDone(page, "confirm");
  check("Confirm: Enter on the card ticks Confirm and not Link", (await task(page, "link").getAttribute("data-done")) === "false");
  await page.waitForLoadState("networkidle");
  await clickOld(page, pairB);
  await page.locator('[data-testid="assign-chosen"]:not(.is-empty)').waitFor({ timeout: T });
  check("Confirm: pair B now has a destination", true);

  // Unassign: U on the confirmed pair
  await page.keyboard.press("u");
  await waitDone(page, "unassign");
  await page.locator('[data-testid="assign-chosen"].is-empty').waitFor({ timeout: T });
  check("Unassign: U clears pair B and ticks the task", true);

  // Link to New: pick pair A, then its New sentence, then Link on the bar
  await clickOld(page, "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.");
  const newA = page.locator('[data-pane="new"] [data-testid^="assign-new-pick-"]', { hasText: "Old Unit마다 새 문서에서 갈 곳을 정합니다." }).first();
  await newA.scrollIntoViewIfNeeded({ timeout: T });
  await newA.click();
  const link = page.locator('[data-testid="assign-pick-bar-link"][data-kind="link"]');
  await link.waitFor({ state: "visible", timeout: T });
  await link.click();
  await waitDone(page, "link");
  check("Link: the bar's Link ticks the task", true);
  await page.waitForLoadState("networkidle");

  // Hold: Shift+H on pair C with a reason - the hold mark shows on the paper
  const pairC = "정할 수 없는 Unit은 사유를 적어 미룹니다.";
  await clickOld(page, pairC);
  await page.keyboard.press("Shift+H");
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Practice: ask the owner");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await waitDone(page, "hold");
  const holdMark = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-hold-"]');
  await holdMark.first().waitFor({ timeout: T });
  check("Hold: the hold mark is on the paper and the task is ticked", true);

  // Undo: Ctrl+Z takes the hold back - the mark goes, the Hold tick stays
  await page.keyboard.press("ControlOrMeta+z");
  await waitDone(page, "undo");
  await holdMark.first().waitFor({ state: "detached", timeout: T });
  check("Undo: Ctrl+Z takes the hold back and Hold stays ticked", (await task(page, "hold").getAttribute("data-done")) === "true");

  // Merge: Shift+J twice on the first broken piece - two boxes become one
  const beforeMerge = await countOld(page);
  await clickOld(page, "나누기와 합치기는 확정과 같은 저장이라");
  await page.keyboard.press("Shift+J");
  await page.keyboard.press("Shift+J");
  await waitDone(page, "merge");
  await page.waitForFunction(([sel, count]) => document.querySelectorAll(sel).length === count - 1, [PRACTICE_UNIT, beforeMerge], { timeout: T });
  check("Merge: the two pieces are one box and the task is ticked", true);

  // Keyboard map: ? opens the help, then its Keyboard map button
  await page.keyboard.press("?");
  await wait(page, "assign-help-keyboard-map");
  await page.locator('[data-testid="assign-help-keyboard-map"]').click();
  await wait(page, "assign-keyboard-map-board");
  await waitDone(page, "keyboard");
  await page.keyboard.press("Escape");
  check("Keyboard map: opening it from the help ticks the task", true);

  const done = ["split", "pick", "confirm", "unassign", "link", "hold", "undo", "merge", "keyboard"];
  check("the progress counts the nine tasks followed", (await getText(page, "practice-progress")).trim() === `${done.length}/12`, await getText(page, "practice-progress"));
  check("the open task is the first one not done yet", (await readOpenTask(page)) === "practice-task-pair", String(await readOpenTask(page)));
  // any task opens when pressed, done or not
  await task(page, "toc").locator("button").click();
  check("pressing a task opens it", (await readOpenTask(page)) === "practice-task-toc", String(await readOpenTask(page)));
  await page.waitForLoadState("networkidle");
  followLeaks = leaks;
});

await runStep("practice: nothing reaches the backend", {}, async ({ page }) => {
  // the follow step wrote through every task road it took (link, confirm, unassign, hold, undo, split, merge) - none of it may leave the browser
  if (followLeaks !== null) check("no request left for the backend while following the tasks", followLeaks.length === 0, followLeaks.join(" | "));
  const leaks = watchLeaks(page);
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

await runStep("practice: unsupported says so", {}, async ({ page }) => {
  // Reset is not a practice task - the fake server answers practice_unsupported and the window says so in the usual rule wording
  await openPractice(page);
  await page.locator(PRACTICE_UNIT).first().waitFor({ timeout: T });
  await page.locator('[data-testid="assign-more"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-error");
  check("an action practice does not do says Not available in practice", (await getText(page, "assign-reset-error")).includes("Not available in practice"), await getText(page, "assign-reset-error"));
  await page.keyboard.press("Escape");
});

}
