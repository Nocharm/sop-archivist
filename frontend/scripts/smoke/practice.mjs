// SOP smoke steps for the practice screen /practice (design 2026-11-26-practice-page §10). Run through ../pw-smoke-sop.mjs (ONLY="practice:").
// The practice screen writes nothing to the server, so these steps need no seed reset.
// Step bodies sit at column 0 inside run() on purpose, like the other screen files.

import { BASE, T, check, runStep, wait, getText, getBox } from "./common.mjs";


// Real requests allowed on /practice (practice-route.ts REAL_ON_PRACTICE plus the sign-in mode probe) - anything under /api/bundles/ or any other path is a leak
const REAL_PATHS = new Set(["/api/me", "/api/auth/mode", "/api/ai/jobs/recent"]);

const PRACTICE_UNIT = '[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]';

// A wide window for following the tasks - the coach card sits right of the lit box when there is room
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

// The band's dot fills when the task is done; the coach card shows one task at a time (data-task) and flips to the check (data-done) once it is done
const dot = (page, id) => page.locator(`[data-testid="practice-dot-${id}"]`);
const waitDone = (page, id) => page.locator(`[data-testid="practice-dot-${id}"][data-done="true"]`).waitFor({ timeout: T });
const readCoach = (page) => page.evaluate(() => {
  const coach = document.querySelector('[data-testid="practice-coach"]');
  return coach ? `${coach.getAttribute("data-task")}:${coach.querySelector('[data-testid="practice-coach-flip"]')?.getAttribute("data-done")}` : null;
});
// The card flips to the check while it still shows the task done (the flip runs about 1.3s, then animationend moves it on)
const waitFlip = (page, id) => page.locator(`[data-testid="practice-coach"][data-task="${id}"] [data-testid="practice-coach-flip"][data-done="true"]`).waitFor({ timeout: T });
// The card stands face up on this task and has measured its box (data-pending goes once the lit box is placed) - wait for it before the next key so the scroll to the box cannot race a click
const waitCoach = (page, id) => page.locator(`[data-testid="practice-coach"][data-task="${id}"]:not([data-pending]) [data-testid="practice-coach-flip"][data-done="false"]`).waitFor({ timeout: T });
// Units, not elements - a merged unit draws each of its pieces under the same testid
const countOld = (page) => page.evaluate((sel) => new Set([...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-testid"))).size, PRACTICE_UNIT);
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
  // the old right task column took about 300px (or a 36px bar under 1280px) - now nothing sits beside Assign
  const assignBox = await getBox(page, "assign");
  const bandBox = await getBox(page, "practice-band");
  check("there is no task column - Assign spans the band's width", (await page.locator('[data-testid="practice-tasks"]').count()) === 0 && assignBox.x + assignBox.width >= bandBox.x + bandBox.width - 24, `${assignBox.x + assignBox.width} vs ${bandBox.x + bandBox.width}`);
  check("Assign is the real one (its frame is drawn)", (await page.locator('[data-testid="assign"]').count()) === 1);
  // the user menu on /practice has no Practice item, and the book button opens the practice piece
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu-manual");
  check("the user menu has no Practice item on the practice screen", (await page.locator('[data-testid="user-menu-practice"]').count()) === 0);
  await page.keyboard.press("Escape");
  check("the help link points at the practice piece", (await page.locator('[data-testid="top-bar-manual"]').getAttribute("href")) === "/manual#practice");
  // the band: fourteen dots (U3's twelve plus the two V switches), none done, the first one now, and 0/14
  await page.locator(PRACTICE_UNIT).first().waitFor({ timeout: T });
  check("the band draws fourteen progress dots", (await page.locator('[data-testid^="practice-dot-"][data-done]').count()) === 14);
  check("the band shows the progress 0/14", (await page.locator('[data-testid="practice-progress"]').isVisible()) && (await getText(page, "practice-progress")).trim() === "0/14", await getText(page, "practice-progress"));
  check("no dot is done yet", (await page.locator('[data-testid^="practice-dot-"][data-done="true"]').count()) === 0);
  check("the first dot is the task now", (await page.locator('[data-testid^="practice-dot-"][data-now="true"]').count()) === 1 && (await dot(page, "pick").getAttribute("data-now")) === "true");
  // the coach card: the first task with its chapter (the view it is shown in - a fresh browser opens Assign in two documents), keys and the manual link, standing next to the lit box
  await waitCoach(page, "pick");
  check("the coach card shows the first task with its chapter", (await getText(page, "practice-coach")).includes("Task 1 / 14 · Two documents"), await getText(page, "practice-coach"));
  check("the coach card shows the keys to press", (await page.locator('[data-testid="practice-coach"] kbd').count()) > 0);
  const manual = page.locator('[data-testid="practice-coach-manual"]');
  check("the coach card links to its place in the manual in a new tab", (await manual.getAttribute("href")) === "/manual#assign" && (await manual.getAttribute("target")) === "_blank", String(await manual.getAttribute("href")));
  // the lit box is the task's Old unit (practice-tasks.ts target: unit 11, the 1. Purpose heading pair) and the card stands beside it, on screen
  const lit = await page.evaluate(() => {
    const target = document.querySelector('[data-testid="assign-old"] [data-testid="assign-paper-piece-11"]') ?? document.querySelector('[data-testid="assign-old"] [data-testid="assign-paper-unit-11"]');
    const hole = document.querySelector('[data-testid="practice-coach-hole"]');
    if (!target || !hole) return null;
    const t = target.getBoundingClientRect();
    const h = hole.getBoundingClientRect();
    return { cx: t.left + t.width / 2, cy: t.top + t.height / 2, h: { left: h.left, right: h.right, top: h.top, bottom: h.bottom } };
  });
  check("the lit box sits on the task's Old unit", lit !== null && lit.cx >= lit.h.left && lit.cx <= lit.h.right && lit.cy >= lit.h.top && lit.cy <= lit.h.bottom, JSON.stringify(lit));
  const card = await getBox(page, "practice-coach");
  const viewport = page.viewportSize();
  check("the coach card stands beside the lit box, inside the window", ["right", "below", "above"].includes(await page.locator('[data-testid="practice-coach"]').getAttribute("data-place")) && card.x >= 0 && card.y >= 0 && card.x + card.width <= viewport.width && card.y + card.height <= viewport.height, JSON.stringify(card));
  // a dot goes to its task (any order), and Skip goes on to the next task not done yet
  await dot(page, "hold").click();
  await waitCoach(page, "hold");
  check("pressing a dot moves the coach card to that task", (await dot(page, "hold").getAttribute("data-now")) === "true" && (await dot(page, "pick").getAttribute("data-now")) === "false");
  check("pressing a dot hands the focus back to the Old paper", await page.evaluate(() => document.activeElement?.closest('[data-pane="old"] .pane-body') !== null));
  // Hold is a one-document task and Assign shows two - the card asks for V first and lights the One document button
  check("a one-document task in two documents asks for V first", (await page.locator('[data-testid="practice-coach-pane"]').isVisible()) && (await getText(page, "practice-coach-pane")).includes("V"), await getText(page, "practice-coach"));
  // the lit box slides over from the previous task's box - wait until it has settled around the button (same bounds as before, not looser)
  const viewLit = await page
    .waitForFunction(() => {
      const button = document.querySelector('[data-testid="assign-view-one"]')?.getBoundingClientRect();
      const hole = document.querySelector('[data-testid="practice-coach-hole"]')?.getBoundingClientRect();
      return button && hole ? button.left >= hole.left - 1 && button.right <= hole.right + 1 && button.top >= hole.top - 1 && button.bottom <= hole.bottom + 1 : false;
    }, null, { timeout: T })
    .then(() => true, () => false);
  check("the lit box is the One document button meanwhile", viewLit);
  await page.locator('[data-testid="practice-coach-skip"]').click();
  await waitCoach(page, "merge");
  check("Skip goes on to the next task not done yet, leaving the skipped one not done", (await dot(page, "hold").getAttribute("data-done")) === "false" && (await dot(page, "merge").getAttribute("data-now")) === "true");
  // Unassign has nothing linked yet - its card floats under the band with no lit box
  await dot(page, "unassign").click();
  await waitCoach(page, "unassign");
  check("a task with no box yet floats its card in the middle with no dim", (await page.locator('[data-testid="practice-coach"]').getAttribute("data-place")) === "center" && (await page.locator('[data-testid="practice-coach-hole"]').count()) === 0);
  await takeShot("sop-practice-band.png");
  // U5: the Assign help (?) has no practice link - only the user menu and the manual head lead here
  // ? is only let through on the keyboard map task - open it first, then pick a line so the key lands in Assign (the dim lets the click through)
  await dot(page, "keyboard").click();
  await waitCoach(page, "keyboard");
  await clickOld(page, "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.");
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
  await waitCoach(page, "pick");
  check("the coach card starts on the first task, face up", (await readCoach(page)) === "pick:false", String(await readCoach(page)));
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator(PRACTICE_UNIT).first().waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  const pairA = "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.";

  // Only the task's keys get through: Shift+H on Pick does nothing in Assign and the card says so
  await clickOld(page, pairA);
  await page.keyboard.press("Shift+H");
  await wait(page, "practice-coach-nudge");
  check("a key the task does not use is stopped and the card says so", (await getText(page, "practice-coach-nudge")).includes("⇧H") && (await page.locator('[data-testid="assign-remark-modal"]').count()) === 0, await getText(page, "practice-coach-nudge"));
  check("the stopped key ticks nothing", (await page.locator('[data-testid^="practice-dot-"][data-done="true"]').count()) === 0);

  // Two documents - Pick and move: J on the picked line
  await page.keyboard.press("j");
  await waitDone(page, "pick");
  await waitFlip(page, "pick");
  await waitCoach(page, "link");
  check("Pick: J fills its dot, the card flips to the check and moves on to Link", (await dot(page, "link").getAttribute("data-now")) === "true");

  // Link to New: pick pair A, then its New sentence, then Link on the bar
  await clickOld(page, pairA);
  const newA = page.locator('[data-pane="new"] [data-testid^="assign-new-pick-"]', { hasText: "Old Unit마다 새 문서에서 갈 곳을 정합니다." }).first();
  await newA.scrollIntoViewIfNeeded({ timeout: T });
  await newA.click();
  const link = page.locator('[data-testid="assign-pick-bar-link"][data-kind="link"]');
  await link.waitFor({ state: "visible", timeout: T });
  await link.click();
  await waitDone(page, "link");
  await waitFlip(page, "link");
  await waitCoach(page, "unassign");
  check("Link: the bar's Link ticks the task, the card flips and moves on to Unassign", true);
  await page.waitForLoadState("networkidle");

  // Unassign: U on the linked pair A
  await clickOld(page, pairA);
  await page.locator('[data-testid="assign-chosen"]:not(.is-empty)').waitFor({ timeout: T });
  await page.keyboard.press("u");
  await waitDone(page, "unassign");
  await page.locator('[data-testid="assign-chosen"].is-empty').waitFor({ timeout: T });
  await waitFlip(page, "unassign");
  await waitCoach(page, "view_one");
  check("Unassign: U clears pair A, ticks the task and the card moves on to the V switch", true);

  // V to one document - the panes fold to the Old document
  await page.keyboard.press("v");
  await waitDone(page, "view_one");
  await page.locator(".assign-panes[data-single]").waitFor({ timeout: T });
  await waitFlip(page, "view_one");
  await waitCoach(page, "confirm");
  check("View: V folds Assign to one document, ticks the task and the card moves on to Confirm", (await page.locator('[data-testid="practice-coach-pane"]').count()) === 0);

  // One document - Confirm with a card: pick pair B, wait for its suggestion card, Enter
  const pairB = "추천 카드를 누르면 고르기만 하고, 이어서 Enter로 바로 확정합니다.";
  await clickOld(page, pairB);
  await wait(page, "assign-rec-0");
  // Enter confirms when the card is picked (confirm) or straight with the first card (choose, B1-R2)
  await page.locator('[data-testid="assign-primary"]:is([data-state="confirm"], [data-state="choose"])').waitFor({ timeout: T });
  await page.keyboard.press("Enter");
  await waitDone(page, "confirm");
  check("Confirm: Enter on the card in one document ticks Confirm and not Link again", (await page.locator('[data-testid^="practice-dot-"][data-done="true"]').count()) === 5);
  await waitFlip(page, "confirm");
  await waitCoach(page, "hold");
  await page.waitForLoadState("networkidle");
  await clickOld(page, pairB);
  await page.locator('[data-testid="assign-chosen"]:not(.is-empty)').waitFor({ timeout: T });
  check("Confirm: pair B now has a destination", true);

  // Hold: Shift+H on pair C with a reason - the hold mark shows on the paper
  const pairC = "정할 수 없는 Unit은 사유를 적어 미룹니다.";
  await clickOld(page, pairC);
  await page.keyboard.press("Shift+H");
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Practice: ask the owner");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await waitDone(page, "hold");
  await waitFlip(page, "hold");
  await waitCoach(page, "merge");
  const holdMark = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-hold-"]');
  await holdMark.first().waitFor({ timeout: T });
  check("Hold: the hold mark is on the paper, the task is ticked and the card moved on to Merge", true);

  // Merge: Shift+J twice on the first broken piece - two boxes become one
  const beforeMerge = await countOld(page);
  await clickOld(page, "나누기와 합치기는 확정과 같은 저장이라");
  await page.keyboard.press("Shift+J");
  await page.keyboard.press("Shift+J");
  await waitDone(page, "merge");
  await waitFlip(page, "merge");
  await waitCoach(page, "split");
  await page.waitForFunction(([sel, count]) => new Set([...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-testid"))).size === count - 1, [PRACTICE_UNIT, beforeMerge], { timeout: T });
  check("Merge: the two pieces are one box, the task is ticked and the card moved on to Split", true);

  // Split: double-click the two-sentence box to put a cut, then Split here
  const beforeSplit = await countOld(page);
  const twoSentences = oldUnit(page, "보류한 Unit은 On hold에 모입니다.");
  await twoSentences.scrollIntoViewIfNeeded({ timeout: T });
  await twoSentences.dblclick();
  await page.locator('[data-testid="assign-cut-run"]').waitFor({ timeout: T });
  await page.locator('[data-testid="assign-cut-run"]').click();
  await waitDone(page, "split");
  await page.waitForFunction(([sel, count]) => new Set([...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-testid"))).size === count + 1, [PRACTICE_UNIT, beforeSplit], { timeout: T });
  await waitFlip(page, "split");
  await waitCoach(page, "pair");
  check("Split: the box is two boxes, the task is ticked and the card moved on to Pair", true);

  // Undo out of order (any order works): its dot, then Ctrl+Z takes the split back - the Split tick stays
  await dot(page, "undo").click();
  await waitCoach(page, "undo");
  await page.keyboard.press("ControlOrMeta+z");
  await waitDone(page, "undo");
  await page.waitForFunction(([sel, count]) => new Set([...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-testid"))).size === count, [PRACTICE_UNIT, beforeSplit], { timeout: T });
  check("Undo: the key lands in Assign right after the dot (focus back on the paper), takes the split back and Split stays ticked", (await dot(page, "split").getAttribute("data-done")) === "true");

  // Keyboard map: ? opens the help, then its Keyboard map button
  await dot(page, "keyboard").click();
  await waitCoach(page, "keyboard");
  await page.keyboard.press("?");
  await wait(page, "assign-help-keyboard-map");
  await page.locator('[data-testid="assign-help-keyboard-map"]').click();
  await wait(page, "assign-keyboard-map-board");
  await waitDone(page, "keyboard");
  await page.keyboard.press("Escape");
  check("Keyboard map: opening it from the help ticks the task", true);

  // Back to two documents with the bar's button (the same switch as V)
  await dot(page, "view_two").click();
  await waitCoach(page, "view_two");
  await page.locator('[data-testid="assign-view-two"]').click();
  await waitDone(page, "view_two");
  await page.locator(".assign-panes:not([data-single])").waitFor({ timeout: T });
  check("View: the Two documents button brings New back and ticks the task", true);

  const done = ["pick", "link", "unassign", "view_one", "confirm", "hold", "merge", "split", "undo", "keyboard", "view_two"];
  check("the progress counts the eleven tasks followed", (await getText(page, "practice-progress")).trim() === `${done.length}/14`, await getText(page, "practice-progress"));
  check("the band fills the eleven dots followed", (await page.locator('[data-testid^="practice-dot-"][data-done="true"]').count()) === done.length);
  await waitCoach(page, "pair");
  check("the coach card is on the first task not done yet", (await readCoach(page)) === "pair:false", String(await readCoach(page)));
  // any task opens when its dot is pressed, done or not
  await dot(page, "toc").click();
  await waitCoach(page, "toc");
  check("pressing a dot moves the card to that task", (await dot(page, "toc").getAttribute("data-now")) === "true");
  await page.waitForLoadState("networkidle");
  followLeaks = leaks;
});

await runStep("practice: nothing reaches the backend", {}, async ({ page }) => {
  // the follow step wrote through every task road it took (link, unassign, confirm, hold, merge, split, undo) - none of it may leave the browser
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
  // ⇧H is only let through on the Hold task - its dot first (the focus goes back to the paper)
  await dot(page, "hold").click();
  await waitCoach(page, "hold");
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

await runStep("practice: Original tab says the practice document has no source file", {}, async ({ page }) => {
  // the fake server answers original-places with file_format "none" - the Space sheet's Original tab says there is no original file instead of Not available
  const leaks = watchLeaks(page);
  await openPractice(page);
  const unit = page.locator(PRACTICE_UNIT).nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  // Space is no task's key - with the focus off the page (body) the key passes outside the practice frame's key filter, straight to Assign like a real Bundle
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  await page.locator('[data-testid="space-tab-original"]').click();
  // one pane shows space-original, two panes space-original-old (the practice New document has no file either)
  const none = page.locator('[data-testid="space-original-none"], [data-testid="space-original-old-none"]').first();
  await none.waitFor({ timeout: T });
  const text = await none.innerText();
  check("the Original tab says the practice document has no original file", text.includes("no original file"), text);
  check("it is not the Not available in practice wording", !text.includes("Not available"), text);
  check("the Original tab asked nothing of the backend", leaks.length === 0, leaks.join(" | "));
  await page.keyboard.press("Escape");
});

}
