// SOP smoke steps for the outputs screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import {
  BASE,
  T,
  check,
  runStep,
  wait,
  getText,
  findOrderDocs,
  halfBundleId,
  TOC_LINES,
  findTocBundle,
} from "./common.mjs";


export async function run() {

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

// 결과물은 새 문서마다 표·그림 번호를 1부터 다시 매기고 이은 참조도 따라간다(저장 글은 원문 번호 그대로) - 검토 대기 묶음은 OLD-7을 SOP에 모두 보냈다
await runStep("outputs: renumbered table and figure captions with a reference", { storage: { "sopa.lang": "ko" } }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api${path}`, { headers })).json();
  const bundles = await getJson("/bundles");
  const review = bundles.find((bundle) => bundle.title.includes("검토 대기"));
  const sop = (await getJson(`/bundles/${review.id}/tobe`)).docs.find((doc) => doc.code === "SOP-CF");
  const items = (await getJson(`/bundles/${review.id}/outputs/c/docs/${sop.id}?lang=ko`)).sections.flatMap((section) => section.items);
  const table = items.find((item) => item.kind === "table" && item.renumber?.from_label === "표 3");
  const figure = items.find((item) => item.kind === "figure" && item.renumber !== null);
  check("the SOP renumbers OLD-7's table 3 to table 1 and its figures", table?.renumber?.to_label === "표 1" && Boolean(figure), JSON.stringify([table?.renumber, figure?.renumber]));
  if (!table || !figure) return;
  await page.goto(`${BASE}/bundles/${review.id}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
  const mark = page.locator(`[data-testid="assign-new-${table.target_id}-renumber"]`);
  await mark.scrollIntoViewIfNeeded({ timeout: T });
  // 화면 밖 줄은 그리기를 미뤄(content-visibility) innerText가 비어 올 수 있다 - 글은 textContent로 읽는다
  const readText = async (testId) => ((await page.locator(`[data-testid="${testId}"]`).first().textContent()) ?? "").trim();
  const tableMark = await readText(`assign-new-${table.target_id}-renumber`);
  check("the New pane shows 표 3 → 표 1 before the caption", tableMark === "표 3 → 표 1", tableMark);
  check("the New pane caption has the new number", (await readText(`assign-new-${table.target_id}-caption`)).includes("표 1. 운전 조건"));
  const figureMark = await readText(`assign-new-${figure.target_id}-renumber`);
  check("the New pane marks the renumbered figure too", figureMark === `${figure.renumber.from_label} → ${figure.renumber.to_label}`, figureMark);
  await takeShot("sop-assign-new-renumber.png");
  await page.goto(`${BASE}/bundles/${review.id}/outputs`);
  await wait(page, "output-c");
  const cMark = page.locator(`[data-testid="output-c-renumber-${table.target_id}"]`);
  await cMark.scrollIntoViewIfNeeded({ timeout: T });
  check("C marks the renumbered table the same way", (await cMark.innerText()).trim() === "표 3 → 표 1", await cMark.innerText());
  const cText = await getText(page, "output-c");
  check("C shows the renumbered caption", cText.includes("표 1. 운전 조건"));
  check("C shows the reference following the new number", cText.includes("운전 조건은 표 1을 따른다."));
  await takeShot("sop-outputs-c-renumber.png");
  // 참조 경고는 막지 않고 개요의 알림으로 - 데모의 AI 제안 묶음을 받으면 하나 이상 생긴다. AI는 제안만 하므로(설계 2026-11-19-ai-suggest-only)
  // 분류 추천을 일괄 수락 API로 받아 보고, 같은 되돌리기 세션으로 거둬 Assign 단계가 쓰는 살아 있는 추천을 그대로 둔다
  const ai = bundles.find((bundle) => bundle.title.includes("AI 제안"));
  const preview = await getJson(`/bundles/${ai.id}/ai/accept-preview?kind=classify`);
  const undo = { session: "smoke-outputs-refs" };
  const accepted = await page.request.post(`${BASE}/api/bundles/${ai.id}/ai/accept`, {
    headers,
    data: { kind: "classify", suggestion_ids: preview.items.map((item) => item.suggestion_id), delete_reason: "smoke", undo },
  });
  check("the AI bundle's classify suggestions are taken in one request", accepted.ok() && (await accepted.json()).accepted === preview.items.length, await accepted.text());
  try {
    const notices = (await getJson(`/bundles/${ai.id}/review/readiness`)).notices.filter((notice) => notice.code.startsWith("caption_ref_"));
    check("the AI bundle has a reference warning", notices.length > 0, JSON.stringify(notices.map((notice) => notice.code)));
    await page.goto(`${BASE}/bundles/${ai.id}`);
    for (const notice of notices) {
      await wait(page, `overview-notice-${notice.code}`);
      const text = await getText(page, `overview-notice-${notice.code}`);
      check(`the overview words ${notice.code} as a reference warning`, text.includes("참조") && text.includes(String(notice.count)) && !text.includes("검사 경고"), text);
    }
  } finally {
    const undone = await page.request.post(`${BASE}/api/bundles/${ai.id}/decisions/undo`, { headers, data: undo });
    const after = await getJson(`/bundles/${ai.id}/ai/accept-preview?kind=classify`);
    check("one undo puts every taken suggestion back", undone.ok() && after.items.length === preview.items.length, `${undone.status()} ${after.items.length}/${preview.items.length}`);
  }
});

await runStep("outputs: A, B, C and the Excel preview", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  check("C shows the new documents", (await getText(page, "output-c")).includes("SOP-CF"));
  // 표는 캡션 줄이 표 앞, 그림은 [Figure] 대신 캡션 글(캡션 있는 표·그림이 데모에 있다)
  const captionBeforeTable = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="output-c-caption-"]')].some((el) => {
    let next = el.nextElementSibling;
    while (next?.matches('[data-testid^="output-c-caption-"]')) next = next.nextElementSibling;
    return next?.classList.contains("ptbl-scroll") ?? false;
  }));
  check("C puts a table caption line before its table", captionBeforeTable);
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

await runStep("outputs: export preview folds TOC rows and Output A keeps them as automatic deletes", {}, async ({ page, takeShot }) => {
  const toc = await findTocBundle(page);
  if (!toc) return;
  await page.goto(`${BASE}/bundles/${toc.id}/outputs`);
  // 결과물 화면은 진행 상태에 따라 C 탭으로 열린다 - A를 눌러 연다
  await page.locator('[data-testid="outputs-tab-a"]').click();
  await wait(page, "output-a");
  check("Output A has one Deleted row per contents line", (await page.locator('[data-testid^="output-a-toc-"]').count()) === TOC_LINES);
  check("the summary counts the contents lines", (await getText(page, "outputs-sum-toc_deleted")).trim() === String(TOC_LINES));
  await page.locator('[data-testid="outputs-export-open"]').click();
  await wait(page, "export-preview-sheet");
  const folded = page.locator('[data-testid^="export-preview-toc-"][data-toc="folded"]');
  check("the A sheet folds the contents rows into one line", (await folded.count()) === 1 && (await folded.innerText()).includes(`${TOC_LINES} lines`), await folded.first().innerText());
  const rowsBefore = await page.locator('[data-testid="export-preview-body"] tr').count();
  await folded.click();
  await page.locator('[data-testid^="export-preview-toc-"][data-toc="open"]').waitFor({ timeout: T });
  check("clicking the folded line shows every contents row", (await page.locator('[data-testid="export-preview-body"] tr').count()) === rowsBefore + TOC_LINES - 1);
  await takeShot("sop-outputs-preview-toc.png");
  await page.locator('[data-testid^="export-preview-toc-"][data-toc="open"]').click();
  await folded.first().waitFor({ timeout: T });
  check("clicking the first row folds them again", (await folded.count()) === 1);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="export-preview"]').waitFor({ state: "detached", timeout: T });
});

// 시트 보기(MD 2 S1) - 폭에 맞춘 한 장이라 20번째 열 머리까지 틀 안에 보이고, 스크롤바 없이 끌면 본문 transform이 바뀐다.
// 높이가 낮은 창(560px)에서 본다 - 반쯤 한 묶음의 A 시트가 창 높이에 다 들어가면 옮길 것이 없어 끌기를 확인할 수 없다. 목차 줄 펼침은 위 "outputs: export preview folds TOC rows …"가 본다.
await runStep("outputs: export preview fits the sheet, drags and switches tabs", {}, async ({ page, takeShot }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "outputs-export-open");
  await page.locator('[data-testid="outputs-export-open"]').click();
  await wait(page, "export-preview-sheet");
  const fit = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="export-preview-sheet"]').getBoundingClientRect();
    const heads = [...document.querySelectorAll('[data-testid="export-preview-head"] td[data-head]')];
    const last = heads.at(-1)?.getBoundingClientRect();
    return {
      count: heads.length,
      lastText: heads.at(-1)?.textContent?.trim() ?? "",
      inside: Boolean(last) && last.left >= frame.left - 1 && last.right <= frame.right + 1,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollbars: [...document.querySelectorAll('[data-testid="export-preview-sheet"], [data-testid="export-preview-sheet"] *')].some((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY) || ["auto", "scroll"].includes(getComputedStyle(el).overflowX)),
    };
  });
  check("the preview draws all 20 column heads", fit.count === 20, JSON.stringify(fit));
  check("the 20th column head (Checks) shows inside the sheet", fit.inside && fit.lastText === "Checks", JSON.stringify(fit));
  check("the preview has no horizontal page overflow", !fit.pageOverflow);
  check("the sheet has no scroll box", !fit.scrollbars);
  check("the A sheet carries the column bands", (await page.locator('[data-testid="export-preview-head"] .sv-band').count()) === 4);
  const frame = page.locator('[data-testid="export-preview-sheet"]');
  check("the sheet is movable in a low window", (await frame.getAttribute("data-movable")) !== null);
  const body = page.locator('[data-testid="export-preview-body"]');
  const before = await body.evaluate((el) => el.style.transform);
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25, { steps: 6 });
  await page.mouse.up();
  const dragged = await body.evaluate((el) => el.style.transform);
  check("dragging moves the sheet body", dragged !== before && /translate\(-?\d+(\.\d+)?px, -\d/.test(dragged), `${before} -> ${dragged}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -2000);
  await page.waitForFunction(() => document.querySelector('[data-testid="export-preview-body"]')?.style.transform === "translate(0px, 0px)", null, { timeout: T });
  check("the wheel scrolls back to the top", true);
  await takeShot("sop-outputs-preview-fit.png");
  await page.locator('[data-testid="export-preview-tab-1"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="export-preview-tab-1"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("switching to B Flow drops the A bands", (await page.locator('[data-testid="export-preview-head"] .sv-band').count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="export-preview"]').waitFor({ state: "detached", timeout: T });
});

// 결과물 C는 읽기 전용이라 줄 끝 단추가 없다 - Order의 호버 바탕·다리(::after)가 새어 들지 않고 줄에 올려도 가로 스크롤이 늘지 않는다
await runStep("outputs: read-only C rows keep their rest look on hover", {}, async ({ page }) => {
  for (const width of [1120, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
    await page.locator('[data-testid="outputs-tab-c"]').click();
    const row = page.locator('[data-testid="output-c"] [data-testid^="output-c-row-"]').nth(1);
    await row.waitFor({ timeout: T });
    const readState = () => row.evaluate((el) => {
      const pane = el.closest(".overflow-auto, .overflow-y-auto");
      return { background: getComputedStyle(el).backgroundColor, after: getComputedStyle(el, "::after").content, page: document.scrollingElement.scrollWidth, pane: pane.scrollWidth };
    });
    await row.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const rest = await readState();
    // 줄의 오른쪽 끝에 올린다 - 다리가 있다면 여기서 줄 밖으로 나간다
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width - 2, box.y + 6);
    await page.waitForTimeout(200);
    const hovered = await readState();
    check(`at ${width} a hovered read-only C row keeps its background`, hovered.background === rest.background, `${rest.background} -> ${hovered.background}`);
    check(`at ${width} a hovered read-only C row has no ::after box`, hovered.after === "none", hovered.after);
    check(`at ${width} hovering a read-only C row does not widen the page or the pane`, hovered.page === rest.page && hovered.pane === rest.pane, JSON.stringify({ rest, hovered }));
  }
});

// 결과물 화면의 C는 읽기 전용 - 작성자라도 줄이 끌리지 않는다(G13)
await runStep("outputs: read-only C rows do not start a drag", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await page.locator('[data-testid="outputs-tab-c"]').click();
  const row = page.locator('[data-testid="output-c"] [data-testid^="output-c-row-"]').nth(1);
  await row.waitFor({ timeout: T });
  check("read-only C rows are not drag boxes and have no drop line", (await page.locator("[data-drag-box]").count()) === 0 && (await page.locator('[data-testid="drop-line"]').count()) === 0);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 26, { steps: 5 });
  const state = await page.evaluate(() => ({ flag: document.documentElement.hasAttribute("data-box-drag"), cards: document.querySelectorAll('[data-testid="drag-card"]').length }));
  await page.mouse.up();
  check("pressing and moving on a read-only C row starts no drag", !state.flag && state.cards === 0, JSON.stringify(state));
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
  // 의미 확인은 화면에 먼저 켜지고 저장은 줄을 서서 뒤에 간다(날아가는 저장 하나 + 모인 나머지 하나) - 넷이 모두 켜진 저장의 응답을 받은 뒤에 떠난다.
  // 바로 page.goto로 떠나면 줄에 남은 저장이 버려져 개요의 Request review가 꺼진 채였다
  const checkKeys = ["numbers", "conditions", "tables", "figures"];
  const allSaved = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== "PUT" || !request.url().includes("/semantic-checks")) return false;
    const checks = JSON.parse(request.postData() ?? "{}").checks ?? {};
    return checkKeys.every((key) => checks[key] === true);
  }, { timeout: T });
  for (const key of checkKeys) {
    await page.locator(`[data-testid="outputs-check-${key}"]`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.checked === true, `outputs-check-${key}`, { timeout: T });
  }
  check("the meaning checks are saved before leaving", (await allSaved).ok());
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
  // 시드를 되돌린다(다시 열기 → 의미 확인 넷 → 다시 요청, 다시 열면 의미 확인이 비워진다) - 같은 DB로 다시 돌릴 때
  // 첫 단계와 검토 단계가 "In review" 묶음을 찾는다
  const author = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${reviewId}`;
  const statuses = [];
  let revision = (await (await page.request.get(api, { headers: author })).json()).revision;
  for (const [method, path, data] of [
    ["post", "review/reopen", { reason: "smoke: put the seed back in review" }],
    ["put", "semantic-checks", { checks: { numbers: true, conditions: true, tables: true, figures: true } }],
    ["post", "review/request", {}],
  ]) {
    const response = await page.request[method](`${api}/${path}`, { headers: author, data: { ...data, revision } });
    statuses.push(`${path} ${response.status()}`);
    if (!response.ok()) break;
    revision = (await response.json()).revision;
  }
  check("the seed bundle is back in review for the next run", statuses.length === 3 && statuses.every((s) => s.endsWith(" 200")), statuses.join(", "));
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
}
