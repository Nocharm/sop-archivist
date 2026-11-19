// SOP smoke steps for the order screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import {
  BASE,
  T,
  VIEWPORT,
  check,
  browser,
  runStep,
  wait,
  getText,
  findOrderDocs,
  installCommitCounter,
  dragThrough,
  halfBundleId,
  readToBe,
  WI_LIST_KEY,
  findRemovableChapter,
} from "./common.mjs";

// 결과물 C의 순서·깊이·표시 저장 - 화면은 먼저 바뀌고 저장은 뒤에서 하므로 응답을 기다린 뒤에 저장된 값을 본다
const isOrderSave = (request) => request.method() === "PUT" && /\/targets\/order/.test(request.url());
const waitOrderSave = (page) => page.waitForResponse((response) => isOrderSave(response.request()), { timeout: T });
// 줄 안의 한 점 - 글이 있으면 첫 글줄 위, 없으면(표) 줄 왼쪽 위. 앞선 놓기의 미끄러짐·따라가는 스크롤이 멈춘 뒤에 잰다(움직이는 중에 재면 다른 줄을 누른다)
async function pointInRow(page, id) {
  const text = page.locator(`[data-testid="output-c-item-${id}"]`);
  const target = (await text.count()) > 0 ? text : page.locator(`[data-testid="output-c-row-${id}"]`);
  let box = await target.boundingBox();
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await target.boundingBox();
    if (Math.abs(next.y - box.y) < 0.5 && Math.abs(next.x - box.x) < 0.5) break;
    box = next;
  }
  return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
}
// 열린 C에서 그 칸의 줄 순서(그려진 줄)
const readSectionIds = (page, key) => page.evaluate((k) => [...(document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`)?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), key);
// 그 줄이 든 칸의 키
const readRowKey = (page, id) => page.evaluate((rowId) => document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.closest("section")?.dataset.locationKey ?? null, id);
const readRowNumber = (page, id) => page.evaluate((rowId) => document.querySelector(`[data-testid="output-c-number-${rowId}"]`)?.textContent.trim() ?? null, id);
// 끌리는 표 - 거절 표시, 글 전체, 끌리는 덩어리 줄(src). 이유·번호(note)는 표가 아니라 화면 밖 상태 글(drag-status)에 있다
const readDragCard = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="drag-card"]');
  const status = document.querySelector('[data-testid="drag-status"]');
  const src = [...document.querySelectorAll("[data-drag-src]")].map((row) => row.dataset.flipKey);
  return { shown: Boolean(card), refused: card?.hasAttribute("data-refused") ?? false, note: card && status ? status.textContent.trim() : "", text: card?.textContent ?? "", src };
});
// 끌기가 남긴 표시 - 끝나면 모두 0이어야 한다
const readDragMarks = (page) => page.evaluate(() => ({
  flag: document.documentElement.hasAttribute("data-box-drag"),
  cards: document.querySelectorAll('[data-testid="drag-card"]').length,
  marks: document.querySelectorAll("[data-drag-src], [data-drag-home], [data-drag-seen], [data-drag-closed], [data-drag-sheet], [data-drag-locked], [data-drop]").length,
  lineShown: document.querySelector('[data-testid="drop-line"]')?.hidden === false,
}));
// 칸 하나의 상태 - 흐림(칸 머리에 닿는 opacity를 용지까지 곱한 값), N/A 사유 줄의 흐림, 올린 칸 테두리(data-drop).
// 흐림은 칸이 아니라 칸 안 요소에 걸린다(N/A 사유 줄은 빼고) - 그래서 머리에서 잰다
const readSectionState = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  const readOpacity = (el) => {
    let value = 1;
    for (let node = el; node && node.dataset?.testid !== "output-c"; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return Math.round(value * 100) / 100;
  };
  const reason = section?.querySelector("[data-na-reason]");
  return section ? { opacity: readOpacity(section.querySelector("h3")), reasonOpacity: reason ? readOpacity(reason) : null, drop: section.dataset.drop ?? null } : null;
}, key);
// 올린 칸의 테두리(outline)가 그 칸의 글자와 놓을 선에 닿지 않나 - 테두리 띠는 칸 상자를 outline-offset만큼 넓힌 안쪽 선부터 굵기만큼 더 넓힌 바깥 선까지.
// 글자(칸 머리·줄 번호·줄 글·표 칸·빈 칸 "–"·N/A 줄을 글자 범위로 잰다)와 선·선의 동그라미(::before)마다 띠까지의 여유(px)를 재 가장 작은 값을 돌려준다
// (안쪽 선 안이면 안쪽 선까지, 바깥 선 밖이면 바깥 선까지 - 음수면 띠에 걸친다). 테두리가 없으면 null, 잰 글자가 없으면 texts 0으로 실패한다
const readOutlineFit = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  if (!section?.dataset.drop) return null;
  const style = getComputedStyle(section);
  const offset = parseFloat(style.outlineOffset);
  const width = parseFloat(style.outlineWidth);
  const box = section.getBoundingClientRect();
  const grow = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });
  const inner = grow(box, offset);
  const outer = grow(box, offset + width);
  const clearance = (r) => Math.max(
    Math.min(r.left - inner.left, inner.right - r.right, r.top - inner.top, inner.bottom - r.bottom),
    Math.max(outer.left - r.right, r.left - outer.right, outer.top - r.bottom, r.top - outer.bottom),
  );
  const texts = [];
  for (const el of section.querySelectorAll('h3, [data-testid^="output-c-number-"], [data-testid^="output-c-bullet-"], [data-testid^="output-c-item-"], [data-testid^="output-c-empty-"], h3 + p, td')) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) texts.push(rect);
    }
  }
  const line = document.querySelector('[data-testid="drop-line"]');
  const marks = [];
  if (line && !line.hidden) {
    const lineBox = line.getBoundingClientRect();
    const dot = getComputedStyle(line, "::before");
    const left = lineBox.left + parseFloat(dot.left);
    const top = lineBox.top + parseFloat(dot.top);
    marks.push(lineBox, { left, top, right: left + parseFloat(dot.width), bottom: top + parseFloat(dot.height) });
  }
  const round = (value) => Math.round(value * 10) / 10;
  return { drop: section.dataset.drop, offset, width, texts: texts.length, textClear: texts.length ? round(Math.min(...texts.map(clearance))) : null, marks: marks.length, markClear: marks.length ? round(Math.min(...marks.map(clearance))) : null };
}, key);
// 글자와는 1px 넘게, 선·동그라미와는 2px 넘게 떨어져야 한다(1px 틈은 화면 배율에 따라 붙어 보인다). 놓을 수 있는 칸(over)에는 선이 그어져 있어야 한다
const isOutlineClear = (fit) => fit !== null && fit.texts > 0 && fit.textClear >= 1 && (fit.drop !== "over" || (fit.marks === 2 && fit.markClear >= 2));
// 고른 줄의 왼쪽 막대(줄 box-shadow 가운데 --accent 색 층이 보이는 띠)와 그 줄 번호 첫 글자 사이(px) - 음수면 막대가 글자를 덮는다.
// 글머리 기호 줄은 번호 자리의 기호(•)로 잰다(템플릿 골격의 1–5 · 7 · 8장 줄은 글머리 기호다).
// 위 층(앞에 적힌 층)이 덮는 곳은 뺀다. 고른 줄이 아니거나 번호·막대가 없으면 clear null과 그 까닭.
// 줄의 box-shadow는 호버 고리에서 넘어오는 동안 바뀌므로(.c-row[data-drag-box] transition) 그 줄의 전환이 끝난 뒤에 잰다
const readBarClear = async (page, id) => {
  await page.waitForFunction((rowId) => (document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.getAnimations() ?? []).length === 0, id, { timeout: 2000 });
  return readBarNow(page, id);
};
const readBarNow = (page, id) => page.evaluate((rowId) => {
  const row = document.querySelector(`[data-testid="output-c-row-${rowId}"]`);
  const num = document.querySelector(`[data-testid="output-c-number-${rowId}"], [data-testid="output-c-bullet-${rowId}"]`);
  if (!row || !num?.firstChild) return { clear: null, why: "no row or number" };
  if (document.activeElement !== row) return { clear: null, why: `focus on ${document.activeElement?.dataset.testid ?? document.activeElement?.tagName}` };
  const probe = document.createElement("i");
  probe.style.color = "var(--accent)";
  row.append(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  // 층은 "색 x y 흐림 퍼짐 [inset]" - 색 안의 쉼표는 괄호 밖에서만 나눈다
  const layers = getComputedStyle(row).boxShadow.split(/,(?![^(]*\))/).map((part) => {
    const m = part.trim().match(/^(.*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px(\s+inset)?$/);
    return m ? { color: m[1], x: Number(m[2]), inset: Boolean(m[6]) } : null;
  });
  const at = layers.findIndex((layer) => layer?.color === accent);
  if (at < 0) return { clear: null, why: "no accent layer", shadow: getComputedStyle(row).boxShadow };
  const left = row.getBoundingClientRect().left;
  const bar = layers[at];
  // 안쪽 막대는 줄 왼쪽 끝부터 x만큼, 바깥 막대는 x부터 줄 왼쪽 끝까지 - 그중 위 바깥 층이 덮는 오른쪽은 빠진다
  const covers = layers.slice(0, at).filter((layer) => layer && !layer.inset && layer.x < 0).map((layer) => layer.x);
  const right = bar.inset ? left + bar.x : left + Math.max(bar.x, Math.min(0, ...covers));
  const range = document.createRange();
  range.setStart(num.firstChild, 0);
  range.setEnd(num.firstChild, 1);
  const glyph = range.getBoundingClientRect();
  return { clear: Math.round((glyph.left - right) * 10) / 10, number: num.textContent.trim(), shadow: getComputedStyle(row).boxShadow };
}, id);
// 칸 안의 놓을 점 - 줄이 있으면 마지막 줄 아래 끝 바로 위(칸 끝), 없으면 빈 칸 표시("–")·N/A 사유 줄의 가운데
const pointInSectionEnd = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  const rows = section.querySelectorAll("[data-drag-box]");
  if (rows.length > 0) {
    const box = rows[rows.length - 1].getBoundingClientRect();
    return { x: box.left + 40, y: box.bottom - 3 };
  }
  const box = section.querySelector("h3 + p").getBoundingClientRect();
  return { x: box.left + 40, y: box.top + box.height / 2 };
}, key);
// 줄을 틀 위쪽(틀 위 + offset px)에 둔다 - 아래 칸들이 같은 화면에 들고, 가장자리 자동 스크롤 띠(44px) 밖이다
const scrollRowToTop = (page, id, offset = 90) => page.evaluate(({ rowId, gap }) => {
  const row = document.querySelector(`[data-testid="output-c-row-${rowId}"]`);
  const pane = row.closest(".overflow-auto, .overflow-y-auto");
  pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - gap;
}, { rowId: id, gap: offset });
// 다시 받아 같은 문서를 연다
async function reopenOrderDoc(page, docId, rowId) {
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await page.locator(`[data-testid="output-c-row-${rowId}"]`).waitFor({ timeout: T });
}
// 놓은 직후 그 줄이 번쩍이나(data-flash는 1.3초 뒤 빠진다)
const waitFlash = (page, id) => page.waitForFunction((rowId) => document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.hasAttribute("data-flash"), id, { timeout: 1200 }).then(() => true, () => false);

export async function run() {

// 같은 일이 Order의 결과물 C에 - 장을 빼면 C 절 머리의 번호가 당겨지고, 되살리면 돌아온다. 빈 필수 절은 머리에 Empty가 붙는다. 빼기 · 되살리기는 API로 한다(화면은 위 단계)
await runStep("order: a removed chapter shifts the C section numbers up, Restore brings them back, and an empty required section says Empty", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const start = await readToBe(page, halfBundleId);
  const sop = start.docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
  const found = findRemovableChapter(start, sop);
  check("the SOP has an empty required chapter that can be removed", found !== null);
  if (found === null) return;
  const { target, next } = found;
  const itemUrl = `${BASE}/api/bundles/${halfBundleId}/tobe/docs/${sop.id}/outline/${encodeURIComponent(target.key)}`;
  const headOf = (key) => page.locator(`[data-testid="output-c-section-${sop.id}-${key}"]`);
  const readHead = async (key) => ((await headOf(key).textContent()) ?? "").trim();
  try {
    await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
    await wait(page, "output-c");
    await page.locator(`[data-testid="order-doc-${sop.id}"]`).click();
    await headOf(target.key).waitFor({ timeout: T });
    // Empty는 서버가 정한 절에만 - 줄이 없는 장도 자동 목록(7.2)이 자식 WI로 차 있으면 비어 있지 않다
    const cDoc = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/outputs/c?lang=en`, { headers })).json()).docs.find((doc) => doc.target_doc_id === sop.id);
    const emptyKeys = cDoc.sections.filter((section) => section.is_empty_required).map((section) => section.location_key);
    const marked = [];
    for (const key of cDoc.sections.map((section) => section.location_key)) {
      if ((await page.locator(`[data-testid="output-c-empty-required-${sop.id}-${key}"]`).count()) > 0) marked.push(key);
    }
    check("the seed has an empty required section", emptyKeys.length > 0);
    check("exactly the sections the server calls empty say Empty", marked.join(",") === emptyKeys.join(","), `${marked.join(",")} | ${emptyKeys.join(",")}`);
    check("the chapter to remove shows its number", (await readHead(target.key)).startsWith(target.number), await readHead(target.key));
    const removed = await page.request.patch(itemUrl, { headers, data: { is_removed: true, reason: "Smoke: not used in this SOP" } });
    check("removing the chapter with a reason is accepted", removed.status() === 200, String(removed.status()));
    await page.reload();
    await wait(page, "output-c");
    await page.locator(`[data-testid="order-doc-${sop.id}"]`).click();
    await headOf(next.key).waitFor({ timeout: T });
    check("C has no section for the removed chapter and the next one takes its number", (await headOf(target.key).count()) === 0 && (await readHead(next.key)).startsWith(target.number), await readHead(next.key));
    const back = await page.request.patch(itemUrl, { headers, data: { is_removed: false } });
    check("restoring is accepted", back.status() === 200, String(back.status()));
    await page.reload();
    await wait(page, "output-c");
    await page.locator(`[data-testid="order-doc-${sop.id}"]`).click();
    await headOf(target.key).waitFor({ timeout: T });
    check("after Restore the numbers are back", (await readHead(target.key)).startsWith(target.number) && (await readHead(next.key)).startsWith(next.number), `${await readHead(target.key)} | ${await readHead(next.key)}`);
  } finally {
    const item = (await readToBe(page, halfBundleId)).outline_items.find((row) => row.code === sop.code && row.key === target.key);
    if (item?.is_removed) await page.request.patch(itemUrl, { headers, data: { is_removed: false } });
  }
});

// 템플릿 골격의 문장을 받지 않는 절(Order 화면의 C) - 하위만 묶는 절은 머리만, 7.2 Work Instructions는 그 SOP의 자식 WI가 읽기만 하는 줄로, 5장의 범주는 번호 없는 머리로 그린다.
// 기대값은 서버 C에서 읽는다(자식 WI의 번호 · 제목, 절의 이름)
await runStep("order: C draws a group as its heading only, the work-instruction list read-only and a category without a number", {}, async ({ page }) => {
  const c = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/outputs/c?lang=en`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const doc = c.docs.find((item) => item.doc_type === "sop" && item.entrance === "assign");
  const group = doc?.sections.find((section) => section.kind === "group" && section.na_reason === null);
  const auto = doc?.sections.find((section) => section.kind === "auto_list" && section.na_reason === null);
  const category = doc?.sections.find((section) => section.number === null && section.location_key.startsWith("general_requirements."));
  check("the SOP has a group section, the work-instruction list at 7.2 and a category", Boolean(group && auto && category) && auto?.location_key === WI_LIST_KEY && auto.number === "7.2", JSON.stringify(doc?.sections.map((section) => [section.location_key, section.kind, section.number])));
  if (!group || !auto || !category) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  await page.locator(`[data-testid="order-doc-${doc.target_doc_id}"]`).click();
  const headOf = (key) => page.locator(`[data-testid="output-c-section-${doc.target_doc_id}-${key}"]`);
  // 긴 문서는 나눠 그린다 - 7.2가 그려질 때까지 이어 그리기 표지를 화면에 들인다
  const more = page.locator('[data-testid="output-c-more"]');
  for (let i = 0; i < 60 && (await headOf(auto.location_key).count()) === 0 && (await more.count()) > 0; i += 1) {
    await more.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await headOf(auto.location_key).waitFor({ timeout: T });
  const sectionOf = (key) => page.locator(`[data-testid="output-c"] section[data-location-key="${key}"]`);
  check("a group section is its heading and nothing else", (await sectionOf(group.location_key).evaluate((el) => el.children.length)) === 1 && (await page.locator(`[data-testid="output-c-empty-${doc.target_doc_id}-${group.location_key}"]`).count()) === 0);
  const list = page.locator(`[data-testid="output-c-auto-${doc.target_doc_id}-${auto.location_key}"]`);
  const shown = await list.locator("li").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
  const expected = auto.auto_items.length > 0 ? auto.auto_items.map((item) => (item.title !== "" ? `${item.code} — ${item.title}` : item.code)) : ["No work instructions yet"];
  check("the work-instruction list shows the SOP's WIs as code — title", auto.auto_items.length > 0 && JSON.stringify(shown) === JSON.stringify(expected), `${JSON.stringify(shown)} | ${JSON.stringify(expected)}`);
  check("its lines cannot be dragged and carry no buttons", (await list.locator("[data-drag-box], button").count()) === 0 && (await sectionOf(auto.location_key).locator("[data-drag-box]").count()) === 0);
  check("a category heading has its name and no number", (await headOf(category.location_key).locator(".font-mono").count()) === 0 && ((await headOf(category.location_key).textContent()) ?? "").trim().startsWith(category.label), await headOf(category.location_key).textContent());
});

// 줄 끝 단추 묶음은 호버·포커스 때만, 글 밖에 뜬다(끌어다 놓기 설계 §5, 사용자 결정 2026-11-16). 터치 화면에서는 늘 보인다
await runStep("order: row-end buttons show only on hover or focus, one group at a time", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 단추 묶음과 글 상자가 있는 줄이 넷 이상인 칸 - A는 위에 이웃 줄이 있는 둘째 줄, B는 넷째 줄
  const probeRows = () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')]
        .filter((row) => row.querySelector('[data-testid^="output-c-acts-"]') && row.querySelector('[data-testid^="output-c-item-"]'))
        .map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  };
  const [hit] = await findOrderDocs(page, probeRows);
  check("Order has a section with four lines that carry buttons", Boolean(hit));
  const [, ids] = hit;
  const [a, b] = [ids[1], ids[3]];
  const settle = () => page.waitForTimeout(200);
  // 보이는 줄 끝 단추(넓으면 묶음 .c-acts, 좁으면 ⋯ .c-more)가 있는 줄 id
  const shownGroups = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="output-c-row-"] > :is(.c-acts, .c-more)')]
    .filter((el) => getComputedStyle(el).display !== "none" && Number(getComputedStyle(el).opacity) > 0)
    .map((el) => el.parentElement.getAttribute("data-testid").replace("output-c-row-", "")));
  // 보이는 단추 상자(묶음 또는 ⋯), 줄 상자, 글 상자(그 줄과 위아래 이웃 줄), 용지, 스크롤 칸
  const measure = (id) => page.evaluate((target) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const row = document.querySelector(`[data-testid="output-c-row-${target}"]`);
    const acts = [...row.querySelectorAll(":scope > .c-acts, :scope > .c-more")].find((el) => getComputedStyle(el).display !== "none");
    const pane = row.closest(".overflow-auto, .overflow-y-auto");
    const hit = (x, y) => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5;
    const box = rect(acts);
    // 그 줄은 글 상자 전체, 이웃 줄(칸 머리 포함)은 글줄마다(마지막 줄이 짧으면 그 옆 빈자리는 글이 아니다)
    const near = [row.previousElementSibling, row.nextElementSibling].filter(Boolean);
    const covers = hit(box, rect(row.querySelector(`[data-testid="output-c-item-${target}"]`))) || near.some((el) => (el.matches("h3") ? [el] : [...el.querySelectorAll('[data-testid^="output-c-item-"]')]).some((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()].some((r) => hit(box, r));
    }));
    // 스크롤 칸 오른쪽은 스크롤바 자리를 뺀 안쪽 끝
    const paneBox = rect(pane);
    return { box, mode: acts.classList.contains("c-more") ? "more" : "group", row: rect(row), covers, sheet: rect(row.closest("article.sheet")), pane: { ...paneBox, right: paneBox.left + pane.clientWidth }, scrolls: pane.scrollWidth > pane.clientWidth };
  }, id);
  // 용지 오른쪽 바깥, 줄 위 끝(의미 묶음 첫 줄은 위 테두리 2px 아래)에 뜨고 스크롤 칸 안에 든다
  const isBesideSheet = (m) => m.box.left >= m.sheet.right && m.box.right <= m.pane.right && Math.abs(m.box.top - m.row.top) <= 3;
  // 실제 마우스를 걸음으로 옮긴다(click()처럼 단추로 바로 뛰지 않는다) - 줄의 마지막 글줄 오른쪽 끝에서 목표 단추 가운데까지, 걸음마다 그 줄이 호버 상태인지 본다
  const walkTo = async (rowId, targetSelector) => {
    const from = await page.locator(`[data-testid="output-c-item-${rowId}"]`).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()];
      const last = lines.at(-1);
      return { x: last.right - 4, y: (last.top + last.bottom) / 2, lines: new Set(lines.map((r) => Math.round(r.top))).size };
    });
    await page.mouse.move(from.x, from.y);
    await settle();
    const target = await page.locator(targetSelector).boundingBox();
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const STEPS = 24;
    let lost = 0;
    for (let i = 1; i <= STEPS; i += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / STEPS, from.y + ((to.y - from.y) * i) / STEPS);
      if (!(await page.locator(`[data-testid="output-c-row-${rowId}"]`).evaluate((el) => el.matches(":hover")))) lost += 1;
    }
    return { lines: from.lines, lost };
  };
  // 누른 것이 단추에 닿았는지 - 창 캡처 단계에서 받고 멈춘다(React까지 가지 않으니 DB는 그대로)
  const armLanding = (selector) => page.evaluate((sel) => {
    window.__landed = false;
    window.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(sel)) {
        window.__landed = true;
        event.stopPropagation();
      }
    }, { capture: true, once: true });
  }, selector);
  const hoverAt = async (width) => {
    await page.setViewportSize({ width, height: 720 });
    await page.mouse.move(0, 0);
    await rowA.scrollIntoViewIfNeeded();
    await rowA.hover({ position: { x: 8, y: 4 } });
    await settle();
    return measure(a);
  };
  const rowA = page.locator(`[data-testid="output-c-row-${a}"]`);
  const rowB = page.locator(`[data-testid="output-c-row-${b}"]`);
  await rowA.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settle();
  check("no group shows at rest", (await shownGroups()).length === 0, (await shownGroups()).join(","));
  const restHeight = (await rowA.boundingBox()).height;
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  const at1248 = await measure(a);
  check("hovering a row shows its group", JSON.stringify(await shownGroups()) === JSON.stringify([a]), (await shownGroups()).join(","));
  check("the group covers no text of its row or the neighbours", !at1248.covers, JSON.stringify(at1248.box));
  check("hover does not change the row height", Math.abs(at1248.row.height - restHeight) < 0.5, `${restHeight} -> ${at1248.row.height}`);
  // 1248 - 용지 옆 남는 폭(약 140px)에 묶음이 두 줄로 감겨 뜬다
  check("at 1248 the group floats beside the sheet, wrapped to fit", at1248.mode === "group" && isBesideSheet(at1248) && at1248.box.height > 40, JSON.stringify({ box: at1248.box, row: at1248.row, sheet: at1248.sheet, pane: at1248.pane }));
  check("no horizontal scroll at 1248", !at1248.scrolls);
  const rowBackground = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  check("the hovered row is highlighted", (await rowBackground(rowA)) !== "rgba(0, 0, 0, 0)", await rowBackground(rowA));
  await takeShot("sop-order-row-buttons-hover.png");
  // 문서 끝 줄 - 두 줄 묶음이 내용 아래로 늘어져 스크롤을 늘리지 않는다
  const scrollHeight = () => page.locator('[data-testid="output-c"]').evaluate((el) => el.closest(".overflow-auto, .overflow-y-auto").scrollHeight);
  const lastRow = page.locator('[data-testid^="output-c-row-"]:has([data-testid^="output-c-acts-"])').last();
  await lastRow.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settle();
  const restScroll = await scrollHeight();
  await lastRow.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("hovering the last row does not grow the scroll area", (await scrollHeight()) === restScroll, `${restScroll} -> ${await scrollHeight()}`);
  // 여러 줄로 감긴 줄의 마지막 글줄에서 묶음 둘째 줄의 단추까지 마우스로 가도 묶음이 사라지지 않고 누름이 닿는다
  // 시드 글이 짧으면 A의 글을 길게 바꿔(화면에서만) 세 줄로 감기게 한다
  await rowA.scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-item-${a}"]`).evaluate((el) => { el.textContent = "SYNTHETIC long line for the reach check. ".repeat(6); });
  const reachDown = `[data-testid="output-c-move-down-${a}"]`;
  const walk1248 = await walkTo(a, reachDown);
  await armLanding(reachDown);
  await page.mouse.down();
  await page.mouse.up();
  check("from the last line of a wrapped row the mouse reaches the group's second line", walk1248.lines >= 2 && walk1248.lost === 0 && (await page.evaluate(() => window.__landed)), JSON.stringify(walk1248));
  // 눌러 고른 줄(B)이 있어도 다른 줄에 올리면 그 줄 묶음만 보인다. 포인터가 떠나면 고른 줄의 묶음이 돌아온다
  await rowB.click({ position: { x: 4, y: 4 } });
  await settle();
  const pickedLook = await rowBackground(rowB);
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("only one group shows", JSON.stringify(await shownGroups()) === JSON.stringify([a]), (await shownGroups()).join(","));
  check("the picked row keeps its own tint while another row is hovered", (await rowBackground(rowB)) === pickedLook && pickedLook !== "rgba(0, 0, 0, 0)", `${pickedLook} -> ${await rowBackground(rowB)}`);
  await page.mouse.move(0, 0);
  await settle();
  check("the picked row keeps its group when the pointer leaves", (await shownGroups()).includes(b), (await shownGroups()).join(","));
  // 글쇠로 단추에 가 있는 묶음은 다른 줄에 올려도 물러나지 않는다(보이지 않는 포커스 금지)
  // 글쇠로 옮겨 가야 :focus-visible이 된다(마우스 뒤의 focus()는 아니다) - 한 칸 뒤로 갔다가 돌아온다. 누르지 않으니 DB는 그대로
  await page.locator(`[data-testid="output-c-move-down-${b}"]`).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("a keyboard-focused button keeps its group", (await shownGroups()).includes(b), (await shownGroups()).join(","));
  await page.locator(`[data-testid="output-c-move-down-${b}"]`).blur();
  // 넓은 창 - 용지 오른쪽 바깥에 한 줄로
  const wide = await hoverAt(1440);
  check("a wide window floats the group outside the sheet in one line", isBesideSheet(wide) && wide.box.height <= 32, JSON.stringify({ box: wide.box, sheet: wide.sheet, pane: wide.pane }));
  check("the wide group covers no text", !wide.covers);
  check("no horizontal scroll at 1440", !wide.scrolls);
  await takeShot("sop-order-row-buttons-wide.png");
  // 넓은 창에서도 감긴 줄의 마지막 글줄에서 한 줄 묶음의 끝 단추까지 닿는다
  const walk1440 = await walkTo(a, reachDown);
  await armLanding(reachDown);
  await page.mouse.down();
  await page.mouse.up();
  check("at 1440 the mouse reaches the one-line group from the last line", walk1440.lost === 0 && (await page.evaluate(() => window.__landed)), JSON.stringify(walk1440));
  // 가장 좁은 지원 폭 - 묶음이 두 줄로도 안 들어가 ⋯ 하나가 용지 옆에 뜬다
  const slim = await hoverAt(1120);
  check("at 1120 a single more button floats beside the sheet", slim.mode === "more" && isBesideSheet(slim) && slim.box.width <= 32, JSON.stringify({ mode: slim.mode, box: slim.box, sheet: slim.sheet, pane: slim.pane }));
  check("the 1120 more button covers no text", !slim.covers);
  check("no horizontal scroll at 1120", !slim.scrolls);
  // ⋯ 단추 output-c-menu-<id>, 메뉴 output-c-menu-list-<id>, 항목 output-c-menu-<동작>-<id>
  const moreButton = page.locator(`[data-testid="output-c-menu-${a}"]`);
  const walk1120 = await walkTo(a, `[data-testid="output-c-menu-${a}"]`);
  await page.mouse.down();
  await page.mouse.up();
  const menu = page.locator(`[data-testid="output-c-menu-list-${a}"]`);
  await menu.waitFor({ timeout: T });
  check("from the last line of a wrapped row the mouse reaches the more button and opens its menu", walk1120.lost === 0 && (await menu.isVisible()), JSON.stringify(walk1120));
  // 메뉴 항목은 묶음 단추와 같은 여덟 동작 - 지금 번호 표시에 표시가 있고, 꺼짐은 묶음 단추와 같다
  const menuState = await page.evaluate((id) => {
    const disabled = (sel) => document.querySelector(sel)?.disabled ?? null;
    const itemOf = (action) => `[data-testid="output-c-menu-${action}-${id}"]`;
    const item = document.querySelector(`[data-testid="output-c-item-${id}"]`);
    // 묶음에 있는 단추만큼 - 번호 표시를 못 바꾸는 줄(이미 쓴 문서)·깊이를 못 바꾸는 줄(AI 번역)은 그 항목도 없다
    const expected = [
      ...(document.querySelector(`[data-testid="output-c-mark-${id}"]`) ? ["numbered", "bullet", "omitted", "note"] : []),
      ...(document.querySelector(`[data-testid="output-c-indent-${id}"]`) ? ["outdent", "indent"] : []),
      "up",
      "down",
    ];
    return {
      expected,
      checked: document.querySelector(itemOf(item.dataset.numberStyle))?.getAttribute("aria-checked"),
      items: [...document.querySelectorAll(`[data-testid="output-c-menu-list-${id}"] [role^="menuitem"]`)].map((el) => el.getAttribute("data-testid").replace("output-c-menu-", "").replace(`-${id}`, "")),
      same: ["outdent", "indent"].every((key) => disabled(itemOf(key)) === disabled(`[data-testid="output-c-${key}-${id}"]`))
        && ["up", "down"].every((key) => disabled(itemOf(key)) === disabled(`[data-testid="output-c-move-${key}-${id}"]`)),
    };
  }, a);
  check("the menu lists the group's actions with the current number style marked", menuState.expected.length === 8 && JSON.stringify(menuState.items) === JSON.stringify(menuState.expected) && menuState.checked === "true" && menuState.same, JSON.stringify(menuState));
  check("the row whose menu is open stays highlighted", (await rowBackground(rowA)) !== "rgba(0, 0, 0, 0)");
  await takeShot("sop-order-row-more-menu.png");
  await page.keyboard.press("Escape");
  await settle();
  check("Esc closes the menu and returns focus to the more button", (await menu.count()) === 0 && (await moreButton.evaluate((el) => el === document.activeElement)));
  // 메뉴로 번호 표시를 바꾸고 되돌린다 - 저장되고 닫힌 메뉴는 포커스를 ⋯ 단추로 돌린다.
  // 그 줄의 처음 표시로 되돌린다 - 템플릿 골격에서는 칸마다 기본 표시가 달라(1–5 · 7 · 8장은 글머리 기호) 번호로 돌려놓으면 자료가 바뀐다
  const readStyle = () => page.locator(`[data-testid="output-c-item-${a}"]`).getAttribute("data-number-style");
  const styleBefore = await readStyle();
  const styleOther = styleBefore === "omitted" ? "note" : "omitted";
  await moreButton.click();
  const marked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-${styleOther}-${a}"]`).click();
  check("a menu item runs its action and saves", (await marked).ok() && (await readStyle()) === styleOther, `${styleBefore} -> ${await readStyle()}`);
  await moreButton.click();
  const unmarked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-${styleBefore}-${a}"]`).click();
  check("the menu puts the number style back", (await unmarked).ok() && (await readStyle()) === styleBefore, `${styleOther} -> ${await readStyle()}`);
  // 스크롤바가 두꺼운 창(Windows 고전 스크롤바 17px 둘)처럼 틀 내용 폭이 756px로 좁아도 용지가 몇 px 양보해 ⋯는 용지 옆에 남는다.
  // 헤드리스는 스크롤바를 숨기므로 틀 폭을 줄여 흉내 낸다 - width는 테두리 상자라 내용 756 = 780 - 좌우 여백 12×2
  await page.addStyleTag({ content: '[data-testid="output-c"] { width: 780px; }' });
  const squeezed = await hoverAt(1120);
  check("a narrow frame shrinks the sheet a little and keeps the more button beside it", squeezed.mode === "more" && isBesideSheet(squeezed) && squeezed.sheet.width < 760 && !squeezed.covers, JSON.stringify({ box: squeezed.box, sheet: squeezed.sheet }));
  await page.setViewportSize(VIEWPORT);
  // 터치 화면 - 호버가 없으니 묶음이 늘 보이고 글 흐름 안에 있다
  const touch = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  await touch.addInitScript(() => {
    if (location.protocol !== "about:" && !window.localStorage.getItem("sopa.devUser")) window.localStorage.setItem("sopa.devUser", "qa.member");
  });
  try {
    const touchPage = await touch.newPage();
    await touchPage.goto(`${BASE}/bundles/${halfBundleId}/order`);
    await touchPage.locator(`[data-testid="order-doc-${hit[0]}"]`).click();
    await touchPage.locator(`[data-testid="output-c-acts-${a}"]`).waitFor({ timeout: T });
    const touchState = await touchPage.evaluate((target) => {
      const acts = document.querySelector(`[data-testid="output-c-acts-${target}"]`);
      const box = acts.getBoundingClientRect();
      const item = document.querySelector(`[data-testid="output-c-item-${target}"]`).getBoundingClientRect();
      const covers = Math.min(box.right, item.right) - Math.max(box.left, item.left) > 0.5 && Math.min(box.bottom, item.bottom) - Math.max(box.top, item.top) > 0.5;
      return { opacity: Number(getComputedStyle(acts).opacity), covers, hoverNone: matchMedia("(hover: none)").matches };
    }, a);
    check("touch devices keep the buttons visible", touchState.hoverNone && touchState.opacity === 1 && !touchState.covers, JSON.stringify(touchState));
  } finally {
    await touch.close();
  }
});

await runStep("order: indent a line on C and its section number changes", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 들일 수 있는 첫 줄(앞줄이 있고 번호가 있는 줄) - SOP의 내용은 대부분 글머리 기호라 번호 줄이 있는 문서(WI나 절차가 든 SOP)를 찾아 연다
  // 번호 줄만 - 글머리 기호 줄도 들일 수 있게 된 뒤로(MD 2 §S5 ①) 첫 들임 단추가 번호 없는 줄일 수 있다
  const [indentHit] = await findOrderDocs(page, () => [...document.querySelectorAll('[data-testid^="output-c-indent-"]:not([disabled])')]
    .map((node) => node.getAttribute("data-testid").replace("output-c-indent-", ""))
    .find((id) => document.querySelector(`[data-testid="output-c-number-${id}"]`) !== null) ?? null);
  check("a document has a line that can be indented", Boolean(indentHit));
  if (!indentHit) return;
  const targetId = indentHit[1];
  const button = page.locator(`[data-testid="output-c-indent-${targetId}"]`);
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

// 글머리 기호 줄은 번호 줄과 따로 센다 - 5장(General Requirements) 범주의 글머리 기호 줄은 앞 글머리 기호 줄 + 1까지, 단계 기호는 • ○ ▪(2026-11-18 MD 2 §S5 ①).
// 5장 범주는 글머리 기호가 기본이라 번호 줄이 없다. 글머리 기호 줄이 둘 이상 든 5장 범주가 있는 문서를 찾아 연다. 들였다가 도로 내어 써 자료를 그대로 둔다
await runStep("order: a chapter 5 bullet line indents with Tab to the second symbol and goes back with Shift+Tab", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section[data-location-key^="general_requirements."]')) {
      const bullets = [...section.querySelectorAll('[data-testid^="output-c-bullet-"]')].map((node) => node.getAttribute("data-testid").replace("output-c-bullet-", ""));
      // 둘째 줄이 들여지고(Indent가 켜짐) 첫 줄은 못 들이는 범주 - 둘 다 깊이 0인 글머리 기호 줄이다
      const [first, second] = bullets;
      if (!first || !second) continue;
      const indentOf = (id) => document.querySelector(`[data-testid="output-c-indent-${id}"]`);
      if (indentOf(first)?.disabled === true && indentOf(second)?.disabled === false) return { first, second };
    }
    return null;
  });
  const pair = hit ? hit[1] : null;
  check("a chapter 5 category has two bullet lines, the first one not indentable", pair !== null);
  if (!pair) return;
  const symbol = (id) => page.locator(`[data-testid="output-c-bullet-${id}"]`).innerText().then((text) => text.trim());
  check("both lines show the first symbol", (await symbol(pair.first)) === "•" && (await symbol(pair.second)) === "•", `${await symbol(pair.first)} ${await symbol(pair.second)}`);
  const row = page.locator(`[data-testid="output-c-row-${pair.second}"]`);
  await row.click({ position: { x: 4, y: 4 } });
  const indented = waitOrderSave(page);
  await page.keyboard.press("Tab");
  check("Tab on the picked bullet line saves", (await indented).ok());
  check("the second line now shows the second symbol", (await symbol(pair.second)) === "○", await symbol(pair.second));
  check("and no number appears", (await page.locator(`[data-testid="output-c-number-${pair.second}"]`).count()) === 0);
  const padding = await row.locator(".c-line").evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));
  check("its text is indented by one level", padding > 0, String(padding));
  // 앞 글머리 기호 줄(깊이 0) + 1에 닿았으니 더 들일 수 없고, 못 들이는 Tab은 삼키지 않는다
  await row.hover();
  check("one level below the previous bullet line, Indent is off", await page.locator(`[data-testid="output-c-indent-${pair.second}"]`).isDisabled());
  await takeShot("sop-outputs-c-bullet-indent.png");
  await row.click({ position: { x: 4, y: 4 } });
  const outdented = waitOrderSave(page);
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab saves", (await outdented).ok());
  check("the line is back to the first symbol", (await symbol(pair.second)) === "•", await symbol(pair.second));
});

// 번호 줄 규칙은 그대로다 - 6장 절차(번호가 기본)의 첫 번호 줄은 들일 수 없고, 둘째 번호 줄을 들이면 번호가 한 마디 늘고 기호는 없다
await runStep("order: a chapter 6 numbered line keeps the numbered indent rule", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    // 데모 시드의 6장 절차에는 번호 줄이 둘 이상인 곳이 없을 수 있어 번호 줄이 든 칸이면 어디든(WI 단계 포함) 본다 - 규칙은 같다
    for (const section of document.querySelectorAll('[data-testid="output-c"] section[data-location-key]')) {
      const numbered = [...section.querySelectorAll('[data-testid^="output-c-number-"]')].map((node) => node.getAttribute("data-testid").replace("output-c-number-", ""));
      const [first, second] = numbered;
      if (!first || !second) continue;
      const indentOf = (id) => document.querySelector(`[data-testid="output-c-indent-${id}"]`);
      if (indentOf(first)?.disabled === true && indentOf(second)?.disabled === false) return { first, second };
    }
    return null;
  });
  const pair = hit ? hit[1] : null;
  check("a section has two numbered lines, the first one not indentable", pair !== null);
  if (!pair) return;
  const number = page.locator(`[data-testid="output-c-number-${pair.second}"]`);
  const before = (await number.innerText()).trim();
  const row = page.locator(`[data-testid="output-c-row-${pair.second}"]`);
  await row.click({ position: { x: 4, y: 4 } });
  const indented = waitOrderSave(page);
  await page.keyboard.press("Tab");
  check("Tab saves", (await indented).ok());
  const after = (await number.innerText()).trim();
  check("the number gains a level", after.split(".").length === before.split(".").length + 1, `${before} -> ${after}`);
  check("a numbered line never shows a bullet symbol", (await page.locator(`[data-testid="output-c-bullet-${pair.second}"]`).count()) === 0);
  await row.click({ position: { x: 4, y: 4 } });
  const outdented = waitOrderSave(page);
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab saves", (await outdented).ok());
  check("the number is back", (await number.innerText()).trim() === before);
});

// N:1 출처 꼬리표 - 옛 두 줄 이상에서 온 줄에 올리거나 그 줄을 고르면 줄 아래에 source_note 그대로 뜨고, 출처가 하나인 줄에는 꼬리표가 없다(MD 2 §S5 ②)
await runStep("order: a line merged from several Old lines shows its source tag on hover and when picked", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const output = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/outputs/c?lang=en`, { headers })).json();
  const lines = output.docs.flatMap((doc) => doc.sections.flatMap((section) => section.items.map((item) => ({ ...item, docId: doc.target_doc_id }))));
  const merged = lines.find((item) => item.source_count >= 2 && item.source_note !== "");
  const single = lines.find((item) => item.source_count === 1 && item.docId === merged?.docId);
  check("a New line comes from two or more Old lines", merged !== undefined);
  if (!merged) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  await page.locator(`[data-testid="order-doc-${merged.docId}"]`).click();
  const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
  // 긴 문서는 나눠 그린다 - 그 줄이 그려질 때까지 이어 그리기 표지를 화면에 들인다
  const more = page.locator('[data-testid="output-c-more"]');
  for (let i = 0; i < 40 && (await rowOf(merged.target_id).count()) === 0 && (await more.count()) > 0; i += 1) {
    await more.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await rowOf(merged.target_id).waitFor({ timeout: T });
  const tag = page.locator(`[data-testid="output-c-source-${merged.target_id}"]`);
  await page.mouse.move(0, 0);
  check("the tag is hidden while the line is neither hovered nor picked", !(await tag.isVisible()));
  await rowOf(merged.target_id).scrollIntoViewIfNeeded();
  await rowOf(merged.target_id).hover();
  check("hovering the line shows the tag", await tag.isVisible());
  check("it carries the source note as is", (await tag.innerText()).trim() === merged.source_note.trim(), `${await tag.innerText()} | ${merged.source_note}`);
  await rowOf(merged.target_id).click({ position: { x: 4, y: 4 } });
  await page.mouse.move(0, 0);
  check("a picked line keeps the tag", await tag.isVisible());
  await page.keyboard.press("Escape");
  if (single) {
    check("a line from a single Old line has no tag", (await page.locator(`[data-testid="output-c-source-${single.target_id}"]`).count()) === 0);
  }
});

// 템플릿 보기(MD 2 §S5 ③) - Order 문서 머리의 기본 | 템플릿 전환: 보기만 하는 화면(줄 끝 단추 · 끌기 없음), 줄과 번호는 기본 보기(C)와 같고, 문서 머리가 넘치지 않는다
await runStep("order: template view switch draws the same lines view-only, with no row-end buttons and no drag", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const basic = page.locator('[data-testid="order-view-basic"]');
  const template = page.locator('[data-testid="order-view-template"]');
  await template.waitFor({ timeout: T });
  check("the switch sits in the document head and starts on Basic", (await basic.getAttribute("aria-pressed")) === "true" && (await page.locator('header.c-doc-head [data-testid="order-view"]').count()) === 1);
  check("the basic view has row-end buttons and no template", (await page.locator('[data-testid^="output-c-acts-"]').count()) > 0 && (await page.locator('[data-testid="order-tpl"]').count()) === 0);
  const docId = await page.locator('[data-testid="output-c"] article[data-doc-id]').first().getAttribute("data-doc-id");
  const output = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/outputs/c?lang=en`, { headers })).json();
  const doc = output.docs.find((item) => String(item.target_doc_id) === docId);
  await template.click();
  await wait(page, "order-tpl");
  check("the template is on and the basic rows are gone", (await template.getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid^="output-c-row-"]').count()) === 0);
  check("the view-only note sits above the template", (await page.locator('[data-testid="order-template-note"]').innerText()).includes("view-only"));
  check("no row-end buttons, menus or drag boxes in the template", (await page.locator('[data-testid^="output-c-acts-"], .c-more, [data-drag-box]').count()) === 0);
  check("the app's table of contents and both halves are drawn", (await page.locator('[data-testid="order-tpl-toc"]').count()) === 1 && (await page.locator('[data-testid^="order-tpl-half-"]').count()) === 2);
  // 줄은 기본 보기(C)와 같다 - 두 절반에 그려진 새 문장 id가 C 줄의 id 집합과 같다(번역 없음 자리는 id가 아니라 -miss-)
  const expected = new Set(doc.sections.flatMap((section) => section.items.map((item) => item.target_id)));
  const drawn = await page.locator('[data-testid^="order-tpl-"]').evaluateAll((els) => els.map((el) => /^order-tpl-(?:en|ko)-(\d+)$/.exec(el.getAttribute("data-testid"))?.[1]).filter(Boolean).map(Number));
  check("the template holds exactly the lines Output C has", new Set(drawn).size === expected.size && drawn.every((id) => expected.has(id)), `${new Set(drawn).size}/${expected.size}`);
  // 번호도 C와 같다 - 번호 줄의 앞 표시가 C 번호 그대로(1:2 짝의 남는 줄 · 따로 놓인 짝도 자기 C 번호)
  const numbered = doc.sections.flatMap((section) => section.items).find((item) => item.number_style === "numbered" && item.number !== null && item.kind === "sentence");
  if (numbered) {
    // WI는 번호가 장 표의 라벨 칸(.tpl-wi-num)에 있다
    const marks = await page.locator('[data-testid="order-tpl"] :is(.tpl-mark, .tpl-wi-num)').allInnerTexts();
    check("a numbered line carries its Output C number", marks.some((text) => text.trim() === numbered.number), `${numbered.number} among ${marks.length} marks`);
  }
  // 머리 - 전환이 용지 밖으로 넘치지 않는다(1120 · 1280 창에서 같은 틀)
  const head = await page.locator('header.c-doc-head').first().boundingBox();
  const box = await page.locator('[data-testid="order-view"]').boundingBox();
  check("the switch stays inside the document head", Boolean(head && box) && box.x >= head.x - 1 && box.x + box.width <= head.x + head.width + 1, JSON.stringify({ head, box }));
  await takeShot("sop-order-template.png");
  await page.reload();
  await wait(page, "order-tpl");
  check("after a reload the template view is still on", (await page.locator('[data-testid="order-view-template"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="order-view-basic"]').click();
  await wait(page, "output-c");
  check("Basic brings the row-end buttons back", (await page.locator('[data-testid^="output-c-acts-"]').count()) > 0 && (await page.locator('[data-testid="order-tpl"]').count()) === 0);
});

// 번역 없음 자리(4-d) - 템플릿 보기에서만 보이고, 누르면 그 줄의 Old 출처를 고른 채 Assign이 열린다(Order에는 번역 만들기 · 직접 쓰기가 없다)
await runStep("order: the No translation slot shows only in the template view and opens Assign on the Old line", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  await page.locator('[data-testid="order-view-template"]').waitFor({ timeout: T });
  check("the basic view draws no No translation slot", (await page.locator('[data-testid="output-c"] [class~="tpl-miss"]').count()) === 0 && (await page.locator('[data-testid="output-c"]').getByText("No translation").count()) === 0);
  await page.locator('[data-testid="order-view-template"]').click();
  await wait(page, "order-tpl");
  const fill = page.locator('[data-testid^="order-tpl-"][data-testid$="-fill"]');
  const docIds = await page.locator('[data-testid^="order-doc-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid").replace("order-doc-", "")));
  let found = (await fill.count()) > 0;
  for (const docId of docIds) {
    if (found) break;
    await page.locator(`[data-testid="order-doc-${docId}"]`).click();
    await wait(page, "order-tpl");
    found = (await fill.count()) > 0;
  }
  if (!found) {
    check("no No translation slot in this bundle (nothing to open)", true);
    await page.locator('[data-testid="order-view-basic"]').click();
    return;
  }
  const slot = fill.first();
  await slot.scrollIntoViewIfNeeded({ timeout: T });
  check("the slot is an orange dashed box", await slot.evaluate((el) => getComputedStyle(el).borderStyle === "dashed"));
  await slot.click();
  await page.waitForURL(/\/bundles\/\d+\/assign/, { timeout: T });
  await wait(page, "assign-bar");
  // 출처 없는 New 문장(새로 쓴 줄)의 자리면 고를 Old 줄이 없어 Assign 처음으로 간다 - 주소에 줄이 있을 때만 고름을 본다
  if (new URL(page.url()).search === "") {
    check("a line with no Old source opens Assign at its start", true);
  } else {
    const picked = await page
      .waitForFunction(() => document.querySelectorAll('[data-pane="old"] [data-sel]').length > 0, null, { timeout: 5000 })
      .then(() => true, () => false);
    check("Assign opens with the Old line picked", picked);
  }
  // 이 브라우저의 보기 기억을 되돌린다 - 뒤 장면은 기본 보기로 연다
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  await page.locator('[data-testid="order-view-basic"]').click();
  await wait(page, "output-c");
});

await runStep("order: Alt+ArrowDown moves the picked line and keeps it picked", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  });
  check("a section with four lines exists", Boolean(hit));
  const ids = hit[1];
  const id = ids[0];
  const rowSel = `[data-testid="output-c-row-${id}"]`;
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeRow = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  // 줄 자리를 스크롤 칸 기준으로 - 칸이 없으면 null(검사가 실패한다)
  const readPlace = (nextId) => page.evaluate(({ sel, nextSel }) => {
    const row = document.querySelector(sel);
    const pane = row?.closest(".overflow-auto, .overflow-y-auto");
    if (!pane) return null;
    const paneTop = pane.getBoundingClientRect().top;
    const box = row.getBoundingClientRect();
    const next = nextSel ? document.querySelector(nextSel)?.getBoundingClientRect() : null;
    return { top: box.top - paneTop, height: box.height, nextBottom: next ? next.bottom - paneTop : null };
  }, { sel: rowSel, nextSel: nextId ? `[data-testid="output-c-row-${nextId}"]` : null });
  const start = (await readOrder()).indexOf(id);
  const puts = [];
  const onRequest = (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  };
  page.on("request", onRequest);
  // 1. 줄을 눌러 고른 뒤 Alt+↓ - 한 자리, 고른 채로. 줄을 칸 가운데에 두어 가장자리 따라가기(shouldRecenter)가 끼지 않게 한다
  await page.locator(rowSel).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  // 한 자리 내리면 줄의 위 끝은 이웃 줄의 아래 끝에서 자기 높이만큼 위에 선다 - 화면이 뛰지 않으면 칸 기준 그 자리다
  const placeBefore = await readPlace((await readOrder())[start + 1]);
  const moved = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("the move saves", (await moved).ok());
  check("the line moved one place", (await readOrder()).indexOf(id) === start + 1, JSON.stringify(await readOrder()));
  check("the line stays picked", (await activeRow()) === `output-c-row-${id}`, await activeRow());
  await page.waitForTimeout(600); // 미끄러짐(useFlip)이 끝난 자리를 잰다
  const placeAfter = await readPlace(null);
  const expectedTop = placeBefore ? placeBefore.nextBottom - placeBefore.height : null;
  check("the screen did not jump", placeBefore !== null && placeAfter !== null && Math.abs(placeAfter.top - expectedTop) <= 8, JSON.stringify({ placeBefore, placeAfter, expectedTop }));
  // 2. 단추에 포커스가 있을 때의 Alt+↑·↓는 아무 일도 없다
  await page.locator(rowSel).hover();
  await page.locator(`[data-testid="output-c-move-down-${id}"]`).focus();
  const putsBefore = puts.length;
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(500);
  check("Alt+ArrowDown on a row button does nothing", puts.length === putsBefore && (await readOrder()).indexOf(id) === start + 1);
  // 3. 되돌린다 - 위로, 그리고 칸 맨 위 줄의 Alt+↑는 막히지 않고 아무 일도 없다
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  const back = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("Alt+ArrowUp moves it back", (await back).ok() && (await readOrder()).indexOf(id) === start);
  check("it is still picked after moving up", (await activeRow()) === `output-c-row-${id}`);
  const top = (await readOrder())[0];
  await page.locator(`[data-testid="output-c-row-${top}"]`).click({ position: { x: 4, y: 4 } });
  const topPuts = puts.length;
  const defaultPrevented = await page.evaluate((topId) => new Promise((done) => {
    const row = document.querySelector(`[data-testid="output-c-row-${topId}"]`);
    row.addEventListener("keydown", (event) => queueMicrotask(() => done(event.defaultPrevented)), { once: true });
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));
  }), top);
  await page.waitForTimeout(400);
  check("Alt+ArrowUp on the first line of a section does nothing and is not swallowed", puts.length === topPuts && defaultPrevented === false);
  // 4. Esc가 고름을 놓는다
  await page.keyboard.press("Escape");
  check("Esc lets go of the line", (await activeRow()) !== `output-c-row-${top}`);
  page.off("request", onRequest);
});

await runStep("order: a depth-locked line (an already-written document) can be picked, moved and is not indented by Tab", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 3) return ids;
    }
    return null;
  });
  check("the already-written document WI-04 has a section with three lines", Boolean(hit));
  const ids = hit[1];
  const id = ids[0];
  const rowSel = `[data-testid="output-c-row-${id}"]`;
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeRow = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  check("the line has no indent button", (await page.locator(`[data-testid="output-c-indent-${id}"]`).count()) === 0);
  const start = (await readOrder()).indexOf(id);
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  check("a depth-locked line can be picked", (await activeRow()) === `output-c-row-${id}`, await activeRow());
  const padding = () => page.locator(`${rowSel} .c-line`).evaluate((el) => getComputedStyle(el).paddingLeft);
  const paddingBefore = await padding();
  let saved = false;
  const onRequest = (request) => {
    if (isOrderSave(request)) saved = true;
  };
  page.on("request", onRequest);
  // 브라우저가 Tab으로 갈 다음 요소 - 줄 뒤(줄 안의 단추 포함) 문서 순서로 첫 탭 가능한 요소에 표시를 단다
  const expectedNext = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const next = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].find((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    next?.setAttribute("data-smoke-next", "");
    return next ? next.getAttribute("data-testid") ?? next.tagName : null;
  }, rowSel);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  const landed = await page.evaluate(() => ({ next: document.activeElement?.hasAttribute("data-smoke-next") ?? false, active: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "" }));
  await page.evaluate(() => document.querySelector("[data-smoke-next]")?.removeAttribute("data-smoke-next"));
  check("Tab does not indent it and moves focus to the next focusable element", !saved && (await padding()) === paddingBefore && expectedNext !== null && landed.next, JSON.stringify({ expectedNext, ...landed }));
  page.off("request", onRequest);
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  const moved = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("Alt+ArrowDown moves a depth-locked line", (await moved).ok() && (await readOrder()).indexOf(id) === start + 1, JSON.stringify(await readOrder()));
  check("it stays picked", (await activeRow()) === `output-c-row-${id}`);
  const back = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("and moves back", (await back).ok() && (await readOrder()).indexOf(id) === start);
});

// 줄을 끌어 칸 안에서 옮기고 좌우로 깊이를 바꾼다(끌어다 놓기 설계 §4·§5). 마우스는 걸음으로 움직인다(dragTo는 쓰지 않는다). 바꾼 순서·깊이는 단계 안에서 되돌린다
await runStep("order: drag a line to reorder and indent", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 줄 넷 이상인 칸 - 첫 줄 F와, 칸의 첫 줄이 아닌 마지막 의미 묶음의 첫 줄 L(깊이 0, 번호·글이 있다). 둘이 한 화면에 든다
  const probe = () => {
    const isPlain = (row) => row.querySelector('[data-testid^="output-c-number-"]') && row.querySelector('[data-testid^="output-c-item-"]');
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length < 4 || !isPlain(rows[0])) continue;
      const starts = rows.filter((row, index) => index > 0 && row.hasAttribute("data-meaning-start") && isPlain(row) && getComputedStyle(row.querySelector(".c-line")).paddingLeft === "0px");
      if (starts.length === 0 || rows.at(-1).getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { ids: rows.map((row) => row.dataset.flipKey), l: starts.at(-1).dataset.flipKey };
    }
    return null;
  };
  const [hit] = await findOrderDocs(page, probe);
  check("Order has a short section with four lines and a later meaning group", Boolean(hit));
  const [docId, { ids: original, l }] = hit;
  const first = original[0];
  const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
  const readOrder = (anchor) => page.evaluate((id) => [...(document.querySelector(`[data-testid="output-c-row-${id}"]`)?.closest("section")?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), anchor);
  const readNumber = async (id) => (await page.locator(`[data-testid="output-c-number-${id}"]`).innerText()).trim();
  const isDragging = () => page.evaluate(() => document.documentElement.hasAttribute("data-box-drag"));
  const readPane = () => page.locator('[data-testid="output-c"]').evaluate((el) => el.closest(".overflow-auto, .overflow-y-auto").scrollTop);
  const dropLine = page.locator('[data-testid="drop-line"]');
  const card = page.locator('[data-testid="drag-card"]');
  // 놓을 자리의 미리 센 번호는 상태 글(drag-status, 화면 밖)의 note("→ 5.1", 깊이가 바뀌면 "· indent"가 붙는다)에 적힌다
  const readNote = async () => ((await card.count()) > 0 ? ((await page.locator('[data-testid="drag-status"]').textContent()) ?? "").trim() : "");
  // 선에 붙은 표시(있다면)가 덮는 글 상자 - 모든 칸의 줄 번호·글과 겹친 것
  const readLineCover = () => page.evaluate(() => {
    const marks = [...document.querySelectorAll('[data-testid="drop-line"] *')].map((el) => el.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
    const texts = [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box] :is([data-testid^="output-c-item-"], [data-testid^="output-c-number-"], td)')].map((el) => ({ id: el.getAttribute("data-testid") ?? "td", box: el.getBoundingClientRect() }));
    const isOver = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return texts.filter(({ box }) => marks.some((mark) => isOver(mark, box))).map(({ id }) => id);
  });
  const centre = (id) => rowOf(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 줄 안의 한 점 - 글이 있으면 첫 글줄 위, 없으면(표) 줄 왼쪽 위
  const pointIn = async (id) => {
    const text = page.locator(`[data-testid="output-c-item-${id}"]`);
    const box = (await text.count()) > 0 ? await text.boundingBox() : await rowOf(id).boundingBox();
    return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
  };
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  const settle = () => page.waitForTimeout(200);

  // 1. 바깥 누름으로 닫히는 메뉴는 줄을 눌러도 닫힌다 - pointerdown을 막지 않는다(G2)
  await centre(first);
  const firstNumber = await readNumber(first);
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu-manual");
  await page.evaluate(() => {
    window.__clicks = 0;
    document.addEventListener("click", () => {
      window.__clicks += 1;
    });
  });
  const from = await pointIn(l);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 5 });
  check("an open menu still closes on the press", (await page.locator('[data-testid="user-menu-manual"]').count()) === 0);
  // 2. 칸 첫 줄 위로 - 표시·표·선, 선 위 번호는 놓았을 때 L이 받을 번호(칸의 첫 번호)
  const target = { x: from.x, y: (await rowOf(first).boundingBox()).y + 2 };
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await settle();
  const lineText = await readNote();
  check("the drag shows the flag, the card and the drop line", (await isDragging()) && (await card.isVisible()) && (await rowOf(l).getAttribute("data-drag-src")) === "" && (await dropLine.isVisible()), lineText);
  check("the card shows the number the line will get", lineText === `→ ${firstNumber}`, `${lineText} vs → ${firstNumber}`);
  const covered = await readLineCover();
  check("the drop line covers no line's number or text", covered.length === 0, JSON.stringify(covered));
  // 3. 끄는 동안 다른 호버 효과는 꺼진다(G10)
  const hoverEffects = await page.evaluate(() => ({
    groups: [...document.querySelectorAll(".c-acts, .c-more")].filter((el) => getComputedStyle(el).display !== "none" && Number(getComputedStyle(el).opacity) > 0).length,
    tips: document.querySelectorAll(".tip").length,
  }));
  check("hover effects are off while dragging", hoverEffects.groups === 0 && hoverEffects.tips === 0, JSON.stringify(hoverEffects));
  // 4. 같은 칸 안에서 더 움직여도 React는 다시 그리지 않는다(G11)
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 20; i += 1) await page.mouse.move(target.x + (i % 5), target.y + (i % 3));
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
  // 5. 칸 첫 줄 위에서 놓으면 새 순서가 저장되고 번호를 다시 센다
  const paneBefore = await readPane();
  const saved = waitOrderSave(page);
  await page.mouse.up();
  const dropped = await readOrder(l);
  check("dropping above the first line saves the new order", (await saved).ok() && dropped[0] === l && (await readNumber(l)) === firstNumber && (await readNumber(first)) !== firstNumber, JSON.stringify(dropped));
  // 6. 놓은 줄은 고른 채로, 끌기는 끝났고 화면은 뛰지 않았다. 긁힌 글자도 없다
  const after = await page.evaluate(() => ({
    active: document.activeElement?.getAttribute("data-testid") ?? "",
    flag: document.documentElement.hasAttribute("data-box-drag"),
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    marks: document.querySelectorAll("[data-drag-src], [data-drag-home]").length,
    selection: getSelection().toString(),
  }));
  check("the dropped line is picked and the drag is over", after.active === `output-c-row-${l}` && !after.flag && after.cards === 0 && after.marks === 0 && (await dropLine.isHidden()) && after.selection === "" && Math.abs((await readPane()) - paneBefore) < 2, JSON.stringify(after));
  // 7. 놓은 자리의 click 한 번은 삼키고 다음 click은 그대로 간다(G5)
  const swallowed = await page.evaluate(() => window.__clicks);
  await settle();
  const lBox = await rowOf(l).boundingBox();
  await page.mouse.click(lBox.x + 4, lBox.y + 4);
  check("the click after the drop is swallowed", swallowed === 0 && (await page.evaluate(() => window.__clicks)) === 1, `${swallowed} then ${await page.evaluate(() => window.__clicks)}`);
  // 8. 새로 고쳐도 옮긴 순서가 남아 있다
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const reloaded = await readOrder(l);
  check("after a reload the new order persisted", reloaded[0] === l && reloaded.length === original.length, JSON.stringify(reloaded));
  // 9. 움직임 줄이기 - 되돌리는 놓기는 미끄러지지 않고 바로 선다. 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에 놓아 순서를 되돌린다
  await page.emulateMedia({ reducedMotion: "reduce" });
  await centre(first);
  const block = reloaded.slice(0, reloaded.indexOf(first));
  const next = original[original.indexOf(block.at(-1)) + 1] ?? null;
  const backFrom = await pointIn(l);
  const nextBox = await rowOf(next ?? reloaded.at(-1)).boundingBox();
  await page.mouse.move(backFrom.x, backFrom.y);
  await page.mouse.down();
  await page.mouse.move(backFrom.x, next ? nextBox.y + 2 : nextBox.y + nextBox.height + 6, { steps: 12 });
  const back = waitOrderSave(page);
  await page.mouse.up();
  const motion = await rowOf(l).evaluate((el) => ({ transform: el.style.transform, transition: el.style.transition, duration: getComputedStyle(el).transitionDuration }));
  check("reduced motion moves at once", motion.transform === "" && motion.transition === "" && motion.duration.split(",").every((part) => part.trim() === "0s"), JSON.stringify(motion));
  check("dragging the block back restores the order", (await back).ok() && JSON.stringify(await readOrder(l)) === JSON.stringify(original), JSON.stringify(await readOrder(l)));
  await page.emulateMedia({ reducedMotion: null });

  // 10. 제자리에서 좌우로 30px - 한 단 들여 쓰고 저장, 다시 왼쪽으로 끌어 되돌린다
  const dragSideways = async (id, dx) => {
    await rowOf(id).scrollIntoViewIfNeeded();
    const point = await pointIn(id);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y, { steps: 12 });
    const lineLeft = (await dropLine.isVisible()) ? (await dropLine.boundingBox()).x : null;
    return { text: await readNote(), dragging: await isDragging(), lineLeft };
  };
  // 그 깊이의 줄이 시작하는 x - 줄 상자(.c-line) 왼쪽 + 들여쓴 만큼(padding-left)
  const readTextStart = (id) => page.locator(`[data-testid="output-c-row-${id}"] .c-line`).evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  const indentId = await page.evaluate(() => [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box][data-meaning-start]')]
    .find((row) => row.querySelector('[data-testid^="output-c-indent-"]:not([disabled])') && row.querySelector('[data-testid^="output-c-number-"]') && row.querySelector('[data-testid^="output-c-item-"]'))
    ?.dataset.flipKey ?? null);
  check("a line whose depth may change exists", indentId !== null);
  const indentNumber = await readNumber(indentId);
  const right = await dragSideways(indentId, 30);
  const indented = waitOrderSave(page);
  await page.mouse.up();
  const indentedOk = (await indented).ok();
  const deeper = await readNumber(indentId);
  check("dragging sideways 30px indents one level", right.dragging && right.text.includes("indent") && !right.text.includes("outdent") && indentedOk && deeper.split(".").length === indentNumber.split(".").length + 1, `${right.text} | ${indentNumber} -> ${deeper}`);
  // 끄는 동안의 선은 들여 쓴 뒤 그 줄이 시작하는 자리에서 시작한다(글의 들여쓰기 1.5em과 같은 폭)
  await page.waitForTimeout(400);
  const indentedStart = await readTextStart(indentId);
  check("the drop line starts where a line of that depth starts", right.lineLeft !== null && Math.abs(right.lineLeft - indentedStart) <= 1, JSON.stringify({ lineLeft: right.lineLeft, indentedStart }));
  const left = await dragSideways(indentId, -30);
  const outdented = waitOrderSave(page);
  await page.mouse.up();
  check("dragging 30px back outdents it and saves", left.text.includes("outdent") && (await outdented).ok() && (await readNumber(indentId)) === indentNumber, `${left.text} | ${await readNumber(indentId)}`);

  // 11. 깊이가 잠긴 줄(이미 쓴 문서 WI-04) - 같은 몸짓은 아무것도 바꾸지 않는다
  const [locked] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length >= 3) return rows[1].dataset.flipKey;
    }
    return null;
  });
  check("the already-written document WI-04 has a section with three lines", Boolean(locked));
  const lockedId = locked[1];
  const padding = () => page.locator(`[data-testid="output-c-row-${lockedId}"] .c-line`).evaluate((el) => getComputedStyle(el).paddingLeft);
  const lockedPadding = await padding();
  const lockedPuts = puts.length;
  const lockedDrag = await dragSideways(lockedId, 30);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("on a depth-locked line the same gesture changes nothing", lockedDrag.dragging && !lockedDrag.text.includes("indent") && puts.length === lockedPuts && (await padding()) === lockedPadding, JSON.stringify({ lockedDrag, puts: puts.length - lockedPuts }));

  // 12. N/A 칸 위로(데모 시드 SOP-CF의 절차 Troubleshooting) - 앞서 같은 칸에서 놓을 자리를 잡았어도 표에 이유를 적고, 놓으면 아무것도 저장하지 않는다(G7·G8).
  //     출발은 N/A 칸 위쪽에서 줄이 있는 가장 가까운 칸(같은 시드의 첫 절차)
  const [naHit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    const na = sheet?.querySelector("section[data-na]");
    if (!na) return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const above = sections.slice(0, sections.indexOf(na)).reverse().find((section) => section.querySelector("[data-drag-box]"));
    const rows = above ? [...above.querySelectorAll("[data-drag-box]")] : [];
    return rows.length > 0 ? { na: na.dataset.locationKey, first: rows[0].dataset.flipKey, source: rows.at(-1).dataset.flipKey } : null;
  });
  check("a document has an N/A section below a section with lines", Boolean(naHit));
  const naCase = naHit[1];
  await scrollRowToTop(page, naCase.first, 120);
  const naOrder = await readOrder(naCase.first);
  const np = await pointIn(naCase.source);
  await page.mouse.move(np.x, np.y);
  await page.mouse.down();
  await page.mouse.move(np.x, (await rowOf(naCase.first).boundingBox()).y + 2, { steps: 12 });
  const validFirst = await dropLine.isVisible();
  await page.mouse.move(np.x, (await pointInSectionEnd(page, naCase.na)).y, { steps: 12 });
  const refusal = { ...(await readDragCard(page)), section: await readSectionState(page, naCase.na) };
  const naFit = await readOutlineFit(page, naCase.na);
  check("the refused outline clears the N/A section's heading and reason", isOutlineClear(naFit), JSON.stringify(naFit));
  await takeShot("order-xsec-refused-na.png");
  check("an N/A section refuses with a reason", validFirst && refusal.refused && refusal.note.includes("That section is N/A in the To-Be list.") && (await dropLine.isHidden()) && refusal.section?.opacity < 1 && refusal.section?.drop === "refused", JSON.stringify({ validFirst, ...refusal }));
  check("the dimmed N/A section keeps its N/A reason line undimmed", refusal.section?.reasonOpacity === 1, JSON.stringify(refusal.section));
  const refusalPuts = puts.length;
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing over an N/A section saves nothing", puts.length === refusalPuts && JSON.stringify(await readOrder(naCase.first)) === JSON.stringify(naOrder), JSON.stringify(await readOrder(naCase.first)));

  const [pairHit] = await findOrderDocs(page, () => {
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section')];
    for (let i = 0; i + 1 < sections.length; i += 1) {
      const rows = [...sections[i].querySelectorAll("[data-drag-box]")];
      const other = sections[i + 1].querySelector("[data-drag-box]");
      if (rows.length < 2 || !other || !rows.at(-1).hasAttribute("data-meaning-start")) continue;
      if (other.getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { first: rows[0].dataset.flipKey, source: rows.at(-1).dataset.flipKey, other: other.dataset.flipKey };
    }
    return null;
  });
  check("a section with two lines sits right above another section", Boolean(pairHit));
  const pair = pairHit[1];
  await centre(pair.first);
  const pairOrder = await readOrder(pair.first);

  // 13. 끄다가 Esc - 끌기만 취소된다. 저장 없음, 누른 줄은 고른 채, 단추 위에서 떼도 뒤따르는 click은 단추를 누르지 않는다(Review Focus 2)
  await page.evaluate(() => {
    window.__buttonClicks = 0;
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) window.__buttonClicks += 1;
    }, true);
  });
  const ep = await pointIn(pair.source);
  await page.mouse.move(ep.x, ep.y);
  await page.mouse.down();
  await page.mouse.move(ep.x, (await rowOf(pair.first).boundingBox()).y + 2, { steps: 12 });
  const escStarted = (await isDragging()) && (await dropLine.isVisible());
  const escPuts = puts.length;
  await page.keyboard.press("Escape");
  await settle();
  const downButton = await page.locator(`[data-testid="output-c-move-down-${pair.first}"]`).boundingBox();
  await page.mouse.move(downButton.x + downButton.width / 2, downButton.y + downButton.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const escState = await page.evaluate(() => ({
    flag: document.documentElement.hasAttribute("data-box-drag"),
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    active: document.activeElement?.getAttribute("data-testid") ?? "",
    buttonClicks: window.__buttonClicks,
  }));
  check("Esc cancels", escStarted && !escState.flag && escState.cards === 0 && puts.length === escPuts && JSON.stringify(await readOrder(pair.first)) === JSON.stringify(pairOrder) && escState.active === `output-c-row-${pair.source}`, JSON.stringify(escState));
  check("the click after Esc presses no button", escState.buttonClicks === 0, String(escState.buttonClicks));

  // 14. 단추 묶음의 여백, 줄 상자 바로 바깥의 다리에서 누르고 움직여도 끌리지 않는다(Review Focus 1)
  await page.mouse.move(0, 0);
  await rowOf(pair.first).hover({ position: { x: 8, y: 4 } });
  await settle();
  const acts = await page.locator(`[data-testid="output-c-acts-${pair.first}"]`).boundingBox();
  await page.mouse.move(acts.x + 1, acts.y + 1);
  await page.mouse.down();
  await page.mouse.move(acts.x + 1, acts.y + 21, { steps: 5 });
  const padDrag = await isDragging();
  await page.mouse.up();
  check("a press on the action group padding does not drag", !padDrag);
  const rowBox = await rowOf(pair.first).boundingBox();
  const bridge = { x: rowBox.x + rowBox.width + 10, y: rowBox.y + 6 };
  await page.mouse.move(rowBox.x + rowBox.width - 4, bridge.y);
  await page.mouse.move(bridge.x, bridge.y, { steps: 3 });
  const bridgeRow = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-drag-box]")?.dataset.flipKey ?? null, bridge);
  await page.mouse.down();
  await page.mouse.move(bridge.x, bridge.y + 20, { steps: 5 });
  const bridgeDrag = await isDragging();
  await page.mouse.up();
  await page.mouse.move(rowBox.x + 40, rowBox.y + 30, { steps: 5 });
  const pendingDrag = await isDragging();
  check("a press in the bridge just outside the row neither drags nor leaves a pending press", bridgeRow === pair.first && !bridgeDrag && !pendingDrag, JSON.stringify({ bridgeRow, bridgeDrag, pendingDrag }));

  // 15. Alt를 누른 채 줄 글 위를 긁으면 글자가 골라지고 줄은 끌리지 않는다. Alt를 떼도 선택은 남고, 빈 곳을 누르면 풀린다(G3)
  const altId = await page.evaluate(() => [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box] [data-testid^="output-c-item-"]')].find((el) => el.getBoundingClientRect().width > 120)?.closest("[data-drag-box]").dataset.flipKey ?? null);
  check("a line with enough text to select exists", altId !== null);
  await rowOf(altId).scrollIntoViewIfNeeded();
  const altOrder = await readOrder(altId);
  const altPuts = puts.length;
  await page.keyboard.down("Alt");
  const altMode = await page.evaluate(() => document.documentElement.hasAttribute("data-box-select"));
  const textBox = await page.locator(`[data-testid="output-c-item-${altId}"]`).boundingBox();
  await page.mouse.move(textBox.x + 4, textBox.y + 8);
  await page.mouse.down();
  let altDragged = false;
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(textBox.x + 4 + i * 10, textBox.y + 8);
    if (await isDragging()) altDragged = true;
  }
  await page.mouse.up();
  const altSelected = await page.evaluate(() => getSelection().toString().length);
  await page.waitForTimeout(300);
  check("Alt selects text instead of dragging", altMode && !altDragged && altSelected > 0 && puts.length === altPuts && JSON.stringify(await readOrder(altId)) === JSON.stringify(altOrder), JSON.stringify({ altMode, altDragged, altSelected }));
  await page.keyboard.up("Alt");
  const kept = await page.evaluate(() => ({ selection: getSelection().toString().length, mode: document.documentElement.hasAttribute("data-box-select") }));
  const sheetBox = await page.locator('[data-testid="output-c"] article.sheet').first().boundingBox();
  await page.mouse.click(sheetBox.x - 6, sheetBox.y + 40);
  const cleared = await page.evaluate(() => ({ selection: getSelection().toString().length, mode: document.documentElement.hasAttribute("data-box-select") }));
  check("the selection stays after Alt is let go and an empty press clears it", kept.selection > 0 && kept.mode && cleared.selection === 0 && !cleared.mode, JSON.stringify({ kept, cleared }));
});

// 같은 문서의 다른 칸으로 - 데모 시드 SOP-CF(아직 쓰지 않은 SOP): 1 Purpose의 의미 짝(덩어리)을 4 Responsibilities의 두 의미 묶음 사이로,
// 하위 칸(5장의 범주 General Requirements › Safety)의 끝으로, 그 아래의 빈 칸(템플릿 골격에서는 8 Attachments나 9 Appendices)으로 옮긴 뒤 같은 길을 되짚어(Responsibilities를 거쳐) 빈 Purpose로 되돌린다.
// 1–5 · 7 · 8장의 줄은 글머리 기호라 번호가 없다 - 표의 note는 그 칸에서 받을 번호이고, 번호를 받지 않는 줄이면 칸 이름이다(noteFor)
await runStep("order: drag a block into another section, a sub-slot and an empty section", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // A = 줄이 한 의미 묶음뿐인(첫 줄을 끌면 칸의 줄이 모두 가는) 첫 칸, R = 줄 넷 이상에 둘째 의미 묶음이 있는 칸, B = 줄이 있는 하위 칸(키에 "."), E = B 아래 100px 넘게 떨어진 N/A 아닌 빈 칸.
  // 빈 칸은 빈 칸 표시("–")가 있는 칸만이다 - 하위만 묶는 칸(7 · 7.1)과 앱이 채우는 칸(7.2)은 줄이 없어도 줄을 받지 않는다.
  // A가 한 묶음이어야 하는 까닭 - 앞 단계(캡션 없는 표 확정)가 첫 칸 맨 앞에 표를 더하면 그 칸은 표와 한/영 짝 두 덩어리가 된다
  const [hit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    if (!sheet || sheet.querySelector("header .tag")?.textContent !== "SOP") return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    const numberOf = (section) => section.querySelector("h3 .font-mono")?.textContent.trim() ?? null;
    // 칸 머리의 이름 - 번호(span)와 칸 제목 출처(span)를 뺀 글
    const labelOf = (section) => [...section.querySelector("h3").childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim();
    const isEmpty = (section) => !section.hasAttribute("data-na") && rowsOf(section).length === 0 && section.querySelector('[data-testid^="output-c-empty-"]') !== null;
    const a = sections.find((section) => rowsOf(section).length >= 2 && !rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const r = sections.find((section) => section !== a && rowsOf(section).length >= 4 && rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const b = sections.find((section) => section.dataset.locationKey.includes(".") && rowsOf(section).length >= 1);
    if (!a || !r || !b || sections.indexOf(a) > sections.indexOf(r) || sections.indexOf(r) > sections.indexOf(b)) return null;
    const e = sections.find((section) => isEmpty(section) && section.getBoundingClientRect().top - b.getBoundingClientRect().bottom > 100);
    // 좁은 틀에서 잴 빈 칸(B 뒤의 첫 것)과 N/A 칸
    const nextEmpty = sections.slice(sections.indexOf(b) + 1).find(isEmpty);
    const na = sheet.querySelector("section[data-na]");
    if (!e || !nextEmpty || !na) return null;
    const between = rowsOf(r).find((row, i) => i > 0 && row.hasAttribute("data-meaning-start"));
    return {
      a: { key: a.dataset.locationKey, number: numberOf(a), label: labelOf(a), ids: rowsOf(a).map((row) => row.dataset.flipKey) },
      r: { key: r.dataset.locationKey, label: labelOf(r), ids: rowsOf(r).map((row) => row.dataset.flipKey), between: between.dataset.flipKey },
      b: { key: b.dataset.locationKey, number: numberOf(b), label: labelOf(b), first: rowsOf(b)[0].dataset.flipKey },
      e: { key: e.dataset.locationKey, number: numberOf(e), label: labelOf(e) },
      nextEmpty: nextEmpty.dataset.locationKey,
      na: na.dataset.locationKey,
    };
  });
  check("an SOP has a section, a later section with two meaning groups, a sub-slot with lines, empty sections and an N/A section", Boolean(hit));
  const [docId, { a, r, b, e, nextEmpty, na }] = hit;
  // 표의 note - 그 칸에서 받은 번호, 번호 없는 줄(글머리 기호 · 생략 · 주석, 범주의 줄)이면 칸 이름
  const noteFor = (number, section) => `→ ${number ?? section.label}`;
  // 덩어리 = A의 첫 줄을 누르면 함께 가는 줄(데모 시드에서는 A의 두 줄 - 같은 의미의 한/영 짝)
  const lead = a.ids[0];
  const puts = [];
  const bodies = [];
  page.on("request", (request) => {
    if (!isOrderSave(request)) return;
    puts.push(request.url());
    bodies.push(request.postDataJSON());
  });

  // 1. A의 덩어리를 R의 두 의미 묶음 사이로 - 표에 R에서 받을 번호(둘째 묶음 첫 줄의 지금 번호, 번호 없는 줄이면 칸 이름), 놓으면 하나 저장, 그 칸에서 그 번호, 놓은 줄이 번쩍인다
  const expectedBetween = await readRowNumber(page, r.between);
  await scrollRowToTop(page, lead);
  const rBetween = await page.locator(`[data-testid="output-c-row-${r.between}"]`).boundingBox();
  await dragThrough(page, await pointInRow(page, lead), [{ x: rBetween.x + 40, y: rBetween.y + 2 }]);
  const overR = { card: await readDragCard(page), section: await readSectionState(page, r.key), home: await readSectionState(page, a.key) };
  check("over another section the card shows the number the line will get there, or the section's name for a line without a number", !overR.card.refused && overR.card.note === noteFor(expectedBetween, r) && overR.section?.drop === "over" && overR.section.opacity === 1 && overR.home?.opacity === 1, JSON.stringify(overR));
  const fitR = await readOutlineFit(page, r.key);
  check("the outline of a section with lines clears its heading, numbers, text and the drop line", isOutlineClear(fitR), JSON.stringify(fitR));
  const barDragged = await readBarClear(page, lead);
  check("while dragging, the pressed row's left bar clears its number", barDragged.clear !== null && barDragged.clear >= 1, JSON.stringify(barDragged));
  const firstSave = waitOrderSave(page);
  await page.mouse.up();
  const flashedFirst = await waitFlash(page, lead);
  check("dropping it saves once and the line lands between the groups with that number", (await firstSave).ok() && puts.length === 1 && (await readRowKey(page, lead)) === r.key && (await readRowNumber(page, lead)) === expectedBetween && flashedFirst, JSON.stringify({ puts: puts.length, key: await readRowKey(page, lead), number: await readRowNumber(page, lead), flashedFirst }));
  check("the saved request carries the new slot and the depth of every moved line", a.ids.every((id) => bodies[0]?.items.some((item) => String(item.target_id) === id && item.slot_key === r.key && "indent_level" in item)), JSON.stringify(bodies[0]?.items.filter((item) => a.ids.includes(String(item.target_id)))));
  check("the drag left no marks", Object.values(await readDragMarks(page)).every((value) => !value), JSON.stringify(await readDragMarks(page)));
  await reopenOrderDoc(page, docId, lead);
  const rAfter = await readSectionIds(page, r.key);
  const at = rAfter.indexOf(r.between);
  check("after a reload the block is still between the two groups", (await readRowKey(page, lead)) === r.key && JSON.stringify(rAfter.slice(at - a.ids.length, at)) === JSON.stringify(a.ids), JSON.stringify(rAfter));

  // 2. 하위 칸 B의 끝으로 - B 위를 20번 움직여도 React는 다시 그리지 않는다(G11). 표는 B에서 받을 번호
  await scrollRowToTop(page, lead, 120);
  const bEnd = await pointInSectionEnd(page, b.key);
  await dragThrough(page, await pointInRow(page, lead), [bEnd]);
  const overB = await readDragCard(page);
  const fitB = await readOutlineFit(page, b.key);
  check("the outline of a sub-slot clears its heading, numbers, text and the drop line", isOutlineClear(fitB), JSON.stringify(fitB));
  await takeShot("order-xsec-note.png");
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 20; i += 1) await page.mouse.move(bEnd.x + (i % 5), bEnd.y - (i % 3));
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over another section", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
  const subSave = waitOrderSave(page);
  await page.mouse.up();
  const flashedSub = await waitFlash(page, lead);
  // 미끄러짐(--dur-slow 240ms)이 끝나고 테두리가 아직 진할 때(처음 35%)
  await page.waitForTimeout(300);
  await takeShot("order-xsec-landed.png");
  // 놓인 줄이 번호를 받았으면 표의 note가 그 번호(B의 번호 아래)였고, 번호 없는 줄이면(범주의 글머리 기호 줄) B의 이름이었다
  const landedB = await readRowNumber(page, lead);
  check("dropping into a sub-slot moves it there with what the card showed", overB.src.includes(lead) && overB.note === noteFor(landedB, b) && (landedB === null || (b.number !== null && landedB.startsWith(`${b.number}.`))) && (await subSave).ok() && (await readRowKey(page, lead)) === b.key && flashedSub, JSON.stringify({ overB, b, key: await readRowKey(page, lead), number: landedB, flashedSub }));

  // 3. 빈 칸 E로 - 표는 E의 첫 번호(번호 없는 줄이면 E의 이름), 놓으면 그 칸의 첫 줄들이 되고 다시 받아도 남는다
  await scrollRowToTop(page, lead, 120);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, e.key)]);
  const overE = { card: await readDragCard(page), section: await readSectionState(page, e.key), lineShown: (await readDragMarks(page)).lineShown };
  const fitE = await readOutlineFit(page, e.key);
  check("the outline of an empty section clears its heading, the dash and the drop line", isOutlineClear(fitE), JSON.stringify(fitE));
  await takeShot("order-xsec-empty.png");
  const emptySave = waitOrderSave(page);
  await page.mouse.up();
  check("dropping into an empty section saves", (await emptySave).ok());
  await reopenOrderDoc(page, docId, lead);
  const landedE = await readRowNumber(page, lead);
  check("over an empty section the card shows its first number, or its name for a line without a number, and the line is drawn", overE.card.src.includes(lead) && overE.card.note === noteFor(landedE, e) && (landedE === null || landedE === `${e.number}.1`) && overE.section?.drop === "over" && overE.lineShown, JSON.stringify({ overE, e, number: landedE }));
  check("after a reload the block is the empty section's first lines", JSON.stringify(await readSectionIds(page, e.key)) === JSON.stringify(a.ids), JSON.stringify({ ids: await readSectionIds(page, e.key), number: landedE }));

  // 4. 되돌린다 - E에서 R의 두 묶음 사이로, 거기서 빈 A로(한 화면에 든 칸끼리)
  await scrollRowToTop(page, r.between, 100);
  const backPoint = await page.locator(`[data-testid="output-c-row-${r.between}"]`).boundingBox();
  const viaR = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [{ x: backPoint.x + 40, y: backPoint.y + 2 }]);
  await page.mouse.up();
  check("on the way back the block lands between the groups again", (await viaR).ok() && (await readRowKey(page, lead)) === r.key, String(await readRowKey(page, lead)));
  // 빈 A는 R 바로 위 - 덩어리 줄을 틀 아래쪽에 두면(스크롤이 0에서 멈춰도) 둘이 한 화면에 든다
  await scrollRowToTop(page, lead, 450);
  const toA = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, a.key)]);
  const overA = await readDragCard(page);
  await page.mouse.up();
  const backSaved = (await toA).ok();
  await reopenOrderDoc(page, docId, lead);
  const landedA = await readRowNumber(page, lead);
  check("the block goes back into the empty first section", overA.note === noteFor(landedA, a) && (landedA === null || landedA === `${a.number}.1`) && backSaved, JSON.stringify({ overA, a, number: landedA }));
  check("after a reload both sections are as they were", JSON.stringify(await readSectionIds(page, a.key)) === JSON.stringify(a.ids) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ a: await readSectionIds(page, a.key), r: await readSectionIds(page, r.key) }));

  // 5. 다른 칸 위에서 Esc - 저장 없음, 표시는 모두 치워지고 줄은 그대로
  await scrollRowToTop(page, r.ids[0], 120);
  const escPuts = puts.length;
  await dragThrough(page, await pointInRow(page, r.ids[0]), [await pointInSectionEnd(page, b.key)]);
  const escOver = await readSectionState(page, b.key);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(400);
  const escMarks = await readDragMarks(page);
  check("Esc over another section cancels and cleans up", escOver?.drop === "over" && puts.length === escPuts && Object.values(escMarks).every((value) => !value) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ escOver, escMarks, puts: puts.length - escPuts }));

  // 6. 단추와 글쇠는 칸 끝에서 멈춘다 - B 첫 줄의 Move up은 꺼져 있고, 고른 채 Alt+↑도 아무것도 저장하지 않는다
  const upDisabled = await page.locator(`[data-testid="output-c-move-up-${b.first}"]`).isDisabled();
  await page.locator(`[data-testid="output-c-row-${b.first}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${b.first}"]`).click({ position: { x: 4, y: 4 } });
  const keyPuts = puts.length;
  const barAtRest = await readBarClear(page, b.first);
  check("a selected row's left bar clears its number", barAtRest.clear !== null && barAtRest.clear >= 1, JSON.stringify(barAtRest));
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(400);
  check("Move up and Alt+ArrowUp stop at the top of the section", upDisabled && puts.length === keyPuts && (await readRowKey(page, b.first)) === b.key, JSON.stringify({ upDisabled, puts: puts.length - keyPuts }));

  // 7. 좁은 틀(900)·다크에서도 테두리가 글자와 선에 닿지 않는다 - 줄이 있는 칸(A), 줄이 있는 하위 칸(B), 빈 하위 칸, 거절(N/A 칸). 모두 Esc로 끝내 저장하지 않는다
  await page.evaluate(() => window.localStorage.setItem("sopa.theme", "dark"));
  await page.setViewportSize({ width: 900, height: 720 });
  await reopenOrderDoc(page, docId, lead);
  const narrowPuts = puts.length;
  const narrow = { dark: await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark"), fits: {} };
  const measureOver = async (from, keys, shot) => {
    await dragThrough(page, await pointInRow(page, from), []);
    for (const key of keys) {
      await page.mouse.move((await pointInRow(page, from)).x, (await pointInSectionEnd(page, key)).y, { steps: 12 });
      narrow.fits[key] = await readOutlineFit(page, key);
    }
    if (shot) await takeShot(shot);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await scrollRowToTop(page, r.ids[0], 300);
  await measureOver(r.ids[0], [a.key], null);
  await scrollRowToTop(page, r.ids[0], 60);
  await measureOver(r.ids[0], [b.key, nextEmpty], "order-xsec-narrow-dark.png");
  await scrollRowToTop(page, b.first, 60);
  await measureOver(b.first, [na], null);
  await page.waitForTimeout(300);
  check("at 900 in dark the outline clears the text and the drop line (lines, sub-slot, empty sub-slot, refused N/A)", narrow.dark && Object.keys(narrow.fits).length === 4 && Object.values(narrow.fits).every(isOutlineClear) && narrow.fits[na]?.drop === "refused" && puts.length === narrowPuts, JSON.stringify(narrow));
});

// WI는 같은 부분끼리만 - 데모 시드 WI-01: Step 2 · Instruction의 의미 짝을 Step 3 · Instruction(줄 하나)의 끝으로. 지나는 길의 Step 2 · Why 위에서는 거절된다.
// 되돌릴 때는 빈 Step 2 · Instruction으로
await runStep("order: drag a WI line to another step", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 줄이 있는 step:N:instruction, 그 바로 뒤의 step:N:why, 줄이 있는 다른 step:M:instruction
  const [hit] = await findOrderDocs(page, () => {
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section[data-location-key]')];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    for (let i = 0; i + 2 < sections.length; i += 1) {
      const from = /^step:(\d+):instruction$/.exec(sections[i].dataset.locationKey);
      const why = sections[i + 1].dataset.locationKey;
      if (!from || why !== `step:${from[1]}:why` || rowsOf(sections[i]).length === 0) continue;
      const to = sections.slice(i + 2).find((section) => /^step:\d+:instruction$/.test(section.dataset.locationKey) && rowsOf(section).length > 0);
      if (!to) continue;
      return { from: sections[i].dataset.locationKey, why, to: to.dataset.locationKey, ids: rowsOf(sections[i]).map((row) => row.dataset.flipKey), toStep: Number(to.dataset.locationKey.split(":")[1]) };
    }
    return null;
  });
  check("a WI has a step instruction with lines, its why, and a later step instruction with lines", Boolean(hit));
  const [docId, wi] = hit;
  const lead = wi.ids[0];
  const bodies = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) bodies.push(request.postDataJSON());
  });
  await scrollRowToTop(page, lead);
  const from = await pointInRow(page, lead);
  await dragThrough(page, from, [await pointInSectionEnd(page, wi.why)]);
  const overWhy = { card: await readDragCard(page), section: await readSectionState(page, wi.why) };
  const whyFit = await readOutlineFit(page, wi.why);
  check("over the other part (Why) the drag is refused with its reason", overWhy.card.refused && overWhy.card.note.includes("Instruction or Why: change it in Assign") && overWhy.section?.drop === "refused" && isOutlineClear(whyFit), JSON.stringify({ ...overWhy, whyFit }));
  await page.mouse.move(from.x, (await pointInSectionEnd(page, wi.to)).y, { steps: 12 });
  const overTo = await readDragCard(page);
  // 받을 수 없는 다른 부분(Why)은 그 위에 있지 않아도 끄는 내내 흐리고, 받는 칸은 흐리지 않다
  const dimmed = { why: await readSectionState(page, wi.why), to: await readSectionState(page, wi.to) };
  check("while dragging, the other part (Why) is dimmed and the target step is not", overWhy.section?.opacity < 1 && dimmed.why?.opacity < 1 && dimmed.why.drop === null && dimmed.to?.opacity === 1, JSON.stringify({ overWhy: overWhy.section, ...dimmed }));
  const saved = waitOrderSave(page);
  await page.mouse.up();
  const savedOk = (await saved).ok();
  const whyAfter = await readSectionState(page, wi.why);
  check("after the drop the other part is no longer dimmed and no marks are left", whyAfter?.opacity === 1 && (await readDragMarks(page)).marks === 0, JSON.stringify({ whyAfter, marks: await readDragMarks(page) }));
  const moved = bodies[0]?.items.filter((item) => wi.ids.includes(String(item.target_id))) ?? [];
  check("dropping into another step's instruction sends the new step and depth", !overTo.refused && overTo.note.startsWith(`→ ${wi.toStep}.`) && savedOk && moved.length === wi.ids.length && moved.every((item) => item.wi_step === wi.toStep && "indent_level" in item), JSON.stringify({ overTo, moved }));
  await reopenOrderDoc(page, docId, lead);
  check("after a reload the lines are in the other step", (await readRowKey(page, lead)) === wi.to && JSON.stringify((await readSectionIds(page, wi.to)).slice(-wi.ids.length)) === JSON.stringify(wi.ids), JSON.stringify(await readSectionIds(page, wi.to)));
  // 되돌린다 - 비어 있는 원래 칸으로
  await scrollRowToTop(page, lead, 300);
  const back = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, wi.from)]);
  await page.mouse.up();
  await back;
  await reopenOrderDoc(page, docId, lead);
  check("dragging back restores the step", JSON.stringify(await readSectionIds(page, wi.from)) === JSON.stringify(wi.ids), JSON.stringify(await readSectionIds(page, wi.from)));
});

// 이미 쓴 문서의 줄은 자기 칸을 떠나지 못한다 - 데모 시드 WI-04(이미 쓴 WI, 칸 셋 1. Preparation · 2. Operation · 3. After use). 데모 시드에 이미 쓴 SOP는 없다
await runStep("order: a written document's block cannot leave its section", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section[data-location-key]')].filter((section) => section.querySelector("[data-drag-box]"));
    return sections.length >= 2 ? { from: sections[0].querySelector("[data-drag-box]").dataset.flipKey, fromKey: sections[0].dataset.locationKey, to: sections[1].dataset.locationKey } : null;
  });
  check("the already-written WI-04 has two sections with lines", Boolean(hit));
  const [, written] = hit;
  const order = await readSectionIds(page, written.fromKey);
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  await scrollRowToTop(page, written.from);
  await dragThrough(page, await pointInRow(page, written.from), [await pointInSectionEnd(page, written.to)]);
  const over = { card: await readDragCard(page), section: await readSectionState(page, written.to), locked: await page.evaluate(() => document.querySelectorAll("[data-drag-locked]").length) };
  check("over another section the written block is refused with the step reason and the other sections are dimmed", over.card.refused && over.card.note.includes("Only sentences written here for a WI can change step.") && over.section?.drop === "refused" && over.section.opacity < 1 && over.locked === 1, JSON.stringify(over));
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing it saves nothing", puts.length === 0 && JSON.stringify(await readSectionIds(page, written.fromKey)) === JSON.stringify(order), JSON.stringify({ puts: puts.length, order: await readSectionIds(page, written.fromKey) }));
});

// 저장이 날아가는 동안 다른 칸에 놓기 - 데모 시드 SOP-CF: 4 Responsibilities의 둘째 묶음 첫 줄을 Alt+↓로 옮긴 저장을 붙잡은 채 1 Purpose의 덩어리를 2 Scope 끝에 놓는다.
// 둘째 저장은 첫 응답 뒤에 나가고 둘 다 남는다. 끝에 둘 다 되돌린다
await runStep("order: a drop into another section while a save is in flight is re-applied after it", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    if (!sheet || sheet.querySelector("header .tag")?.textContent !== "SOP") return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    // A·S는 줄이 한 의미 묶음뿐인 칸 - 앞 단계가 첫 칸에 표를 더하면 그 칸은 두 덩어리다(위 단계와 같은 까닭)
    const [a, s] = sections.filter((section) => rowsOf(section).length >= 2 && !rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const r = sections.find((section) => rowsOf(section).length >= 4 && rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    if (!a || !s || !r || r === a || r === s) return null;
    return {
      a: { key: a.dataset.locationKey, ids: rowsOf(a).map((row) => row.dataset.flipKey) },
      s: { key: s.dataset.locationKey, ids: rowsOf(s).map((row) => row.dataset.flipKey) },
      r: { key: r.dataset.locationKey, ids: rowsOf(r).map((row) => row.dataset.flipKey), mover: rowsOf(r).find((row, i) => i > 0 && row.hasAttribute("data-meaning-start")).dataset.flipKey },
    };
  });
  check("an SOP has two sections with lines and a section with two meaning groups", Boolean(hit));
  const [docId, { a, s, r }] = hit;
  const lead = a.ids[0];
  // 요청·응답이 오간 차례
  const events = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) events.push("request");
  });
  page.on("response", (response) => {
    if (isOrderSave(response.request())) events.push(`response ${response.status()}`);
  });
  let release = null;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let holdOnce = true;
  await page.route(/\/targets\/order/, async (route) => {
    if (route.request().method() !== "PUT" || !holdOnce) return route.continue();
    holdOnce = false;
    await held;
    await route.continue();
  });
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).click({ position: { x: 4, y: 4 } });
  const firstSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  // 옮긴 줄을 따라가는 스크롤이 멈춘 뒤 덩어리 줄을 틀 위쪽에 둔다
  await page.waitForTimeout(600);
  await scrollRowToTop(page, lead);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, s.key)]);
  const over = await readDragCard(page);
  await page.mouse.up();
  const shown = await readRowKey(page, lead);
  await page.waitForTimeout(300);
  const whileHeld = [...events];
  let saveResponses = 0;
  const secondSave = page.waitForResponse((response) => isOrderSave(response.request()) && (saveResponses += 1) === 2, { timeout: T });
  release();
  check("the first save lands", (await firstSave).ok());
  const second = await secondSave;
  await page.waitForTimeout(300);
  check("the drop shows at once and its save waits for the first response", !over.refused && shown === s.key && JSON.stringify(whileHeld) === JSON.stringify(["request"]) && JSON.stringify(events) === JSON.stringify(["request", "response 200", "request", "response 200"]) && second.ok(), JSON.stringify({ over, shown, whileHeld, events }));
  await page.unroute(/\/targets\/order/);
  await reopenOrderDoc(page, docId, lead);
  const rIds = await readSectionIds(page, r.key);
  check("after a reload both changes persisted", JSON.stringify((await readSectionIds(page, s.key)).slice(-a.ids.length)) === JSON.stringify(a.ids) && rIds.indexOf(r.mover) === r.ids.indexOf(r.mover) + 1, JSON.stringify({ s: await readSectionIds(page, s.key), r: rIds }));
  // 되돌린다 - 덩어리를 빈 첫 칸으로, 옮긴 줄은 Alt+↑로
  await scrollRowToTop(page, s.ids[0], 200);
  const back = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, a.key)]);
  await page.mouse.up();
  await back;
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).click({ position: { x: 4, y: 4 } });
  const up = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  await up;
  await reopenOrderDoc(page, docId, lead);
  check("both changes are undone", JSON.stringify(await readSectionIds(page, a.key)) === JSON.stringify(a.ids) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ a: await readSectionIds(page, a.key), r: await readSectionIds(page, r.key) }));
});

// 끄는 동안 칸이 바뀐다 - 앞선 저장의 응답이 끄는 도중 닿으면 선은 새 데이터로 다시 세고 놓은 자리가 선과 같다.
// 앞선 저장이 실패해 되돌려지며 덩어리가 바뀌면 그 끌기는 거절되고 놓아도 저장하지 않는다. 응답은 page.route로 붙잡아 끄는 도중에 푼다
await runStep("order: a save landing mid-drag keeps the drop line and the saved order together, a rollback refuses the drag", { allowConsoleErrors: true }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 첫 두 줄이 같은 의미 짝(F·R)이고, 셋째 줄 뒤에 깊이 0의 의미 묶음 첫 줄 L이 있는 짧은 칸
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length < 4 || rows[1].hasAttribute("data-meaning-start")) continue;
      const starts = rows.filter((row, index) => index > 1 && row.hasAttribute("data-meaning-start") && row.querySelector('[data-testid^="output-c-item-"]') && getComputedStyle(row.querySelector(".c-line")).paddingLeft === "0px");
      if (starts.length === 0 || rows.at(-1).getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { ids: rows.map((row) => row.dataset.flipKey), l: starts.at(-1).dataset.flipKey };
    }
    return null;
  });
  check("Order has a short section that starts with a same-meaning pair and has a later meaning group", Boolean(hit));
  const [docId, { ids: original, l }] = hit;
  const [first, second] = original;
  const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
  const readOrder = () => page.evaluate((id) => [...(document.querySelector(`[data-testid="output-c-row-${id}"]`)?.closest("section")?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), l);
  const centre = () => rowOf(first).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const pointIn = async (id) => {
    const box = await page.locator(`[data-testid="output-c-item-${id}"]`).boundingBox();
    return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
  };
  // 끄는 중의 상태 - 선이 그어진 줄(선 바로 아래의 덩어리 밖 줄, 없으면 칸 끝)과 덩어리 줄
  const readDrag = () => page.evaluate(() => {
    // 선은 끌기 엔진이 처음 그을 때 붙인다 - 아직 없으면 감춘 것과 같다
    const line = document.querySelector('[data-testid="drop-line"]');
    const isLineShown = line !== null && !line.hidden;
    const home = document.querySelector("[data-drag-home]");
    const card = document.querySelector('[data-testid="drag-card"]');
    const top = isLineShown ? line.getBoundingClientRect().top : 0;
    const below = home && isLineShown ? [...home.querySelectorAll("[data-drag-box]:not([data-drag-src])")].find((row) => row.getBoundingClientRect().top >= top - 1) : null;
    return {
      flag: document.documentElement.hasAttribute("data-box-drag"),
      lineShown: isLineShown,
      before: below?.dataset.flipKey ?? null,
      block: home ? [...home.querySelectorAll("[data-drag-src]")].map((row) => row.dataset.flipKey) : [],
      refused: card?.hasAttribute("data-refused") ?? false,
      // 이유는 표가 아니라 화면 밖 상태 글에 있다
      note: card ? (document.querySelector('[data-testid="drag-status"]')?.textContent ?? "") : "",
    };
  });
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  // 다음 저장 하나를 붙잡는다 - 돌려준 함수를 부르면 서버로 보내거나("ok") 500으로 끝낸다("fail")
  let gate = null;
  const holdNextSave = (mode) => {
    let open = null;
    const promise = new Promise((resolve) => {
      open = resolve;
    });
    gate = { mode, promise };
    return open;
  };
  await page.route(/\/targets\/order/, async (route) => {
    const held = gate;
    if (route.request().method() !== "PUT" || held === null) return route.continue();
    gate = null;
    await held.promise;
    if (held.mode === "fail") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "synthetic failure" }) });
    else await route.continue();
  });
  const jiggle = async (x, y) => {
    for (let i = 0; i < 5; i += 1) await page.mouse.move(x + i, y + (i % 2));
  };

  // 1. F를 Alt+↓로 옮긴 저장을 붙잡은 채 L을 칸 맨 위(R 위)로 끌고, 끄는 도중 그 응답을 푼다
  await centre();
  const openOk = holdNextSave("ok");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const heldSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("the held move shows at once", (await readOrder())[1] === first, JSON.stringify(await readOrder()));
  // 두 줄이 미끄러지는(useFlip) 동안 잰 자리는 끝 자리가 아니다 - 멈춘 뒤 잰다
  await page.waitForTimeout(600);
  const from = await pointIn(l);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const target = { x: from.x, y: (await rowOf(second).boundingBox()).y + 2 };
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const beforeLanding = await readDrag();
  openOk();
  check("the held save lands while dragging", (await heldSave).ok());
  await page.waitForTimeout(200);
  await jiggle(target.x, target.y);
  const afterLanding = await readDrag();
  check("the drag survives a save landing mid-drag and still shows the line", beforeLanding.lineShown && afterLanding.flag && afterLanding.lineShown && !afterLanding.refused && afterLanding.before === second, JSON.stringify({ beforeLanding, afterLanding }));
  const dropSave = waitOrderSave(page);
  await page.mouse.up();
  check("the drop after the landed save saves", (await dropSave).ok());
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const saved = await readOrder();
  const at = saved.indexOf(afterLanding.block[0]);
  check("the saved order puts the block right above the line it was drawn at", afterLanding.block.length > 0 && JSON.stringify(saved.slice(at, at + afterLanding.block.length)) === JSON.stringify(afterLanding.block) && saved[at + afterLanding.block.length] === afterLanding.before, JSON.stringify({ saved, afterLanding }));
  // 되돌린다 - 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에 놓고 F를 Alt+↑로 한 자리 올린다
  await centre();
  const next = original[original.indexOf(afterLanding.block.at(-1)) + 1] ?? null;
  const backFrom = await pointIn(l);
  const nextBox = await rowOf(next ?? saved.at(-1)).boundingBox();
  await page.mouse.move(backFrom.x, backFrom.y);
  await page.mouse.down();
  await page.mouse.move(backFrom.x, next ? nextBox.y + 2 : nextBox.y + nextBox.height + 6, { steps: 12 });
  const back = waitOrderSave(page);
  await page.mouse.up();
  await back;
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const up = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("the order is restored", (await up).ok() && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 2. F를 Alt+↓로 옮긴 저장을 붙잡은 채 F(짝 R과 한 덩어리)를 칸 끝으로 끌고, 그 저장을 실패시킨다 - 되돌려지며 덩어리 순서가 바뀌어 거절된다
  await centre();
  const openFail = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const failedSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(600);
  const fFrom = await pointIn(first);
  const lastBox = await rowOf(original.at(-1)).boundingBox();
  await page.mouse.move(fFrom.x, fFrom.y);
  await page.mouse.down();
  const end = { x: fFrom.x, y: lastBox.y + lastBox.height + 6 };
  await page.mouse.move(end.x, end.y, { steps: 12 });
  const beforeFailure = await readDrag();
  openFail();
  check("the held save fails while dragging", (await failedSave).status() === 500);
  await page.waitForTimeout(300);
  await jiggle(end.x, end.y);
  const afterFailure = await readDrag();
  check("a rollback that changes the block refuses the drag with a reason", beforeFailure.lineShown && beforeFailure.block.length >= 2 && afterFailure.flag && afterFailure.refused && afterFailure.note.includes("The lines changed while dragging") && !afterFailure.lineShown, JSON.stringify({ beforeFailure, afterFailure }));
  const refusedPuts = puts.length;
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing a refused drag saves nothing", puts.length === refusedPuts && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 3. L을 칸 맨 위로 놓은 저장을 붙잡은 채 L을 원래 자리로 다시 끌어 멈춘다. 멈춘 채 앞 저장의 응답이 닿고, 움직이지 않고 놓는다 - 두 번째 놓기도 저장된다
  await centre();
  const openFirst = holdNextSave("ok");
  const firstDrop = waitOrderSave(page);
  const aFrom = await pointIn(l);
  await page.mouse.move(aFrom.x, aFrom.y);
  await page.mouse.down();
  await page.mouse.move(aFrom.x, (await rowOf(first).boundingBox()).y + 2, { steps: 12 });
  await page.mouse.up();
  const heldOrder = await readOrder();
  check("the first drop shows at once while its save is held", heldOrder[0] === l, JSON.stringify(heldOrder));
  await page.waitForTimeout(600);
  const heldBlock = heldOrder.slice(0, heldOrder.indexOf(first));
  const home = original[original.indexOf(heldBlock.at(-1)) + 1] ?? null;
  const bFrom = await pointIn(l);
  const homeBox = await rowOf(home ?? heldOrder.at(-1)).boundingBox();
  await page.mouse.move(bFrom.x, bFrom.y);
  await page.mouse.down();
  await page.mouse.move(bFrom.x, home ? homeBox.y + 2 : homeBox.y + homeBox.height + 6, { steps: 12 });
  const stillDrag = await readDrag();
  openFirst();
  check("the held first drop lands while the second drag holds still", (await firstDrop).ok());
  // 응답이 화면에 커밋될 때까지 기다린다 - 포인터는 움직이지 않는다
  await page.waitForTimeout(400);
  const secondDrop = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const secondSaved = await secondDrop;
  check("releasing without moving after the save landed saves the second drop", stillDrag.lineShown && stillDrag.before === home && secondSaved?.ok() === true, JSON.stringify({ stillDrag, home, saved: secondSaved?.status() ?? null }));
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  check("after a reload the second drop persisted (the order is back)", JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 4. F를 Alt+↓로 옮긴 저장(덩어리 L과 무관)을 붙잡은 채 L을 칸 맨 위로 끌어 멈추고, 멈춘 채 그 저장을 실패시킨다 - 칸 모양이 바뀌어 놓은 자리에서 다시 센다.
  //    포인터는 여전히 칸 첫 줄의 위쪽 절반 위라 L 덩어리는 칸 맨 위(되돌아온 F 앞)에 저장된다
  await centre();
  const openRollback = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const rolledBack = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(600);
  const cFrom = await pointIn(l);
  await page.mouse.move(cFrom.x, cFrom.y);
  await page.mouse.down();
  await page.mouse.move(cFrom.x, (await rowOf(second).boundingBox()).y + 2, { steps: 12 });
  const beforeRollback = await readDrag();
  openRollback();
  check("the held unrelated save fails while the drag holds still", (await rolledBack).status() === 500);
  await page.waitForTimeout(400);
  const replanned = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const replannedSave = await replanned;
  check("releasing without moving after the shape changed plans again and saves", beforeRollback.lineShown && beforeRollback.before === second && replannedSave?.ok() === true, JSON.stringify({ beforeRollback, saved: replannedSave?.status() ?? null }));
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const replannedOrder = await readOrder();
  const lBlock = replannedOrder.slice(0, replannedOrder.indexOf(first));
  check("the block was saved at the top of the section, above the rolled-back first line", lBlock[0] === l && JSON.stringify(replannedOrder.slice(lBlock.length)) === JSON.stringify(original.filter((id) => !lBlock.includes(id))), JSON.stringify(replannedOrder));
  // 되돌린다 - 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에
  await centre();
  const lNext = original[original.indexOf(lBlock.at(-1)) + 1] ?? null;
  const dFrom = await pointIn(l);
  const lNextBox = await rowOf(lNext ?? replannedOrder.at(-1)).boundingBox();
  await page.mouse.move(dFrom.x, dFrom.y);
  await page.mouse.down();
  await page.mouse.move(dFrom.x, lNext ? lNextBox.y + 2 : lNextBox.y + lNextBox.height + 6, { steps: 12 });
  const restored = waitOrderSave(page);
  await page.mouse.up();
  check("the order is restored again", (await restored).ok() && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 5. 다른 칸에서 끌어 온 덩어리 - F를 Alt+↓로 옮긴 저장을 붙잡은 채 위쪽 칸(데모 시드 SOP-CF의 1 Purpose)의 덩어리를 이 칸 첫 줄(옮겨 온 R)의 위쪽 절반에 대고 멈추고,
  //    멈춘 채 그 저장을 실패시킨다 - 도착 칸의 모양이 바뀌어 놓은 자리에서 다시 센다. 포인터 밑은 되돌아온 F라 덩어리는 칸 맨 위(F 앞)에 저장된다(낡은 자리면 짝 F·R 사이)
  const above = await page.evaluate((id) => {
    const home = document.querySelector(`[data-testid="output-c-row-${id}"]`).closest("section");
    const sections = [...home.closest("article").querySelectorAll("section[data-location-key]")];
    // 줄이 한 의미 묶음뿐인 칸 - 앞 단계(캡션 없는 표 확정)가 첫 칸 맨 앞에 표를 더하면 그 칸은 두 덩어리다
    const isOneBlock = (section) => ![...section.querySelectorAll("[data-drag-box]")].some((row, i) => i > 0 && row.hasAttribute("data-meaning-start"));
    const source = sections.slice(0, sections.indexOf(home)).find((section) => section.querySelector("[data-drag-box]") && isOneBlock(section));
    return source ? { key: source.dataset.locationKey, ids: [...source.querySelectorAll("[data-drag-box]")].map((row) => row.dataset.flipKey) } : null;
  }, first);
  check("a section with lines sits above it", above !== null);
  const openDestRollback = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const destRolledBack = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  // 옮긴 줄을 따라가는 스크롤이 멈춘 뒤 위쪽 칸의 덩어리 줄을 틀 위쪽에 둔다
  await page.waitForTimeout(600);
  await scrollRowToTop(page, above.ids[0], 120);
  await dragThrough(page, await pointIn(above.ids[0]), [{ x: (await pointIn(above.ids[0])).x, y: (await rowOf(second).boundingBox()).y + 2 }]);
  const beforeDestRollback = await readDragCard(page);
  openDestRollback();
  check("the held save in the destination fails while the drag holds still", (await destRolledBack).status() === 500);
  await page.waitForTimeout(400);
  const crossReplanned = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const crossReplannedSave = await crossReplanned;
  check("releasing without moving after the destination changed plans again and saves", !beforeDestRollback.refused && beforeDestRollback.note.startsWith("→ ") && crossReplannedSave?.ok() === true, JSON.stringify({ beforeDestRollback, saved: crossReplannedSave?.status() ?? null }));
  await reopenOrderDoc(page, docId, l);
  check("the block was saved at the top of the destination, above the rolled-back first line", JSON.stringify(await readOrder()) === JSON.stringify([...above.ids, ...original]), JSON.stringify(await readOrder()));
  // 되돌린다 - 덩어리를 비어 있는 원래 칸으로
  await scrollRowToTop(page, above.ids[0], 400);
  const crossBack = waitOrderSave(page);
  await dragThrough(page, await pointIn(above.ids[0]), [await pointInSectionEnd(page, above.key)]);
  await page.mouse.up();
  await crossBack;
  await reopenOrderDoc(page, docId, l);
  check("both sections are restored", JSON.stringify(await readOrder()) === JSON.stringify(original) && JSON.stringify(await readSectionIds(page, above.key)) === JSON.stringify(above.ids), JSON.stringify({ r: await readOrder(), above: await readSectionIds(page, above.key) }));
  await page.unroute(/\/targets\/order/);
});

await runStep("order: drag is off on a read-only bundle", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const row = page.locator('[data-testid^="output-c-row-"]').nth(1);
  await row.waitFor({ timeout: T });
  check("the reviewer has no edit buttons", (await page.locator('[data-testid^="output-c-move-"]').count()) === 0);
  check("rows are not drag boxes and there is no drag help", (await page.locator("[data-drag-box]").count()) === 0 && (await page.locator('[data-testid="order-drag-help"]').count()) === 0);
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 26, { steps: 5 });
  const state = await page.evaluate(() => ({ flag: document.documentElement.hasAttribute("data-box-drag"), cards: document.querySelectorAll('[data-testid="drag-card"]').length }));
  await page.mouse.up();
  check("no drag starts", !state.flag && state.cards === 0, JSON.stringify(state));
});

await runStep("order: a move chosen from the narrow-frame menu keeps focus on that line's ⋯ button", {}, async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 3) return ids;
    }
    return null;
  });
  check("a section with three lines exists", Boolean(hit));
  const id = hit[1][0];
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeId = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  const start = (await readOrder()).indexOf(id);
  // ⋯ 단추는 줄에 올린 동안이나 줄 안에 포커스가 있을 때만 눌린다(pointer-events) - 줄에 올린 뒤 누르면 단추를 화면에 들이는 스크롤이 올림을 풀어
  // 누름이 틀(output-c)에 걸렸다. 키보드처럼 단추에 포커스를 두고 Enter로 연다(포커스가 줄 안이면 단추가 보이고 눌린다)
  const openRowMenu = async () => {
    await page.locator(`[data-testid="output-c-menu-${id}"]`).focus();
    await page.keyboard.press("Enter");
    await wait(page, `output-c-menu-list-${id}`);
  };
  const waitAt = (index) => page.waitForFunction(({ first, at }) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].findIndex((row) => row.getAttribute("data-testid") === `output-c-row-${first}`) === at, { first: id, at: index }, { timeout: T }).then(() => true, () => false);
  await openRowMenu();
  const moved = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-down-${id}"]`).click();
  check("the menu move saves", (await moved).ok());
  check("the line moved one place", await waitAt(start + 1));
  // 닫힌 메뉴가 포커스를 ⋯ 단추로 돌린다 - 줄이 다시 그려진 뒤까지 기다린다
  await page.waitForFunction((button) => document.activeElement?.getAttribute("data-testid") === button, `output-c-menu-${id}`, { timeout: T }).catch(() => {});
  check("focus is on the moved line's ⋯ button", (await activeId()) === `output-c-menu-${id}`, await activeId());
  await openRowMenu();
  const back = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-up-${id}"]`).click();
  check("and moves back", (await back).ok() && (await readOrder()).indexOf(id) === start);
});

await runStep("order: mark a line as a note on C, the count continues and the note is italic", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 같은 칸에서 같은 깊이로 이어지는 번호 줄 둘(X, Y) - X를 주석으로 바꾸면 Y가 X의 번호를 이어 받는다. 번호 줄이 있는 문서를 찾아 연다
  const [pairHit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => {
        const id = row.getAttribute("data-testid").replace("output-c-row-", "");
        // 글 줄만(output-c-item) - 표 줄은 기울임을 표에 싣는다
        return { id, number: row.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim() ?? null, markable: !!row.querySelector(`[data-testid="output-c-mark-note-${id}"]`), isText: !!row.querySelector(`[data-testid="output-c-item-${id}"]`) };
      });
      for (let i = 0; i + 1 < rows.length; i += 1) {
        const [x, y] = [rows[i], rows[i + 1]];
        if (x.markable && x.isText && x.number && y.number && x.number.split(".").length === y.number.split(".").length) return { x: x.id, y: y.id, xNumber: x.number, yNumber: y.number };
      }
    }
    return null;
  });
  const pair = pairHit ? pairHit[1] : null;
  check("C has two numbered lines in a row to mark", pair !== null);
  if (!pair) return;
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

// 하위 절을 두는 칸(6 Procedures)에 직접 놓인 줄은 번호가 없고 Numbered를 내놓지 않는다 - 그 아래 첫 절차(6.1)의 줄은 6.1.1부터다(제품 명세 §7.13 섹션 번호).
// 6장으로 본다 - 5장의 범주는 번호가 없고 줄이 글머리 기호라 번호를 볼 수 없다. 6장과 그 절차는 기본 표시가 번호라 옮긴 줄의 표시도 그대로다.
// 자료는 이 단계가 API로 만든다 - SOP의 번호 줄 둘을 순서 저장으로 6 칸과 6.1 칸의 맨 앞에 옮기고, 끝에 처음 순서·칸·깊이로 되돌린다(그 문서의 굳힌 순서는 남는다)
await runStep("order: a line placed directly in a slot with sub slots has no number", {}, async ({ page }) => {
  const PARENT = "procedures";
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const listLines = (doc) => doc.sections.flatMap((section) => section.items.map((item) => ({ ...item, key: section.location_key })));
  // 옮겨도 딸려 가는 것이 없는 번호·글머리 기호 줄(6장으로 옮기면 도착 칸의 기본 표시인 번호가 된다) - AI 번역(자리가 출처를 따라 잠긴다)과 그 출처는 뺀다. 의미 묶음에 혼자인 줄을 먼저 고른다
  const pickFree = (doc) => {
    const lines = listLines(doc);
    const withKey = (key) => lines.filter((line) => line.meaning_key === key);
    const free = lines.filter((line) => line.kind === "sentence" && line.origin === "units" && (line.number_style === "numbered" || line.number_style === "bullet") && !(line.meaning_key !== null && withKey(line.meaning_key).some((other) => other.origin === "translation")));
    const alone = free.filter((line) => line.meaning_key === null || withKey(line.meaning_key).length === 1);
    return alone.length >= 2 ? alone : free;
  };
  const isOpen = (doc, key) => doc.sections.some((section) => section.location_key === key && section.na_reason === null);
  // 첫 절차(6.1) - 키는 문서마다 선언한 것이라(새 SOP는 procedures.p1, 합성 SOP는 선언한 절차) 그 문서의 C에서 읽는다
  const findFirstProcedure = (item) => item.sections.find((section) => section.number === "6.1" && section.na_reason === null && section.location_key.startsWith(`${PARENT}.`))?.location_key;
  const doc = (await getJson("/outputs/c?lang=en")).docs.find((item) => item.doc_type === "sop" && item.entrance === "assign" && isOpen(item, PARENT) && findFirstProcedure(item) !== undefined && pickFree(item).length >= 2);
  check("an SOP has Procedures and its first procedure open and two numbered lines to move", doc !== undefined);
  if (!doc) return;
  const SUB = findFirstProcedure(doc);
  const [direct, sub] = pickFree(doc);
  const before = listLines(doc);
  const put = async (items) => page.request.put(`${api}/targets/order`, { headers, data: { revision: (await getJson("")).revision, target_doc_id: doc.target_doc_id, items } });
  const moved = new Set([direct.target_id, sub.target_id]);
  try {
    // 목록의 맨 앞에 두면 그 칸의 첫 줄이다 - 첫 절차의 첫 번호 줄이라 6.1.1
    const arranged = await put([
      { target_id: direct.target_id, slot_key: PARENT, indent_level: 0 },
      { target_id: sub.target_id, slot_key: SUB, indent_level: 0 },
      ...before.filter((line) => !moved.has(line.target_id)).map((line) => ({ target_id: line.target_id })),
    ]);
    check("the order save puts one line in Procedures and one in its first procedure", arranged.ok(), `${arranged.status()} ${arranged.ok() ? "" : await arranged.text()}`);
    await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
    await wait(page, "output-c");
    await page.locator(`[data-testid="order-doc-${doc.target_doc_id}"]`).click();
    const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
    // 긴 문서는 나눠 그린다 - 두 줄이 그려질 때까지 이어 그리기 표지를 화면에 들인다
    const more = page.locator('[data-testid="output-c-more"]');
    for (let i = 0; i < 40 && ((await rowOf(direct.target_id).count()) === 0 || (await rowOf(sub.target_id).count()) === 0) && (await more.count()) > 0; i += 1) {
      await more.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
    }
    await rowOf(direct.target_id).waitFor({ timeout: T });
    await rowOf(sub.target_id).waitFor({ timeout: T });
    const readMarks = (id) => page.locator(`[data-testid="output-c-mark-${id}"] button`).evaluateAll((buttons) => buttons.map((button) => `${button.getAttribute("data-testid").split("-")[3]}:${button.getAttribute("aria-pressed")}`));

    check("the line sits directly in Procedures", (await readRowKey(page, direct.target_id)) === PARENT, await readRowKey(page, direct.target_id));
    check("it shows no number", (await readRowNumber(page, direct.target_id)) === null, await readRowNumber(page, direct.target_id));
    await rowOf(direct.target_id).hover();
    const directMarks = await readMarks(direct.target_id);
    check("it offers Bullet, No number and Note only, with No number shown as picked", JSON.stringify(directMarks) === JSON.stringify(["bullet:false", "omitted:true", "note:false"]), JSON.stringify(directMarks));
    // 머리 번호는 6 그대로다(6.1이 아니다)
    check("the section heading keeps its number 6", /^6(?![.\d])/.test((await getText(page, `output-c-section-${doc.target_doc_id}-${PARENT}`)).trim()), await getText(page, `output-c-section-${doc.target_doc_id}-${PARENT}`));

    check("the line in the first procedure is numbered 6.1.1", (await readRowKey(page, sub.target_id)) === SUB && (await readRowNumber(page, sub.target_id)) === "6.1.1", `${await readRowKey(page, sub.target_id)} ${await readRowNumber(page, sub.target_id)}`);
    await rowOf(sub.target_id).hover();
    const subMarks = await readMarks(sub.target_id);
    check("and still offers Numbered, shown as picked", JSON.stringify(subMarks) === JSON.stringify(["numbered:true", "bullet:false", "omitted:false", "note:false"]), JSON.stringify(subMarks));
  } finally {
    // 처음 순서·칸·깊이로 되돌린다 - 아래 단계와 다시 돌리기가 같은 문서를 본다
    const restored = await put(before.map((line) => ({ target_id: line.target_id, ...(moved.has(line.target_id) ? { slot_key: line.key, indent_level: line.indent_level } : {}) })));
    check("the two lines go back to their own sections", restored.ok(), `${restored.status()}`);
  }
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
}
