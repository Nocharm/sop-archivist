// SOP smoke steps for the map screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import {
  BASE,
  T,
  check,
  runStep,
  wait,
  getText,
  getBox,
  installCommitCounter,
  halfBundleId,
  rowIds,
  readStyle,
} from "./common.mjs";


// --- Map(참조 지도, 설계 2026-11-17) - 읽기만 하는 화면. 데모 Bundle 1~4가 같은 번호(OLD-1…6)를 지녀 한 번호의 선이 넷으로 퍼지므로
// 수를 박지 않고 같은 사람으로 받은 GET …/map 응답과 화면을 견준다 ---

async function findBundleId(page, title) {
  await page.goto(`${BASE}/`);
  const row = page.locator('[data-testid^="bundles-row-"]', { hasText: title });
  await row.first().waitFor({ timeout: T });
  return Number((await row.first().getAttribute("data-testid")).replace("bundles-row-", ""));
}
async function openMap(page, bundleId) {
  await page.goto(`${BASE}/bundles/${bundleId}/map`);
  await wait(page, "map-side-summary");
}
// Map · List 단추가 생긴 뒤(Task 7)에도 같은 단계가 List를 본다
async function openMapList(page) {
  const toggle = page.locator('[data-testid="map-view-list"]');
  if ((await toggle.count()) > 0) await toggle.click();
}
async function readMapApi(page, bundleId, user, scope = "linked") {
  const response = await page.request.get(`${BASE}/api/bundles/${bundleId}/map?scope=${scope}`, { headers: { "X-Dev-User": user } });
  return response.json();
}
const mapRows = (page) => page.locator('[data-testid^="map-row-"]');
const countMapRows = (page) => mapRows(page).count();
// 줄 수가 n이 될 때까지 - 거르기·찾기는 늦춘 값(useDeferredValue)으로 그린다
const waitMapRows = (page, n) => page.waitForFunction((count) => document.querySelectorAll('[data-testid^="map-row-"]').length === count, n, { timeout: T });
const findNodeIds = (map, number) => map.nodes.filter((node) => node.number === number).map((node) => node.id);

// --- 지도 그리기(줄기·마디·선) - 수는 같은 사람으로 받은 응답과 견준다 ---
const mapNodes = (page) => page.locator('[data-testid^="map-node-"]');
const mapNode = (page, id) => page.locator(`[data-testid="map-node-${id}"]`);
const waitMapWorld = (page) => wait(page, "map-world");
// 응답에서 그 Bundle의 마디에 닿는 선 - 접힌 줄기는 그 선을 그리지 않는다
const countLaneEdges = (map, bundleId) => {
  const bundleOf = new Map(map.nodes.map((node) => [node.id, node.bundle_id]));
  return map.edges.filter((edge) => bundleOf.get(edge.source) === bundleId || bundleOf.get(edge.target) === bundleId).length;
};
// 응답에서 그 마디와 이어진 마디·선
const findNeighbours = (map, id) => {
  const edges = map.edges.filter((edge) => edge.source === id || edge.target === id);
  return { edges, nodes: [...new Set(edges.map((edge) => (edge.source === id ? edge.target : edge.source)))] };
};
// 토큰을 임시 요소에 칠해 푼 색
const resolveColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
// 그 요소의 상자가 지도 칸 안에 다 들어 있나 - 부드러운 스크롤이 끝날 때까지 기다린다
const waitInsideCanvas = (page, testId) =>
  page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const frame = document.querySelector('[data-testid="map-canvas"]');
      if (!el || !frame) return false;
      const a = el.getBoundingClientRect();
      const b = frame.getBoundingClientRect();
      return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    },
    testId,
    { timeout: T },
  );

// --- 확대 · Fit all · 바탕 끌기 · 글쇠 ---
const readZoom = async (page) => (await getText(page, "map-zoom-value")).trim();
const waitZoom = (page, value) => page.waitForFunction((text) => document.querySelector('[data-testid="map-zoom-value"]')?.textContent?.trim() === text, value, { timeout: T });
const readSizer = (page) => page.locator('[data-testid="map-sizer"]').evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
const readScroll = (page) => page.locator('[data-testid="map-canvas"]').evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop, maxLeft: el.scrollWidth - el.clientWidth, maxTop: el.scrollHeight - el.clientHeight }));
// 단추가 꺼질 때까지(또는 n번) 누른다 - 꺼진 단추를 누르면 Playwright가 켜지기를 기다린다
async function pressZoom(page, testId, times) {
  for (let i = 0; i < times; i++) {
    const button = page.locator(`[data-testid="${testId}"]`);
    if (await button.isDisabled()) return;
    const before = await readZoom(page);
    await button.click();
    await page.waitForFunction((text) => document.querySelector('[data-testid="map-zoom-value"]')?.textContent?.trim() !== text, before, { timeout: T });
  }
}
// 포커스가 선 요소의 testid
const readActive = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
const waitActiveInsideCanvas = (page) =>
  page.waitForFunction(
    () => {
      const el = document.activeElement;
      const frame = document.querySelector('[data-testid="map-canvas"]');
      if (!el || !frame || !frame.contains(el)) return false;
      const a = el.getBoundingClientRect();
      const b = frame.getBoundingClientRect();
      return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    },
    null,
    { timeout: T },
  );

// 칸 안에서 두 줄기 사이 틈의 한 점(줄기 머리 아래) - 마디도 단추도 아닌 바탕
const findBackgroundSpot = (page) =>
  page.evaluate(() => {
    const lanes = Array.from(document.querySelectorAll(".map-lane")).map((el) => el.getBoundingClientRect());
    const frameBox = document.querySelector('[data-testid="map-canvas"]').getBoundingClientRect();
    for (let i = 0; i + 1 < lanes.length; i++) {
      const x = (lanes[i].right + lanes[i + 1].left) / 2;
      const y = Math.max(lanes[i].top + 120, frameBox.top + 20);
      const hit = document.elementFromPoint(x, y);
      if (x > frameBox.left && x < frameBox.right && hit && !hit.closest(".map-node, button, .map-lane-head")) return { x, y };
    }
    return null;
  });
// 찾기 칸에서 Tab을 거듭 눌러 지도 안으로 - 들어선 요소의 testid
async function tabIntoMap(page) {
  await page.locator('[data-testid="map-search"]').focus();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.querySelector('[data-testid="map-canvas"]')?.contains(document.activeElement) ?? false)) return readActive(page);
  }
  return null;
}
const isFocusInMap = (page) => page.evaluate(() => document.querySelector('[data-testid="map-canvas"]').contains(document.activeElement));

// --- 줄 문장(3걸음) - 문장은 그 줄이 든 Bundle의 구성원에게만 온다. 수를 박지 않고 같은 사람으로 받은 GET …/map/lines 응답과 화면을 견준다 ---
async function readLinesApi(page, bundleId, user, node, scope = "linked") {
  const query = new URLSearchParams({ node, scope });
  const response = await page.request.get(`${BASE}/api/bundles/${bundleId}/map/lines?${query}`, { headers: { "X-Dev-User": user } });
  return response.text();
}
const isLinesResponse = (response, node, scope) => {
  const url = new URL(response.url());
  return url.pathname.endsWith("/map/lines") && url.searchParams.get("node") === node && url.searchParams.get("scope") === scope;
};
const lineLabel = (item) => (item.kind === "moved" ? "moved" : item.state);
const lineTestId = (line, side) => `map-line-${line.unit_id}-${side === "out" ? line.target : line.source}`;
const listSentenceIds = (page) => page.locator('[data-testid="map-side"] .map-sentence').evaluateAll((items) => items.map((item) => item.dataset.testid));
const waitLinesRead = (page) => page.waitForFunction(() => document.querySelector('[data-testid^="map-lines-loading-"]') === null, null, { timeout: T });

/** 옆 칸이 응답과 같은가 - 문장 줄은 응답의 줄과 하나씩, 가려진 줄은 그 선 아래 수 한 줄이고 그 선 밑에는 문장이 없다 */
async function checkSideMatchesLines(page, lines, label) {
  for (const side of ["out", "in"]) {
    const list = page.locator(`[data-testid="map-lines-${side}"]`);
    for (const line of lines[side]) {
      const item = list.locator(`[data-testid="${lineTestId(line, side)}"]`);
      const text = (await item.count()) > 0 ? await item.first().textContent() : "";
      check(`${label}: the ${side} sentence ${line.display_id} shows its ID and text`, text.includes(line.display_id) && text.includes(line.text.slice(0, 40)), text);
    }
    const shown = (await list.count()) > 0 ? await list.locator(".map-sentence").count() : 0;
    check(`${label}: the ${side} list has exactly the response's sentences`, shown === lines[side].length, `${shown} vs ${lines[side].length}`);
    for (const group of lines[`withheld_${side}`]) {
      const counterpart = side === "out" ? group.target : group.source;
      const note = page.locator(`[data-testid="map-lines-hidden-${side}-${counterpart}-${lineLabel(group)}"]`);
      const text = (await note.count()) > 0 ? (await note.first().textContent()).trim() : "";
      check(`${label}: a hidden ${side} line from ${counterpart} reads its count`, text === `${group.lines} lines hidden · you are not a member of that Bundle`, text);
      const under = (await note.count()) > 0 ? await note.first().locator("xpath=..").locator(".map-sentence").count() : -1;
      check(`${label}: no sentence under that hidden line`, under === 0, String(under));
    }
  }
}

// --- 줄 하나를 Assign에서 열기(줄 끝의 Open in Assign, 주소 ?doc=&unit=) - 문서 id·Unit id·표시 ID는 같은 사람으로 받은 응답에서 읽는다 ---
const lineOpenTestId = (line, side) => `map-line-open-${line.unit_id}-${side === "out" ? line.target : line.source}`;
const readActiveTestId = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? "");
// 줄 끝 단추를 감싼 자리의 opacity가 그 값이 될 때까지 - 숨김은 opacity만 바꾸고 전환이 있다
const lineOpenOpacityBecomes = (page, openId, value) =>
  page
    .waitForFunction(
      ([id, v]) => {
        const el = document.querySelector(`[data-testid="${id}"]`)?.closest(".map-sentence-open");
        return el != null && Number(getComputedStyle(el).opacity) === v;
      },
      [openId, value],
      { timeout: T },
    )
    .then(() => true, () => false);
// 그 Bundle의 Old 문서에서 나가는 첫 줄(자기 Bundle의 줄이라 늘 문장으로 온다)
async function findOwnLine(page, bundleId, user) {
  const map = await readMapApi(page, bundleId, user);
  for (const node of map.nodes.filter((item) => item.kind === "old" && item.bundle_id === bundleId)) {
    const lines = JSON.parse(await readLinesApi(page, bundleId, user, node.id));
    if (lines.out.length > 0) return lines.out[0];
  }
  return null;
}
// Assign이 그 줄을 고른 채 떴나 - 주소에서 값이 떼이고, 오른쪽 칸의 줄 ID에 그 표시 ID가 있고, 그 조각이 Old 칸 안에 보인다
async function checkAssignOnLine(page, bundleId, line, label) {
  await wait(page, "assign-bar");
  await page.waitForURL((url) => url.pathname === `/bundles/${bundleId}/assign` && url.search === "", { timeout: T });
  check(`${label}: the address is left without doc and unit`, true);
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id), line.display_id, { timeout: T });
  check(`${label}: the row with that line is picked`, (await rowIds(page)).includes(line.display_id), await rowIds(page));
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="assign-old"] [data-testid="assign-paper-unit-${id}"]`);
      const frame = el?.closest(".pane-body");
      if (!el || !frame) return false;
      const a = el.getBoundingClientRect();
      const b = frame.getBoundingClientRect();
      return a.height > 0 && a.bottom > b.top && a.top < b.bottom;
    },
    line.unit_id,
    { timeout: T },
  );
  check(`${label}: its piece is inside the Old pane`, true);
}

export async function run() {

await runStep("map: the rail opens Map and the List shows this bundle's references", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "stage-nav-map");
  const order = await page.locator('[data-testid="stage-nav"] .stg').evaluateAll((items) => items.map((item) => item.dataset.stage));
  check("the rail lists Map right before History, History last", order.at(-2) === "map" && order.at(-1) === "history", order.join(","));
  const boxes = await page.locator('[data-testid="stage-nav"] .stg').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  const mapBox = await getBox(page, "stage-nav-map");
  const historyBox = await getBox(page, "stage-nav-history");
  check("Map sits above History and History stays at the bottom", mapBox.y < historyBox.y && historyBox.y >= Math.max(...boxes) - 0.5, JSON.stringify({ map: mapBox.y, history: historyBox.y }));
  await page.locator('[data-testid="stage-nav-map"]').click();
  await page.waitForURL(/\/map$/, { timeout: T });
  await openMapList(page);
  await wait(page, "map-side-summary");
  check("Map is the current step", (await page.locator('[data-testid="stage-nav-map"]').getAttribute("aria-current")) === "page");
  const map = await readMapApi(page, halfBundleId, "qa.member");
  await waitMapRows(page, map.edges.length);
  check("the List has one row per edge of the response", (await countMapRows(page)) === map.edges.length, `${await countMapRows(page)} vs ${map.edges.length}`);
  const selfOld1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  const uvIds = findNodeIds(map, "SOP-ABC-1016");
  const row = page.locator(`[data-testid^="map-row-"][data-source="${selfOld1}"]`).filter({ hasText: "SOP-ABC-1016" });
  check("a row goes From OLD-1 To SOP-ABC-1016", (await row.count()) > 0 && uvIds.includes(await row.first().getAttribute("data-target")));
  const selfId = map.bundles.find((bundle) => bundle.relation === "self").id;
  const bundleOf = new Map(map.nodes.map((node) => [node.id, node.bundle_id]));
  const citesLines = map.edges.filter((edge) => bundleOf.get(edge.source) === selfId).reduce((sum, edge) => sum + edge.lines, 0);
  const summary = await getText(page, "map-side-summary");
  check("the side panel sums the lines this bundle cites", summary.includes(`${citesLines} lines`), `${citesLines} | ${summary}`);
  await takeShot("sop-map-list.png");
});

await runStep("map: filters, search and scope on the List", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await openMapList(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  await waitMapRows(page, map.edges.length);
  const total = map.edges.length;
  const labels = () => mapRows(page).evaluateAll((rows) => rows.map((row) => row.dataset.label));
  await page.locator('[data-testid="map-filter-proposed"]').click();
  await waitMapRows(page, map.edges.filter((edge) => edge.state === "proposed").length);
  const proposed = await labels();
  check("REF? only leaves proposed rows only", proposed.length > 0 && proposed.every((label) => label === "proposed"), proposed.join(","));
  await page.locator('[data-testid="map-filter-proposed"]').click();
  await waitMapRows(page, total);
  check("turning it off brings every row back", (await countMapRows(page)) === total);
  await page.locator('[data-testid="map-filter-moved"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-filter-moved"]')?.getAttribute("aria-pressed") === "false");
  check("hiding Moved to leaves no moved row", (await labels()).every((label) => label !== "moved"));
  await page.locator('[data-testid="map-filter-moved"]').click();
  await waitMapRows(page, total);

  await page.locator('[data-testid="map-search"]').fill("abc-1016");
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid^="map-row-"]')).every((row) => row.textContent.includes("SOP-ABC-1016")), null, { timeout: T });
  check("search keeps only the rows with that number", (await countMapRows(page)) > 0 && (await countMapRows(page)) < total + 1);
  await page.locator('[data-testid="map-search"]').press("Enter");
  await wait(page, "map-side-number");
  check("Enter selects the matching document", (await getText(page, "map-side-number")).trim() === "SOP-ABC-1016", await getText(page, "map-side-number"));
  await page.locator('[data-testid="map-search"]').fill("zz-nothing");
  await wait(page, "map-empty-filtered");
  check("nothing matches and Search all Bundles is offered", await page.locator('[data-testid="map-search-all"]').isVisible());
  await page.locator('[data-testid="map-empty-clear"]').click();
  await waitMapRows(page, total);
  check("Clear filters brings every row back and empties the search", (await page.locator('[data-testid="map-search"]').inputValue()) === "");

  const allResponse = page.waitForResponse((response) => response.url().includes(`/api/bundles/${halfBundleId}/map?scope=all`), { timeout: T });
  await page.locator('[data-testid="map-scope-all"]').click();
  const all = await (await allResponse).json();
  await waitMapRows(page, all.edges.length);
  check("All Bundles asks the server and lists its edges", (await countMapRows(page)) === all.edges.length && all.scope === "all", `${await countMapRows(page)} vs ${all.edges.length}`);
  check("All Bundles is pressed", (await page.locator('[data-testid="map-scope-all"]').getAttribute("aria-pressed")) === "true");

  await page.locator(".map-toolbar .page-title").click();
  await page.keyboard.press("/");
  check("/ moves the focus to the search", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "map-search"));
});

await runStep("map: selecting a document shows what it becomes; a member bundle opens in Assign", {}, async ({ page, takeShot }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  await openMap(page, halfBundleId);
  await openMapList(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const selfOld1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  const uvDoc = map.nodes.find((node) => node.number === "SOP-ABC-1016" && node.bundle_id === uvId);
  const uvBundle = map.bundles.find((bundle) => bundle.id === uvId);
  const row = page.locator(`[data-testid^="map-row-"][data-source="${selfOld1}"][data-target="${uvDoc.id}"]`).first();
  await row.click();
  await wait(page, "map-side-node");
  check("the owner reads Other Bundle · member", (await getText(page, "map-side-owner")).trim() === "Other Bundle · member", await getText(page, "map-side-owner"));
  const bundleText = await getText(page, "map-side-bundle");
  check("the Bundle line has the code and the title", bundleText.includes(uvBundle.code) && bundleText.includes("UV 분광광도계"), bundleText);
  const becomes = await getText(page, "map-side-becomes");
  check("Becomes lists SOP-UV and WI-11, and may still change", becomes.includes("SOP-UV") && becomes.includes("WI-11") && becomes.includes("May change until the Bundle is Review complete"), becomes);
  const docId = uvDoc.id.replace("old:", "");
  const href = await page.locator('[data-testid="map-side-open-assign"]').getAttribute("href");
  check("Open in Assign points at that document in that bundle", href === `/bundles/${uvId}/assign?edit=${docId}`, href);
  await takeShot("sop-map-side.png");
  await page.keyboard.press("Escape");
  await wait(page, "map-side-summary");
  check("Esc clears the selection", (await page.locator('[data-testid="map-side-node"]').count()) === 0);
  await row.click();
  await wait(page, "map-side-node");
  await page.locator('[data-testid="map-side-clear"]').click();
  await wait(page, "map-side-summary");
  check("Clear selection clears it", (await page.locator('[data-testid="map-side-node"]').count()) === 0);
  await row.click();
  await page.locator('[data-testid="map-side-open-assign"]').click();
  await wait(page, "assign-bar");
  await page.waitForURL((url) => url.pathname === `/bundles/${uvId}/assign` && !url.searchParams.has("edit"), { timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-old"] .pane-head')?.textContent?.includes("SOP-ABC-1016"), null, { timeout: T });
  check("Assign opens that document and drops edit from the address", true);
});

await runStep("map: a non-member sees numbers only, on screen and in the response", { devUser: "prod.member" }, async ({ page }) => {
  const docBundleId = await findBundleId(page, "문서 관리");
  const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/bundles/${docBundleId}/map`), { timeout: T });
  await openMap(page, docBundleId);
  const body = await (await responsePromise).text();
  const leaked = ["쪼개기 직후", "분류 절반", "검토 대기", "Operation of UV", "Operation of the QC"].filter((text) => body.includes(text));
  check("the response carries no other bundle's title and no sentence", leaked.length === 0, leaked.join(","));
  await openMapList(page);
  const map = JSON.parse(body);
  // 남의 Bundle의 확인 안 된 줄(REF?)은 오지 않는다 - 응답과 화면 둘 다. 데모 6번은 prod.member 혼자라 1~5번이 모두 summary다
  const summaryIds = new Set(map.bundles.filter((bundle) => bundle.relation === "summary").map((bundle) => bundle.id));
  const bundleOfNode = new Map(map.nodes.map((node) => [node.id, node.bundle_id]));
  check("the seed gives this viewer bundles they are not a member of", summaryIds.size > 0, String(summaryIds.size));
  const hiddenProposed = map.edges.filter((edge) => edge.state === "proposed" && summaryIds.has(bundleOfNode.get(edge.source)));
  check("no unconfirmed line comes from a bundle the viewer is not a member of", hiddenProposed.length === 0, JSON.stringify(hiddenProposed.slice(0, 2)));
  const confirmedFromOthers = map.edges.filter((edge) => edge.state === "confirmed" && summaryIds.has(bundleOfNode.get(edge.source)));
  check("confirmed lines from those bundles do come", confirmedFromOthers.length > 0, String(confirmedFromOthers.length));
  const old1 = findNodeIds(map, "OLD-1").filter((id) => map.nodes.find((node) => node.id === id).bundle_id !== docBundleId);
  const row = page.locator(old1.map((id) => `[data-testid^="map-row-"][data-target="${id}"]`).join(", ")).first();
  await row.click();
  await wait(page, "map-side-node");
  check("the owner reads Other Bundle · summary only", (await getText(page, "map-side-owner")).trim() === "Other Bundle · summary only", await getText(page, "map-side-owner"));
  const bundleText = (await getText(page, "map-side-bundle")).trim();
  check("the Bundle line is the code alone", /^BND-\d+$/.test(bundleText) && !/[가-힣]/.test(bundleText), bundleText);
  check("there is no way into that bundle", (await page.locator('[data-testid="map-side-open-assign"]').count()) === 0);
  check("the panel says why", await page.locator('[data-testid="map-side-not-member"]').isVisible());
});

await runStep("map: a sysadmin who is not a member cannot open it, and losing access clears the screen", { devUser: "dev.admin", allowConsoleErrors: true }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/map`);
  await wait(page, "map-missing");
  const denied = await page.request.get(`${BASE}/api/bundles/${halfBundleId}/map`, { headers: { "X-Dev-User": "dev.admin" } });
  check("a sysadmin who is not a member gets 404", denied.status() === 404, String(denied.status()));
  check("the screen says the bundle is not there", await page.locator('[data-testid="map-missing"]').isVisible());
  // 같은 창에서 작성자로 바꿔 지도를 연 뒤, 구성원에서 빠진 것처럼 다음 읽기를 404로 돌려준다
  await page.evaluate(() => window.localStorage.setItem("sopa.devUser", "qa.member"));
  await openMap(page, halfBundleId);
  await openMapList(page);
  await wait(page, "map-row-0");
  await page.route("**/api/bundles/*/map*", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":{"code":"bundle_not_found"}}' }));
  await page.locator('[data-testid="map-refresh"]').click();
  await wait(page, "map-missing");
  check("Read again after losing access clears the map", (await countMapRows(page)) === 0 && (await page.locator('[data-testid="map-side"]').count()) === 0);
});

await runStep("map: a reviewer on a bundle in review reads the same map", { devUser: "qa.lead" }, async ({ page }) => {
  const reviewId = await findBundleId(page, "검토 대기");
  await openMap(page, reviewId);
  await openMapList(page);
  const map = await readMapApi(page, reviewId, "qa.lead");
  await waitMapRows(page, map.edges.length);
  const controls = ["map-search", "map-scope-linked", "map-scope-all", "map-filter-proposed", "map-filter-moved", "map-refresh"];
  const counts = await Promise.all(controls.map((id) => page.locator(`[data-testid="${id}"]`).count()));
  check("the reviewer has the same toolbar", counts.every((count) => count === 1), counts.join(","));
  check("the List shows the reviewer's edges", (await countMapRows(page)) === map.edges.length, `${await countMapRows(page)} vs ${map.edges.length}`);
  const inputs = await page.locator('[data-testid="map"] input, [data-testid="map"] textarea, [data-testid="map"] select').evaluateAll((els) => els.map((el) => el.dataset.testid));
  check("nothing to save: the only input is the search", inputs.length === 1 && inputs[0] === "map-search", inputs.join(","));
});

await runStep("map: lanes, documents and lines draw, and another bundle's work is graphite", {}, async ({ page, takeShot }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  check("the map is the default view", (await page.locator('[data-testid="map-view-map"]').getAttribute("aria-pressed")) === "true");
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const hasNone = map.nodes.some((node) => node.kind === "num");
  const lanes = await page.locator(".map-lane").count();
  check("one lane per bundle of the response, plus Not in any Bundle when a number has no bundle", lanes === map.bundles.length + (hasNone ? 1 : 0), `${lanes} vs ${map.bundles.length}+${hasNone}`);
  check("one document per node of the response", (await mapNodes(page).count()) === map.nodes.length, `${await mapNodes(page).count()} vs ${map.nodes.length}`);
  check("one line per edge of the response", (await page.locator(".map-edge").count()) === map.edges.length, `${await page.locator(".map-edge").count()} vs ${map.edges.length}`);
  const self = map.bundles.find((bundle) => bundle.relation === "self");
  const selfHead = await page.locator(`[data-testid="map-lane-${halfBundleId}"] .map-lane-head`).innerText();
  check("this bundle's lane names its code", selfHead.includes(self.code) && selfHead.includes("This Bundle"), selfHead);
  const selfNode = page.locator(`.map-node[data-lane="${halfBundleId}"]`).first();
  const uvNode = page.locator(`.map-node[data-lane="${uvId}"]`).first();
  check("the UV bundle has a lane with documents", (await uvNode.count()) === 1);
  const [selfBar, uvBar] = await Promise.all([readStyle(selfNode, "borderLeftColor"), readStyle(uvNode, "borderLeftColor")]);
  check("this bundle's bar and another bundle's bar differ", selfBar !== uvBar, `${selfBar} | ${uvBar}`);
  const peerBg = await resolveColor(page, "--peer-bg");
  check("another bundle's document sits on --peer-bg", (await readStyle(uvNode, "backgroundColor")) === peerBg, `${await readStyle(uvNode, "backgroundColor")} vs ${peerBg}`);
  check("the bar side of a document is square, the other side round", (await readStyle(selfNode, "borderTopLeftRadius")) === "0px" && (await readStyle(selfNode, "borderTopRightRadius")) !== "0px");
  const box = await selfNode.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest(".map-node")?.getAttribute("data-node") ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
  check("a line never covers a document (the document is under its own centre)", hit === (await selfNode.getAttribute("data-node")), String(hit));
  await takeShot("sop-map-drawn.png");
  await page.locator('[data-testid="map-view-list"]').click();
  await wait(page, "map-list");
  check("List shows the table instead of the map", (await page.locator('[data-testid="map-world"]').count()) === 0);
  await page.locator('[data-testid="map-view-map"]').click();
  await waitMapWorld(page);
  check("Map brings the map back", (await page.locator('[data-testid="map-list"]').count()) === 0);
});

await runStep("map: hovering lights the neighbours without a React commit; selecting opens the side panel", {}, async ({ page }) => {
  await installCommitCounter(page);
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const old1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  const near = findNeighbours(map, old1);
  const world = page.locator('[data-testid="map-world"]');
  await mapNode(page, old1).hover();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-world"]')?.hasAttribute("data-hot"), null, { timeout: T });
  const onNodes = await page.locator(".map-node[data-on]").evaluateAll((els) => els.map((el) => el.dataset.node));
  check("hovering OLD-1 marks it and its neighbours", onNodes.includes(old1) && near.nodes.every((id) => onNodes.includes(id)), `${onNodes.length} vs ${near.nodes.length + 1}`);
  check("and exactly the lines that touch it", (await page.locator(".map-edge[data-on]").count()) === near.edges.length, `${await page.locator(".map-edge[data-on]").count()} vs ${near.edges.length}`);
  const far = map.nodes.find((node) => node.id !== old1 && !near.nodes.includes(node.id));
  if (far) {
    await page.waitForFunction((id) => Number(getComputedStyle(document.querySelector(`[data-testid="map-node-${id}"]`)).opacity) < 1, far.id, { timeout: T });
    check("the other documents dim", true);
  }
  // 툴팁이 한 번 떴다 사라지는 커밋을 앞에서 치우고 센다
  await page.locator(".map-toolbar .page-title").hover();
  await page.waitForTimeout(300);
  const centres = await mapNodes(page).evaluateAll((els) => {
    const frame = document.querySelector('[data-testid="map-canvas"]').getBoundingClientRect();
    return els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.top >= frame.top && r.bottom <= frame.bottom && r.left >= frame.left && r.right <= frame.right)
      .slice(0, 20)
      .map((r) => [r.left + r.width / 2, r.top + r.height / 2]);
  });
  for (const [x, y] of centres.slice(0, 3)) await page.mouse.move(x, y);
  await page.locator(".map-toolbar .page-title").hover();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__commits ?? 0);
  for (const [x, y] of centres) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
  }
  const after = await page.evaluate(() => window.__commits ?? 0);
  check("passing over documents commits nothing", centres.length >= 5 && after === before, `${centres.length} documents, ${after - before} commits`);

  await mapNode(page, old1).hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("OLD-1"), null, { timeout: T });
  check("resting on a document shows its full number in a tooltip", true);
  await page.locator(".map-toolbar .page-title").hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]') === null, null, { timeout: T });
  await mapNode(page, old1).focus();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.includes("OLD-1"), null, { timeout: T });
  check("the keyboard focus shows it too", true);

  await mapNode(page, old1).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-node-${id}"]`)?.getAttribute("aria-pressed") === "true", old1, { timeout: T });
  check("clicking selects the document with a 2px accent border", (await readStyle(mapNode(page, old1), "borderTopWidth")) === "2px");
  check("the side panel shows its number", (await getText(page, "map-side-number")).trim() === "OLD-1", await getText(page, "map-side-number"));
  // 고른 것 말고 그려진 마디 하나 - 없으면 이 장면은 아무것도 보지 못한다
  const other = await page.locator(`.map-node:not([data-node="${old1}"])`).first().getAttribute("data-node");
  check("there is a second document to hover", other !== null && other !== old1, String(other));
  await mapNode(page, other).hover();
  await page.waitForTimeout(100);
  const stillOn = await page.locator(".map-node[data-on]").evaluateAll((els) => els.map((el) => el.dataset.node));
  check("hovering another document keeps the selection's emphasis", (await world.getAttribute("data-hot")) === null && stillOn.includes(old1) && near.nodes.every((id) => stillOn.includes(id)), stillOn.join(","));
  await mapNode(page, old1).click();
  await wait(page, "map-side-summary");
  check("clicking it again clears the selection", (await mapNode(page, old1).getAttribute("aria-pressed")) === "false");
  await mapNode(page, old1).click();
  await wait(page, "map-side-node");
  const canvasBox = await getBox(page, "map-canvas");
  await page.mouse.click(canvasBox.x + 6, canvasBox.y + 6);
  await wait(page, "map-side-summary");
  check("clicking the background clears it", (await page.locator('[data-testid="map-side-node"]').count()) === 0);

  await mapNode(page, old1).click();
  await wait(page, "map-side-node");
  const link = page.locator('[data-testid^="map-side-link-"]').first();
  const linkId = (await link.getAttribute("data-testid")).match(/^map-side-link-(.+)-(confirmed|proposed|moved)$/)[1];
  await link.click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-node-${id}"]`)?.getAttribute("aria-pressed") === "true", linkId, { timeout: T });
  await waitInsideCanvas(page, `map-node-${linkId}`);
  check("a side panel link selects that document and brings it into view", true);
});

await runStep("map: a summary-only lane shows a lock and a code, never a name", { devUser: "prod.member" }, async ({ page }) => {
  const docBundleId = await findBundleId(page, "문서 관리");
  await openMap(page, docBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, docBundleId, "prod.member");
  const summary = map.bundles.filter((bundle) => bundle.relation === "summary");
  check("the viewer sees bundles they are not a member of", summary.length > 0, String(summary.length));
  for (const bundle of summary) {
    check(`lane ${bundle.code} has a lock`, (await page.locator(`[data-testid="map-lane-lock-${bundle.id}"]`).count()) === 1);
    const head = (await page.locator(`[data-testid="map-lane-${bundle.id}"] .map-lane-head`).innerText()).replace(/\s+/g, " ").trim();
    const allowed = [bundle.code, "Other Bundle · summary only", `${bundle.document_count} documents`];
    const rest = allowed.reduce((text, part) => text.replace(part, ""), head).trim();
    const statuses = ["In progress", "In review", "Review complete"];
    check(`lane ${bundle.code} says the code, owner, status and count only`, allowed.every((part) => head.includes(part)) && statuses.includes(rest) && !/[가-힣]/.test(head), head);
  }
  await page.locator(`[data-testid="map-lane-lock-${summary[0].id}"]`).hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent === "You are not a member. Numbers, titles and status only.", null, { timeout: T });
  check("the lock explains itself", true);
  // 그려진 확인 전 선(REF?)은 어느 것도 구성원이 아닌 Bundle의 줄기에서 시작하지 않는다 - SVG의 선을 응답의 마디·Bundle 관계로 견준다
  const relationOf = new Map(map.bundles.map((bundle) => [bundle.id, bundle.relation]));
  const bundleOfNode = new Map(map.nodes.map((node) => [node.id, node.bundle_id]));
  const drawnProposed = await page.locator('.map-edge[data-label="proposed"]').evaluateAll((els) => els.map((el) => el.dataset.edge));
  const fromSummary = drawnProposed.filter((key) => relationOf.get(bundleOfNode.get(key.split(">")[0])) === "summary");
  const responseProposed = map.edges.filter((edge) => edge.state === "proposed" && edge.kind === "ref").length;
  check("no drawn REF? line starts in a summary-only lane", fromSummary.length === 0 && drawnProposed.length === responseProposed, `${fromSummary.join(",")} | drawn ${drawnProposed.length} vs response ${responseProposed}`);
});

await runStep("map: collapse a lane; \"more documents\" switches to All Bundles with that lane open", {}, async ({ page }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const edgesBefore = await page.locator(".map-edge").count();
  const toggle = page.locator(`[data-testid="map-lane-toggle-${uvId}"]`);
  await toggle.click();
  await page.waitForFunction((id) => document.querySelectorAll(`.map-node[data-lane="${id}"]`).length === 0, uvId, { timeout: T });
  check("a collapsed lane draws no documents and says so", (await toggle.getAttribute("aria-expanded")) === "false" && (await page.locator(`[data-testid="map-lane-${uvId}"]`).getAttribute("data-collapsed")) !== null);
  const lost = countLaneEdges(map, uvId);
  check("and drops exactly the lines that touched it", (await page.locator(".map-edge").count()) === edgesBefore - lost, `${await page.locator(".map-edge").count()} vs ${edgesBefore} - ${lost}`);
  await toggle.click();
  await page.waitForFunction(([id, n]) => document.querySelectorAll(".map-edge").length === n && document.querySelectorAll(`.map-node[data-lane="${id}"]`).length > 0, [uvId, edgesBefore], { timeout: T });
  check("expanding brings it back", (await toggle.getAttribute("aria-expanded")) === "true");
});

await runStep("map: \"more documents\" opens All Bundles with that lane open and unlinked lanes collapsed", { devUser: "prod.member" }, async ({ page }) => {
  const docBundleId = await findBundleId(page, "문서 관리");
  await openMap(page, docBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, docBundleId, "prod.member");
  const shownOld = (id) => map.nodes.filter((node) => node.kind === "old" && node.bundle_id === id).length;
  const lane = map.bundles.find((bundle) => bundle.relation !== "self" && bundle.document_count > shownOld(bundle.id));
  check("some other lane hides documents in this scope", lane !== undefined);
  if (!lane) return;
  const more = page.locator(`[data-testid="map-lane-more-${lane.id}"]`);
  check("its last row says how many more", (await more.innerText()).trim() === `${lane.document_count - shownOld(lane.id)} more documents`, await more.innerText());
  const allResponse = page.waitForResponse((response) => response.url().includes(`/api/bundles/${docBundleId}/map?scope=all`), { timeout: T });
  await more.click();
  const all = await (await allResponse).json();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-scope-all"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("All Bundles is pressed", true);
  await page.waitForFunction(([id, n]) => document.querySelectorAll(`.map-node[data-lane="${id}"][data-kind="old"]`).length === n, [lane.id, lane.document_count], { timeout: T });
  check("that lane opens with all its Old documents", (await page.locator(`[data-testid="map-lane-${lane.id}"]`).getAttribute("data-collapsed")) === null);
  // 이 Bundle과 선으로 이어지지 않은 줄기는 접힌 채 시작한다(listCollapsedAtStart와 같은 셈)
  const bundleOf = new Map(all.nodes.map((node) => [node.id, node.bundle_id]));
  const linked = new Set();
  for (const edge of all.edges) {
    if (bundleOf.get(edge.source) === docBundleId) linked.add(bundleOf.get(edge.target));
    if (bundleOf.get(edge.target) === docBundleId) linked.add(bundleOf.get(edge.source));
  }
  const unlinked = all.bundles.filter((bundle) => bundle.id !== docBundleId && bundle.id !== lane.id && !linked.has(bundle.id));
  const collapsedFlags = await Promise.all(unlinked.map((bundle) => page.locator(`[data-testid="map-lane-${bundle.id}"]`).getAttribute("data-collapsed")));
  check("lanes not linked to this bundle start collapsed", unlinked.length > 0 && collapsedFlags.every((flag) => flag !== null), unlinked.map((bundle) => bundle.code).join(","));
});

await runStep("map: REF? only and search dim the map", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  await page.locator('[data-testid="map-filter-proposed"]').click();
  await page.waitForFunction((n) => document.querySelectorAll(".map-edge").length === n, map.edges.filter((edge) => edge.state === "proposed").length, { timeout: T });
  const labels = await page.locator(".map-edge").evaluateAll((els) => els.map((el) => el.dataset.label));
  check("REF? only leaves proposed lines only", labels.length > 0 && labels.every((label) => label === "proposed"), labels.join(","));
  await page.locator('[data-testid="map-filter-proposed"]').click();
  await page.waitForFunction((n) => document.querySelectorAll(".map-edge").length === n, map.edges.length, { timeout: T });

  const matchIds = map.nodes.filter((node) => node.number.toLowerCase().includes("abc-1016") || node.title.toLowerCase().includes("abc-1016")).map((node) => node.id);
  check("the response has a document matching abc-1016", matchIds.length > 0);
  // 맞는 문서가 든 줄기를 먼저 접어 둔다 - Enter가 그 줄기를 펴야 한다
  const matchLanes = [...new Set(map.nodes.filter((node) => matchIds.includes(node.id)).map((node) => (node.bundle_id === null ? "none" : String(node.bundle_id))))].filter((key) => key !== String(halfBundleId));
  for (const key of matchLanes) await page.locator(`[data-testid="map-lane-toggle-${key}"]`).click();
  await page.locator('[data-testid="map-search"]').fill("abc-1016");
  await page.waitForFunction(() => document.querySelector('[data-testid="map-world"]')?.hasAttribute("data-find"), null, { timeout: T });
  await page.locator('[data-testid="map-search"]').press("Enter");
  await wait(page, "map-side-number");
  const picked = await page.locator('.map-node[aria-pressed="true"]').getAttribute("data-node");
  check("Enter selects a matching document and opens its collapsed lane", matchIds.includes(picked) && (await getText(page, "map-side-number")).toLowerCase().includes("abc-1016"), String(picked));
  await waitInsideCanvas(page, `map-node-${picked}`);
  const matched = await page.locator(".map-node[data-match]").evaluateAll((els) => els.map((el) => el.dataset.node));
  check("matching documents are marked", matched.length > 0 && matched.every((id) => matchIds.includes(id)) && matched.includes(picked), matched.join(","));
  // 흐림은 전환(opacity)이라 끝나기를 기다려 잰다 - 맞지 않는 마디 전부
  const isRestDimmed = await page.waitForFunction(() => {
    const rest = [...document.querySelectorAll(".map-node:not([data-match])")];
    return rest.length > 0 && rest.every((el) => Number(getComputedStyle(el).opacity) < 1);
  }, null, { timeout: 2000 }).then(() => true, () => false);
  const notDimmed = isRestDimmed ? "" : await page.evaluate(() => {
    const world = document.querySelector('[data-testid="map-world"]');
    const marks = world === null ? "no world" : [...world.attributes].map((attr) => attr.name).filter((name) => name.startsWith("data-")).join(" ");
    const rest = [...document.querySelectorAll(".map-node:not([data-match])")].filter((el) => Number(getComputedStyle(el).opacity) >= 1);
    return `${marks} | ${rest.map((el) => `${el.dataset.node}${el.matches(":hover") ? ":hover" : ""}${el === document.activeElement ? ":focus" : ""}`).join(",")}`;
  });
  check("the rest dims", isRestDimmed, notDimmed);

  // 맞는 것이 없으면 지도 자리에도 Nothing matches와 Clear filters(설계 §6.9) - 흐린 지도만 남기지 않는다
  await page.locator('[data-testid="map-search"]').fill("zz-nothing");
  await wait(page, "map-empty-filtered");
  check("a search with no match says Nothing matches on the map too", (await page.locator('[data-testid="map-world"]').count()) === 0 && (await getText(page, "map-empty-filtered")).includes("Nothing matches"));
  check("and there is nothing to zoom", (await page.locator('[data-testid="map-zoom-in"]').count()) === 0);
  await page.locator('[data-testid="map-empty-clear"]').click();
  await waitMapWorld(page);
  check("Clear filters brings the map back with an empty search", (await page.locator('[data-testid="map-search"]').inputValue()) === "" && (await page.locator('[data-testid="map-zoom-in"]').count()) === 1);
});

await runStep("map: zoom buttons, Ctrl+wheel, Fit all and dragging the background", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  check("the map opens at 100%", (await readZoom(page)) === "100%", await readZoom(page));
  const start = await readSizer(page);
  await pressZoom(page, "map-zoom-in", 2);
  await waitZoom(page, "120%");
  const bigger = await readSizer(page);
  check("two Zoom in clicks make it 120% and the world 1.2 times as wide", Math.abs(bigger.width - start.width * 1.2) <= 1, `${bigger.width} vs ${start.width * 1.2}`);
  await pressZoom(page, "map-zoom-in", 5);
  check("Zoom in stops at 150% and turns off", (await readZoom(page)) === "150%" && (await page.locator('[data-testid="map-zoom-in"]').isDisabled()), await readZoom(page));
  await pressZoom(page, "map-zoom-out", 8);
  await waitZoom(page, "70%");
  check("below 75% the titles hide", (await page.locator('[data-testid="map-world"]').getAttribute("data-far")) !== null && !(await page.locator(".map-node-title").first().isVisible()));
  await pressZoom(page, "map-zoom-out", 5);
  check("Zoom out stops at 50% and turns off", (await readZoom(page)) === "50%" && (await page.locator('[data-testid="map-zoom-out"]').isDisabled()), await readZoom(page));

  await page.locator('[data-testid="map-zoom-fit"]').click();
  await page.waitForTimeout(100);
  const fitted = await readSizer(page);
  const frame = await page.locator('[data-testid="map-canvas"]').evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  check("Fit all fits the world into the frame, or stops at 50%", (fitted.width <= frame.width && fitted.height <= frame.height) || (await readZoom(page)) === "50%", `${JSON.stringify(fitted)} in ${JSON.stringify(frame)} at ${await readZoom(page)}`);

  // Ctrl+휠 - 스크롤이 생기는 배율에서, 칸 위쪽 가운데의 마디 위에서 한 칸 키운다
  while ((await readZoom(page)) !== "130%") {
    const value = Number((await readZoom(page)).replace("%", ""));
    await pressZoom(page, value < 130 ? "map-zoom-in" : "map-zoom-out", 1);
  }
  await page.locator('[data-testid="map-canvas"]').evaluate((el) => {
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  });
  const target = await page.evaluate(() => {
    const frameBox = document.querySelector('[data-testid="map-canvas"]').getBoundingClientRect();
    const centre = frameBox.left + frameBox.width / 2;
    const tops = Array.from(document.querySelectorAll(".map-node"))
      .map((el) => ({ id: el.dataset.node, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.left >= frameBox.left && r.right <= frameBox.right && r.top >= frameBox.top && r.bottom <= frameBox.bottom);
    tops.sort((a, b) => a.r.top - b.r.top || Math.abs(a.r.left + a.r.width / 2 - centre) - Math.abs(b.r.left + b.r.width / 2 - centre));
    const pick = tops[0];
    return pick ? { id: pick.id, x: pick.r.left + pick.r.width / 2, y: pick.r.top + pick.r.height / 2 } : null;
  });
  check("there is a document to zoom on", target !== null);
  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await waitZoom(page, "140%");
    const after = await page.locator(`[data-testid="map-node-${target.id}"]`).boundingBox();
    check("Ctrl+wheel zooms in and keeps the document under the pointer", after.x <= target.x && target.x <= after.x + after.width && after.y <= target.y && target.y <= after.y + after.height, `${JSON.stringify(after)} vs ${target.x},${target.y}`);
  }
  // 지도 밖(옆 칸)의 Ctrl+휠 - 브라우저 확대가 시험 창을 키우지 않게 합성 이벤트로 보낸다
  await page.locator('[data-testid="map-side"]').evaluate((el) => el.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -200, bubbles: true, cancelable: true })));
  await page.waitForTimeout(100);
  check("Ctrl+wheel outside the map leaves the zoom alone", (await readZoom(page)) === "140%", await readZoom(page));

  // 바탕 끌기 - 150%에서 고른 문서를 둔 채 끈다
  await pressZoom(page, "map-zoom-in", 5);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const old1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  await page.locator('[data-testid="map-canvas"]').evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await mapNode(page, old1).click();
  await wait(page, "map-side-node");
  // 첫 두 줄기 사이의 틈, 줄기 머리 아래 - 마디도 단추도 아닌 바탕
  const gap = await page.evaluate(() => {
    const lanes = Array.from(document.querySelectorAll(".map-lane")).map((el) => el.getBoundingClientRect());
    if (lanes.length < 2) return null;
    const x = (lanes[0].right + lanes[1].left) / 2;
    const y = lanes[0].top + 120;
    const hit = document.elementFromPoint(x, y);
    return hit && !hit.closest(".map-node, button, .map-lane-head") ? { x, y } : null;
  });
  check("there is background between two lanes", gap !== null);
  if (gap) {
    const before = await readScroll(page);
    await page.mouse.move(gap.x, gap.y);
    await page.mouse.down();
    await page.mouse.move(gap.x - 60, gap.y - 40, { steps: 4 });
    await page.mouse.move(gap.x - 120, gap.y - 80, { steps: 4 });
    await page.mouse.up();
    const after = await readScroll(page);
    const wantLeft = Math.min(before.left + 120, before.maxLeft);
    const wantTop = Math.min(before.top + 80, before.maxTop);
    check("dragging the background scrolls by the same distance", Math.abs(after.left - wantLeft) <= 1 && Math.abs(after.top - wantTop) <= 1 && after.left > before.left, `${JSON.stringify(after)} want ${wantLeft},${wantTop}`);
    check("letting go does not change the selection", (await mapNode(page, old1).getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="map-side-node"]').count()) === 1);

    // Esc로 거둔 끌기 - 처음 자리로 돌아가고, 한참 뒤에 놓아도 그 click이 고름을 풀지 않는다
    const escSpot = await findBackgroundSpot(page);
    if (escSpot) {
      const escFrom = await readScroll(page);
      await page.mouse.move(escSpot.x, escSpot.y);
      await page.mouse.down();
      await page.mouse.move(escSpot.x - 60, escSpot.y - 40, { steps: 4 });
      await page.keyboard.press("Escape");
      const restored = await readScroll(page);
      await page.waitForTimeout(150);
      await page.mouse.up();
      check("Esc during a drag puts the map back", restored.left === escFrom.left && restored.top === escFrom.top, `${JSON.stringify(restored)} vs ${JSON.stringify(escFrom)}`);
      check("and letting go later keeps the selection", (await mapNode(page, old1).getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="map-side-node"]').count()) === 1);
    }

    // 마디에서 누르고 바탕에서 뗀다 - 스크롤도 고름도 그대로(click은 공통 조상으로 가지만 바탕 누르기가 아니다)
    await page.locator('[data-testid="map-canvas"]').evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    const pressBox = await mapNode(page, old1).boundingBox();
    const releaseSpot = await findBackgroundSpot(page);
    if (pressBox && releaseSpot) {
      const from = await readScroll(page);
      await page.mouse.move(pressBox.x + pressBox.width / 2, pressBox.y + pressBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(releaseSpot.x, releaseSpot.y, { steps: 6 });
      await page.mouse.up();
      const to = await readScroll(page);
      check("a drag that starts on a document does not scroll", to.left === from.left && to.top === from.top, `${JSON.stringify(to)} vs ${JSON.stringify(from)}`);
      check("and releasing it on the background keeps the selection", (await mapNode(page, old1).getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="map-side-node"]').count()) === 1);
    }

    // 3px만 움직이고 놓으면 끌기가 아니다(바탕 누르기라 고름은 풀린다)
    const still = await readScroll(page);
    const spot = await findBackgroundSpot(page);
    if (spot) {
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      await page.mouse.move(spot.x - 2, spot.y - 2);
      await page.mouse.up();
      const small = await readScroll(page);
      check("moving 3px and letting go does not scroll", small.left === still.left && small.top === still.top, `${JSON.stringify(small)} vs ${JSON.stringify(still)}`);
    }
  }
});

await runStep("map: keyboard only", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const selfNodes = await page.locator(`.map-node[data-lane="${halfBundleId}"]`).evaluateAll((els) => els.map((el) => el.dataset.node));
  check("this bundle has at least two documents", selfNodes.length >= 2, String(selfNodes.length));
  await page.locator('[data-testid="map-search"]').focus();
  let entered = null;
  for (let i = 0; i < 30 && entered === null; i++) {
    await page.keyboard.press("Tab");
    entered = await page.evaluate(() => (document.querySelector('[data-testid="map-canvas"]')?.contains(document.activeElement) ? document.activeElement.getAttribute("data-node") ?? document.activeElement.getAttribute("data-testid") : null));
  }
  check("Tab from the search enters the map on this bundle's first document", entered === selfNodes[0], String(entered));
  await page.keyboard.press("Tab");
  check("one more Tab leaves the map: it is a single Tab stop", !(await page.evaluate(() => document.querySelector('[data-testid="map-canvas"]').contains(document.activeElement))), String(await readActive(page)));
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab comes back to the same document", (await readActive(page)) === `map-node-${selfNodes[0]}`, String(await readActive(page)));

  await page.keyboard.press("ArrowDown");
  check("ArrowDown moves to the next document in the lane", (await readActive(page)) === `map-node-${selfNodes[1]}`, String(await readActive(page)));
  await waitActiveInsideCanvas(page);
  await page.keyboard.press("ArrowRight");
  const across = await page.evaluate(() => document.activeElement?.closest(".map-lane")?.getAttribute("data-testid"));
  check("ArrowRight moves to the next lane", across !== null && across !== `map-lane-${halfBundleId}`, String(across));
  await waitActiveInsideCanvas(page);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("End");
  check("End goes to the last document of the lane", (await readActive(page)) === `map-node-${selfNodes.at(-1)}`, String(await readActive(page)));
  await waitActiveInsideCanvas(page);
  await page.keyboard.press("Home");
  check("Home goes to the first", (await readActive(page)) === `map-node-${selfNodes[0]}`, String(await readActive(page)));
  await page.keyboard.press("ArrowUp");
  check("ArrowUp at the top reaches the lane's Collapse button", (await readActive(page)) === `map-lane-toggle-${halfBundleId}`, String(await readActive(page)));
  await page.keyboard.press("ArrowUp");
  check("ArrowUp on the head stays there", (await readActive(page)) === `map-lane-toggle-${halfBundleId}`, String(await readActive(page)));

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await wait(page, "map-side-node");
  const number = (await page.locator(`[data-testid="map-node-${selfNodes[0]}"]`).getAttribute("data-tip")).split("\n")[0];
  check("Enter selects the focused document", (await getText(page, "map-side-number")).trim() === number, `${await getText(page, "map-side-number")} vs ${number}`);
  await page.keyboard.press("Escape");
  await wait(page, "map-side-summary");
  check("Esc clears it", (await page.locator('[data-testid="map-side-node"]').count()) === 0);

  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-lane-toggle-${id}"]`)?.getAttribute("aria-expanded") === "false", halfBundleId, { timeout: T });
  check("Enter on the head collapses the lane", true);
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-lane-toggle-${id}"]`)?.getAttribute("aria-expanded") === "true", halfBundleId, { timeout: T });
  await page.keyboard.press("ArrowDown");

  await page.keyboard.press("-");
  await waitZoom(page, "90%");
  check("- zooms out from the keyboard", true);
  await page.keyboard.press("+");
  await waitZoom(page, "100%");
  await page.keyboard.press("+");
  await waitZoom(page, "110%");
  check("+ zooms in from the keyboard", true);
  // 0은 Fit all - 배율 1.1에서 잰 세계 크기로 Fit all의 값을 셈해 둔다(맞는 값은 늘 100% 이하라 110%와 다르다)
  const fitValue = await page.evaluate(() => {
    const sizer = document.querySelector('[data-testid="map-sizer"]').getBoundingClientRect();
    const frame = document.querySelector('[data-testid="map-canvas"]');
    const fit = Math.min((frame.clientWidth - 32) / (sizer.width / 1.1), (frame.clientHeight - 32) / (sizer.height / 1.1), 1);
    return `${Math.round(Math.max(0.5, Math.floor(fit * 10) / 10) * 100)}%`;
  });
  await page.keyboard.press("0");
  await waitZoom(page, fitValue);
  check("0 fits the map from the keyboard", (await readZoom(page)) === fitValue, `${await readZoom(page)} vs ${fitValue}`);
  await waitActiveInsideCanvas(page);
  check("the focused document stays inside the map", true);

  const zoomBefore = await readZoom(page);
  await page.locator('[data-testid="map-search"]').focus();
  await page.keyboard.type("+0");
  await page.keyboard.press("ArrowDown");
  const activeAfter = await readActive(page);
  // "+0"에 맞는 문서가 없어 늦춘 찾기가 걸리면 지도 대신 "맞는 것 없음"이 뜨고 배율 글자가 사라진다 - 찾기를 비워 지도를 되살린 뒤 배율을 읽는다
  await page.locator('[data-testid="map-search"]').fill("");
  await wait(page, "map-zoom-value");
  check("typing + 0 and arrows in the search does not move the map", (await readZoom(page)) === zoomBefore && activeAfter === "map-search", `${await readZoom(page)} ${activeAfter}`);
});

await runStep("map: the map stays one Tab stop wherever the focus moved, and its edges do not scroll", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  check("the map has at least three lanes", (await page.locator(".map-lane").count()) >= 3, String(await page.locator(".map-lane").count()));
  check("Tab enters the map", (await tabIntoMap(page)) !== null);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const left = await readActive(page);
  const leftLane = await page.evaluate(() => document.activeElement?.closest(".map-lane")?.getAttribute("data-testid"));
  check("two ArrowRights move two lanes over", leftLane !== `map-lane-${halfBundleId}` && left !== null, `${left} in ${leftLane}`);
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab from there leaves the map for the control before it", !(await isFocusInMap(page)) && (await readActive(page)) === "map-refresh", String(await readActive(page)));
  await page.keyboard.press("Tab");
  check("Tab comes back to the document left behind", (await readActive(page)) === left, `${await readActive(page)} vs ${left}`);

  // 고른 마디가 다른 줄기에 있어도 Tab 자리는 마지막으로 있던 곳을 따른다
  await page.keyboard.press("Enter");
  await wait(page, "map-side-node");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const back = await readActive(page);
  check("two ArrowLefts go back to this bundle's lane", back !== left && (await page.evaluate(() => document.activeElement?.closest(".map-lane")?.getAttribute("data-testid"))) === `map-lane-${halfBundleId}`, String(back));
  await page.keyboard.press("Shift+Tab");
  check("with a selection elsewhere, Shift+Tab still leaves the map", !(await isFocusInMap(page)) && (await readActive(page)) === "map-refresh", String(await readActive(page)));
  await page.keyboard.press("Tab");
  check("and Tab returns to where the focus was, not to the selected document", (await readActive(page)) === back, `${await readActive(page)} vs ${back}`);
  await page.keyboard.press("Tab");
  check("Tab from inside leaves the map forward too", !(await isFocusInMap(page)), String(await readActive(page)));
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab from after the map comes back to the same place", (await readActive(page)) === back, String(await readActive(page)));

  // 지도 끝의 화살표는 칸을 스크롤하지 않고 포커스도 그대로다
  let previous = null;
  for (let i = 0; i < 20; i++) {
    const now = await readActive(page);
    if (now === previous) break;
    previous = now;
    await page.keyboard.press("ArrowRight");
  }
  await page.keyboard.press("End");
  await waitActiveInsideCanvas(page);
  const atEnd = await readActive(page);
  const scrollAtEnd = await readScroll(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  const scrollAfter = await readScroll(page);
  check("ArrowRight and ArrowDown at the last document keep the focus", (await readActive(page)) === atEnd, `${await readActive(page)} vs ${atEnd}`);
  check("and do not scroll the map", scrollAfter.left === scrollAtEnd.left && scrollAfter.top === scrollAtEnd.top, `${JSON.stringify(scrollAfter)} vs ${JSON.stringify(scrollAtEnd)}`);
});

await runStep("map: a document picked in the List shows on the map with its lane opened", {}, async ({ page }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  await page.locator(`[data-testid="map-lane-toggle-${uvId}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-lane-${id}"]`)?.hasAttribute("data-collapsed"), uvId, { timeout: T });
  await page.locator('[data-testid="map-view-list"]').click();
  await wait(page, "map-list");
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const uvDoc = map.nodes.find((node) => node.number === "SOP-ABC-1016" && node.bundle_id === uvId);
  await page.locator(`[data-testid^="map-row-"][data-target="${uvDoc.id}"]`).first().click();
  await wait(page, "map-side-node");
  check("the List picks the UV document", (await getText(page, "map-side-number")).trim() === "SOP-ABC-1016", await getText(page, "map-side-number"));
  await page.locator('[data-testid="map-view-map"]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="map-node-${id}"]`)?.getAttribute("aria-pressed") === "true", uvDoc.id, { timeout: T });
  check("switching to Map opens the document's collapsed lane", (await page.locator(`[data-testid="map-lane-${uvId}"]`).getAttribute("data-collapsed")) === null);
  await waitInsideCanvas(page, `map-node-${uvDoc.id}`);
  check("and brings the picked document into view", true);
});

await runStep("map: a member bundle's lines show their sentences, other bundles' lines only their count", {}, async ({ page, takeShot }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const old1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  const memberIds = new Set(map.bundles.filter((bundle) => bundle.relation !== "summary").map((bundle) => bundle.id));
  const bundleOf = new Map(map.nodes.map((node) => [node.id, node.bundle_id]));
  const responsePromise = page.waitForResponse((response) => isLinesResponse(response, old1, "linked"), { timeout: T });
  await mapNode(page, old1).click();
  const response = await responsePromise;
  check("picking a document asks for its lines", response.status() === 200, String(response.status()));
  const body = await readLinesApi(page, halfBundleId, "qa.member", old1);
  const lines = JSON.parse(body);
  check("the screen's response and the API agree for the same user", (await response.text()) === body);
  await waitLinesRead(page);
  check("this document has sentences of its own", lines.out.length > 0, String(lines.out.length));
  check("every sentence comes from a bundle the viewer is a member of", [...lines.out, ...lines.in].every((line) => memberIds.has(line.bundle_id)));
  check("the member UV bundle's line comes with its text", lines.in.some((line) => line.text.startsWith("OLD-1 Operation of the QC centrifuge")), JSON.stringify(lines.in.map((line) => line.display_id)));
  check("the non-member bundle's confirmed line comes as a count", lines.withheld_in.some((group) => !memberIds.has(bundleOf.get(group.source))), JSON.stringify(lines.withheld_in));
  await checkSideMatchesLines(page, lines, "member");

  // 문장 줄은 읽기 전용이다 - 글을 자르지 않고, Tab 자리도 툴팁도 없다(누르는 길은 다음 걸음의 줄 끝 단추)
  const first = page.locator(`[data-testid="${lineTestId(lines.out[0], "out")}"]`);
  check("a sentence shows its text in full, without a tab stop", (await first.textContent()).includes(lines.out[0].text) && (await first.getAttribute("tabindex")) === null);
  check("no sentence is a tab stop", (await page.locator('[data-testid="map-side"] .map-sentence[tabindex]').count()) === 0);
  await takeShot("sop-map-lines.png");

  const allPromise = page.waitForResponse((r) => isLinesResponse(r, old1, "all"), { timeout: T });
  await page.locator('[data-testid="map-scope-all"]').click();
  check("All Bundles asks for the lines again with scope=all", (await allPromise).status() === 200);
});

await runStep("map: a non-member gets counts, not sentences — on screen and in the response", { devUser: "prod.member" }, async ({ page }) => {
  const docBundleId = await findBundleId(page, "문서 관리");
  await openMap(page, docBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, docBundleId, "prod.member");
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const foreign = ["Operation of UV", "Rotor cleaning"];

  // ⓐ 이 Bundle의 확정 참조가 가리키는 남의 Bundle의 OLD-1 - 그 문서의 줄은 남의 것이라 문장으로 오지 않고, 가리키는 줄(이 Bundle 것)만 글과 함께
  const toOld1 = map.edges.find((edge) => nodeById.get(edge.source)?.bundle_id === docBundleId && nodeById.get(edge.target)?.number === "OLD-1" && nodeById.get(edge.target)?.bundle_id !== docBundleId);
  check("the seed gives a confirmed line from this bundle to another bundle's OLD-1", toOld1 !== undefined);
  const promiseA = page.waitForResponse((response) => isLinesResponse(response, toOld1.target, "linked"), { timeout: T });
  await mapNode(page, toOld1.target).click();
  const bodyA = await (await promiseA).text();
  const linesA = JSON.parse(bodyA);
  check("that document's own lines do not come as sentences", linesA.out.length === 0, String(linesA.out.length));
  check("the lines pointing at it are this bundle's, with text", linesA.in.length > 0 && linesA.in.every((line) => line.bundle_id === docBundleId), JSON.stringify(linesA.in.map((line) => line.bundle_id)));
  await waitLinesRead(page);
  await checkSideMatchesLines(page, linesA, "non-member A");
  check("the panel still says this is not a member bundle", await page.locator('[data-testid="map-side-not-member"]').isVisible());

  // ⓑ 이 Bundle의 New 문서로 보낸(Moved to) 남의 Old 문서 - 나가는 줄은 수만
  // ⓐ에서 고른 문서는 빼고 고른다 - 같은 마디를 다시 누르면 고름이 풀려(누름이 토글) 줄 문장을 묻지 않는다(자료에 따라 그 OLD-1이 옮김의 출발일 수 있다)
  const moved = map.edges.find((edge) => edge.kind === "moved" && edge.source !== toOld1.target && nodeById.get(edge.target)?.kind === "target" && nodeById.get(edge.target)?.bundle_id === docBundleId && nodeById.get(edge.source)?.bundle_id !== docBundleId);
  check("the seed gives a moved line from another bundle to this bundle's New document", moved !== undefined);
  const promiseB = page.waitForResponse((response) => isLinesResponse(response, moved.source, "linked"), { timeout: T });
  await mapNode(page, moved.source).click();
  const bodyB = await (await promiseB).text();
  const linesB = JSON.parse(bodyB);
  const hiddenOut = linesB.withheld_out.reduce((sum, group) => sum + group.lines, 0);
  check("the other bundle's outgoing lines come as a count only", linesB.out.length === 0 && hiddenOut >= 1, `${linesB.out.length} sentences, ${hiddenOut} hidden`);
  await waitLinesRead(page);
  check("the screen says the lines are hidden", (await page.locator('[data-testid^="map-lines-hidden-out-"]').count()) > 0);
  check("and shows no sentence under Cites", (await page.locator('[data-testid="map-lines-out"] .map-sentence').count()) === 0);

  const leaked = foreign.filter((text) => bodyA.includes(text) || bodyB.includes(text));
  check("neither response carries another bundle's sentence", leaked.length === 0, leaked.join(","));
  const panel = await getText(page, "map-side");
  check("nor does the side panel", foreign.every((text) => !panel.includes(text)), panel.slice(0, 200));
});

await runStep("map: picking another document before the lines arrive never shows the first one's lines", {}, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const own = map.nodes.filter((node) => node.kind === "old" && node.bundle_id === halfBundleId);
  const a = own.find((node) => node.number === "OLD-1");
  const b = own.find((node) => node.id !== a.id);
  const sentenceIds = (lines) => [...lines.out.map((line) => lineTestId(line, "out")), ...lines.in.map((line) => lineTestId(line, "in"))];
  const idsA = sentenceIds(JSON.parse(await readLinesApi(page, halfBundleId, "qa.member", a.id)));
  const idsB = new Set(sentenceIds(JSON.parse(await readLinesApi(page, halfBundleId, "qa.member", b.id))));
  const onlyA = idsA.filter((id) => !idsB.has(id));
  check("the first document has sentences the second does not", onlyA.length > 0, String(onlyA.length));
  // 첫 요청만 1.5초 늦춘다
  let delayed = false;
  await page.route("**/api/bundles/*/map/lines*", async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });
  await mapNode(page, a.id).click();
  await mapNode(page, b.id).click();
  await page.waitForTimeout(2000);
  const shown = await listSentenceIds(page);
  check("the panel is the second document", (await getText(page, "map-side-number")).trim() === b.number, await getText(page, "map-side-number"));
  check("every sentence on screen belongs to the second document's lines", shown.every((id) => idsB.has(id)), shown.filter((id) => !idsB.has(id)).join(","));
  check("none of the first document's sentences is left", onlyA.every((id) => !shown.includes(id)));
  await page.unroute("**/api/bundles/*/map/lines*");
});

await runStep("map: when the lines cannot be read the map stays", { allowConsoleErrors: true }, async ({ page }) => {
  await openMap(page, halfBundleId);
  await waitMapWorld(page);
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const old1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  await page.route("**/api/bundles/*/map/lines*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await mapNode(page, old1).click();
  await wait(page, "map-lines-error");
  check("a line says the lines could not be read", (await getText(page, "map-lines-error")).includes("Could not read the lines."), await getText(page, "map-lines-error"));
  check("the document facts and the map stay", (await page.locator('[data-testid="map-side-number"]').isVisible()) && (await page.locator('[data-testid="map-world"]').isVisible()));
  check("no sentence is shown", (await listSentenceIds(page)).length === 0);
  await page.unroute("**/api/bundles/*/map/lines*");
  await page.locator('[data-testid="map-lines-retry"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="map-side"] .map-sentence') !== null, null, { timeout: T });
  check("Retry brings the sentences and clears the error", (await page.locator('[data-testid="map-lines-error"]').count()) === 0);
});

await runStep("map: a line opens in Assign with that row picked", {}, async ({ page }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  const map = await readMapApi(page, halfBundleId, "qa.member");
  const old1 = map.nodes.find((node) => node.number === "OLD-1" && node.bundle_id === halfBundleId).id;
  // 지도에서 OLD-1을 골라 그 문서의 줄을 받는다
  const pickOld1 = async () => {
    await openMap(page, halfBundleId);
    await waitMapWorld(page);
    const responsePromise = page.waitForResponse((response) => isLinesResponse(response, old1, "linked"), { timeout: T });
    await mapNode(page, old1).click();
    const lines = JSON.parse(await (await responsePromise).text());
    await waitLinesRead(page);
    return lines;
  };
  const lines = await pickOld1();
  const own = lines.out[0];
  check("OLD-1 has a line of this bundle", own !== undefined && own.bundle_id === halfBundleId, JSON.stringify(own ?? null));
  const openId = lineOpenTestId(own, "out");
  const open = page.locator(`[data-testid="${openId}"]`).first();

  // 단추는 응답에 실린 줄에만 - 문장 줄마다 하나, 가려진 줄에는 없다
  const sentences = await page.locator('[data-testid="map-side"] .map-sentence').count();
  check("every sentence row ends with one Open in Assign", sentences === lines.out.length + lines.in.length && (await page.locator('[data-testid="map-side"] .map-sentence [data-testid^="map-line-open-"]').count()) === sentences, String(sentences));
  check("the only links in the two lists are those", (await page.locator('[data-testid="map-lines-out"] a, [data-testid="map-lines-in"] a').count()) === sentences);
  check("a hidden line has no link", (await page.locator('[data-testid^="map-lines-hidden-"] a').count()) === 0);
  check("the link is the address of that line", (await open.getAttribute("href")) === `/bundles/${halfBundleId}/assign?doc=${own.document_id}&unit=${own.unit_id}`, await open.getAttribute("href"));
  check("it is named Open in Assign", (await open.getAttribute("aria-label")) === "Open in Assign", await open.getAttribute("aria-label"));

  // 줄에 올리거나 Tab으로 닿으면 보인다 - 글을 덮지 않고 제 열에 있다
  check("the button is hidden at rest", await lineOpenOpacityBecomes(page, openId, 0));
  await page.locator(`[data-testid="map-lines-out"] [data-testid="map-side-link-${own.target}-${lineLabel(own)}"]`).focus();
  await page.keyboard.press("Tab");
  check("Tab from the line's row reaches its Open in Assign", (await readActiveTestId(page)) === openId, await readActiveTestId(page));
  check("focus shows it", await lineOpenOpacityBecomes(page, openId, 1));
  await page.locator('[role="tooltip"]', { hasText: "Open in Assign" }).waitFor({ timeout: T });
  check("and its name comes up as a tooltip on focus", true);
  await open.blur();
  check("it hides again without focus", await lineOpenOpacityBecomes(page, openId, 0));
  const row = page.locator(`[data-testid="${lineTestId(own, "out")}"]`).first();
  await row.locator(".map-sentence-text").hover();
  check("hovering the sentence shows it", await lineOpenOpacityBecomes(page, openId, 1));
  const textBox = await row.locator(".map-sentence-text").boundingBox();
  const openBox = await open.boundingBox();
  check("the button sits to the right of the text, not over it", openBox.x >= textBox.x + textBox.width - 0.5, JSON.stringify({ text: textBox, open: openBox }));

  // 누르면 그 Bundle의 Assign이 그 줄을 고른 채 뜬다. 보기(한 단·양 단)는 그대로다 - 새 창이라 기억된 것이 없어 양 단
  await open.click();
  await checkAssignOnLine(page, halfBundleId, own, "own line");
  check("the view stays two documents", (await page.locator('[data-testid="assign-new"]').count()) > 0 && (await page.locator(".assign-panes").getAttribute("data-single")) === null);

  // 구성원인 다른 Bundle(UV)의 줄 - 그 Bundle의 Assign이 뜬다
  const again = await pickOld1();
  const peer = again.in.find((line) => line.bundle_id === uvId);
  check("a line of the member UV bundle points at OLD-1", peer !== undefined, JSON.stringify(again.in.map((line) => line.bundle_id)));
  const peerOpen = page.locator(`[data-testid="${lineOpenTestId(peer, "in")}"]`).first();
  check("its link goes to the bundle that holds the line", (await peerOpen.getAttribute("href")) === `/bundles/${uvId}/assign?doc=${peer.document_id}&unit=${peer.unit_id}`, await peerOpen.getAttribute("href"));
  await peerOpen.click();
  await checkAssignOnLine(page, uvId, peer, "member bundle's line");

  // 검토자(읽기 전용)도 같은 주소로 그 줄을 고른다 - 확정 단추는 눌리지 않는다
  await page.evaluate(() => window.localStorage.setItem("sopa.devUser", "qa.lead"));
  const reviewId = await findBundleId(page, "검토 대기");
  const reviewLine = await findOwnLine(page, reviewId, "qa.lead");
  check("the bundle in review has a line to open", reviewLine !== null);
  await page.goto(`${BASE}/bundles/${reviewId}/assign?doc=${reviewLine.document_id}&unit=${reviewLine.unit_id}`);
  await checkAssignOnLine(page, reviewId, reviewLine, "reviewer");
  const primary = page.locator('[data-testid="assign-primary"]');
  check("the reviewer cannot confirm", (await primary.count()) === 0 || (await primary.first().isDisabled()));
});

await runStep("map: an address for a line that is gone opens the document and says so", {}, async ({ page }) => {
  const uvId = await findBundleId(page, "UV 분광광도계");
  const readOldDocs = async (bundleId) => (await (await page.request.get(`${BASE}/api/bundles/${bundleId}/documents`, { headers: { "X-Dev-User": "qa.member" } })).json()).filter((doc) => doc.side === "old" && doc.status === "ready");
  const oldDocs = await readOldDocs(halfBundleId);
  const [first, second = first, third = first] = oldDocs;
  const foreignDoc = (await readOldDocs(uvId))[0];
  const assignPath = `/bundles/${halfBundleId}/assign`;
  const waitClean = () => page.waitForURL((url) => url.pathname === assignPath && url.search === "", { timeout: T });
  const waitOldDoc = (doc) => page.waitForFunction((label) => document.querySelector('[data-testid="assign-old"] .pane-head')?.textContent?.includes(label), doc.doc_code || doc.file_name, { timeout: T });
  const goneToast = () => page.locator('[data-testid="toast-ok"]', { hasText: "That line has changed. The document is open instead." });
  const countRowIds = () => page.locator('[data-testid="assign-row-id"]').count();

  // 사라진 Unit - 문서만 열리고 알림이 뜬다. 보기는 바꾸지 않는다
  await page.goto(`${BASE}${assignPath}?doc=${second.id}&unit=2147483000`);
  await goneToast().first().waitFor({ timeout: T });
  check("a unit that is not there says the line has changed", true);
  await waitOldDoc(second);
  await waitClean();
  check("the document is open, with no row picked and both documents on screen", (await countRowIds()) === 0 && (await page.locator('[data-testid="assign-new"]').count()) > 0);

  // 다른 문서의 Unit도 같다
  const ownLine = await findOwnLine(page, halfBundleId, "qa.member");
  const otherDoc = oldDocs.find((doc) => doc.id !== ownLine?.document_id);
  if (ownLine && otherDoc) {
    await page.goto(`${BASE}${assignPath}?doc=${otherDoc.id}&unit=${ownLine.unit_id}`);
    await goneToast().first().waitFor({ timeout: T });
    await waitOldDoc(otherDoc);
    await waitClean();
    check("a unit of another document opens the named document only", (await countRowIds()) === 0);
  }

  // 이 Bundle의 Old 문서가 아닌 값 - 알림 없이 평소의 Assign이고 값만 떼인다
  for (const [label, query] of [["another bundle's document", `doc=${foreignDoc.id}&unit=1`], ["letters", "doc=abc&unit=x"]]) {
    await page.goto(`${BASE}${assignPath}?${query}`);
    await wait(page, "assign-bar");
    await waitClean();
    await waitOldDoc(first);
    check(`${label}: the usual Assign, no notice, no row picked`, (await goneToast().count()) === 0 && (await countRowIds()) === 0, query);
  }

  // edit이 같이 오면 edit이 이긴다 - 그 문서가 한 단으로 열린다(지금 동작 그대로)
  await page.goto(`${BASE}${assignPath}?edit=${third.id}&doc=${second.id}&unit=1`);
  await waitClean();
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  await waitOldDoc(third);
  check("with edit in the address, edit wins: that document opens wide and nothing says a line changed", (await goneToast().count()) === 0 && (await countRowIds()) === 0);
});
}
