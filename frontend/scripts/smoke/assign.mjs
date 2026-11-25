// SOP smoke steps for the assign screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findBackendPython,
  SCRIPT_DIR,
  BASE,
  SHOT_DIR,
  T,
  PREPARE_STEP,
  VIEWPORT,
  check,
  runStep,
  wait,
  getText,
  installCommitCounter,
  dragThrough,
  halfBundleId,
  freshBundleId,
  WI_LIST_KEY,
  rowIds,
  TOC_LINES,
  findTocBundle,
} from "./common.mjs";

async function showLinkCardDoc(page) {
  const code = await page.locator('.dest-card[data-tone="link"] .dest-card-title b').first().innerText({ timeout: 500 }).catch(() => null);
  const picker = page.locator('[data-testid="assign-new-doc"]');
  if (!code || (await picker.count()) === 0 || (await picker.innerText()).includes(code)) return;
  await picker.click();
  await page.locator('[data-testid^="assign-new-doc-option-"]', { hasText: code }).first().click();
  // 그 문서의 후보 점선이 그려질 때까지 - 기다리지 않으면 다음 줄로 넘어가 예전(New 칸이 줄을 따라가던 때)과 다른 줄을 잇는다
  await page.locator('[data-testid="assign-new"] .new-line[data-state="candidate"]').first().waitFor({ timeout: 3000 }).catch(() => {});
}
// 두 문서 틀(.assign-panes)에 닿은 click 수(문서의 거품 단계) - 놓은 자리의 click을 끌기 층이 삼키면 0이다.
// 두 조각에 걸친 누름·뗌의 click은 두 조각의 공통 조상으로 가서 고른 줄을 바꾸지 않으므로 고른 줄만으로는 삼켜졌는지 보이지 않는다
async function installPanesClickCounter(page) {
  await page.evaluate(() => {
    window.__panesClicks = 0;
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".assign-panes")) window.__panesClicks += 1;
    });
  });
}
const takesLines = (section) => section.kind !== "group" && section.kind !== "auto_list";

// Assign(v0.10.0) - Old 원문 조각이 곧 목록이다. 줄은 ↑↓·J/K로 옮기고, 지금 줄은 오른쪽 머리(assign-row-id·assign-row-status)로 읽는다
// 상태 칩은 대문자를 CSS(text-transform)로만 그린다 - innerText는 대문자가 되니 DOM 글자(textContent)로 읽는다
const rowStatus = async (page) => ((await page.locator('[data-testid="assign-row-status"]').first().textContent()) ?? "").trim();
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
// 그림 탭(시안 2 D3) - 본문의 그림은 그림 탭의 카드로만 보인다. 그 문서를 Old 칸에 띄운 뒤 탭을 연다(J/K는 그 탭 안 카드 차례로 돈다)
async function openFigures(page, docId) {
  const docSelect = page.locator('[data-testid="assign-old-doc"]');
  if (docId !== undefined && (await docSelect.count()) > 0) {
    await docSelect.click();
    await page.locator(`[data-testid="assign-old-doc-option-${docId}"]`).click();
  }
  await page.locator('[data-testid="assign-tab-figures"]').click();
  await page.locator('[data-testid="assign-tab-figures"][aria-selected="true"]').waitFor({ timeout: T });
}
// 칸 줄을 고른다 - 나무는 칸마다 칸 제목 자리(assign-tree-place-heading:…)를 칸 줄 바로 앞에 두므로 그것은 건너뛴다(칸 제목은 고쳐 쓰기가 없다)
async function pickFirstPlace(page) {
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator('[data-testid^="assign-tree-p"]').first().click();
  await page.locator('[data-testid^="assign-tree-place-"]:not([data-testid^="assign-tree-place-heading:"]):not([disabled])').first().click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
}
const progressDone = async (page) => Number((await getText(page, "assign-progress")).split("/")[0]);
async function findTemplateDoc(page, docType) {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  for (const doc of (await getJson("/tobe")).docs.filter((item) => item.entrance === "assign" && item.doc_type === docType)) {
    const composed = await getJson(`/outputs/c/docs/${doc.id}?lang=en`);
    const items = composed.sections.flatMap((section) => section.items);
    const pair = items.find((item) => item.lang === "en" && item.meaning_key !== null && items.some((other) => other.lang === "ko" && other.meaning_key === item.meaning_key));
    if (pair) return { doc, composed, items, pair, partner: items.find((other) => other.lang === "ko" && other.meaning_key === pair.meaning_key) };
  }
  return null;
}

async function openTemplateView(page, docId) {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
  await page.locator('[data-testid="assign-new-view-template"]').click();
  await wait(page, "assign-new-tpl");
}
async function openTemplateDrag(page) {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  const unit = (await getJson("/units?limit=1000")).items.find((item) => item.kind === "sentence" && item.status === "unassigned" && item.decision.disposition === "unassigned" && item.pair_id === null);
  check("the bundle has an SOP to write and a loose Old sentence", Boolean(sop && unit));
  if (!sop || !unit) return null;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.unit_id}"]`);
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  if ((await piece.count()) === 0) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${unit.document_id}"]`).click();
  }
  await piece.waitFor({ timeout: T });
  const pointInUnit = async () => {
    await piece.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${unit.unit_id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  // 끌 줄을 먼저 골라 결정 칸이 보이게 하고, 그 줄의 New 칸 문서를 SOP로 바꾼 뒤 템플릿 보기
  const from = await pointInUnit();
  await page.mouse.click(from.x, from.y);
  await wait(page, "assign-new");
  if ((await page.locator('[data-testid="assign-new"]').getAttribute("data-doc")) !== String(sop.id)) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
  }
  await page.locator('[data-testid="assign-new-view-template"]').click();
  await wait(page, "assign-new-tpl");
  // 템플릿 자리 한 점 - 칸 가운데로 스크롤하고 왼쪽 가까이(top · bottom은 그 자리의 위·아래 끝 가까이)
  const pointInSpot = async (testId, where = "middle") => {
    const spot = page.locator(`[data-testid="${testId}"]`).first();
    await spot.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const box = await spot.boundingBox();
    const y = where === "bottom" ? box.y + box.height - 2 : where === "top" ? box.y + 2 : box.y + box.height / 2;
    return { x: box.x + Math.min(40, box.width / 2), y };
  };
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
  }));
  const composed = await getJson(`/outputs/c/docs/${sop.id}?lang=en`);
  // 5장 범주(N/A 아님) - 템플릿 보기의 범주 행
  const category = composed.sections.find((section) => section.location_key.startsWith("general_requirements.") && section.na_reason === null);
  check("the SOP has a chapter-5 category", Boolean(category));
  return { getJson, sop, unit, pointInUnit, pointInSpot, readCard, composed, category };
}
const TOC_AFTER_TEXT = "관련 서식";

const readAllCount = async (page) => Number(await page.locator('[data-testid="assign-filter-all"] .schip-n').innerText());

// 목차 블록 머리가 그 줄 수를 말할 때까지 - 편집 뒤 보기를 다시 받는다
async function waitTocLines(page, n) {
  await page.waitForFunction(
    (expected) => [...document.querySelectorAll('[data-testid^="assign-paper-noise-head-"]')].some((el) => (el.textContent ?? "").includes(`${expected} lines`)),
    n,
    { timeout: T },
  );
}

// --- 띠 표 → 제목 줄(MD 1 F4) - 시드 7번 묶음 본문의 띠 표 "7.4 | | 필터 교체 (Filter change)"는 올리자마자 제목 줄 하나다.
// 번호는 번호 칸에만 있고 글은 제목뿐이다. Shape의 Back to band table이 표 한 줄로 되돌리고 Undo가 다시 제목 줄로 만든다(시드 그대로 둔다)
const BAND_NUMBER = "7.4";
const BAND_TITLE = "필터 교체 (Filter change)";

// --- 표 안 표(MD 1 F2) - 시드 8번 묶음 "SYNTHETIC 8 표 안 표": 작업 표 하나(표 1)의 첫 행 칸에 띠 표 7.1(표 2), "점검 항목" 칸의 두 문단 사이에
// 값 표(표 3), "권한 표" 칸에 권한 표(표 4). 바깥을 벗기면 안쪽 표는 제 칸 글 사이 자리에 다시 표로, 띠 표는 제목 줄. 단계마다 끝에 문서 편집을 되돌려 시드를 그대로 둔다 ---
const NESTED_TITLE = "SYNTHETIC 8 표 안 표";
const NESTED_CHECK = ["전원 표시등이 켜졌는지 본다.", "차압계 값을 기록한다."];

async function openNestedBundle(page) {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === NESTED_TITLE) ?? null;
  if (!bundle) return null;
  const api = `${BASE}/api/bundles/${bundle.id}`;
  const docs = await (await page.request.get(`${api}/documents`, { headers })).json();
  const docId = docs[0].id;
  const readView = async () => (await page.request.get(`${api}/documents/${docId}/view`, { headers })).json();
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView();
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const edit = async (op) => {
    const revision = (await readView()).document.revision;
    return page.request.post(`${api}/documents/${docId}/edits`, { headers, data: { revision, confirm: false, op } });
  };
  // 문서 편집 기록을 n번 되돌린다 - 시드를 처음 그대로 둔다
  const undo = async (times) => {
    for (let step = 0; step < times; step += 1) {
      const revision = (await readView()).document.revision;
      const response = await page.request.post(`${api}/documents/${docId}/edits/undo`, { headers, data: { revision } });
      check(`document edit undo ${step + 1} goes through`, response.ok(), String(response.status()));
    }
  };
  return { bundle, readView, waitView, edit, undo, headers, api };
}

const readTableUnit = (view, table) => view.units.find((unit) => unit.kind === "table" && unit.table_id === table.id);
const readTop = async (page, unitId) => (await page.locator(`[data-testid="assign-paper-piece-${unitId}"]`).boundingBox())?.y ?? Number.NaN;
// 풀기 전환(useUnwrapMotion)이 끝날 때까지 - 펼치는 동안 줄은 transform으로 옛 자리(표 칸 안)에 붙들려 있어 boundingBox가 옛 자리를 잰다
const waitForOldMotion = (page) =>
  page.waitForFunction(() => (document.querySelector('[data-testid="assign-old"]')?.getAnimations({ subtree: true }) ?? []).every((animation) => animation.playState !== "running"), null, { timeout: T });
// 다시 표로 묶으면 화면은 그 편집이 만든 새 Unit(새 표 줄)을 따라가 고르고 그 관계 묶음을 받는다(시안 1 D1 규칙 3). 서버 보기가 바뀐 것만 보고
// API로 문서 편집을 되돌리면 화면의 그 받기와 엇갈려 새 Unit이 먼저 지워지고 받기가 404(콘솔 오류)가 된다 - 되돌리기 전에 그 응답까지 기다린다.
// 누르기 전에 부르고, 돌려준 함수에 그 편집으로 새로 생긴 Unit id들을 넘긴다(받았으면 true)
function watchGroupLoads(page) {
  const loaded = new Set();
  const onResponse = (response) => {
    const match = /\/groups\/by-unit\/(\d+)$/.exec(new URL(response.url()).pathname);
    if (match && response.request().method() === "GET" && response.ok()) loaded.add(Number(match[1]));
  };
  page.on("response", onResponse);
  return async (unitIds) => {
    const isLoaded = () => unitIds.some((id) => loaded.has(id));
    for (let tries = 0; tries < 60 && unitIds.length > 0 && !isLoaded(); tries += 1) await page.waitForTimeout(250);
    page.off("response", onResponse);
    return isLoaded();
  };
}

// Space 미리보기(1.2.0 피드백 7번, MD 2 S2) - 누르는 동안 아래 시트에 양 단이면 지금 Old 문서의 Excel A, 한 단이면 그 문서의 문단 Excel(시안 2 D4),
// 짧게 탁이면 열어 둠, Esc · 탁으로 닫힘, 끌고 떼면 닫힘. view("one" | "two")를 주면 그 보기로 놓고 시작한다(보기는 다음 단계까지 기억된다)
async function openFirstAssign(page, view = null) {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const firstId = Number((await page.locator('[data-testid^="bundles-row-"]').first().getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${firstId}/assign`);
  await wait(page, "assign-bar");
  if (view !== null) await setPaneView(page, view);
  // 단축키가 듣도록 포커스를 화면 바탕에 두고 줄 하나를 고른다
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press("j");
}

// 한 단("one") · 양 단("two") 보기로 놓는다 - 이미 그 보기면 그대로. 칸 사이 가름대가 사라지거나 생길 때까지 기다린다
async function setPaneView(page, view) {
  const button = page.locator(`[data-testid="assign-view-${view}"]`);
  await button.waitFor({ timeout: T });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await page.locator('[data-testid="assign-divider"]').waitFor({ state: view === "one" ? "detached" : "attached", timeout: T });
  await page.locator(".assign-panes:not([data-motion])").waitFor({ timeout: T });
}

// 받은 xlsx 첫 시트의 줄마다 칸 글(빈 칸은 "") - backend의 openpyxl로 읽는다
function readXlsxRows(buffer) {
  const backend = resolve(SCRIPT_DIR, "../../../backend");
  const code = "import io, json, sys; from openpyxl import load_workbook; ws = load_workbook(io.BytesIO(sys.stdin.buffer.read())).worksheets[0]; print(json.dumps([['' if v is None else str(v) for v in row] for row in ws.iter_rows(values_only=True)], ensure_ascii=False))";
  return JSON.parse(String(execFileSync(findBackendPython(), ["-I", "-c", code], { cwd: backend, input: buffer })));
}

const PARAGRAPH_HEADERS = ["Section No.", "Text", "Lang", "Number note", "Remark"]; // 문단 Excel 머리 줄(backend paragraph_excel.PARAGRAPH_HEADERS)

// 제목 → 문장(F8b) - 시드 문서에는 조항형 옛 SOP가 없어 진짜 제목 하나를 사람이 문장으로 바꿔 본다(우클릭 Turn into sentences).
// 바꾼 줄 위에 묶음 머리 "[Heading → sentence] …"가 붙고, 고르면 Shape 맨 아래에 Back to heading이 있다. 편집 한 번이라 Undo 한 번씩 돌아온다.
// 끝에 두 편집을 모두 되돌려 시드 묶음을 처음 그대로 둔다(되돌리기는 원래 Unit id로 되살린다)
const findHeadingOnScreen = async (page, readView, docs) => {
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const headings = view.units.filter((item) => item.kind === "heading" && !item.noise_kind && item.group_unit_id === null && (item.lang === "ko" || item.lang === "en") && item.status === "unassigned");
    if (headings.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator('[data-testid="assign-old"]').waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of headings) {
      if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) > 0) return { doc: candidate, unit: item };
    }
  }
  return { doc: null, unit: null };
};

// 표 벗기기(MD 1 F1) - 통째인 표를 Shape의 Unwrap table로 벗기면 표 선 · TABLE 머리가 걷히고 칸 글이 보통 문장 줄(칸마다 · 칸 안 문단마다)이 된다.
// 벗긴 줄 묶음은 왼쪽 세로선 하나와 머리 "↺ Back to table" 하나만 갖는다. 편집 한 번이라 Undo 한 번에 표로 돌아온다(시드 묶음을 처음 그대로 둔다)
const findTableOnScreen = async (page, readView, docs) => {
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const tables = view.units.filter((item) => item.kind === "table" && item.status === "unassigned" && !view.tables.find((table) => table.id === item.table_id)?.is_layout);
    if (tables.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator('[data-testid="assign-old"]').waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of tables) {
      if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) > 0) return { doc: candidate, unit: item };
    }
  }
  return { doc: null, unit: null };
};

// 짝 없는(줄 하나가 Unit 하나인) 미배정 문장이 가장 많은 Old 문서를 Old 칸에 연다 - 첫 문서는 한/영 짝이 다 서 있을 수 있다
// (Reference 절 아래 참조 줄이 REF가 되며 OLD-1의 남은 문장도 짝이 됐다, 요청서 12)
async function openLooseOldDoc(page, bundleId) {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${bundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const units = new Map((await getJson("/units?limit=1000")).items.map((unit) => [unit.unit_id, unit]));
  let best = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const loose = view.units.filter((unit) => units.get(unit.id)?.kind === "sentence" && units.get(unit.id)?.status === "unassigned" && units.get(unit.id)?.pair_id === null).length;
    if (best === null || loose > best.loose) best = { docId: doc.id, loose };
  }
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${best.docId}"]`).click();
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
}

// 대응 표의 한/영 짝(MD 1 F8a) - 시드 9번 묶음은 한/영 따로 문서 하나(표 1 한글 작업 표 · 표 2 한글 값 표 · 표 3 영어 작업 표 · 표 4 영어 값 표, 값 표는 행 수가 다르다).
// 표는 창 없이 하나씩 벗기고(함께 벗기기는 걷었다 - 요청서 8번), 대응 표도 벗기면 같은 행끼리 한/영 짝이 선다(시드 그대로 둔다)
const PAIR_TABLES_TITLE = "SYNTHETIC 9 한/영 따로 표";

// 클릭 배치(MD 2 S3) - 아직 쓰지 않은 SOP의 자리(번호 줄 사이 틈 · 범주 · 빈 칸)를 눌러 고르기만 하고 ↵로 확정한다. 저장 요청의 position까지 본다.
// 준비: 번호를 세는 칸에 Old 줄 A · B를 API로 놓고, 화면에서 나머지 줄을 고른다. 끝에 모든 줄의 배정을 지운다
async function prepareClickPlace(page, needed) {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readUnits = async () => (await getJson("/units?limit=1000")).items;
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  if (!sop) return { error: "no SOP to write in Assign" };
  const readSections = async () => (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections;
  // 미배정·짝 없는 본문 문장이 가장 많은 Old 문서 - 모자라면 묶음 배정을 비우고 다시 고른다(이 뒤의 단계는 이 묶음의 배정을 읽지 않는다)
  const findLoose = async () => {
    const loose = (await readUnits()).filter((unit) => unit.kind === "sentence" && unit.status === "unassigned" && unit.decision.disposition === "unassigned" && unit.pair_id === null);
    const byDoc = new Map();
    for (const unit of loose) byDoc.set(unit.document_id, [...(byDoc.get(unit.document_id) ?? []), unit]);
    return [...byDoc.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  };
  let loose = await findLoose();
  if (loose.length < needed + 4) {
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision } });
    loose = await findLoose();
  }
  const sections = await readSections();
  const isLeaf = (key) => !sections.some((section) => section.location_key.startsWith(`${key}.`));
  const isOpen = (section) => takesLines(section) && section.na_reason === null && isLeaf(section.location_key);
  const counted = sections.find((section) => isOpen(section) && section.counts_lines);
  if (!counted) return { error: "no numbered section that takes lines" };
  const saveTo = async (unit, slotKey) => {
    const response = await page.request.post(`${api}/groups/save`, {
      headers,
      data: {
        action: "confirm",
        hold_reason: "",
        units: [{ unit_id: unit.unit_id, revision: unit.decision.revision, disposition: "assigned", move_target_code: "", reason: "" }],
        targets: [{ key: `u${unit.unit_id}`, target_doc_id: sop.id, slot_key: slotKey, kind: "sentence", lang: unit.lang, text: unit.text.trim(), source_unit_ids: [unit.unit_id] }],
        removed_target_ids: [],
      },
    });
    return response.ok();
  };
  // 화면이 보이는 것에서 고른다 - 앞 단계가 남긴 거르기(상태 탭)는 All로, Old 문서는 그 줄의 문서로 연다(앞 단계가 남긴 고름 · 연 문서에 기대지 않는다)
  const pieceOf = (unit) => page.locator(`[data-testid="assign-paper-piece-${unit.unit_id}"]`);
  const showOld = async (unit) => {
    const all = page.locator('[data-testid="assign-filter-all"]');
    if ((await all.count()) > 0 && (await all.getAttribute("aria-selected")) !== "true") await all.click();
    if ((await pieceOf(unit).count()) === 0 && (await page.locator('[data-testid="assign-old-doc"]').count()) > 0) {
      await page.locator('[data-testid="assign-old-doc"]').click();
      await page.locator(`[data-testid="assign-old-doc-option-${unit.document_id}"]`).click();
    }
    const found = await pieceOf(unit).first().waitFor({ state: "attached", timeout: T }).then(() => true, () => false);
    if (found) await pieceOf(unit).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    return found;
  };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  if (loose[0]) await showOld(loose[0]);
  // 본문 용지에 조각이 보이는 것만(머리말·꼬리말 탭의 문장은 뺀다)
  const shown = [];
  for (const unit of loose) if ((await pieceOf(unit).count()) > 0) shown.push(unit);
  if (shown.length < needed + 2) return { error: `only ${shown.length} loose sentences on one Old paper` };
  const [unitA, unitB, ...rest] = shown;
  if (!(await saveTo(unitA, counted.location_key)) || !(await saveTo(unitB, counted.location_key))) return { error: "could not place A and B" };
  const placed = (await readSections()).find((section) => section.location_key === counted.location_key).items;
  const itemOf = (unit) => placed.find((item) => item.source_unit_ids.includes(unit.unit_id));
  let saveRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/groups/save") && request.method() === "POST") saveRequests += 1;
  });
  await page.reload();
  await wait(page, "assign-bar");
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  // A · B는 이제 확정이라 거르기에 따라 접힐 수 있다 - 화면에서 고를 첫 줄로 기다린다
  if (!(await showOld(rest[0]))) return { error: `the Old piece of ${rest[0].display_id} does not show after reload` };
  return {
    sop,
    sections,
    counted,
    itemA: itemOf(unitA),
    itemB: itemOf(unitB),
    units: rest.slice(0, needed),
    saveCount: () => saveRequests,
    // 줄을 고르고 New 칸을 그 SOP로
    pickOld: async (unit) => {
      // 앞 확정이 다음 줄로 넘어가며 다른 Old 문서를 열었을 수 있다
      await showOld(unit);
      const point = await page.locator(`[data-testid="assign-paper-unit-${unit.unit_id}"]`).first().evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        const rect = el.getClientRects()[0];
        return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unit.unit_id, { timeout: T });
      await wait(page, "assign-new");
      if ((await page.locator('[data-testid="assign-new"]').getAttribute("data-doc")) !== String(sop.id)) {
        await page.locator('[data-testid="assign-new-doc"]').click();
        await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
      }
    },
    // ↵로 확정하고 그 줄(unit)의 저장 항목을 돌려준다
    confirmWithEnter: async (unit) => {
      const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
      const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
      // 자리를 마우스로 누르면 포커스가 Old 용지로 돌아오고 ↵는 어디서든 확정 단추다(B1-R1) - 고른 자리가 확정 단추에 서기를 기다린다
      await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
      await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T });
      await page.keyboard.press("Enter");
      const body = (await request).postDataJSON();
      await response;
      await page.waitForLoadState("networkidle");
      return body.targets.find((target) => target.source_unit_ids?.includes(unit.unit_id));
    },
    cleanUp: async () => {
      for (const unit of [unitA, unitB, ...rest.slice(0, needed)]) {
        const now = (await readUnits()).find((item) => item.unit_id === unit.unit_id);
        if (now && now.decision.disposition !== "unassigned") await page.request.post(`${api}/decisions/clear`, { headers, data: { unit_id: unit.unit_id, revision: now.decision.revision } });
      }
      const left = new Map((await readUnits()).map((unit) => [unit.unit_id, unit.status]));
      return [unitA, unitB, ...rest.slice(0, needed)].every((unit) => left.get(unit.unit_id) === "unassigned");
    },
  };
}

export async function run() {

await runStep("assign: legend first, place, delete without a reason, edit, clear, bulk", { drafting: true, allowConsoleErrors: true }, async ({ page, takeShot }) => {
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
  // 삭제의 사유는 선택이다(요청서 4번) - 빈 Remark 자리에 기록될 말(Deleted)이 보이고, 확정은 Remark 창 없이 바로 된다
  await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  check("an empty Remark shows what delete records", ((await page.locator('[data-testid="assign-reason"]').textContent()) ?? "").trim() === "Deleted", await page.locator('[data-testid="assign-reason"]').textContent());
  await page.locator('[data-testid="assign-primary"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 2, before, { timeout: T });
  check("delete without a reason confirms without the Remark window", (await page.locator('[data-testid="assign-remark-modal"]').count()) === 0);
  // 고쳐 쓰기 - 변경 종류는 고르지 않고 글 비교로 "=" / "Modified"가 보인다(설계 2026-11-20-change-type-two D7). 고쳐 쓰기는 문장 줄에서만 되니 그림·표 줄이면 다음 줄로 넘어간다(합성 문서의 줄 순서에 기대지 않게)
  // 고른 박스(data-sel)와 그 짝(data-mate)이 줄 하나다 - 줄의 Unit 모두를 본다(설계 2026-11-20 D3)
  const isSentenceRow = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]:is([data-sel], [data-mate])').evaluateAll((els) => els.length > 0 && els.every((el) => ["ko", "en"].includes(el.getAttribute("lang") ?? "")));
  for (let step = 0; step < 10 && !(await isSentenceRow()); step += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
  }
  await pickFirstPlace(page);
  // 고쳐 쓰기는 고른 곳 상자 문장 줄의 연필(아직 안 쓴 문서의 칸일 때만) - E와 같다
  check("a slot shows the rewrite pencil on its sentence line", (await page.locator('[data-testid="assign-edit"]').count()) === 1);
  const changeKind = page.locator('[data-testid^="assign-slot-change-"]').first();
  const readKind = async () => [await changeKind.getAttribute("data-value"), ((await changeKind.textContent()) ?? "").trim()].join(" ");
  await changeKind.waitFor({ timeout: T });
  check("an untouched sentence shows = (as is), read-only", (await readKind()) === "as_is =" && (await changeKind.locator("button, [role=radio]").count()) === 0, await readKind());
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="assign-text-"]').first();
  const original = await textarea.inputValue();
  await textarea.fill("Smoke: rewritten sentence");
  await page.waitForFunction(() => document.querySelector('[data-testid^="assign-slot-change-"]')?.getAttribute("data-value") === "rewritten", null, { timeout: T });
  check("an edited sentence turns to Modified as you type", (await readKind()) === "rewritten Modified", await readKind());
  await textarea.fill(original);
  await page.waitForFunction(() => document.querySelector('[data-testid^="assign-slot-change-"]')?.getAttribute("data-value") === "as_is", null, { timeout: T });
  check("typing the source text back shows = again", (await readKind()) === "as_is =", await readKind());
  await page.keyboard.press("Escape");
  // 비우기
  await selectRowById(page, firstIds.split(" · ")[0]);
  check("the first unit is confirmed", (await rowStatus(page)) === "Confirmed", await rowStatus(page));
  await page.keyboard.press("u");
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Unassigned"), null, { timeout: T });
  check("U clears the unit", true);
  check("Unassign hides once nothing is assigned", (await page.locator('[data-testid="assign-clear"]').count()) === 0);
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
  const unit = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  // 짝 줄이면 번호가 둘이다 - 첫 번호로 다시 찾는다
  const heldId = (await getText(page, "assign-row-id")).trim().split(" · ")[0];
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Shift+H");
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
  // 결정 칸의 최근 Remark 단추 - 맨 앞 글을 창 없이 바로 채우고, 옆 화살표가 이전 글 목록을 연다
  await page.locator('[data-testid="assign-reason-recent"]').click();
  check("the recent-remark button fills the reason", ((await page.locator('[data-testid="assign-reason"]').textContent()) ?? "–") !== "–");
  await page.locator('[data-testid="assign-reason-history"]').click();
  await wait(page, "assign-reason-history-list");
  await page.locator('[data-testid="assign-reason-history-0"]').click();
  check("picking from the history closes the list", (await page.locator('[data-testid="assign-reason-history-list"]').count()) === 0);
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

await runStep("assign: a reference line asks for its number before it can be decided", { drafting: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  // 위쪽 줄의 남은 수를 누르면 확인이 남은 참조 줄 목록이 뜨고, Next가 그 줄로 간다(합성 문서 7절의 한 줄)
  await page.locator('[data-testid="assign-ref-pending"]').click();
  check("the reference count opens the list of lines to check", (await page.locator('[data-testid^="assign-ref-pending-item-"]').count()) >= 1);
  await page.locator('[data-testid="assign-ref-pending-next"]').click();
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
  // 언어 칸의 점선 REF를 눌러도 같은 확정이다(요청서 14)
  await page.locator('[data-testid="assign-shape"] button[data-lang="ref"][data-proposed]').click();
  await page.locator('[data-testid="assign-ref"][data-state="confirmed"]').waitFor({ timeout: T });
  check("the REF pill confirms the proposed number", (await getText(page, "assign-ref-title")) === "Reference line" && (await page.locator('[data-testid="assign-ref-pending"]').count()) === 0);
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator('[data-testid="assign-ref"][data-state="proposed"]').waitFor({ timeout: T });
  // 참조 아님 - 카드와 남은 수가 사라지고 다시 제안하지 않는다
  await page.locator('[data-testid="assign-ref-reject"]').click();
  await page.locator('[data-testid="assign-ref"]').waitFor({ state: "detached", timeout: T });
  // 원문을 다시 받은 뒤에 남은 수가 사라진다
  const isCountGone = await page.locator('[data-testid="assign-ref-pending"]').waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  check("Not a reference removes the card and the count", isCountGone);
});

// Reference 절 아래 줄(요청서 12) - 지금 추출기로 올린 문서는 References 절의 번호 줄이 올릴 때 이미 참조 줄이라 확인할 것이 없다(1번 묶음만 옛 추출기)
await runStep("assign: a line under References is a reference line from upload, with nothing to check", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const units = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items;
  const refLine = units.find((unit) => unit.text.startsWith("SOP-ABC-1016"));
  check("the References line is REF from upload", refLine?.lang === "ref", JSON.stringify(refLine?.lang));
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  check("no reference waits for a check", (await page.locator('[data-testid="assign-ref-pending"]').count()) === 0);
  check("no line on the paper is a REF? proposal", (await page.locator('.strip-lang[data-proposed]').count()) === 0);
  if (!refLine) return;
  const piece = page.locator(`[data-testid="assign-paper-piece-${refLine.unit_id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, "assign-ref");
  check("its card reads Reference line", (await getText(page, "assign-ref-title")) === "Reference line" && (await page.locator('[data-testid="assign-ref"]').getAttribute("data-state")) === "confirmed");
});

await runStep("assign: the document dashboard counts the Old document and downloads its paragraphs", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-dash");
  await page.locator('[data-testid="assign-dash"]').hover();
  await wait(page, "assign-dash-panel");
  const [confirmed, total] = ((await getText(page, "assign-dash-confirmed")).match(/\d+/g) ?? []).map(Number);
  const statusSum = (await page.locator('[data-testid^="assign-dash-status-"]').allInnerTexts()).reduce((sum, text) => sum + Number(text.match(/\d+$/)?.[0] ?? NaN), 0);
  check("dashboard counts the document's rows by status", total > 0 && statusSum === total && confirmed <= total, `${confirmed}/${total} sum ${statusSum}`);
  // 상자 안으로 옮겨도 닫히지 않는다
  await page.locator('[data-testid="assign-dash-download-doc"]').hover();
  await page.waitForTimeout(400);
  check("dashboard stays open while the pointer is inside", await page.locator('[data-testid="assign-dash-panel"]').isVisible());
  await page.locator('[data-testid="assign-dash-download-doc"]').click();
  await wait(page, "assign-dash-pick-doc");
  await takeShot("sop-assign-dashboard.png");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: T }), page.locator('[data-testid="assign-dash-no-tables-doc"]').click()]);
  check("paragraph Excel is named after the document", /_paragraphs_\d{8}-\d{4}\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
  const paragraphRows = readXlsxRows(readFileSync(await download.path()));
  check("the paragraph Excel's header row is Section No. | Text | Lang | Number note | Remark", JSON.stringify(paragraphRows[0]) === JSON.stringify(PARAGRAPH_HEADERS), JSON.stringify(paragraphRows[0]));
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-dash-panel"]').waitFor({ state: "detached", timeout: T });
  check("Esc closes the dashboard", (await page.locator('[data-testid="assign-dash-panel"]').count()) === 0);
});

// 다른 Bundle로 이동은 화면에서 없앴다(F2-R6~R8) - 전에 이동한 줄은 읽기 전용으로 보이고 배정 취소로만 풀린다
await runStep("assign: a row moved earlier is read-only and Unassign frees it", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${freshBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const unit = (await getJson("/units?limit=1000")).items.find((item) => item.kind === "sentence" && item.status === "unassigned" && item.decision.disposition === "unassigned" && item.pair_id === null);
  const moved = await page.request.post(`${api}/decisions/bulk`, { headers, data: { action: "move_external", reason: "", move_target_code: "SOP-QC-99999", units: [{ unit_id: unit.unit_id, revision: unit.decision.revision }] } });
  if (!moved.ok()) throw new Error(`could not seed a moved row: ${moved.status()}`);
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, unit.display_id);
  await page.locator('[data-testid="assign-legacy-move"]').waitFor({ timeout: T });
  await takeShot("sop-assign-legacy-move.png");
  check("the moved row reads 'Moved to another document' with its number", ((await page.locator('[data-testid="assign-legacy-move"]').textContent()) ?? "").includes("SOP-QC-99999"), await page.locator('[data-testid="assign-legacy-move"]').textContent());
  check("the moved row's Confirm is off", await page.locator('[data-testid="assign-primary"]').isDisabled());
  check("Hold is off and H saves nothing on the moved row", (await page.locator('[data-testid="assign-hold"]').isDisabled()) && (await (async () => {
    const saves = [];
    const onResponse = (response) => { if (response.url().includes("/groups/save")) saves.push(response.url()); };
    page.on("response", onResponse);
    await page.keyboard.press("Shift+H");
    await page.waitForTimeout(600);
    page.off("response", onResponse);
    return saves.length === 0 && (await page.locator('[data-testid="assign-legacy-move"]').count()) === 1;
  })()));
  await page.keyboard.press("m");
  await page.waitForTimeout(300);
  const el = page.locator(`[data-testid="assign-paper-unit-${unit.unit_id}"]`).first();
  await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = await el.boundingBox();
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(12, box.height / 2), { button: "right" });
  await wait(page, "assign-ctx-menu");
  check("M opens no window and the right-click menu has no move item", (await page.locator('[data-testid="assign-move-modal"]').count()) === 0 && (await page.locator('[data-testid="assign-ctx-move"]').count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-ctx-menu"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="assign-clear"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.getAttribute("data-tone") === "unassigned", null, { timeout: T });
  check("Unassign frees the moved row", (await rowStatus(page)) === "Unassigned" && (await page.locator('[data-testid="assign-legacy-move"]').count()) === 0, await rowStatus(page));
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
  // 짝 없는 문장 - 짝을 한 언어로 만드는 언어 바꾸기는 모양 전환이다(B6-3, 아래 단계는 보통 언어 바꾸기를 본다)
  const target = (await viewUnits()).find((unit) => unit.kind === "sentence" && unit.pair_id === null && unit.text.length > 20 && rows.find((row) => row.unit_id === unit.id)?.status === "unassigned");
  const openMenu = async (unitId) => {
    const el = page.locator(`[data-testid="assign-paper-unit-${unitId}"]`).first();
    await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const box = await el.boundingBox();
    await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(12, box.height / 2), { button: "right" });
    await wait(page, "assign-ctx-menu");
  };
  await openMenu(target.id);
  await takeShot("sop-assign-context-menu.png");
  check("the menu has assign and edit groups", (await page.locator('[data-testid="assign-ctx-clear"]').count()) === 1 && (await page.locator('[data-testid="assign-ctx-split"]').count()) === 1);
  // 확정은 Enter·오른쪽 칸·그 자리 메뉴가 맡는다 - 우클릭 메뉴에는 없다
  check("the menu has no confirm item", (await page.locator('[data-testid="assign-ctx-confirm"]').count()) === 0);
  // 언어 바꾸기
  const other = target.lang === "en" ? "ko" : "en";
  await page.locator(`[data-testid="assign-ctx-lang-${other}"]`).click();
  await page.waitForFunction(async ([path, id, lang]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.find((unit) => unit.id === id)?.lang === lang, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, target.id, other], { timeout: T });
  check("Language changes the unit's language from Assign", true);
  // 고친 뒤 화면이 원문을 다시 받아 그 줄을 다시 고른다 - 그 전에 메뉴를 열면 줄을 다시 고를 때 메뉴가 닫힌다
  await page.waitForLoadState("networkidle");
  await wait(page, "assign-row-id");
  // 고른 조각은 문단 테두리, 마우스만 올린 조각에는 테두리·언어 칩이 없다(올린 곳이 고른 것처럼 보이지 않게)
  const ringOf = (selector) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el, "::after").borderTopWidth : null; }, selector);
  check("the selected piece gets a paragraph border", (await ringOf(`[data-testid="assign-paper-piece-${target.id}"]`)) === "2px");
  const neighbor = (await viewUnits()).find((unit) => unit.kind === "sentence" && unit.id !== target.id && unit.pair_id === null && unit.lang !== "ref");
  const neighborPiece = page.locator(`[data-testid="assign-paper-piece-${neighbor.id}"]`);
  await neighborPiece.hover();
  await page.waitForTimeout(300);
  check("a hovered piece shows no border and no language chip", (await ringOf(`[data-testid="assign-paper-piece-${neighbor.id}"]`)) !== "2px" && (await page.locator(`[data-testid="assign-paper-piece-${neighbor.id}"] > .strip-lang`).evaluate((el) => getComputedStyle(el).visibility)) === "hidden");
  // Shape 언어 세 칸 - 바꾸는 동안 고름이 풀리지 않고 포커스가 누른 칸에 남는다
  const back = target.lang;
  await page.evaluate(() => { window.__selDrops = 0; new MutationObserver((recs) => { for (const r of recs) if (r.oldValue !== null && !r.target.hasAttribute("data-sel")) window.__selDrops += 1; }).observe(document.querySelector('[data-pane="old"]'), { attributes: true, subtree: true, attributeFilter: ["data-sel"], attributeOldValue: true }); });
  // 한/영 줄은 평소 KO | EN만, 세 칸에 올리면 REF까지 펼친다
  const langWidths = () => page.locator(`[data-testid="assign-shape-lang-${target.id}"] button`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const restWidths = await langWidths();
  await page.locator(`[data-testid="assign-shape-lang-${target.id}"]`).hover();
  await page.waitForTimeout(300);
  const openWidths = await langWidths();
  check("the language switch shows KO | EN at rest and REF too on hover", restWidths.length === 3 && restWidths[0] > 0 && restWidths[1] > 0 && restWidths[2] === 0 && openWidths.every((w) => w >= 28), JSON.stringify({ restWidths, openWidths }));
  // 글쇠로 누른다 - 마우스로 누르면 포커스가 용지로 돌아온다(S1)
  await page.locator(`[data-testid="assign-shape-lang-${target.id}-${back}"]`).press(" ");
  await page.waitForFunction(async ([path, id, lang]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.find((unit) => unit.id === id)?.lang === lang, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, target.id, back], { timeout: T });
  await page.locator(`[data-testid="assign-shape-lang-${target.id}-${back}"][aria-pressed="true"]`).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  check("the Shape language buttons change the language without dropping the selection", (await page.evaluate(() => window.__selDrops)) === 0);
  check("focus stays on the pressed language button", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === `assign-shape-lang-${target.id}-${back}`);
  // 마우스로 한 번 더 - 언어가 바뀌고 고름은 그대로, 포커스는 원문으로. 다시 눌러 처음 언어로 둔다
  for (const lang of [back === "ko" ? "en" : "ko", back]) {
    await page.locator(`[data-testid="assign-shape-lang-${target.id}-${lang}"]`).click();
    await page.locator(`[data-testid="assign-shape-lang-${target.id}-${lang}"][aria-pressed="true"]`).waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
    const saved = (await viewUnits()).find((unit) => unit.id === target.id)?.lang;
    const isOnPaper = await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T }).then(() => true, () => false);
    check(`a mouse press on the ${lang.toUpperCase()} button changes the language and gives the focus back to the paper`, saved === lang && isOnPaper && (await page.evaluate(() => window.__selDrops)) === 0, `${saved} ${isOnPaper}`);
  }
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

await runStep("assign: an edit survives looking at another unit", { drafting: true }, async ({ page }) => {
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

// 표는 묶음째 배정한다 - 칸 글자를 눌러도 표 전체가 골라지고(전에는 아무 일도 없었다), Alt를 누른 채 끌면 글자가 골라진다
await runStep("assign: a click anywhere on a table picks the whole table, Alt still selects text", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  let doc = null;
  let table = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${candidate.id}/view`, { headers })).json();
    const found = view.units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && view.units.some((other) => other.kind === "cell_sentence" && other.group_unit_id === unit.id && other.text.length > 3));
    if (!found) continue;
    doc = candidate;
    table = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id && unit.text.length > 3);
    break;
  }
  check("the fresh bundle has an unassigned whole table", table !== null);
  if (table === null) return;
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const cellText = page.locator(`[data-testid="assign-paper-unit-${cell.id}"]`).first();
  await cellText.waitFor({ timeout: T });
  await cellText.scrollIntoViewIfNeeded();
  await cellText.click();
  const unwrap = page.locator(`[data-testid="assign-shape-table_layout-${table.id}"]`);
  await unwrap.waitFor({ state: "attached", timeout: T });
  check("clicking cell text picks the whole table (Shape offers Unwrap table)", (await unwrap.getAttribute("aria-label")) === "Unwrap table");
  check("the table piece is the selected one", (await page.locator(`[data-testid="assign-paper-piece-${table.id}"]`).getAttribute("data-sel")) === "");
  // Alt+끌기 - 칸 글자 첫머리에서 끝까지
  const box = await cellText.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  check("Alt+drag still selects text", selected.trim().length > 0, JSON.stringify(selected));
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
});

// 배정 화면에서 표를 우클릭하면 표 메뉴(표 벗기기)가 뜬다 - 표 머리 줄을 우클릭한다(칸 위가 아니라 표 전체). 벗기기와 되돌리기는 아래 unwrap 단계가 본다
await runStep("assign: right-clicking a table opens the table menu", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  let doc = null;
  let table = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${candidate.id}/view`, { headers })).json();
    const found = view.units.find((unit) => unit.kind === "table" && unit.status === "unassigned");
    if (!found) continue;
    doc = candidate;
    table = found;
    break;
  }
  check("the fresh bundle has an unassigned table", table !== null);
  if (table === null) return;
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const head = page.locator(`[data-testid="assign-paper-head-${table.id}"]`).first();
  await head.waitFor({ timeout: T });
  await head.scrollIntoViewIfNeeded();
  await head.click({ button: "right" });
  await wait(page, "assign-ctx-table_layout");
  check("the table menu offers Unwrap table", (await page.locator('[data-testid="assign-ctx-table_layout"]').innerText()).includes("Unwrap table"));
  await takeShot("sop-assign-table-menu.png");
  await page.keyboard.press("Escape");
});

// 캡션 없는 표 바로 앞 문장을 Shape에서 붙였다 떼고, 되돌리기 두 번으로 처음대로 둔다 - 다음 단계가 같은 표에 캡션을 써 넣는다
await runStep("assign: attach and detach a caption from Shape", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  const table = units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && !captioned.has(unit.unit_id) && !unit.has_caption_target);
  check("the half bundle has an unassigned table without a caption", Boolean(table), table?.display_id);
  if (!table) return;
  // 그 표가 든 Old 문서와 표 바로 앞 단위(칸 문장·캡션은 표 자리로 친다)
  let doc = null;
  let sentence = null;
  let figure = null;
  let after = null;
  for (const candidate of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${candidate.id}/view`);
    if (!view.units.some((unit) => unit.id === table.unit_id)) continue;
    const ordered = [...view.units].sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id);
    const first = ordered.findIndex((unit) => unit.id === table.unit_id || unit.group_unit_id === table.unit_id);
    doc = candidate;
    sentence = ordered[first - 1] ?? null;
    const last = ordered.findLastIndex((unit) => unit.id === table.unit_id || unit.group_unit_id === table.unit_id);
    after = ordered[last + 1] ?? null;
    figure = view.units.find((unit) => unit.kind === "figure") ?? null;
  }
  check("a free sentence sits right above the table", sentence !== null && sentence.kind === "sentence" && sentence.group_unit_id === null, sentence?.text);
  if (!doc || !sentence) return;
  const captionsOf = async () => (await getJson(`/documents/${doc.id}/view`)).units.filter((unit) => unit.kind === "caption" && unit.group_unit_id === table.unit_id);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, table.display_id);
  // 우클릭 - 글에서는 "캡션으로 쓰기" 아래 가까운 표·그림 줄들(B10 - 바로 아래 표가 맨 앞), 그림에서는 문장 메뉴가 아닌 묶음 메뉴(언어 줄 없음)
  const sentencePiece = page.locator(`[data-testid="assign-paper-unit-${sentence.id}"]`).first();
  await sentencePiece.scrollIntoViewIfNeeded();
  await sentencePiece.click({ button: "right" });
  await wait(page, `assign-ctx-caption-of-${table.unit_id}`);
  const holders = page.locator('[data-testid^="assign-ctx-caption-of-"]');
  check("right-click on the sentence lists the table right below first under Use as caption of", (await holders.first().getAttribute("data-testid")) === `assign-ctx-caption-of-${table.unit_id}` && (await holders.first().innerText()).includes("right below"), await holders.first().innerText());
  check("it lists at most five tables and figures", (await holders.count()) >= 1 && (await holders.count()) <= 5, await holders.count());
  await page.keyboard.press("Escape");
  if (figure) {
    // 그림은 그림 탭의 카드다(시안 2 D3) - 같은 문서의 그림 탭에서 우클릭하고 본문 탭으로 돌아온다
    await openFigures(page);
    // 삭제로 확정한 그림(합성 묶음의 모양 그림)은 흐린 한 줄로 접혀 있다(설계 2026-11-20 D6) - 그 줄을 눌러 펼친 뒤 그림 조각을 우클릭한다
    const figureFold = page.locator(`[data-testid="assign-paper-deleted-u${figure.id}"]`);
    if ((await figureFold.count()) > 0) await figureFold.click();
    const figurePiece = page.locator(`[data-testid="assign-paper-piece-${figure.id}"]`).first();
    await figurePiece.waitFor({ timeout: T });
    await figurePiece.scrollIntoViewIfNeeded();
    await figurePiece.click({ button: "right" });
    await wait(page, "assign-ctx-menu");
    check("right-click on a figure opens the bundle menu, not the sentence menu", (await page.locator('[data-testid="assign-ctx-lang"], [data-testid="assign-ctx-split"]').count()) === 0);
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="assign-tab-body"]').click();
  }
  await selectRowById(page, table.display_id);
  // 표의 캡션 붙이기는 다듬기 줄 단추 대신 아래 캡션 자리의 후보다(F7 · F12)
  const slotBox = page.locator('[data-testid="assign-caption-slot"]');
  await slotBox.waitFor({ timeout: T });
  check("the Shape table line no longer carries Attach caption buttons", (await page.locator(`[data-testid="assign-shape-caption_attach_prev-${table.unit_id}"], [data-testid="assign-shape-caption_attach_next-${table.unit_id}"]`).count()) === 0);
  // 표 뒤가 묶이지 않은 글이 아니면(데모에서는 그림) 바로 아래 문단 후보가 없다
  const canAttachBelow = after !== null && (after.kind === "sentence" || after.kind === "heading") && after.group_unit_id === null && after.lang !== "ref";
  check("the slot offers the paragraph right below only when free text follows the table", (await page.locator(`[data-testid="assign-caption-cand-u${after?.id}"]`).count()) === (canAttachBelow ? 1 : 0), after?.kind);
  const attach = page.locator(`[data-testid="assign-caption-cand-u${sentence.id}"]`);
  check("the slot offers the sentence above as a caption candidate", (await attach.innerText()).startsWith("↑"), await attach.innerText());
  await attach.click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption attached" }).first().waitFor({ timeout: T });
  const [caption] = await captionsOf();
  check("the sentence becomes the table's caption", caption?.text === sentence.text, caption?.text);
  if (!caption) return;
  const head = page.locator(`[data-testid="assign-paper-caption-${table.unit_id}"]`);
  await head.waitFor({ timeout: T });
  check("the table head shows the sentence as its caption", (await head.innerText()).includes(sentence.text.slice(0, 10)), await head.innerText());
  check("Caption needed is gone", (await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).count()) === 0);
  // 캡션은 캡션 자리의 칩 - 언어 표시와 떼기 단추
  await page.locator(`[data-testid="assign-caption-chip-u${caption.id}"]`).waitFor({ timeout: T });
  check("the slot says it is filled", (await slotBox.getAttribute("data-state")) === "filled");
  await takeShot("sop-assign-caption-shape.png");
  await page.locator(`[data-testid="assign-caption-detach-${caption.id}"]`).click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption detached" }).first().waitFor({ timeout: T });
  await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).waitFor({ timeout: T });
  check("after Detach caption the head says Caption needed again", (await captionsOf()).length === 0);
  // 되돌리기 - 떼기를 되돌리면 캡션이 돌아오고, 붙이기까지 되돌리면 처음처럼 캡션이 없다
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await head.waitFor({ timeout: T });
  check("Undo brings the caption back", (await captionsOf()).length === 1);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).waitFor({ timeout: T });
  check("Undo again leaves the table without a caption, as it was", (await captionsOf()).length === 0);
  // 용지에서 줄 고르기(B10 8-a) - 캡션 자리의 단추 → 안내 띠 → 문장을 누르면 캡션, 되돌리기로 처음대로
  await selectRowById(page, table.display_id);
  await page.locator('[data-testid="assign-caption-pick-start"]').click();
  await wait(page, "assign-caption-pick");
  check("Pick a line shows the banner naming the table", (await page.locator('[data-testid="assign-caption-pick-text"]').innerText()).includes(table.display_id));
  await page.keyboard.press("Escape");
  check("Esc closes picking", (await page.locator('[data-testid="assign-caption-pick"]').count()) === 0);
  await selectRowById(page, table.display_id);
  await page.locator('[data-testid="assign-caption-pick-start"]').click();
  await wait(page, "assign-caption-pick");
  await sentencePiece.scrollIntoViewIfNeeded();
  await sentencePiece.click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption attached" }).first().waitFor({ timeout: T });
  check("clicking the sentence while picking makes it the table's caption and ends picking", (await captionsOf()).length === 1 && (await page.locator('[data-testid="assign-caption-pick"]').count()) === 0);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).waitFor({ timeout: T });
  check("Undo after picking leaves the table without a caption", (await captionsOf()).length === 0);
});

// 캡션 자리(F7) - Old 용지에서 문장 카드를 표 머리 줄(표의 캡션 자리)로 끌어 붙이고, 붙은 칩을 밖으로 끌어 뗀다. 되돌리기 두 번으로 처음대로 둔다
await runStep("assign: caption slot - drag a sentence onto the table and drag the chip back out", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 표를 하나 가정하지 않고 찾는다 - 배정 안 된 데이터 표 가운데 바로 위가 묶이지 않은 문장이고 그 문장 언어의 캡션이 아직 없는 표(다른 단계가 캡션을 남겨도 된다)
  let doc = null;
  let table = null;
  let sentence = null;
  for (const candidate of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${candidate.id}/view`);
    const ordered = [...view.units].sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id);
    for (const item of ordered.filter((unit) => unit.kind === "table" && unit.status === "unassigned" && !view.tables.find((entry) => entry.id === unit.table_id)?.is_layout)) {
      const above = ordered[ordered.findIndex((unit) => unit.id === item.id || unit.group_unit_id === item.id) - 1] ?? null;
      const langs = ordered.filter((unit) => unit.kind === "caption" && unit.group_unit_id === item.id).map((unit) => unit.lang);
      if (above && above.kind === "sentence" && above.group_unit_id === null && (above.lang === "ko" || above.lang === "en") && !langs.includes(above.lang)) {
        doc = candidate;
        table = { unit_id: item.id, display_id: item.display_id };
        sentence = above;
        break;
      }
    }
    if (doc) break;
  }
  check("the half bundle has an unassigned table with a free sentence right above", sentence !== null, sentence?.text);
  if (!doc || !table || !sentence) return;
  const captionsOf = async () => (await getJson(`/documents/${doc.id}/view`)).units.filter((unit) => unit.kind === "caption" && unit.group_unit_id === table.unit_id && unit.lang === sentence.lang);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await selectRowById(page, table.display_id);
  const piece = page.locator(`[data-pane="old"] [data-testid="assign-paper-piece-${sentence.id}"]`).first();
  const head = page.locator(`[data-pane="old"] [data-testid="assign-paper-head-${table.unit_id}"]`).first();
  await piece.scrollIntoViewIfNeeded();
  const from = await piece.boundingBox();
  const to = await head.boundingBox();
  // 글자 위를 피해 조각 오른쪽 끝 빈 자리에서 누른다
  await dragThrough(page, { x: from.x + from.width - 12, y: from.y + from.height / 2 }, [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }]);
  const note = await page.locator('[data-testid="drag-status"]').evaluate((el) => (el.textContent ?? "").trim() || null);
  const noteDest = await page.locator('[data-testid="drag-card"] .drag-card-dest').evaluate((el) => (el.textContent ?? "").trim() || null);
  check("over the table head the drag card says Attach as caption", note === "Attach as caption", note);
  check("over the table head the card ends with → caption", noteDest === "→ caption", noteDest);
  await page.mouse.up();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption attached" }).first().waitFor({ timeout: T });
  const [caption] = await captionsOf();
  check("dropping the sentence on the slot attaches it as the caption", caption?.text === sentence.text, caption?.text);
  if (!caption) return;
  const chip = page.locator(`[data-pane="old"] [data-caption-chip="${caption.id}"]`).first();
  await chip.waitFor({ timeout: T });
  await takeShot("sop-assign-caption-slot-drop.png");
  await chip.scrollIntoViewIfNeeded();
  const chipBox = await chip.boundingBox();
  // 칩을 Old 용지 안의 다른 자리로 끌어낸다 - 제 자리 밖이면 떼서 문장으로. 고정 거리로 끌면 칸 아래 화면 밖이나 가장자리 자동 스크롤 띠에 닿는다
  const paneBox = await page.locator('[data-pane="old"] .pane-body').first().boundingBox();
  const outY = chipBox.y - paneBox.y > 140 ? chipBox.y - 90 : Math.min(paneBox.y + paneBox.height - 70, chipBox.y + 160);
  await dragThrough(page, { x: chipBox.x + 6, y: chipBox.y + chipBox.height / 2 }, [{ x: paneBox.x + paneBox.width / 2, y: outY }]);
  const outNote = await page.locator('[data-testid="drag-status"]').evaluate((el) => (el.textContent ?? "").trim() || null);
  const outDest = await page.locator('[data-testid="drag-card"] .drag-card-dest').evaluate((el) => (el.textContent ?? "").trim() || null);
  check("dragging the chip off the slot says Detach as sentence", outNote === "Detach as sentence", outNote);
  check("dragging the chip off the slot the card ends with → sentence", outDest === "→ sentence", outDest);
  await page.mouse.up();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption detached" }).first().waitFor({ timeout: T });
  check("the chip dragged out goes back to a sentence", (await captionsOf()).length === 0);
  // 되돌리기 응답을 누르기 전에 기다려 둔다 - networkidle은 누른 뒤 요청이 나가기 전에도 이미 한가해 바로 끝나, 앞 되돌리기가 서버에 닿기 전에 캡션을 셌다
  for (const expected of [1, 0]) {
    await page.locator('[data-testid="assign-undo"]:not([disabled])').waitFor({ timeout: T });
    const undone = page.waitForResponse((response) => response.request().method() === "POST" && /\/decisions\/undo$/.test(new URL(response.url()).pathname), { timeout: T });
    await page.locator('[data-testid="assign-undo"]').click();
    const undoResponse = await undone;
    check(`Undo leaves ${expected} caption(s) on the table`, undoResponse.ok() && (await captionsOf()).length === expected, `${undoResponse.status()} ${(await captionsOf()).length}`);
  }
});

// 캡션 자리(F7 ③) - 첫 행이 한 줄(언어마다 하나)인 캡션 없는 표에서 "첫 행"을 눌러 캡션으로 올리고 "↩ 다시 첫 행으로" 돌린다. 되돌리기 두 번으로 처음대로
await runStep("assign: caption slot - lift the first row into the caption and back", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  let found = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    for (const table of view.units.filter((unit) => unit.kind === "table" && unit.status === "unassigned" && !captioned.has(unit.id))) {
      const cells = view.units.filter((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === table.id);
      const firstRow = Math.min(...cells.map((cell) => cell.row_index));
      const row = cells.filter((cell) => cell.row_index === firstRow);
      const langs = row.map((cell) => cell.lang);
      if (row.length > 0 && row.length < cells.length && new Set(langs).size === langs.length && !langs.includes("ref")) found ??= { doc, table, row };
    }
  }
  if (!found) {
    console.log("  (no table with a one-line first row in this seed - skipped)");
    return;
  }
  const { doc, table, row } = found;
  const captionsOf = async () => (await getJson(`/documents/${doc.id}/view`)).units.filter((unit) => unit.kind === "caption" && unit.group_unit_id === table.id);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, table.display_id);
  await page.locator('[data-testid="assign-caption-cand-first_row"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "First row became the caption" }).first().waitFor({ timeout: T });
  check("the first row's lines become the table's captions", (await captionsOf()).length === row.length);
  check("the slot offers Back to first row", (await page.locator('[data-testid="assign-caption-back-first-row"]').count()) === 1);
  await page.locator('[data-testid="assign-caption-back-first-row"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption went back to the first row" }).first().waitFor({ timeout: T });
  check("Back to first row leaves the table without a caption", (await captionsOf()).length === 0);
  for (const expected of [row.length, 0]) {
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="assign-undo"]').click();
    await page.waitForLoadState("networkidle");
    check(`Undo leaves ${expected} caption(s) on the table`, (await captionsOf()).length === expected);
  }
});

// 캡션 자리(F7 ⑥) - 캡션 없는 그림의 자리에 "캡션 있는 이웃 그림과 묶기" 후보가 뜨면 묶고 풀어 본다. 되돌리기 두 번으로 처음대로
await runStep("assign: caption slot - group a figure with its captioned neighbour and ungroup", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  const figures = units.filter((unit) => unit.kind === "figure" && unit.status === "unassigned" && !captioned.has(unit.unit_id) && !unit.caption_figure_id).slice(0, 3);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  // 그림은 그림 탭에서 찾는다(시안 2 D3) - J/K가 그 탭 안 카드 차례로 돈다
  if (figures.length > 0) await openFigures(page, figures[0].document_id);
  let figure = null;
  for (const candidate of figures) {
    await selectRowById(page, candidate.display_id);
    await page.locator('[data-testid="assign-caption-slot"]').waitFor({ timeout: T });
    if ((await page.locator('[data-testid^="assign-caption-cand-f"]').count()) > 0) {
      figure = candidate;
      break;
    }
  }
  if (!figure) {
    console.log("  (no captionless figure next to a captioned one in this seed - skipped)");
    return;
  }
  const shareOf = async () => (await getJson(`/documents/${figure.document_id}/view`)).units.find((unit) => unit.id === figure.unit_id)?.caption_figure_id ?? null;
  await page.locator('[data-testid^="assign-caption-cand-f"]').first().click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Figures grouped under one caption" }).first().waitFor({ timeout: T });
  check("the figures share one caption", (await shareOf()) !== null || (await page.locator('[data-testid="assign-caption-ungroup"]').count()) === 1);
  await page.locator('[data-testid="assign-caption-ungroup"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Figures ungrouped" }).first().waitFor({ timeout: T });
  check("Ungroup figures lets the figure stand alone again", (await shareOf()) === null);
  for (let undo = 0; undo < 2; undo += 1) {
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="assign-undo"]').click();
    await page.waitForLoadState("networkidle");
  }
  check("two Undos leave the figure as it was", (await shareOf()) === null);
});

// 그림 탭(시안 2 D3) - 본문의 그림은 본문 탭에서 빠져(자리 표시 없음) 그림 탭의 카드가 되고, 위치 보기가 왼쪽 판에 그 자리 앞뒤 본문과 점 선을 띄우고,
// 판 안 줄을 누르면 본문 탭의 그 줄로 가고, 지우기(Remark 없이)가 카드를 흐린 한 줄로 접는다. 되돌리기로 처음대로 둔다
await runStep("assign: figures - the Figures tab holds the figure cards, Show position opens the side panel at the spot, Delete folds the card", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const readFigure = async () => (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === figure.unit_id);
  const figure = (await getJson("/units?limit=1000")).items.find((unit) => unit.kind === "figure" && unit.status === "unassigned");
  check("the half bundle has an unassigned figure", Boolean(figure), figure?.display_id);
  if (!figure) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await openFigures(page, figure.document_id);
  const card = page.locator(`[data-testid="assign-paper-piece-${figure.unit_id}"]`);
  await card.waitFor({ timeout: T });
  const tabText = (await page.locator('[data-testid="assign-tab-figures"]').innerText()).replace(/\s+/g, " ").trim();
  check("the tab row ends with Figures and the number of cards", /^Figures \d+$/.test(tabText) && (await page.locator('[data-testid="assign-tabs"] [role="tab"]').last().getAttribute("data-testid")) === "assign-tab-figures", tabText);
  await takeShot("sop-assign-figures-tab.png");
  // 본문 탭 - 그림 줄도 그 자리 표시도 없다
  await page.locator('[data-testid="assign-tab-body"]').click();
  await page.locator('[data-testid="assign-tab-body"][aria-selected="true"]').waitFor({ timeout: T });
  check("the body tab has no figure row and no placeholder", (await page.locator('[data-testid="assign-paper"] .strip[data-kind="figure"]').count()) === 0 && (await card.count()) === 0);
  await page.locator('[data-testid="assign-tab-figures"]').click();
  // 위치 보기 - 왼쪽 판에 앞뒤 본문 줄(한쪽 3줄까지)과 그림 자리 표지(문단 사이면 점선 네모, 문장 속이면 글 사이 "▣ 그림")
  const panel = page.locator('[data-testid="assign-figure-spot"]');
  const openSpot = async () => {
    await card.hover();
    await page.locator(`[data-testid="assign-figure-show-${figure.unit_id}"]`).click();
    await panel.waitFor({ timeout: T });
    await panel.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  };
  await openSpot();
  const spotBox = panel.locator('[data-testid="assign-spot-figure"]');
  const spotChip = panel.locator('[data-testid="assign-spot-chip"]');
  const markerText = (await spotBox.count()) === 1 ? await spotBox.innerText() : (await spotChip.count()) === 1 ? await spotChip.innerText() : "";
  check(
    "Show position opens the left panel with one figure marker - a dashed box between rows or a chip inside the sentence",
    (await panel.getAttribute("data-side")) === "left" && (await spotBox.count()) + (await spotChip.count()) === 1 && markerText.includes(figure.display_id),
    await panel.innerText(),
  );
  const spotRows = await panel.locator(".strip[data-strip-unit]").count();
  check("the panel shows only the body rows around the spot - three at most on each side", spotRows >= 1 && spotRows <= 6, String(spotRows));
  check("the panel is read-only - no join, grip or number buttons", (await panel.locator(".strip-merge, [data-drag-handle], button[data-testid^='assign-spot-num']").count()) === 0, await panel.locator(".strip-merge, [data-drag-handle], [data-testid^='assign-spot-num']").evaluateAll((els) => els.map((el) => `${el.tagName}.${el.className}:${el.dataset.testid ?? ""}`).join(" ")));
  await takeShot("sop-assign-figure-spot.png");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: T });
  check("Esc closes the panel", true);
  // 판 안 줄을 누르면 본문 탭으로 가 그 줄을 고른다
  await openSpot();
  const spotRow = panel.locator(".strip[data-strip-unit]").first();
  const rowUnit = await spotRow.getAttribute("data-strip-unit");
  await spotRow.click();
  await panel.waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="assign-tab-body"][aria-selected="true"]').waitFor({ timeout: T });
  await page.locator(`[data-testid="assign-paper-piece-${rowUnit}"][data-sel]`).waitFor({ timeout: T });
  check("a row in the panel goes to the body tab and picks that row", true);
  // 1단 보기 - 같은 판이 오른쪽에서 나온다(B7 4-a)
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="assign-tab-figures"]').click();
  await openSpot();
  check("in the single view Show position opens the panel on the right", (await panel.getAttribute("data-side")) === "right");
  // 판을 연 채 탭을 오가면 용지가 다시 만들어진다 - data-spot이 새 용지와 맞아야 한다(좁은 창 · 큰 배율: 덮기라 용지는 가운데 그대로).
  // 창과 배율은 판을 열기 전에 맞춘다(덮은 판이 확대 단추 위에 선다). 판이 덮고 있어 탭은 눌림 사건을 직접 보낸다
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: T });
  await page.setViewportSize({ width: 1280, height: VIEWPORT.height });
  for (let tries = 0; tries < 20 && (await getText(page, "assign-old-zoom-value")) !== "160%"; tries += 1) await page.locator('[data-testid="assign-old-zoom-in"]').click();
  await openSpot();
  for (const tab of ["body", "figures", "body"]) {
    await page.locator(`[data-testid="assign-tab-${tab}"]`).dispatchEvent("click");
    await page.locator(`[data-testid="assign-tab-${tab}"][aria-selected="true"]`).waitFor({ timeout: T });
  }
  await page.waitForFunction(() => !document.querySelector(".assign-panes[data-motion]"), null, { timeout: T });
  const spotState = await page.evaluate(() => {
    const panes = document.querySelector(".assign-panes");
    const pane = document.querySelector('[data-testid="assign-old"]').getBoundingClientRect().width;
    const sheet = document.querySelector('[data-testid="assign-old"] .sheet')?.getBoundingClientRect();
    return { spot: panes.dataset.spot ?? null, pane, sheet: sheet?.width ?? 0 };
  });
  const expectAside = spotState.pane - spotState.sheet - 12 >= 420;
  check("after switching tabs with the panel open data-spot still matches the paper", (await panel.count()) === 1 && spotState.sheet > 0 && spotState.spot === (expectAside ? "aside" : "cover"), JSON.stringify(spotState));
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: T });
  await page.setViewportSize(VIEWPORT);
  for (let tries = 0; tries < 20 && (await getText(page, "assign-old-zoom-value")) !== "100%"; tries += 1) await page.locator('[data-testid="assign-old-zoom-out"]').click();
  await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ timeout: T });
  // 지우기 - Remark 없이 확정하면 카드가 흐린 한 줄로 접힌다
  await page.locator('[data-testid="assign-tab-figures"]').click();
  await card.hover();
  await page.locator(`[data-testid="assign-figure-delete-${figure.unit_id}"]`).click();
  await wait(page, "assign-figure-delete-modal");
  await page.locator('[data-testid="assign-figure-delete-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Figure deleted" }).first().waitFor({ timeout: T });
  const fold = page.locator(`[data-testid="assign-paper-deleted-u${figure.unit_id}"]`);
  await fold.waitFor({ timeout: T });
  const deleted = await readFigure();
  check("Delete confirms the figure as deleted and folds the card to one faint line", deleted?.status === "confirmed" && deleted?.decision.disposition === "delete" && (await fold.innerText()).includes("FIGURE"), `${deleted?.status} ${deleted?.decision.disposition}`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  // 되돌리기가 닿을 때까지 - 접힌 줄이 풀리고 상태가 돌아온다(networkidle만으로는 되돌리기 요청 전에 읽을 수 있다)
  await fold.waitFor({ state: "detached", timeout: T });
  let restored = await readFigure();
  for (let tries = 0; tries < 40 && restored?.status !== "unassigned"; tries += 1) {
    await page.waitForTimeout(250);
    restored = await readFigure();
  }
  check("Undo leaves the figure unassigned, as it was", restored?.status === "unassigned", restored?.status);
});

await runStep("assign: a bundle without a caption cannot be confirmed until one is written", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 데모 시드가 일부러 남긴 캡션 없는 미배정 표(OLD-7) - 캡션 단위도 써 넣은 캡션도 없다
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  const table = units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && !captioned.has(unit.unit_id) && !unit.has_caption_target);
  check("the half bundle has an unassigned table without a caption", Boolean(table), table?.display_id);
  if (!table) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pending = page.locator('[data-testid="assign-caption-pending"]');
  await pending.waitFor({ timeout: T });
  const countBefore = parseInt(await pending.innerText(), 10);
  // 좁은 상단 바에서는 수만 보이고 문구는 aria-label에 있다
  const pendingLabel = (await pending.getAttribute("aria-label")) ?? (await pending.innerText());
  check("the top bar counts the bundles that need a caption", countBefore > 0 && pendingLabel.includes(`${countBefore} captions needed`), pendingLabel);
  // 누를 때마다 캡션이 필요한 다음 묶음 - 그 표에 닿을 때까지
  for (let step = 0; step <= countBefore && (await page.locator('[data-testid="assign-row-id"]').count() === 0 || !(await rowIds(page)).includes(table.display_id)); step += 1) {
    await pending.click();
    await page.locator('[data-testid="assign-caption-pending-next"]').click();
    await page.locator('[data-testid="assign-row-id"]').waitFor({ timeout: T });
  }
  check("the count walks to that table", (await rowIds(page)).includes(table.display_id), await rowIds(page));
  check("its head says Caption needed", (await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).count()) === 1);
  await pickFirstPlace(page);
  const primary = page.locator('[data-testid="assign-primary"]');
  check("Confirm is off for a table without a caption", await primary.isDisabled());
  await wait(page, "assign-caption-needed");
  await page.locator('[data-testid="assign-caption-write"]').click();
  const field = page.locator('[data-testid^="assign-caption-text-"]');
  await field.first().waitFor({ timeout: T });
  check("Write a caption opens one caption field", (await field.count()) === 1);
  const text = "표 9. 회전 속도 SYNTHETIC";
  await field.first().fill(text);
  check("writing a caption turns Confirm on", await primary.isEnabled());
  await takeShot("sop-assign-caption-write.png");
  await primary.click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  // 남은 수가 하나 줄고, 머리 줄의 Caption needed도 사라진다(같은 규칙)
  await page.waitForFunction((n) => Number.parseInt(document.querySelector('[data-testid="assign-caption-pending"]')?.textContent ?? "0", 10) === n - 1, countBefore, { timeout: T });
  check("the count drops by one", true);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-caption-missing-${id}"]`) === null, table.unit_id, { timeout: T });
  check("the head no longer says Caption needed", true);
  check("the unit list now marks the table as captioned", (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === table.unit_id)?.has_caption_target === true);
  let inC = false;
  for (const doc of (await getJson("/tobe")).docs.filter((item) => item.entrance === "assign")) {
    if (JSON.stringify(await getJson(`/outputs/c/docs/${doc.id}?lang=ko`)).includes("회전 속도 SYNTHETIC")) inC = true;
  }
  check("output C carries the written caption", inC);
});

// AI는 제안만 한다(설계 2026-11-19-ai-suggest-only) - 요청한 분류는 줄 상태를 바꾸지 않고 AI 카드로 온다. 상단 바 AI 메뉴의 일괄 수락이
// 나눈 고쳐 쓰기도 제안 모양 그대로 받고(D3), 되돌리기 한 번에 받은 것이 모두 추천으로 돌아간다
await runStep("assign: an AI split is taken whole from the top bar and one undo takes it back", { drafting: true }, async ({ page, takeShot }) => {
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
  const ids = await rowIds(page);
  await aiRequest.click();
  // 상단 바 표시가 대기·실행 중을 보인다(워커가 2초마다 꺼내므로 요청 직후에는 대기 중이다)
  await page.locator('[data-testid="top-bar-ai"][data-state="active"]').waitFor({ timeout: T });
  check("the top bar shows the AI job in progress", (await getText(page, "top-bar-ai-active")).trim() === "1");
  // 폴링으로 추천이 저절로 들어온다(새로고침 없이) - 줄은 사람이 받을 때까지 미배정이다
  const aiCard = page.locator('[data-testid^="assign-rec-"] .dest-chip[data-source="ai"]');
  await aiCard.first().waitFor({ timeout: 30000 });
  check("the AI suggestion appears as a card without a reload", true);
  check("the row stays unassigned until a person takes it", (await page.locator('[data-testid="assign-row-status"]').getAttribute("data-tone")) === "unassigned");
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

  // 같은 목록 맨 위의 AI 추천 받기 - 이 화면이 묶음과 지금 Old 문서의 건수를 올려 둔다(§5 3-1)
  const takeAll = async () => {
    if ((await page.locator('[data-testid="ai-jobs-popover"]').count()) === 0) await page.locator('[data-testid="top-bar-ai"]').click();
    await wait(page, "ai-accept-classify");
    const offered = Number((await getText(page, "ai-accept-classify-count")).trim());
    await page.locator('[data-testid="ai-accept-classify"]').click();
    await wait(page, "assign-accept-modal-shape-assigned");
    const shown = Number((await getText(page, "assign-accept-modal-shape-assigned")).replace(/\D+/g, ""));
    return { offered, shown };
  };
  const first = await takeAll();
  check("the AI menu offers this document's classify suggestions", first.offered >= 1, String(first.offered));
  check("the confirm window counts them before taking (this Old document by default)", first.shown >= 1 && (await page.locator('[data-testid="assign-accept-modal-scope-document"]').isChecked()), String(first.shown));
  await takeShot("sop-assign-ai-accept.png");
  await page.locator('[data-testid="assign-accept-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: /^Took \d+ AI suggestions/ }).first().waitFor({ timeout: T });
  await page.locator('[data-testid="assign-accept-modal"]').waitFor({ state: "detached", timeout: T });
  await selectRowById(page, ids.split(" · ")[0]);
  await page.locator('[data-testid^="assign-text-t"]').nth(1).waitFor({ timeout: T });
  const slots = await page.locator('[data-testid^="assign-text-t"]').count();
  check("both split sentences are saved as the AI suggested them", slots >= 2, String(slots));
  check("the taken row is confirmed", (await page.locator('[data-testid="assign-row-status"]').getAttribute("data-tone")) === "confirmed");

  // 되돌리기 한 번 - 받은 줄이 모두 미배정으로, 추천은 다시 카드로 돌아온다
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.getAttribute("data-tone") === "unassigned", null, { timeout: T });
  await aiCard.first().waitFor({ timeout: T });
  check("one undo takes the whole accept back and the AI card returns", true);

  // 다시 받아 둔다 - 이 단계가 끝에 남기던 모습(확정된 두 문장)
  await takeAll();
  await page.locator('[data-testid="assign-accept-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]', { hasText: /^Took \d+ AI suggestions/ }).first().waitFor({ timeout: T });
  await selectRowById(page, ids.split(" · ")[0]);
  await page.locator('[data-testid^="assign-text-t"]').first().waitFor({ timeout: T });
  check("both sentences are there after taking it again", (await page.locator('[data-testid^="assign-text-t"]').count()) === slots);
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
  // 출처 없는 New 거르기는 New 칸 머리에 있어 한 단에서는 보이지 않는다(1.2.0 피드백) - V로 양 단으로 돌아온다
  check("New without source is not shown in one-document view", (await page.locator('[data-testid="assign-filter-unsourced"]').count()) === 0);
  await page.keyboard.press("v");
  await wait(page, "assign-new");
  check("V brings both documents back", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === "true");
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
  // 같은 글 일괄 확정은 더보기(⋯) 메뉴 맨 위에 있다
  await wait(page, "assign-more");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-more"]').click();
  await page.locator('[data-testid="assign-identical"]').click();
  // 여러 줄을 한 번에 확정하므로 확인 창을 거친다
  await page.locator('[data-testid="assign-identical-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  // 같은 글 목록을 다시 받은 뒤에 메뉴에서 빠진다 - 열어 보고 남아 있으면 잠깐 뒤 다시 연다
  let identicalLeft = 1;
  for (let step = 0; step < 20 && identicalLeft > 0; step += 1) {
    await page.locator('[data-testid="assign-more"]').click();
    await page.locator('[data-testid="assign-more-list"]').waitFor({ timeout: T });
    identicalLeft = await page.locator('[data-testid="assign-identical"]').count();
    await page.keyboard.press("Escape");
    if (identicalLeft > 0) await page.waitForTimeout(300);
  }
  check("identical matches confirm together", identicalLeft === 0);
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
  const readRowLangs = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]:is([data-sel], [data-mate])').evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("lang") ?? "neutral"))]);
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
    // New 칸은 줄을 따라가지 않는다(1.2.0 피드백) - 예전처럼 줄마다 첫 잇기 카드의 문서를 손으로 연다
    await showLinkCardDoc(page);
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
  // 좁은 New 칸 머리(1280 반반 이하)에서는 확대 %를 접는다(v1.1.38) - 보이지 않아도 값은 그대로라 붙어 있기만 기다린다
  await page.locator('[data-testid="assign-new-zoom-value"]').first().waitFor({ state: "attached", timeout: T });
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

// 끌어서 잇기(끌어다 놓기 설계 §6, 2걸음) - Old 조각을 이미 쓴 New 문장에 놓으면 클릭으로 이을 때와 같은 상태(그 줄 고름 · 그 문장 고름 · 그 자리 메뉴)가 되고 저장은 하지 않는다.
// 마우스는 걸음으로 움직인다(dragTo는 쓰지 않는다). 저장하지 않으므로 되돌릴 것이 없다
await runStep("assign: drag an Old piece onto a written New sentence, it links like a click", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  const headers = { "X-Dev-User": "qa.member" };
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items;
  const written = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers })).json();
  const writtenDocIds = [...new Set(written.map((row) => row.target_doc_id))];
  // 짝 없는 미배정 문장 - 줄 하나가 Unit 하나다
  const loose = new Map((await readUnits()).filter((unit) => unit.status === "unassigned" && unit.kind === "sentence" && unit.pair_id === null).map((unit) => [unit.unit_id, unit]));
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await openLooseOldDoc(page, halfBundleId);
  const shownIds = await page.locator('[data-pane="old"] .strip[data-strip-unit]').evaluateAll((els) => els.map((el) => Number(el.dataset.stripUnit)));
  const [aId, bId] = shownIds.filter((id) => loose.has(id));
  check("the Old paper shows two loose unassigned sentences", aId !== undefined && bId !== undefined, `${aId} ${bId}`);
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 조각 글의 첫 글줄 위 한 점 - 앞머리·배지·줄 끝 표시를 비켜 글 위를 누른다
  const pointInUnit = async (id) => {
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const pointInLine = async (id) => {
    await centre(`[data-testid="assign-new-${id}"]`);
    await page.waitForTimeout(150);
    const box = await page.locator(`[data-testid="assign-new-${id}"] .new-hit`).boundingBox();
    return { x: box.x + Math.min(60, box.width / 2), y: box.y + box.height / 2 };
  };
  const newPane = page.locator('[data-testid="assign-new"]');
  const openNewDoc = async (docId) => {
    if ((await newPane.getAttribute("data-doc")) === String(docId)) return;
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), docId, { timeout: T });
  };
  const readMarks = () => page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    lines: document.querySelectorAll("svg[data-drag-line]").length,
    drops: document.querySelectorAll("[data-drop]").length,
    srcs: document.querySelectorAll("[data-drag-src]").length,
  }));
  const isPressed = async (id) => (await page.locator(`[data-testid="assign-new-pick-${id}"]`).getAttribute("aria-pressed")) === "true";
  const menu = page.locator('[data-testid="assign-link-menu"]');

  // 1. 다른 줄을 먼저 골라 둔다 - 끄는 줄은 지금 고른 줄이 아니다
  const aPoint = await pointInUnit(aId);
  await page.mouse.click(aPoint.x, aPoint.y);
  await page.waitForLoadState("networkidle");
  check("clicking a piece picks its row first", (await pieceOf(aId).getAttribute("data-sel")) === "");
  await newPane.waitFor({ timeout: T });
  const shownDoc = Number(await newPane.getAttribute("data-doc"));
  await openNewDoc(writtenDocIds.includes(shownDoc) ? shownDoc : writtenDocIds[0]);
  const tId = Number(await page.locator('[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target]:not([data-state="picked"])').first().getAttribute("data-target"));

  // 2. 끄는 동안 - 표 한 장, 놓을 문장 테두리와 표의 메모, 따라오는 점선, 흐린 출발 조각
  const from = await pointInUnit(bId);
  const onto = await pointInLine(tId);
  await dragThrough(page, from, [onto]);
  await page.waitForTimeout(100);
  const during = await page.evaluate(({ b, t }) => ({
    card: document.querySelector('[data-testid="drag-card"]')?.textContent ?? null,
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    drop: document.querySelector(`[data-testid="assign-new-${t}"]`)?.getAttribute("data-drop") ?? null,
    line: document.querySelector("svg[data-drag-line] path")?.getAttribute("d") ?? "",
    src: document.querySelector(`[data-testid="assign-paper-piece-${b}"]`)?.hasAttribute("data-drag-src") ?? false,
  }), { b: bId, t: tId });
  check("dragging an Old piece shows a card with its unit id", during.card !== null && during.card.includes(loose.get(bId).display_id), during.card);
  check("over a written sentence the line is marked and the card says link", during.drop === "over" && during.note === "Link to this sentence", JSON.stringify({ drop: during.drop, note: during.note }));
  check("over a written sentence the card ends with → link", during.dest === "→ link", during.dest);
  check("a draft line follows from the piece", during.line.length > 0);
  check("the dragged piece stays dimmed in place", during.src);
  await takeShot("sop-assign-drag-link.png");
  // 3. 문장 위를 여러 걸음 지나도 React는 다시 그리지 않는다(G11)
  // 끌기와 상관없는 그리기(알림이 사라짐 · 참조 번호를 채우는 다시 읽기 · AI 작업 폴러)가 창에 끼면 끌기 탓이 아닌 커밋이 섞인다 - 이런 일은 쓴 DB일수록 잦다.
  // 끌기가 다시 그린다면 매번 커밋이 생기므로, 같은 움직임을 세 번까지 재어 한 번이라도 0이면 끌기는 다시 그리지 않는 것이다
  const windows = [];
  for (let round = 0; round < 3; round += 1) {
    const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
    for (let i = 0; i < 12; i += 1) await page.mouse.move(onto.x + (i % 4) * 6, onto.y + (i % 3) - 1);
    const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
    windows.push(`${commitsBefore} -> ${commitsAfter}`);
    if (commitsBefore > 0 && commitsBefore === commitsAfter) break;
  }
  const lastWindow = windows.at(-1).split(" -> ").map(Number);
  check("no React commit while dragging over a sentence", lastWindow[0] > 0 && lastWindow[0] === lastWindow[1], windows.join(", "));

  // 4. 놓으면 바로 확정(1.2.0 피드백 - 그 자리 메뉴 없이) - 끈 줄을 고르고 그 문장에 잇고 저장한다, 끌기 표시는 모두 치운다
  const savedByDrop = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.mouse.up();
  const dropResponse = await savedByDrop;
  await page.waitForLoadState("networkidle");
  // 확정처럼 고름은 다음 열린 줄로 넘어간다 - 저장 내용으로 끈 줄을 본다
  const droppedUnit = (await readUnits()).find((unit) => unit.unit_id === bId);
  check("dropping on a written sentence confirms the link at once", dropResponse.ok() && droppedUnit?.status !== "unassigned" && (droppedUnit?.target_ids ?? []).includes(tId), JSON.stringify({ status: droppedUnit?.status, targets: droppedUnit?.target_ids, tId }));
  check("no in-place menu after a drop", (await menu.count()) === 0);
  const marks = await readMarks();
  check("the drag leaves no marks behind", marks.cards + marks.lines + marks.drops + marks.srcs === 0, JSON.stringify(marks));
  // 5. 되돌리기가 그 확정을 거둔다 - 뒤 확인들은 b가 미배정이어야 한다
  await page.keyboard.press("ControlOrMeta+z");
  for (let step = 0; step < 30 && (await readUnits()).find((unit) => unit.unit_id === bId)?.status !== "unassigned"; step += 1) await page.waitForTimeout(300);
  check("Ctrl+Z takes the dropped link back", (await readUnits()).find((unit) => unit.unit_id === bId)?.status === "unassigned");
  await page.waitForLoadState("networkidle");

  // 7. Esc - 끄다가 문장 위에서 취소하면 표가 사라지고 아무것도 고르지 않는다
  await dragThrough(page, await pointInUnit(bId), [await pointInLine(tId)]);
  await page.waitForTimeout(100);
  const overBeforeEsc = await page.locator(`[data-testid="assign-new-${tId}"]`).getAttribute("data-drop");
  await page.keyboard.press("Escape");
  const afterEsc = await readMarks();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("Esc cancels the drag over a sentence", overBeforeEsc === "over" && afterEsc.cards + afterEsc.lines + afterEsc.drops + afterEsc.srcs === 0, JSON.stringify(afterEsc));
  check("a cancelled drag picks nothing and opens no menu", !(await isPressed(tId)) && (await menu.count()) === 0);

  // 9. 클릭은 그대로 - 움직이지 않고 누르면 표 없이 그 줄을 고른다
  const press = await pointInUnit(aId);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  const cardsOnPress = await page.locator('[data-testid="drag-card"]').count();
  await page.mouse.up();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), aId, { timeout: T });
  check("a press without moving still picks the row, with no card", cardsOnPress === 0 && (await page.locator('[data-testid="drag-card"]').count()) === 0);
  // 끌기를 쓴 뒤에도 두 번 누르기는 그 조각에 나눌 자리를 세운다(4px 안의 누름은 지금의 클릭이다) - 글 가운데를 두 번 누르고 Esc로 거둔다
  const twice = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => {
    const rect = el.getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.dblclick(twice.x, twice.y);
  // 나눌 자리 표시(.cut-anchor)는 폭이 0이라 "보임"이 아니다 - 붙었는지만 본다
  const cutShown = await page.locator(`[data-testid="assign-paper-piece-${aId}"] .cut-anchor`).waitFor({ state: "attached", timeout: 4000 }).then(() => true, () => false);
  check("after a drag, a double press still sets a cut in the Old piece", cutShown && (await page.locator('[data-testid="drag-card"]').count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator('[data-pane="old"] .cut-anchor').first().waitFor({ state: "detached", timeout: T });

  // 아래 경주는 끈 줄이 고른 줄이 아닐 때다 - 앞서처럼 다른 줄(a)을 다시 고른다
  const aAgain = await pointInUnit(aId);
  await page.mouse.click(aAgain.x, aAgain.y);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), aId, { timeout: T });
  await page.waitForLoadState("networkidle");

  // 놓자마자 j로 다음 줄로 옮기면 늦게 온 관계 묶음이 옮겨 간 줄에 잇기를 적용하지 않는다 - 끈 줄의 묶음 응답을 늦춰 경주를 정해 둔다
  await openNewDoc(written.find((row) => row.target_id === tId).target_doc_id);
  const lateGroup = `**/groups/by-unit/${bId}`;
  await page.route(lateGroup, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await dragThrough(page, await pointInUnit(bId), [await pointInLine(tId)]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.keyboard.press("j");
  await page.waitForTimeout(2500);
  await page.unroute(lateGroup);
  // 옮겨 간 줄의 추천 문서가 다르면 New 칸이 그 문서로 넘어가 놓았던 문장이 없다 - 없으면 골라지지 않은 것이다
  const isShownPressed = async (id) => (await page.locator(`[data-testid="assign-new-pick-${id}"]`).count()) > 0 && (await isPressed(id));
  const afterSwitch = { menu: await menu.count(), pressed: await isShownPressed(tId), dragged: (await pieceOf(bId).getAttribute("data-sel")) !== null, picked: await page.locator('[data-testid="assign-new"] .new-line[data-state="picked"]').count() };
  check("a drop is let go when another row is picked before its group arrives", afterSwitch.menu === 0 && !afterSwitch.pressed && !afterSwitch.dragged && afterSwitch.picked === 0, JSON.stringify(afterSwitch));

  // 다른 문장에 놓아도 바로 저장된다 - 앞 확인들이 쓰지 않는 셋째 미배정 문장을 다른 문장에 놓는다(New 칸이 넘어갔으면 놓았던 문서로 되돌린다)
  await openNewDoc(written.find((row) => row.target_id === tId).target_doc_id);
  // 참조 줄(REF)은 번호를 받기 전에는 확정되지 않는다 - 시드에 따라 셋째 미배정 문장이 참조 줄일 수 있어 건너뛰고, 없으면 저장하지 않은 첫 문장(aId - 뒤에서 쓰지 않는다)
  const refIds = new Set(await page.locator('[data-pane="old"] [data-lang="ref"][data-testid^="assign-paper-lang-"]').evaluateAll((els) => els.map((el) => Number(el.dataset.testid.replace("assign-paper-lang-", "")))));
  const cId = shownIds.filter((id) => loose.has(id)).slice(2).find((id) => !refIds.has(id)) ?? aId;
  const confirmTarget = Number(await page.locator(`[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target]:not([data-target="${tId}"]):not([data-state="picked"])`).first().getAttribute("data-target"));
  check("the Old paper shows a third loose unassigned sentence", cId !== undefined, String(cId));
  await dragThrough(page, await pointInUnit(cId), [await pointInLine(confirmTarget)]);
  await page.waitForTimeout(100);
  const savedByEnter = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.mouse.up();
  const enterResponse = await savedByEnter;
  // 이 화면의 되돌리기 세션 - 끝에서 이 저장을 API로 되돌린다
  const cUndoSession = enterResponse.request().postDataJSON()?.undo?.session;
  await page.waitForLoadState("networkidle");
  const confirmedUnit = (await readUnits()).find((unit) => unit.unit_id === cId);
  check("a drop on another sentence saves that link", enterResponse.ok() && confirmedUnit?.status !== "unassigned" && (confirmedUnit?.target_ids ?? []).includes(confirmTarget), JSON.stringify({ status: confirmedUnit?.status, targets: confirmedUnit?.target_ids, confirmTarget }));

  // 10. 올려 둔 강조는 끄는 동안 되살아나지 않는다(G10) - 이어진 조각에 올려 맞은편 강조를 켠 채 끌고, 끄는 동안 New 칸을 굴려 이음 선이 다시 그려지게 한다.
  // 이어진 조각은 앞 단계가 같은 글로 확정한 Old 문서에 있다 - 그 문서를 연다(고른 줄이 풀리므로 맨 끝에)
  const writtenIds = new Set(written.map((row) => row.target_id));
  const linked = (await readUnits()).find((unit) => unit.target_ids.some((id) => writtenIds.has(id)));
  check("a piece is linked to a written sentence", linked !== undefined);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${linked.document_id}"]`).click();
  await pieceOf(linked.unit_id).waitFor({ timeout: T });
  const partner = written.find((row) => linked.target_ids.includes(row.target_id));
  await openNewDoc(partner.target_doc_id);
  await centre(`[data-testid="assign-new-${partner.target_id}"]`);
  const linkedPoint = await pointInUnit(linked.unit_id);
  await page.mouse.move(linkedPoint.x, linkedPoint.y);
  await page.waitForTimeout(300);
  const hoverMarks = await page.locator(".assign-panes [data-link-hover]").count();
  const paneBox = await page.locator('[data-testid="assign-new"] .pane-body').boundingBox();
  await dragThrough(page, linkedPoint, [{ x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 }]);
  // 창 폭을 바꾸면 이음 선을 다시 재어 그린다(New 문서가 짧으면 굴릴 것이 없다)
  const commitsBeforeRedraw = await page.evaluate(() => window.__commits ?? -1);
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.waitForTimeout(500);
  const redrew = (await page.evaluate(() => window.__commits ?? -1)) > commitsBeforeRedraw;
  const leaked = await page.evaluate(() => ({
    card: document.querySelectorAll('[data-testid="drag-card"]').length,
    marks: document.querySelectorAll(".assign-panes [data-link-hover], .assign-panes [data-link-hot]").length,
  }));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("hovering a linked piece marks the sentence it links to", hoverMarks > 0, String(hoverMarks));
  check("no link highlight while dragging, even after the lines redraw", redrew && leaked.card === 1 && leaked.marks === 0, JSON.stringify({ redrew, ...leaked }));
  await page.setViewportSize(VIEWPORT);

  // 11. 들림(G9) - 한/영 짝 카드는 한 장으로 끌리니 아래 줄에 올려도 카드 전체가 고리 하나로 들린다(윗줄은 네 변, 아래 줄은 위 변 없이).
  // 엿보기 조각(필터 밖, 점선 테두리)은 들지 않는다 - 점선 바로 바깥에 실선 고리가 겹친다. 값은 계산된 box-shadow로 본다(고리 = 퍼짐 1px)
  const readShadow = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow);
  // 짝이 있는 Old 문서를 모두 보이게 연다. 삭제로 확정한 짝은 카드가 아니라 흐린 한 줄로 접히므로(시안 1 D6) 카드로 보이는 짝을 고른다
  const unitsNow = new Map((await readUnits()).map((unit) => [unit.unit_id, unit]));
  const isFoldedDeleted = (unitId) => unitsNow.get(unitId)?.status === "confirmed" && unitsNow.get(unitId)?.decision.disposition === "delete";
  let pairDoc = null;
  for (const doc of (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json()).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${doc.id}/view`, { headers })).json();
    const shownPair = view.pairs.find((pair) => !pair.unit_ids.every(isFoldedDeleted));
    if (shownPair) {
      pairDoc = { id: doc.id, unitId: shownPair.unit_ids[0] };
      break;
    }
  }
  await page.locator('[data-testid="assign-filter-all"]').click();
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${pairDoc.id}"]`).click();
  await pieceOf(pairDoc.unitId).waitFor({ timeout: T });
  const cardRows = page.locator('[data-pane="old"] .strip-card > .strip-row > .strip[data-drag-box]');
  check("the Old document shows a KO/EN pair card", (await cardRows.count()) >= 2);
  const cardTop = await cardRows.first().evaluate((el) => el.dataset.testid);
  const cardBottom = await cardRows.first().evaluate((el) => [...el.closest(".strip-card").querySelectorAll(":scope > .strip-row > .strip")].at(-1).dataset.testid);
  await centre(`[data-testid="${cardTop}"]`);
  await page.waitForTimeout(150);
  const bottomBox = await page.locator(`[data-testid="${cardBottom}"]`).boundingBox();
  await page.mouse.move(bottomBox.x + 40, bottomBox.y + bottomBox.height / 2);
  await page.waitForTimeout(300);
  const lift = { top: await readShadow(`[data-testid="${cardTop}"]`), bottom: await readShadow(`[data-testid="${cardBottom}"]`) };
  check("hovering a pair card's lower row lifts the whole card with one ring", lift.top.includes("0px 0px 0px 1px") && !lift.bottom.includes("0px 0px 0px 1px") && lift.bottom.includes("0px 1px 0px 0px"), JSON.stringify(lift));
  // 다른 상태 거르기 - 접힌 줄이 생기는 필터를 고르고 접힌 줄 하나를 엿보기로 연다
  for (const filter of ["unassigned", "on_hold", "confirmed"]) {
    if ((await page.locator('[data-pane="old"] .fold-line').count()) > 0) break;
    await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
    await page.waitForTimeout(300);
  }
  await page.locator('[data-pane="old"] .fold-line').first().click();
  const peek = page.locator('[data-pane="old"] .strip-row[data-peek] > .strip[data-drag-box]').first();
  await peek.waitFor({ timeout: T });
  await peek.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const peekBox = await peek.boundingBox();
  await page.mouse.move(peekBox.x + 40, peekBox.y + peekBox.height / 2);
  await page.waitForTimeout(300);
  const peekShadow = await peek.evaluate((el) => getComputedStyle(el).boxShadow);
  check("a peek piece does not lift over its dashed border", peekShadow === "none", peekShadow);
  // 뒷정리 - 셋째 줄(c)의 확정을 그 저장의 되돌리기로 거둔다(그 뒤로 기록된 저장이 없다). 배정 지우기는 그 New 문장의 다른 출처를 보류로 돌릴 수 있어 쓰지 않는다.
  // 남겨 두면 뒤 단계(한/영 짝 추천 등)가 이 문장에 출처가 붙은 자료를 본다
  const cUndo = await page.request.post(`${BASE}/api/bundles/${halfBundleId}/decisions/undo`, { headers, data: { session: cUndoSession } });
  check("the step leaves the dropped line unassigned", cUndo.ok() && (await readUnits()).find((unit) => unit.unit_id === cId)?.status === "unassigned", String(cUndo.status()));
});

// 숨긴 도구 - 아직 쓰지 않은 문서(New · from Assign)의 문장 위에 놓기(위 단계에서 떼었다)
await runStep("assign: drag an Old piece onto a sentence of an unwritten document, it sends instead of linking", { drafting: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items;
  const composedDocIds = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/tobe`, { headers })).json()).docs.filter((doc) => doc.entrance === "assign").map((doc) => doc.id);
  const loose = new Map((await readUnits()).filter((unit) => unit.status === "unassigned" && unit.kind === "sentence" && unit.pair_id === null).map((unit) => [unit.unit_id, unit]));
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await openLooseOldDoc(page, halfBundleId);
  const shownIds = await page.locator('[data-pane="old"] .strip[data-strip-unit]').evaluateAll((els) => els.map((el) => Number(el.dataset.stripUnit)));
  const [, bId] = shownIds.filter((id) => loose.has(id));
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const pointInUnit = async (id) => {
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const newPane = page.locator('[data-testid="assign-new"]');
  await newPane.waitFor({ timeout: T });
  const openNewDoc = async (docId) => {
    if ((await newPane.getAttribute("data-doc")) === String(docId)) return;
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), docId, { timeout: T });
  };
  const readMarks = () => page.evaluate(() => ({ cards: document.querySelectorAll('[data-testid="drag-card"]').length }));
  const menu = page.locator('[data-testid="assign-link-menu"]');
  // 그 문장은 잇는 대상이 아니다. 문장 위는 보내기의 놓을 자리라 놓으면 바로 보낸다(잇기가 아니다)
  let composedLine = null;
  for (const docId of composedDocIds) {
    await openNewDoc(docId);
    const line = page.locator('[data-testid="assign-new"] .pg[data-read-only] .new-line[data-target]').first();
    if (await line.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      composedLine = Number(await line.getAttribute("data-target"));
      break;
    }
  }
  check("an unwritten New document with sentences opens", composedLine !== null, composedDocIds.join(","));
  await centre(`[data-testid="assign-new-${composedLine}"]`);
  const composedBox = await page.locator(`[data-testid="assign-new-${composedLine}"]`).boundingBox();
  await dragThrough(page, await pointInUnit(bId), [{ x: composedBox.x + Math.min(60, composedBox.width / 2), y: composedBox.y + composedBox.height / 2 }]);
  await page.waitForTimeout(100);
  const overComposed = await readMarks();
  const composedNote = await page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    lineDrops: document.querySelectorAll('[data-pane="new"] .new-line[data-drop]').length,
  }));
  // 끈 Unit은 미배정이라 어느 칸에도 문장이 없다 - "이미 이 칸에 있다" 거절이 될 수 없다
  const bBefore = (await readUnits()).find((unit) => unit.unit_id === bId);
  check("the dragged unit has no sentence anywhere yet", bBefore?.status === "unassigned" && bBefore.target_ids.length === 0, JSON.stringify(bBefore?.target_ids));
  const sentByDrop = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.mouse.up();
  check("a sentence of an unwritten document is not a link target", overComposed.cards === 1 && composedNote.lineDrops === 0 && composedNote.note.startsWith("→ ") && composedNote.dest === composedNote.note, JSON.stringify({ ...overComposed, ...composedNote }));
  await sentByDrop;
  await page.waitForLoadState("networkidle");
  const sentUnit = (await readUnits()).find((unit) => unit.unit_id === bId);
  check("dropping there sends and confirms at once, not a link", sentUnit?.status !== "unassigned" && (await menu.count()) === 0 && !(sentUnit?.target_ids ?? []).includes(composedLine), JSON.stringify({ status: sentUnit?.status, targets: sentUnit?.target_ids }));
  await page.keyboard.press("ControlOrMeta+z");
  for (let step = 0; step < 30 && (await readUnits()).find((unit) => unit.unit_id === bId)?.status !== "unassigned"; step += 1) await page.waitForTimeout(300);
  check("Ctrl+Z takes the sent sentence back", (await readUnits()).find((unit) => unit.unit_id === bId)?.status === "unassigned");
});

// 끌기 상자 위의 글자 고르기(끌어다 놓기 G3·G12) - 긁어 둔 글자가 남아도 Old 조각의 클릭·Shift+클릭은 그대로이고, Alt를 누르는 동안은 글자 커서다.
// 표 칸 조각을 끌면 표 줄 전체가 끌린다(칸 Unit은 표에 묶여 제 줄이 없다). 저장하지 않는다
await runStep("assign: a text selection does not deaden clicks on Old pieces, Alt shows a text cursor, a table drags from its cells", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-filter-all"]').click();
  await openLooseOldDoc(page, halfBundleId);
  // 짝 없는(줄 하나가 Unit 하나인) 글 조각 셋, 글이 넉넉한 것(조각의 Unit 번호)
  const single = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items.filter((unit) => unit.pair_id === null).map((unit) => unit.unit_id);
  const pieces = await page.locator('[data-pane="old"] .strip[data-kind="piece"][data-drag-box]').evaluateAll((els, ids) => els.filter((el) => ids.includes(Number(el.dataset.stripUnit)) && (el.querySelector(".su")?.textContent ?? "").length > 30).slice(0, 3).map((el) => Number(el.dataset.stripUnit)), single);
  check("the Old paper shows three text pieces", pieces.length === 3, JSON.stringify(pieces));
  const [aId, bId, cId] = pieces;
  const pointIn = async (id, part = 0.5) => {
    await page.locator(`[data-testid="assign-paper-piece-${id}"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el, at) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.max(4, rect.width * at), y: rect.top + rect.height / 2 };
    }, part);
  };
  const isSelected = (id) => page.evaluate((unit) => document.querySelector(`[data-testid="assign-paper-piece-${unit}"]`)?.hasAttribute("data-sel") ?? false, id);
  const isCollapsed = () => page.evaluate(() => window.getSelection()?.isCollapsed ?? true);

  // Alt를 누르는 동안 글자 커서, 떼면(고른 글자 없음) 손가락
  const aStart = await pointIn(aId, 0);
  await page.mouse.move(aStart.x + 20, aStart.y);
  await page.keyboard.down("Alt");
  await page.waitForTimeout(100);
  const altCursor = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => getComputedStyle(el).cursor);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  const restCursor = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => getComputedStyle(el).cursor);
  check("holding Alt shows a text cursor on an Old piece, and a pointer again after", altCursor === "text" && restCursor === "pointer", `${altCursor} -> ${restCursor}`);

  // Alt로 A의 글자를 긁는다 - 글자로 새 Unit 막대가 뜬다
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(aStart.x + 140, aStart.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await wait(page, "assign-carve");
  check("Alt+drag selects text in an Old piece", !(await isCollapsed()));
  // 그냥 B를 누르면 B의 줄을 고르고 긁은 글자와 막대는 사라진다
  const bPoint = await pointIn(bId);
  await page.mouse.click(bPoint.x, bPoint.y);
  await page.waitForTimeout(600);
  const afterClick = { picked: await isSelected(bId), carve: await page.locator('[data-testid="assign-carve"]').count(), collapsed: await isCollapsed() };
  check("a plain click on another Old piece after selecting text picks its row", afterClick.picked && afterClick.carve === 0 && afterClick.collapsed, JSON.stringify(afterClick));
  // 화면 다른 곳에 고른 글자가 있어도 Shift+클릭은 줄을 더한다
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.querySelector('[data-testid="assign-bar"]')));
  const selectedElsewhere = !(await isCollapsed());
  const cPoint = await pointIn(cId);
  await page.keyboard.down("Shift");
  await page.mouse.click(cPoint.x, cPoint.y);
  await page.keyboard.up("Shift");
  const bulk = await page.locator('[data-testid="assign-bulk"]').waitFor({ timeout: 4000 }).then(() => true, () => false);
  check("with text selected elsewhere, Shift+click on an Old piece still adds its row", selectedElsewhere && bulk, JSON.stringify({ selectedElsewhere, bulk }));
  await page.keyboard.press("Escape");

  // 표 칸 조각을 끌면 표 줄 전체 - 표 Unit 번호의 표, 표 조각이 흐려지고, 이미 쓴 문장 위에서 놓을 자리가 된다
  let table = null;
  for (const doc of (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json()).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${doc.id}/view`, { headers })).json();
    const unit = view.units.find((item) => item.kind === "table");
    if (unit) {
      table = { docId: doc.id, unit };
      break;
    }
  }
  check("the bundle has an Old table", table !== null);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${table.docId}"]`).click();
  const cell = page.locator(`[data-testid="assign-paper-piece-${table.unit.id}"] .cell-piece .su`).first();
  await cell.waitFor({ timeout: T });
  // New 칸을 열고 이미 쓴 문서를 띄운다
  const firstText = await pointIn(await page.locator('[data-pane="old"] .strip[data-kind="piece"][data-drag-box]').first().getAttribute("data-strip-unit"));
  await page.mouse.click(firstText.x, firstText.y);
  const written = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers })).json();
  const newPane = page.locator('[data-testid="assign-new"]');
  await newPane.waitFor({ timeout: T });
  const shownNewDoc = await newPane.getAttribute("data-doc");
  if (!written.some((row) => String(row.target_doc_id) === shownNewDoc)) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${written[0].target_doc_id}"]`).click();
  }
  const line = page.locator('[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target] .new-hit').first();
  await line.waitFor({ timeout: T });
  await cell.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const cellBox = await cell.boundingBox();
  const lineBox = await line.boundingBox();
  await dragThrough(page, { x: cellBox.x + 4, y: cellBox.y + cellBox.height / 2 }, [{ x: lineBox.x + 40, y: lineBox.y + lineBox.height / 2 }]);
  await page.waitForTimeout(100);
  const tableDrag = await page.evaluate((id) => ({
    card: document.querySelector('[data-testid="drag-card"] .drag-card-id')?.textContent ?? null,
    src: document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-drag-src") ?? false,
    over: document.querySelectorAll('[data-pane="new"] [data-drop="over"]').length,
    line: document.querySelector("svg[data-drag-line] path")?.getAttribute("d") ? true : false,
  }), table.unit.id);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  check("dragging a table cell piece drags the whole table row", tableDrag.card === table.unit.display_id && tableDrag.src && tableDrag.over === 1 && tableDrag.line, JSON.stringify(tableDrag));
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
  // 카드는 차례로 온다 - 같은 글자 후보(묶음 전체 목록)가 먼저 그려지고 비슷한 문장 후보(줄마다 부름)는 뒤에 온다. 첫 카드만 기다리고 세면
  // 비슷한 문장 카드가 오기 전이라 후보를 놓쳤다. 그 글이 든 카드를 기다린다
  const card = cards.filter({ hasText: targetText }).first();
  const isListed = await card.waitFor({ timeout: T }).then(() => true, () => false);
  check("the candidate is one of the recommendations", isListed, isListed ? "" : (await cards.allInnerTexts()).join(" | ").slice(0, 300));
  if (!isListed) return;
  await card.click();
  // 짝 문장이 더해져도 고른 표시가 켜진다(예전에는 ID 비교라 영영 꺼져 있었다)
  // 고른 표시는 다음 그리기에서 붙는다 - 바로 읽으면 가끔 놓친다
  const isPicked = await card.locator('[data-testid$="-pending"]').waitFor({ timeout: T }).then(() => true, () => false);
  check("the recommendation shows as picked on a KO/EN pair row", isPicked && (await card.getAttribute("aria-pressed")) === "true");
  check("the card says it is not saved yet", (await card.locator('[data-testid$="-pending"]').count()) === 1);
  if (found.partnerId !== null) check("both New sentences of the pair are picked", (await page.locator(`[data-testid="assign-new-pick-${found.partnerId}"]`).getAttribute("aria-pressed")) === "true");
  // 카드 옆 확정 메뉴는 없다(1.2.0 피드백) - 마우스로 눌러도 Enter가 확정 단추다(B1-R1)
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
  check("picking a card opens no in-place menu", (await page.locator("[data-link-menu]").count()) === 0);
  const isShown = await page.waitForFunction((id) => document.querySelector(`[data-pane="new"] [data-testid="assign-new-${id}"]`) !== null, found.targetId, { timeout: T }).then(() => true, () => false);
  check("the New pane moves to the card's sentence", isShown);
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  const savedResponse = await saved;
  check("Enter after picking a card saves the link", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
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
  // New 칸은 줄을 따라가지 않는다(1.2.0 피드백) - "간 곳"으로 그 문서를 연다
  await page.locator(`[data-testid="assign-note-${found.unit.id}"]`).click();
  await page.locator('[data-testid="assign-link-menu-close"]').click();
  const linkedLines = [found.targetId, found.partnerId].filter((id) => id !== null);
  for (const id of linkedLines) await page.locator(`[data-testid="assign-new-${id}"][data-state="picked"]`).waitFor({ timeout: T });
  check("after reload the row is confirmed and its New sentences are shown as its place", true);
  // 이은 New 문장을 마우스로 누르면(글 오른쪽 끝) 끊기 메뉴가 떠 있지 않고 그 문장 상자 안 아래에 단추 줄로 펼쳐진다(사용자 결정 2026-11-19 - 예전에는 선의 New 쪽 끝 옆에 떴다)
  const pickBtn = page.locator(`[data-testid="assign-new-pick-${found.targetId}"]`);
  const pickBox = await pickBtn.boundingBox();
  await pickBtn.click({ position: { x: pickBox.width - 6, y: Math.min(8, pickBox.height / 2) } });
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  await page.waitForFunction(() => document.activeElement?.closest('[data-testid="assign-link-menu"]') !== null, null, { timeout: T });
  const placed = await page.evaluate((id) => {
    const lineEl = document.querySelector(`.new-line[data-target="${id}"]`);
    const menuEl = document.querySelector('[data-testid="assign-link-menu"]');
    const line = lineEl.getBoundingClientRect();
    const menu = menuEl.getBoundingClientRect();
    const text = lineEl.querySelector(".new-text").getBoundingClientRect();
    return { inside: lineEl.contains(menuEl), below: menu.top >= text.bottom - 1, within: menu.left >= line.left - 1 && menu.right <= line.right + 1, drawn: document.querySelector(`[data-testid="assign-link-lines"] [data-link$=":${id}"]`) !== null };
  }, found.targetId);
  check("the unlink menu opens inside the clicked New sentence, under its text", placed.drawn && placed.inside && placed.below && placed.within, JSON.stringify(placed));
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
  // 뒷정리 - 그 저장을 저장한 화면의 되돌리기 세션으로 거둔다(새로 고침 뒤라 화면의 Undo로는 닿지 않는다). 배정 지우기는 New 문장의 다른 출처를 보류로 돌릴 수 있어 쓰지 않는다
  const undone = await page.request.post(`${BASE}/api/bundles/${halfBundleId}/decisions/undo`, { headers, data: { session: savedResponse.request().postDataJSON()?.undo?.session } });
  const left = new Map((await getJson("/units?limit=1000")).items.map((item) => [item.unit_id, item.status]));
  check("the KO/EN pair rows are unassigned again", undone.ok() && [found.unit, found.other].every((unit) => left.get(unit.id) === "unassigned"), `${undone.status()} ${JSON.stringify([found.unit, found.other].map((unit) => left.get(unit.id)))}`);
});

// 칸 제목(제품 명세 §7.13 칸 제목) -옛 제목 짝을 SOP 칸의 칸 제목 자리로 확정하면 결과물 C와 Assign의 엮은 문서 미리 보기에서 칸 머리 옆에 "← OLD-1 §1"로 보인다. 끝에 원래 처분(지우기)으로 되돌린다
await runStep("assign: an old heading confirmed as a slot heading shows on C and on the composed New pane", { drafting: true }, async ({ page, takeShot }) => {
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
  // 하위만 묶는 칸(7 Document Relationships)은 나무에 이름 줄로만 있다 - 단추가 아니고 놓을 자리(data-place)도 아니다. 앱이 채우는 7.2는 나무에 없다
  const groupRow = page.locator(`[data-testid="assign-tree-heading-group:${sop.id}:document_relationships"]`);
  check(
    "a section that only groups sub-sections is a plain heading row in the tree, and the work-instruction list is not there",
    (await groupRow.count()) === 1 &&
      (await groupRow.evaluate((el) => el.tagName !== "BUTTON" && el.closest("[data-place]") === null)) &&
      (await page.locator(`[data-testid="assign-tree-place-slot:${sop.id}:document_relationships"], [data-testid="assign-tree-place-slot:${sop.id}:${WI_LIST_KEY}"]`).count()) === 0 &&
      (await page.locator(`[data-testid="assign-tree-place-slot:${sop.id}:document_relationships.references"]`).count()) === 1,
  );
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
  // 번호 없는 절(5장의 범주)은 머리 글이 키다
  const paneNote = page.locator(`[data-testid="assign-new-heading-note-${section.number ?? section.label}"]`);
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

await runStep("assign: the New pane shows a real table and figure", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 표와 그림을 함께 받은 아직 쓰지 않은 문서를 서버 미리 보기에서 찾는다
  let found = null;
  for (const doc of (await getJson("/tobe")).docs.filter((item) => item.entrance === "assign")) {
    const items = (await getJson(`/outputs/c/docs/${doc.id}?lang=en`)).sections.flatMap((section) => section.items);
    const table = items.find((item) => item.kind === "table" && item.table);
    const figure = items.find((item) => item.kind === "figure" && item.figure);
    if (table && figure) {
      found = { doc, table, figure };
      break;
    }
  }
  check("the bundle has a composed document with a table and a figure", Boolean(found), found ? `${found.doc.code} t${found.table.target_id} f${found.figure.target_id}` : "none");
  if (!found) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${found.doc.id}"]`).click();
  const tableBox = page.locator(`[data-testid="assign-new-${found.table.target_id}"]`);
  await tableBox.scrollIntoViewIfNeeded({ timeout: T });
  // 격자 자리마다 칸 하나(칸 번역은 그 칸 안에 줄로), 칸 새 문장은 서버 순서(행·열·id) 그대로
  const { rows, cols, cells: expectedCells } = found.table.table;
  const tdCount = await tableBox.locator("table.ptbl td").count();
  const cells = await tableBox.locator("table.ptbl td [data-cell-target]").allInnerTexts();
  const expected = expectedCells.map((cell) => cell.text);
  check("the table row draws its cells as a table", tdCount === rows * cols && cells.length === expected.length && cells.every((text, index) => text.trim() === expected[index].trim()), `${tdCount} td, ${cells.length}/${expected.length}`);
  check("the table sits in a side-scrolling box", await tableBox.locator(".ptbl-scroll").evaluate((el) => getComputedStyle(el).overflowX === "auto"));
  // 캡션 줄은 표·그림 위 - 서버 caption 그대로(여러 언어는 줄바꿈), 없으면 쓰지 않은 문서라 "Caption needed"
  const readCaptionLine = async (box, item) => {
    const line = box.locator(":scope > .new-bundle-cap");
    const ok = (await line.count()) === 1 && (await line.evaluate((el) => el.nextElementSibling !== null)) && (item.caption ? (await line.innerText()).trim() === item.caption.trim() : (await line.getAttribute("data-missing")) !== null);
    return { ok, detail: item.caption ?? "missing" };
  };
  const tableCaption = await readCaptionLine(tableBox, found.table);
  check("the table row shows its caption line above it", tableCaption.ok, tableCaption.detail);
  const bodyBlocks = await page.locator('[data-pane="new"] .new-block').count();
  // 그림은 New 칸의 그림 탭에 있다(시안 2 D3) - 본문 탭에는 자리 표시도 없다
  check("the figure is not on the New body tab", (await page.locator(`[data-testid="assign-new-${found.figure.target_id}"]`).count()) === 0);
  await page.locator('[data-testid="assign-new-tab-figures"]').click();
  // 탭을 바꾼 뒤 그림 줄이 그려질 때까지 - 바로 세면 탭 전환 중이라 줄이 없을 때가 있다(기대값은 그대로)
  await page.locator(`[data-testid="assign-new-${found.figure.target_id}"] > .new-bundle-cap + *`).waitFor({ timeout: T });
  const figureCaption = await readCaptionLine(page.locator(`[data-testid="assign-new-${found.figure.target_id}"]`), found.figure);
  check("the figure row shows its caption line above it", figureCaption.ok, figureCaption.detail);
  const figureBox = page.locator(`[data-testid="assign-new-${found.figure.target_id}"]`);
  await figureBox.scrollIntoViewIfNeeded({ timeout: T });
  const image = figureBox.locator("img");
  await image.waitFor({ timeout: T });
  check("the figure row shows the image", await image.evaluate((el) => el.complete && el.naturalWidth > 0));
  check("no text placeholder is left for them", bodyBlocks + (await page.locator('[data-pane="new"] .new-block').count()) === 0);
  await takeShot("sop-assign-new-table-figure.png");
});

// New 표 칸 잇기(시안 2 D5) - Old 줄을 고른 채 이미 쓴 New 표의 칸을 누르면 문장처럼 그 칸에 잇고(그 자리 메뉴의 Confirm), 칩이 칸 위에 붙고, 칩 ×가 끊는다.
// 시드에는 표가 든 이미 쓴 New 문서가 없어 합성 docx 둘(tests.docx_factory)을 새 묶음에 올려 보고 끝에 묶음을 지운다
await runStep("assign: New table - picking an Old line then a New cell links it, the chip sits on the cell, × unlinks", { devUser: "dev.admin" }, async ({ page }) => {
  const headers = { "X-Dev-User": "dev.admin" };
  const backend = resolve(SCRIPT_DIR, "../../../backend");
  const oldFile = resolve(SHOT_DIR, "SYNTHETIC_OLD-88_cell_link.docx");
  const newFile = resolve(SHOT_DIR, "SYNTHETIC_SOP-88_cell_link.docx");
  const build = [
    "import sys",
    "from tests.docx_factory import build_docx, p, tbl",
    "open(sys.argv[1], 'wb').write(build_docx(p('합성 압력') + p('합성 결과를 적는다.')))",
    "open(sys.argv[2], 'wb').write(build_docx(p('1. 합성 절', 'Heading1') + tbl([['합성 항목', '합성 값'], ['합성 압력', '합성 결과']]), headers=[p('합성 새 문서')]))",
  ].join("\n");
  execFileSync(findBackendPython(), ["-c", build, oldFile, newFile], { cwd: backend, stdio: "inherit" });
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC New table cell link", is_synthetic: true } })).json();
  const api = `${BASE}/api/bundles/${created.id}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const oldUp = await page.request.post(`${api}/documents`, { headers, multipart: { side: "old", file: { name: "SYNTHETIC_OLD-88_cell_link.docx", mimeType: mime, buffer: readFileSync(oldFile) } } });
  const newUp = await page.request.post(`${api}/documents`, { headers, multipart: { side: "new", doc_type: "sop", file: { name: "SYNTHETIC_SOP-88_cell_link.docx", mimeType: mime, buffer: readFileSync(newFile) } } });
  const oldDoc = await oldUp.json();
  check("an Old document and a written New document with a table are uploaded", oldUp.status() === 201 && newUp.status() === 201 && oldDoc.status === "ready" && (await newUp.json()).status === "ready", `${oldUp.status()} ${newUp.status()}`);
  const unit = (await getJson(`/documents/${oldDoc.id}/view`)).units.find((item) => item.text === "합성 압력");
  const readCells = async () => (await getJson("/written-sentences")).find((row) => row.kind === "table")?.table?.cells ?? [];
  const cellsBefore = await readCells();
  const cell = cellsBefore.find((item) => item.row === 1 && item.col === 0);
  check("the written table lists its cells with sources and revision", Boolean(unit && cell) && cellsBefore.every((item) => Array.isArray(item.source_unit_ids) && typeof item.revision === "number"), `${cellsBefore.length} cells`);
  if (!unit || !cell) return;
  await page.goto(`${BASE}/bundles/${created.id}/assign`);
  await wait(page, "assign-bar");
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-view-two"]').click();
  const cellBox = page.locator(`[data-testid="assign-new-cell-${cell.target_id}"]`);
  await cellBox.scrollIntoViewIfNeeded({ timeout: T });
  check("a cell is not pickable before an Old line is picked", (await cellBox.getAttribute("data-pickable")) === null && (await page.locator(`[data-testid="assign-new-cell-pick-${cell.target_id}"]`).count()) === 0);
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(want), unit.display_id, { timeout: T });
  await page.locator(`[data-testid="assign-new-cell-${cell.target_id}"][data-pickable]`).waitFor({ timeout: T });
  check("with an Old line picked the cell becomes a pickable box", true);
  await page.locator(`[data-testid="assign-new-cell-pick-${cell.target_id}"]`).click();
  const confirm = page.locator('[data-testid="assign-link-menu-confirm"]');
  await confirm.waitFor({ timeout: T });
  check("clicking the cell picks it like a sentence and opens the link menu", (await cellBox.getAttribute("data-state")) === "picked");
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/groups/save"), { timeout: T });
  await confirm.click();
  check("Confirm saves the link", (await saved).ok());
  const chip = page.locator(`[data-testid="assign-new-src-${cell.target_id}-${unit.id}"]`);
  await chip.waitFor({ timeout: T });
  check("the source chip sits on the cell", (await chip.evaluate((el, id) => el.closest(`[data-cell-target="${id}"]`) !== null, cell.target_id)));
  const linked = await readCells();
  const linkedCell = linked.find((item) => item.target_id === cell.target_id);
  check("the cell's new sentence takes the Old line as its source", JSON.stringify(linkedCell?.source_unit_ids) === JSON.stringify([unit.id]) && linkedCell?.status === "confirmed", JSON.stringify(linkedCell));
  const others = (cells) => JSON.stringify(cells.filter((item) => item.target_id !== cell.target_id).map((item) => [item.target_id, item.status, item.text, item.source_unit_ids, item.revision]));
  check("the other cells of the table stay as they were", others(linked) === others(cellsBefore));
  await cellBox.hover();
  const cleared = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/decisions/clear"), { timeout: T });
  await page.locator(`[data-testid="assign-new-src-x-${cell.target_id}-${unit.id}"]`).click();
  check("× on the chip unlinks the Old line", (await cleared).ok());
  await chip.waitFor({ state: "detached", timeout: T });
  const after = await readCells();
  const unlinked = after.find((item) => item.target_id === cell.target_id);
  check("the cell is back to unassigned with no source, the others untouched", JSON.stringify(unlinked?.source_unit_ids) === "[]" && unlinked?.status === "unassigned" && others(after) === others(cellsBefore), JSON.stringify(unlinked));
  const bundle = await (await page.request.get(api, { headers })).json();
  check("the cell-link bundle is removed", (await page.request.delete(`${api}?revision=${bundle.revision}`, { headers })).ok());
});

// New 칸 템플릿 보기(MD 1 F9 · F8c) - 같은 줄을 회사 템플릿 모양으로: 결과물 C와 같은 줄 · 같은 번호, SOP는 영어 → 한글 절반, 짝은 두 절반에 같은 번호
/** 한/영 짝이 든 아직 쓰지 않은 문서(doc_type) - 같은 묶음 키에 영어·한글 문장이 다 있는 줄이 있는 첫 문서 */

await runStep("assign: New template view draws the same lines as Output C in two halves", { drafting: true }, async ({ page, takeShot }) => {
  const found = await findTemplateDoc(page, "sop");
  check("the bundle has a composed SOP with a KO/EN pair", Boolean(found), found ? `${found.doc.code} ${found.pair.target_id}/${found.partner.target_id}` : "none");
  if (!found) return;
  await openTemplateView(page, found.doc.id);
  const paper = page.locator('[data-testid="assign-new-tpl"]');
  check("the template paper is an SOP", (await paper.getAttribute("data-doc-type")) === "sop");
  check("the cover table fills only Document No. with the To-Be number", (await getText(page, "assign-new-tpl-doc-no")).trim() === found.doc.code);
  check("the contents list is drawn by the app", (await page.locator('[data-testid="assign-new-tpl-toc"] .tpl-toc-line').count()) >= 9);
  const enBeforeKo = await page.evaluate(() => {
    const en = document.querySelector('[data-testid="assign-new-tpl-half-en"]');
    const ko = document.querySelector('[data-testid="assign-new-tpl-half-ko"]');
    return Boolean(en && ko && en.compareDocumentPosition(ko) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check("the English half comes before the Korean half", enBeforeKo);
  // 템플릿의 줄 = 결과물 C(엮은 문서)의 줄 - 언어 문장은 제 절반에 한 번, 표·그림은 두 절반에
  const drawn = await paper.evaluate((el) => [...el.querySelectorAll("[data-row]")].map((node) => node.getAttribute("data-row")));
  const expected = new Set(found.items.map((item) => `t:${item.target_id}`));
  check("the template holds exactly the composed lines", new Set(drawn).size === expected.size && drawn.every((key) => expected.has(key)), `${new Set(drawn).size}/${expected.size}`);
  const sentences = found.items.filter((item) => item.kind === "sentence" && (item.lang === "en" || item.lang === "ko"));
  const counts = await Promise.all(sentences.map((item) => page.locator(`[data-testid="assign-new-tpl-${item.lang}-${item.target_id}"]`).count()));
  check("each KO/EN sentence is drawn once, in its own half", counts.every((count) => count === 1), counts.join(","));
  // 짝은 두 절반에 같은 표시(번호 · 기호)로
  const markOf = async (lang, id) => ((await page.locator(`[data-testid="assign-new-tpl-${lang}-${id}"] .tpl-mark`).first().textContent()) ?? "").trim();
  const enMark = await markOf("en", found.pair.target_id);
  const koMark = await markOf("ko", found.partner.target_id);
  check("the pair shows the same mark in both halves", enMark === koMark, `${enMark} | ${koMark}`);
  if (found.pair.number) check("a numbered line keeps its Output C number", enMark === found.pair.number, `${enMark} vs ${found.pair.number}`);
  check("the view is remembered in this browser", (await page.evaluate(() => window.localStorage.getItem("sopa.assign.newTemplate"))) === "1");
  await takeShot("sop-assign-new-template.png");
  await page.reload();
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${found.doc.id}"]`).click();
  await wait(page, "assign-new-tpl");
  check("after a reload the template view is still on", (await page.locator('[data-testid="assign-new-view-template"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="assign-new-view-basic"]').click();
  await page.locator('[data-pane="new"] .new-sheet').waitFor({ timeout: T });
  check("Basic brings back the usual New pane", (await page.locator('[data-testid="assign-new-tpl"]').count()) === 0);
});

await runStep("assign: New template view lights a pair in both halves and fills a missing translation", { drafting: true }, async ({ page, takeShot }) => {
  const found = await findTemplateDoc(page, "sop");
  check("the bundle has a composed SOP with a KO/EN pair", Boolean(found));
  if (!found) return;
  await openTemplateView(page, found.doc.id);
  const enLine = page.locator(`[data-testid="assign-new-tpl-en-${found.pair.target_id}"]`);
  await enLine.scrollIntoViewIfNeeded({ timeout: T });
  await enLine.click();
  const koLine = page.locator(`[data-testid="assign-new-tpl-ko-${found.partner.target_id}"]`);
  await koLine.and(page.locator("[data-sel]")).waitFor({ timeout: T });
  check("picking a line lights its pair in both halves", (await enLine.getAttribute("data-sel")) !== null && (await koLine.getAttribute("data-sel")) !== null);
  check("picking a line picks its Old row", (await page.locator('[data-pane="old"] .strip[data-sel]').count()) > 0);
  check("the template stays on the same document", (await page.locator('[data-testid="assign-new-tpl"]').count()) === 1);
  await takeShot("sop-assign-new-template-pair.png");
  const fill = page.locator('[data-testid^="assign-new-tpl-"][data-testid$="-fill"]').first();
  if ((await fill.count()) === 0) {
    check("no No translation slot in this document (nothing to fill)", true);
    return;
  }
  await fill.scrollIntoViewIfNeeded({ timeout: T });
  check("the No translation slot is an orange dashed box", await fill.evaluate((el) => getComputedStyle(el).borderStyle === "dashed"));
  await fill.click();
  // 칸에 확정한 한 언어 줄이면 결정 칸의 번역 만들기 · 직접 쓰기로 포커스가 간다(그 단추가 없는 줄이면 줄만 골라진다)
  const focused = await page
    .waitForFunction(() => ["assign-make-other", "assign-write-other"].includes(document.activeElement?.getAttribute("data-testid") ?? ""), null, { timeout: 3000 })
    .then(() => true, () => false);
  const offered = (await page.locator('[data-testid="assign-make-other"], [data-testid="assign-write-other"]').count()) > 0;
  check("a missing translation leads to Make / Write the other language", focused || !offered, `focused=${focused} offered=${offered}`);
});

await runStep("assign: New template view draws a WI in chapter tables, Korean half first", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const wi = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/tobe`, { headers })).json()).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "wi");
  check("the bundle has a WI not written yet", Boolean(wi));
  if (!wi) return;
  await openTemplateView(page, wi.id);
  check("the template paper is a WI", (await page.locator('[data-testid="assign-new-tpl"]').getAttribute("data-doc-type")) === "wi");
  const koBeforeEn = await page.evaluate(() => {
    const ko = document.querySelector('[data-testid="assign-new-tpl-half-ko"]');
    const en = document.querySelector('[data-testid="assign-new-tpl-half-en"]');
    return Boolean(en && ko && ko.compareDocumentPosition(en) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check("the Korean half comes before the English half", koBeforeEn);
  const heads = await page.locator('[data-testid="assign-new-tpl-half-ko"] .tpl-wi thead th').allInnerTexts();
  check("each step is a chapter table headed Chapter N.", heads.length > 0 && heads.every((text) => /^(Chapter \d+\.|No step|단계 없음)/.test(text.trim())), heads.join(" | "));
  await takeShot("sop-assign-new-template-wi.png");
});

// 템플릿 보기에 끌어 놓기(MD 1 F9) - 자리 목록 모델(place-spot-model)이 기본 보기와 같은 규칙으로 판단한다. 마우스는 걸음으로 움직인다(dragTo는 쓰지 않는다)
/** 미배정·짝 없는 Old 문장 하나를 고르고, 아직 쓰지 않은 SOP를 New 칸 템플릿 보기로 연다 - 끌기 도우미를 돌려준다 */

await runStep("assign: template view drag lights open spots, names the destination and refuses app-built spots with a reason", { drafting: true }, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  const ctx = await openTemplateDrag(page);
  if (!ctx?.category) return;
  const { sop, pointInUnit, pointInSpot, readCard, category } = ctx;
  let saveRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/groups/save")) saveRequests += 1;
  });
  const rowId = (lang) => `assign-new-tpl-${lang}-${category.location_key}-row`;
  await dragThrough(page, await pointInUnit(), [await pointInSpot(rowId("en"))]);
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => ({
    open: document.querySelectorAll(".tpl-paper [data-tpl-open]").length,
    note: document.querySelector('[data-testid="assign-tpl-drag-note"]') !== null,
  }));
  check("open spots light up while dragging", during.open > 0, JSON.stringify(during));
  check("the decision panel tells where to drop instead of the list", during.note);
  const onRow = await readCard();
  check("over a category row the card names that category", !onRow.refused && onRow.note.startsWith("→ ") && onRow.note.includes(category.label.split(" › ").at(-1)), onRow.note);
  check("over a category row the card ends with that category", onRow.dest.startsWith("→ ") && onRow.note.startsWith(onRow.dest), `${onRow.dest} / ${onRow.note}`);
  await takeShot("sop-assign-template-drag.png");
  // 한글 절반의 같은 범주 행도 같은 자리
  const koPoint = await pointInSpot(rowId("ko"));
  await page.mouse.move(koPoint.x, koPoint.y, { steps: 8 });
  const onKo = await readCard();
  check("the Korean half names the same destination", onKo.note === onRow.note, `${onKo.note} / ${onRow.note}`);
  // 못 놓는 곳 - 표가 빨갛게(거절) 되고 까닭이 뜬다. 그 사이 React는 다시 그리지 않는다
  const refusedSpots = [
    ["the app-built contents", "assign-new-tpl-toc"],
    ["the cover table", "assign-new-tpl-cover"],
    ["a group title (7)", "assign-new-tpl-en-document_relationships-head"],
    ["7.2 Work Instructions", "assign-new-tpl-en-document_relationships.work_instructions-head"],
    ["8 Attachment 1", "assign-new-tpl-en-attachments-system"],
    ["the chapter-2 Site table", "assign-new-tpl-en-scope-grid"],
  ];
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (const [label, testId] of refusedSpots) {
    if ((await page.locator(`[data-testid="${testId}"]`).count()) === 0) continue;
    const point = await pointInSpot(testId);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    const card = await readCard();
    check(`over ${label} the card is refused with a reason`, card.refused && card.note.length > 0, card.note);
    check(`over ${label} the card shows no destination`, card.dest === "", card.dest);
  }
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over the template", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
  // 못 놓는 곳에 놓으면 아무 일도 없다
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ open: document.querySelectorAll("[data-tpl-open]").length, cards: document.querySelectorAll('[data-testid="drag-card"]').length, note: document.querySelector('[data-testid="assign-tpl-drag-note"]') !== null }));
  check("a refused drop saves nothing and leaves no marks", saveRequests === 0 && after.open === 0 && after.cards === 0 && !after.note, JSON.stringify({ saveRequests, ...after }));
  check("the template view stays on the SOP", (await page.locator('[data-testid="assign-new"]').getAttribute("data-doc")) === String(sop.id));
});

await runStep("assign: template view drag onto a category row or between numbered lines confirms like the basic view, Undo takes it back", { drafting: true }, async ({ page }) => {
  const ctx = await openTemplateDrag(page);
  if (!ctx?.category) return;
  const { getJson, sop, unit, pointInUnit, pointInSpot, readCard, composed, category } = ctx;
  const readSection = async (key) => (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections.find((section) => section.location_key === key);
  // 놓으면 그 자리 메뉴 없이 바로 확정한다(기본 보기와 같다) - 놓기가 보낸 저장 요청에서 끈 Unit이 출처인 최상위 새 문장
  const dropAndSave = async (label) => {
    const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
    const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
    await page.mouse.up();
    const body = (await request).postDataJSON();
    const ok = (await response).ok();
    await page.waitForLoadState("networkidle");
    check(`${label}: the drop saves at once with no in-place menu`, ok && (await page.locator('[data-testid="assign-link-menu"]').count()) === 0);
    return body.targets.filter((target) => !target.parent_key && target.source_unit_ids.includes(unit.unit_id));
  };
  const undo = async (label, key) => {
    // 되돌리기 알림은 10초 머문다 - 그사이 보기를 오가며 확인했으면 사라졌을 수 있어 Ctrl+Z로 되돌린다(같은 되돌리기)
    const action = page.locator('[data-testid="toast-ok"] [data-testid^="toast-action-"]').last();
    if (await action.isVisible()) await action.click();
    else await page.keyboard.press("ControlOrMeta+z");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const section = await readSection(key);
    check(`${label}: Undo takes the line back out`, !section.items.some((item) => item.source_unit_ids.includes(unit.unit_id)));
  };

  // 1. 범주 행 - 그 범주 끝(줄이 있으면 마지막 줄 뒤, 없으면 자리 없음)에 확정되고, 기본 보기에서도 같은 줄이 보인다
  await dragThrough(page, await pointInUnit(), [await pointInSpot(`assign-new-tpl-en-${category.location_key}-row`)]);
  const sent = await dropAndSave("category row");
  const lastId = category.items.at(-1)?.target_id;
  check(
    "the drop saves into that category at its end",
    sent.length === 1 && sent[0].slot_key === category.location_key && JSON.stringify(sent[0].position) === JSON.stringify(lastId === undefined ? undefined : { after_target_id: lastId }),
    JSON.stringify(sent.map((target) => [target.slot_key, target.position])),
  );
  const placed = (await readSection(category.location_key)).items.find((item) => item.source_unit_ids.includes(unit.unit_id));
  check("the line now sits in that category", Boolean(placed));
  if (placed) {
    const inRow = await page.locator(`:is([data-testid="assign-new-tpl-en-${category.location_key}-row"], [data-testid="assign-new-tpl-ko-${category.location_key}-row"]) [data-row="t:${placed.target_id}"]`).count();
    check("the template draws it in the category row", inRow > 0);
    await page.locator('[data-testid="assign-new-view-basic"]').click();
    const basic = await page.locator(`[data-testid="assign-new-${placed.target_id}"]`).waitFor({ timeout: T }).then(() => true, () => false);
    check("Basic shows the same line", basic);
    await page.locator('[data-testid="assign-new-view-template"]').click();
    await wait(page, "assign-new-tpl");
  }
  await undo("category row", category.location_key);

  // 2. 번호를 세는 칸의 줄 아래 끝 - 표에 "after 6.x.y (becomes …)", 줄 사이 선, 놓으면 그 묶음 뒤 자리로 확정
  const numbered = composed.sections.find((section) => section.counts_lines && section.na_reason === null && section.items.some((item) => item.number !== null && item.lang === "en"));
  // 데모 시드의 반쯤 한 SOP에는 번호를 세는 칸에 영어 번호 줄이 없을 수 있다 - 그때는 이 절반을 건너뛴다
  if (!numbered) {
    console.log("  (no section with numbered English lines in this seed - skipped the between-lines drop)");
    return;
  }
  const first = numbered.items.find((item) => item.number !== null && item.lang === "en");
  await dragThrough(page, await pointInUnit(), [await pointInSpot(`assign-new-tpl-en-${first.target_id}`, "bottom")]);
  await page.waitForTimeout(100);
  const card = await readCard();
  const gapShown = await page.evaluate(() => [...document.querySelectorAll('[data-testid="drop-line"]')].some((el) => !el.hidden));
  check("between numbered lines the card names the number the line will get", !card.refused && card.note.includes(`after ${first.number}`) && card.note.includes("becomes"), card.note);
  check("between numbered lines the card ends with the number only", /^→ \S+$/.test(card.dest) && card.note.includes(`becomes ${card.dest.slice(2)}`), `${card.dest} / ${card.note}`);
  check("a drop line is drawn between the lines", gapShown);
  const gapSent = await dropAndSave("between numbered lines");
  const ids = numbered.items.map((item) => item.target_id);
  check("the drop saves the place after that line's block", gapSent.length === 1 && gapSent[0].slot_key === numbered.location_key && ids.includes(gapSent[0].position?.after_target_id), JSON.stringify(gapSent.map((target) => [target.slot_key, target.position])));
  await undo("between numbered lines", numbered.location_key);
});

// 원문 글의 "표 3"은 올릴 때 그 표에 이어진다 - 고른 줄의 참조 카드가 대상을 보이고, 떼고 다시 이으면 처음 상태로 돌아온다
await runStep("assign: a table reference shows its target and can be detached and linked again", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  let found = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const unit = view.units.find((item) => item.caption_refs.some((ref) => ref.kind === "table" && ref.number === 3 && ref.target_unit_id !== null && ref.state === "linked"));
    if (unit) {
      found = { doc, unit, ref: unit.caption_refs.find((ref) => ref.kind === "table" && ref.number === 3), units: view.units };
      break;
    }
  }
  check("an old sentence refers to table 3", found !== null);
  if (!found) return;
  const target = found.units.find((unit) => unit.id === found.ref.target_unit_id);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${found.doc.id}"]`).click();
  await page.waitForLoadState("networkidle");
  await selectRowById(page, found.unit.display_id);
  const line = page.locator(`[data-testid="assign-caption-ref-${found.ref.id}"]`);
  await line.waitFor({ timeout: T });
  check("the card shows the reference in the sentence's language", (await getText(page, `assign-caption-ref-label-${found.ref.id}`)).trim() === "표 3", await getText(page, `assign-caption-ref-label-${found.ref.id}`));
  check("the card shows the linked table", (await getText(page, `assign-caption-ref-target-${found.ref.id}`)).trim() === target.display_id, target.display_id);
  // 줄 끝 단추는 줄에 올렸을 때만 보인다
  const actions = line.locator(".row-actions");
  const restOpacity = await actions.evaluate((el) => getComputedStyle(el).opacity);
  await line.hover();
  await page.waitForFunction((id) => getComputedStyle(document.querySelector(`[data-testid="assign-caption-ref-${id}"] .row-actions`)).opacity === "1", found.ref.id, { timeout: T });
  check("row-end buttons show on hover only", restOpacity === "0", restOpacity);
  await takeShot("sop-assign-caption-ref.png");
  await page.locator(`[data-testid="assign-caption-ref-detach-${found.ref.id}"]`).click();
  await page.locator(`[data-testid="assign-caption-ref-${found.ref.id}"][data-state="detached"]`).waitFor({ timeout: T });
  check("detaching keeps the line as not followed", (await getText(page, `assign-caption-ref-target-${found.ref.id}`)).trim() === "Not followed");
  await line.hover();
  await page.locator(`[data-testid="assign-caption-ref-link-${found.ref.id}"]`).click();
  await page.locator(`[data-testid="assign-caption-ref-${found.ref.id}"][data-state="linked"]`).waitFor({ timeout: T });
  const saved = (await getJson(`/documents/${found.doc.id}/view`)).units.find((unit) => unit.id === found.unit.id).caption_refs.find((ref) => ref.id === found.ref.id);
  check("linking again saves the same table by a person", saved.state === "linked" && saved.target_unit_id === target.id && saved.origin === "human", JSON.stringify(saved));
});

await runStep("assign: TOC block folds the contents, Restore returns one line and undo puts it back", {}, async ({ page, takeShot }) => {
  const toc = await findTocBundle(page);
  check("the demo seed has the contents bundle", toc !== null);
  if (!toc) return;
  await page.goto(`${BASE}/bundles/${toc.id}/assign`);
  const head = page.locator('[data-testid^="assign-paper-noise-head-"]');
  await head.first().waitFor({ timeout: T });
  const key = (await head.first().getAttribute("data-testid")).replace("assign-paper-noise-head-", "");
  check("the contents are one folded block", (await head.count()) === 1 && (await head.getAttribute("aria-expanded")) === "false");
  check("the block head says how many lines", (await head.innerText()).includes(`${TOC_LINES} lines`), await head.innerText());
  const headText = await head.innerText();
  check("the folded head says deleted and why", headText.includes("DELETED") && headText.includes("Reason: The app builds the new contents"), headText);
  check("no contents line is drawn as a normal piece while folded", (await page.locator('[data-testid^="assign-paper-noise-line-"]').count()) === 0);
  const before = await readAllCount(page);
  check("the remaining count leaves the contents lines out", before === toc.progress.total && before === 4, `${before} | ${toc.progress.total}`);

  await head.click();
  await page.waitForFunction((testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-expanded") === "true", `assign-paper-noise-head-${key}`, { timeout: T });
  const lines = page.locator('[data-testid^="assign-paper-noise-line-"]');
  check("expanding shows every contents line", (await lines.count()) === TOC_LINES);
  check("a dashed break sits between the Korean and English contents", (await page.locator(".toc-line[data-break]").count()) >= 1);
  check("the head offers Write a reason and Restore all", (await page.locator(`[data-testid="assign-paper-noise-reason-${key}"]`).isVisible()) && (await page.locator(`[data-testid="assign-paper-noise-clear-${key}"]`).isVisible()));
  check("every line has Restore at its end, picked or not", (await page.locator('[data-testid^="assign-paper-noise-unit-clear-"]').count()) === TOC_LINES);
  // 결정 칸(F12 G2) - 머리를 누르면 블록이 골라진다: 상태 칩 없는 머리, 줄 수와 언어별 수, 펼치기 · 모두 삭제 취소, 까닭 글, 따로 할 일 없음 · 꺼진 Confirm
  await wait(page, "assign-noise-panel");
  check("the panel head reads Contents · 8 lines without a status chip", (await getText(page, "assign-noise-head")).trim() === `Contents · ${TOC_LINES} lines` && (await page.locator('[data-testid="assign-row-status"]').count()) === 0, await getText(page, "assign-noise-head"));
  check("section 1 counts the lines by language", (await getText(page, "assign-noise-shape")).includes("Korean 4 · English 3 · then 1"), await getText(page, "assign-noise-shape"));
  check("section 1 offers collapse and Restore all", (await getText(page, "assign-noise-toggle")).includes("Collapse") && (await getText(page, "assign-noise-clear")).includes("Restore all"));
  check("section 2 explains instead of recommending", (await page.locator('[data-testid="assign-noise-why"]').isVisible()) && (await page.locator(".assign-pick .dest-card").count()) === 0);
  check("section 3 has nothing to do and Confirm is off", (await getText(page, "assign-noise-nothing")).trim() === "Nothing to do here" && (await page.locator('[data-testid="assign-primary"]').isDisabled()));
  const after = lines.filter({ hasText: TOC_AFTER_TEXT });
  const afterId = (await after.getAttribute("data-testid")).replace("assign-paper-noise-line-", "");
  await after.click();
  check("picking a line keeps Restore open on that line only", (await page.locator('.mbtn.reveal[data-testid^="assign-paper-noise-unit-clear-"]').count()) === 1 && (await page.locator(`.mbtn.reveal[data-testid="assign-paper-noise-unit-clear-${afterId}"]`).isVisible()));
  // 결정 칸(F12 G3) - 줄 하나: "목차 · n행", 그 줄 글과 삭제 취소
  await page.waitForFunction((n) => document.querySelector('[data-testid="assign-noise-head"]')?.textContent?.trim() === `Contents · line ${n}`, TOC_LINES, { timeout: T });
  check("the panel shows the picked line and Restore", (await getText(page, "assign-noise-shape")).includes(TOC_AFTER_TEXT) && (await getText(page, "assign-noise-clear")).startsWith("Restore") && !(await getText(page, "assign-noise-clear")).includes("all"));
  await takeShot("sop-assign-toc-open.png");
  await page.locator('[data-testid="assign-noise-clear"]').click();
  await waitTocLines(page, TOC_LINES - 1);
  await page.locator(`[data-testid="assign-paper-piece-${afterId}"]`).waitFor({ timeout: T });
  check("the returned line is a normal piece and counts again", (await readAllCount(page)) === before + 1);
  // G4 - 돌린 줄이 골라져 보통 줄(Unassigned)의 결정 칸이 된다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Unassigned"), null, { timeout: T });
  check("selection moves to the returned line as an Unassigned row", (await page.locator('[data-testid="assign-noise-panel"]').count()) === 0);

  await page.locator('[data-testid="assign-undo"]').click();
  await waitTocLines(page, TOC_LINES);
  check("undo puts the line back into the contents", (await page.locator(`[data-testid="assign-paper-piece-${afterId}"]`).count()) === 0 && (await readAllCount(page)) === before);
});

await runStep("assign: TOC block Restore all returns the whole block and undo folds it back", {}, async ({ page }) => {
  const toc = await findTocBundle(page);
  if (!toc) return;
  await page.goto(`${BASE}/bundles/${toc.id}/assign`);
  const head = page.locator('[data-testid^="assign-paper-noise-head-"]');
  await head.first().waitFor({ timeout: T });
  const key = (await head.first().getAttribute("data-testid")).replace("assign-paper-noise-head-", "");
  const before = await readAllCount(page);
  // J로 줄을 밟으면 목차 블록이 한 자리로 골라진다(접힌 채) - 남은 수는 그대로
  await page.keyboard.press("j");
  await wait(page, "assign-noise-panel");
  check("J lands on the folded contents block", (await getText(page, "assign-noise-shape")).includes("folded") && (await head.getAttribute("aria-expanded")) === "false" && (await readAllCount(page)) === before, await getText(page, "assign-noise-shape"));
  await page.locator('[data-testid="assign-noise-toggle"]').click();
  await page.waitForFunction((testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-expanded") === "true", `assign-paper-noise-head-${key}`, { timeout: T });
  check("the panel's Expand opens the block in the paper", true);
  await page.keyboard.press("j");
  await page.locator('[data-testid="assign-row-status"]').waitFor({ timeout: T });
  check("the next J goes on to the first body row", (await page.locator('[data-testid="assign-noise-panel"]').count()) === 0);
  await page.keyboard.press("k");
  await wait(page, "assign-noise-panel");
  await page.locator('[data-testid="assign-noise-clear"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="assign-paper-noise-head-"]').length === 0, null, { timeout: T });
  check("every contents line becomes a normal row", (await readAllCount(page)) === before + TOC_LINES);
  await page.locator('[data-testid="assign-undo"]').click();
  await waitTocLines(page, TOC_LINES);
  check("undo folds the block back, closed", (await page.locator('[data-testid^="assign-paper-noise-head-"]').getAttribute("aria-expanded")) === "false" && (await readAllCount(page)) === before);
});

await runStep("assign: band heading - one heading line with 7.4 in the number cell, Back to band table, Undo makes it a heading again", {}, async ({ page, takeShot }) => {
  const toc = await findTocBundle(page);
  check("the demo seed has the contents bundle", toc !== null);
  if (!toc) return;
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${toc.id}/documents`, { headers })).json();
  const readView = async () => (await page.request.get(`${BASE}/api/bundles/${toc.id}/documents/${docs[0].id}/view`, { headers })).json();
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView();
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const band = (await readView()).units.find((unit) => unit.kind === "heading" && unit.table_id !== null);
  check("the band table is a heading line from upload", band !== undefined && band.number?.value === BAND_NUMBER);
  if (!band) return;
  await page.goto(`${BASE}/bundles/${toc.id}/assign`);
  const piece = page.locator(`[data-testid="assign-paper-piece-${band.id}"]`);
  await piece.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  // 표가 아니라 글 조각 하나 - 번호는 번호 칸(조각 밖 왼쪽)에 한 번, 조각 글은 제목만
  check("it is drawn as one text piece, not a table", (await piece.getAttribute("data-kind")) === "piece");
  const pieceText = await piece.innerText();
  check("the piece shows the title without the number", pieceText.includes(BAND_TITLE) && !pieceText.includes(BAND_NUMBER), pieceText);
  const rowText = await piece.locator("xpath=..").innerText();
  check("the number shows once, in the number cell", rowText.split(BAND_NUMBER).length - 1 === 1, rowText);
  await piece.click();
  await wait(page, "assign-shape-band-back");
  const line = await getText(page, `assign-shape-line-${band.id}`);
  check("the Shape line reads the title only", line.includes(BAND_TITLE) && !line.includes(BAND_NUMBER), line);
  check("a band heading has no Turn into sentences button", (await page.locator(`[data-testid="assign-shape-to_sentence-${band.id}"]`).count()) === 0);
  await takeShot("sop-assign-band-heading.png");
  await page.locator('[data-testid="assign-shape-band-back"]').click();
  const table = await waitView((view) => !view.units.some((unit) => unit.id === band.id));
  const tableUnit = table?.units.find((unit) => unit.kind === "table" && unit.table_id === band.table_id);
  check("Back to band table makes it one table line again", tableUnit !== undefined);
  if (tableUnit) await page.locator(`[data-testid="assign-paper-piece-${tableUnit.id}"]`).waitFor({ timeout: T });
  // 한 편집이라 Undo 한 번에 같은 제목 줄(같은 Unit id)로 돌아온다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the same heading line back", (await waitView((view) => view.units.some((unit) => unit.id === band.id && unit.kind === "heading"))) !== null);
  await piece.waitFor({ timeout: T });
});

// 결과물 A(API) - 위치 칸은 띠 표 번호와 "띠 표", 원문 칸은 제목만(F11)
await runStep("assign: band heading - Output A puts it at § 7.4 · 띠 표 with the title only", {}, async ({ page }) => {
  const toc = await findTocBundle(page);
  if (!toc) return;
  const headers = { "X-Dev-User": "qa.member" };
  const rows = await (await page.request.get(`${BASE}/api/bundles/${toc.id}/outputs/a?lang=ko`, { headers })).json();
  const row = rows.find((item) => item.source_text === BAND_TITLE);
  check("Output A has the band heading row", row !== undefined);
  if (!row) return;
  check("its location is the band number and Band table", row.location.section === BAND_NUMBER && row.location.place === "띠 표", JSON.stringify(row.location));
});

await runStep("assign: nested table - unwrapping the work table puts the value table between its cell paragraphs and turns the inner band into a heading line", {}, async ({ page, takeShot }) => {
  const nested = await openNestedBundle(page);
  check("the demo seed has the nested table bundle", nested !== null);
  if (!nested) return;
  const before = await nested.readView();
  const [outer, band, value] = before.tables;
  check("the inner tables carry their place in the outer cell", value.anchor !== null && band.is_band && outer.anchor === null, JSON.stringify(before.tables));
  const outerUnit = readTableUnit(before, outer);
  await page.goto(`${BASE}/bundles/${nested.bundle.id}/assign`);
  const piece = page.locator(`[data-testid="assign-paper-piece-${outerUnit.id}"]`);
  await piece.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${outerUnit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${outerUnit.id}"]`).click();
  const view = await nested.waitView((item) => item.tables[0].is_layout);
  check("Unwrap table unwraps the work table", view !== null);
  if (view === null) return;
  check("the inner band table is unwrapped with it", view.tables[1].is_layout === true && view.tables[2].is_layout === false);
  const heading = view.units.find((unit) => unit.kind === "heading" && unit.table_id === band.id);
  const valueUnit = readTableUnit(view, value);
  const [first, second] = NESTED_CHECK.map((text) => view.units.find((unit) => unit.text === text));
  check("the band is a heading line and the value table is still one table line", heading !== undefined && valueUnit !== undefined);
  if (!heading || !valueUnit || !first || !second) return;
  await page.locator(`[data-testid="assign-paper-piece-${valueUnit.id}"]`).waitFor({ timeout: T });
  check("the band heading is drawn as a text piece", (await page.locator(`[data-testid="assign-paper-piece-${heading.id}"]`).getAttribute("data-kind")) === "piece");
  check("the value table is drawn as a table", (await page.locator(`[data-testid="assign-paper-piece-${valueUnit.id}"]`).getAttribute("data-kind")) === "table");
  // 제 행 자리 - 칸의 첫 문단 아래, 둘째 문단 위(바깥 표 뒤가 아니다). 전환이 끝난 뒤의 자리로 잰다
  await waitForOldMotion(page);
  const [topFirst, topValue, topSecond] = [await readTop(page, first.id), await readTop(page, valueUnit.id), await readTop(page, second.id)];
  check("the value table sits between the two paragraphs of its cell", topFirst < topValue && topValue < topSecond, `${topFirst} < ${topValue} < ${topSecond}`);
  const valueRow = page.locator(`[data-testid="assign-paper-piece-${valueUnit.id}"]`).locator("xpath=..");
  check("the outer rail runs through the inner table line", (await valueRow.locator(".unwrap-rail").count()) === 1);
  check("the outer table has its ↺ Back to table head", (await page.locator(`[data-testid="assign-paper-unwrap-head-${outer.id}"]`).count()) >= 1);
  await takeShot("sop-assign-nested.png");
  // 바깥 · 안쪽 띠 표가 한 편집이라 Undo 한 번에 처음 표 한 줄로
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo wraps both back in one step", (await nested.waitView((item) => !item.tables[0].is_layout && !item.tables[1].is_layout && item.units.some((unit) => unit.id === outerUnit.id))) !== null);
  await piece.waitFor({ timeout: T });
});

// 문단 박스(쪼개기 규칙 2) - 시드 "SYNTHETIC 10 문단 박스": 한 문단에 한글 문장 둘 뒤 영어 문장 둘. 문장마다가 아니라 언어마다 박스 하나이고 둘이 짝 카드 하나다
const PARAGRAPH_TITLE = "SYNTHETIC 10 문단 박스";
const PARAGRAPH_BOXES = ["탱크를 비운다. 밸브를 닫는다.", "Drain the tank completely. Close the outlet valve."];

await runStep("assign: paragraph boxes - one paragraph is one box per language and the two make one pair card", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === PARAGRAPH_TITLE);
  check("the demo seed has the paragraph box bundle", bundle !== undefined);
  if (!bundle) return;
  const api = `${BASE}/api/bundles/${bundle.id}`;
  const docs = await (await page.request.get(`${api}/documents`, { headers })).json();
  const view = await (await page.request.get(`${api}/documents/${docs[0].id}/view`, { headers })).json();
  const sentences = view.units.filter((unit) => unit.kind === "sentence");
  check("the mixed paragraph is two boxes, one per language", JSON.stringify(sentences.map((unit) => [unit.text, unit.lang])) === JSON.stringify([[PARAGRAPH_BOXES[0], "ko"], [PARAGRAPH_BOXES[1], "en"]]), JSON.stringify(sentences.map((unit) => unit.text)));
  check("the document reads as KO/EN interleaved", docs[0].language_layout === "ko_en_interleaved", docs[0].language_layout);
  check("the two boxes are one KO/EN pair", sentences.length === 2 && sentences[0].pair_id !== null && sentences[0].pair_id === sentences[1].pair_id);
  if (sentences.length !== 2) return;
  await page.goto(`${BASE}/bundles/${bundle.id}/assign`);
  const pieces = sentences.map((unit) => page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`));
  for (const piece of pieces) await piece.waitFor({ timeout: T });
  const card = page.locator(".strip-card", { has: pieces[0] });
  check("both boxes sit in one pair card", (await card.count()) === 1 && (await card.locator(`[data-testid="assign-paper-piece-${sentences[1].id}"]`).count()) === 1);
  await takeShot("sop-assign-paragraph-boxes.png");
});

// 본문 앞부분 · 개정 이력(쪼개기 먼저 §7 R3) - 시드 "SYNTHETIC 10 문단 박스"의 둘째 문서: 표지 글 · 결재 표 · Summary of Changes, 1장 · 2장, 개정 이력. 끝에 편집을 되돌려 시드를 그대로 둔다
const FRONT_CODE = "SOP-ABC-1060";
const FRONT_REASON = "SYNTHETIC cover is not moved";

await runStep("assign: front matter - folded blocks with buttons, U and R on a line, Shift+U, Body starts here, and the Excel remark", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === PARAGRAPH_TITLE);
  const api = `${BASE}/api/bundles/${bundle?.id}`;
  const doc = bundle ? (await (await page.request.get(`${api}/documents`, { headers })).json()).find((item) => item.doc_code === FRONT_CODE) : undefined;
  check("the demo seed has the front matter document", doc !== undefined);
  if (!doc) return;
  const readView = async () => (await page.request.get(`${api}/documents/${doc.id}/view`, { headers })).json();
  const listNoise = (view, kind) => view.units.filter((unit) => unit.noise_kind === kind && unit.group_unit_id === null);
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if (isDone(await readView())) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const before = await readView();
  const front = listNoise(before, "front");
  const history = listNoise(before, "history");
  check("chapter 1 and the history chapter split the document", front.length === 3 && history.length === 3, JSON.stringify([front.length, history.length]));
  await page.goto(`${BASE}/bundles/${bundle.id}/assign`);
  await wait(page, "assign-old-doc");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const heads = page.locator('[data-testid^="assign-paper-noise-head-"]');
  const head = page.locator(`[data-testid="assign-paper-noise-head-${front[0].id}"]`);
  await head.waitFor({ timeout: T });
  const texts = await heads.allInnerTexts();
  check("two folded blocks say what was deleted and why", texts.length === 2 && texts[0].includes("Front matter · 3 lines · Reason: Before chapter 1") && texts[1].includes("Change history · 3 lines · Reason: Change history"), JSON.stringify(texts));
  check("the head buttons are there while folded", (await page.locator('[data-testid^="assign-paper-noise-clear-"]').count()) === 2 && (await page.locator(`[data-testid="assign-paper-noise-reason-${front[0].id}"]`).isVisible()) && (await head.getAttribute("aria-expanded")) === "false");
  await head.click();
  const title = page.locator(`[data-testid="assign-paper-noise-line-${front[0].id}"]`);
  const pickTitle = async () => {
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    // 고른 줄을 다시 누르면 고름이 풀린다 - 사유를 쓴 뒤처럼 이미 골라져 있으면 누르지 않는다
    const picked = page.locator(`.toc-line[data-picked] [data-testid="assign-paper-noise-line-${front[0].id}"]`);
    if ((await picked.count()) === 0) await title.click();
    await picked.waitFor({ timeout: T });
  };
  await title.waitFor({ timeout: T });
  check("the table is one line with its size", (await page.locator(`[data-testid="assign-paper-noise-line-${front[1].id}"]`).innerText()).trim() === "Table 1 (2×2)");
  await pickTitle();
  await takeShot("sop-assign-front-matter.png");
  // Del은 삭제된 줄에서 아무것도 하지 않고, U는 그 줄만 삭제 취소
  let saves = 0;
  page.on("request", (item) => {
    if (item.url().includes("/groups/save")) saves += 1;
  });
  check("the deleted line's Confirm is the blocked confirm button", (await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")) === "blocked" && (await page.locator('[data-testid="assign-primary"]').isDisabled()));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await page.keyboard.press("u");
  await page.locator(`[data-testid="assign-paper-piece-${front[0].id}"]`).waitFor({ timeout: T });
  check("U restores the picked line only", await waitView((view) => listNoise(view, "front").length === 2 && view.units.find((unit) => unit.id === front[0].id)?.status === "unassigned"));
  await page.keyboard.press("Control+z");
  check("undo deletes it again", await waitView((view) => listNoise(view, "front").length === 3));
  // R - 그 줄의 사유
  await head.waitFor({ timeout: T });
  await pickTitle();
  await page.keyboard.press("r");
  await wait(page, "assign-noise-modal");
  await page.locator('[data-testid="assign-noise-modal-text"]').fill(FRONT_REASON);
  await page.locator('[data-testid="assign-noise-modal-confirm"]').click();
  check("R writes the reason of that line", await waitView((view) => view.units.filter((unit) => unit.noise_reason === FRONT_REASON).length === 1));
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes("Different reasons"), `assign-paper-noise-head-${front[0].id}`, { timeout: T });
  check("the head says the lines have different reasons", true);
  const rows = await (await page.request.get(`${api}/outputs/a?lang=en`, { headers })).json();
  check("Excel A's Remark is the written reason, the others the set phrase", JSON.stringify(rows.filter((item) => item.noise_kind === "front").map((item) => item.remark)) === JSON.stringify([FRONT_REASON, "Before chapter 1", "Before chapter 1"]));
  // 보통 줄을 고른 채 블록 줄의 사유 단추를 누르면 그 줄이 골라진다 - 창을 닫고 누른 Enter가 앞서 고른 줄을 확정하지 않는다
  const bodyLine = before.units.find((unit) => unit.text.startsWith("2."));
  await page.locator(`[data-testid="assign-paper-piece-${bodyLine.id}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="assign-paper-piece-${bodyLine.id}"]`).click();
  await wait(page, "assign-row-id");
  await page.locator(`[data-testid="assign-paper-noise-unit-reason-${front[0].id}"]`).click();
  await wait(page, "assign-noise-modal");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-noise-modal"]').waitFor({ state: "detached", timeout: T });
  await wait(page, "assign-noise-panel");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Enter on a deleted line confirms nothing, also after its buttons were pressed", saves === 0 && (await page.locator('[data-testid="assign-noise-panel"]').count()) === 1, String(saves));
  // 오른쪽 칸의 사유 단추를 마우스로 눌러 연 창을 닫으면 포커스는 원문이고 Space는 미리보기다
  await page.locator('[data-testid="assign-noise-reason"]').click();
  await wait(page, "assign-noise-modal");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-noise-modal"]').waitFor({ state: "detached", timeout: T });
  await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T });
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  check("Space previews after the reason window was opened by mouse", (await page.locator('[data-testid="assign-noise-modal"]').count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-space-preview"]').waitFor({ state: "detached", timeout: T });
  // Shift+U - 블록 전체, Ctrl+Z 한 번에 사유까지 돌아온다
  await pickTitle();
  await page.keyboard.press("Shift+U");
  check("Shift+U restores the whole block", await waitView((view) => listNoise(view, "front").length === 0));
  await head.waitFor({ state: "detached", timeout: T });
  await page.keyboard.press("Control+z");
  check("one undo deletes the block again with its reason", await waitView((view) => listNoise(view, "front").length === 3 && view.units.some((unit) => unit.noise_reason === FRONT_REASON)));
  // 우클릭 여기부터 본문 - 2장에서 시작하면 1장의 두 줄이 앞부분이 된다
  const start = before.units.find((unit) => unit.text.startsWith("2."));
  const piece = page.locator(`[data-testid="assign-paper-piece-${start.id}"]`);
  await head.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-menu");
  await page.locator('[data-testid="assign-ctx-start_body"]').click();
  check("Body starts here deletes everything before the line", await waitView((view) => listNoise(view, "front").length === 5 && view.units.find((unit) => unit.id === start.id)?.noise_kind === null));
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes("5 lines"), `assign-paper-noise-head-${front[0].id}`, { timeout: T });
  await page.keyboard.press("Control+z");
  check("one undo puts the start back", await waitView((view) => listNoise(view, "front").length === 3));
  // 사유까지 되돌려 시드를 그대로 둔다
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes("3 lines"), `assign-paper-noise-head-${front[0].id}`, { timeout: T });
  await page.keyboard.press("Control+z");
  check("the seed is left as it was", await waitView((view) => view.units.every((unit) => unit.noise_reason === "")));
});

await runStep("assign: nested table - an inner table unwraps again and ↺ Back to table wraps only the pressed layer", {}, async ({ page }) => {
  const nested = await openNestedBundle(page);
  if (!nested) return;
  const before = await nested.readView();
  const [outer, band, , access] = before.tables;
  const unwrapped = await nested.edit({ type: "set_layout_table", table_id: outer.id, is_layout: true });
  check("the work table is unwrapped first", unwrapped.ok(), String(unwrapped.status()));
  const view = await nested.readView();
  const accessUnit = readTableUnit(view, access);
  await page.goto(`${BASE}/bundles/${nested.bundle.id}/assign`);
  const piece = page.locator(`[data-testid="assign-paper-piece-${accessUnit.id}"]`);
  await piece.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  // 안쪽 표도 같은 표 벗기기
  await wait(page, `assign-shape-table_layout-${accessUnit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${accessUnit.id}"]`).click();
  const inner = await nested.waitView((item) => item.tables[3].is_layout);
  check("the inner access table unwraps into sentence lines", inner !== null && inner.units.some((unit) => unit.text === "관리자" && unit.table_id === access.id && unit.group_unit_id === null));
  await wait(page, `assign-paper-unwrap-head-${access.id}`);
  check("the inner table has its own ↺ Back to table head", (await getText(page, `assign-paper-rewrap-${access.id}`)).trim() === "↺ Back to table");
  // 바깥만 다시 표로 - 안쪽 권한 표는 벗긴 그대로, 바깥과 함께 제목 줄이 된 띠 표는 함께 표로
  const waitGroupLoad = watchGroupLoads(page);
  await page.locator(`[data-testid="assign-paper-rewrap-${outer.id}"]`).click();
  const wrapped = await nested.waitView((item) => !item.tables[0].is_layout);
  check("Back to table wraps the work table", wrapped !== null);
  check("the inner access table stays unwrapped", wrapped?.tables[3].is_layout === true);
  check("the inner band goes back to a table with the outer table", wrapped !== null && readTableUnit(wrapped, band) !== undefined);
  await page.locator(`[data-testid="assign-paper-unwrap-head-${access.id}"]`).waitFor({ timeout: T });
  const innerIds = new Set((inner?.units ?? []).map((unit) => unit.id));
  check("the screen follows the new table line and loads its group", await waitGroupLoad((wrapped?.units ?? []).filter((unit) => !innerIds.has(unit.id)).map((unit) => unit.id)));
  await nested.undo(3); // 다시 표로 → 안쪽 벗기기 → 바깥 벗기기
  check("the seed is back as it was", (await nested.waitView((item) => item.tables.every((table) => !table.is_layout) && item.units.some((unit) => unit.id === readTableUnit(before, outer).id))) !== null);
});

await runStep("assign: nested table - Output A locates an inner table line from the outside in", {}, async ({ page }) => {
  const nested = await openNestedBundle(page);
  if (!nested) return;
  const [outer, , , access] = (await nested.readView()).tables;
  for (const table of [outer, access]) {
    const response = await nested.edit({ type: "set_layout_table", table_id: table.id, is_layout: true });
    check(`table ${table.table_index + 1} unwraps`, response.ok(), String(response.status()));
  }
  const rows = await (await page.request.get(`${nested.api}/outputs/a?lang=ko`, { headers: nested.headers })).json();
  const row = rows.find((item) => item.source_text === "관리자");
  check("its place starts at the outer cell", row?.location.place === "표 1 · 3행 2열 › 표 4 · 2행 1열", JSON.stringify(row?.location));
  await nested.undo(2);
});

// Enter = 오른쪽 칸 확정 단추(설계 2026-11-25 §6 S1, 명세 B1) - 포커스가 어디 있어도 같고, 마우스로 누른 오른쪽 칸 단추 뒤의 Space는 미리보기다
await runStep("assign: enter - it is the confirm button wherever the focus is, and Space previews after a mouse press", { drafting: true }, async ({ page, takeShot }) => {
  const isSave = (item) => item.url().includes("/groups/save") && item.method() === "POST";
  // 되돌린 줄이 다시 골라질 때까지 - 응답 뒤에 고름이 옮겨 가며 오른쪽 칸의 펼침이 그 줄의 것으로 바뀐다
  const undo = async (rowText) => {
    const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
    await page.keyboard.press("Control+z");
    await undone;
    // 짝이면 고른 박스가 앞에 서서 차례가 다를 수 있다
    const toSet = (text) => text.trim().split(" · ").sort().join(" · ");
    for (let tries = 0; tries < 60 && toSet(await rowIds(page)) !== toSet(rowText); tries += 1) await page.waitForTimeout(250);
    check("undo picks the row again", toSet(await rowIds(page)) === toSet(rowText), `${await rowIds(page)} | ${rowText}`);
    await page.waitForLoadState("networkidle");
  };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await setPaneView(page, "two");
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  const ids = await rowIds(page);
  // 나무 잎을 누른 직후 - 기다림 없이 ↵
  await pickFirstPlace(page);
  const label = ((await page.locator('[data-testid="assign-primary"]').textContent()) ?? "").trim();
  check("the confirm button names where the row goes", label.startsWith("Confirm → "), label);
  await takeShot("sop-assign-enter.png");
  // 포커스를 나무 단추에 되돌려 두어도 ↵는 그 단추가 아니라 확정이다(AC1)
  await page.locator('[data-testid^="assign-tree-place-"]:not([data-testid^="assign-tree-place-heading:"]):not([disabled])').first().focus();
  const request = page.waitForRequest(isSave, { timeout: T });
  await page.keyboard.press("Enter");
  check("Enter confirms while a tree leaf has the focus", (await (await request).response()).ok());
  await page.waitForLoadState("networkidle");
  check("and moves on to the next row", (await rowIds(page)) !== ids);
  await undo(ids);

  // 대시보드를 올린 채 - 비모달 판은 글쇠를 막지 않는다(AC2)
  // 다시 연다 - 펼쳐 둔 목록이 남아 있으면 pickFirstPlace가 접는다
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, ids.split(" · ")[0]);
  await page.locator('[data-testid="assign-dash"]').hover();
  await wait(page, "assign-dash-panel");
  const beforeKey = await rowIds(page);
  await page.keyboard.press("j");
  await page.waitForFunction((text) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== text, beforeKey, { timeout: T });
  await page.keyboard.press("k");
  await page.waitForFunction((text) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === text, beforeKey, { timeout: T });
  await page.mouse.move(5, 5);
  await page.locator('[data-testid="assign-dash-panel"]').waitFor({ state: "detached", timeout: T });
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-dash"]').hover();
  await wait(page, "assign-dash-panel");
  const overDash = page.waitForRequest(isSave, { timeout: T });
  await page.keyboard.press("Enter");
  check("J and Enter work while the dashboard is open", (await (await overDash).response()).ok());
  await page.waitForLoadState("networkidle");
  await page.mouse.move(5, 5);
  await undo(beforeKey);

  // 오른쪽 칸 단추를 마우스로 누른 뒤 Space는 미리보기, 글쇠로 간 단추의 Space는 그 단추
  const near = page.locator('[data-testid="assign-acc-near"]');
  const isOpenBefore = await near.getAttribute("aria-expanded");
  await near.click();
  await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T });
  check("a mouse press in the right panel gives the focus back to the paper", true);
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  check("Space after a mouse press opens the preview and leaves the button alone", (await near.getAttribute("aria-expanded")) !== isOpenBefore);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-space-preview"]').waitFor({ state: "detached", timeout: T });
  await near.focus();
  await page.keyboard.press(" ");
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-acc-near"]')?.getAttribute("aria-expanded") === want, isOpenBefore, { timeout: T });
  check("Space presses a button reached by key, without the preview", (await page.locator('[data-testid="assign-space-preview"]').count()) === 0);
});

await runStep("assign: enter - with nothing picked it confirms the first Suggested card", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const primary = page.locator('[data-testid="assign-primary"]');
  let saveRequests = 0;
  page.on("request", (item) => {
    if (item.url().includes("/groups/save") && item.method() === "POST") saveRequests += 1;
  });
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  check("the seed has the AI demo bundle", (await aiRow.count()) > 0);
  if ((await aiRow.count()) === 0) return;
  const aiId = Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", ""));
  const openAiRow = async () => {
    await page.goto(`${BASE}/bundles/${aiId}/assign`);
    await wait(page, "assign-bar");
    await page.locator('[data-testid="assign-filter-ai_suggested"]').click();
    await page.keyboard.press("j");
    await wait(page, "assign-rec-0");
  };

  // AI 첫 카드 - 이름에 갈 곳과 ✦ AI as is, ↵ 한 번이 제안 id를 싣고 확정한다(AC3)
  await openAiRow();
  await page.locator('[data-testid="assign-primary"][data-state="choose"]').waitFor({ timeout: T });
  const label = ((await primary.textContent()) ?? "").trim();
  check("the button says where the first card goes and that it is AI as is", label.startsWith("Confirm → ") && label.includes("✦ AI as is"), label);
  await takeShot("sop-assign-enter-card.png");
  const picked = await rowIds(page);
  const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
  await page.keyboard.press("Enter");
  const sent = await request;
  const sentOk = (await sent.response()).ok();
  const suggestionId = sent.postDataJSON().suggestion_id;
  check("one Enter saves the first card with its suggestion id", sentOk && typeof suggestionId === "number", String(suggestionId));
  await page.waitForLoadState("networkidle");
  const readAdoption = async () => (await (await page.request.get(`${BASE}/api/bundles/${aiId}/ai/suggestions/${suggestionId}`, { headers })).json()).adoption;
  check("the suggestion counts as taken as is", (await readAdoption()) === "as_is", String(await readAdoption()));
  const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("Control+z");
  check("one Undo takes it back", (await undone).ok() && (await readAdoption()) === null);
  await page.waitForLoadState("networkidle");

  // 첫 카드가 삭제면 위험 색 + Delete(AC4) - 그 줄의 제안을 삭제 후보로 바꿔 보인다
  const isMatchList = (url) => url.pathname.endsWith("/ai/suggestions") && url.searchParams.get("kind") === "match";
  await page.route(isMatchList, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, items: body.items.map((item) => (item.id === suggestionId ? { ...item, content: { ...item.content, shape: "delete_candidate" } } : item)) } });
  });
  await openAiRow();
  await selectRowById(page, picked.split(" · ")[0]);
  await page.locator('[data-testid="assign-primary"].danger').waitFor({ timeout: T });
  check("a first card that deletes is a red Delete button", ((await primary.textContent()) ?? "").includes("Delete"), await primary.textContent());
  await page.unroute(isMatchList);

  // 추천이 비면 꺼지고, ↵는 까닭 알림 · 목록 강조일 뿐 요청이 없다(AC5)
  await page.route("**/new-candidates", (route) => route.fulfill({ json: [] }));
  await page.route("**/match/identical-candidates", (route) => route.fulfill({ json: [] }));
  await page.route(isMatchList, (route) => route.fulfill({ json: { total: 0, items: [] } }));
  await page.goto(`${BASE}/bundles/${aiId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, picked.split(" · ")[0]);
  await page.locator('[data-testid="assign-primary"][data-state="blocked"]').waitFor({ timeout: T });
  // 추천을 받는 동안도 blocked다(까닭은 "still loading") - 다 받은 뒤의 까닭을 본다
  await page.waitForLoadState("networkidle");
  check("with no Suggested card the button is off", await primary.isDisabled());
  const savesBefore = saveRequests;
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]', { hasText: "Pick a destination first" }).waitFor({ timeout: T });
  check("Enter then only says to pick a destination and points at the list", saveRequests === savesBefore && (await page.locator(".assign-pick .dest-acc[data-flash]").count()) === 1);
  await page.unrouteAll();
});

await runStep("assign: enter - an AI order preview turns the button into Apply AI order, Esc keeps the order", { allowConsoleErrors: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  const status = await page.request.get(`${BASE}/api/bundles/${halfBundleId}/ai/status`, { headers });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  // 제안은 응답을 끼워 넣는다 - 벗긴 줄을 거꾸로 놓자는 제안 하나(벗긴 뒤 화면이 목록을 다시 읽을 때)
  let asked = null;
  const adoptions = [];
  const isOrderList = (url) => url.pathname.endsWith("/ai/suggestions") && url.searchParams.get("kind") === "unwrap_order";
  const readLines = async () => (await readView(asked.docId)).units.filter((item) => item.kind === "cell_sentence" && item.table_id === asked.tableId && item.group_unit_id === null).map((item) => item.id);
  await page.route(isOrderList, async (route) => {
    const lines = asked === null || adoptions.length > 0 ? [] : await readLines();
    const items = lines.length < 2 ? [] : [{ id: 999999, kind: "unwrap_order", result: "applied", adoption: null, content: { table_id: asked.tableId, unit_ids: [...lines].reverse() } }];
    await route.fulfill({ json: { total: items.length, items } });
  });
  await page.route("**/ai/suggestions/*/adoption", async (route) => {
    adoptions.push(route.request().postDataJSON().adoption);
    await route.fulfill({ json: { id: 999999, kind: "unwrap_order", result: "applied", adoption: adoptions.at(-1), content: {} } });
  });
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const tableId = unit.table_id;
  asked = { docId: doc.id, tableId };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  await wait(page, `assign-paper-unwrap-head-${tableId}`);
  await wait(page, `assign-paper-unwrap-ai-apply-${tableId}`);
  await waitForOldMotion(page);
  const lineIds = await readLines();
  const readPaperOrder = () => page.evaluate((ids) => [...document.querySelectorAll('[data-testid^="assign-paper-piece-"]')]
    .map((el) => Number(el.getAttribute("data-testid").replace("assign-paper-piece-", "")))
    .filter((id, index, all) => ids.includes(id) && all.indexOf(id) === index), lineIds);
  const order = await readPaperOrder();
  await page.locator(`[data-testid="assign-paper-piece-${order[0]}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="assign-paper-piece-${order[0]}"]`).click();
  await page.locator('[data-testid="assign-primary"][data-state="order"]').waitFor({ timeout: T });
  check("the button reads Apply AI order", (await getText(page, "assign-primary")).includes("Apply AI order"), await getText(page, "assign-primary"));
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="assign-paper-unwrap-ai-apply-${tableId}"]`).waitFor({ state: "detached", timeout: T });
  check("Esc keeps the order and closes the preview", adoptions.join() === "rejected" && JSON.stringify(await readPaperOrder()) === JSON.stringify(order), adoptions.join());
  await page.unrouteAll();
  // 벗기기를 되돌린다
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator(`[data-testid="assign-paper-unwrap-head-${tableId}"]`).waitFor({ state: "detached", timeout: T });
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
  // AI는 판단을 쓰지 않는다 - 사람이 ↵를 누르거나(첫 카드로 바로, assign: enter 단계) A(Use)로 초안을 채운 뒤 ↵로 확정한다(설계 2026-11-19-ai-suggest-only D2)
  check("the row is not decided before Use", (await rowStatus(page)).includes("Unassigned"), await rowStatus(page));
  await page.keyboard.press("Shift+A");
  // 글쇠로 부른 Use는 고른 뒤 Confirm으로 포커스를 옮긴다 - 그 다음 ↵가 확정이다
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "assign-primary", null, { timeout: T });
  const saved = page.waitForRequest((request) => request.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  check("A then Enter saves the used suggestion", typeof JSON.parse((await saved).postData() ?? "{}").suggestion_id === "number");
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 1, before, { timeout: T });
  check("A then Enter confirms the AI suggestion", true);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign?edit=first`);
  // 그림은 그림 탭의 카드다(시안 2 D3)
  await openFigures(page);
  await page.locator('[data-testid^="figure-"]').first().waitFor({ timeout: T });
  check("figure image loads on the paper", true);
});

// New 쪽 AI 제안 필터(MD 2 S4) - 칩을 켜고 Old 줄을 고르면 다른 줄의 AI 제안은 접히고 확정된 줄은 흐려진다. 켠 채로 새로 고쳐도 켜져 있다
await runStep("assign: New-side AI filter keeps only the picked line's suggestions", {}, async ({ page, takeShot }) => {
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
  const chip = page.locator('[data-testid="assign-new-ai-only"]');
  if ((await chip.count()) === 0) {
    console.log("  (no New pane in this bundle - skipped)");
    return;
  }
  check("the chip starts off", (await chip.getAttribute("aria-pressed")) === "false");
  // 켜기 전에 줄을 하나 고른다(AI 제안 필터 탭에서 첫 줄)
  await page.locator('[data-testid="assign-filter-ai_suggested"]').click();
  await page.locator('[data-testid="assign-filter-ai_suggested"]').blur();
  await page.keyboard.press("j");
  await wait(page, "assign-rec-0");
  await chip.click();
  check("the chip turns on", (await chip.getAttribute("aria-pressed")) === "true");
  check("a picked line means no 'pick a line' hint", (await page.locator('[data-testid="assign-new-ai-hint"]').count()) === 0);
  // 다른 줄의 AI 제안이 있으면 칸마다 띠 하나로 접힌다 - 띠 글에 숨긴 수가 있고 누르면 펼쳐진다
  const bands = page.locator('[data-testid^="assign-new-ai-hidden-"]');
  const bandCount = await bands.count();
  const dimCount = await page.locator('.new-item[data-ai-view="dim"]').count();
  console.log(`  (hidden bands ${bandCount}, dimmed rows ${dimCount}, picked line's tags ${await page.locator('[data-testid^="assign-new-ai-tag-"]').count()})`);
  if (bandCount > 0) {
    check("a band tells how many suggestions it hides", /\d/.test(await bands.first().innerText()));
    const before = await page.locator(".new-item").count();
    await bands.first().click();
    check("clicking a band opens that section's suggestions", (await page.locator(".new-item").count()) > before);
  }
  await takeShot("sop-assign-new-ai-filter.png");
  // 알약 - 고른 줄의 제안이 다른 New 문서에 있을 때만 뜬다. 누르면 그 문서가 열리고 알약이 돌아가기가 된다
  const pill = page.locator('[data-testid="assign-new-ai-open"]');
  if ((await pill.count()) > 0 && (await pill.getAttribute("data-kind")) === "open") {
    await pill.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="assign-new-ai-open"]')?.getAttribute("data-kind") === "back", null, { timeout: T });
    check("the pill opens the other New document and becomes Back", true);
    await page.locator('[data-testid="assign-new-ai-open"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="assign-new-ai-open"]')?.getAttribute("data-kind") === "open", null, { timeout: T });
    check("Back returns to the document that was open", true);
  } else {
    console.log("  (the picked suggestion is in the open document - no pill)");
  }
  // 새로 고쳐도 켜진 채, 끄면 거르지 않는다
  await page.reload();
  await wait(page, "assign-bar");
  check("the chip stays on after a reload", (await page.locator('[data-testid="assign-new-ai-only"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="assign-new-ai-only"]').click();
  check("the chip turns off again", (await page.locator('[data-testid="assign-new-ai-only"]').getAttribute("aria-pressed")) === "false");
  check("off means nothing is hidden or dimmed", (await page.locator('[data-testid^="assign-new-ai-hidden-"], .new-item[data-ai-view]').count()) === 0);
});

await runStep("assign: Space preview - hold shows the sheet, drag moves it, release closes", {}, async ({ page, takeShot }) => {
  // 양 단 보기 - 비교 Excel A
  await openFirstAssign(page, "two");
  const sheet = page.locator('[data-testid="assign-space-preview"]');
  console.log(`  (small hint shown: ${(await page.locator('[data-testid="assign-space-hint"]').count()) > 0})`);

  // 단추에 포커스가 있으면 Space는 그 단추의 것이다
  const rowNext = page.locator('[data-testid="assign-row-next"]').first();
  if ((await rowNext.count()) > 0) {
    await rowNext.focus();
    await page.keyboard.down(" ");
    check("Space on a focused button does not open the sheet", (await sheet.count()) === 0);
    await page.keyboard.up(" ");
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  }

  await page.keyboard.down(" ");
  await wait(page, "assign-space-preview");
  check("holding Space shows the sheet", (await sheet.getAttribute("data-state")) === "held");
  await wait(page, "assign-space-preview-body");
  check("in two panes the sheet is Excel A", (await sheet.getAttribute("data-sheet")) === "comparison" && (await sheet.locator(".space-sheet-tab").innerText()) === "A Comparison");
  check("the picked line is painted", (await page.locator('[data-testid="assign-space-preview-body"] tr[data-mark="picked"]').count()) > 0);
  check("the sheet stays inside the window", await sheet.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1));
  await takeShot("sop-assign-space-preview.png");
  const frame = page.locator('[data-testid="assign-space-preview-sheet"]');
  if ((await frame.getAttribute("data-movable")) !== null) {
    const body = page.locator('[data-testid="assign-space-preview-body"]');
    const before = await body.evaluate((el) => el.style.transform);
    const box = await frame.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    check("dragging the sheet moves its body", (await body.evaluate((el) => el.style.transform)) !== before);
    await page.keyboard.up(" ");
    check("releasing Space after a drag closes the sheet, even after a short press", (await sheet.count()) === 0);
  } else {
    console.log("  (the sheet fits - nothing to drag)");
    await page.waitForTimeout(300); // 짧게 탁(250ms 미만)이 되지 않게
    await page.keyboard.up(" ");
    check("releasing a long hold closes the sheet", (await sheet.count()) === 0);
  }
});

await runStep("assign: Space preview - a short tap keeps it open, Esc and another tap close it", {}, async ({ page }) => {
  // 한 단 보기 - 그 문서의 문단 Excel
  await openFirstAssign(page, "one");
  const sheet = page.locator('[data-testid="assign-space-preview"]');
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  check("a short tap keeps the sheet open", (await sheet.getAttribute("data-state")) === "kept");
  check("in one pane the sheet is the paragraph Excel", (await sheet.getAttribute("data-sheet")) === "paragraphs");
  check("the head says how to close it", (await page.locator('[data-testid="assign-space-preview-state"]').innerText()).includes("Esc"));
  // 열어 둔 동안에도 줄 옮기기는 그대로 - 시트는 남는다
  await page.keyboard.press("j");
  check("moving to the next line keeps the sheet", (await sheet.count()) === 1);
  await page.keyboard.press("Escape");
  check("Esc closes a kept sheet", (await sheet.count()) === 0);

  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  await page.keyboard.press(" ");
  check("another short tap closes it", (await sheet.count()) === 0);
  await setPaneView(page, "two"); // 다음 단계들은 양 단에서 시작한다
});

// 문단 시트의 고른 행 - 고른 줄이 확정 삭제한 줄이면 picked 대신 deleted(빨간 음영)로 칠한다(B9). Excel A에는 deleted가 없다
const PARAGRAPH_PICKED_ROW = '[data-testid="assign-space-preview-body"] tr[data-mark="picked"], [data-testid="assign-space-preview-body"] tr[data-mark="deleted"]';

// 같은 박스를 다시 누르면 고른 행이 같아 가운데 맞추기가 돌지 않았다 - 끌어 둔 시트가 그대로였다(Assign 피드백 2026-11-20 항목 10)
await runStep("assign: Space preview - pressing the same box again brings its row back to the middle", {}, async ({ page }) => {
  // 낮은 창 - 시드 문서의 시트가 다 들어가면 옮길 자리가 없다
  await page.setViewportSize({ width: 1280, height: 640 });
  await openFirstAssign(page, "one");
  const body = page.locator('[data-testid="assign-space-preview-body"]');
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview-body");
  // J로 고른 박스 - 시트가 용지 아래쪽을 덮으니 칸 맨 위로 올리고, locator.click은 누르기 전에 다시 굴려 시트 밑에 넣으니 좌표로 누른다
  const box = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-piece-"][data-sel]').first();
  await box.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  const pressBox = async () => {
    const at = await box.boundingBox();
    await page.mouse.click(at.x + 24, at.y + Math.min(12, at.height / 2));
  };
  await pressBox();
  // 고른 줄이 지운 줄(시드의 구조 제목)이면 문단 시트는 그 행을 빨간 deleted로 칠한다(B9)
  await page.locator(PARAGRAPH_PICKED_ROW).first().waitFor({ timeout: T });
  await page.waitForTimeout(200);
  const centred = await body.evaluate((el) => el.style.transform);
  const frame = page.locator('[data-testid="assign-space-preview-sheet"]');
  if (await frame.locator(".sv-rail").evaluate((el) => el.hidden)) {
    console.log("  (the sheet fits - nothing to drag back)");
    await page.keyboard.press("Escape");
    return;
  }
  const area = await frame.boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2 - 120, { steps: 6 });
  await page.mouse.up();
  check("dragging moves the sheet away from the picked row", (await body.evaluate((el) => el.style.transform)) !== centred, `${centred} → ${await body.evaluate((el) => el.style.transform)}`);
  await pressBox();
  await page.waitForTimeout(300);
  check("pressing the same box again centres its row again", (await body.evaluate((el) => el.style.transform)) === centred, `${centred} → ${await body.evaluate((el) => el.style.transform)}`);
  await page.keyboard.press("Escape");
});

await runStep("assign: Space preview in one pane shows the paragraph sheet with Section No.", {}, async ({ page }) => {
  await openFirstAssign(page, "one");
  const sheet = page.locator('[data-testid="assign-space-preview"]');
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  await wait(page, "assign-space-preview-body");
  // 머리 줄은 고정한 머리 표(-head)에 있다(freeze A2)
  const header = await page.locator('[data-testid="assign-space-preview-head"] tr[data-row-kind="header"]').first().locator("td").allInnerTexts();
  check("the one-pane sheet has the five paragraph columns, Section No. first", JSON.stringify(header.map((text) => text.trim()).slice(0, 5)) === JSON.stringify(PARAGRAPH_HEADERS), JSON.stringify(header));
  check("its title and download button are the paragraph Excel's", (await sheet.getAttribute("aria-label")) === "Paragraph Excel preview" && (await getText(page, "assign-space-preview-download")).includes("Download paragraphs"));
  check("the picked line is painted in the paragraph sheet", (await page.locator(PARAGRAPH_PICKED_ROW).count()) > 0);
  check("the foot says the paragraph sheet has the downloaded file's rows", (await getText(page, "assign-space-preview-legend")).includes("Paragraph Excel, 5 columns"));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: T }), page.locator('[data-testid="assign-space-preview-download"]').click()]);
  check("the download is the paragraph Excel of the document", /_paragraphs_\d{8}-\d{4}\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
  const rows = readXlsxRows(readFileSync(await download.path()));
  check("the downloaded file has the same header row", JSON.stringify(rows[0]) === JSON.stringify(PARAGRAPH_HEADERS), JSON.stringify(rows[0]));
  await page.keyboard.press("Escape");
  check("Esc closes it", (await sheet.count()) === 0);
  // 양 단으로 돌아오면 같은 Space가 Excel A
  await setPaneView(page, "two");
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview");
  check("back in two panes the sheet is Excel A again", (await sheet.getAttribute("data-sheet")) === "comparison");
  await page.keyboard.press("Escape");
});

// 필터 접기(2026-11-12) - 필터를 걸면 맞는 문장만 제 모양, 앞뒤 한 줄, 나머지는 묶음 한 줄. 목록은 걸 때의 스냅숏이라 확정해도 접히지 않는다
await runStep("assign: a status filter folds the Old paper", { drafting: true }, async ({ page, takeShot }) => {
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
  // 위 돌기가 마지막 탭(Figures - 그림 카드뿐, 접힘 없음)에 서 있을 수 있다 - 접힘은 본문 탭에서 본다
  if ((await countOf('[data-testid="assign-tab-body"]')) > 0) await page.locator('[data-testid="assign-tab-body"]').click();
  await page.locator(fullCards).first().waitFor({ timeout: T });
  check("the filter folds the rest into runs", (await countOf('[data-testid^="assign-paper-fold-run-"]')) >= 1 || (await countOf('[data-testid^="assign-paper-fold-line-"]')) >= 1);
  await takeShot("sop-assign-fold.png");
  // 묶음 한 줄 - 키보드로 펼치면 한 줄 판들과 접기 손잡이
  const run = page.locator('[data-testid^="assign-paper-fold-run-"]').first();
  if ((await run.count()) > 0) {
    const linesBefore = await countOf('[data-testid^="assign-paper-fold-line-"]');
    const runKey = ((await run.getAttribute("data-testid")) ?? "").replace("assign-paper-fold-run-", "");
    await run.focus();
    // 용지의 단추는 Space로 누른다 - Enter는 어디서든 확정 단추다(B1-R1)
    await page.keyboard.press(" ");
    await wait(page, `assign-paper-fold-head-${runKey}`);
    check("Space on a run opens its lines under a collapse handle", (await countOf('[data-testid^="assign-paper-fold-line-"]')) > linesBefore);
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
  // K는 박스 하나씩 움직인다(시안 1 스텝 3) - 확정한 줄이 짝이면 그 줄의 다른 박스가 먼저 골라지고 pickedId는 곁에 딸린 표시다
  await page.keyboard.press("k");
  await page.locator(`${old} .strip:is([data-sel], [data-mate])[data-strip-unit="${pickedId}"]`).waitFor({ timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Confirmed"), null, { timeout: T });
  check("a confirmed matched row stays in the list in full, not folded", (await countOf(`${old} .strip-row:not([data-peek]) > .strip:is([data-sel], [data-mate])[data-strip-unit="${pickedId}"]`)) === 1);
  // New 출처 칩으로 필터 밖(접힌) Unit에 가면 저절로 엿보기로 펼쳐 보인다 - 고른 줄을 따라 New 문서가 바뀌므로 다 받은 뒤에 칩을 찾는다
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const findFoldedChip = async () => {
    const chips = await page.locator('[data-testid^="assign-new-src-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    for (const chip of chips) {
      const unitId = chip.split("-").pop();
      if ((await countOf(`${old} [data-unit="${unitId}"]`)) === 0) return { chip, unitId };
    }
    return null;
  };
  let target = await findFoldedChip();
  // AI는 New 문장에 출처를 잇지 않는다(설계 2026-11-19) - 열린 New 문서에 그런 칩이 없으면 다른 New 문서를 차례로 연다
  if (!target && (await countOf('[data-testid="assign-new-doc"]')) > 0) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    const options = await page.locator('[data-testid^="assign-new-doc-option-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    await page.keyboard.press("Escape");
    for (const option of options) {
      await page.locator('[data-testid="assign-new-doc"]').click();
      await page.locator(`[data-testid="${option}"]`).click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      target = await findFoldedChip();
      if (target) break;
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
  await wait(page, "assign-more");
  const before = await progressDone(page);
  await page.locator('[data-testid="assign-more"]').click();
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
  await page.locator('[data-testid="assign-more"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-counts");
  await page.locator('[data-testid="assign-reset-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-progress"]')?.textContent?.trim().startsWith("0"), null, { timeout: T });
  check("resetting the whole bundle leaves nothing confirmed", true);
  // 다시 열면 지울 것이 없다고 말하고 확정 단추를 막는다
  await page.locator('[data-testid="assign-more"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-nothing");
  check("nothing left to reset disables the confirm button", await page.locator('[data-testid="assign-reset-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="assign-reset-modal-cancel"]').click();
});

// 바로 생성(2026-11-09): 이름 없이 BND 코드로 만들고, 문서가 없으면 Split~Review는 잠기고 To-Be는 열려 있다
// 배정 화면에서 AI 나누기 제안 받기·적용·되돌리기(전에는 요청만 되고 적용은 쪼개기 화면에서 했다). AI가 꺼져 있으면 건너뛴다
// 배정된 문장에 적용하면 서버가 먼저 묻는다(409 confirm_required) - 콘솔에 오류로 찍히는 그 응답은 이 단계가 일부러 받는 것이다
await runStep("assign: AI split suggestions - ask for the whole document, apply one, undo", { drafting: true, allowConsoleErrors: true }, async ({ page, takeShot }) => {
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
  await page.locator('[data-testid="assign-more"]').click();
  const wholeDoc = page.locator('[role="menuitem"]', { hasText: "AI split whole document" });
  check("the AI menu offers the whole-document split", (await wholeDoc.count()) === 1);
  await wholeDoc.click();
  // 앞 시나리오가 남긴 제안이 있으면 바로, 없으면 방금 보낸 작업이 끝난 뒤 뜬다
  const pill = page.locator('[data-testid="assign-split-pending"]');
  await pill.waitFor({ timeout: 90000 });
  await pill.click();
  await page.locator('[data-testid="assign-split-pending-next"]').click();
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
  // 그 자리 메뉴는 이제 누른 New 문장 안에 펼쳐진다(.line-acts, 사용자 결정 2026-11-19) - 떠 있을 때의 클래스가 아니라 testid로 찾는다
  await page.locator('[data-testid="assign-link-menu"]').waitFor({ timeout: T });
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
await runStep("assign: switch a KO/EN pair to one sentence and back", { drafting: true, allowConsoleErrors: true }, async ({ page, takeShot }) => {
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
  // 끝 조각이 영어인 한국어 문장은 편집 하나(switch_language)로 바로 짝이 되고 배정을 푼다 - 묻지 않는다(B6-3, 3-c)
  await toPair.click();
  const cleared = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null && unit.status === "unassigned"));
  check("without asking it is a pair again, with the assignment cleared", cleared !== null && (await page.locator('[data-testid="assign-edit-confirm"]').count()) === 0);
  await page.locator('[data-testid="toast-ok"]', { hasText: "Split into a KO/EN pair · Assignments cleared: 1" }).waitFor({ timeout: T });
  // 확인 창을 거친 뒤에도 화면이 새 줄을 따라가 고른다(묻는 사이에 다시 받은 값으로 고르면 놓친다)
  // 되돌리면 풀기 앞으로 - 합친 한 문장이 돌아온다(짝은 사라진 조각과 함께 없어진다). 다시 눌러 처음 모양으로 둔다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-pair"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  // 풀며 지운 배정도 함께 돌아온다(B6-2 - 편집 단계가 판단을 찍는다)
  const undoneMerge = await waitUnits((units) => units.length === before.length - 1);
  check("Undo brings the merged sentence back, assigned as it was", undoneMerge !== null && undoneMerge.some((unit) => unit.can_unmerge && unit.status === "confirmed" && members.every((item) => unit.text.includes(item.text.trim()))));
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
  // 붙이기 단추는 고른 박스의 위아래 틈에만 있다 - 다른 틈에는 올려도 뜰 단추가 없다
  const farJoins = await page.evaluate(() => [...document.querySelectorAll('.strip-gap [data-testid^="assign-paper-join-"]')].filter((el) => !el.closest(".strip-gap[data-near-selected]")).length);
  check("only the gaps next to the selected box carry Join", farJoins === 0, `${farJoins} far gaps`);
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

// 편집 뒤 다시 받기 범위(설계 2026-11-20 D2, 시안 1 스텝 2) - 붙이기 뒤에는 고친 문서의 보기와 그 문서의 Unit 줄(units?…document_id=)만 다시 받는다.
// 다른 Old 문서의 보기와 Bundle 전체 Unit 목록은 받지 않는다. 앞 단계처럼 한 문장을 잘라 두 조각을 틈의 Join으로 붙이고, 붙이기 응답부터 합친 박스를 고를 때까지의 GET을 센다.
// 끝에 되돌리기 두 번(붙이기 → 자르기)으로 시드를 처음 그대로 둔다
await runStep("assign: after Join only the edited document is fetched again", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const oldDocs = docs.filter((item) => item.side === "old" && item.status === "ready");
  let doc = null;
  let unit = null;
  for (const candidate of oldDocs) {
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
  console.log(`  (Old documents in the bundle: ${oldDocs.length})`);
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
  // 두 조각을 만든다 - 우클릭 메뉴의 Split here(앞 조각이 골라진다)
  await pieceOf(unit.id).scrollIntoViewIfNeeded();
  await pieceOf(unit.id).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  check("the sentence is cut in two", await waitCount(before + 1));
  const halves = (await readView(doc.id)).units.filter((item) => !beforeIds.includes(item.id)).sort((a, b) => a.pos_seq - b.pos_seq);
  const join = page.locator(`[data-testid="assign-paper-join-${halves[0].id}-${halves[1].id}"]`);
  await join.waitFor({ state: "attached", timeout: T });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts === null || acts.getAnimations().length === 0; }, null, { timeout: T });
  await page.locator(".strip-gap", { has: join }).hover({ position: { x: 200, y: 2 } });
  await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
  // 붙이기 응답(POST …/edits)이 온 뒤의 GET만 센다 - 이벤트는 차례대로 오니 응답 표시 뒤에 오는 요청이 그 편집의 다시 받기다
  const fetched = [];
  let isAfterEdit = false;
  const onResponse = (response) => {
    if (response.request().method() === "POST" && /\/documents\/\d+\/edits$/.test(new URL(response.url()).pathname)) isAfterEdit = true;
  };
  const onRequest = (request) => {
    if (!isAfterEdit || request.method() !== "GET") return;
    const url = new URL(request.url());
    if (/\/documents\/\d+\/view$/.test(url.pathname) || /\/bundles\/\d+\/units$/.test(url.pathname)) fetched.push(`${url.pathname}${url.search}`);
  };
  page.on("response", onResponse);
  page.on("request", onRequest);
  await join.click();
  check("Join merges the two pieces back into one sentence", await waitCount(before));
  const merged = (await readView(doc.id)).units.find((item) => !beforeIds.includes(item.id) && item.kind === "sentence");
  // 따라가기가 끝날 때까지 - 합친 박스가 골라지고, 뒤에서 받는 것(Bundle · 같은 글자 후보)이 멎을 틈을 둔다
  if (merged) await page.locator(`[data-testid="assign-paper-piece-${merged.id}"][data-sel]`).waitFor({ timeout: T });
  await page.waitForTimeout(800);
  page.off("response", onResponse);
  page.off("request", onRequest);
  const views = fetched.filter((path) => /\/view$/.test(path.split("?")[0]));
  const unitLists = fetched.filter((path) => /\/units$/.test(path.split("?")[0]));
  check(
    "after Join only the edited document's view and its own units are fetched again",
    merged !== undefined && views.length === 1 && views[0] === `/api/bundles/${freshId}/documents/${doc.id}/view` && unitLists.length === 1 && new URL(unitLists[0], BASE).searchParams.get("document_id") === String(doc.id),
    JSON.stringify(fetched),
  );
  // 되돌리기 두 번으로 처음 모양까지(붙이기 → 자르기)
  await page.waitForLoadState("networkidle");
  for (const expected of [before + 1, before]) {
    await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
    if (!(await waitCount(expected))) break;
    await page.waitForLoadState("networkidle");
  }
  check("two undos return to the original sentence", (await readIds()).length === before);
});

// 처리 중 표시(설계 2026-11-20 D4, 시안 1 스텝 4) - 틈의 Join을 누르면 응답 전에 그 틈에 "Joining…" 알약이 뜨고 두 박스에 빛이 지나간다(data-pending).
// 붙이기 요청을 붙들어(page.route) 응답 전 모습을 늘 본다 - 그동안 잠긴 박스는 눌러도 고름이 옮겨 가지 않는다. 놓아주면 알약 · 빛이 걷히고 합친 박스가 골라진다.
// 끝에 되돌리기 두 번(붙이기 → 자르기)으로 시드를 처음 그대로 둔다
await runStep("assign: a held Join shows the Joining pill and the shimmer at once, they go with the response and the merged box is picked", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const stripOf = (unitId) => page.locator(`.strip[data-testid="assign-paper-piece-${unitId}"]`);
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
  // 두 조각을 만든다 - 우클릭 메뉴의 Split here(앞 조각이 골라진다)
  await pieceOf(unit.id).scrollIntoViewIfNeeded();
  await pieceOf(unit.id).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  check("the sentence is cut in two", await waitCount(before + 1));
  const halves = (await readView(doc.id)).units.filter((item) => !beforeIds.includes(item.id)).sort((a, b) => a.pos_seq - b.pos_seq);
  await stripOf(halves[0].id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  const join = page.locator(`[data-testid="assign-paper-join-${halves[0].id}-${halves[1].id}"]`);
  await join.waitFor({ state: "attached", timeout: T });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts === null || acts.getAnimations().length === 0; }, null, { timeout: T });
  await page.locator(".strip-gap", { has: join }).hover({ position: { x: 200, y: 2 } });
  await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
  // 붙이기 요청을 서버에 닿기 전에 붙든다 - 첫 POST만 붙들고 나머지는 흘려보낸 뒤 끝에서 뗀다
  const EDIT_URL = /\/api\/bundles\/\d+\/documents\/\d+\/edits$/;
  let releaseEdit = () => undefined;
  const editHeld = new Promise((resolve) => { releaseEdit = resolve; });
  let isEditTaken = false;
  await page.route(EDIT_URL, async (route) => {
    if (isEditTaken || route.request().method() !== "POST") return route.continue();
    isEditTaken = true;
    await editHeld;
    await route.continue();
  });
  await join.click();
  const pill = page.locator('[data-testid="assign-paper-pending"][data-kind="join"]');
  const isPillShown = await pill.waitFor({ timeout: T }).then(() => true, () => false);
  check("the Joining pill shows at once in the gap that was pressed", isPillShown && (await pill.innerText()).includes("Joining") && (await pill.evaluate((el) => el.parentElement?.classList.contains("strip-gap") ?? false)), isPillShown ? await pill.innerText() : "no pill");
  const sweeps = await page.evaluate((ids) => ids.map((id) => {
    const el = document.querySelector(`.strip[data-testid="assign-paper-piece-${id}"]`);
    return el !== null && el.hasAttribute("data-pending") && getComputedStyle(el).animationName === "pending-sweep";
  }), [halves[0].id, halves[1].id]);
  check("both boxes of the Join carry the shimmer while it is pending", sweeps.every(Boolean), JSON.stringify(sweeps));
  // 처리 중인 박스는 잠긴다 - 눌러도 고름이 그 박스로 옮겨 가지 않는다(잠금은 그 박스만, 설계 D4)
  await stripOf(halves[1].id).click();
  await page.waitForTimeout(200);
  check("a pending box takes no click - the pressed box stays picked", (await stripOf(halves[0].id).getAttribute("data-sel")) === "" && (await stripOf(halves[1].id).getAttribute("data-sel")) === null);
  releaseEdit();
  check("Join merges the two pieces back into one sentence", await waitCount(before));
  const merged = (await readView(doc.id)).units.find((item) => !beforeIds.includes(item.id) && item.kind === "sentence");
  const isPicked = merged !== undefined && (await stripOf(merged.id).and(page.locator("[data-sel]")).waitFor({ timeout: T }).then(() => true, () => false));
  const isPillGone = await pill.waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  check("after the response the pill and the shimmer go and the merged box is picked", isPicked && isPillGone && (await page.locator('[data-pane="old"] [data-pending]').count()) === 0);
  await page.unrouteAll({ behavior: "wait" });
  // 되돌리기 두 번으로 처음 모양까지(붙이기 → 자르기)
  await page.waitForLoadState("networkidle");
  for (const expected of [before + 1, before]) {
    await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
    if (!(await waitCount(expected))) break;
    await page.waitForLoadState("networkidle");
  }
  check("two undos return to the original sentence", (await readIds()).length === before);
});

// 명령 큐(Assign 피드백 2차 A1, 설계 2026-11-25-split-first 6-1) - 저장이 느려도 누른 글쇠는 하나도 사라지지 않고 누른 차례대로 저장되며, 누르는 즉시
// 다음 박스로 간다. 합치기 뒤의 글쇠는 합친 박스에 떨어지고, 실패하면 뒤가 멈춰 알린다. 장면마다 그 문서의 배정을 비우고 새로 연다
await runStep("assign: keys pressed during a slow save are kept in order", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const api = `${BASE}/api/bundles/${freshBundleId}`;
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const SAVE_URL = /\/api\/bundles\/\d+\/groups\/save$/;
  const EDIT_URL = /\/api\/bundles\/\d+\/documents\/\d+\/edits$/;
  // 짝 없는 문장 · 제목이 열 개 넘게 이어진 Old 문서 - 박스 하나가 줄 하나라 차례를 세기 쉽다
  const readBoxes = async (docId) => {
    const view = await getJson(`/documents/${docId}/view`);
    const body = new Set(view.blocks.filter((block) => block.part === "body").map((block) => block.id));
    return view.units.filter((item) => item.group_unit_id === null && !item.noise_kind && body.has(item.block_id)).sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0));
  };
  let doc = null;
  let boxes = [];
  for (const candidate of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const found = await readBoxes(candidate.id);
    if (found.length < 10 || !found.every((item) => ["sentence", "heading"].includes(item.kind) && item.pair_id === null && item.status === "unassigned" && !item.ref)) continue;
    doc = candidate;
    boxes = found;
    break;
  }
  check("the fresh bundle has a document of ten plain unassigned boxes", doc !== null);
  if (doc === null) return;
  const ids = boxes.map((item) => item.id);
  const readDeleted = async () => (await getJson(`/units?limit=1000&offset=0&document_id=${doc.id}`)).items.filter((item) => item.status === "confirmed" && item.decision.disposition === "delete").map((item) => item.unit_id);
  const waitDeleted = async (expected) => {
    let now = [];
    for (let tries = 0; tries < 80; tries += 1) {
      now = await readDeleted();
      if (now.length === expected.length && expected.every((id) => now.includes(id))) return true;
      await page.waitForTimeout(250);
    }
    console.log(`      deleted ${JSON.stringify(now)}, expected ${JSON.stringify(expected)}`);
    return false;
  };
  const stripOf = (unitId) => page.locator(`.strip[data-testid="assign-paper-piece-${unitId}"]`);
  /** 그 박스가 골라질 때까지 걸린 시간(ms) - 안 되면 null */
  const timePick = async (unitId, limit) => {
    const from = Date.now();
    const isPicked = await page.waitForFunction((id) => document.querySelector(`.strip[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel") ?? false, unitId, { timeout: limit, polling: "raf" }).then(() => true, () => false);
    return isPicked ? Date.now() - from : null;
  };
  // 배정을 비우고 화면을 새로 열어 그 박스를 고른다
  const reopen = async (unitId) => {
    await page.unrouteAll({ behavior: "wait" });
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
    await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
    await wait(page, "assign-bar");
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
    await stripOf(unitId).waitFor({ timeout: T });
    await stripOf(unitId).click();
    await stripOf(unitId).and(page.locator("[data-sel]")).waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
  };
  const slowSaves = () => page.route(SAVE_URL, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });

  // 1. Delete · j · Delete - 첫째는 저장 중, 둘째는 대기 칩, 고름은 누르는 즉시, 다시 읽기는 끝에 한 번
  await reopen(ids[0]);
  await slowSaves();
  let unitReads = 0;
  const countReads = (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname.endsWith(`/bundles/${freshBundleId}/units`)) unitReads += 1;
  };
  page.on("request", countReads);
  const times = [];
  await page.keyboard.press("Delete");
  times.push(await timePick(ids[1], 300));
  await page.keyboard.press("j");
  times.push(await timePick(ids[2], 300));
  await page.keyboard.press("Delete");
  times.push(await timePick(ids[3], 300));
  check("each press moves the pick within 300ms while the save is slow", times.every((ms) => ms !== null), JSON.stringify(times));
  // 누른 순간 접힌다(A2-R6) - 처리 중과 칩은 접힌 줄에 선다
  const marks = await page.evaluate(([first, second]) => ({
    first: document.querySelector(`[data-testid="assign-paper-deleted-u${first}"]`)?.hasAttribute("data-pending") ?? null,
    second: document.querySelector(`[data-testid="assign-paper-deleted-u${second}"]`)?.hasAttribute("data-pending") ?? null,
    chip: document.querySelector(`[data-testid="assign-queue-${second}"]`)?.textContent ?? null,
    firstChip: document.querySelector(`[data-testid="assign-queue-${first}"]`) !== null,
  }), [ids[0], ids[2]]);
  check("the first box is pending and the second one waits with a Queued chip", marks.first === true && marks.second === true && marks.chip === "Queued 1" && !marks.firstChip, JSON.stringify(marks));
  await takeShot("sop-assign-queue.png");
  check("both boxes are deleted, the one between is not", await waitDeleted([ids[0], ids[2]]));
  await page.waitForFunction(() => document.querySelector('[data-pane="old"] [data-pending]') === null, null, { timeout: T });
  await page.waitForLoadState("networkidle");
  check("the rows are read again only once", unitReads === 1, String(unitReads));
  page.off("request", countReads);

  // 2. Delete 다섯 번을 0.15초마다 - 전에는 둘만 지워졌다
  await reopen(ids[0]);
  await slowSaves();
  for (let count = 0; count < 5; count += 1) {
    await page.keyboard.press("Delete");
    await page.waitForTimeout(150);
  }
  check("five Deletes 150ms apart delete five boxes", await waitDeleted(ids.slice(0, 5)));
  check("the pick is on the sixth box", (await timePick(ids[5], T)) !== null);

  // 3. 합치기를 누르고 응답 전에 Delete - 합친 박스가 지워진다. 문장 하나를 먼저 둘로 나눈다(원래 모양으로 되돌린다)
  const whole = boxes.find((item) => item.kind === "sentence" && item.text.trim().split(" ").length >= 4);
  check("the document has a sentence long enough to cut", whole !== undefined);
  if (whole !== undefined) {
    await reopen(whole.id);
    const before = (await readBoxes(doc.id)).map((item) => item.id);
    const waitBoxes = async (count) => {
      for (let tries = 0; tries < 60; tries += 1) {
        const now = await readBoxes(doc.id);
        if (now.length === count) return now;
        await page.waitForTimeout(250);
      }
      return null;
    };
    await stripOf(whole.id).click({ button: "right" });
    await wait(page, "assign-ctx-split");
    await page.locator('[data-testid="assign-ctx-split"]').click();
    await wait(page, "assign-cut-run");
    await page.locator('[data-testid="assign-cut-run"]').click();
    const halves = ((await waitBoxes(before.length + 1)) ?? []).filter((item) => !before.includes(item.id));
    check("the sentence is cut in two", halves.length === 2);
    if (halves.length === 2) {
      await stripOf(halves[0].id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
      const join = page.locator(`[data-testid="assign-paper-join-${halves[0].id}-${halves[1].id}"]`);
      await join.waitFor({ state: "attached", timeout: T });
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts === null || acts.getAnimations().length === 0; }, null, { timeout: T });
      await page.locator(".strip-gap", { has: join }).hover({ position: { x: 200, y: 2 } });
      await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
      await page.route(EDIT_URL, async (route) => {
        await new Promise((done) => setTimeout(done, 800));
        await route.continue();
      });
      await join.click();
      await page.locator('[data-testid="assign-paper-pending"][data-kind="join"]').waitFor({ timeout: T });
      await page.keyboard.press("Delete");
      check("Delete pressed during the join does not move the pick yet", (await stripOf(halves[0].id).getAttribute("data-sel")) === "");
      const joined = ((await waitBoxes(before.length)) ?? []).find((item) => !before.includes(item.id));
      check("the joined box is the one deleted", joined !== undefined && (await waitDeleted([joined.id])));
      // 삭제 → 붙이기 → 자르기 차례로 되돌려 처음 문장으로
      await page.unrouteAll({ behavior: "wait" });
      await page.waitForLoadState("networkidle");
      // 되돌리기도 큐로 나간다 - 응답을 기다리지 않으면 상자 수가 이미 맞아(붙인 뒤 = 처음) 되돌리기 전에 센다
      for (let count = 0; count < 3; count += 1) {
        const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
        await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
        await undone;
        await page.waitForLoadState("networkidle");
      }
      const restored = (await waitBoxes(before.length)) ?? [];
      check("three undos return to the original sentence", restored.map((item) => item.id).join(",") === before.join(",") && (await readDeleted()).length === 0);
    }
  }

  // 4. 둘째 저장이 500 - 셋째는 나가지 않고 알림. 다시 시도로 끝까지, 다시 500이면 버리기로 빈다
  await reopen(ids[0]);
  let saves = 0;
  let failing = 2;
  await page.route(SAVE_URL, async (route) => {
    saves += 1;
    if (saves === failing) return route.fulfill({ status: 500, body: "smoke" });
    await new Promise((done) => setTimeout(done, 300));
    return route.continue();
  });
  for (let count = 0; count < 3; count += 1) await page.keyboard.press("Delete");
  const failed = page.locator('[data-testid="assign-queue-failed"]');
  await failed.waitFor({ timeout: T });
  await page.waitForTimeout(800);
  const note = (await getText(page, "assign-queue-failed-text")).trim();
  check("after the second save fails the third is not sent and the notice says what stopped", saves === 2 && note.includes("Delete failed on box") && note.includes(boxes[1].display_id) && note.includes("1 queued actions paused"), `${saves} saves, ${note}`);
  const halted = await page.evaluate(([second, third]) => [
    document.querySelector(`[data-testid="assign-paper-deleted-u${second}"]`)?.hasAttribute("data-pending") ?? null,
    document.querySelector(`[data-testid="assign-queue-${third}"]`) !== null,
  ], [ids[1], ids[2]]);
  check("the failed box is no longer pending and the third one still waits", halted[0] === false && halted[1] === true, JSON.stringify(halted));
  await takeShot("sop-assign-queue-failed.png");
  await page.locator('[data-testid="assign-queue-retry"]').click();
  check("Retry sends the failed one and the rest", await waitDeleted(ids.slice(0, 3)));
  check("the notice is gone", (await failed.count()) === 0);
  saves = 0;
  failing = 1;
  await stripOf(ids[5]).click();
  await stripOf(ids[5]).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  await page.keyboard.press("Delete");
  await page.keyboard.press("Delete");
  await failed.waitFor({ timeout: T });
  await page.locator('[data-testid="assign-queue-discard"]').click();
  await failed.waitFor({ state: "detached", timeout: T });
  await page.waitForTimeout(800);
  check("Discard empties the line and deletes nothing more", saves === 1 && (await page.locator('[data-testid^="assign-queue-"]').count()) === 0 && (await waitDeleted(ids.slice(0, 3))), String(saves));

  // 5. Delete 바로 뒤 Ctrl+Z - 삭제가 저장된 뒤 되돌려진다
  await reopen(ids[0]);
  await slowSaves();
  const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z right after Delete waits for that save and undoes it", (await undone).status() === 200 && (await waitDeleted([])));

  await page.unrouteAll({ behavior: "wait" });
  await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
  check("the document is clean again", (await readDeleted()).length === 0);
});

// 움직임은 누른 순간 시작한다(Assign 피드백 2차 A2-R6, 설계 2026-11-25-split-first 6-1) - 삭제 접기 · 표 벗기기의 걷기 · 번호 새 글이 응답 전에 보이고, 거절되면 원래대로.
// 끝에 모두 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: deletion folds and unwrap start before the response, a refused edit rolls back", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${api}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${api}/documents/${docId}/view`, { headers })).json();
  const SAVE_URL = /\/api\/bundles\/\d+\/groups\/save$/;
  const EDIT_URL = /\/api\/bundles\/\d+\/documents\/\d+\/edits$/;
  const SLOW_MS = 1500;
  let answered = 0;
  const slow = (url) => page.route(url, async (route) => {
    await new Promise((done) => setTimeout(done, SLOW_MS));
    answered += 1;
    await route.continue();
  });
  const refuse = (url) => page.route(url, (route) => route.fulfill({ status: 500, body: "smoke" }));
  const failed = page.locator('[data-testid="assign-queue-failed"]');
  const discard = async () => {
    await page.locator('[data-testid="assign-queue-discard"]').click();
    await failed.waitFor({ state: "detached", timeout: T });
  };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit: table } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", table !== null);
  if (table === null) return;
  const waitView = async (docId, isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(docId);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const readStatus = async (unitId) => (await readView(doc.id)).units.find((item) => item.id === unitId)?.status;

  // 1. 삭제 - 저장이 1.5초 걸려도 300ms 안에 접힌 줄과 다음 박스 고름. 박스는 사라지지 않고 접히는 중이다
  let sentence = null;
  for (const item of (await readView(doc.id)).units.filter((one) => one.kind === "sentence" && one.status === "unassigned" && one.pair_id === null)) {
    if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) === 0) continue;
    sentence = item;
    break;
  }
  check("the document has an unassigned sentence on screen", sentence !== null);
  if (sentence !== null) {
    const line = page.locator(`[data-testid="assign-paper-deleted-u${sentence.id}"]`);
    const piece = page.locator(`[data-testid="assign-paper-piece-${sentence.id}"]`);
    const pick = async () => {
      await piece.scrollIntoViewIfNeeded();
      await piece.click();
      await piece.and(page.locator("[data-sel]")).waitFor({ timeout: T });
      await page.waitForLoadState("networkidle");
    };
    await pick();
    await slow(SAVE_URL);
    await page.keyboard.press("Delete");
    const pressedAt = Date.now();
    const started = await page.waitForFunction((id) => {
      const folded = document.querySelector(`[data-testid="assign-paper-deleted-u${id}"]`);
      const picked = document.querySelector('[data-testid="assign-old"] [data-strip-unit][data-sel]')?.getAttribute("data-strip-unit");
      if (folded === null || picked === undefined || picked === null || picked === String(id)) return null;
      return { isPending: folded.hasAttribute("data-pending"), isFolding: document.querySelector(`.deleted-open [data-testid="assign-paper-piece-${id}"]`) !== null };
    }, sentence.id, { timeout: 300, polling: "raf" }).then((handle) => handle.jsonValue(), () => null);
    check("Delete folds the box and picks the next one within 300ms, before the save answers", started !== null && answered === 0, `${Date.now() - pressedAt}ms, ${answered} answered`);
    check("the line shows it is being saved and the box folds in place", started?.isPending === true && started?.isFolding === true, JSON.stringify(started));
    await piece.waitFor({ state: "detached", timeout: T });
    check("the fold ends before the save answers", answered === 0);
    await takeShot("sop-assign-fold-pending.png");
    check("the sentence is saved as deleted", (await waitView(doc.id, (view) => view.units.some((item) => item.id === sentence.id && item.status === "confirmed"))) !== null);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-deleted-u${id}"]`)?.hasAttribute("data-pending") === false, sentence.id, { timeout: T });
    await page.unrouteAll({ behavior: "wait" });
    await page.locator('[data-testid="assign-undo"]').click();
    check("Undo brings the sentence back", (await waitView(doc.id, (view) => view.units.some((item) => item.id === sentence.id && item.status === "unassigned"))) !== null);
    await piece.waitFor({ timeout: T });
    // 저장이 500이면 멈추고, 버리면 다시 펼쳐진다
    await pick();
    await refuse(SAVE_URL);
    await page.keyboard.press("Delete");
    await failed.waitFor({ timeout: T });
    await discard();
    await piece.waitFor({ timeout: T });
    await line.waitFor({ state: "detached", timeout: T });
    check("a refused delete opens the box again once discarded", (await readStatus(sentence.id)) === "unassigned");
    await page.unrouteAll({ behavior: "wait" });
  }

  // 2. 표 벗기기 - 누른 뒤 100ms 안에 표 선이 걷히기 시작하고 알약이 뜬다. 500이면 거꾸로 돌아 표 그대로
  const tablePiece = page.locator(`[data-testid="assign-paper-piece-${table.id}"]`);
  const pressUnwrap = async () => {
    await tablePiece.scrollIntoViewIfNeeded();
    await tablePiece.click();
    const button = page.locator(`[data-testid="assign-shape-table_layout-${table.id}"]`);
    await button.waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
    // 누른 때부터 화면 안에서 잰다 - 밖에서 재면 누름이 돌아오는 시간이 섞인다
    await page.evaluate((id) => {
      window.__unwrapBegan = undefined;
      document.addEventListener("click", () => {
        const at = performance.now();
        const look = () => {
          const piece = document.querySelector(`[data-testid="assign-paper-piece-${id}"]`);
          const isMoving = (piece?.querySelector(".ptbl")?.getAnimations().length ?? 0) > 0;
          if (isMoving && piece?.querySelector('[data-testid="assign-paper-pending"][data-kind="unwrap"]')) window.__unwrapBegan = performance.now() - at;
          else if (performance.now() - at < 1000) requestAnimationFrame(look);
        };
        look();
      }, { once: true, capture: true });
    }, table.id);
    await button.click();
  };
  const readBegan = () => page.waitForFunction(() => window.__unwrapBegan, null, { timeout: 1200, polling: "raf" }).then((handle) => handle.jsonValue(), () => null);
  answered = 0;
  await slow(EDIT_URL);
  await pressUnwrap();
  const began = await readBegan();
  check("the table starts to clear with its pill within 100ms of the press, before the edit answers", began !== null && began <= 100 && answered === 0, `${began}ms, ${answered} answered`);
  check("the table is still there until the answer", (await tablePiece.count()) === 1);
  await takeShot("sop-assign-unwrap-pending.png");
  const isLayout = (view) => view.tables.find((item) => item.id === table.table_id)?.is_layout === true;
  check("the answer unwraps the table", (await waitView(doc.id, isLayout)) !== null);
  await tablePiece.waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  await page.unrouteAll({ behavior: "wait" });
  // 다시 표로 - 머리 단추는 걷히고 알약은 남는다
  await refuse(EDIT_URL);
  const headRow = page.locator(`[data-testid="assign-paper-unwrap-head-${table.table_id}"]`).first();
  await headRow.scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="assign-paper-rewrap-${table.table_id}"]`).click();
  await failed.waitFor({ timeout: T });
  await waitForOldMotion(page);
  check("a refused Back to table brings its head back", await headRow.evaluate((row) => { const head = row.querySelector(".unwrap-head"); return head !== null && head.getAnimations().length === 0 && getComputedStyle(head).opacity === "1"; }));
  await discard();
  await page.unrouteAll({ behavior: "wait" });
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo wraps the table back", (await waitView(doc.id, (view) => !isLayout(view) && view.units.some((item) => item.id === table.id))) !== null);
  await tablePiece.waitFor({ timeout: T });
  const readFrame = () => tablePiece.locator(".ptbl").first().evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, moving: el.getAnimations().length }));
  const frame = await readFrame();
  await refuse(EDIT_URL);
  await pressUnwrap();
  await failed.waitFor({ timeout: T });
  await waitForOldMotion(page);
  const after = await readFrame();
  check("a refused unwrap leaves the table as it was", after.moving === 0 && after.border === frame.border && !isLayout(await readView(doc.id)), JSON.stringify({ frame, after }));
  await discard();
  await page.unrouteAll({ behavior: "wait" });

  // 3. 번호 - 누른 뒤 100ms 안에 새 글, 500이면 옛 글
  let numbered = null;
  let numberDoc = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    if (!view.has_number_ranges) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator('[data-testid="assign-old"]').waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of view.units.filter((one) => one.number && !one.number.is_set && /^\d+\.$/.test(one.number.value ?? "") && one.table_id === null)) {
      if ((await page.locator(`[data-testid="assign-paper-num-${item.id}"]`).count()) === 0) continue;
      numbered = item;
      numberDoc = candidate;
      break;
    }
    if (numbered !== null) break;
  }
  check("the bundle has a numbered line on screen", numbered !== null);
  if (numbered === null) return;
  const cell = page.locator(`[data-testid="assign-paper-num-${numbered.id}"]`);
  const readNumber = async () => (await readView(numberDoc.id)).units.find((item) => item.id === numbered.id)?.number;
  const typeNumber = async (text) => {
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
    await wait(page, "assign-paper-num-input");
    await page.locator('[data-testid="assign-paper-num-follow"]').uncheck();
    await page.locator('[data-testid="assign-paper-num-input"]').fill(text);
    await page.evaluate(([id, expected]) => {
      window.__numberShown = undefined;
      document.addEventListener("keydown", () => {
        const at = performance.now();
        const look = () => {
          if (document.querySelector(`[data-testid="assign-paper-num-${id}"]`)?.textContent?.trim() === expected) window.__numberShown = performance.now() - at;
          else if (performance.now() - at < 1000) requestAnimationFrame(look);
        };
        look();
      }, { once: true, capture: true });
    }, [numbered.id, text]);
    await page.locator('[data-testid="assign-paper-num-input"]').press("Enter");
  };
  answered = 0;
  await slow(EDIT_URL);
  await typeNumber("88.");
  const shown = await page.waitForFunction(() => window.__numberShown, null, { timeout: 1200, polling: "raf" }).then((handle) => handle.jsonValue(), () => null);
  check("the new number shows within 100ms of the press, before the edit answers", shown !== null && shown <= 100 && answered === 0, `${shown}ms, ${answered} answered`);
  let isSaved = false;
  for (let tries = 0; tries < 60 && !isSaved; tries += 1) {
    isSaved = (await readNumber())?.value === "88.";
    if (!isSaved) await page.waitForTimeout(250);
  }
  check("the number is saved", isSaved);
  await page.unrouteAll({ behavior: "wait" });
  await page.waitForLoadState("networkidle");
  check("the answer keeps it", (await cell.innerText()).trim() === "88.");
  await page.locator('[data-testid="assign-undo"]').click();
  const isBack = await page.waitForFunction(([id, value]) => document.querySelector(`[data-testid="assign-paper-num-${id}"]`)?.textContent?.trim() === value, [numbered.id, numbered.number.value], { timeout: T }).then(() => true, () => false);
  check("Undo brings the number back", isBack && (await readNumber())?.is_set === false);
  await refuse(EDIT_URL);
  await typeNumber("77.");
  await failed.waitFor({ timeout: T });
  check("a refused number goes back to the old one", (await cell.innerText()).trim() === numbered.number.value && (await readNumber())?.value === numbered.number.value, await cell.innerText());
  await discard();
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
  // Old 조각은 끌어서 잇는 상자라 글자는 Alt를 누른 동안만 긁힌다(끌어다 놓기 설계 G3)
  await page.mouse.move(box.x + 2, box.y + 10);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 10, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
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
await runStep("assign: add and delete destinations from the All list", { drafting: true }, async ({ page, takeShot }) => {
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
  // 고른 곳이 없으면 확정 단추는 추천 첫 카드(choose)이거나 꺼짐(blocked)이다(B1-R2)
  check("deleting the chosen step drops the pick", ["choose", "blocked"].includes(await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")));
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

// 배정된 문장도 자른다(v1.0.21) - 한 번 묻고 배정을 풀며 자른다(원문 고치기와 같은 규칙). 전에는 "먼저 배정을 지우라"며 막았다
// 서버의 물음(409 confirm_required)이 콘솔에 오류로 찍힌다 - 이 단계가 일부러 받는 응답이다
await runStep("assign: cutting an assigned sentence asks once, then clears its assignment", { drafting: true, allowConsoleErrors: true }, async ({ page, takeShot }) => {
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
    // 짝 없는 문장 - 배정된 짝 구성원은 짝을 한 언어로 만드는 언어 칸이 열린다(B6-3 모양 전환)
    const found = view.units.filter((item) => item.kind === "sentence" && item.pair_id === null && item.status === "unassigned" && item.lang === "en" && item.text.trim().split(" ").length >= 4);
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

// 번호 칸(문단 번호, F5) - 번호는 늘 번호 칸에 산다. 제목의 타자 번호("1. 목적")와 자동 번호는 처음부터 번호 칸에 있고 글에서 빠진다.
// 번호를 고치면 같은 목록의 뒤 번호가 점선 미리 보기대로 따라 바뀐다. 본문 줄의 타자 번호는 "↤"를 눌러야 번호가 된다(화면에 있을 때만 본다).
// 원문 글자와 배정은 그대로이고 쪼개기 편집이라 Undo 한 번에 한 걸음씩 돌아온다. 끝에 이 단계가 한 편집을 모두 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: number cell - a heading number sits in the cell, a fix renumbers the list after a dashed preview, Undo steps back", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  // 본문에 번호("1." "2.")가 같은 언어로 잇달아 있는 Old 문서 - 번호 범위는 추출기 5부터라 다시 시드한 자료여야 한다
  let doc = null;
  let first = null;
  let second = null;
  let typed = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    if (!view.has_number_ranges) continue;
    const numbered = view.units.filter((item) => item.number && !item.number.is_set && /^\d+\.$/.test(item.number.value ?? "") && item.table_id === null);
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of numbered) {
      const next = numbered.find((other) => other.pos_seq > item.pos_seq && other.lang === item.lang && Number.parseInt(other.number.value, 10) === Number.parseInt(item.number.value, 10) + 1);
      if (!next) continue;
      if ((await page.locator(`[data-testid="assign-paper-num-${item.id}"]`).count()) === 0 || (await page.locator(`[data-testid="assign-paper-num-${next.id}"]`).count()) === 0) continue;
      doc = candidate;
      first = item;
      second = next;
      break;
    }
    if (first !== null) {
      for (const item of view.units.filter((unit) => unit.number && unit.number.from_text && unit.id !== first.id && unit.id !== second.id)) {
        if ((await page.locator(`[data-testid="assign-paper-num-${item.id}"]`).count()) > 0) {
          typed = item;
          break;
        }
      }
      break;
    }
  }
  check("the bundle has two numbered lines in a row on screen", first !== null);
  if (first === null) return;
  const readNumber = async (unitId) => (await readView(doc.id)).units.find((item) => item.id === unitId)?.number ?? null;
  const waitNumber = async (unitId, isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const number = await readNumber(unitId);
      if (number && isDone(number)) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const pieceText = async (unitId) => (await page.locator(`[data-testid="assign-paper-piece-${unitId}"] [data-testid="assign-paper-unit-${unitId}"]`).first().innerText()).trim();
  check("the number cell shows the line's number", (await getText(page, `assign-paper-num-${first.id}`)).trim() === first.number.value);
  check("the number is out of the content", first.number.content_start > 0 && !(await pieceText(first.id)).startsWith(first.number.value), await pieceText(first.id));
  // 번호 칸을 누르면 그 자리에 창이 열린다 - 종류 단추 줄의 연속 번호를 누르면 입력 상자, 뒤 번호 따라 고치기는 기본 켬이고 바뀔 번호가 점선으로 보인다
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  check("renumbering the rest of the list is on by default", await page.locator('[data-testid="assign-paper-num-follow"]').isChecked());
  await page.locator('[data-testid="assign-paper-num-input"]').fill("8.");
  await wait(page, "assign-paper-num-preview");
  check("the strip previews the following number", (await getText(page, "assign-paper-num-preview")).includes(`${second.number.value} → 9.`), await getText(page, "assign-paper-num-preview"));
  check("the following number cell shows the preview dashed", (await page.locator(`[data-testid="assign-paper-num-${second.id}"]`).getAttribute("data-preview")) !== null);
  check("nothing is saved while previewing", (await readNumber(second.id)).value === second.number.value);
  await page.locator('[data-testid="assign-paper-num-input"]').press("Enter");
  check("Enter saves the fixed number", await waitNumber(first.id, (number) => number.value === "8." && number.is_set));
  check("the following number follows in the same edit", await waitNumber(second.id, (number) => number.value === "9."));
  check("the read value stays on record", (await readNumber(first.id)).read === first.number.read);
  // Undo 한 번 = 고침과 따라 고침 한 걸음
  await page.locator('[data-testid="assign-undo"]').click();
  check("one Undo brings both numbers back", (await waitNumber(first.id, (number) => number.value === first.number.value && !number.is_set)) && (await waitNumber(second.id, (number) => number.value === second.number.value)));
  // 확인 · 취소 단추(B3) - 확인은 Enter와 같은 저장, 빈 입력이면 꺼지고 까닭이 보이며, 취소는 저장 없이 닫는다
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-input"]').fill("");
  check("OK is off with a reason while the number is empty", (await page.locator('[data-testid="assign-paper-number-cell-ok"]').getAttribute("aria-disabled")) === "true" && (await getText(page, "assign-paper-number-cell-reason")).includes("Type a number"));
  await page.locator('[data-testid="assign-paper-number-cell-cancel"]').click();
  await page.locator('[data-testid="assign-paper-num-input"]').waitFor({ state: "detached", timeout: T });
  check("Cancel closes the number box without saving", (await readNumber(first.id)).value === first.number.value);
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-input"]').fill("8.");
  await page.locator('[data-testid="assign-paper-number-cell-ok"]').click();
  check("OK saves the same as Enter", (await waitNumber(first.id, (number) => number.value === "8." && number.is_set)) && (await waitNumber(second.id, (number) => number.value === "9.")));
  await page.locator('[data-testid="assign-undo"]').click();
  check("one Undo brings back the number saved with OK", (await waitNumber(first.id, (number) => number.value === first.number.value && !number.is_set)) && (await waitNumber(second.id, (number) => number.value === second.number.value)));
  // Esc는 저장하지 않고 닫는다
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-input"]').fill("5.");
  await page.locator('[data-testid="assign-paper-num-input"]').press("Escape");
  await page.locator('[data-testid="assign-paper-num-input"]').waitFor({ state: "detached", timeout: T });
  check("Escape closes the input without saving", (await readNumber(first.id)).value === first.number.value);
  // 포커스가 입력 밖(따라 고치기 체크)에 있어도 Esc로 닫히고, 바깥을 눌러도 저장 없이 닫힌다
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-follow"]').click();
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-paper-num-input"]').waitFor({ state: "detached", timeout: T });
  check("Escape closes the number box with focus off the input", true);
  await page.locator(`[data-testid="assign-paper-num-${first.id}"]`).click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-input"]').fill("6.");
  const viewport = page.viewportSize();
  await page.mouse.click(4, (viewport?.height ?? 800) - 4);
  await page.locator('[data-testid="assign-paper-num-input"]').waitFor({ state: "detached", timeout: T });
  check("a press outside closes the number box without saving", (await readNumber(first.id)).value === first.number.value);
  // 본문 줄의 타자 번호 - 처음부터 번호 칸에 있고(툴팁이 글에서 읽었다고 알린다) None이면 글로, Undo로 다시 번호로(그런 줄이 화면에 있을 때만)
  if (typed !== null) {
    const cell = page.locator(`[data-testid="assign-paper-num-${typed.id}"]`);
    await cell.scrollIntoViewIfNeeded();
    check("a typed number on a body line is the number from the start", typed.number.value === typed.number.read && typed.number.content_start > 0 && (await cell.innerText()).trim() === typed.number.value);
    check("its tip says it was read from text", ((await cell.getAttribute("data-tip")) ?? "").includes("Read from text"), await cell.getAttribute("data-tip"));
    await cell.click();
    await page.locator('[data-testid="assign-paper-num-kind-none"]').click();
    check("No number turns it back into text and is remembered", await waitNumber(typed.id, (number) => number.value === null && number.is_set && !number.from_text));
    await page.locator('[data-testid="assign-undo"]').click();
    check("Undo brings the number back", await waitNumber(typed.id, (number) => number.value === typed.number.read && !number.is_set && number.from_text));
  }
});

// 번호 칸 - 번호가 없는 줄은 빈 번호 칸의 "+"로 창을 열어 연속 번호 종류로 써 넣고(줄에 올리면 보인다), 종류 "None"은 번호를 글로 되돌린다. 끝에 모두 되돌린다
await runStep("assign: number cell - Add number on a line without one, No number turns it back into text", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  let doc = null;
  let unit = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    if (!view.has_number_ranges) continue;
    const plain = view.units.filter((item) => item.kind === "sentence" && item.number && item.number.value === null && item.table_id === null);
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of plain) {
      if ((await page.locator(`[data-testid="assign-paper-num-add-${item.id}"]`).count()) === 0) continue;
      doc = candidate;
      unit = item;
      break;
    }
    if (unit !== null) break;
  }
  check("the bundle has a line without a number on screen", unit !== null);
  if (unit === null) return;
  const waitNumber = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const number = (await readView(doc.id)).units.find((item) => item.id === unit.id)?.number;
      if (number && isDone(number)) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const statusBefore = (await readView(doc.id)).units.find((item) => item.id === unit.id).status;
  const add = page.locator(`[data-testid="assign-paper-num-add-${unit.id}"]`);
  await add.scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`).hover();
  await add.click();
  await wait(page, "assign-paper-num-kind-none");
  // 번호가 없는 줄의 "None"은 할 일이 없다 - 눌린 채 꺼져 있다
  check("a line without a number offers no No number button", await page.locator('[data-testid="assign-paper-num-kind-none"]').isDisabled());
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  await page.locator('[data-testid="assign-paper-num-follow"]').uncheck();
  await page.locator('[data-testid="assign-paper-num-input"]').fill("7.7");
  await page.locator('[data-testid="assign-paper-num-input"]').press("Enter");
  check("the typed-in number is saved", await waitNumber((number) => number.value === "7.7" && number.is_set && number.content_start === 0));
  await page.locator(`[data-testid="assign-paper-num-${unit.id}"]`).waitFor({ timeout: T });
  check("the number cell shows it", (await getText(page, `assign-paper-num-${unit.id}`)).trim() === "7.7");
  check("the line keeps its status", (await readView(doc.id)).units.find((item) => item.id === unit.id).status === statusBefore);
  // 번호 없음 - 번호가 사라지고 줄은 번호 없는 줄로 돌아간다
  await page.locator(`[data-testid="assign-paper-num-${unit.id}"]`).click();
  await wait(page, "assign-paper-num-kind-none");
  await page.locator('[data-testid="assign-paper-num-kind-none"]').click();
  check("No number clears it", await waitNumber((number) => number.value === null));
  await page.locator(`[data-testid="assign-paper-num-add-${unit.id}"]`).waitFor({ state: "attached", timeout: T });
  // 두 편집을 되돌려 처음 그대로 둔다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the number back", await waitNumber((number) => number.value === "7.7"));
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo removes it again", await waitNumber((number) => number.value === null && !number.is_set));
});

// 번호 칸 종류(시안 2 D1) - 같은 목록에 잇단 세 줄 "N-1." "N." "N+1."을 찾아 가운데 줄을 점 기호 •로 바꾸면 누르는 즉시 저장되고(뒤 번호는 따라오지 않는다)
// 앞 숫자 번호보다 한 단계 들여 쓰인다. 그다음 줄에서 연속 번호를 누르면 점 기호 줄을 건너뛰어 앞 숫자 번호의 다음 "N."을 채운다(이름의 4. · 3.은 시안의 보기 값).
// 원문과 다르게 고친 번호는 번호 칸 툴팁에 "Source <원문>"이 붙고 창 아래에 노트 줄이 보인다. 끝에 두 편집을 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: number cell - bullet • saves at once and indents, Continuous fills 4., a changed number shows Source 3. in the tip", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const isContinuous = (value) => /^\d+(\.\d+)*\.?$/.test(value ?? "");
  const startOf = (unit) => unit.spans[0]?.[1] ?? -1;
  let doc = null;
  let prev = null;
  let line = null;
  let next = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    if (!view.has_number_ranges) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    // 같은 목록 후보 - 화면(number-model listNumberSiblings)과 같이 번호 칸 있는 단위 가운데 같은 언어 · 표 밖(띠 표 제목 줄은 표 밖), 원문 순
    const listed = view.units
      .filter((unit) => unit.number && (unit.table_id === null || unit.kind === "heading"))
      .sort((a, b) => a.pos_seq - b.pos_seq || startOf(a) - startOf(b) || a.id - b.id);
    for (const lang of new Set(listed.map((unit) => unit.lang))) {
      // 연속 번호 줄만 - 사이에 낀 번호 없는 줄은 연속 번호 세기가 건너뛰므로 세 줄이 이 목록에서 잇달아 있으면 된다
      const numbered = listed.filter((unit) => unit.lang === lang && isContinuous(unit.number.value));
      for (let index = 0; index + 2 < numbered.length; index += 1) {
        const [a, b, c] = numbered.slice(index, index + 3);
        if (![a, b, c].every((unit) => /^\d+\.$/.test(unit.number.value) && !unit.number.is_set && unit.number.read === unit.number.value)) continue;
        const n = Number.parseInt(b.number.value, 10);
        if (Number.parseInt(a.number.value, 10) !== n - 1 || Number.parseInt(c.number.value, 10) !== n + 1) continue;
        if ((await page.locator(`[data-testid="assign-paper-num-${b.id}"]`).count()) === 0 || (await page.locator(`[data-testid="assign-paper-num-${c.id}"]`).count()) === 0) continue;
        // 짝 카드의 둘째 줄부터는 첫 줄의 번호 칸 폭을 따르므로 들여쓰기를 볼 수 없다
        const bracket = await page.locator(`[data-testid="assign-paper-lead-${b.id}"]`).getAttribute("data-bracket");
        if (bracket !== null && bracket !== "top") continue;
        doc = candidate;
        prev = a;
        line = b;
        next = c;
        break;
      }
      if (line !== null) break;
    }
    if (line !== null) break;
  }
  check("the bundle has three numbered lines in a row of one list on screen", line !== null);
  if (line === null) return;
  const readNumber = async (unitId) => (await readView(doc.id)).units.find((item) => item.id === unitId)?.number ?? null;
  const waitNumber = async (unitId, isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const number = await readNumber(unitId);
      if (number && isDone(number)) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const waitFor = async (isDone) => {
    for (let tries = 0; tries < 40; tries += 1) {
      if (await isDone()) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const leadWidth = async (unitId) => (await page.locator(`[data-testid="assign-paper-lead-${unitId}"]`).boundingBox())?.width ?? Number.NaN;
  const readTip = async (unitId) => (await page.locator(`[data-testid="assign-paper-num-${unitId}"]`).getAttribute("data-tip")) ?? "";
  const n = Number.parseInt(line.number.value, 10);
  // 점 기호 • - 창은 지금 종류(연속 번호)를 눌린 채로 열리고, •를 누르면 입력 없이 바로 저장된다
  const widthBefore = await leadWidth(line.id);
  const cell = page.locator(`[data-testid="assign-paper-num-${line.id}"]`);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await wait(page, "assign-paper-num-kind-bullet-0");
  check("the number box opens with the line's kind pressed", (await page.locator('[data-testid="assign-paper-num-kind-continuous"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="assign-paper-num-kind-bullet-0"]').click();
  check("• saves at once", await waitNumber(line.id, (number) => number.value === "•" && number.is_set && number.note === line.number.read));
  await page.locator(`[data-testid="assign-paper-num-edit-${line.id}"]`).waitFor({ state: "detached", timeout: T });
  check("a bullet does not renumber the rest of the list", (await readNumber(next.id)).value === next.number.value);
  check("the bullet line indents one step past the number before", await waitFor(async () => (await leadWidth(line.id)) > widthBefore), `${widthBefore} -> ${await leadWidth(line.id)}`);
  check("the changed number shows its source number in the tip", await waitFor(async () => (await readTip(line.id)).includes(`Source ${line.number.read}`)), await readTip(line.id));
  // 연속 번호 - 다음 줄에서 누르면 점 기호 줄을 건너뛰어 앞 숫자 번호(N-1.)의 다음 순번을 채운다
  const nextCell = page.locator(`[data-testid="assign-paper-num-${next.id}"]`);
  await nextCell.scrollIntoViewIfNeeded();
  await nextCell.click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  check("Continuous fills the next number after the bullet line", (await page.locator('[data-testid="assign-paper-num-input"]').inputValue()) === `${n}.`, `${prev.number.value} -> ${await page.locator('[data-testid="assign-paper-num-input"]').inputValue()}`);
  check("the counted value shows beside the input", (await getText(page, "assign-paper-num-continuous")).includes(`${n}.`), await getText(page, "assign-paper-num-continuous"));
  await page.locator('[data-testid="assign-paper-num-follow"]').uncheck();
  await page.locator('[data-testid="assign-paper-num-input"]').press("Enter");
  check("Enter saves the counted number", await waitNumber(next.id, (number) => number.value === `${n}.` && number.is_set && number.note === next.number.read));
  check("the saved line's tip shows its source number", await waitFor(async () => (await readTip(next.id)).includes(`Source ${next.number.read}`)), await readTip(next.id));
  // 노트 줄 - 다시 열면 창 아래에 원문 번호와 다르다는 줄이 보이고, Esc로 저장 없이 닫는다
  await nextCell.click();
  await wait(page, "assign-paper-num-note");
  check("the number box notes the source number", (await getText(page, "assign-paper-num-note")).includes(`"${next.number.read}"`), await getText(page, "assign-paper-num-note"));
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="assign-paper-num-edit-${next.id}"]`).waitFor({ state: "detached", timeout: T });
  // 두 편집을 되돌려 처음 그대로 둔다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the next number back", await waitNumber(next.id, (number) => number.value === next.number.value && !number.is_set && number.note === null));
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo turns the bullet back into the number", await waitNumber(line.id, (number) => number.value === line.number.value && !number.is_set && number.note === null));
});

// 번호 ◀ ▶(B8 항목 7) - 같은 목록에서 "N." 아래 번호 없는 줄 셋이 이어진 곳을 찾는다(짝 카드가 아닌 한 언어 목록). 번호: 첫 줄 창에서 연속 번호를 누르면 "N+1."이 차고,
// ◀ ▶는 입력한 번호의 단계만 바꾼다("N+1." ▶ "N.1." → ▶ 꺼짐 → ◀ "N+1." → ◀ 꺼짐, Esc는 저장하지 않음). 기호 · 없음 줄: 첫 줄을 •로 바꾸면 뒤 두 줄이 • 단계를 따르고,
// 둘째 줄 ◀는 누른 줄과 이어진 줄을 두 편집으로 내어 쓴다 - Undo 한 번은 이어진 줄만, 두 번은 누른 줄까지. 끝에 •도 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: number levels - ◀ ▶ step a number one level, outdent a plain line with the lines that follow, Undo in two steps", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const startOf = (unit) => unit.spans[0]?.[1] ?? -1;
  let doc = null;
  let found = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    if (!view.has_number_ranges) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    const ordered = view.units.filter((unit) => unit.number && unit.table_id === null).sort((a, b) => a.pos_seq - b.pos_seq || startOf(a) - startOf(b) || a.id - b.id);
    for (let index = 0; index + 3 < ordered.length && found === null; index += 1) {
      const [top, first, second, third] = ordered.slice(index, index + 4);
      if (!/^\d+\.$/.test(top.number.value ?? "") || top.number.is_set) continue;
      if (![first, second, third].every((unit) => unit.number.value === null && unit.number.read === null)) continue;
      if (new Set([top, first, second, third].map((unit) => unit.lang)).size !== 1) continue;
      let visible = true;
      for (const unit of [first, second, third]) {
        if ((await page.locator(`[data-testid="assign-paper-lead-${unit.id}"]`).count()) === 0 || (await page.locator(`[data-testid="assign-paper-lead-${unit.id}"]`).getAttribute("data-bracket")) !== null) visible = false;
      }
      if (visible) found = { top, first, second, third };
    }
    if (found !== null) {
      doc = candidate;
      break;
    }
  }
  check("the bundle has a number and three plain lines in one list on screen", found !== null);
  if (found === null) return;
  const { top, first, second, third } = found;
  const nextNumber = `${Number.parseInt(top.number.value, 10) + 1}.`;
  const readUnit = async (unitId) => (await readView(doc.id)).units.find((item) => item.id === unitId) ?? null;
  const waitUnit = async (unitId, isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const unit = await readUnit(unitId);
      if (unit && isDone(unit)) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const input = page.locator('[data-testid="assign-paper-num-input"]');
  const outdent = page.locator('[data-testid="assign-paper-num-outdent"]');
  const indent = page.locator('[data-testid="assign-paper-num-indent"]');
  // 번호 - 연속 번호를 누르면 위 번호 다음이 차고, ◀ ▶가 입력 칸 양옆에서 입력한 번호의 단계만 바꾼다(저장은 Enter)
  const firstCell = page.locator(`[data-testid="assign-paper-num-add-${first.id}"]`);
  await firstCell.scrollIntoViewIfNeeded();
  await firstCell.click();
  await page.locator('[data-testid="assign-paper-num-kind-continuous"]').click();
  await wait(page, "assign-paper-num-input");
  check("Continuous fills the number after the one above", (await input.inputValue()) === nextNumber, await input.inputValue());
  check("◀ is off on a top-level number", await outdent.isDisabled());
  const indentBox = await indent.boundingBox();
  await indent.click();
  check("▶ steps the number one level under the number before", (await input.inputValue()) === `${top.number.value}1.`, await input.inputValue());
  check("▶ stops one level past the number before", await indent.isDisabled());
  check("the buttons stay put while the number grows", JSON.stringify(await indent.boundingBox()) === JSON.stringify(indentBox), `${JSON.stringify(indentBox)} -> ${JSON.stringify(await indent.boundingBox())}`);
  await outdent.click();
  check("◀ steps back to the next number at the top level", (await input.inputValue()) === nextNumber, await input.inputValue());
  await input.press("Escape");
  await page.locator(`[data-testid="assign-paper-num-edit-${first.id}"]`).waitFor({ state: "detached", timeout: T });
  check("stepping without Enter saves nothing", (await readUnit(first.id)).number.value === null);
  // 기호 · 없음 줄 - 첫 번호 없는 줄을 •로, 뒤 두 줄은 그 단계를 따른다
  const leadWidth = async (unitId) => (await page.locator(`[data-testid="assign-paper-lead-${unitId}"]`).boundingBox())?.width ?? Number.NaN;
  const plainWidth = await leadWidth(second.id);
  await firstCell.click();
  await page.locator('[data-testid="assign-paper-num-kind-bullet-0"]').click();
  check("• saves", await waitUnit(first.id, (unit) => unit.number.value === "•"));
  const bulletWidth = await leadWidth(first.id);
  const waitWidths = async (isDone) => {
    for (let tries = 0; tries < 40; tries += 1) {
      if (isDone(await leadWidth(second.id), await leadWidth(third.id))) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  check("plain lines under a bullet take the bullet's level", bulletWidth > plainWidth && (await waitWidths((a, b) => a === bulletWidth && b === bulletWidth)), `${plainWidth} -> ${bulletWidth} / ${await leadWidth(second.id)} / ${await leadWidth(third.id)}`);
  const secondCell = page.locator(`[data-testid="assign-paper-num-add-${second.id}"]`);
  await secondCell.scrollIntoViewIfNeeded();
  await secondCell.click();
  await wait(page, "assign-paper-num-outdent");
  check("a plain line can step out, and in by one past the line above", !(await outdent.isDisabled()) && !(await indent.isDisabled()));
  await outdent.click();
  check("◀ outdents the clicked line", await waitUnit(second.id, (unit) => unit.indent_shift === -1));
  check("…and the plain line that follows in a second edit", await waitUnit(third.id, (unit) => unit.indent_shift === -1));
  check("the box stays open on the clicked line", (await page.locator(`[data-testid="assign-paper-num-edit-${second.id}"]`).count()) === 1);
  check("both lines now sit one level out", await waitWidths((a, b) => a === plainWidth && b === plainWidth), `${await leadWidth(second.id)} / ${await leadWidth(third.id)}`);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo puts back only the lines that followed", await waitUnit(third.id, (unit) => unit.indent_shift === 0));
  check("…and leaves the clicked line out", (await readUnit(second.id)).indent_shift === -1);
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo puts back the clicked line", await waitUnit(second.id, (unit) => unit.indent_shift === 0));
  await page.locator('[data-testid="assign-undo"]').click();
  check("a third Undo turns the bullet back into a plain line", await waitUnit(first.id, (unit) => unit.number.value === null && !unit.number.is_set));
});

// 글쇠(11-23 명세 B2, S4) - 바꾸는 글쇠는 Shift, 빠뜨리면 알림만. Tab은 번호 칸 ▶와 같은 들여쓰기, Ctrl+→는 다음 탭이고 뒤로 가기는 보던 탭으로 온다(다 돌아가면 이전 화면).
// 들여쓰기는 ⇧Tab과 Undo로, 사유 창은 Esc로 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: keys", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  const oldDocs = docs.filter((item) => item.side === "old" && item.status === "ready");
  const openDoc = async (docId) => {
    const select = page.locator('[data-testid="assign-old-doc"]');
    if ((await select.count()) === 0) return;
    await select.click();
    await page.locator(`[data-testid="assign-old-doc-option-${docId}"]`).click();
    await page.waitForTimeout(600);
  };
  const piece = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const pick = async (id) => {
    await piece(id).scrollIntoViewIfNeeded();
    await piece(id).click();
    await piece(id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  };
  const info = (text) => page.locator('[data-testid="toast-info"]', { hasText: text });
  const waitInfo = (text) => info(text).first().waitFor({ timeout: T }).then(() => true, () => false);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  // "N." 아래 번호 없는 줄 둘이 이어진 곳(짝 카드가 아닌 한 언어 목록) - 들여쓰기를 볼 자리
  const startOf = (unit) => unit.spans[0]?.[1] ?? -1;
  let found = null;
  for (const doc of oldDocs) {
    const view = await readView(doc.id);
    if (!view.has_number_ranges || found !== null) continue;
    await openDoc(doc.id);
    const ordered = view.units.filter((unit) => unit.number && unit.table_id === null).sort((a, b) => a.pos_seq - b.pos_seq || startOf(a) - startOf(b) || a.id - b.id);
    for (let index = 0; index + 2 < ordered.length && found === null; index += 1) {
      const [top, first, second] = ordered.slice(index, index + 3);
      if (!/^\d+\.$/.test(top.number.value ?? "") || new Set([top, first, second].map((unit) => unit.lang)).size !== 1) continue;
      if (![first, second].every((unit) => unit.number.value === null && unit.number.read === null)) continue;
      const leads = [first, second].map((unit) => page.locator(`[data-testid="assign-paper-lead-${unit.id}"]`));
      const isPlain = async (lead) => (await lead.count()) === 1 && (await lead.getAttribute("data-bracket")) === null;
      if ((await isPlain(leads[0])) && (await isPlain(leads[1]))) found = { doc, first, second };
    }
  }
  check("the bundle has plain lines under a number on screen", found !== null);
  if (found === null) return;
  const { doc, first, second } = found;
  const readShift = async (id) => (await readView(doc.id)).units.find((unit) => unit.id === id)?.indent_shift;
  const waitShifts = async (shift) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readShift(first.id)) === shift && (await readShift(second.id)) === shift) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  // H - 저장도 창도 없이 글쇠만 알린다, ⇧H는 사유 창
  await pick(first.id);
  let saves = 0;
  page.on("request", (item) => {
    if (item.url().includes("/groups/save")) saves += 1;
  });
  await page.keyboard.press("h");
  const isHinted = await waitInfo("⇧H: Hold");
  check("H alone holds nothing and names Shift+H", isHinted && saves === 0 && (await page.locator('[data-testid="assign-remark-modal"]').count()) === 0);
  await page.keyboard.press("Shift+H");
  await wait(page, "assign-remark-modal");
  check("Shift+H asks for the Remark of a hold", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-remark-modal"]').waitFor({ state: "detached", timeout: T });
  // R - 보통 줄의 Remark 창
  await pick(first.id);
  await page.keyboard.press("r");
  await wait(page, "assign-remark-modal");
  check("R opens the Remark window of the line", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-remark-modal"]').waitFor({ state: "detached", timeout: T });
  check("closing both windows saved nothing", saves === 0, String(saves));
  // M - 없앤 글쇠, ⇧T - 표 밖이면 까닭
  await pick(first.id);
  const rowBefore = await rowIds(page);
  const toastsBefore = await page.locator('[data-testid^="toast-"]').count();
  await page.keyboard.press("m");
  await page.waitForTimeout(300);
  check("M does nothing", (await rowIds(page)) === rowBefore && (await page.locator('[role="dialog"], [role="menu"]').count()) === 0 && (await page.locator('[data-testid^="toast-"]').count()) <= toastsBefore);
  await page.keyboard.press("Shift+T");
  check("Shift+T outside a table says why", await waitInfo("Only inside a table"));
  // Tab - 번호 칸 ▶와 같은 값(이어진 줄까지), ⇧Tab은 되돌린다. 포커스는 용지에 남는다
  await page.keyboard.press("Tab");
  check("Tab indents the picked line and the line that follows", await waitShifts(1), `${await readShift(first.id)} / ${await readShift(second.id)}`);
  check("Tab keeps the focus on the paper", await page.evaluate(() => Boolean(document.activeElement?.closest('[data-pane="old"] .pane-body'))));
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab outdents them again", await waitShifts(0), `${await readShift(first.id)} / ${await readShift(second.id)}`);
  await page.locator(`.strip[data-testid="assign-paper-piece-${first.id}"]:not([data-pending])`).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Shift+N");
  await wait(page, `assign-paper-num-edit-${first.id}`);
  check("Shift+N opens the number cell", true);
  await page.locator('[data-testid="assign-paper-num-indent"]').click();
  check("▶ in the number cell gives what Tab gave", await waitShifts(1), `${await readShift(first.id)} / ${await readShift(second.id)}`);
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="assign-paper-num-edit-${first.id}"]`).waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="assign-undo"]').click();
  for (let tries = 0; tries < 60 && (await readShift(second.id)) !== 0; tries += 1) await page.waitForTimeout(250);
  await page.locator('[data-testid="assign-undo"]').click();
  check("two Undos put both lines back", await waitShifts(0), `${await readShift(first.id)} / ${await readShift(second.id)}`);
  // ? - 오른쪽 칸 아래의 도움말(단축키 탭)
  await pick(first.id);
  await page.keyboard.press("?");
  await wait(page, "assign-help-keys");
  check("? opens the help on the keys tab", (await page.locator('[data-testid="assign-help-toggle"]').getAttribute("aria-expanded")) === "true" && (await page.locator('[data-testid="assign-help-keys"] kbd', { hasText: "⇧H" }).count()) === 1);
  // 탭 - 이전 화면(Documents)에서 들어와 Ctrl+→로 바꾸고, 뒤로 가기는 보던 탭 → 이전 화면
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const readTab = () => page.locator('[data-testid="assign-tabs"] [aria-selected="true"]').getAttribute("data-testid");
  let tabs = [];
  for (const { id } of oldDocs) {
    await openDoc(id);
    tabs = await page.locator('[data-testid="assign-tabs"] [role="tab"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    if (tabs.length > 1) break;
  }
  check("an Old document has more than one tab", tabs.length > 1, tabs.join(", "));
  if (tabs.length < 2) return;
  await page.waitForLoadState("networkidle");
  const address = page.url();
  await page.evaluate(() => {
    window.__keysStay = true;
  });
  const start = await readTab();
  await page.keyboard.press("Control+ArrowRight");
  await page.waitForFunction((tab) => document.querySelector('[data-testid="assign-tabs"] [aria-selected="true"]')?.getAttribute("data-testid") !== tab, start, { timeout: T });
  check("Ctrl+→ goes to the next tab on the same address", (await readTab()) === tabs[(tabs.indexOf(start) + 1) % tabs.length] && page.url() === address, `${start} -> ${await readTab()} ${page.url()}`);
  await page.keyboard.press("Control+ArrowLeft");
  await page.waitForFunction((tab) => document.querySelector('[data-testid="assign-tabs"] [aria-selected="true"]')?.getAttribute("data-testid") === tab, start, { timeout: T });
  check("Ctrl+← comes back", true);
  await page.goBack();
  await page.waitForFunction((tab) => document.querySelector('[data-testid="assign-tabs"] [aria-selected="true"]')?.getAttribute("data-testid") !== tab, start, { timeout: T });
  check("Back goes to the tab before", (await readTab()) === tabs[(tabs.indexOf(start) + 1) % tabs.length] && page.url() === address, `${await readTab()} ${page.url()}`);
  await page.goBack();
  await page.waitForFunction((tab) => document.querySelector('[data-testid="assign-tabs"] [aria-selected="true"]')?.getAttribute("data-testid") === tab, start, { timeout: T });
  check("going back through tabs does not load the screen again", await page.evaluate(() => window.__keysStay === true));
  await page.goBack();
  await page.waitForURL(`**/bundles/${halfBundleId}/documents`, { timeout: T });
  check("Back after the tabs are used up leaves for the screen before", true);
});

await runStep("assign: heading to sentence - Turn into sentences from the right-click menu, the group head and Back to heading, Undo steps back", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findHeadingOnScreen(page, readView, docs);
  check("the bundle has an unassigned heading on screen", unit !== null);
  if (unit === null) return;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-to_sentence");
  check("Turn into sentences is offered on a heading", (await page.locator('[data-testid="assign-ctx-to_sentence"]').getAttribute("aria-disabled")) === null);
  await page.locator('[data-testid="assign-ctx-to_sentence"]').click();
  const shifted = await waitView((view) => !view.units.some((item) => item.id === unit.id));
  check("the heading is replaced by sentences", shifted !== null);
  if (shifted === null) return;
  const sentences = shifted.units.filter((item) => item.from_heading && item.pos_seq === unit.pos_seq);
  check("the new lines are marked as shifted sentences", sentences.length > 0 && sentences.every((item) => item.kind === "sentence"), sentences.map((item) => item.kind).join(", "));
  check("their text covers the heading's text", sentences.map((item) => item.text).join(" ") === unit.text, sentences.map((item) => item.text).join(" | "));
  // 바꾼 줄 위 묶음 머리 - 꼬리표와 수, 줄 끝 되돌리기
  const head = page.locator(`[data-testid="assign-paper-shift-${sentences[0].id}"]`);
  await head.waitFor({ timeout: T });
  // 머리는 들어오는 움직임 동안 글자가 아직 보이지 않아 innerText가 꼬리표를 빼고 읽힌다(10번에 1번) - 보일 때까지 기다린 뒤 잰다
  const hasTag = await page
    .waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-shift-${id}"]`)?.innerText.includes("Heading → sentence"), sentences[0].id, { timeout: T })
    .then(() => true, () => false);
  check("a group head sits above the shifted lines", hasTag, await head.innerText());
  await takeShot("sop-assign-heading-shift.png");
  // 바꾼 줄을 고르면 Shape 맨 아래에 Back to heading
  await page.locator(`[data-testid="assign-paper-piece-${sentences[0].id}"]`).click();
  await wait(page, "assign-shape-heading-back");
  // 경합을 늘 재현한다: Back to heading 뒤 다시 받는 원문 보기(편집 직후 값)를 붙들어 두고, 서버에서 Undo가 끝난 뒤 그 보기를
  // Undo 응답보다 먼저 건넨다. 그때 편집의 따라가기가 남아 있으면 Undo로 은퇴한 제목 Unit을 골라 묶음을 부르다 404가 난다(콘솔 오류 검사).
  // 손잡이를 도중에 떼면(unroute · times) 붙든 요청이 그대로 흘러가 버린다 - 첫 요청만 붙들고 나머지는 흘려보낸 뒤 끝에서 뗀다
  const VIEW_URL = /\/api\/bundles\/\d+\/documents\/\d+\/view$/;
  const UNDO_URL = /\/api\/bundles\/\d+\/decisions\/undo$/;
  let releaseView = () => undefined;
  const viewHeld = new Promise((resolve) => { releaseView = resolve; });
  let isViewTaken = false;
  let isUndoTaken = false;
  await page.route(VIEW_URL, async (route) => {
    if (isViewTaken) return route.continue();
    isViewTaken = true;
    const response = await route.fetch();
    await viewHeld;
    await route.fulfill({ response });
  });
  await page.route(UNDO_URL, async (route) => {
    if (isUndoTaken) return route.continue();
    isUndoTaken = true;
    const response = await route.fetch();
    releaseView();
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ response });
  });
  await page.locator('[data-testid="assign-shape-heading-back"]').click();
  const back = await waitView((view) => !view.units.some((item) => item.id === sentences[0].id));
  const heading = back?.units.find((item) => item.kind === "heading" && item.pos_seq === unit.pos_seq && item.text === unit.text);
  check("Back to heading makes one heading of the line again", heading !== undefined);
  // 두 편집을 Undo로 하나씩 - 처음 Unit id로 돌아온다(첫 Undo는 붙든 응답이 건네질 때까지 기다린다)
  const undone = page.waitForResponse(UNDO_URL);
  await page.locator('[data-testid="assign-undo"]').click();
  await undone;
  await page.unrouteAll({ behavior: "wait" });
  check("Undo brings the sentences back", (await waitView((view) => sentences.every((item) => view.units.some((other) => other.id === item.id)))) !== null);
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo brings the original heading back", (await waitView((view) => view.units.some((item) => item.id === unit.id && item.kind === "heading"))) !== null);
});

await runStep("assign: heading to sentence - the group head's ↺ To heading turns the clause back in one edit", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findHeadingOnScreen(page, readView, docs);
  check("the bundle has an unassigned heading on screen", unit !== null);
  if (unit === null) return;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-to_sentence");
  await page.locator('[data-testid="assign-ctx-to_sentence"]').click();
  const shifted = await waitView((view) => !view.units.some((item) => item.id === unit.id));
  check("the heading turns into sentences", shifted !== null);
  if (shifted === null) return;
  const first = shifted.units.filter((item) => item.from_heading && item.pos_seq === unit.pos_seq)[0];
  await wait(page, `assign-paper-shift-revert-${first.id}`);
  await page.locator(`[data-testid="assign-paper-shift-revert-${first.id}"]`).click();
  const back = await waitView((view) => !view.units.some((item) => item.from_heading && item.pos_seq === unit.pos_seq));
  check("↺ To heading turns the whole group back into a heading", back !== null && back.units.some((item) => item.kind === "heading" && item.pos_seq === unit.pos_seq));
  await page.locator(`[data-testid="assign-paper-shift-${first.id}"]`).waitFor({ state: "detached", timeout: T });
  // 두 편집을 되돌려 처음 그대로 둔다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo shows the sentences again", (await waitView((view) => view.units.some((item) => item.id === first.id))) !== null);
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo restores the original heading", (await waitView((view) => view.units.some((item) => item.id === unit.id))) !== null);
});

await runStep("assign: unwrap table - Unwrap table turns the table into sentence lines with one rail and ↺ Back to table, Undo steps back", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const isLayout = (view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout === true;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  const unwrapped = await waitView(isLayout);
  check("Unwrap table makes the table a layout table", unwrapped !== null);
  if (unwrapped === null) return;
  const lines = unwrapped.units.filter((item) => item.kind === "cell_sentence" && item.table_id === unit.table_id && item.group_unit_id === null);
  check("every cell paragraph is its own line", lines.length > 0);
  // 서버가 먼저 바뀌고 화면은 새 원문 보기를 받아 걷기(160ms) 뒤에 바뀐다 - 칸 줄의 testid는 표 안에도 있어 그것만 기다리면 화면이 바뀌기 전에 잰다
  const isGone = await page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`).waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  check("the table line is gone from the paper", isGone);
  await waitForOldMotion(page);
  check("a cell line is a sentence card, not a table cell", (await page.locator(`[data-testid="assign-paper-piece-${lines[0].id}"]`).getAttribute("data-kind")) === "piece");
  await wait(page, `assign-paper-unwrap-head-${unit.table_id}`);
  // 머리는 단추 둘 - ✦ AI order(B11, AI가 꺼져 있으면 흐린 단추)와 ↺ Back to table
  const headButtons = await page.locator(`[data-testid="assign-paper-unwrap-head-${unit.table_id}"] button`).allTextContents();
  check("the group head holds ✦ AI order and ↺ Back to table", headButtons.map((text) => text.trim()).join(" | ") === "✦ AI order | ↺ Back to table", headButtons.join(" | "));
  check("the lines carry the left rail", (await page.locator(`[data-unwrap-scope="t${unit.table_id}"] .unwrap-rail`).count()) >= lines.length);
  await takeShot("sop-assign-unwrap.png");
  // 벗긴 줄을 고르면 Shape 맨 아래에도 ↺ Back to table(F12 A3)
  await page.locator(`[data-testid="assign-paper-piece-${lines[0].id}"]`).click();
  await wait(page, "assign-shape-rewrap");
  // Undo 한 번이면 처음 표 한 줄로 돌아온다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo wraps the table back into one line", (await waitView((view) => !isLayout(view) && view.units.some((item) => item.id === unit.id))) !== null);
  await page.locator(`[data-testid="assign-paper-unwrap-head-${unit.table_id}"]`).waitFor({ state: "detached", timeout: T });
});

// 벗긴 표 AI 순서 제안(B11) - 가짜 AI는 받은 줄 차례를 거꾸로 답한다. 미리 보기 → 제안대로 놓기 → 되돌리기, 다시 물어 그대로 두기
await runStep("assign: unwrap table - ✦ AI order previews the suggested order in place, Apply suggestion reorders in one undo step, Keep as is closes it", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const status = await page.request.get(`${BASE}/api/bundles/${halfBundleId}/ai/status`, { headers });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  const readAdoption = async (suggestionId) => (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/ai/suggestions/${suggestionId}`, { headers })).json()).adoption;
  const readLive = async () => {
    const page1 = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/ai/suggestions?kind=unwrap_order&result=applied&limit=100`, { headers })).json();
    return page1.items.filter((item) => item.adoption === null);
  };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const tableId = unit.table_id;
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  await wait(page, `assign-paper-unwrap-head-${tableId}`);
  await waitForOldMotion(page);
  // 용지에 보이는 덩이 줄 차례(줄 id) - 머리 줄 아래 같은 표의 벗긴 줄들
  const view = await readView(doc.id);
  const lineIds = new Set(view.units.filter((item) => item.kind === "cell_sentence" && item.table_id === tableId && item.group_unit_id === null && item.status !== "retired").map((item) => item.id));
  const readPaperOrder = () => page.evaluate((ids) => [...document.querySelectorAll('[data-testid^="assign-paper-piece-"]')]
    .map((el) => Number(el.getAttribute("data-testid").replace("assign-paper-piece-", "")))
    .filter((id, index, all) => ids.includes(id) && all.indexOf(id) === index), [...lineIds]);
  const before = await readPaperOrder();
  check("the unwrapped table has two or more lines on the paper", before.length >= 2, String(before.length));

  await page.locator(`[data-testid="assign-paper-unwrap-ai-${tableId}"]`).click();
  const apply = page.locator(`[data-testid="assign-paper-unwrap-ai-apply-${tableId}"]`);
  const hasPreview = await apply.waitFor({ timeout: 30000 }).then(() => true, () => false);
  check("✦ AI order brings a preview with Apply suggestion", hasPreview);
  if (!hasPreview) return;
  check("the busy chip is gone once the suggestion is in", (await page.locator(`[data-testid="assign-paper-unwrap-ai-busy-${tableId}"]`).count()) === 0);
  check("the ask button gives way to the preview buttons", (await page.locator(`[data-testid="assign-paper-unwrap-ai-${tableId}"]`).count()) === 0);
  const first = before[0];
  const firstChip = await getText(page, `assign-paper-unwrap-ai-move-${first}`);
  check("the first line carries its move chip (1 → last)", firstChip.trim() === `1 → ${before.length}`, firstChip);
  check("a moved line is tinted", (await page.locator(`[data-testid="assign-paper-piece-${first}"]`).getAttribute("data-unwrap-ai-moved")) === "");
  check("the preview does not move the lines yet", JSON.stringify(await readPaperOrder()) === JSON.stringify(before));
  await page.locator(`[data-testid="assign-paper-unwrap-head-${tableId}"]`).scrollIntoViewIfNeeded();
  await takeShot("sop-assign-unwrap-ai.png");
  const [suggestion] = await readLive();
  check("the server holds one live suggestion for the table", suggestion?.content.table_id === tableId);

  await apply.click();
  await page.locator(`[data-testid="assign-paper-unwrap-ai-apply-${tableId}"]`).waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  let after = [];
  for (let tries = 0; tries < 40; tries += 1) {
    after = await readPaperOrder();
    if (JSON.stringify(after) === JSON.stringify([...before].reverse())) break;
    await page.waitForTimeout(250);
  }
  check("Apply suggestion puts the lines in the suggested order", JSON.stringify(after) === JSON.stringify([...before].reverse()), JSON.stringify(after));
  check("the suggestion is recorded as taken as is", (await readAdoption(suggestion.id)) === "as_is");
  check("the ask button is back", (await page.locator(`[data-testid="assign-paper-unwrap-ai-${tableId}"]`).count()) === 1);

  // 되돌리기 한 번이면 처음 차례
  await page.locator('[data-testid="assign-undo"]').click();
  let undone = [];
  for (let tries = 0; tries < 40; tries += 1) {
    undone = await readPaperOrder();
    if (JSON.stringify(undone) === JSON.stringify(before)) break;
    await page.waitForTimeout(250);
  }
  check("one Undo puts the original order back", JSON.stringify(undone) === JSON.stringify(before), JSON.stringify(undone));

  // 다시 물어 그대로 두기 - 순서는 그대로, 제안은 버림으로
  await page.locator(`[data-testid="assign-paper-unwrap-ai-${tableId}"]`).click();
  const keep = page.locator(`[data-testid="assign-paper-unwrap-ai-dismiss-${tableId}"]`);
  const hasSecond = await keep.waitFor({ timeout: 30000 }).then(() => true, () => false);
  check("asking again brings a fresh preview", hasSecond);
  if (hasSecond) {
    const [second] = await readLive();
    await keep.click();
    await keep.waitFor({ state: "detached", timeout: T });
    check("Keep as is leaves the order alone", JSON.stringify(await readPaperOrder()) === JSON.stringify(before));
    check("the suggestion is recorded as rejected", second !== undefined && (await readAdoption(second.id)) === "rejected");
    check("no move chip is left", (await page.locator(`[data-testid^="assign-paper-unwrap-ai-move-"]`).count()) === 0);
  }

  // 다시 표로 - 벗기기를 되돌린다(위 되돌리기 한 칸 다음은 벗기기다)
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator(`[data-testid="assign-paper-unwrap-head-${tableId}"]`).waitFor({ state: "detached", timeout: T });
});

// 벗긴 칸 줄은 처음 불러온 줄 목록에 없었다 - 지우면 목록 처음(다른 문서 · 그림 탭)으로 튀었다(Assign 피드백 2026-11-20 항목 1)
await runStep("assign: unwrap table - deleting an unwrapped line picks the box right below and keeps the scroll", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  const unwrapped = await waitView((view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout === true);
  check("the table is unwrapped first", unwrapped !== null);
  if (unwrapped === null) return;
  await piece.waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  // 문서 차례(줄 이동과 같은 차례)로 벗긴 첫 줄과 그 바로 아래 박스
  const order = unwrapped.units.filter((item) => item.group_unit_id === null && item.kind !== "figure").sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0));
  const line = order.find((item) => item.kind === "cell_sentence" && item.table_id === unit.table_id);
  const below = order[order.indexOf(line) + 1];
  check("the unwrapped table has a line with a box below it", line !== undefined && below !== undefined);
  if (line === undefined || below === undefined) return;
  await page.locator(`[data-testid="assign-paper-piece-${line.id}"]`).click();
  await page.locator(`[data-testid="assign-paper-piece-${line.id}"][data-sel]`).waitFor({ timeout: T });
  const readScroll = () => page.evaluate(() => document.querySelector('[data-testid="assign-old"] .pane-body')?.scrollTop ?? Number.NaN);
  const before = await readScroll();
  await page.keyboard.press("Delete");
  check("Del deletes the unwrapped line", (await waitView((view) => view.units.some((item) => item.id === line.id && item.status === "confirmed"))) !== null);
  const isPicked = await page.locator(`[data-testid="assign-paper-piece-${below.id}"][data-sel]`).waitFor({ timeout: T }).then(() => true, () => false);
  const pickedNow = await page.locator('[data-testid^="assign-paper-piece-"][data-sel]').first().getAttribute("data-testid").catch(() => null);
  check("the box right below is picked", isPicked, `expected assign-paper-piece-${below.id}, picked ${pickedNow}`);
  await page.waitForTimeout(400);
  const after = await readScroll();
  check("the paper keeps its scroll (no jump to the top)", Math.abs(after - before) < 300, `scrollTop ${before} → ${after}`);
  // 되돌린다 - 삭제, 그다음 표 벗기기
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the deleted line back", (await waitView((view) => view.units.some((item) => item.id === line.id && item.status !== "confirmed"))) !== null);
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo wraps the table back", (await waitView((view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout !== true && view.units.some((item) => item.id === unit.id))) !== null);
});

// 삭제 줄은 고른 동안만 펼치고 떠나면 다시 접는다, 우클릭은 "삭제 취소"(Assign 피드백 2026-11-20 항목 2 · 5)
await runStep("assign: a deleted line opens only while picked, folds again on leaving, and right-click offers Undo delete", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc } = await findTableOnScreen(page, readView, docs);
  if (!doc) return check("the bundle has a document on screen", false);
  // 화면에 있는 미배정 짝 없는 문장 둘 - 하나는 지우고, 하나는 떠날 곳
  const sentences = [];
  for (const item of (await readView(doc.id)).units.filter((one) => one.kind === "sentence" && one.status === "unassigned" && one.pair_id === null)) {
    if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) > 0) sentences.push(item);
    if (sentences.length === 2) break;
  }
  check("the document has two unassigned sentences on screen", sentences.length === 2);
  if (sentences.length < 2) return;
  const [target, other] = sentences;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${target.id}"]`);
  const otherPiece = page.locator(`[data-testid="assign-paper-piece-${other.id}"]`);
  const fold = page.locator(`[data-testid="assign-paper-deleted-u${target.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await page.locator(`[data-testid="assign-paper-piece-${target.id}"][data-sel]`).waitFor({ timeout: T });
  await page.keyboard.press("Delete");
  check("Del confirms the sentence as deleted", (await waitView((view) => view.units.some((item) => item.id === target.id && item.status === "confirmed"))) !== null);
  // 고름이 아래로 옮겨 가면 접힌다 - 줄과 박스가 260ms 함께 있다가 박스가 떨어진다
  await fold.waitFor({ timeout: T });
  await piece.waitFor({ state: "detached", timeout: T });
  check("leaving the deleted box folds it to one faint line", true);

  await fold.click();
  await page.locator(`[data-testid="assign-paper-piece-${target.id}"][data-sel]`).waitFor({ timeout: T });
  await fold.waitFor({ state: "detached", timeout: T });
  const opened = await page.evaluate((id) => {
    const holder = document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.closest(".deleted-open");
    const inner = holder?.querySelector(":scope > .fold-inner");
    return { tint: holder ? getComputedStyle(holder.querySelector(".strip[data-strip-unit]")).backgroundColor : "", paper: getComputedStyle(document.querySelector('[data-testid="assign-old"] .strip[data-strip-unit]')).backgroundColor, overflow: inner ? getComputedStyle(inner).overflow : "" };
  }, target.id);
  check("clicking the line opens the box on a faint danger tint", opened.tint !== "" && opened.tint !== opened.paper, JSON.stringify(opened));
  check("once open the fold stops clipping (the picked ring and number editor show)", opened.overflow === "visible", opened.overflow);

  await otherPiece.click();
  await page.locator(`[data-testid="assign-paper-piece-${other.id}"][data-sel]`).waitFor({ timeout: T });
  await fold.waitFor({ timeout: T });
  await piece.waitFor({ state: "detached", timeout: T });
  check("picking another box folds the deleted line again", true);

  // Space 문단 Excel 미리보기(한 단) - 지운 줄은 숨기고, 지운 박스를 고른 동안만 그 행이 빨간 음영 · 취소선(Assign 피드백 항목 9, B9)
  await setPaneView(page, "one");
  await fold.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press(" ");
  await wait(page, "assign-space-preview-body");
  const deletedRow = page.locator('[data-testid="assign-space-preview-body"] tr[data-mark="deleted"]');
  check("the paragraph sheet hides the deleted line while another box is picked", (await deletedRow.count()) === 0);
  await fold.click();
  const isShown = await deletedRow.first().waitFor({ timeout: T }).then(() => true, () => false);
  check("picking the deleted box shows its row on a red tint", isShown);
  if (isShown) {
    const cells = await deletedRow.first().locator("td").evaluateAll((tds) => tds.map((td) => ({ text: td.textContent, line: getComputedStyle(td).textDecorationLine })));
    check("the deleted row strikes its text, leaves Lang empty and says Deleted in Remark", cells[1]?.line === "line-through" && cells[2]?.text === "" && (cells[4]?.text ?? "").startsWith("Deleted"), JSON.stringify(cells));
  }
  await otherPiece.click();
  check("picking another box hides the deleted row again", await deletedRow.first().waitFor({ state: "detached", timeout: T }).then(() => true, () => false));
  await page.keyboard.press("Escape");
  await setPaneView(page, "two");
  await fold.waitFor({ timeout: T });

  // 판 위쪽으로 - 메뉴가 펼친 박스 아래에 설 자리가 있게(위아래 다 모자라면 메뉴는 누른 자리 곁에 겹쳐 선다)
  await fold.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(150);
  await fold.click({ button: "right" });
  await wait(page, "assign-ctx-menu");
  await page.locator(`[data-testid="assign-paper-piece-${target.id}"][data-sel]`).waitFor({ timeout: T });
  const undoItem = page.locator('[data-testid="assign-ctx-clear"]');
  check("right-click on the folded line opens the menu with Undo delete", (await undoItem.innerText()).includes("Undo delete"), await undoItem.innerText());
  check("the menu of a deleted line has no Delete", (await page.locator('[data-testid="assign-ctx-delete"]').count()) === 0);
  await fold.waitFor({ state: "detached", timeout: T });
  const menuBox = await page.locator('[data-testid="assign-ctx-menu"]').boundingBox();
  const boxRect = await piece.boundingBox();
  const isCovering = menuBox && boxRect && menuBox.y < boxRect.y + boxRect.height && menuBox.y + menuBox.height > boxRect.y && menuBox.x < boxRect.x + boxRect.width && menuBox.x + menuBox.width > boxRect.x;
  check("the menu does not cover the box it opened", !isCovering, JSON.stringify({ menuBox, boxRect }));
  check("the side panel calls Unassign Undo delete too", (await page.locator('[data-testid="assign-clear"]').innerText()).includes("Undo delete"));
  await undoItem.click();
  check("Undo delete brings the sentence back unassigned", (await waitView((view) => view.units.some((item) => item.id === target.id && item.status === "unassigned"))) !== null);
  await page.locator(`[data-testid="assign-paper-piece-${target.id}"]`).waitFor({ timeout: T });
  check("no folded line is left", (await fold.count()) === 0);
});

// 벗기고 다시 표로 묶어도 표 머리가 칸의 같은 높이에 남는다 - 브라우저 스크롤 고정은 바뀌는 표 안을 놓쳤고, 따라가기가 첫 줄로 굴렸다(Assign 피드백 2026-11-20 항목 11)
await runStep("assign: unwrap table - unwrapping and wrapping back keep the table head at the same height in the pane", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit: first } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", first !== null);
  if (first === null) return;
  // 그 문서에서 가장 아래 표 - 위에 글이 있어야 한다
  const tables = (await readView(doc.id)).units.filter((item) => item.kind === "table" && item.status === "unassigned").sort((a, b) => b.pos_seq - a.pos_seq);
  let unit = first;
  for (const item of tables) {
    if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) === 0) continue;
    unit = item;
    break;
  }
  const isLayout = (view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout === true;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  // 표 머리(바뀌는 곳의 첫 요소)의 칸 안 높이 - 표 줄이든 벗긴 머리 줄이든 같은 data-unwrap-scope다
  const readHeadTop = () => page.evaluate((scope) => {
    const pane = document.querySelector('[data-testid="assign-old"] .pane-body');
    const head = pane?.querySelector(`[data-unwrap-scope="${scope}"]`);
    return pane && head ? head.getBoundingClientRect().top - pane.getBoundingClientRect().top : Number.NaN;
  }, `t${unit.table_id}`);
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  // 칸 가운데쯤에 둔다 - 위로 굴릴 여유가 있어야 자리를 지키는지 보인다(문서 맨 위 표는 scrollTop 0이라 더 올릴 수 없다)
  const scrollTop = await piece.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
    return element.closest(".pane-body")?.scrollTop ?? 0;
  });
  check("the table has room above it to scroll", scrollTop >= 40, `scrollTop ${scrollTop}`);
  await page.waitForTimeout(300);
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  // 편집 응답을 잠깐 붙든다 - 처리 중 표시가 표를 조금 미는 것까지 그려진 뒤의 자리가 지킬 자리다
  const holdEdit = async (press) => {
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const handler = async (route) => { await gate; await route.continue(); };
    await page.route((url) => url.pathname.endsWith(`/documents/${doc.id}/edits`), handler);
    await press();
    await page.waitForTimeout(400);
    const top = await readHeadTop();
    release();
    await page.unroute((url) => url.pathname.endsWith(`/documents/${doc.id}/edits`), handler);
    return top;
  };
  const beforeUnwrap = await holdEdit(() => page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click());
  check("the table is unwrapped", (await waitView(isLayout)) !== null);
  await piece.waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  await page.waitForTimeout(400);
  const afterUnwrap = await readHeadTop();
  check("unwrapping keeps the table head where it was", Math.abs(afterUnwrap - beforeUnwrap) <= 1.5, `head top ${beforeUnwrap} → ${afterUnwrap}`);
  const beforeWrap = new Set((await readView(doc.id)).units.map((item) => item.id));
  const waitGroupLoad = watchGroupLoads(page);
  const beforeWrap2 = await holdEdit(() => page.locator(`[data-testid="assign-paper-rewrap-${unit.table_id}"]`).click());
  const wrapped = await waitView((view) => !isLayout(view));
  check("Back to table wraps it", wrapped !== null);
  await page.locator(`[data-testid="assign-paper-unwrap-head-${unit.table_id}"]`).waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  // 새 표 줄을 따라가 그 관계 묶음을 받는 것까지 기다린다 - 그 뒤에 스크롤이 굴렀는지 본다
  await waitGroupLoad((wrapped?.units ?? []).filter((item) => !beforeWrap.has(item.id)).map((item) => item.id));
  await page.waitForTimeout(400);
  const afterWrap = await readHeadTop();
  check("wrapping back keeps the table head where it was", Math.abs(afterWrap - beforeWrap2) <= 1.5, `head top ${beforeWrap2} → ${afterWrap}`);
});

await runStep("assign: unwrap table - ↺ Back to table asks once when a line is assigned and wraps the table back", { drafting: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const isLayout = (view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout === true;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  const unwrapped = await waitView(isLayout);
  check("the table is unwrapped first", unwrapped !== null);
  if (unwrapped === null) return;
  const line = unwrapped.units.find((item) => item.kind === "cell_sentence" && item.table_id === unit.table_id && item.group_unit_id === null);
  // 화면이 벗긴 표로 바뀐 뒤에 누른다 - 그 전에는 같은 testid의 칸 조각이 표 안에 있어 누르면 표 전체가 골라진다
  await piece.waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  await page.locator(`[data-testid="assign-paper-piece-${line.id}"]`).click();
  await wait(page, "assign-row-id");
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  check("a line of the unwrapped table is assigned", (await waitView((view) => view.units.some((item) => item.id === line.id && item.status === "confirmed"))) !== null);
  // 다시 표로 - 배정이 있으면 서버에 보내기 전에 확인창이 한 번 묻는다(409 없이). 취소하면 그대로다
  await page.locator(`[data-testid="assign-paper-rewrap-${unit.table_id}"]`).click();
  await wait(page, "assign-edit-confirm");
  check("the confirm names the table", (await getText(page, "assign-edit-confirm")).includes("Wrap table"), await getText(page, "assign-edit-confirm"));
  await page.locator('[data-testid="assign-edit-confirm-cancel"]').click();
  await page.locator('[data-testid="assign-edit-confirm"]').waitFor({ state: "detached", timeout: T });
  check("cancelling keeps the table unwrapped", isLayout(await readView(doc.id)));
  await page.locator(`[data-testid="assign-paper-rewrap-${unit.table_id}"]`).click();
  await wait(page, "assign-edit-confirm");
  const beforeWrap = new Set((await readView(doc.id)).units.map((item) => item.id));
  const waitGroupLoad = watchGroupLoads(page);
  await page.locator('[data-testid="assign-edit-confirm-confirm"]').click();
  const wrapped = await waitView((view) => !isLayout(view));
  check("Back to table wraps it into one table line", wrapped !== null && wrapped.units.some((item) => item.kind === "table" && item.table_id === unit.table_id));
  check("the line's assignment is cleared", wrapped?.units.find((item) => item.id === line.id)?.status === "unassigned");
  check("the screen follows the new table line and loads its group", await waitGroupLoad((wrapped?.units ?? []).filter((item) => !beforeWrap.has(item.id)).map((item) => item.id)));
  // 시드 묶음을 처음 그대로 둔다. Assign Undo로는 못 돌아간다 - 확인하고 한 편집이 푼 배정은 되돌리기가 살리지 않아(Assign 되돌리기 설계 §4.4)
  // 배정 단계의 되돌리기가 거절되고, 그 밑의 벗기기에 닿지 못한다. 다시 표로 묶어도 처음 모양은 아니다(벗길 때 문장이 된 캡션 · 번호 칸을 받은 줄은
  // 그대로 남는다). 그래서 문서 편집 기록을 API로 두 번 되돌린다(다시 표로 → 벗기기) - 처음 표 Unit과 캡션이 같은 id로 돌아오고, 배정은 이미 풀렸다
  for (let step = 0; step < 2; step += 1) {
    const revision = (await readView(doc.id)).document.revision;
    const response = await page.request.post(`${BASE}/api/bundles/${halfBundleId}/documents/${doc.id}/edits/undo`, { headers, data: { revision } });
    check(`document edit undo ${step + 1} goes through`, response.ok(), String(response.status()));
  }
  check("the original table line is back", (await waitView((view) => !isLayout(view) && view.units.some((item) => item.id === unit.id && item.status === "unassigned"))) !== null);
});

// 벗긴 표 줄 순서(설계 2026-11-20-assign-mockup2 D2) - 벗긴 표의 줄을 고르면 왼쪽에 점 여섯 손잡이, 끌어 덩이 첫 줄 위에 놓으면 편집 reorder_unwrapped로
// 순서가 바뀌고 용지 · 문단 Excel이 따른다(지금 문단 Excel은 칸 줄을 표 행으로 묶어 그 행의 차례만 바뀐다 - 열 꼴은 보지 않고 글로 줄 차례만 본다).
// Undo가 순서를 되돌리고, 한 번 더 Undo가 벗기기를 되돌려 시드 묶음을 처음 그대로 둔다
await runStep("assign: unwrap table - the grip moves a line to the top, Undo puts it back, the paragraph Excel follows", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const docs = await (await page.request.get(`${api}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${api}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const { doc, unit } = await findTableOnScreen(page, readView, docs);
  check("the bundle has an unassigned table on screen", unit !== null);
  if (unit === null) return;
  const isLayout = (view) => view.tables.find((table) => table.id === unit.table_id)?.is_layout === true;
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView(doc.id);
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const isBefore = (one, two) => page.waitForFunction(([first, second]) => {
    const a = document.querySelector(`[data-testid="assign-paper-piece-${first}"]`);
    const b = document.querySelector(`[data-testid="assign-paper-piece-${second}"]`);
    return a !== null && b !== null && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [one, two], { timeout: T }).then(() => true, () => false);
  const isEditCall = (pattern) => (response) => response.request().method() === "POST" && pattern.test(new URL(response.url()).pathname);
  // 문단 Excel의 줄마다 Text 칸(B열) 글 - 받은 파일을 backend의 openpyxl로 읽는다(섹션 번호 · 언어 · 노트 · Remark 칸은 보지 않는다)
  const readParagraphRows = async () => {
    const response = await page.request.get(`${api}/documents/${doc.id}/paragraphs.xlsx`, { headers });
    return response.ok() ? readXlsxRows(await response.body()).map((row) => row[1] ?? "") : [];
  };
  // 그 줄 글이 칸 문단 하나와 꼭 같은 줄을 먼저 찾고(짧은 칸 글이 앞 본문에 섞여 있어도), 없으면 글이 든 줄(한 문단을 나눈 문장)
  // Text 칸은 번호 칸의 번호를 뺀 글이다(번호는 Section No. 칸) - 줄 글에서 그 번호를 떼고 찾는다
  const contentOf = (item) => (item.number?.value && item.text.startsWith(item.number.value) ? item.text.slice(item.number.value.length).trim() : item.text);
  const firstRowWith = (rows, text) => {
    const exact = rows.findIndex((row) => row.split(/[\t\n]/).includes(text));
    return exact >= 0 ? exact : rows.findIndex((row) => row.includes(text));
  };

  // 벗기기는 화면에서(Shape의 Unwrap table) - 앞 단계가 본 길
  const piece = pieceOf(unit.id);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await wait(page, `assign-shape-table_layout-${unit.id}`);
  await page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`).click();
  const unwrapped = await waitView(isLayout);
  check("the table is unwrapped first", unwrapped !== null);
  if (unwrapped === null) return;
  await piece.waitFor({ state: "detached", timeout: T });
  await waitForOldMotion(page);
  await page.waitForLoadState("networkidle");
  // 덩이 첫 칸 줄과, 다른 행의 짝 없는 줄 가운데 가장 가까운 것 - 둘은 문단 Excel에서도 다른 줄이다(벗긴 칸 줄은 줄마다 한 줄)
  const lines = unwrapped.units.filter((item) => item.kind === "cell_sentence" && item.table_id === unit.table_id && item.group_unit_id === null).sort(sourceOrder);
  const top = lines[0];
  const moved = lines.find((item) => item.pair_id === null && item.row_index !== top?.row_index);
  check("the unwrapped table has a line in another row to move", top !== undefined && moved !== undefined, String(lines.length));
  if (top === undefined || moved === undefined) return;
  const excelBefore = await readParagraphRows();
  check("the paragraph Excel lists the first line's row before the moved line's row", firstRowWith(excelBefore, contentOf(top)) >= 0 && firstRowWith(excelBefore, contentOf(top)) < firstRowWith(excelBefore, contentOf(moved)), JSON.stringify(excelBefore.slice(0, 8)));

  // 줄을 고르면 그 박스 왼쪽에 손잡이 - 짝 카드 손잡이와 같은 모양(.strip-grip)
  await pieceOf(moved.id).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await pieceOf(moved.id).click();
  const grip = page.locator(`[data-testid="assign-paper-unwrap-grip-${moved.id}"]`);
  await grip.waitFor({ timeout: T });
  check("the picked line has the six-dot grip, the first line has none", (await grip.getAttribute("class")) === "strip-grip" && (await page.locator(`[data-testid="assign-paper-unwrap-grip-${top.id}"]`).count()) === 0);

  // 손잡이를 첫 줄 위쪽으로 끈다 - 상태 글은 벗긴 표 안 옮기기, 끝은 "→ order", 놓일 자리 선
  const from = await grip.boundingBox();
  const to = await pieceOf(top.id).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, to.y + 3, { steps: 12 });
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
    dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    line: !(document.querySelector('[data-testid="drop-line"]')?.hidden ?? true),
  }));
  check("dragging the grip says Move inside the unwrapped table, → order, with a drop line", during.note === "Move inside the unwrapped table" && during.dest === "→ order" && during.line, JSON.stringify(during));
  const edited = page.waitForResponse(isEditCall(/\/documents\/\d+\/edits$/), { timeout: T });
  await page.mouse.up();
  const response = await edited;
  const op = JSON.parse(response.request().postData()).op;
  const ids = op.unit_ids ?? [];
  check("the drop sends reorder_unwrapped with every line once and the moved line before the first (200)", response.status() === 200 && op.type === "reorder_unwrapped" && op.table_id === unit.table_id && new Set(ids).size === ids.length && lines.every((item) => ids.includes(item.id)) && ids.indexOf(moved.id) < ids.indexOf(top.id), `${response.status()} ${JSON.stringify(op)}`);
  await page.waitForLoadState("networkidle");
  check("the paper shows the moved line above the first line", await isBefore(moved.id, top.id));
  const after = await readView(doc.id);
  const seqOf = (view, item) => view.units.find((entry) => entry.id === item.id)?.unwrap_seq ?? null;
  check("the view API keeps the new order", seqOf(after, moved) === ids.indexOf(moved.id) && seqOf(after, top) === ids.indexOf(top.id), JSON.stringify([seqOf(after, moved), seqOf(after, top)]));
  const excelAfter = await readParagraphRows();
  check("the paragraph Excel follows - the moved line's row comes first", firstRowWith(excelAfter, contentOf(moved)) >= 0 && firstRowWith(excelAfter, contentOf(moved)) < firstRowWith(excelAfter, contentOf(top)), JSON.stringify(excelAfter.slice(0, 8)));

  // Undo가 원문 순서로 되돌린다 - unwrap_seq가 비고 문단 Excel도 처음 차례
  const undone = page.waitForResponse(isEditCall(/\/decisions\/undo$/), { timeout: T });
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo answers 200", (await undone).status() === 200);
  await page.waitForLoadState("networkidle");
  check("after Undo the first line is on top again", await isBefore(top.id, moved.id));
  const back = await readView(doc.id);
  check("after Undo the view API has no line order", lines.every((item) => seqOf(back, item) === null));
  const excelBack = await readParagraphRows();
  check("after Undo the paragraph Excel has the first line's row first again", firstRowWith(excelBack, contentOf(top)) >= 0 && firstRowWith(excelBack, contentOf(top)) < firstRowWith(excelBack, contentOf(moved)));

  // 한 번 더 Undo면 벗기기도 돌아가 처음 표 한 줄이다(시드 묶음을 처음 그대로 둔다)
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("a second Undo wraps the table back into one line", (await waitView((view) => !isLayout(view) && view.units.some((item) => item.id === unit.id))) !== null);
  await page.locator(`[data-testid="assign-paper-unwrap-head-${unit.table_id}"]`).waitFor({ state: "detached", timeout: T });
});

await runStep("assign: counterpart table - each table unwraps on its own with no dialog, unwrapping both pairs rows, Undo drops the pairs", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === PAIR_TABLES_TITLE);
  check("the demo seed has the separate-tables bundle", bundle !== undefined);
  if (!bundle) return;
  const docs = await (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents`, { headers })).json();
  const readView = async () => (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents/${docs[0].id}/view`, { headers })).json();
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView();
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const before = await readView();
  const [koWork, koValue, enWork, enValue] = before.tables;
  check("the view offers no counterpart tables", before.tables.every((table) => !("counterparts" in table)));
  const tableUnit = (view, tableId) => view.units.find((item) => item.kind === "table" && item.table_id === tableId);
  // 결정 칸 단추는 그 표가 처리 중이거나 묶음 전체 일(Undo) 중이면 잠기고(시안 1 스텝 4 - 다른 표의 벗기기는 막지 않고 같은 문서 쓰기 줄에 선다),
  // 다시 받으면 따라가기가 고름을 바꾼다 - 단추가 풀린 것을 본 뒤에 누른다.
  // 누른 뒤에는 화면이 단위 목록을 다시 받을 때까지 기다린다(받기 전에 다른 줄을 누르면 늦게 온 목록이 고름을 되돌렸다)
  const unwrapFromShape = async (tableId) => {
    const unit = tableUnit(await readView(), tableId);
    const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
    const button = page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`);
    await piece.waitFor({ timeout: T });
    for (let tries = 0; tries < 40; tries += 1) {
      await piece.scrollIntoViewIfNeeded();
      await piece.click();
      await button.waitFor({ timeout: T });
      if ((await button.getAttribute("aria-disabled")) !== "true") break;
      await page.waitForTimeout(250);
    }
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/bundles/${bundle.id}/units`, { timeout: T }),
      button.click(),
    ]);
  };
  await page.goto(`${BASE}/bundles/${bundle.id}/assign`);
  await wait(page, "assign-bar");

  // 한글 작업 표 - 창 없이 그 표만 벗기고, 대응 표가 아직 묶여 있어 짝은 없다
  await unwrapFromShape(koWork.id);
  const one = await waitView((view) => view.tables[0].is_layout);
  check("the Korean work table unwraps alone with no dialog", one !== null && one.tables.filter((table) => table.is_layout).length === 1 && one.pairs.length === 0);
  check("no counterpart dialog opens", (await page.locator('[data-testid="assign-counterpart"]').count()) === 0);

  // 영어 작업 표도 벗기면 같은 행 · 같은 순서 줄이 한/영 짝으로 제안된다
  await unwrapFromShape(enWork.id);
  const both = await waitView((view) => view.tables[2].is_layout && view.pairs.length > 0);
  check("both work tables are unwrapped and paired", both !== null && !both.tables[1].is_layout && !both.tables[3].is_layout);
  if (!both) return;
  const texts = new Map(both.units.map((item) => [item.id, item.text]));
  const korean = both.units.find((item) => item.text === "세척액 농도를 확인한다.");
  const english = both.units.find((item) => item.text === "Check the detergent concentration.");
  const isPaired = both.pairs.some((pair) => pair.unit_ids.includes(korean?.id) && pair.unit_ids.includes(english?.id));
  check("the same row and order lines are a suggested KO/EN pair", isPaired, JSON.stringify(both.pairs.map((pair) => pair.unit_ids.map((id) => texts.get(id)))));
  if (!isPaired) return;
  // 짝의 아래 박스(영어 절반)를 누르면 그 박스가 골라지고(위 박스가 아니다), 멀리 있는 한글 절반의 짝은 곁에 딸린 표시(data-mate)다.
  // 고른 박스 아래 안내 줄은 위의 한글 짝을 가리키고, 누르면 그 짝으로 가서 고른다 - 거기서는 아래를 가리킨다(설계 2026-11-20 D3).
  // 오른쪽 칸에는 두 줄이 같이 뜬다
  const piece = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const hintOf = (id) => page.locator(`[data-testid="assign-paper-pair-hint-${id}"]`);
  // 벗기는 동안(새 보기를 놓을 때까지) 그 표의 박스만 잠긴다(빛이 지나가는 data-pending, 시안 1 스텝 4) - 전에는 그 사이 누름이 표 안 칸 조각에 떨어져
  // 은퇴할 표를 골랐다가 놓였다. 벗긴 줄이 되고 잠금이 풀린 것을 본 뒤 한 번 누른다(남은 전환 움직임은 click이 멎기를 기다린다)
  await page.locator(`.strip[data-testid="assign-paper-piece-${english.id}"]:not([data-pending])`).waitFor({ timeout: T });
  await piece(english.id).click();
  await piece(english.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  check("clicking the lower box of a far pair picks that box, the upper one is marked as its mate", (await piece(korean.id).getAttribute("data-sel")) === null && (await piece(korean.id).getAttribute("data-mate")) === "");
  check("the right panel shows both lines", (await getText(page, "assign-shape")).includes("Check the detergent"), await getText(page, "assign-shape"));
  await hintOf(english.id).waitFor({ timeout: T });
  check("the hint under the picked box points up to the Korean pair", (await hintOf(english.id).getAttribute("data-dir")) === "up" && (await hintOf(english.id).getAttribute("data-target")) === String(korean.id) && (await hintOf(english.id).innerText()).includes("KO"), await hintOf(english.id).innerText());
  await hintOf(english.id).click();
  await piece(korean.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  // 스크롤은 다음 프레임(scrollToUnit) - 그 짝이 Old 칸 안에 들어올 때까지 기다린다
  const isPairInView = await page.waitForFunction((id) => {
    const el = document.querySelector(`[data-testid="assign-paper-piece-${id}"]`);
    const pane = el?.closest(".pane-body");
    if (!el || !pane) return false;
    const box = el.getBoundingClientRect();
    const view = pane.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  }, korean.id, { timeout: T }).then(() => true, () => false);
  check("the hint goes to the pair - it is picked and in view there and points back down", isPairInView && (await piece(english.id).getAttribute("data-mate")) === "" && (await hintOf(korean.id).getAttribute("data-dir")) === "down");
  // 글쇠 G는 안내 줄과 같은 짝으로 간다 - 다시 누르면 돌아온다
  await page.keyboard.press("g");
  await piece(english.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  await page.keyboard.press("g");
  await piece(korean.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  check("G goes to the pair and back", (await hintOf(korean.id).getAttribute("data-dir")) === "down");
  await takeShot("sop-assign-counterpart.png");

  // 1단 보기 - 안내 줄 한 번 누름은 오른쪽 짝 판(짝 박스와 앞뒤 3줄까지, 짝 박스를 칠함), 두 번 누름은 짝으로 간다(B7).
  // 자리가 넉넉하면 가운데 용지가 판 옆으로 비켜서고, 모자라면 판이 용지를 덮는다(용지 제자리) - 좁은 창과 넓은 창 둘 다 본다
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  const pairSpot = page.locator('[data-testid="assign-pair-spot"]');
  const readSheetLeft = () => page.locator('[data-testid="assign-old"] .pane-body > *').first().evaluate((el) => el.getBoundingClientRect().left);
  const openPairSpot = async () => {
    await hintOf(korean.id).click();
    await pairSpot.waitFor({ timeout: T });
    // 판이 들어오고 용지가 비켜서는 움직임이 끝날 때까지
    await pairSpot.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    await page.waitForFunction(() => !document.querySelector(".assign-panes[data-motion]"), null, { timeout: T });
  };
  const readLayout = () =>
    page.evaluate(() => {
      const pane = document.querySelector('[data-testid="assign-old"]').getBoundingClientRect();
      const sheet = document.querySelector('[data-testid="assign-old"] .pane-body > *').getBoundingClientRect();
      const panel = document.querySelector('[data-testid="assign-pair-spot"]').getBoundingClientRect();
      return { pane: pane.width, paneRight: pane.right, sheetLeft: sheet.left, sheetRight: sheet.right, panelLeft: panel.left, panelWidth: panel.width };
    });
  for (const width of [VIEWPORT.width, 1680, 1920]) {
    await page.setViewportSize({ width, height: VIEWPORT.height });
    const centred = await readSheetLeft();
    await openPairSpot();
    const layout = await readLayout();
    // 용지 옆에 판 자리(420px 이상)가 남으면 옆으로 비켜서고, 아니면 덮는다(lib/spot-place-model) - 용지 폭은 어느 쪽이든 그대로
    const isAside = layout.pane - (layout.sheetRight - layout.sheetLeft) - 12 >= 420;
    check(
      `at ${width}px one press opens the pair panel on the right with the pair box picked, the paper ${isAside ? "steps aside" : "stays and is covered"}`,
      (await pairSpot.getAttribute("data-side")) === "right" &&
        (await pairSpot.locator(`[data-testid="assign-spot-piece-${english.id}"][data-sel]`).count()) === 1 &&
        (await pairSpot.locator(".strip[data-strip-unit]").count()) <= 7 &&
        (await piece(korean.id).getAttribute("data-sel")) === "" &&
        Math.round(layout.panelWidth) <= 600 && layout.panelLeft + layout.panelWidth <= layout.paneRight + 1 &&
        (isAside ? layout.sheetRight <= layout.panelLeft + 1 && layout.sheetLeft < centred - 1 : Math.abs(layout.sheetLeft - centred) <= 1),
      JSON.stringify({ ...layout, centred }),
    );
    if (width === 1680) await takeShot("sop-assign-pair-spot.png");
    await page.keyboard.press("Escape");
    await pairSpot.waitFor({ state: "detached", timeout: T });
    await page.waitForFunction(() => !document.querySelector(".assign-panes[data-motion]"), null, { timeout: T });
    check(`at ${width}px Esc closes the pair panel and the paper is back in the middle`, Math.abs((await readSheetLeft()) - centred) <= 1);
  }
  await page.setViewportSize(VIEWPORT);
  // 판 안 짝 줄을 누르면 그 짝으로 간다
  await openPairSpot();
  await pairSpot.locator(`[data-testid="assign-spot-piece-${english.id}"]`).click();
  await pairSpot.waitFor({ state: "detached", timeout: T });
  await piece(english.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  check("a row in the pair panel closes it and picks that row", true);
  // 두 번 누름 - 판 없이 짝으로 간다
  await hintOf(english.id).dblclick();
  await piece(korean.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
  await page.waitForTimeout(400);
  check("a double press on the hint goes to the pair without a panel", (await pairSpot.count()) === 0);
  await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ timeout: T });

  // Undo 한 번은 영어 표만 표로 돌리고 짝도 빠진다, 한 번 더 하면 한글 표도 돌아온다
  await page.locator('[data-testid="assign-undo"]').click();
  check("one Undo wraps the English table back and drops the pairs", (await waitView((view) => view.tables[0].is_layout && !view.tables[2].is_layout && view.pairs.length === 0)) !== null);
  await page.locator('[data-testid="assign-undo"]').click();
  check("a second Undo wraps the Korean table back", (await waitView((view) => view.tables.every((table) => !table.is_layout))) !== null);

  // 행 수가 다른 값 표 - 둘 다 벗기면 짝 대신 문서 경고, Undo로 돌아오면 경고도 사라진다
  await unwrapFromShape(koValue.id);
  await waitView((view) => view.tables[1].is_layout);
  await unwrapFromShape(enValue.id);
  const differ = await waitView((view) => view.tables[1].is_layout && view.tables[3].is_layout);
  check("mismatched rows build no pairs", differ !== null && differ.pairs.length === 0);
  const readWarnings = async () => ((await (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents`, { headers })).json())[0].extraction.warnings).filter((warning) => warning.kind === "pair_rows_differ");
  check("a pair_rows_differ warning is left", (await readWarnings()).length === 1);
  await page.locator('[data-testid="assign-undo"]').click();
  await waitView((view) => !view.tables[3].is_layout);
  await page.locator('[data-testid="assign-undo"]').click();
  check("the seed bundle is left as found", (await waitView((view) => view.tables.every((table) => !table.is_layout))) !== null);
  check("the warning goes with Undo", (await readWarnings()).length === 0);
});

// 짝 판(1단 보기)을 열고 닫아도 용지 폭과 고른 박스의 화면 위쪽 자리가 그대로다(설계 2026-11-25 §6 S2) - 판이 용지 폭을 줄이면 위쪽 긴 줄이 다시 접혀 고른 박스가 위아래로 튀었다.
// 안내 줄 짝이 있는 문서는 앞 단계와 같은 시드 9번 묶음(두 작업 표를 벗겨 짝을 만든다). 끝에 Undo 두 번으로 시드를 그대로 둔다
await runStep("assign: the pair panel never moves the picked box up or down", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === PAIR_TABLES_TITLE);
  check("the demo seed has the separate-tables bundle", bundle !== undefined);
  if (!bundle) return;
  const docs = await (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents`, { headers })).json();
  const readView = async () => (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents/${docs[0].id}/view`, { headers })).json();
  const waitView = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const view = await readView();
      if (isDone(view)) return view;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const unwrapFromShape = async (tableId) => {
    const unit = (await readView()).units.find((item) => item.kind === "table" && item.table_id === tableId);
    const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"]`);
    const button = page.locator(`[data-testid="assign-shape-table_layout-${unit.id}"]`);
    await piece.waitFor({ timeout: T });
    for (let tries = 0; tries < 40; tries += 1) {
      await piece.scrollIntoViewIfNeeded();
      await piece.click();
      await button.waitFor({ timeout: T });
      if ((await button.getAttribute("aria-disabled")) !== "true") break;
      await page.waitForTimeout(250);
    }
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/bundles/${bundle.id}/units`, { timeout: T }),
      button.click(),
    ]);
  };
  const [koWork, , enWork] = (await readView()).tables;
  await page.goto(`${BASE}/bundles/${bundle.id}/assign`);
  await wait(page, "assign-bar");
  await unwrapFromShape(koWork.id);
  await waitView((view) => view.tables[0].is_layout);
  await unwrapFromShape(enWork.id);
  const both = await waitView((view) => view.tables[2].is_layout && view.pairs.length > 0);
  const korean = both?.units.find((item) => item.text === "세척액 농도를 확인한다.");
  const english = both?.units.find((item) => item.text === "Check the detergent concentration.");
  check("the two work tables are unwrapped and paired", Boolean(korean && english));
  if (!korean || !english) return;

  const piece = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const hint = page.locator(`[data-testid="assign-paper-pair-hint-${english.id}"]`);
  const pairSpot = page.locator('[data-testid="assign-pair-spot"]');
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  const settle = () => page.waitForFunction(() => !document.querySelector(".assign-panes[data-motion]"), null, { timeout: T });
  const setZoom = async (percent) => {
    for (let tries = 0; tries < 20; tries += 1) {
      const value = await getText(page, "assign-old-zoom-value");
      if (value === `${percent}%`) return;
      await page.locator(`[data-testid="assign-old-zoom-${Number.parseInt(value, 10) < percent ? "in" : "out"}"]`).click();
    }
  };
  // 용지 폭과 고른 박스 위쪽 - 판 아래 깔린 Old 칸을 그대로 잰다
  const measure = () =>
    page.evaluate((id) => ({
      top: document.querySelector(`[data-testid="assign-paper-piece-${id}"]`).getBoundingClientRect().top,
      sheet: document.querySelector('[data-testid="assign-old"] .pane-body > *').getBoundingClientRect().width,
    }), english.id);

  for (const width of [1920, 1440, 1280]) {
    for (const percent of [100, 160]) {
      await page.setViewportSize({ width, height: VIEWPORT.height });
      await setZoom(percent);
      await settle();
      await piece(english.id).click();
      await piece(english.id).and(page.locator("[data-sel]")).waitFor({ timeout: T });
      // 고른 박스 위에 긴 줄을 둔다 - 용지가 좁아지면 이 줄이 다시 접혀 박스가 아래로 밀린다
      await page.evaluate((id) => {
        const host = document.querySelector('[data-testid="assign-old"] .pane-body .sheet p, [data-testid="assign-old"] .pane-body .sheet .su');
        if (host && !host.querySelector("[data-smoke-long]")) {
          const long = document.createElement("span");
          long.dataset.smokeLong = "";
          long.textContent = ` ${"synthetic long line that wraps again when the paper gets narrower ".repeat(8)}`;
          host.append(long);
        }
        document.querySelector(`[data-testid="assign-paper-piece-${id}"]`).scrollIntoView({ block: "center" });
      }, english.id);
      await page.waitForTimeout(150);
      const before = await measure();
      await hint.click();
      await pairSpot.waitFor({ timeout: T });
      await pairSpot.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      await settle();
      const open = await measure();
      await page.keyboard.press("Escape");
      await pairSpot.waitFor({ state: "detached", timeout: T });
      await settle();
      const after = await measure();
      const label = `at ${width}px and ${percent}% zoom`;
      check(`${label} opening the pair panel keeps the paper width and the picked box in place`, Math.abs(open.top - before.top) <= 2 && Math.abs(open.sheet - before.sheet) <= 1, JSON.stringify({ before, open }));
      check(`${label} closing it puts the picked box and the paper width back`, Math.abs(after.top - before.top) <= 2 && Math.abs(after.sheet - before.sheet) <= 1, JSON.stringify({ before, after }));
    }
  }
  await page.setViewportSize(VIEWPORT);
  await setZoom(100);
  await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ timeout: T });

  // 시드를 그대로 둔다 - Undo 두 번(영어 표 → 한글 표)
  await page.locator('[data-testid="assign-undo"]').click();
  await waitView((view) => view.tables[0].is_layout && !view.tables[2].is_layout);
  await page.locator('[data-testid="assign-undo"]').click();
  check("the seed bundle is left as found", (await waitView((view) => view.tables.every((table) => !table.is_layout))) !== null);
});

// 좁은 창에서 오른쪽 칸 떼기(설계 2026-11-25 §6 S3) - 두 문서가 그 열을 쓰고, 판은 머리로 끌려 창 안에만 있고, 자리 · 접힘을 기억하고, 모달이 아니라 단축키가 그대로 된다
await runStep("assign: the side panel detaches below 1440px, drags inside the window, folds and comes back", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json()).filter((doc) => doc.side === "old" && doc.status === "ready");
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  const side = page.locator('[data-testid="assign-inspector"]');
  const detach = page.locator('[data-testid="assign-side-detach"]');
  const head = page.locator('[data-testid="assign-side-head"]');
  const fold = page.locator('[data-testid="assign-side-fold"]');
  const readPanes = async () => (await page.locator(".assign-panes").boundingBox()).width;
  const readSide = async () => side.boundingBox();
  const isInside = (box) => box.x >= 0 && box.y >= 0 && box.x + box.width <= VIEWPORT.width + 1 && box.y + box.height <= VIEWPORT.height + 1;
  const dragHead = async (dx, dy) => {
    const box = await head.boundingBox();
    const from = { x: box.x + 40, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const isNear = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

  // 떼기 - 두 문서가 넓어지고 판은 오른쪽 아래(여백 16), 폭 320 · 높이는 창의 70%
  check("a docked side panel has no drag head", (await head.count()) === 0 && (await side.getAttribute("data-float")) === null);
  const dockedPanes = await readPanes();
  await detach.click();
  await head.waitFor({ timeout: T });
  const start = await readSide();
  check("detaching gives its column to the two documents", (await readPanes()) > dockedPanes + 200, `${dockedPanes} → ${await readPanes()}`);
  check("the panel starts at the bottom right, 320px wide and 70% high", Math.abs(start.x - (VIEWPORT.width - 336)) <= 1 && Math.abs(start.y + start.height - (VIEWPORT.height - 16)) <= 1 && Math.abs(start.width - 320) <= 1 && Math.abs(start.height - VIEWPORT.height * 0.7) <= 1, JSON.stringify(start));
  check("the panel is not a dialog", (await side.getAttribute("role")) === null && (await side.getAttribute("aria-label")) !== null);
  await takeShot("sop-assign-side-float.png");

  // 머리를 끌어 옮기고 새로 고쳐도 그 자리
  await dragHead(-400, -200);
  const moved = await readSide();
  check("dragging the head moves the panel", isNear(moved, { x: start.x - 400, y: start.y - 200 }), JSON.stringify({ start, moved }));
  await page.reload();
  await wait(page, "assign-bar");
  await head.waitFor({ timeout: T });
  check("a reload keeps the panel detached at its place", isNear(await readSide(), moved), JSON.stringify(await readSide()));

  // 창 끝까지 끌어도 창 안
  const grabbed = await head.boundingBox();
  await dragHead(VIEWPORT.width - 1 - (grabbed.x + 40), VIEWPORT.height - 1 - (grabbed.y + grabbed.height / 2));
  const far = await readSide();
  check("dragging past the corner stops at the window edge", isInside(far) && Math.abs(far.x + far.width - VIEWPORT.width) <= 1 && Math.abs(far.y + far.height - VIEWPORT.height) <= 1, JSON.stringify(far));

  // 원문 누르기 · 글쇠 - 판이 떠 있어도 그대로
  await openLooseOldDoc(page, halfBundleId);
  let picked = null;
  for (const doc of docs) {
    for (const item of (await readView(doc.id)).units.filter((one) => one.kind === "sentence" && one.status === "unassigned" && one.pair_id === null)) {
      if ((await page.locator(`[data-testid="assign-paper-piece-${item.id}"]`).count()) === 0) continue;
      picked = { docId: doc.id, unit: item };
      break;
    }
    if (picked) break;
  }
  check("the bundle has an unassigned sentence on screen", picked !== null);
  if (picked === null) return;
  const piece = page.locator(`[data-testid="assign-paper-piece-${picked.unit.id}"]`);
  await piece.scrollIntoViewIfNeeded();
  await piece.click();
  await piece.and(page.locator("[data-sel]")).waitFor({ timeout: T });
  const idBefore = await rowIds(page);
  await page.keyboard.press("j");
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before, idBefore, { timeout: T }).catch(() => {});
  check("J moves to the next row with the panel floating", (await rowIds(page)) !== idBefore, idBefore);
  await piece.click();
  await piece.and(page.locator("[data-sel]")).waitFor({ timeout: T });
  const waitStatus = async (isDone) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if (isDone((await readView(picked.docId)).units.find((item) => item.id === picked.unit.id)?.status)) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  await page.keyboard.press("Delete");
  check("Del confirms the picked row as deleted with the panel floating", await waitStatus((status) => status === "confirmed"));
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the row back", await waitStatus((status) => status === "unassigned"));

  // 접기 - 머리 한 줄, 펼치면 그 자리에서 창 안으로
  await fold.click();
  await page.locator('[data-testid="assign-decide"]').waitFor({ state: "hidden", timeout: T });
  const folded = await readSide();
  check("folding leaves the head line only", Math.abs(folded.height - 36) <= 1 && (await fold.getAttribute("aria-expanded")) === "false" && isInside(folded), JSON.stringify(folded));

  // 1440 이상이면 늘 붙고(기억은 남는다) 다시 좁아지면 뗀 채 · 접은 채
  await page.setViewportSize({ width: 1440, height: VIEWPORT.height });
  await head.waitFor({ state: "detached", timeout: T });
  check("at 1440px the panel is docked, open, with no detach button", (await side.getAttribute("data-float")) === null && (await detach.count()) === 0 && (await page.locator('[data-testid="assign-noise-panel"], [data-testid="assign-pick"], [data-testid="assign-pick-prompt"]').first().isVisible()));
  await page.setViewportSize(VIEWPORT);
  await head.waitFor({ timeout: T });
  check("back at 1248px it floats again, folded as it was", (await side.getAttribute("data-folded")) === "" && isNear(await readSide(), folded), JSON.stringify(await readSide()));
  await fold.click();
  check("unfolding keeps the whole panel inside the window", (await side.getAttribute("data-folded")) === null && isInside(await readSide()) && Math.abs((await readSide()).height - VIEWPORT.height * 0.7) <= 1, JSON.stringify(await readSide()));

  // 붙이기
  await page.locator('[data-testid="assign-side-attach"]').click();
  await detach.waitFor({ timeout: T });
  check("attaching puts the column back", (await side.getAttribute("data-float")) === null && Math.abs((await readPanes()) - dockedPanes) <= 1, `${dockedPanes} → ${await readPanes()}`);
});

// 끌어서 보내기(끌어다 놓기 설계 §6, 3걸음) - Old 조각을 아직 쓰지 않은 New 문서(New · from Assign)의 두 문장 사이나 빈 칸에 놓으면 그 줄의 초안이 되고(저장하지 않는다),
// Confirm 때 문장 사이면 그 자리까지 저장한다. 자리를 받은 저장은 그 문서의 순서를 굳히고(manual_order) 화면에서 되돌릴 길이 없다 - 그래서 시드 묶음을 쓰는 Assign·Order 단계가 모두 끝난 뒤에 둔다.
// 자료는 이 단계가 API로 만든다(A·B·C를 칸 K에, P를 칸 K2에). 끝에 이 단계가 확정한 줄은 Clear(U)로 되돌린다(굳힌 순서는 남는다)
await runStep("assign: drag an Old piece between two sentences of a New · from Assign document, Confirm saves it at that place", { drafting: true }, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readUnits = async () => (await getJson("/units?limit=1000")).items;
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  check("the bundle has an SOP to write in Assign", sop !== undefined);
  const readSections = async () => (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections;
  const readIds = async (key) => (await readSections()).find((section) => section.location_key === key).items.map((item) => item.target_id);
  const readItems = async (key) => (await readSections()).find((section) => section.location_key === key).items;
  // 미배정·짝 없는 본문 문장이 가장 많은 Old 문서 - 문서 보기의 단위 순서가 원문 순서다
  const findLoose = async () => {
    const units = new Map((await readUnits()).map((unit) => [unit.unit_id, unit]));
    let best = null;
    for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
      const view = await getJson(`/documents/${doc.id}/view`);
      const loose = view.units.map((unit) => units.get(unit.id)).filter((unit) => unit && unit.kind === "sentence" && unit.status === "unassigned" && unit.decision.disposition === "unassigned" && unit.pair_id === null);
      if (best === null || loose.length > best.loose.length) best = { docId: doc.id, loose };
    }
    return best;
  };
  let found = await findLoose();
  if (found.loose.length < 6) {
    // 이 뒤의 단계는 이 묶음의 배정을 읽지 않는다 - 묶음 전체를 비우고 다시 고른다
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision } });
    found = await findLoose();
  }
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  // 그 Unit의 조각이 Old 칸에 없으면 그 문서를 연다(고른 줄이 풀린다)
  const showOldUnit = async (unit) => {
    if ((await pieceOf(unit.unit_id).count()) > 0) return true;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${unit.document_id}"]`).click();
    return pieceOf(unit.unit_id).waitFor({ timeout: 4000 }).then(() => true, () => false);
  };
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${found.docId}"]`).click();
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  await page.waitForTimeout(600);
  // 본문 용지에 조각이 보이는 것만(머리말·꼬리말 탭의 문장은 뺀다)
  const loose = [];
  for (const unit of found.loose) if ((await pieceOf(unit.unit_id).count()) > 0) loose.push(unit);
  check("an Old document shows six loose unassigned sentences", loose.length >= 6, String(loose.length));
  const [unitA, unitB, unitC, unitP, unitX, unitY] = loose;
  // 칸 고르기 - 하위 칸이 없는 칸만(상위 칸에 놓는 규칙은 이 걸음이 정하지 않는다)
  let sections = await readSections();
  const isLeaf = (key) => !sections.some((section) => section.location_key.startsWith(`${key}.`));
  // 문장을 받는 칸만 - 묶음(7 · 7.1)과 앱이 채우는 7.2는 줄이 없어도 놓을 곳이 아니다
  const empties = sections.filter((section) => takesLines(section) && section.na_reason === null && section.items.length === 0 && isLeaf(section.location_key)).map((section) => section.location_key);
  check("the SOP has three empty sections", empties.length >= 3, empties.join(","));
  const [slotK, slotK2, slotE, spare] = empties;
  let tobeBefore = null;
  if (!sections.some((section) => section.na_reason !== null && section.items.length === 0)) {
    // N/A 칸이 없으면 하나 만든다(끝에 되돌린다)
    tobeBefore = await getJson("/tobe");
    const pick = ({ code, title, doc_type, parent_code, is_equipment_sop, order_index }) => ({ code, title, doc_type, parent_code, is_equipment_sop, order_index });
    await page.request.put(`${api}/tobe`, { headers, data: { revision: tobeBefore.revision, docs: tobeBefore.docs.map(pick), na_slots: [...tobeBefore.na_slots, { code: sop.code, slot_key: spare, reason: "Synthetic smoke N/A" }], wi_steps: tobeBefore.wi_steps } });
    sections = await readSections();
  }
  const slotN = sections.find((section) => section.na_reason !== null && section.items.length === 0)?.location_key;
  check("the SOP has an N/A section", slotN !== undefined);
  // 자리 없는 저장으로 칸에 확정한다(화면의 저장과 같은 모양)
  const saveTo = async (unit, slotKey) => {
    const response = await page.request.post(`${api}/groups/save`, {
      headers,
      data: {
        action: "confirm",
        hold_reason: "",
        units: [{ unit_id: unit.unit_id, revision: unit.decision.revision, disposition: "assigned", move_target_code: "", reason: "" }],
        targets: [{ key: `u${unit.unit_id}`, target_doc_id: sop.id, slot_key: slotKey, kind: "sentence", lang: unit.lang, text: unit.text.trim(), source_unit_ids: [unit.unit_id] }],
        removed_target_ids: [],
      },
    });
    return response.ok();
  };
  const setupSaved = [await saveTo(unitA, slotK), await saveTo(unitB, slotK), await saveTo(unitC, slotK), await saveTo(unitP, slotK2)];
  const [a, b, c] = await readIds(slotK);
  const [p] = await readIds(slotK2);
  check("A, B and C sit in K and P in K2", setupSaved.every(Boolean) && [a, b, c, p].every((id) => id !== undefined), JSON.stringify(setupSaved));
  await page.reload();
  await wait(page, "assign-bar");
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 2걸음 단계의 도우미와 같다 - 조각 글의 첫 글줄 위 한 점, New 칸의 문서 바꾸기
  const pointInUnit = async (id) => {
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const newPane = page.locator('[data-testid="assign-new"]');
  const openNewDoc = async (docId) => {
    if ((await newPane.getAttribute("data-doc")) === String(docId)) return;
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), docId, { timeout: T });
  };
  // 엮은 문서의 줄 상자 - 아래 끝 가까이(묶음 아래 절반 → 그 뒤), 위 끝 가까이(위 절반 → 그 앞). 글 위 x
  const pointInItem = async (targetId, where) => {
    await centre(`[data-testid="assign-new-${targetId}"]`);
    await page.waitForTimeout(150);
    return page.evaluate(({ id, at }) => {
      const item = document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`).getBoundingClientRect();
      const line = document.querySelector(`[data-testid="assign-new-${id}"]`).getBoundingClientRect();
      const y = at === "bottom" ? item.bottom - 3 : at === "top" ? item.top + 3 : line.top + line.height / 2;
      return { x: line.left + Math.min(60, line.width / 2), y };
    }, { id: targetId, at: where });
  };
  const readMarks = () => page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    lines: document.querySelectorAll("svg[data-drag-line]").length,
    drops: document.querySelectorAll("[data-drop]").length,
    srcs: document.querySelectorAll("[data-drag-src]").length,
    gap: [...document.querySelectorAll('[data-testid="drop-line"]')].filter((el) => !el.hidden).length,
  }));
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
  }));
  const menu = page.locator('[data-testid="assign-link-menu"]');
  const draft = page.locator('[data-testid="assign-new-draft"]');
  // 화면이 보낸 /groups/save 요청 수(API로 만든 자료는 page.request라 세지 않는다) - 거절·취소·경주한 놓기는 저장하지 않는다
  let saveRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/groups/save")) saveRequests += 1;
  });
  // 놓으면 그 자리 메뉴 없이 바로 확정한다(1.2.0 피드백) - 놓기가 보낸 저장 요청 하나와 그 응답
  const dropAndSave = async (label) => {
    const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
    const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
    await page.mouse.up();
    const body = (await request).postDataJSON();
    const ok = (await response).ok();
    await page.waitForLoadState("networkidle");
    check(`${label}: the drop saves at once with no in-place menu`, ok && (await menu.count()) === 0);
    return { body, ok };
  };
  // 고름이 몇 번 적용됐나 - 고른 곳 상자 안에 새로 붙는 쉬머(.refresh-sweep, 보낼 곳이 바뀔 때마다 하나). 놓기 뒤따르는 click이 한 번 더 고르면 는다
  const watchPicks = () => page.evaluate(() => {
    window.__sweeps = 0;
    if (window.__pickWatch) return;
    window.__pickWatch = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.matches('[data-testid="assign-chosen"]')) for (const node of record.addedNodes) if (node instanceof Element && node.matches(".refresh-sweep")) window.__sweeps += 1;
      }
    });
    window.__pickWatch.observe(document.body, { subtree: true, childList: true });
  });
  const readPicks = () => page.evaluate(() => ({ sweeps: window.__sweeps }));
  const selectedPiece = () => page.evaluate(() => document.querySelector('[data-pane="old"] [data-testid^="assign-paper-piece-"][data-sel]')?.dataset.testid ?? null);
  // 저장 요청의 최상위 새 문장 - 그 Unit이 출처인 것
  const topItemsOf = (body, unitId) => body.targets.filter((target) => !target.parent_key && target.source_unit_ids.includes(unitId));
  await showOldUnit(unitX);
  await pieceOf(unitX.unit_id).waitFor({ timeout: T });
  await openNewDoc(sop.id);
  await page.locator(`[data-testid="assign-new-${b}"]`).waitFor({ timeout: T });

  // 1. 끄는 동안 - X를 K의 A와 B 사이로. 표의 메모는 "→ 칸", 놓을 자리 선은 A 줄 상자의 아래 끝, 테두리는 없다
  const belowA = await pointInItem(a, "bottom");
  await dragThrough(page, await pointInUnit(unitX.unit_id), [belowA]);
  await page.waitForTimeout(100);
  const during = await page.evaluate((id) => {
    const gap = document.querySelector('[data-testid="drop-line"]');
    const item = document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`).getBoundingClientRect();
    const box = gap && !gap.hidden ? gap.getBoundingClientRect() : null;
    return { note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "", dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "", lineY: box ? box.top + box.height / 2 : null, itemBottom: item.bottom, drops: document.querySelectorAll("[data-drop]").length };
  }, a);
  check("between two sentences the card says where it goes", during.note.startsWith("→ "), during.note);
  check("between two sentences the card ends with the same destination", during.dest === during.note, `${during.dest} / ${during.note}`);
  check("the drop line sits on the bottom edge of A", during.lineY !== null && Math.abs(during.lineY - during.itemBottom) <= 6, JSON.stringify(during));
  check("no box is outlined between sentences", during.drops === 0);
  await takeShot("sop-assign-drag-send.png");
  const aboveB = await page.evaluate((id) => {
    const item = document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`).getBoundingClientRect();
    return item.top + 3;
  }, b);
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 40; i += 1) await page.mouse.move(belowA.x + (i % 4) * 6, i % 2 === 0 ? belowA.y : aboveB);
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over and between sentences", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);

  // 2. 놓으면 바로 확정 - 끈 줄을 고르고 A와 B 사이 자리를 실어 저장한다. 뒤따르는 click이 한 번 더 고르지 않는다(Review Focus 5)
  await page.mouse.move(belowA.x, belowA.y);
  await watchPicks();
  const sentFirst = await dropAndSave("between sentences");
  const dropPicks = await readPicks();
  check("the drop picks once", dropPicks.sweeps <= 1, JSON.stringify(dropPicks));
  const firstItems = topItemsOf(sentFirst.body, unitX.unit_id);
  check("the drop saves the place right after A", firstItems.length === 1 && JSON.stringify(firstItems[0].position) === JSON.stringify({ after_target_id: a }), JSON.stringify(firstItems.map((item) => item.position)));
  const marksAfter = await readMarks();
  check("the drag leaves no marks behind", marksAfter.cards + marksAfter.lines + marksAfter.drops + marksAfter.srcs + marksAfter.gap === 0, JSON.stringify(marksAfter));
  await takeShot("sop-assign-drag-send-draft.png");
  // 3. 되돌리기가 그 확정을 거둔다 - 뒤 확인들은 X가 미배정이고 K가 A · B · C여야 한다
  await page.keyboard.press("ControlOrMeta+z");
  for (let step = 0; step < 30 && (await readUnits()).find((unit) => unit.unit_id === unitX.unit_id)?.status !== "unassigned"; step += 1) await page.waitForTimeout(300);
  check("Ctrl+Z takes the dropped sentence back", (await readUnits()).find((unit) => unit.unit_id === unitX.unit_id)?.status === "unassigned" && JSON.stringify(await readIds(slotK)) === JSON.stringify([a, b, c]));
  await page.waitForLoadState("networkidle");
  // 5. Esc - 끄다가 문장 사이에서 취소하면 아무것도 남지 않는다
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(a, "bottom")]);
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  const afterEsc = await readMarks();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("Esc cancels the drag between sentences", afterEsc.cards + afterEsc.lines + afterEsc.drops + afterEsc.srcs + afterEsc.gap === 0, JSON.stringify(afterEsc));
  check("a cancelled drag makes no draft and opens no menu", (await draft.count()) === 0 && (await menu.count()) === 0);

  // 5b. 놓자마자 j로 다음 줄로 - 끈 줄의 관계 묶음 응답을 늦춰 경주를 정해 두고, 늦게 온 초안이 옮겨 간 줄에 적용되지 않는지 본다(Review Focus 5).
  // X가 지금 고른 줄이다 - j로 X 다음 줄 R의 제 값을 읽고, Y를 골라 X가 고른 줄이 아니게 한다
  await page.keyboard.press("j");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const rowR = await selectedPiece();
  const chosenR = await getText(page, "assign-chosen");
  const yRacePoint = await pointInUnit(unitY.unit_id);
  await page.mouse.click(yRacePoint.x, yRacePoint.y);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unitY.unit_id, { timeout: T });
  await page.waitForLoadState("networkidle");
  await openNewDoc(sop.id);
  const lateGroup = `**/groups/by-unit/${unitX.unit_id}`;
  let lateHits = 0;
  await page.route(lateGroup, async (route) => {
    lateHits += 1;
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  const savesBeforeRace = saveRequests;
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(a, "bottom")]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.keyboard.press("j");
  await page.waitForTimeout(2500);
  await page.unroute(lateGroup);
  const race = { rowR, row: await selectedPiece(), chosen: await getText(page, "assign-chosen") === chosenR, drafts: await draft.count(), menu: await menu.count(), saves: saveRequests - savesBeforeRace, lateHits };
  check("j right after a drop moves on and the late draft is not applied to that row", rowR !== null && race.row === rowR && race.chosen && race.drafts === 0 && race.menu === 0 && race.saves === 0 && lateHits > 0, JSON.stringify(race));
  // 옮겨 간 줄이 New 칸을 그 줄의 문서로 돌렸을 수 있다
  await openNewDoc(sop.id);

  // 6. Confirm(↵) - 저장 요청이 자리를 싣고, X가 A 바로 뒤에 선다. 다시 읽어도, 화면의 줄 순서도 같다
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(a, "bottom")]);
  await page.waitForTimeout(100);
  const sentX = await dropAndSave("between sentences again");
  const xItems = topItemsOf(sentX.body, unitX.unit_id);
  check("the save carries the drop place", sentX.ok && xItems.length === 1 && JSON.stringify(xItems[0].position) === JSON.stringify({ after_target_id: a }), JSON.stringify(xItems.map((item) => item.position)));
  const kAfterX = await readItems(slotK);
  const x = kAfterX[1]?.target_id;
  check("X lands right after A", kAfterX.length === 4 && kAfterX[0].target_id === a && kAfterX[1].source_unit_ids.includes(unitX.unit_id) && kAfterX[2].target_id === b && kAfterX[3].target_id === c, JSON.stringify(kAfterX.map((item) => item.target_id)));
  await page.reload();
  await wait(page, "assign-bar");
  await openNewDoc(sop.id);
  await page.locator(`[data-testid="assign-new-${x}"]`).waitFor({ timeout: T });
  const screenK = await page.evaluate((ids) => [...document.querySelectorAll('[data-pane="new"] .new-item[data-row]')].map((el) => Number(el.dataset.row.slice(2))).filter((id) => ids.includes(id)), [a, x, b, c]);
  check("after a reload the API and the screen keep that order", JSON.stringify(await readIds(slotK)) === JSON.stringify([a, x, b, c]) && JSON.stringify(screenK) === JSON.stringify([a, x, b, c]), JSON.stringify(screenK));

  // 7. 빈 칸 - Y를 E에 놓으면 자리 없이 그 칸으로만
  await showOldUnit(unitY);
  await pieceOf(unitY.unit_id).waitFor({ timeout: T });
  await centre(`[data-testid="assign-new-slot-${slotE}"]`);
  const slotBox = await page.locator(`[data-testid="assign-new-slot-${slotE}"]`).boundingBox();
  await dragThrough(page, await pointInUnit(unitY.unit_id), [{ x: slotBox.x + Math.min(60, slotBox.width / 2), y: slotBox.y + slotBox.height / 2 }]);
  await page.waitForTimeout(100);
  check("over an empty section its placeholder is outlined", (await page.locator(`[data-testid="assign-new-slot-${slotE}"]`).getAttribute("data-drop")) === "over");
  const sentY = await dropAndSave("on an empty section");
  check("an empty section saves without a place", sentY.ok && sentY.body.targets.every((target) => !("position" in target)), JSON.stringify(sentY.body.targets));
  const eItems = await readItems(slotE);
  const y = eItems[0]?.target_id;
  check("Y lands in E", eItems.length === 1 && eItems[0].source_unit_ids.includes(unitY.unit_id), JSON.stringify(eItems.map((item) => item.target_id)));

  // 8. 못 놓는 곳 셋 - 이유를 보이고 아무것도 쓰지 않는다
  const unitsBefore = JSON.stringify((await readUnits()).map((unit) => [unit.unit_id, unit.status]));
  const savesBeforeRefusals = saveRequests;
  const refusals = [];
  // 저장 뒤 다음 줄로 옮겨 New 칸이 그 줄의 문서로 갔을 수 있다
  await openNewDoc(sop.id);
  await centre(`[data-testid="assign-new-slot-${slotN}"]`);
  const naBox = await page.locator(`[data-testid="assign-new-slot-${slotN}"]`).boundingBox();
  await dragThrough(page, await pointInUnit(unitY.unit_id), [{ x: naBox.x + Math.min(60, naBox.width / 2), y: naBox.y + naBox.height / 2 }]);
  await page.waitForTimeout(100);
  refusals.push({ where: "n/a", ...(await readCard()), drop: await page.locator(`[data-testid="assign-new-slot-${slotN}"]`).getAttribute("data-drop") });
  await page.mouse.up();
  await page.waitForTimeout(600);
  // 확정한 X를 K의 문장 위로 - 같은 칸 안의 순서는 Order에서 바꾼다
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(b, "middle")]);
  await page.waitForTimeout(100);
  refusals.push({ where: "same", ...(await readCard()), drop: await page.locator(`[data-testid="assign-new-${b}"]`).getAttribute("data-drop") });
  // 거절 테두리가 이웃 줄의 글·출처 칩을 덮지 않는다
  const refusedCover = await page.evaluate((id) => {
    const line = document.querySelector(`[data-testid="assign-new-${id}"]`);
    const width = parseFloat(getComputedStyle(line).outlineWidth);
    const offset = parseFloat(getComputedStyle(line).outlineOffset);
    const outer = line.getBoundingClientRect();
    const reach = { top: outer.top - width - offset, bottom: outer.bottom + width + offset };
    const item = line.closest(".new-item");
    const near = [item.previousElementSibling, item.nextElementSibling].filter((el) => el?.matches(".new-item"));
    const hits = near.flatMap((el) => [...el.querySelectorAll(".new-text, .new-src")]).map((el) => el.getBoundingClientRect()).filter((r) => r.bottom > reach.top && r.top < reach.bottom);
    return { width, offset, hits: hits.length };
  }, b);
  check("the refused outline does not cover the neighbouring lines", refusedCover.hits === 0, JSON.stringify(refusedCover));
  await page.mouse.up();
  await page.waitForTimeout(600);
  const written = await getJson("/written-sentences");
  await openNewDoc(written[0].target_doc_id);
  // 두 문장 사이 틈(없으면 줄의 앞머리 번호 칸) - 줄 상자 안이지만 문장 상자 밖
  const gapPoint = await page.evaluate(() => {
    const gap = document.querySelector('[data-pane="new"] .pg:not([data-read-only]) .new-gap:not([data-pair])');
    const lead = document.querySelector('[data-pane="new"] .pg:not([data-read-only]) .new-item .strip-lead');
    const spot = gap ?? lead;
    spot.scrollIntoView({ block: "center" });
    const rect = spot.getBoundingClientRect();
    const line = spot.closest(".new-item").querySelector(".new-line").getBoundingClientRect();
    return gap ? { x: line.left + Math.min(60, line.width / 2), y: rect.top + rect.height / 2 } : { x: rect.left + rect.width / 2, y: rect.top + Math.min(10, rect.height / 2) };
  });
  await dragThrough(page, await pointInUnit(unitY.unit_id), [gapPoint]);
  await page.waitForTimeout(100);
  refusals.push({ where: "written", ...(await readCard()), drop: null });
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("over an N/A section the card refuses and says why", refusals[0].refused && refusals[0].note === "That section is N/A in the To-Be list." && refusals[0].drop === "refused" && refusals[0].dest === "", JSON.stringify(refusals[0]));
  check("over its own section the card refuses and points to Order", refusals[1].refused && refusals[1].note === "Already in this section. Change the order in Order" && refusals[1].drop === "refused" && refusals[1].dest === "", JSON.stringify(refusals[1]));
  check("between sentences of a written document the card refuses", refusals[2].refused && refusals[2].note === "A document that is already written takes no new sentences. Link to one of its sentences.", JSON.stringify(refusals[2]));
  check("refused drops send no save", saveRequests === savesBeforeRefusals, String(saveRequests - savesBeforeRefusals));
  check("refused drops make no draft, open no menu and write nothing", (await draft.count()) === 0 && (await menu.count()) === 0 && JSON.stringify((await readUnits()).map((unit) => [unit.unit_id, unit.status])) === unitsBefore && JSON.stringify(await readIds(slotK)) === JSON.stringify([a, x, b, c]));

  // 9. 확정한 줄을 다른 칸의 문장 사이로 - X를 K2의 P 위 절반에 놓으면 P 앞에 초안, 저장은 그 문장을 옮기며 맨 앞 자리를 싣는다
  await openNewDoc(sop.id);
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(p, "top")]);
  await page.waitForTimeout(100);
  const sentMove = await dropAndSave("a confirmed row into another section");
  const moved = sentMove.body.targets.find((target) => target.id === x);
  check("moving a confirmed sentence sends its id and the front of the section", sentMove.ok && moved !== undefined && JSON.stringify(moved.position) === JSON.stringify({ after_target_id: null }), JSON.stringify(moved));
  check("X moves to the front of K2 and leaves K", JSON.stringify(await readIds(slotK2)) === JSON.stringify([x, p]) && JSON.stringify(await readIds(slotK)) === JSON.stringify([a, b, c]));

  // 한/영 짝 줄을 문장 사이에 - 두 새 문장이 같은 자리를 싣고 그 자리에 영어 먼저 나란히 선다
  const allUnits = await readUnits();
  const pairMembers = new Map();
  for (const unit of allUnits) if (unit.pair_id !== null) pairMembers.set(unit.pair_id, [...(pairMembers.get(unit.pair_id) ?? []), unit]);
  const freePairs = [...pairMembers.values()].filter((members) => members.length === 2 && members.every((unit) => unit.kind === "sentence" && unit.status === "unassigned" && unit.decision.disposition === "unassigned") && new Set(members.map((unit) => unit.lang)).size === 2 && members.every((unit) => unit.lang === "ko" || unit.lang === "en"));
  let pair = null;
  for (const members of freePairs) {
    if (await showOldUnit(members[0])) {
      pair = members;
      break;
    }
  }
  check("an Old document shows a free KO/EN pair", pair !== null, String(freePairs.length));
  await openNewDoc(sop.id);
  await dragThrough(page, await pointInUnit(pair[0].unit_id), [await pointInItem(a, "bottom")]);
  await page.waitForTimeout(100);
  const sentPair = await dropAndSave("a KO/EN pair between sentences");
  const pairItems = sentPair.body.targets.filter((target) => !target.parent_key && target.source_unit_ids.some((id) => pair.some((unit) => unit.unit_id === id)));
  check("both sentences of the pair carry the same place", sentPair.ok && pairItems.length === 2 && pairItems.every((item) => JSON.stringify(item.position) === JSON.stringify({ after_target_id: a })), JSON.stringify(pairItems.map((item) => item.position)));
  await page.reload();
  await wait(page, "assign-bar");
  const kAfterPair = await readItems(slotK);
  const isPairItem = (item) => item.source_unit_ids.some((id) => pair.some((unit) => unit.unit_id === id));
  check("after a reload the pair stands together right after A, English first", kAfterPair.length === 5 && kAfterPair[0].target_id === a && isPairItem(kAfterPair[1]) && isPairItem(kAfterPair[2]) && kAfterPair[1].lang === "en" && kAfterPair[2].lang === "ko" && kAfterPair[3].target_id === b && kAfterPair[4].target_id === c, JSON.stringify(kAfterPair.map((item) => [item.target_id, item.lang])));

  // 10. 클릭 길은 그대로 - 미리 보기 줄은 고르지 못하고, 나무에서 칸을 고른 저장은 자리를 싣지 않아 칸 끝에 선다(순서를 사람이 정한 문서)
  await showOldUnit(unitY);
  const yPoint = await pointInUnit(unitY.unit_id);
  await page.mouse.click(yPoint.x, yPoint.y);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unitY.unit_id, { timeout: T });
  await page.waitForLoadState("networkidle");
  await openNewDoc(sop.id);
  const chosenBefore = await getText(page, "assign-chosen");
  const aLine = await pointInItem(a, "middle");
  await page.mouse.click(aLine.x, aLine.y);
  await page.waitForTimeout(400);
  check("clicking a preview sentence picks nothing", (await getText(page, "assign-chosen")) === chosenBefore);
  if ((await page.locator(`[data-testid="assign-tree-place-slot:${sop.id}:${slotK}"]`).count()) === 0) {
    if ((await page.locator(`[data-testid="assign-tree-p${sop.code}"]`).count()) === 0) await page.locator('[data-testid="assign-acc-all"]').click();
    if ((await page.locator(`[data-testid="assign-tree-p${sop.code}"]`).getAttribute("aria-expanded")) !== "true") await page.locator(`[data-testid="assign-tree-p${sop.code}"]`).click();
  }
  await page.locator(`[data-testid="assign-tree-place-slot:${sop.id}:${slotK}"]`).click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
  const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
  const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').focus();
  await page.keyboard.press("Enter");
  const treeBody = (await request).postDataJSON();
  const treeOk = (await response).ok();
  await page.waitForLoadState("networkidle");
  check("a section picked in the tree saves without a place", treeOk && treeBody.targets.every((target) => !("position" in target)), JSON.stringify(treeBody.targets));
  const kAfterTree = await readIds(slotK);
  check("Y stands at the end of K", kAfterTree.length === 6 && kAfterTree.at(-1) === y, JSON.stringify(kAfterTree));

  // 11. 이 단계가 확정한 줄을 Clear(U)로 되돌린다
  const clearRow = async (unit) => {
    await showOldUnit(unit);
    const point = await pointInUnit(unit.unit_id);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unit.unit_id, { timeout: T });
    await page.waitForLoadState("networkidle");
    const cleared = page.waitForResponse((item) => item.url().includes("/decisions/clear"), { timeout: T });
    await page.keyboard.press("u");
    await cleared;
    await page.waitForLoadState("networkidle");
  };
  for (const unit of [unitA, unitB, unitC, unitP, unitX, unitY, pair[0]]) await clearRow(unit);
  // 짝 줄은 Unit마다 차례로 지운다 - 마지막 요청이 끝날 때까지 다시 읽는다
  const stepUnits = [unitA, unitB, unitC, unitP, unitX, unitY, ...pair];
  let leftUnits = new Map();
  for (let tries = 0; tries < 20; tries += 1) {
    leftUnits = new Map((await readUnits()).map((unit) => [unit.unit_id, unit.status]));
    if (stepUnits.every((unit) => leftUnits.get(unit.unit_id) === "unassigned")) break;
    await page.waitForTimeout(250);
  }
  check("Clear puts the rows of this step back", stepUnits.every((unit) => leftUnits.get(unit.unit_id) === "unassigned"), JSON.stringify(stepUnits.map((unit) => [unit.unit_id, leftUnits.get(unit.unit_id)])));
  if (tobeBefore !== null) {
    const now = await getJson("/tobe");
    await page.request.put(`${api}/tobe`, { headers, data: { revision: now.revision, docs: now.docs.map(({ code, title, doc_type, parent_code, is_equipment_sop, order_index }) => ({ code, title, doc_type, parent_code, is_equipment_sop, order_index })), na_slots: tobeBefore.na_slots, wi_steps: now.wi_steps } });
  }
});

await runStep("assign: drag an Old piece onto a slot in the All list, in both views, it saves like a click", { drafting: true }, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readUnits = async () => (await getJson("/units?limit=1000")).items;
  const statusOf = async (unit) => (await readUnits()).find((item) => item.unit_id === unit.unit_id)?.status;
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  check("the bundle has an SOP to write in Assign", sop !== undefined);
  const readSections = async () => (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections;
  const readItems = async (key) => (await readSections()).find((section) => section.location_key === key).items;
  // 미배정·짝 없는 본문 문장이 가장 많은 Old 문서(앞 단계와 같은 고르기)
  const findLoose = async () => {
    const units = new Map((await readUnits()).map((unit) => [unit.unit_id, unit]));
    let best = null;
    for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
      const view = await getJson(`/documents/${doc.id}/view`);
      const loose = view.units.map((unit) => units.get(unit.id)).filter((unit) => unit && unit.kind === "sentence" && unit.status === "unassigned" && unit.decision.disposition === "unassigned" && unit.pair_id === null);
      if (best === null || loose.length > best.loose.length) best = { docId: doc.id, loose };
    }
    return best;
  };
  let found = await findLoose();
  if (found.loose.length < 3) {
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision } });
    found = await findLoose();
  }
  // 칸 K - N/A가 아니고 하위 칸이 없는 칸(상위 칸에 놓는 규칙은 이 걸음이 정하지 않는다). N - N/A 칸(없으면 만들고 끝에 되돌린다)
  let sections = await readSections();
  const isLeaf = (key) => !sections.some((section) => section.location_key.startsWith(`${key}.`));
  const leaves = sections.filter((section) => takesLines(section) && section.na_reason === null && isLeaf(section.location_key));
  const slotK = (leaves.find((section) => section.items.length === 0) ?? leaves[0])?.location_key;
  const spare = leaves.filter((section) => section.items.length === 0).map((section) => section.location_key).find((key) => key !== slotK);
  check("the SOP has a section to drop on", slotK !== undefined);
  let tobeBefore = null;
  if (!sections.some((section) => section.na_reason !== null)) {
    tobeBefore = await getJson("/tobe");
    const pick = ({ code, title, doc_type, parent_code, is_equipment_sop, order_index }) => ({ code, title, doc_type, parent_code, is_equipment_sop, order_index });
    await page.request.put(`${api}/tobe`, { headers, data: { revision: tobeBefore.revision, docs: tobeBefore.docs.map(pick), na_slots: [...tobeBefore.na_slots, { code: sop.code, slot_key: spare, reason: "Synthetic smoke N/A" }], wi_steps: tobeBefore.wi_steps } });
    sections = await readSections();
  }
  const slotN = sections.find((section) => section.na_reason !== null)?.location_key;
  check("the SOP has an N/A section", slotN !== undefined);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${found.docId}"]`).click();
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  await page.waitForTimeout(600);
  const loose = [];
  for (const unit of found.loose) if ((await pieceOf(unit.unit_id).count()) > 0) loose.push(unit);
  check("an Old document shows two loose unassigned sentences", loose.length >= 2, String(loose.length));
  const [unitZ, unitW] = loose;
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const pointInUnit = async (id) => {
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const selectUnit = async (unit) => {
    const point = await pointInUnit(unit.unit_id);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unit.unit_id, { timeout: T });
    await page.waitForLoadState("networkidle");
  };
  // 나무 - All과 그 문서 마디를 펼친다(접힌 곳은 끄는 동안 펼쳐지지 않는다)
  const placeTestId = (key) => `assign-tree-place-slot:${sop.id}:${key}`;
  const openTree = async () => {
    const acc = page.locator('[data-testid="assign-acc-all"]');
    if ((await acc.getAttribute("aria-expanded")) !== "true") await acc.click();
    const node = page.locator(`[data-testid="assign-tree-p${sop.code}"]`);
    await node.waitFor({ timeout: T });
    if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
    await page.locator(`[data-testid="${placeTestId(slotK)}"]`).waitFor({ timeout: T });
  };
  const pointInTree = async (testId) => {
    await centre(`[data-testid="${testId}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="${testId}"]`).first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const rowDropOf = (testId) => page.locator(`[data-testid="${testId}"]`).first().evaluate((el) => el.closest(".tree-row")?.getAttribute("data-drop") ?? null);
  const readCard = () => page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
    drops: document.querySelectorAll("[data-drop]").length,
  }));
  const linkMenu = page.locator('[data-testid="assign-link-menu"]');
  let saveRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/groups/save")) saveRequests += 1;
  });
  // 놓으면 바로 확정한다(1.2.0 피드백) - 놓기가 보낸 저장 요청과 응답
  const saveByDrop = async () => {
    const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
    const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
    await page.mouse.up();
    const body = (await request).postDataJSON();
    const ok = (await response).ok();
    await page.waitForLoadState("networkidle");
    return { body, ok };
  };
  // 고름이 몇 번 적용됐나 - 고른 곳 상자 안에 새로 붙는 쉬머(.refresh-sweep, 보낼 곳이 바뀔 때마다 하나). 놓기 뒤따르는 click이 나무 줄을 누르면 는다
  const watchPicks = () => page.evaluate(() => {
    window.__sweeps = 0;
    if (window.__pickWatch) return;
    window.__pickWatch = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.matches('[data-testid="assign-chosen"]')) for (const node of record.addedNodes) if (node instanceof Element && node.matches(".refresh-sweep")) window.__sweeps += 1;
      }
    });
    window.__pickWatch.observe(document.body, { subtree: true, childList: true });
  });
  const readPicks = () => page.evaluate(() => ({ sweeps: window.__sweeps }));
  const selectedPiece = () => page.evaluate(() => document.querySelector('[data-pane="old"] [data-testid^="assign-paper-piece-"][data-sel]')?.dataset.testid ?? null);

  // 1. 두 단 보기 - W를 골라 나무를 보이고, Z를 K 줄 위로
  await selectUnit(unitW);
  await openTree();
  const kTestId = placeTestId(slotK);
  const nTestId = placeTestId(slotN);
  check("the N/A row is marked", (await page.locator(`[data-testid="${nTestId}"]`).evaluate((el) => el.closest(".tree-row")?.hasAttribute("data-na"))) === true);
  const zPoint = await pointInUnit(unitZ.unit_id);
  const kPoint = await pointInTree(kTestId);
  // 지나갈 줄들 - K를 가운데에 둔 채 보이는 나무 줄(스크롤하지 않고 잰다). 가장자리 스크롤 띠(44px) 밖만 - 목록이 밀리면 K의 자리가 바뀐다
  const passPoints = await page.evaluate(() => {
    const frame = document.querySelector(".assign-side .assign-pick").getBoundingClientRect();
    return [...document.querySelectorAll(".dest-tree .tree-row")].map((row) => row.getBoundingClientRect()).filter((rect) => rect.top >= frame.top + 50 && rect.bottom <= frame.bottom - 50).map((rect) => ({ x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height / 2 }));
  });
  check("several tree rows are in view to pass over", passPoints.length >= 3, String(passPoints.length));
  await dragThrough(page, zPoint, [kPoint]);
  await page.waitForTimeout(100);
  const overK = await readCard();
  check("over a section row in the tree it is outlined", (await rowDropOf(kTestId)) === "over");
  check("the card says the document and section", overK.note.startsWith("→ ") && overK.note.includes(sop.code) && !overK.refused && overK.dest === overK.note, JSON.stringify(overK));
  await takeShot("sop-assign-drag-tree.png");
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 30; i += 1) {
    const pass = passPoints[i % passPoints.length];
    await page.mouse.move(pass.x + (i % 3) * 5, pass.y);
  }
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over tree rows", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);

  // 2. 놓으면 Z가 골라지고 그 칸으로 바로 확정한다(그 자리 메뉴 없음, 자리 없이 칸 끝)
  await page.mouse.move(kPoint.x, kPoint.y);
  await watchPicks();
  const sentZ = await saveByDrop();
  // 확정처럼 고름은 다음 열린 줄로 넘어간다 - 저장 내용으로 끈 줄을 본다
  check("no in-place menu opens after a tree drop", (await linkMenu.count()) === 0);
  // 놓기 뒤따르는 click이 나무 줄을 한 번 더 누르면 다음 줄의 고른 곳 상자가 한 번 더 쓸린다
  const treePicks = await readPicks();
  check("the drop picks the section once (the click after it does not press a tree row)", treePicks.sweeps <= 1, JSON.stringify(treePicks));
  check("a tree drop saves at once without a place", sentZ.ok && sentZ.body.targets.every((target) => !("position" in target)), JSON.stringify(sentZ.body.targets));
  check("Z lands in K", (await readItems(slotK)).some((item) => item.source_unit_ids.includes(unitZ.unit_id)));

  // 3·4. 못 놓는 곳 - Z를 고른 채 W를 끈다. N/A 줄은 이유를, 칸 제목 줄·이미 쓴 문장 줄은 아무 표시도 없다
  await selectUnit(unitZ);
  await openTree();
  const chosenZ = await getText(page, "assign-chosen");
  const savesBeforeRefusals = saveRequests;
  await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(nTestId)]);
  await page.waitForTimeout(100);
  const overN = await readCard();
  const nDrop = await rowDropOf(nTestId);
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("over an N/A row the card refuses and says why", overN.refused && overN.note === "That section is N/A in the To-Be list." && nDrop === "refused" && overN.dest === "", JSON.stringify({ ...overN, nDrop }));
  const quiet = [];
  const headingId = await page.locator('[data-testid^="assign-tree-place-heading:"]').first().getAttribute("data-testid").catch(() => null);
  if (headingId !== null) {
    await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(headingId)]);
    await page.waitForTimeout(100);
    quiet.push({ where: "heading", ...(await readCard()) });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const writtenRows = await getJson("/written-sentences");
  const sentence = writtenRows.find((row) => row.kind === "sentence");
  // 아래 확인이 빈 목록으로 통과하지 않게 - 시드에 둘 다 있어야 한다
  check("the tree has a section heading row and a written sentence row to try", headingId !== null && sentence !== undefined, JSON.stringify({ headingId, sentence: sentence?.target_id ?? null }));
  if (sentence) {
    const node = page.locator(`[data-testid="assign-tree-w${sentence.target_doc_id}"]`);
    if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
    await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(`assign-tree-sentence-${sentence.target_id}`)]);
    await page.waitForTimeout(100);
    quiet.push({ where: "sentence", ...(await readCard()) });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  check("a heading row and a written sentence row are no drop place", quiet.length === 2 && quiet.every((entry) => entry.cards === 1 && entry.drops === 0 && !entry.refused && entry.note === ""), JSON.stringify(quiet));
  check("refused and empty drops change nothing", (await getText(page, "assign-chosen")) === chosenZ && (await pieceOf(unitZ.unit_id).getAttribute("data-sel")) === "" && saveRequests === savesBeforeRefusals && (await statusOf(unitW)) === "unassigned" && (await linkMenu.count()) === 0, String(saveRequests - savesBeforeRefusals));

  // 6. Esc - 나무 줄 위에서 취소하면 표가 사라지고 고름은 그대로
  await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(kTestId)]);
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  const afterEsc = await readCard();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("Esc over a tree row cancels the drag", afterEsc.cards === 0 && afterEsc.drops === 0 && (await getText(page, "assign-chosen")) === chosenZ, JSON.stringify(afterEsc));

  // 6b. 놓자마자 j로 다음 줄로 - W의 관계 묶음 응답을 늦춰, 늦게 온 칸 고름이 옮겨 간 줄에 적용되지 않는지 본다(Review Focus 5). W 다음 줄 R의 제 값을 먼저 읽는다
  await selectUnit(unitW);
  await page.keyboard.press("j");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const rowR = await selectedPiece();
  const chosenR = await getText(page, "assign-chosen");
  await selectUnit(unitZ);
  await openTree();
  const lateGroup = `**/groups/by-unit/${unitW.unit_id}`;
  let lateHits = 0;
  await page.route(lateGroup, async (route) => {
    lateHits += 1;
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  const savesBeforeRace = saveRequests;
  await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(kTestId)]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.keyboard.press("j");
  await page.waitForTimeout(2500);
  await page.unroute(lateGroup);
  const race = { rowR, row: await selectedPiece(), chosen: (await getText(page, "assign-chosen")) === chosenR, saves: saveRequests - savesBeforeRace, lateHits };
  check("j right after a tree drop moves on and the late section is not applied to that row", rowR !== null && race.row === rowR && race.chosen && race.saves === 0 && lateHits > 0, JSON.stringify(race));
  // 뒤 확인은 Z를 고른 채로 시작한다
  await selectUnit(unitZ);

  // 5. 한 단 보기 - New 칸이 없고 옆 패널이 놓을 곳이다
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  check("the one-document view has no New pane", (await page.locator('[data-testid="assign-new"]').count()) === 0);
  await openTree();
  // Old 용지 위(제 박스)에 놓으면 아무 일도 없다 - 이웃한 같은 언어 박스 위는 합치기라(B6) 제 박스 안에서 움직인다
  const savesBeforeOne = saveRequests;
  let editsInOne = 0;
  const countEdits = (request) => {
    if (/\/edits$/.test(new URL(request.url()).pathname)) editsInOne += 1;
  };
  page.on("request", countEdits);
  const wOnePoint = await pointInUnit(unitW.unit_id);
  await dragThrough(page, wOnePoint, [{ x: wOnePoint.x + 40, y: wOnePoint.y }]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(600);
  page.off("request", countEdits);
  check("dropping on the Old paper in one view does nothing", (await getText(page, "assign-chosen")) === chosenZ && (await pieceOf(unitZ.unit_id).getAttribute("data-sel")) === "" && saveRequests === savesBeforeOne && editsInOne === 0);
  await dragThrough(page, await pointInUnit(unitW.unit_id), [await pointInTree(kTestId)]);
  await page.waitForTimeout(100);
  check("in one view the tree row takes the drop", (await rowDropOf(kTestId)) === "over");
  const sentW = await saveByDrop();
  check("in one view the drop confirms W", sentW.ok && (await statusOf(unitW)) !== "unassigned");
  check("in one view the save carries no place", sentW.ok && sentW.body.targets.every((target) => !("position" in target)), JSON.stringify(sentW.body.targets));
  check("W lands in K", (await readItems(slotK)).some((item) => item.source_unit_ids.includes(unitW.unit_id)));
  await page.locator('[data-testid="assign-view-two"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ timeout: T });

  // 8. 이 단계가 확정한 줄을 Clear(U)로 되돌린다
  for (const unit of [unitZ, unitW]) {
    await selectUnit(unit);
    const cleared = page.waitForResponse((item) => item.url().includes("/decisions/clear"), { timeout: T });
    await page.keyboard.press("u");
    await cleared;
    await page.waitForLoadState("networkidle");
  }
  check("Clear puts Z and W back", (await statusOf(unitZ)) === "unassigned" && (await statusOf(unitW)) === "unassigned");
  if (tobeBefore !== null) {
    const now = await getJson("/tobe");
    await page.request.put(`${api}/tobe`, { headers, data: { revision: now.revision, docs: now.docs.map(({ code, title, doc_type, parent_code, is_equipment_sop, order_index }) => ({ code, title, doc_type, parent_code, is_equipment_sop, order_index })), na_slots: tobeBefore.na_slots, wi_steps: now.wi_steps } });
  }
});

// 시드에는 단계가 있는 WI가 없다 - 이 단계가 API로 WI 하나와 단계 둘을 만들고 끝에 지운다
await runStep("assign: drag an Old piece into a WI step, on its row in the All list and between two sentences of a step", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readUnits = async () => (await getJson("/units?limit=1000")).items;
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  const wiCode = "WI-DND-SMOKE";
  const added = await page.request.post(`${api}/tobe/docs`, { headers, data: { code: wiCode, doc_type: "wi", parent_code: sop.code } });
  const wi = (await added.json()).docs?.find((doc) => doc.code === wiCode);
  check("a WI is added under the SOP", added.ok() && wi !== undefined, String(added.status()));
  for (const title of ["Synthetic step one", "Synthetic step two"]) await page.request.post(`${api}/tobe/docs/${wi.id}/steps`, { headers, data: { title } });
  const steps = (await getJson("/tobe")).wi_steps.filter((step) => step.code === wiCode).map((step) => step.step_no);
  check("the WI has two steps", JSON.stringify(steps) === JSON.stringify([1, 2]), JSON.stringify(steps));
  const readSections = async () => (await getJson(`/outputs/c/docs/${wi.id}?lang=en`)).sections;
  const readIds = async (key) => (await readSections()).find((section) => section.location_key === key)?.items.map((item) => item.target_id) ?? [];
  // 미배정·짝 없는 본문 문장이 가장 많은 Old 문서(앞 단계와 같은 고르기)
  const findLoose = async () => {
    const units = new Map((await readUnits()).map((unit) => [unit.unit_id, unit]));
    let best = null;
    for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
      const view = await getJson(`/documents/${doc.id}/view`);
      const loose = view.units.map((unit) => units.get(unit.id)).filter((unit) => unit && unit.kind === "sentence" && unit.status === "unassigned" && unit.decision.disposition === "unassigned" && unit.pair_id === null);
      if (best === null || loose.length > best.loose.length) best = { docId: doc.id, loose };
    }
    return best;
  };
  let found = await findLoose();
  if (found.loose.length < 5) {
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision } });
    found = await findLoose();
  }
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${found.docId}"]`).click();
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  await page.waitForTimeout(600);
  const loose = [];
  for (const unit of found.loose) if ((await pieceOf(unit.unit_id).count()) > 0) loose.push(unit);
  check("an Old document shows five loose unassigned sentences", loose.length >= 5, String(loose.length));
  const [unitI1, unitI2, unitW1, unitX, unitT] = loose;
  // 자리 없는 저장으로 단계 칸에 확정한다 - step 1 Instruction에 I1·I2, Why에 W1
  const saveTo = async (unit, step, part) => (await page.request.post(`${api}/groups/save`, {
    headers,
    data: {
      action: "confirm",
      hold_reason: "",
      units: [{ unit_id: unit.unit_id, revision: unit.decision.revision, disposition: "assigned", move_target_code: "", reason: "" }],
      targets: [{ key: `u${unit.unit_id}`, target_doc_id: wi.id, slot_key: null, wi_step: step, wi_part: part, kind: "sentence", lang: unit.lang, text: unit.text.trim(), source_unit_ids: [unit.unit_id] }],
      removed_target_ids: [],
    },
  })).ok();
  const setupSaved = [await saveTo(unitI1, 1, "instruction"), await saveTo(unitI2, 1, "instruction"), await saveTo(unitW1, 1, "why")];
  const [i1, i2] = await readIds("step:1:instruction");
  const [w1] = await readIds("step:1:why");
  check("I1 and I2 sit in step 1 Instruction and W1 in its Why", setupSaved.every(Boolean) && [i1, i2, w1].every((id) => id !== undefined), JSON.stringify(setupSaved));
  await page.reload();
  await wait(page, "assign-bar");
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 다시 받으면 Old 칸이 처음 문서로 돌아갈 수 있다 - 이 단계의 Old 문서를 다시 연다
  const pointInUnit = async (id) => {
    if ((await pieceOf(id).count()) === 0) {
      await page.locator('[data-testid="assign-old-doc"]').click();
      await page.locator(`[data-testid="assign-old-doc-option-${found.docId}"]`).click();
      await pieceOf(id).waitFor({ timeout: T });
    }
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const selectUnit = async (unit) => {
    const point = await pointInUnit(unit.unit_id);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), unit.unit_id, { timeout: T });
    await page.waitForLoadState("networkidle");
  };
  const newPane = page.locator('[data-testid="assign-new"]');
  const openNewDoc = async (docId) => {
    if ((await newPane.getAttribute("data-doc")) === String(docId)) return;
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), docId, { timeout: T });
  };
  const pointInItem = async (targetId, where) => {
    await centre(`[data-testid="assign-new-${targetId}"]`);
    await page.waitForTimeout(150);
    return page.evaluate(({ id, at }) => {
      const item = document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`).getBoundingClientRect();
      const line = document.querySelector(`[data-testid="assign-new-${id}"]`).getBoundingClientRect();
      const y = at === "bottom" ? item.bottom - 3 : at === "top" ? item.top + 3 : line.top + line.height / 2;
      return { x: line.left + Math.min(60, line.width / 2), y };
    }, { id: targetId, at: where });
  };
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
  }));
  const menu = page.locator('[data-testid="assign-link-menu"]');
  const draft = page.locator('[data-testid="assign-new-draft"]');
  // 놓으면 바로 확정한다(1.2.0 피드백) - 놓기가 보낸 저장 요청과 응답
  const saveByDrop = async () => {
    const request = page.waitForRequest((item) => item.url().includes("/groups/save") && item.method() === "POST", { timeout: T });
    const response = page.waitForResponse((item) => item.url().includes("/groups/save"), { timeout: T });
    await page.mouse.up();
    const body = (await request).postDataJSON();
    const ok = (await response).ok();
    await page.waitForLoadState("networkidle");
    return { body, ok };
  };
  const topItemsOf = (body, unitId) => body.targets.filter((target) => !target.parent_key && target.source_unit_ids.includes(unitId));

  // 1. 나무의 step 줄 - T를 step 2 Instruction 줄에 놓으면 그 줄을 누른 것과 같은 보낼 곳, 저장은 자리 없이 그 step으로
  await selectUnit(unitX);
  const acc = page.locator('[data-testid="assign-acc-all"]');
  if ((await acc.getAttribute("aria-expanded")) !== "true") await acc.click();
  const openWiNode = async () => {
    if ((await acc.getAttribute("aria-expanded")) !== "true") await acc.click();
    const node = page.locator(`[data-testid="assign-tree-p${wiCode}"]`);
    await node.waitFor({ timeout: T });
    if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
  };
  await openWiNode();
  const stepRow = `assign-tree-place-step:${wi.id}:2:instruction`;
  await page.locator(`[data-testid="${stepRow}"]`).waitFor({ timeout: T });
  await centre(`[data-testid="${stepRow}"]`);
  await page.waitForTimeout(150);
  const stepPoint = await page.locator(`[data-testid="${stepRow}"]`).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  await dragThrough(page, await pointInUnit(unitT.unit_id), [stepPoint]);
  await page.waitForTimeout(100);
  const overStep = { ...(await readCard()), drop: await page.locator(`[data-testid="${stepRow}"]`).evaluate((el) => el.closest(".tree-row")?.getAttribute("data-drop") ?? null) };
  check("over a step row the row is outlined and the card names the WI", overStep.drop === "over" && overStep.note.startsWith("→ ") && overStep.note.includes(wiCode) && !overStep.refused && overStep.dest === overStep.note, JSON.stringify(overStep));
  // 놓으면 그 step으로 바로 확정한다(그 자리 메뉴 없음, 1.2.0 피드백)
  const sentT = await saveByDrop();
  check("a step-row drop opens no in-place menu", (await menu.count()) === 0);
  const tItems = topItemsOf(sentT.body, unitT.unit_id);
  check("a step-row drop saves to that step without a place", sentT.ok && tItems.length === 1 && tItems[0].target_doc_id === wi.id && tItems[0].wi_step === 2 && tItems[0].wi_part === "instruction" && !("position" in tItems[0]), JSON.stringify(tItems));
  check("T lands in step 2 Instruction", (await readIds("step:2:instruction")).length === 1);

  // 2. step 안 두 문장 사이 - X를 I1 아래 절반에 놓으면 I1과 I2 사이 초안, 확정하면 그 자리(다시 읽어도)
  await openNewDoc(wi.id);
  await page.locator(`[data-testid="assign-new-${i2}"]`).waitFor({ timeout: T });
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(i1, "bottom")]);
  await page.waitForTimeout(100);
  const overGap = await readCard();
  check("between two sentences of a step the card says where it goes", overGap.note.startsWith("→ ") && !overGap.refused && overGap.dest === overGap.note, JSON.stringify(overGap));
  const sentX = await saveByDrop();
  check("a drop between step sentences saves at once with no in-place menu", sentX.ok && (await menu.count()) === 0);
  await takeShot("sop-assign-drag-send-wi.png");
  const xItems = topItemsOf(sentX.body, unitX.unit_id);
  check("the save carries the place in step 1 Instruction", sentX.ok && xItems.length === 1 && xItems[0].wi_step === 1 && xItems[0].wi_part === "instruction" && JSON.stringify(xItems[0].position) === JSON.stringify({ after_target_id: i1 }), JSON.stringify(xItems));
  const [, x] = await readIds("step:1:instruction");
  await page.reload();
  await wait(page, "assign-bar");
  await openNewDoc(wi.id);
  await page.locator(`[data-testid="assign-new-${x}"]`).waitFor({ timeout: T });
  const screenStep = await page.evaluate((ids) => [...document.querySelectorAll('[data-pane="new"] .new-item[data-row]')].map((el) => Number(el.dataset.row.slice(2))).filter((id) => ids.includes(id)), [i1, x, i2]);
  check("after a reload the step keeps I1, X, I2", JSON.stringify(await readIds("step:1:instruction")) === JSON.stringify([i1, x, i2]) && JSON.stringify(screenStep) === JSON.stringify([i1, x, i2]), JSON.stringify(screenStep));

  // 3. 다른 부분 - 같은 step Instruction의 문장 위는 이미 든 칸이라 거절, Why의 W1 아래에 놓으면 Why로 옮기며 W1 뒤 자리를 싣는다(놓은 칸이 곧 보낼 곳이라 다른 부분의 문장을 가리키지 않는다)
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(i2, "middle")]);
  await page.waitForTimeout(100);
  const sameStep = await readCard();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("over its own step part the card refuses", sameStep.refused && sameStep.note === "Already in this section. Change the order in Order" && (await draft.count()) === 0, JSON.stringify(sameStep));
  await openNewDoc(wi.id);
  await dragThrough(page, await pointInUnit(unitX.unit_id), [await pointInItem(w1, "bottom")]);
  await page.waitForTimeout(100);
  const sentWhy = await saveByDrop();
  const movedX = sentWhy.body.targets.find((target) => target.id === x);
  check("moving X to Why sends that part and the place after W1", sentWhy.ok && movedX !== undefined && movedX.wi_step === 1 && movedX.wi_part === "why" && JSON.stringify(movedX.position) === JSON.stringify({ after_target_id: w1 }), JSON.stringify(movedX));
  check("X now stands after W1 in Why and left Instruction", JSON.stringify(await readIds("step:1:why")) === JSON.stringify([w1, x]) && JSON.stringify(await readIds("step:1:instruction")) === JSON.stringify([i1, i2]));

  // 4. 뒷정리 - 이 단계가 확정한 줄을 풀고 WI를 지운다
  const stepUnits = [unitI1, unitI2, unitW1, unitX, unitT];
  for (const unit of stepUnits) {
    const now = (await readUnits()).find((item) => item.unit_id === unit.unit_id);
    await page.request.post(`${api}/decisions/clear`, { headers, data: { unit_id: unit.unit_id, revision: now.decision.revision } });
  }
  const left = new Map((await readUnits()).map((unit) => [unit.unit_id, unit.status]));
  const removed = await page.request.delete(`${api}/tobe/docs/${wi.id}`, { headers });
  check("the step's rows are cleared and the WI is removed", stepUnits.every((unit) => left.get(unit.unit_id) === "unassigned") && removed.ok(), `${removed.status()} ${JSON.stringify(stepUnits.map((unit) => left.get(unit.unit_id)))}`);
});

// 놓인 New 문장 잇기(MD 2 S3의 일부) - 아직 안 쓴 문서에 놓인 확정 문장을 누르면 작은 메뉴, "이 문장에 잇기"는 고르기만 하고 ↵가 저장한다(Old 2줄 → New 1문장).
// 준비로 한 줄을 API로 5장 범주에 확정해 두고(문장 a), 다른 미배정 줄(b)을 골라 그 문장에 잇는다. 뒷정리로 두 줄의 배정을 지운다
await runStep("assign: join a picked Old line to a placed New sentence of an unwritten document, Esc closes the menu, Enter saves it as a merged sentence", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readUnits = async () => (await getJson("/units?limit=1000")).items;
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.entrance === "assign" && doc.doc_type === "sop");
  const place = sop ? (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections.find((section) => section.location_key.startsWith("general_requirements.") && section.na_reason === null) : null;
  // 같은 Old 문서의 짝 없는 한글 미배정 문장 둘 - a는 먼저 놓고 b를 잇는다
  const loose = (await readUnits()).filter((unit) => unit.kind === "sentence" && unit.lang === "ko" && unit.status === "unassigned" && unit.decision.disposition === "unassigned" && unit.pair_id === null);
  const sameDoc = loose.filter((unit) => unit.document_id === loose[0]?.document_id);
  const [unitA, unitB] = sameDoc;
  check("the bundle has an SOP category and two loose Korean Old sentences", Boolean(sop && place && unitA && unitB), `${sop?.code} ${place?.location_key} ${unitA?.unit_id} ${unitB?.unit_id}`);
  if (!sop || !place || !unitA || !unitB) return;
  const savedA = await page.request.post(`${api}/groups/save`, {
    headers,
    data: {
      action: "confirm",
      hold_reason: "",
      units: [{ unit_id: unitA.unit_id, revision: unitA.decision.revision, disposition: "assigned", move_target_code: "", reason: "" }],
      targets: [{ key: "u", target_doc_id: sop.id, slot_key: place.location_key, kind: "sentence", source_unit_ids: [unitA.unit_id] }],
      removed_target_ids: [],
      release_unit_ids: [],
    },
  });
  const placed = (await savedA.json()).targets?.[0];
  check("one Old sentence is placed in the SOP first", savedA.ok() && placed !== undefined, String(savedA.status()));
  if (!placed) return;
  const readSources = async () => (await (await page.request.get(`${api}/groups/by-target/${placed.id}`, { headers })).json()).targets.find((target) => target.id === placed.id);
  let saveRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/groups/save") && request.method() === "POST") saveRequests += 1;
  });
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pieceB = page.locator(`[data-testid="assign-paper-piece-${unitB.unit_id}"]`);
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  if ((await pieceB.count()) === 0) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${unitB.document_id}"]`).click();
  }
  await pieceB.waitFor({ timeout: T });
  const pointB = await page.locator(`[data-testid="assign-paper-unit-${unitB.unit_id}"]`).first().evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    const rect = el.getClientRects()[0];
    return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(pointB.x, pointB.y);
  await wait(page, "assign-new");
  if ((await page.locator('[data-testid="assign-new"]').getAttribute("data-doc")) !== String(sop.id)) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
  }
  const joinLine = page.locator(`[data-testid="assign-new-join-${placed.id}"]`);
  await joinLine.waitFor({ timeout: T });
  check("with an Old line picked the placed sentence is a button", (await joinLine.evaluate((el) => el.tagName)) === "BUTTON");

  // 메뉴 - 두 항목, Esc로 닫힘
  await joinLine.click();
  const menu = page.locator('[data-testid="assign-join-menu"]');
  await menu.waitFor({ timeout: T });
  check("the small menu offers joining and placing after", (await page.locator('[data-testid="assign-join-menu-join"]').count()) === 1 && (await page.locator('[data-testid="assign-join-menu-after"]').count()) === 1);
  check("the join item says two Old lines make one New sentence", ((await page.locator('[data-testid="assign-join-menu-join"]').textContent()) ?? "").includes("2 Old lines → 1 New sentence"), await page.locator('[data-testid="assign-join-menu-join"]').textContent());
  await takeShot("sop-assign-join-menu.png");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached", timeout: T });
  check("Esc closes the menu and saves nothing", saveRequests === 0);
  await joinLine.click();
  await menu.waitFor({ timeout: T });
  await page.mouse.click(5, 5);
  await menu.waitFor({ state: "detached", timeout: T });
  check("clicking outside closes the menu too", saveRequests === 0);

  // 이 문장에 잇기 - 고른 곳 상자에 그 문장과 글, 저장은 아직 없다
  await joinLine.click();
  await menu.waitFor({ timeout: T });
  await page.locator('[data-testid="assign-join-menu-join"]').click();
  await wait(page, "assign-chosen-join");
  const chosen = ((await page.locator('[data-testid="assign-chosen-join"]').textContent()) ?? "").trim();
  const chosenNote = ((await page.locator('[data-testid="assign-chosen-join-note"]').textContent()) ?? "").trim();
  check("the picked-place box shows the sentence and the join note", chosen.includes(sop.code) && chosenNote === "Link to this sentence (2 Old lines → 1 New sentence)", `${chosen} | ${chosenNote}`);
  check("picking it saves nothing yet, Confirm is ready and the focus is on the paper", saveRequests === 0 && (await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")) === "confirm" && (await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T }).then(() => true, () => false)));
  check("the joined sentence is drawn as picked", (await joinLine.getAttribute("aria-pressed")) === "true");

  // ↵로 확정 - 그 문장에 출처가 둘, 글은 그대로, 종류는 합침
  const saveRequest = page.waitForRequest((request) => request.url().includes("/groups/save") && request.method() === "POST", { timeout: T });
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  const body = (await saveRequest).postDataJSON();
  await saved;
  await page.waitForLoadState("networkidle");
  const sent = body.targets.find((target) => target.id === placed.id);
  check("the save sends the placed sentence with both Old units and no new text", sent !== undefined && JSON.stringify(sent.source_unit_ids) === JSON.stringify([unitA.unit_id, unitB.unit_id]) && sent.text === undefined, JSON.stringify(sent));
  const joined = await readSources();
  check("the server keeps one merged sentence with both sources", joined?.change_type === "merged" && joined.source_unit_ids.length === 2 && joined.confirmed_text === placed.confirmed_text, JSON.stringify(joined));
  check("the placed line keeps its place and number after saving", (await page.locator(`[data-testid="assign-new-${placed.id}"]`).count()) === 1);
  // 그 줄에 머문다 - 다음 줄로 넘어가지 않고, 고른 곳 상자 머리가 N:1 글이고 연필(Rewrite)에 포커스가 있다
  await page.locator('[data-testid="assign-edit"]').waitFor({ timeout: T });
  check("after joining the picked line stays and the box head names the merge", (await page.locator(`[data-testid="assign-paper-piece-${unitB.unit_id}"]`).evaluate((el) => el.hasAttribute("data-sel"))) && (((await page.locator('[data-testid="assign-chosen"] .chosen-label').textContent()) ?? "").includes("Old 2 lines → 1 New sentence · rewrite")), await page.locator('[data-testid="assign-chosen"] .chosen-label').textContent());
  check("the Rewrite pencil of that sentence has the focus", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assign-edit");

  // 되돌리기 - 출처가 다시 하나
  await page.keyboard.press("ControlOrMeta+z");
  for (let step = 0; step < 30 && (await readSources())?.source_unit_ids.length !== 1; step += 1) await page.waitForTimeout(300);
  check("Ctrl+Z takes the second source back", (await readSources())?.source_unit_ids.length === 1);

  // 뒷정리 - 준비로 놓은 줄과 b의 배정을 지운다
  for (const unit of [unitA, unitB]) {
    const now = (await readUnits()).find((item) => item.unit_id === unit.unit_id);
    await page.request.post(`${api}/decisions/clear`, { headers, data: { unit_id: unit.unit_id, revision: now.decision.revision } });
  }
  const left = new Map((await readUnits()).map((unit) => [unit.unit_id, unit.status]));
  check("both lines are unassigned again", [unitA, unitB].every((unit) => left.get(unit.unit_id) === "unassigned"));
});

await runStep("assign: click place - a gap between numbered lines, a category head, an empty slot and a refused group title in the basic view", { drafting: true }, async ({ page, takeShot }) => {
  const ctx = await prepareClickPlace(page, 4);
  check("the bundle is ready for click placing", !ctx.error && ctx.itemA && ctx.itemB, ctx.error ?? "");
  if (ctx.error || !ctx.itemA || !ctx.itemB) return;
  const [unitC, unitD, unitE, unitF] = ctx.units;
  const isLeaf = (key) => !ctx.sections.some((section) => section.location_key.startsWith(`${key}.`));
  const isEmptyOpen = (section) => takesLines(section) && section.na_reason === null && isLeaf(section.location_key) && section.items.length === 0 && section.location_key !== ctx.counted.location_key;
  const category = ctx.sections.find((section) => isEmptyOpen(section) && section.location_key.startsWith("general_requirements.") && !section.counts_lines);
  const empty = ctx.sections.find((section) => isEmptyOpen(section) && section !== category);
  const group = ctx.sections.find((section) => section.kind === "group");
  // 시드마다 칸 모양이 다르다 - 없는 것은 그 부분만 건너뛴다
  if (!category || !empty || !group) console.log(`  (click place: skipping parts with no ${[!category && "empty category", !empty && "other empty section", !group && "group title"].filter(Boolean).join(", ")})`);

  // 틈 - 올리면 가로선과 꼬리표, 누르면 고르기만(저장 없음), 고른 곳 상자에 "after 6.x.1 (becomes 6.x.2)", 포커스는 Confirm
  await ctx.pickOld(unitC);
  const gap = page.locator(`[data-testid="assign-place-g:after:${ctx.itemA.target_id}"]`);
  await gap.waitFor({ timeout: T });
  await gap.hover();
  const tag = await gap.evaluate((el) => getComputedStyle(el, "::after").content);
  // 틈 앞 줄에 번호가 있으면 "After 6.1.1 — becomes 6.1.2", 없으면(번호 없는 줄 뒤) "First line — becomes 6.1.1" - 번호는 API의 번호로 본다
  const gapWords = ctx.itemA.number ? `After ${ctx.itemA.number} — becomes ` : "First line — becomes ";
  const boxWords = ctx.itemA.number ? `after ${ctx.itemA.number} (becomes ` : "first line (becomes ";
  check("hovering a gap shows where the line goes and the number it gets", tag.includes(gapWords) && tag.includes(`${ctx.counted.number}.`), tag);
  const before = ctx.saveCount();
  await gap.click();
  await wait(page, "assign-chosen-position");
  const position = ((await page.locator('[data-testid="assign-chosen-position"]').textContent()) ?? "").trim();
  check("the picked-place box says after which line and the number it becomes", position.startsWith(boxWords) && position.includes(`${ctx.counted.number}.`), position);
  check("clicking a spot only picks it - no save yet, Confirm is ready and the focus is on the paper", ctx.saveCount() === before && (await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")) === "confirm" && (await page.waitForFunction(() => document.activeElement?.matches('[data-pane="old"] .pane-body') ?? false, null, { timeout: T }).then(() => true, () => false)));
  check("the clicked gap stays drawn as picked", (await gap.getAttribute("data-place-picked")) === "");
  await takeShot("sop-assign-click-place-gap.png");
  const savedC = await ctx.confirmWithEnter(unitC);
  check("Enter saves the line right after A", savedC?.position?.after_target_id === ctx.itemA.target_id, JSON.stringify(savedC?.position));
  const toast = page.locator('[data-testid="toast-ok"]', { hasText: `Confirmed · ${unitC.display_id} →` }).last();
  await toast.waitFor({ timeout: T });
  check("the toast names the line, the place and the number, and offers Undo", ((await toast.textContent()) ?? "").includes(ctx.counted.label) && (await toast.locator('[data-testid^="toast-action-"]').count()) === 1, await toast.textContent());

  // 범주 머리 - 빈 범주는 자리 없이 저장(position 키 없음), 위치 글은 글머리 기호 줄 · 끝에
  if (category) {
    await ctx.pickOld(unitD);
    await page.locator(`[data-testid="assign-place-s:${category.location_key}"]`).click();
    await wait(page, "assign-chosen-position");
    check("a category head picks the end of that category as a bullet line", ((await page.locator('[data-testid="assign-chosen-position"]').textContent()) ?? "").trim() === "Bullet line · at the end");
    const savedD = await ctx.confirmWithEnter(unitD);
    check("an empty category saves without a position", savedD !== undefined && !("position" in savedD) && savedD.slot_key === category.location_key, JSON.stringify(savedD));
  }

  // 빈 칸 자리 표시 - 자리 없이 그 칸
  if (empty) {
    await ctx.pickOld(unitE);
    await page.locator(`[data-testid="assign-new-slot-${empty.location_key}"]`).click();
    await wait(page, "assign-chosen-position");
    const savedE = await ctx.confirmWithEnter(unitE);
    check("an empty slot saves into that section without a position", savedE !== undefined && !("position" in savedE) && savedE.slot_key === empty.location_key, JSON.stringify(savedE));
  }

  // 못 놓는 곳 - 빨간 꼬리표의 까닭, 눌러도 고름도 저장도 없다
  if (group) {
    await ctx.pickOld(unitF);
    const head = page.locator(`[data-testid="assign-place-s:${group.location_key}"]`);
    await head.waitFor({ timeout: T });
    check("a group title is not placeable and says why", (await head.getAttribute("data-place")) === "refused" && ((await head.getAttribute("data-place-label")) ?? "").startsWith("Group title"), await head.getAttribute("data-place-label"));
    const count = ctx.saveCount();
    const pickedBefore = await page.locator('[data-testid="assign-chosen-position"]').count();
    // 머리 가운데를 강제로 누르면 그 자리에 겹친 다른 자리(앞뒤 줄에 걸친 틈 띠)가 누름을 받을 수 있다 - 자료에 따라 칸 모양이 달라 그 틈을 골랐다.
    // 맨 위가 정말 이 머리(또는 그 안)인 점을 찾아 누른다
    await head.scrollIntoViewIfNeeded();
    const headPoint = await head.evaluate((el) => {
      const box = el.getBoundingClientRect();
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          const top = document.elementFromPoint(x, y);
          // 머리 안의 다른 단추(칸 머리 표시 등)는 제 일을 한다 - 머리 자체의 빈 자리만
          if (top && el.contains(top) && top.closest("[data-place]") === el && (top.closest("button, a") === null || !el.contains(top.closest("button, a")))) return { x, y };
        }
      }
      return null;
    });
    check("the refused group title has a spot of its own to click", headPoint !== null);
    if (headPoint) await page.mouse.click(headPoint.x, headPoint.y);
    // 고르기는 화면 상태라 같은 작업에서 그려진다 - 두 프레임 뒤에 본다
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    check("clicking a refused spot makes no save request and picks nothing", ctx.saveCount() === count && (await page.locator('[data-testid="assign-chosen-position"]').count()) === 0, `${ctx.saveCount() - count} save(s), picked place(s) ${pickedBefore} before -> ${await page.locator('[data-testid="assign-chosen-position"]').count()} after`);
  }

  check("every line is unassigned again after the clean-up", await ctx.cleanUp());
});

await runStep("assign: click place - the template view picks the same gap from either half and saves at that place", { drafting: true }, async ({ page, takeShot }) => {
  const ctx = await prepareClickPlace(page, 1);
  check("the bundle is ready for click placing", !ctx.error && ctx.itemA && ctx.itemB, ctx.error ?? "");
  if (ctx.error || !ctx.itemA || !ctx.itemB) return;
  const [unitC] = ctx.units;
  await ctx.pickOld(unitC);
  await page.locator('[data-testid="assign-new-view-template"]').click();
  await wait(page, "assign-new-tpl");
  // 두 절반의 같은 틈 - 한쪽을 누르면 두 쪽이 함께 골라진 모양
  const enGap = page.locator(`[data-testid="assign-tpl-place-en-g:after:${ctx.itemA.target_id}"]`);
  const koGap = page.locator(`[data-testid="assign-tpl-place-ko-g:after:${ctx.itemA.target_id}"]`);
  await enGap.waitFor({ timeout: T });
  check("both halves draw the gap after A", (await koGap.count()) === 1);
  const toc = page.locator('[data-testid="assign-new-tpl-toc"]');
  check("the app-built contents are not placeable and say why", (await toc.getAttribute("data-place")) === "refused" && ((await toc.getAttribute("data-place-label")) ?? "").startsWith("The app builds the contents"), await toc.getAttribute("data-place-label"));
  const count = ctx.saveCount();
  await toc.click({ force: true });
  await page.waitForTimeout(300);
  check("clicking the contents makes no save request", ctx.saveCount() === count);
  await koGap.scrollIntoViewIfNeeded();
  await koGap.click();
  await wait(page, "assign-chosen-position");
  check("the picked gap lights in both halves", (await enGap.getAttribute("data-place-picked")) === "" && (await koGap.getAttribute("data-place-picked")) === "");
  // 위치 글은 기본 보기와 같은 모델이라 같은 꼴 - 앞 줄 번호가 없으면 첫 줄 꼴(저장 자리는 아래에서 position으로 본다)
  const tplPosition = ((await page.locator('[data-testid="assign-chosen-position"]').textContent()) ?? "").trim();
  check("the picked-place box says the same place as the basic view", tplPosition.startsWith(ctx.itemA.number ? `after ${ctx.itemA.number} (becomes ` : "first line (becomes "), tplPosition);
  await takeShot("sop-assign-click-place-template.png");
  const savedC = await ctx.confirmWithEnter(unitC);
  check("Enter saves the line right after A from the template view too", savedC?.position?.after_target_id === ctx.itemA.target_id, JSON.stringify(savedC?.position));
  await page.locator('[data-testid="assign-new-view-basic"]').click();
  check("every line is unassigned again after the clean-up", await ctx.cleanUp());
});

// 빈 템플릿 기본 보기(시안 2 D6) - 칸 머리는 번호 칸에 칸 번호가 든 제목 박스, 고른 Old 줄에서 온 박스 왼쪽 손잡이로 줄을 다른 칸에 옮기면
// Order 화면과 같은 PUT …/targets/order로 저장되고, 알림의 Undo가 원래 칸 · 자리로 돌린다. 준비 · 뒷정리는 클릭 배치와 같다(A · B를 번호 세는 칸에 놓고 끝에 지운다).
// 순서 저장은 그 문서를 manual_order로 굳히는데, 이 SOP는 앞 클릭 배치 단계(자리를 받은 저장)가 이미 굳혀 뒤 단계에 새로 바뀌는 것은 없다 - 그래서 그 단계들 뒤에 둔다
await runStep("assign: blank template basic view - a slot head is a heading box with its number, the grip moves a line to another slot, Undo", { drafting: true }, async ({ page }) => {
  const ctx = await prepareClickPlace(page, 1);
  check("the bundle is ready with two lines in a numbered section", !ctx.error && ctx.itemA && ctx.itemB, ctx.error ?? "");
  if (ctx.error || !ctx.itemA || !ctx.itemB) return;
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const readSections = async () => (await getJson(`/outputs/c/docs/${ctx.sop.id}?lang=en`)).sections;
  const idsIn = (sections, key) => sections.find((section) => section.location_key === key)?.items.map((item) => item.target_id) ?? [];
  const a = ctx.itemA.target_id;
  const b = ctx.itemB.target_id;
  const isOrderSave = (response) => response.request().method() === "PUT" && /\/targets\/order$/.test(new URL(response.url()).pathname);
  // 옮겨 갈 칸 - 번호 세는 칸 바로 뒤(없으면 앞)에서 가장 가까운, 줄을 받는 열린 칸(N/A · 묶음 · 앱이 채우는 목록이 아닌 끝 칸). 가까워야 한 화면에 함께 보인다
  const isLeaf = (key) => !ctx.sections.some((section) => section.location_key.startsWith(`${key}.`));
  const at = ctx.sections.findIndex((section) => section.location_key === ctx.counted.location_key);
  const open = ctx.sections.map((section, index) => ({ section, index })).filter(({ section }) => takesLines(section) && section.na_reason === null && isLeaf(section.location_key) && section.location_key !== ctx.counted.location_key);
  const dest = (open.find(({ index }) => index > at) ?? open.at(-1))?.section;
  check("the SOP has another open section to move a line into", Boolean(dest));
  if (!dest) {
    await ctx.cleanUp();
    return;
  }
  const unitA = (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === ctx.itemA.source_unit_ids[0]);
  await ctx.pickOld(unitA);

  // 칸 머리 - 번호 칸에 칸 번호, 박스에 칸 이름(머리 글에 번호를 따로 적지 않는 칸은 빈 번호 칸)
  const head = page.locator(`[data-testid="assign-new-head-${ctx.counted.location_key}"]`);
  await head.waitFor({ timeout: T });
  const headNumber = page.locator(`[data-testid="assign-new-head-num-${ctx.counted.location_key}"]`);
  const shownNumber = ctx.counted.shows_number ? ctx.counted.number : null;
  check(
    "the slot head is a heading box with the slot number in its number cell and the name in the box",
    (await head.locator(".strip .h").count()) === 1 &&
      ((await head.locator(".strip .h").textContent()) ?? "").includes(ctx.counted.label) &&
      (shownNumber === null ? (await headNumber.count()) === 0 : ((await headNumber.textContent()) ?? "").trim() === shownNumber),
    `${await headNumber.count()} ${await head.textContent()}`,
  );

  // 고른 Old 줄(A)에서 온 박스 - 고름 테두리와 왼쪽 손잡이, 다른 박스(B)는 손잡이가 없다
  const boxA = page.locator(`[data-testid="assign-new-${a}"]`);
  const grip = page.locator(`[data-testid="assign-new-grip-${a}"]`);
  await grip.waitFor({ timeout: T });
  check("the box from the picked Old line is picked and has a grip, the other box has none", (await boxA.getAttribute("data-sel")) === "" && (await page.locator(`[data-testid="assign-new-grip-${b}"]`).count()) === 0);

  // 손잡이를 옮겨 갈 칸으로 끈다 - 빈 칸은 그 자리 박스, 줄이 있는 칸은 첫 줄 위쪽. 칸 머리를 위에 두어 아래 칸까지 한 화면에
  await head.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const destEmpty = page.locator(`[data-testid="assign-new-slot-${dest.location_key}"]`);
  const destFirst = dest.items[0] ? page.locator(`[data-pane="new"] .new-item[data-row="t:${dest.items[0].target_id}"]`) : null;
  const destBox = await (destFirst ?? destEmpty).boundingBox();
  const paneBox = await page.locator('[data-pane="new"] .pane-body').boundingBox();
  check("the section to move into shows in the New pane with the grip", destBox !== null && paneBox !== null && destBox.y > paneBox.y && destBox.y + 4 < paneBox.y + paneBox.height, JSON.stringify({ destBox, paneBox }));
  if (!destBox) {
    await ctx.cleanUp();
    return;
  }
  const from = await grip.boundingBox();
  const target = destFirst ? { x: destBox.x + destBox.width / 2, y: destBox.y + Math.min(6, destBox.height / 4) } : { x: destBox.x + destBox.width / 2, y: destBox.y + destBox.height / 2 };
  await dragThrough(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, [target]);
  await page.waitForTimeout(100);
  const during = await page.evaluate((slotKey) => ({
    note: (document.querySelector('[data-testid="drag-status"]')?.textContent ?? "").trim(),
    dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    line: !(document.querySelector('[data-testid="drop-line"]')?.hidden ?? true),
    slot: document.querySelector(`[data-testid="assign-new-slot-${slotKey}"]`)?.getAttribute("data-drop") ?? null,
    faded: document.querySelector('[data-pane="new"] [data-drag-src]') !== null,
  }), dest.location_key);
  check(
    "dragging the grip over the other section says where it goes, fades the box and marks the drop place",
    during.note.startsWith("→ ") && during.dest === during.note && during.faded && (destFirst ? during.line : during.slot === "over"),
    JSON.stringify(during),
  );
  const saved = page.waitForResponse(isOrderSave, { timeout: T });
  await page.mouse.up();
  const response = await saved;
  const sent = JSON.parse(response.request().postData()).items.find((item) => item.target_id === a);
  check("the drop saves the order like the Order screen (PUT targets/order 200) with A in the new section", response.status() === 200 && sent?.slot_key === dest.location_key, `${response.status()} ${JSON.stringify(sent)}`);
  const moved = await page.waitForFunction(([id, key]) => document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`)?.getAttribute("data-csec") === key, [a, dest.location_key], { timeout: T }).then(() => true, () => false);
  const afterMove = await readSections();
  check("the New pane and C both show A in the new section", moved && idsIn(afterMove, dest.location_key).includes(a) && !idsIn(afterMove, ctx.counted.location_key).includes(a), JSON.stringify(idsIn(afterMove, dest.location_key)));

  // 알림의 Undo - 같은 저장 길로 원래 칸의 원래 자리(B 앞)에 돌린다
  const toast = page.locator('[data-testid="toast-ok"]', { hasText: "Moved → " }).last();
  await toast.waitFor({ timeout: T });
  const undone = page.waitForResponse(isOrderSave, { timeout: T });
  await toast.locator('[data-testid^="toast-action-"]').click();
  check("Undo saves the way back (200)", (await undone).status() === 200);
  const back = await page.waitForFunction(([id, key]) => document.querySelector(`[data-pane="new"] .new-item[data-row="t:${id}"]`)?.getAttribute("data-csec") === key, [a, ctx.counted.location_key], { timeout: T }).then(() => true, () => false);
  const restored = idsIn(await readSections(), ctx.counted.location_key);
  check("after Undo A is back in its section, before B, on screen and in C", back && restored.includes(a) && restored.indexOf(a) < restored.indexOf(b), JSON.stringify(restored));

  check("every line is unassigned again after the clean-up", await ctx.cleanUp());
});

// 빈 템플릿 용지 위 나누기 · 합치기(시안 2 확인할 것 5, 스텝 8) - Old 용지와 같은 손짓: 박스를 두 번 눌러 나눌 선 → S, 고른 박스 아래 틈의 Join.
// 저장은 묶음 저장(나눔 · 합침은 서버가 정한다), 되돌리기 두 번이면 처음으로. 한/영 짝은 Old 짝(createPair)이라 여기서는 다루지 않는다
await runStep("assign: blank template paper - a double press splits a sentence, Join merges it back, Undo twice", { drafting: true }, async ({ page }) => {
  const ctx = await prepareClickPlace(page, 1);
  check("the bundle is ready with two lines in a numbered section", !ctx.error && ctx.itemA && ctx.itemB, ctx.error ?? "");
  if (ctx.error || !ctx.itemA || !ctx.itemB) return;
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const readItems = async () => (await getJson(`/outputs/c/docs/${ctx.sop.id}?lang=en`)).sections.find((section) => section.location_key === ctx.counted.location_key).items;
  const a = ctx.itemA.target_id;
  const original = ctx.itemA.text;
  const isSave = (response) => response.request().method() === "POST" && response.url().includes("/groups/save");
  const unitA = (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === ctx.itemA.source_unit_ids[0]);
  await ctx.pickOld(unitA);
  const text = page.locator(`[data-testid="assign-new-${a}"] .new-text`);
  await text.waitFor({ timeout: T });

  // 두 번 누르기 - 글 가운데에 가까운 빈칸 뒤에 나눌 선, 박스 안에 Split here
  const point = await text.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    const node = el.firstChild;
    const value = node.textContent;
    const space = value.indexOf(" ", Math.floor(value.length / 2));
    const at = space > 0 ? space : value.lastIndexOf(" ");
    const range = document.createRange();
    range.setStart(node, at + 1);
    range.setEnd(node, at + 2);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  const cutShown = await page.locator(`[data-testid="assign-new-${a}"] .new-cut`).waitFor({ state: "attached", timeout: T }).then(() => true, () => false);
  check("a double press on a blank-template box puts a cut line and Split here inside the box", cutShown && (await page.locator(`[data-testid="assign-new-${a}"] [data-testid="assign-cut-run"]`).count()) === 1);

  // S - 묶음 저장 한 번, 같은 출처의 새 문장이 A 바로 뒤에, 둘 다 나눔
  const splitSaved = page.waitForResponse(isSave, { timeout: T });
  await page.keyboard.press("s");
  check("S saves the split (groups/save 200)", (await splitSaved).status() === 200);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-new-${id}"] .new-cut`) === null, a, { timeout: T }).catch(() => {});
  const splitItems = await readItems();
  const at = splitItems.findIndex((item) => item.target_id === a);
  const piece = splitItems[at + 1];
  check(
    "the sentence is now two with the same source, right after each other, both Split",
    piece !== undefined && piece.source_unit_ids.join() === ctx.itemA.source_unit_ids.join() && splitItems[at].change_type === "split" && piece.change_type === "split" && `${splitItems[at].text} ${piece.text}` === original,
    JSON.stringify(splitItems.map((item) => [item.target_id, item.change_type, item.text.slice(0, 20)])),
  );
  if (!piece) {
    await ctx.cleanUp();
    return;
  }
  await page.locator(`[data-testid="assign-new-${piece.target_id}"]`).waitFor({ timeout: T });

  // 고른 박스 아래 틈에 올리면 Join - 누르면 한 문장으로 돌아간다
  const gap = page.locator(`[data-testid="assign-new-gap-${a}-${piece.target_id}"]`);
  await gap.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const gapBox = await gap.boundingBox();
  await page.mouse.move(gapBox.x + gapBox.width / 2, gapBox.y + gapBox.height / 2);
  const join = page.locator(`[data-testid="assign-new-merge-${a}-${piece.target_id}"]`);
  const joinShown = await join.evaluate((el) => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => (getComputedStyle(el).opacity === "1" ? resolve(true) : performance.now() - started > 3000 ? resolve(false) : requestAnimationFrame(tick));
    tick();
  }));
  check("hovering the gap under the picked box shows Join, on", joinShown && (await join.getAttribute("aria-disabled")) === null);
  const joinBox = await join.boundingBox();
  const mergeSaved = page.waitForResponse(isSave, { timeout: T });
  await page.mouse.click(joinBox.x + joinBox.width / 2, joinBox.y + joinBox.height / 2);
  check("Join saves (groups/save 200)", (await mergeSaved).status() === 200);
  await page.locator(`[data-testid="assign-new-${piece.target_id}"]`).waitFor({ state: "detached", timeout: T }).catch(() => {});
  const joined = await readItems();
  check("after Join it is one sentence again with the original text", !joined.some((item) => item.target_id === piece.target_id) && joined.find((item) => item.target_id === a)?.text === original, JSON.stringify(joined.map((item) => [item.target_id, item.text.slice(0, 20)])));

  // 되돌리기 두 번 - 합치기 → 나누기 순으로, 화면도 따라 다시 받는다
  await page.keyboard.press("Control+z");
  const undoJoin = await page.locator('[data-testid="toast-ok"]', { hasText: "Undone: Join sentences" }).last().waitFor({ timeout: T }).then(() => true, () => false);
  const backSplit = await page.locator(`[data-testid="assign-new-${piece.target_id}"]`).waitFor({ timeout: T }).then(() => true, () => false);
  check("the first Undo brings the two sentences back on screen", undoJoin && backSplit);
  await page.keyboard.press("Control+z");
  const undoSplit = await page.locator('[data-testid="toast-ok"]', { hasText: "Undone: Split sentence" }).last().waitFor({ timeout: T }).then(() => true, () => false);
  const goneAgain = await page.locator(`[data-testid="assign-new-${piece.target_id}"]`).waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  const restored = (await readItems()).find((item) => item.target_id === a);
  check("the second Undo leaves one sentence with the original text", undoSplit && goneAgain && restored?.text === original, JSON.stringify(restored));

  check("every line is unassigned again after the clean-up", await ctx.cleanUp());
});

// Pair view(끌어다 놓기 4걸음) - 한/영 따로 문서(합성 OLD-3)를 KO | EN 두 칸으로 펴고 끄면 보던 화면으로 돌아온다.
// 검증 스택에는 임베딩이 없어 이 문서에 진짜 제안 짝을 만들 길이 없고, 합성 OLD-3에는 언어 없는 Unit이 없다 - 그 둘은 원문 보기 응답을 브라우저에서 바꿔(page.route) 그린다.
// 자료는 API로 만들고 끝에 푼다. 이 뒤 단계는 이 묶음의 배정·짝을 읽지 않는다
await runStep("assign: Pair view opens a KO | EN document in two columns and gives the view back", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const doc = (await getJson("/documents")).find((item) => item.side === "old" && item.status === "ready" && item.language_layout === "ko_en_separate");
  const docPath = `/documents/${doc.id}`;
  const readView = () => getJson(`${docPath}/view`);
  // 그 문서의 판단을 비우고 짝을 모두 푼다 - 풀 때마다 문서 revision이 오른다
  await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
  const unpair = async (pairId) => page.request.delete(`${api}${docPath}/pairs/${pairId}?revision=${(await readView()).document.revision}`, { headers });
  for (const pair of (await readView()).pairs) await unpair(pair.id);
  const pairUnits = async (ids) => page.request.post(`${api}${docPath}/pairs`, { headers, data: { revision: (await readView()).document.revision, unit_ids: ids } });
  const pairIdOf = (view, unitId) => view.units.find((unit) => unit.id === unitId)?.pair_id ?? null;
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const view = await readView();
  const units = view.units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
  const koIds = units.filter((unit) => unit.lang === "ko").map((unit) => unit.id);
  const enIds = units.filter((unit) => unit.lang === "en").map((unit) => unit.id);
  const [a, b] = units.filter((unit) => unit.kind === "sentence" && unit.lang === "ko");
  const [a2, b2, c2, d2] = units.filter((unit) => unit.kind === "sentence" && unit.lang === "en");
  check("the separate-layout document is clean and has sentences in both languages", view.pairs.length === 0 && [a, b, a2, b2, c2, d2].every(Boolean) && units.every((unit) => unit.status === null || unit.status === "unassigned"), `${doc.doc_code} pairs=${view.pairs.length}`);

  // 원문 보기 응답을 바꿔 그리는 도우미 - 진짜 응답을 받아 patchView를 지나 돌려준다(처음에는 그대로). page.request로 읽는 API는 바뀌지 않는다
  let patchView = (body) => body;
  const isDocView = (url) => url.pathname.endsWith(`/api/bundles/${halfBundleId}${docPath}/view`);
  await page.route(isDocView, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: patchView(await response.json()) });
  });

  const has = async (testId, attr) => (await page.locator(`[data-testid="${testId}"]`).first().getAttribute(attr)) !== null;
  const count = (selector) => page.locator(selector).count();
  const rowIdIs = (id) => page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === want, id, { timeout: T });
  const columnIds = (side) => page.locator(`[data-testid="assign-pair-${side}"] [data-testid^="assign-pair-piece-"]`).evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-unit"))));
  const panesHave = (attr) => page.locator(".assign-panes").evaluate((el, name) => el.hasAttribute(name), attr);
  const pairPiece = (id) => page.locator(`[data-testid="assign-pair-piece-${id}"]`);
  const toggle = page.locator('[data-testid="assign-pair-view"]');
  const openDoc = async (docId, unitId) => {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${docId}"]`).click();
    await page.locator(`[data-testid="assign-paper-piece-${unitId}"]`).waitFor({ timeout: T });
  };
  const turnOn = async () => {
    await toggle.click();
    await wait(page, "assign-pair-ko");
  };
  const reopen = async () => {
    await page.reload();
    await wait(page, "assign-bar");
    await openDoc(doc.id, a.id);
    await turnOn();
  };
  const lineOf = (koId, enId) => page.locator(`[data-testid="assign-pair-lines"] g[data-pair-link="${koId}:${enId}"]`);
  const readLine = (line) => line.evaluate((g) => ({ status: g.getAttribute("data-status"), strong: g.hasAttribute("data-strong"), dash: getComputedStyle(g.querySelector("path")).strokeDasharray, color: getComputedStyle(g).color }));

  // 1. 단추는 한/영 따로 문서에서만
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  const firstDoc = await page.locator('[data-testid="assign-old-doc"]').getAttribute("data-value");
  check("an interleaved Old document has no Pair view button", firstDoc !== String(doc.id) && (await toggle.count()) === 0, firstDoc);
  await openDoc(doc.id, a.id);
  check("a KO | EN separate document has one, not pressed", (await toggle.count()) === 1 && (await toggle.getAttribute("aria-pressed")) === "false");

  // 2. 켜기 전을 적어 둔다
  await page.locator(`[data-testid="assign-paper-piece-${a.id}"]`).click();
  await rowIdIs(a.display_id);
  const before = { rowId: (await getText(page, "assign-row-id")).trim(), newDoc: await page.locator('[data-testid="assign-new"]').getAttribute("data-doc"), two: await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed") };

  // 3. 켠다 - Old·New 칸과 이음 선 자리에 KO 칸 | 세로선 | EN 칸
  await turnOn();
  await wait(page, "assign-pair-en");
  check("Pair view replaces the Old and New panes and their link lines", (await count('[data-testid="assign-old"]')) === 0 && (await count('[data-testid="assign-new"]')) === 0 && (await count('[data-testid="assign-link-lines"]')) === 0 && (await count('[data-testid="assign-divider"]')) === 1);
  check("the frame says Pair view and is not single", (await panesHave("data-pair-view")) && !(await panesHave("data-single")));
  check("the button is pressed and sits in the KO column head", (await toggle.getAttribute("aria-pressed")) === "true" && (await count('[data-testid="assign-pair-ko"] .pane-head [data-testid="assign-pair-view"]')) === 1);
  const koShown = await columnIds("ko");
  const enShown = await columnIds("en");
  check("the KO column lists the Korean units in source order", JSON.stringify(koShown) === JSON.stringify(koIds), JSON.stringify(koShown));
  check("the EN column lists the English units in source order", JSON.stringify(enShown) === JSON.stringify(enIds), JSON.stringify(enShown));
  check("the picked row stays picked and the side panel keeps it", (await has(`assign-pair-piece-${a.id}`, "data-sel")) && (await getText(page, "assign-row-id")).trim() === before.rowId);

  // 4. 고르기 - 조각을 누르면 그 줄, J는 다음 줄
  await pairPiece(b2.id).click();
  await rowIdIs(b2.display_id);
  check("clicking an EN piece picks its row", await has(`assign-pair-piece-${b2.id}`, "data-sel"));
  await page.keyboard.press("j");
  await page.waitForFunction((was) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== was, b2.display_id, { timeout: T });
  const nextId = (await getText(page, "assign-row-id")).trim();
  const selAfterJ = await page.locator(".pair-piece[data-sel] .pair-piece-id").allInnerTexts();
  check("J moves the picked piece to the next row", JSON.stringify(selAfterJ) === JSON.stringify([nextId]) && !(await has(`assign-pair-piece-${b2.id}`, "data-sel")), `${nextId} ${JSON.stringify(selAfterJ)}`);

  // 5. 확정 짝은 실선
  const madeA = await pairUnits([a.id, a2.id]);
  check("the API pairs a with a′", madeA.status() === 201, String(madeA.status()));
  await reopen();
  await lineOf(a.id, a2.id).waitFor({ timeout: T });
  const confirmedLine = await readLine(lineOf(a.id, a2.id));
  check("a confirmed pair is a solid line", confirmedLine.status === "confirmed" && confirmedLine.dash === "none", JSON.stringify(confirmedLine));
  check("both pieces carry the confirmed pair bar", (await pairPiece(a.id).getAttribute("data-pair")) === "confirmed" && (await pairPiece(a2.id).getAttribute("data-pair")) === "confirmed");
  await pairPiece(a.id).click();
  const isShown = (selector) => page.locator(selector).waitFor({ timeout: T }).then(() => true, () => false);
  const partnerPicked = await isShown(`[data-testid="assign-pair-piece-${a2.id}"][data-sel]`);
  const lineStrong = await isShown(`[data-testid="assign-pair-lines"] g[data-pair-link="${a.id}:${a2.id}"][data-strong]`);
  check("picking a picks its partner too and darkens their line", partnerPicked && lineStrong, JSON.stringify({ partnerPicked, lineStrong }));

  // 6. 제안 짝은 회색 점선 - 응답을 바꿔 그린다
  patchView = (body) => ({ ...body, pairs: body.pairs.map((pair) => (pair.unit_ids.includes(a.id) ? { ...pair, status: "suggested" } : pair)) });
  await reopen();
  await page.locator(`[data-testid="assign-pair-lines"] g[data-pair-link="${a.id}:${a2.id}"][data-status="suggested"]`).waitFor({ timeout: T });
  const suggestedLine = await readLine(lineOf(a.id, a2.id));
  check("a suggested pair is a dotted line in another colour", suggestedLine.dash !== "none" && suggestedLine.color !== confirmedLine.color, `${JSON.stringify(suggestedLine)} vs ${confirmedLine.color}`);
  check("its pieces carry the suggested pair bar", (await pairPiece(a.id).getAttribute("data-pair")) === "suggested" && (await pairPiece(a2.id).getAttribute("data-pair")) === "suggested");

  // 7. 언어 없는 Unit - d′를 참조 줄로 바꿔 그리면 EN 칸 제자리에 흐리게 남고, 눌러도 줄이 골라진다
  patchView = (body) => ({ ...body, units: body.units.map((unit) => (unit.id === d2.id ? { ...unit, lang: "ref", ref: { state: "confirmed", number: "SOP-ABC-1016" } } : unit)) });
  await reopen();
  const enWithRef = await columnIds("en");
  check("a unit with no language keeps its place in the EN column, after c′", JSON.stringify(enWithRef) === JSON.stringify(enIds) && enWithRef.indexOf(d2.id) > enWithRef.indexOf(c2.id), JSON.stringify(enWithRef));
  check("it is dimmed and shows REF", (await has(`assign-pair-piece-${d2.id}`, "data-dim")) && (await count(`[data-testid="assign-pair-piece-${d2.id}"] .lang-token[data-lang="ref"]`)) === 1);
  await pairPiece(d2.id).click();
  await rowIdIs(d2.display_id);
  check("clicking the dimmed piece still picks its row", await has(`assign-pair-piece-${d2.id}`, "data-sel"));
  patchView = (body) => body;
  // a·a′ 짝은 여기서 푼다 - 11에서 a 혼자의 줄로 돌아왔는지 본다
  const pairA = pairIdOf(await readView(), a.id);
  check("the API separates a and a′ again", pairA !== null && (await unpair(pairA)).ok());

  // 8. 지금 길은 그대로 - 옆 패널 Shape의 Pair with another sentence… 띠가 KO 칸 위에 뜨고, EN 조각을 누르면 맺는다
  await reopen();
  await pairPiece(b.id).click();
  await rowIdIs(b.display_id);
  await page.locator(`[data-testid="assign-shape-line-${b.id}"]`).hover();
  await page.locator(`[data-testid="assign-shape-pair_pick-${b.id}"]`).click();
  await wait(page, "assign-pair-pick");
  check("the pair-pick bar sits in the KO column", (await count('[data-testid="assign-pair-ko"] [data-testid="assign-pair-pick"]')) === 1);
  const picked = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await pairPiece(b2.id).click();
  const pickedResponse = await picked;
  const afterPick = await readView();
  check("clicking an EN piece pairs them", pickedResponse.status() === 201 && pairIdOf(afterPick, b.id) !== null && pairIdOf(afterPick, b.id) === pairIdOf(afterPick, b2.id), String(pickedResponse.status()));
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-pair-pick"]') === null, null, { timeout: T });
  await page.waitForLoadState("networkidle");

  // 9. V는 Pair view만 끈다 - 보기는 그대로
  await page.keyboard.press("v");
  await page.locator('[data-testid="assign-pair-ko"]').waitFor({ state: "detached", timeout: T });
  check("V turns Pair view off and leaves the view as it was", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === before.two);
  await turnOn();

  // 10. 다른 문서의 줄을 고르면 꺼진다 - 문서 첫 줄에서 K는 앞 문서로 넘어간다
  await pairPiece(units[0].id).click();
  await rowIdIs(units[0].display_id);
  await page.keyboard.press("k");
  await page.locator('[data-testid="assign-pair-ko"]').waitFor({ state: "detached", timeout: T });
  await wait(page, "assign-old");
  // 문서 고르개와 단추는 그다음 그리기에서 바뀔 수 있다 - 둘 다 맞을 때까지 기다린다. 앞 문서도 한/영 따로 문서면(앞 단계가 올린 문서 등) 단추는 남고 눌리지 않은 채다
  const readPairOff = () => page.evaluate((docId) => {
    const toggleEl = document.querySelector('[data-testid="assign-pair-view"]');
    return { doc: document.querySelector('[data-testid="assign-old-doc"]')?.getAttribute("data-value") ?? null, toggle: toggleEl === null ? null : toggleEl.getAttribute("aria-pressed"), want: docId };
  }, String(doc.id));
  const isPairOff = await page.waitForFunction((docId) => {
    const toggleEl = document.querySelector('[data-testid="assign-pair-view"]');
    return document.querySelector('[data-testid="assign-old-doc"]')?.getAttribute("data-value") !== docId && (toggleEl === null || toggleEl.getAttribute("aria-pressed") === "false");
  }, String(doc.id), { timeout: T }).then(() => true, () => false);
  check("picking a row of another document turns Pair view off there", isPairOff, JSON.stringify(await readPairOff()));
  await openDoc(doc.id, a.id);
  await page.locator(`[data-testid="assign-paper-piece-${a.id}"]`).click();
  await rowIdIs(a.display_id);
  await turnOn();

  // 11. 끈다 - 보던 화면 그대로, 고른 조각이 Old 칸 화면 안
  await toggle.click();
  await wait(page, "assign-old");
  await wait(page, "assign-new");
  await page.waitForTimeout(600);
  const inView = await page.locator(`[data-testid="assign-paper-piece-${a.id}"]`).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const frame = el.closest(".pane-body").getBoundingClientRect();
    return box.top >= frame.top && box.top < frame.bottom;
  });
  const after = { rowId: (await getText(page, "assign-row-id")).trim(), newDoc: await page.locator('[data-testid="assign-new"]').getAttribute("data-doc"), two: await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed") };
  check("turning it off gives back the New document, the view and the row", JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
  check("the picked piece is picked and in view on the Old paper", (await has(`assign-paper-piece-${a.id}`, "data-sel")) && inView);
  check("the link lines are back", (await count('[data-testid="assign-link-lines"]')) === 1);

  // 12. 한 단 보기에서 켜면 두 칸, 끄면 한 단으로
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  await turnOn();
  check("Pair view opens two columns from the one-document view", (await page.locator('[data-testid="assign-pair-en"]').isVisible()) && !(await panesHave("data-single")));
  await toggle.click();
  await wait(page, "assign-old");
  check("turning it off goes back to one document", (await count('[data-testid="assign-new"]')) === 0 && (await panesHave("data-single")));
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");

  // 13. 뒷정리
  await page.unroute(isDocView);
  for (const pair of (await readView()).pairs) await unpair(pair.id);
  check("the step leaves the document without pairs", (await readView()).pairs.length === 0);
});

// Pair view를 끄는 길은 모두 같은 자리로 돌아온다(계획 판단 5) - 고른 줄이 있으면 Old 용지에 그 조각이 보이고, 없으면 켜기 전 스크롤 자리.
// 그리고 Pair view에서 Split을 누르면 먼저 끄고 용지에 나눌 선을 놓는다 - 보이지 않는 자리에서 자르지 않는다. 나눈 것은 Assign 되돌리기로 거둔다
await runStep("assign: every way out of Pair view shows the picked piece or the old scroll, and Split turns it off first", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const doc = (await getJson("/documents")).find((item) => item.side === "old" && item.status === "ready" && item.language_layout === "ko_en_separate");
  await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const view = await getJson(`/documents/${doc.id}/view`);
  // 용지 맨 아래쪽의 영어 문장(한/영 따로 문서는 영어가 뒤에 온다) - 켜기 전에 그 자리까지 굴러 있어야 끈 뒤 돌아왔는지가 보인다
  const enSentences = view.units.filter((unit) => unit.group_unit_id === null && unit.kind === "sentence" && unit.lang === "en" && unit.text.includes(" ")).sort(sourceOrder);
  let far = null;
  let paperPiece = null;
  const toggle = page.locator('[data-testid="assign-pair-view"]');
  const turnOn = async () => {
    await toggle.click();
    await wait(page, "assign-pair-en");
  };
  const waitOff = () => page.locator('[data-testid="assign-pair-ko"]').waitFor({ state: "detached", timeout: T });
  // 끈 뒤 그 조각이 Old 칸 화면 안에 들어오나(부드러운 스크롤이 끝날 때까지 기다린다)
  const isFarInView = () => page.waitForFunction((id) => {
    const el = document.querySelector(`[data-testid="assign-paper-piece-${id}"]`);
    const pane = el?.closest(".pane-body");
    if (!el || !pane) return false;
    const box = el.getBoundingClientRect();
    const frame = pane.getBoundingClientRect();
    return box.top >= frame.top && box.top < frame.bottom;
  }, far.id, { timeout: T }).then(() => true, () => false);
  const oldScroll = () => page.locator('[data-pane="old"] .pane-body').evaluate((el) => el.scrollTop);
  const foldByDivider = async () => {
    const panes = await page.locator(".assign-panes").boundingBox();
    const divider = await page.locator('[data-testid="assign-divider"]').boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(panes.x + panes.width - 8, divider.y + divider.height / 2, { steps: 6 });
    await page.mouse.up();
  };

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await page.locator('[data-pane="old"] [data-testid^="assign-paper-piece-"]').first().waitFor({ timeout: T });
  // 본문 탭에 그려진 것 중 마지막(머리말·꼬리말 탭의 문장은 뺀다)
  const shownIds = new Set(await page.locator('[data-pane="old"] [data-testid^="assign-paper-piece-"]').evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-testid").replace("assign-paper-piece-", "")))));
  far = enSentences.filter((unit) => shownIds.has(unit.id)).at(-1);
  paperPiece = page.locator(`[data-testid="assign-paper-piece-${far.id}"]`);

  // 1. 고른 줄이 용지 아래쪽 - Two documents로 끄면 그 조각이 보인다
  await paperPiece.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await paperPiece.click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === want, far.display_id, { timeout: T });
  const farBelow = await paperPiece.evaluate((el) => {
    const pane = el.closest(".pane-body");
    return el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - pane.clientHeight;
  });
  check("the far piece sits below the paper's first screen", farBelow > 0, String(farBelow));
  await turnOn();
  await page.locator('[data-testid="assign-view-two"]').click();
  await waitOff();
  check("leaving by Two documents shows the picked piece on the Old paper", await isFarInView());

  // 2. 세로선을 끝까지 끌어 접어도 같다(한 단으로 간다)
  await turnOn();
  await foldByDivider();
  await waitOff();
  check("leaving by folding the divider shows the picked piece too", (await page.locator('[data-testid="assign-view-one"]').getAttribute("aria-pressed")) === "true" && (await isFarInView()));
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");

  // 2b. "New without source"도 끄는 길이다 - 같은 자리로 돌아온다(렌더 중 상태 맞추기로만 꺼지면 용지가 맨 위로 돌아간다)
  await turnOn();
  // 단추를 눌러 켜면 포커스는 KO 칸 머리의 단추에(눌린 단추는 사라진다)
  const isToggleFocused = (pane) => page.evaluate((pane) => document.activeElement?.getAttribute("data-testid") === "assign-pair-view" && document.activeElement.closest(`[data-testid="${pane}"]`) !== null, pane);
  const focusClickOn = await isToggleFocused("assign-pair-ko");
  // New without source는 New 칸 머리에 있어 Pair view 동안은 보이지 않는다(1.2.0 피드백) - 끄는 길이 아니다
  check("New without source is not shown in Pair view", (await page.locator('[data-testid="assign-filter-unsourced"]').count()) === 0);
  await page.keyboard.press("v");
  await waitOff();
  // 2c. 글쇠(Space)로 켜고 끄기 - 포커스는 지금 보이는 단추에
  await toggle.focus();
  await page.keyboard.press("Space");
  await wait(page, "assign-pair-en");
  const focusKeyOn = await isToggleFocused("assign-pair-ko");
  await page.keyboard.press("Space");
  await waitOff();
  const focusKeyOff = await isToggleFocused("assign-old");
  check("toggling Pair view by its button leaves focus on the toggle now on screen (click on, Space on, Space off)", focusClickOn && focusKeyOn && focusKeyOff, `${focusClickOn} ${focusKeyOn} ${focusKeyOff}`);

  // 3. 고른 줄이 없으면 켜기 전 스크롤 자리로 - 다른 문서를 골랐다 돌아오면 고름이 풀린다
  const otherDoc = (await getJson("/documents")).find((item) => item.side === "old" && item.status === "ready" && item.id !== doc.id);
  for (const docId of [otherDoc.id, doc.id]) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-old-doc"]')?.getAttribute("data-value") === String(id), docId, { timeout: T });
  }
  await page.waitForFunction(() => (document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() ?? "–") === "–", null, { timeout: T });
  await page.locator('[data-pane="old"] .pane-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  const before = await oldScroll();
  await turnOn();
  await page.locator('[data-testid="assign-view-two"]').click();
  await waitOff();
  await page.waitForTimeout(300);
  const afterTwo = await oldScroll();
  check("with no row picked, Two documents gives back the scroll from before", before > 100 && Math.abs(afterTwo - before) <= 2, `${before} -> ${afterTwo}`);
  await turnOn();
  await page.locator('[data-testid="assign-view-one"]').click();
  await waitOff();
  await page.waitForTimeout(300);
  // 한 단은 용지가 넓어 짧아진다 - 그 자리까지 못 가면 끝까지
  const oneMax = await page.locator('[data-pane="old"] .pane-body').evaluate((el) => el.scrollHeight - el.clientHeight);
  const afterOne = await oldScroll();
  check("and so does One document (or its end, when the wider paper is shorter)", Math.abs(afterOne - Math.min(before, oneMax)) <= 2, `${before} -> ${afterOne} (max ${oneMax})`);
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
  // 끄자마자(자리 맞추기가 도는 동안) 다시 켜도 KO 칸은 제 자리(맨 위)다 - 그 되풀이가 같은 data-pane="old"인 KO 칸에 용지의 자리를 쓰지 않는다.
  // 두 프레임 안에 DOM click으로 누른다(포인터 입력이 아니라 켜기 자체가 되풀이를 멈춰야 한다). 창을 낮춰 KO 칸도 굴러갈 만큼 길게 한다(그래야 잘못 쓴 자리가 0이 아니다)
  await page.setViewportSize({ width: VIEWPORT.width, height: 360 });
  await page.locator('[data-pane="old"] .pane-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  await turnOn();
  await page.evaluate(async () => {
    document.querySelector('[data-testid="assign-view-two"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('[data-testid="assign-pair-view"]').click();
  });
  await wait(page, "assign-pair-en");
  await page.waitForTimeout(700);
  const ko = await page.locator('[data-pair-col="ko"] .pane-body').evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  check("closing and reopening at once leaves the KO column at its own top", ko.max > 0 && ko.top === 0, JSON.stringify(ko));
  await page.locator('[data-testid="assign-view-two"]').click();
  await waitOff();
  await page.setViewportSize(VIEWPORT);
  await wait(page, "assign-new");

  // 4. Split - Pair view에서 누르면 먼저 끄고 용지의 그 문장에 선을 놓는다. 나누지는 않는다. 다음 S가 나눈다
  const countUnits = async () => (await getJson("/units?limit=1000")).items.length;
  const unitsBefore = await countUnits();
  await paperPiece.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await paperPiece.click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === want, far.display_id, { timeout: T });
  await turnOn();
  await page.locator(`[data-testid="assign-shape-line-${far.id}"]`).hover();
  await page.locator(`[data-testid="assign-shape-split-${far.id}"]`).click();
  await waitOff();
  await wait(page, "assign-cut-run");
  const handle = await page.locator(`[data-testid="assign-paper-piece-${far.id}"] .cut-handle`).count();
  check("Split in Pair view turns it off and places the cut on that sentence, in view", handle === 1 && (await isFarInView()), String(handle));
  await page.waitForTimeout(400);
  check("placing the cut splits nothing", (await countUnits()) === unitsBefore);
  const splitDone = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/documents/${doc.id}/edits`), { timeout: T });
  await page.keyboard.press("s");
  check("S then splits as usual", (await splitDone).ok());
  await page.waitForLoadState("networkidle");
  check("the sentence became two units", (await countUnits()) === unitsBefore + 1);
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  check("Assign undo brings the sentence back", (await countUnits()) === unitsBefore);
});

// 긴 문서에서 Pair view를 끄면 끝 가까이 고른 조각이 Old 용지 화면 안에 선다 - 용지의 줄은 그려지기 전 높이를 어림해(content-visibility),
// 멀리 부드럽게 굴리면 지나가며 자라는 줄에 밀려 수천 px 모자란 곳에서 멈췄다. 시드의 따로 배치 문서(OLD-3)는 짧아 드러나지 않으므로
// 극단 자료 생성기(build_big, 문단 200개·Unit 400여 개)로 만든 문서를 새 묶음에 올려 보고 끝에 묶음을 지운다
await runStep("assign: leaving Pair view on a long document shows a piece picked far down", { devUser: "dev.admin" }, async ({ page }) => {
  const headers = { "X-Dev-User": "dev.admin" };
  const backend = resolve(SCRIPT_DIR, "../../../backend");
  const file = resolve(SHOT_DIR, "SYNTHETIC_OLD-87_long_separate.docx");
  execFileSync(findBackendPython(), ["-c", "import sys; from scripts.seed_sop_worst import build_big; open(sys.argv[1], 'wb').write(build_big('OLD-87', 400, False))", file], { cwd: backend, stdio: "inherit" });
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC long Pair view", is_synthetic: true } })).json();
  const api = `${BASE}/api/bundles/${created.id}`;
  const uploaded = await page.request.post(`${api}/documents`, { headers, multipart: { side: "old", file: { name: "SYNTHETIC_OLD-87_long_separate.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: readFileSync(file) } } });
  let doc = await uploaded.json();
  if (doc.language_layout !== "ko_en_separate") doc = await (await page.request.patch(`${api}/documents/${doc.id}`, { headers, data: { revision: doc.revision, language_layout: "ko_en_separate" } })).json();
  const view = await (await page.request.get(`${api}/documents/${doc.id}/view`, { headers })).json();
  const sentences = view.units.filter((unit) => unit.group_unit_id === null && unit.kind === "sentence").sort((one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id);
  check("a long separate-layout document is uploaded", uploaded.status() === 201 && doc.language_layout === "ko_en_separate" && sentences.length >= 350, `${uploaded.status()} ${doc.language_layout} ${sentences.length}`);
  const far = sentences.at(-3);
  await page.goto(`${BASE}/bundles/${created.id}/assign`);
  await wait(page, "assign-bar");
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-view-two"]').click();
  const piece = page.locator(`[data-testid="assign-paper-piece-${far.id}"]`);
  await piece.waitFor({ timeout: T });
  await piece.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await piece.click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(want), far.display_id, { timeout: T });
  // 움직임이 멈출 때까지 기다렸다가 그 조각이 Old 칸 화면 안인가
  const settledInView = async () => {
    let last = -1;
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(100);
      const now = await page.locator('[data-pane="old"] .pane-body').evaluate((el) => el.scrollTop);
      if (now === last) break;
      last = now;
    }
    return piece.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const frame = el.closest(".pane-body").getBoundingClientRect();
      return box.top >= frame.top && box.top < frame.bottom ? 0 : Math.round(box.top < frame.top ? box.top - frame.top : box.top - frame.bottom);
    });
  };
  for (const [label, leave] of [["its button", () => page.locator('[data-testid="assign-pair-view"]').click()], ["Two documents", () => page.locator('[data-testid="assign-view-two"]').click()]]) {
    await page.locator('[data-testid="assign-pair-view"]').click();
    await wait(page, "assign-pair-en");
    await page.waitForTimeout(400);
    await leave();
    await page.locator('[data-testid="assign-pair-ko"]').waitFor({ state: "detached", timeout: T });
    const offBy = await settledInView();
    check(`leaving by ${label} shows the piece picked far down a long document`, offBy === 0, `${offBy}px outside`);
  }
  const bundle = await (await page.request.get(api, { headers })).json();
  check("the long-document bundle is removed", (await page.request.delete(`${api}?revision=${bundle.revision}`, { headers })).ok());
});

// Pair view에서 끌어 짝 맺기(끌어다 놓기 4걸음) - 조각을 맞은편 언어의 조각에 놓으면 바로 짝이 되고(제안 짝의 구성원끼리면 그 제안을 확정), 알림의 Undo가 그 짝을 푼다.
// 제안 짝은 검증 스택에 임베딩이 없어 만들 수 없다 - API로 맺은 짝을 원문 보기 응답에서 suggested로 바꿔 그린다(page.route). 확정 호출 자체는 진짜 서버로 간다.
// 자료는 API로 만들고 끝에 짝을 모두 풀고 그 문서의 판단을 비운다. 409·거절 알림이 콘솔에 찍히므로 콘솔 오류를 허락하고, 처리되지 않은 예외(pageerror)는 따로 센다
await runStep("assign: Pair view - drag a piece onto its partner to pair or confirm, Undo separates", { allowConsoleErrors: true }, async ({ page }) => {
  await installCommitCounter(page);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const doc = (await getJson("/documents")).find((item) => item.side === "old" && item.status === "ready" && item.language_layout === "ko_en_separate");
  const docPath = `/documents/${doc.id}`;
  const readView = () => getJson(`${docPath}/view`);
  await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
  const unpair = async (pairId) => page.request.delete(`${api}${docPath}/pairs/${pairId}?revision=${(await readView()).document.revision}`, { headers });
  for (const pair of (await readView()).pairs) await unpair(pair.id);
  const pairUnits = async (ids) => page.request.post(`${api}${docPath}/pairs`, { headers, data: { revision: (await readView()).document.revision, unit_ids: ids } });
  const pairOf = (view, unitId) => view.pairs.find((pair) => pair.unit_ids.includes(unitId)) ?? null;
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const units = (await readView()).units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
  const [a, b, c, d] = units.filter((unit) => unit.kind === "sentence" && unit.lang === "ko");
  const [a2, b2, c2, d2] = units.filter((unit) => unit.kind === "sentence" && unit.lang === "en");
  const h = units.find((unit) => unit.kind === "heading" && unit.lang === "ko");
  const h2 = units.find((unit) => unit.kind === "heading" && unit.lang === "en");
  check("the separate-layout document has four sentences and a heading in each language, no pairs", [a, b, c, d, a2, b2, c2, d2, h, h2].every(Boolean) && (await readView()).pairs.length === 0, doc.doc_code);
  const isPaired = (view, one, two) => pairOf(view, one.id) !== null && pairOf(view, one.id) === pairOf(view, two.id);

  let patchView = (body) => body;
  const isDocView = (url) => url.pathname.endsWith(`/api/bundles/${halfBundleId}${docPath}/view`);
  await page.route(isDocView, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: patchView(await response.json()) });
  });
  // 화면이 보낸 짝 요청(page.request로 만든 자료는 세지 않는다)과 Assign 되돌리기 요청
  const pairRequests = [];
  let assignUndoRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/pairs(\/\d+(\/confirm)?)?$/.test(path)) pairRequests.push({ method: request.method(), path, body: request.postData() });
    if (path.endsWith("/decisions/undo")) assignUndoRequests += 1;
  });
  const isPairCall = (method, pattern) => (response) => response.request().method() === method && pattern.test(new URL(response.url()).pathname);
  const POST_PAIR = isPairCall("POST", /\/pairs$/);
  const POST_CONFIRM = isPairCall("POST", /\/pairs\/\d+\/confirm$/);

  const pairPiece = (id) => page.locator(`[data-testid="assign-pair-piece-${id}"]`);
  const openDoc = async (unitId) => {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
    await page.locator(`[data-testid="assign-paper-piece-${unitId}"]`).waitFor({ timeout: T });
  };
  const reopen = async () => {
    await page.reload();
    await wait(page, "assign-bar");
    await openDoc(a.id);
    await page.locator('[data-testid="assign-pair-view"]').click();
    await wait(page, "assign-pair-en");
    await page.waitForLoadState("networkidle");
  };
  // 조각 첫 글줄 위 한 점 - 그 조각을 제 칸 가운데로 굴린 뒤에 잰다(가장자리 자동 스크롤에 걸리지 않게)
  const pointOn = async (id) => {
    await pairPiece(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return pairPiece(id).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + Math.min(60, rect.width / 2), y: rect.top + Math.min(rect.height / 2, 14) };
    });
  };
  const startDrag = async (fromId) => {
    const from = await pointOn(fromId);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 5 });
  };
  const moveOnto = async (toId) => {
    const to = await pointOn(toId);
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(100);
  };
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
  }));
  const readMarks = () => page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    lines: document.querySelectorAll("svg[data-drag-line]").length,
    drops: document.querySelectorAll("[data-drop]").length,
    srcs: document.querySelectorAll("[data-drag-src]").length,
  }));
  const NO_MARKS = JSON.stringify({ cards: 0, lines: 0, drops: 0, srcs: 0 });
  const toastWith = (tone, text) => page.locator(`[data-testid="toast-${tone}"]`, { hasText: text });
  const undoIn = (toast) => toast.locator('[data-testid^="toast-action-"]');
  const actionCount = () => page.locator('[data-testid^="toast-action-"]').count();
  const idsOf = (one, two) => [one, two].sort(sourceOrder).map((unit) => unit.display_id).join(" + ");
  const clearToasts = async () => {
    // 셋 사이에 저절로 빠지는 알림이 있어 DOM에서 한 번에 누른다
    await page.evaluate(() => document.querySelectorAll('[data-testid^="toast-close-"]').forEach((button) => button.click()));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="toasts"] .toast-slot').length === 0, null, { timeout: T });
  };
  // 놓고 저장 응답과 그 알림까지 기다린다
  const dropAndSave = async (match, toastText) => {
    const response = page.waitForResponse(match, { timeout: T });
    await page.mouse.up();
    const done = await response;
    const toast = toastWith("ok", toastText);
    await toast.waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
    return { response: done, toast };
  };
  const expectRefused = async (label, fromId, toId, text) => {
    const before = { requests: pairRequests.length, pairs: JSON.stringify((await readView()).pairs) };
    await startDrag(fromId);
    await moveOnto(toId);
    const card = await readCard();
    const drop = await pairPiece(toId).getAttribute("data-drop");
    await page.mouse.up();
    await page.waitForTimeout(400);
    check(`${label}: the card says why and the piece is marked refused`, card.refused && card.note === text && card.dest === "" && drop === "refused", JSON.stringify({ card, drop }));
    check(`${label}: the drop writes nothing`, pairRequests.length === before.requests && JSON.stringify((await readView()).pairs) === before.pairs, String(pairRequests.length - before.requests));
  };

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await openDoc(a.id);
  await page.locator('[data-testid="assign-pair-view"]').click();
  await wait(page, "assign-pair-en");
  await page.waitForLoadState("networkidle");
  check("the pieces of a free sentence are drag boxes", (await pairPiece(a.id).getAttribute("data-drag-box")) === "" && (await pairPiece(a2.id).getAttribute("data-drag-box")) === "");
  // 다른 줄(h)을 골라 둔 채 끈다 - 놓은 뒤 고른 줄은 놓기가 고른 짝 줄이고, 놓은 자리의 click은 끌기 층이 삼켜 두 칸에 닿지 않는다
  await pairPiece(h.id).click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === want, h.display_id, { timeout: T });
  await installPanesClickCounter(page);

  // 1. 끄는 동안 - 표의 메모·놓을 조각의 테두리·출발 조각·따라오는 선 하나. 두 칸의 조각 위를 지나도 React는 다시 그리지 않는다(G11)
  await startDrag(a.id);
  await moveOnto(a2.id);
  const overPartner = await readCard();
  check("dragging a over a′ says Pair with a′", overPartner.note === `Pair with ${a2.display_id}` && !overPartner.refused, overPartner.note);
  check("dragging a over a′ the card ends with → pair", overPartner.dest === "→ pair", overPartner.dest);
  // 출발 → 포인터 점선은 New 문장에 잇는 끌기에서만 그린다(설계 2026-11-20 D7) - 짝 놓기는 놓을 조각의 테두리가 자리를 말한다
  check("a′ is the drop target, a is the drag source and no pointer line follows", (await pairPiece(a2.id).getAttribute("data-drop")) === "over" && (await pairPiece(a.id).getAttribute("data-drag-src")) === "" && (await page.locator("svg[data-drag-line]").count()) === 0);
  const wanderPoints = await page.evaluate(() => {
    const points = [];
    for (const side of ["ko", "en"]) {
      const frame = document.querySelector(`[data-pair-col="${side}"] .pane-body`).getBoundingClientRect();
      for (const el of document.querySelectorAll(`[data-pair-col="${side}"] .pair-piece`)) {
        const rect = el.getBoundingClientRect();
        if (rect.top > frame.top + 70 && rect.bottom < frame.bottom - 70 && points.filter((point) => point.side === side).length < 4) points.push({ side, x: rect.left + 30, y: rect.top + rect.height / 2 });
      }
    }
    return points;
  });
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  const wanderNotes = new Set();
  for (let i = 0; i < 40; i += 1) {
    const point = wanderPoints[i % wanderPoints.length];
    await page.mouse.move(point.x + (i % 3), point.y + (i % 2));
    wanderNotes.add((await readCard()).note);
  }
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while passing over pieces of both columns", wanderPoints.length >= 4 && commitsBefore > 0 && commitsBefore === commitsAfter, `${wanderPoints.length} points, ${commitsBefore} -> ${commitsAfter}`);
  // 2~3걸음의 잇기·보내기 끌기는 Pair view에서 붙지 않는다(KO 칸도 data-pane="old"다) - 표는 한 장, 점선 · 잇기·보내기 상태 글 · 놓을 자리 선은 없다
  const wanderMarks = await page.evaluate(() => ({ cards: document.querySelectorAll('[data-testid="drag-card"]').length, lines: document.querySelectorAll("svg[data-drag-line]").length, gaps: document.querySelectorAll('[data-testid="drop-line"]').length }));
  check("only the pair drag runs - no link or send notes, one card, no pointer line, no drop gap", [...wanderNotes].every((note) => note !== "Link to this sentence" && !note.startsWith("→")) && JSON.stringify(wanderMarks) === JSON.stringify({ cards: 1, lines: 0, gaps: 0 }), `${JSON.stringify([...wanderNotes])} ${JSON.stringify(wanderMarks)}`);

  // 2. 놓으면 바로 저장하고 Undo가 든 알림
  await moveOnto(a2.id);
  await page.evaluate(() => { window.__panesClicks = 0; });
  const paired = await dropAndSave(POST_PAIR, `Paired ${idsOf(a, a2)}`);
  const pairDropClicks = await page.evaluate(() => window.__panesClicks);
  const sent = JSON.parse(pairRequests.at(-1).body);
  check("the drop posts the pair [a, a′] and gets 201", paired.response.status() === 201 && JSON.stringify(sent.unit_ids) === JSON.stringify([a.id, a2.id]), `${paired.response.status()} ${pairRequests.at(-1).body}`);
  const pairedText = (await paired.toast.innerText()).trim();
  check("the toast names both pieces and carries one Undo", pairedText.startsWith("Paired ") && pairedText.includes(a.display_id) && pairedText.includes(a2.display_id) && (await actionCount()) === 1 && (await undoIn(paired.toast).innerText()).trim() === "Undo", pairedText);
  const afterDrop = pairOf(await readView(), a.id);
  check("a and a′ are one confirmed pair made by a person", afterDrop !== null && afterDrop.unit_ids.includes(a2.id) && afterDrop.status === "confirmed" && afterDrop.source === "human", JSON.stringify(afterDrop));
  await page.locator(`[data-testid="assign-pair-lines"] g[data-pair-link="${a.id}:${a2.id}"][data-status="confirmed"]`).waitFor({ timeout: T });
  await page.waitForFunction((want) => want.every((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id)), [a.display_id, a2.display_id], { timeout: T });
  check("the pair line is drawn, the pair row is picked and the drag marks are gone", JSON.stringify(await readMarks()) === NO_MARKS, JSON.stringify(await readMarks()));
  const pickedAfterDrop = (await getText(page, "assign-row-id")).trim();
  check("the click after the drop is swallowed and h is no longer the picked row", pairDropClicks === 0 && !pickedAfterDrop.includes(h.display_id), `${pairDropClicks} clicks, row ${pickedAfterDrop}`);
  // Undo는 강조색 글(.btn.ghost보다 앞서야 한다)
  const undoColour = await undoIn(paired.toast).evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { undo: getComputedStyle(el).color, accent };
  });
  check("the Undo label is the accent colour", undoColour.undo === undoColour.accent, JSON.stringify(undoColour));

  // 3. 글쇠로 Undo - 포커스를 주고 ↵. 알림의 Undo는 Ctrl+Z와 같은 Assign 되돌리기다(B6 - 짝 맺기가 되돌리기 줄의 한 단계)
  await undoIn(paired.toast).focus();
  const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("Enter");
  check("Enter on Undo undoes the pair step (200)", (await undone).status() === 200);
  await toastWith("ok", "Undone: Pair").waitFor({ timeout: T });
  check("a and a′ are apart again, by one Assign undo", pairOf(await readView(), a.id) === null && assignUndoRequests === 1, String(assignUndoRequests));
  await page.waitForLoadState("networkidle");

  // 4. 반대 방향 - EN 조각을 KO 조각에. 이 짝(P1)은 남긴다
  await startDrag(a2.id);
  await moveOnto(a.id);
  const overBack = await readCard();
  check("dragging a′ over a says Pair with a", overBack.note === `Pair with ${a.display_id}`, overBack.note);
  const back = await dropAndSave(POST_PAIR, `Paired ${idsOf(a, a2)}`);
  check("the drop posts [a′, a] and they are a pair again", back.response.status() === 201 && JSON.stringify(JSON.parse(pairRequests.at(-1).body).unit_ids) === JSON.stringify([a2.id, a.id]) && isPaired(await readView(), a, a2), pairRequests.at(-1).body);

  // 5. 못 놓는 곳은 이유를 보이고 아무것도 쓰지 않는다
  await expectRefused("same language (b → c)", b.id, c.id, "A pair needs one Korean and one English sentence. Pick one in the other language.");
  await expectRefused("onto a confirmed pair (b → a′)", b.id, a2.id, "One of these sentences is already in a confirmed pair.");
  await expectRefused("dragging a confirmed pair (a → b′)", a.id, b2.id, "One of these sentences is already in a confirmed pair.");
  // c′를 칸에 확정한다(화면의 저장과 같은 모양)
  const sop = (await getJson("/tobe")).docs.find((item) => item.entrance === "assign" && item.doc_type === "sop");
  const sections = (await getJson(`/outputs/c/docs/${sop.id}?lang=en`)).sections;
  const slot = sections.find((section) => takesLines(section) && section.na_reason === null && !sections.some((other) => other.location_key.startsWith(`${section.location_key}.`)));
  const c2Row = (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === c2.id);
  const assigned = await page.request.post(`${api}/groups/save`, {
    headers,
    data: {
      action: "confirm",
      hold_reason: "",
      units: [{ unit_id: c2.id, revision: c2Row.decision.revision, disposition: "assigned", move_target_code: "", reason: "" }],
      targets: [{ key: `u${c2.id}`, target_doc_id: sop.id, slot_key: slot.location_key, kind: "sentence", lang: "en", text: c2Row.text.trim(), source_unit_ids: [c2.id] }],
      removed_target_ids: [],
    },
  });
  check("the API assigns c′", assigned.ok(), String(assigned.status()));
  // (b, b′)를 맺고 응답에서 제안으로, d′를 참조 줄로 바꿔 그린다
  check("the API pairs b and b′", (await pairUnits([b.id, b2.id])).status() === 201);
  patchView = (body) => ({
    ...body,
    pairs: body.pairs.map((pair) => (pair.unit_ids.includes(b.id) ? { ...pair, status: "suggested", source: "code" } : pair)),
    units: body.units.map((unit) => (unit.id === d2.id ? { ...unit, lang: "ref", ref: { state: "confirmed", number: "SOP-ABC-1016" } } : unit)),
  });
  await reopen();
  await expectRefused("onto an assigned piece (c → c′)", c.id, c2.id, "The sentence on that side is assigned. Clear its assignment first.");
  await expectRefused("dragging an assigned piece (c′ → c)", c2.id, c.id, "This sentence is assigned. Clear the assignment first.");
  await expectRefused("onto a reference line (d → d′)", d.id, d2.id, "A reference line has no language. Choose Not a reference first.");
  const refPoint = await pointOn(d2.id);
  await page.mouse.move(refPoint.x, refPoint.y);
  await page.mouse.down();
  await page.mouse.move(refPoint.x + 40, refPoint.y, { steps: 8 });
  const refCards = await page.locator('[data-testid="drag-card"]').count();
  await page.mouse.up();
  check("a reference line is not a drag box and does not drag", (await pairPiece(d2.id).getAttribute("data-drag-box")) === null && refCards === 0, String(refCards));
  await expectRefused("onto a piece of a suggestion for another sentence (d → b′)", d.id, b2.id, "One of them is already in a pair. Separate it first.");
  await expectRefused("dragging a piece of a suggestion elsewhere (b → h′)", b.id, h2.id, "One of them is already in a pair. Separate it first.");

  // 6. 제안의 조각을 제 짝에 놓으면 그 제안을 확정한다 - 확정 호출은 진짜 서버로. 이 짝은 화면만 제안으로 바꿔 그렸고 서버에는 이미 확정이라
  // 확정이 아무것도 쓰지 않는다(revision 그대로) - 되돌릴 단계가 없으니 알림에 Undo가 없다(있으면 앞 단계를 되돌린다). 확정 되돌리기 자체는 backend 시험이 본다
  await startDrag(b.id);
  await moveOnto(b2.id);
  const overSuggestion = await readCard();
  check("dragging b over its suggested partner says Confirm this suggested pair", overSuggestion.note === "Confirm this suggested pair" && !overSuggestion.refused && overSuggestion.dest === "→ pair", JSON.stringify(overSuggestion));
  const undosBeforeConfirm = assignUndoRequests;
  const confirmed = await dropAndSave(POST_CONFIRM, `Confirmed the pair ${idsOf(b, b2)}`);
  const confirmBody = JSON.parse(pairRequests.at(-1).body);
  check("the drop confirms the suggestion (200) with the revision and the undo record", confirmed.response.status() === 200 && JSON.stringify(Object.keys(confirmBody)) === JSON.stringify(["revision", "undo"]), pairRequests.at(-1).body);
  check("the toast says Confirmed the pair and, as nothing was written, carries no Undo", (await confirmed.toast.innerText()).trim().startsWith("Confirmed the pair ") && (await undoIn(confirmed.toast).count()) === 0 && assignUndoRequests === undosBeforeConfirm);
  patchView = (body) => body;
  // 뒤 단계는 b, b′가 짝이 없어야 한다
  const confirmedPair = pairOf(await readView(), b.id);
  check("the API separates b, b′", confirmedPair !== null && (await unpair(confirmedPair.id)).ok());
  // 화면 밖에서 풀었다 - 다시 받아야 화면이 b, b′를 짝 없이 본다
  await reopen();

  // 7. Esc는 끌기만 거둔다
  const escBefore = pairRequests.length;
  await startDrag(b.id);
  await moveOnto(b2.id);
  await page.keyboard.press("Escape");
  const escMarks = await readMarks();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("Esc clears the card, the line and the drop marks and sends nothing", JSON.stringify(escMarks) === NO_MARKS && pairRequests.length === escBefore, JSON.stringify(escMarks));

  // 8. 그사이 짝이 바뀐 뒤의 Undo - 서버가 되돌리기를 거절하고(undo_conflict) 아무것도 쓰지 않는다
  await startDrag(b.id);
  await moveOnto(b2.id);
  const stale = await dropAndSave(POST_PAIR, `Paired ${idsOf(b, b2)}`);
  const stalePair = pairOf(await readView(), b.id);
  check("the API separates b and b′ behind the screen", stalePair !== null && (await unpair(stalePair.id)).ok());
  const deletesBefore = pairRequests.filter((request) => request.method === "DELETE").length;
  const staleUndo = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await undoIn(stale.toast).click();

  check("Undo after the pair changed is refused (409)", (await staleUndo).status() === 409);
  await toastWith("error", "Can't undo").waitFor({ timeout: T });
  check("Undo after the pair changed sends no delete and says so", pairRequests.filter((request) => request.method === "DELETE").length === deletesBefore);
  await page.waitForLoadState("networkidle");

  // 9. 잇달아 두 번 - 알림의 Undo는 제 단계가 맨 끝일 때만(Ctrl+Z와 같은 줄이라 앞 알림은 되돌리지 않고 Ctrl+Z를 알린다)
  await clearToasts();
  await startDrag(b.id);
  await moveOnto(b2.id);
  const first = await dropAndSave(POST_PAIR, `Paired ${idsOf(b, b2)}`);
  await startDrag(h.id);
  await moveOnto(h2.id);
  await dropAndSave(POST_PAIR, `Paired ${idsOf(h, h2)}`);
  check("two pairings in a row leave two toasts with their own Undo", (await actionCount()) === 2, String(await actionCount()));
  const undosBeforeFirst = assignUndoRequests;
  await undoIn(first.toast).click();
  await toastWith("info", "Other changes came after this").waitFor({ timeout: T });
  const afterFirst = await readView();
  check("the lower (first) toast's Undo undoes nothing once another step came after it", assignUndoRequests === undosBeforeFirst && isPaired(afterFirst, b, b2) && isPaired(afterFirst, h, h2), String(assignUndoRequests - undosBeforeFirst));
  const secondUndone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z undoes the latest pair h, h′ (200)", (await secondUndone).status() === 200);
  const thirdUndone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z again undoes b, b′ (200)", (await thirdUndone).status() === 200);
  const afterTwo = await readView();
  check("both pairs are apart after two Ctrl+Z", pairOf(afterTwo, b.id) === null && pairOf(afterTwo, h.id) === null);
  await page.waitForLoadState("networkidle");

  // 10. 낡은 revision - 끄는 사이 다른 곳에서 문서가 바뀌면 서버가 409로 거절하고 짝은 생기지 않는다. 다시 놓으면 된다
  await reopen();
  await startDrag(d.id);
  await moveOnto(d2.id);
  check("d′ is an English sentence again (no rewritten response)", (await readCard()).note === `Pair with ${d2.display_id}`);
  const bump = await pairUnits([b.id, b2.id]);
  const bumped = pairOf(await readView(), b.id);
  check("the API bumps the revision while the drag is on", bump.status() === 201 && bumped !== null && (await unpair(bumped.id)).ok());
  const conflict = page.waitForResponse(POST_PAIR, { timeout: T });
  await page.mouse.up();
  check("the drop with an old revision is refused (409)", (await conflict).status() === 409);
  await toastWith("error", "Someone changed this first").waitFor({ timeout: T });
  check("no pair is made for d and d′", pairOf(await readView(), d.id) === null);
  await page.waitForLoadState("networkidle");
  await startDrag(d.id);
  await moveOnto(d2.id);
  const retried = await dropAndSave(POST_PAIR, `Paired ${idsOf(d, d2)}`);
  check("dropping again pairs them (201)", retried.response.status() === 201 && isPaired(await readView(), d, d2));

  // 11. 다른 화면에서의 Undo - 알림은 화면을 넘어 남는다(page.goto는 화면을 새로 받아 알림을 지우니 레일로 간다)
  await page.locator('[data-testid="stage-nav-outputs"]').click();
  await page.waitForURL(/\/outputs/, { timeout: T });
  const awayUndone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await undoIn(retried.toast).click();
  check("Undo from the Outputs screen undoes the pair step (200)", (await awayUndone).status() === 200);
  await toastWith("ok", "Undone: Pair").waitFor({ timeout: T });
  check("d and d′ are apart and nothing threw", pairOf(await readView(), d.id) === null && pageErrors.length === 0, pageErrors.join(" | "));

  // 12. 메뉴 길은 그대로 - Pair view를 켜지 않고 우클릭
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await wait(page, "assign-bar");
  await openDoc(c.id);
  await page.locator(`[data-testid="assign-paper-piece-${c.id}"]`).click({ button: "right" });
  await wait(page, "assign-ctx-pair_pick");
  check("the context menu still offers Pair with another sentence", (await page.locator('[data-testid="assign-ctx-pair_pick"]').count()) === 1 && (await page.locator('[data-testid="assign-ctx-pair_pick"]').getAttribute("aria-disabled")) === null);
  await page.keyboard.press("Escape");

  // 13. 뒷정리 - 짝을 풀고 그 문서의 판단을 비운다
  await page.unroute(isDocView);
  for (const pair of (await readView()).pairs) await unpair(pair.id);
  await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: doc.id } });
  const cleaned = await readView();
  check("the step leaves the document without pairs or decisions", cleaned.pairs.length === 0 && cleaned.units.every((unit) => unit.status === null || unit.status === "unassigned"));
});

// 읽기 전용 묶음에서도 Pair view는 읽는 일이라 켜진다. 조각은 끌리지 않는다(G13)
await runStep("assign: Pair view reads on a read-only bundle, nothing drags", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  const doc = (await (await page.request.get(`${BASE}/api/bundles/${reviewId}/documents`, { headers: { "X-Dev-User": "qa.lead" } })).json()).find((item) => item.side === "old" && item.status === "ready" && item.language_layout === "ko_en_separate");
  let pairRequests = 0;
  page.on("request", (request) => {
    if (/\/pairs(\/|$)/.test(new URL(request.url()).pathname)) pairRequests += 1;
  });
  await page.goto(`${BASE}/bundles/${reviewId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await wait(page, "assign-pair-view");
  await page.locator('[data-testid="assign-pair-view"]').click();
  await wait(page, "assign-pair-en");
  check("Pair view opens two columns for a reader", (await page.locator('[data-testid="assign-pair-ko"]').isVisible()) && (await page.locator('[data-testid="assign-pair-en"]').isVisible()));
  check("no piece is a drag box", (await page.locator(".pair-piece[data-drag-box]").count()) === 0);
  const box = await page.locator(".pair-piece").first().boundingBox();
  await page.mouse.move(box.x + 30, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 10, { steps: 8 });
  const cards = await page.locator('[data-testid="drag-card"]').count();
  await page.mouse.up();
  check("pressing and moving a piece starts no drag and sends nothing", cards === 0 && pairRequests === 0, `${cards} cards, ${pairRequests} requests`);
});

// 가까운 줄(끌어다 놓기 5걸음) - 한/영 연달아 문서의 평소 Old 칸에서 조각을 맞은편 언어의 조각에 놓아 짝을 맺는다. Pair view 없이 같은 규칙·같은 Undo
await runStep("assign: drag an Old piece onto a nearby piece in the other language to pair them", {}, async ({ page }) => {
  await installCommitCounter(page);
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const pairOf = (view, unitId) => view.pairs.find((pair) => pair.unit_ids.includes(unitId)) ?? null;
  const isPaired = (view, one, two) => pairOf(view, one.id) !== null && pairOf(view, one.id) === pairOf(view, two.id);
  // 위아래로 붙은 한/영 문장 짝 줄 - 두 Unit 모두 미배정
  const findNearPairs = (view) => {
    const order = view.units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
    const isFree = (unit) => unit.kind === "sentence" && (unit.status === null || unit.status === "unassigned");
    return view.pairs.flatMap((pair) => {
      const members = pair.unit_ids.map((id) => order.findIndex((unit) => unit.id === id)).sort((one, two) => one - two);
      if (members.length !== 2 || members[0] < 0 || members[1] - members[0] !== 1) return [];
      const [one, two] = members.map((index) => order[index]);
      if (!isFree(one) || !isFree(two) || new Set([one.lang, two.lang]).size !== 2 || ![one.lang, two.lang].every((lang) => lang === "ko" || lang === "en")) return [];
      return [{ pair, ko: one.lang === "ko" ? one : two, en: one.lang === "en" ? one : two }];
    });
  };
  const docs = await getJson("/documents");
  const interleaved = [];
  for (const item of docs.filter((doc) => doc.side === "old" && doc.status === "ready" && doc.language_layout === "ko_en_interleaved")) {
    const view = await getJson(`/documents/${item.id}/view`);
    // 그림과 표가 모두 있는 문서만 - 아래 5의 두 확인이 늘 돈다(검사 수가 자료에 따라 달라지지 않게)
    const hasKind = (kind) => view.units.some((unit) => unit.group_unit_id === null && unit.kind === kind);
    if (hasKind("figure") && hasKind("table")) interleaved.push({ doc: item, view });
  }
  let picked = interleaved.find((entry) => findNearPairs(entry.view).length >= 3);
  if (!picked && interleaved.length > 0) {
    // 모자라면 첫 문서의 판단을 비운다 - 뒤 단계는 이 묶음을 읽지 않는다
    await page.request.post(`${api}/decisions/reset`, { headers, data: { revision: (await getJson("")).revision, document_id: interleaved[0].doc.id } });
    picked = { doc: interleaved[0].doc, view: await getJson(`/documents/${interleaved[0].doc.id}/view`) };
  }
  const near = picked ? findNearPairs(picked.view) : [];
  check("an interleaved document with a figure and a table has three nearby KO/EN sentence pairs left open", near.length >= 3, picked?.doc.doc_code ?? "none");
  const doc = picked.doc;
  const docPath = `/documents/${doc.id}`;
  const readView = () => getJson(`${docPath}/view`);
  const unpair = async (pairId) => page.request.delete(`${api}${docPath}/pairs/${pairId}?revision=${(await readView()).document.revision}`, { headers });
  const [nearX, nearY, nearQ] = near;
  check("the API separates x, x′ and y, y′", (await unpair(nearX.pair.id)).ok() && (await unpair(nearY.pair.id)).ok());
  const { ko: x, en: x2 } = nearX;
  const { ko: y, en: y2 } = nearY;
  const { ko: q, en: q2 } = nearQ;
  const units = (await readView()).units.filter((unit) => unit.group_unit_id === null);
  const figure = units.find((unit) => unit.kind === "figure");
  const table = units.find((unit) => unit.kind === "table");

  // 화면이 보낸 짝 요청(page.request로 만든 자료는 세지 않는다)
  const pairRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/pairs(\/\d+(\/confirm)?)?$/.test(path)) pairRequests.push({ method: request.method(), path, body: request.postData() });
  });
  const isPairCall = (method, pattern) => (response) => response.request().method() === method && pattern.test(new URL(response.url()).pathname);
  const POST_PAIR = isPairCall("POST", /\/pairs$/);

  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const openDoc = async (docId, unitId) => {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${docId}"]`).click();
    await pieceOf(unitId).waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
  };
  // 조각 글의 첫 글줄 위 한 점 - 조각을 Old 칸 가운데로 굴린 뒤에 잰다(가장자리 자동 스크롤에 걸리지 않게)
  const pointOn = async (id) => {
    await pieceOf(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  // 조각 상자 가운데(그림처럼 글줄이 없는 조각)
  const centreOf = async (locator) => {
    await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const box = await locator.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const startDrag = async (fromId) => {
    const from = await pointOn(fromId);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 5 });
  };
  const moveTo = async (point) => {
    await page.mouse.move(point.x, point.y, { steps: 12 });
    await page.waitForTimeout(100);
  };
  const moveOnto = async (toId) => moveTo(await pointOn(toId));
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
        dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
    drops: document.querySelectorAll("[data-drop]").length,
  }));
  const toastWith = (tone, text) => page.locator(`[data-testid="toast-${tone}"]`, { hasText: text });
  const undoIn = (toast) => toast.locator('[data-testid^="toast-action-"]');
  const idsOf = (one, two) => [one, two].sort(sourceOrder).map((unit) => unit.display_id).join(" + ");
  const dropAndSave = async (toastText) => {
    const response = page.waitForResponse(POST_PAIR, { timeout: T });
    await page.mouse.up();
    const done = await response;
    const toast = toastWith("ok", toastText);
    await toast.waitFor({ timeout: T });
    await page.waitForLoadState("networkidle");
    return { response: done, toast };
  };
  const expectRefused = async (label, fromId, toId, text) => {
    const before = { requests: pairRequests.length, pairs: JSON.stringify((await readView()).pairs) };
    await startDrag(fromId);
    await moveOnto(toId);
    const card = await readCard();
    const drop = await pieceOf(toId).getAttribute("data-drop");
    await page.mouse.up();
    await page.waitForTimeout(400);
    check(`${label}: the card says why and the piece is marked refused`, card.refused && card.note === text && card.dest === "" && drop === "refused", JSON.stringify({ card, drop }));
    check(`${label}: the drop writes nothing`, pairRequests.length === before.requests && JSON.stringify((await readView()).pairs) === before.pairs, String(pairRequests.length - before.requests));
  };

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  if ((await page.locator('[data-testid="assign-new"]').count()) === 0) await page.locator('[data-testid="assign-view-two"]').click();
  await openDoc(doc.id, x.id);
  check("the interleaved document opens in the two-document view without Pair view", (await page.locator('[data-testid="assign-new"]').count()) === 1 && (await page.locator('[data-testid="assign-pair-view"]').count()) === 0);

  // 다른 줄(q 카드)을 골라 둔 채 끈다 - 놓은 뒤 고른 줄은 놓기가 고른 짝 줄이고 놓은 자리의 click은 Old 칸에 닿지 않는다
  await pieceOf(q.id).click();
  await page.waitForFunction((want) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(want), q.display_id, { timeout: T });
  await installPanesClickCounter(page);

  // 1. 끄는 동안 - x를 x′ 위로. Old 조각들 위를 지나도 React는 다시 그리지 않는다(G11)
  await startDrag(x.id);
  await moveOnto(x2.id);
  const overX2 = await readCard();
  check("dragging x over x′ says Pair with x′", overX2.note === `Pair with ${x2.display_id}` && !overX2.refused && overX2.dest === "→ pair", JSON.stringify(overX2));
  check("x′ is the drop target", (await pieceOf(x2.id).getAttribute("data-drop")) === "over");
  const stripOverOffset = await pieceOf(x2.id).evaluate((el) => getComputedStyle(el).outlineOffset);
  const wanderPoints = await page.evaluate(() => {
    const frame = document.querySelector('[data-pane="old"] .pane-body').getBoundingClientRect();
    const points = [];
    for (const el of document.querySelectorAll('[data-pane="old"] .strip[data-strip-unit]')) {
      // 점은 조각 첫 글줄 높이 - 가장자리 자동 스크롤 띠(44px) 밖이어야 한다
      const rect = el.getBoundingClientRect();
      const y = rect.top + Math.min(rect.height / 2, 12);
      if (y > frame.top + 50 && y < frame.bottom - 50 && points.length < 6) points.push({ x: rect.left + 30, y });
    }
    return points;
  });
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 30; i += 1) {
    const point = wanderPoints[i % wanderPoints.length];
    await page.mouse.move(point.x + (i % 3), point.y + (i % 2));
  }
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit in 30 moves over Old pieces", wanderPoints.length >= 4 && commitsBefore > 0 && commitsBefore === commitsAfter, `${wanderPoints.length} points, ${commitsBefore} -> ${commitsAfter}`);

  // 2. 놓으면 바로 저장하고 Undo가 든 알림 - 두 조각이 한 카드가 된다
  await moveOnto(x2.id);
  await page.evaluate(() => { window.__panesClicks = 0; });
  const paired = await dropAndSave(`Paired ${idsOf(x, x2)}`);
  const nearDropClicks = await page.evaluate(() => window.__panesClicks);
  const pickedPairRow = await page.waitForFunction((want) => want.every((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id)), [x.display_id, x2.display_id], { timeout: T }).then(() => true, () => false);
  const pickedAfterNear = (await getText(page, "assign-row-id")).trim();
  check("after the drop the new pair row is picked, not q's, and the click after it is swallowed", pickedPairRow && !pickedAfterNear.includes(q.display_id) && nearDropClicks === 0, `${nearDropClicks} clicks, row ${pickedAfterNear}`);
  check("the drop posts the pair [x, x′] and gets 201", paired.response.status() === 201 && JSON.stringify(JSON.parse(pairRequests.at(-1).body).unit_ids) === JSON.stringify([x.id, x2.id]), `${paired.response.status()} ${pairRequests.at(-1).body}`);
  check("the toast carries Undo", (await undoIn(paired.toast).innerText()).trim() === "Undo");
  check("x and x′ are one pair in the API", isPaired(await readView(), x, x2));
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-bracket")), [x.id, x2.id], { timeout: T });
  check("on the Old paper x and x′ are one card", (await pieceOf(x.id).getAttribute("data-bracket")) !== null && (await pieceOf(x2.id).getAttribute("data-bracket")) !== null);
  const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await undoIn(paired.toast).click();
  check("Undo undoes the pair step (200)", (await undone).status() === 200);
  await toastWith("ok", "Undone: Pair").waitFor({ timeout: T });
  check("x and x′ are apart again", pairOf(await readView(), x.id) === null);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-bracket"), x.id, { timeout: T });

  // 3. 반대 방향 - x′를 x에. 이 짝은 남긴다
  await startDrag(x2.id);
  await moveOnto(x.id);
  check("dragging x′ over x says Pair with x", (await readCard()).note === `Pair with ${x.display_id}`);
  const back = await dropAndSave(`Paired ${idsOf(x, x2)}`);
  check("the drop posts [x′, x] and they are a pair again", back.response.status() === 201 && JSON.stringify(JSON.parse(pairRequests.at(-1).body).unit_ids) === JSON.stringify([x2.id, x.id]) && isPaired(await readView(), x, x2), pairRequests.at(-1).body);

  // 4. 못 놓는 곳은 이유를 보이고 아무것도 쓰지 않는다 - 같은 언어는 합치기 규칙(B6): 떨어져 있으면 이웃만 합친다는 까닭
  const flowIds = units.slice().sort(sourceOrder).map((unit) => unit.id);
  check("y′ and x′ are not next to each other", Math.abs(flowIds.indexOf(y2.id) - flowIds.indexOf(x2.id)) > 1);
  await expectRefused("same language, not neighbours (y′ → x′)", y2.id, x2.id, "Only sentences next to each other can be merged.");
  await expectRefused("onto a confirmed pair (y → x′)", y.id, x2.id, "One of these sentences is already in a confirmed pair.");
  const qPair = pairOf(await readView(), q.id);
  await expectRefused(`dragging a ${qPair.status} pair card (q → y′)`, q.id, y2.id, qPair.status === "confirmed" ? "One of these sentences is already in a confirmed pair." : "One of them is already in a pair. Separate it first.");
  await startDrag(q.id);
  await moveOnto(q2.id);
  const overOwn = await readCard();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("a pair card over its own piece marks nothing and says nothing", overOwn.drops === 0 && overOwn.note === "", JSON.stringify(overOwn));

  // 5. New 칸은 그대로 잇기 - Old 조각들을 지나 이미 쓴 문서의 문장 위로. 그림·표 위는 놓을 자리 밖
  const writtenDocIds = [...new Set((await getJson("/written-sentences")).map((row) => row.target_doc_id))];
  const newPane = page.locator('[data-testid="assign-new"]');
  if (!writtenDocIds.includes(Number(await newPane.getAttribute("data-doc")))) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${writtenDocIds[0]}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), writtenDocIds[0], { timeout: T });
  }
  const line = page.locator('[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target]:not([data-state="picked"])').first();
  await line.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const lineBox = await line.locator(".new-hit").boundingBox();
  const requestsBeforeNew = pairRequests.length;
  await startDrag(y.id);
  await moveTo({ x: lineBox.x + Math.min(60, lineBox.width / 2), y: lineBox.y + lineBox.height / 2 });
  const overLine = await readCard();
  check("over a written New sentence the card still says link", overLine.note === "Link to this sentence" && overLine.dest === "→ link" && (await line.getAttribute("data-drop")) === "over", JSON.stringify(overLine));
  // 5걸음의 안쪽 테두리(-5px)는 Old 칸만 - New 문장의 잇기 테두리는 2걸음 값(-2px), 거절 테두리는 공통 값(-1px) 그대로다(New 칸도 .pg[data-strips]다)
  const offsetOf = (locator) => locator.evaluate((el) => getComputedStyle(el).outlineOffset);
  const lineOverOffset = await offsetOf(line);
  // 그림은 본문 탭에 없다(시안 2 D3 - 그림 탭의 카드) - 끄는 문장이 그림 위로 갈 수 없다
  check("the figure is not on the body tab, so a dragged sentence can never mark it", (await pieceOf(figure.id).count()) === 0);
  // 표 묶음에는 표 자체의 assign-paper-unit 손잡이가 없다(머리 줄) - 조각 상자 가운데(칸 문장 위)
  await moveTo(await centreOf(pieceOf(table.id)));
  const overTable = await readCard();
  check("over a table piece nothing is marked and the card says nothing", overTable.drops === 0 && overTable.note === "", JSON.stringify(overTable));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("Esc ends the drag and nothing is paired", pairRequests.length === requestsBeforeNew && pairOf(await readView(), y.id) === null);
  // 거절 표시는 끌기 층이 다는 속성 하나다 - 끌기 없이 달아 CSS만 잰다
  const lineRefusedOffset = await line.evaluate((el) => {
    el.dataset.drop = "refused";
    const value = getComputedStyle(el).outlineOffset;
    delete el.dataset.drop;
    return value;
  });
  check("drop outlines: Old strip inside (-5px), New line link -2px and refused -1px as before", JSON.stringify([stripOverOffset, lineOverOffset, lineRefusedOffset]) === JSON.stringify(["-5px", "-2px", "-1px"]), JSON.stringify([stripOverOffset, lineOverOffset, lineRefusedOffset]));

  // 6b. New 문장을 그 자리에서 다듬는 중(고른 Old 줄 없음)에 짝을 맺어도 그 짝의 줄이 골라지고 다듬기는 닫힌다. 맺은 짝은 Undo로 푼다
  await page.reload();
  await wait(page, "assign-bar");
  await openDoc(doc.id, y.id);
  if (!writtenDocIds.includes(Number(await newPane.getAttribute("data-doc")))) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${writtenDocIds[0]}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), writtenDocIds[0], { timeout: T });
  }
  await page.locator('[data-testid="assign-new"] [data-testid^="assign-new-pick-"]').first().click();
  await wait(page, "assign-solo");
  await startDrag(y.id);
  await moveOnto(y2.id);
  const shapedDrop = await dropAndSave(`Paired ${idsOf(y, y2)}`);
  const pickedAfterShape = await page.waitForFunction((ids) => ids.every((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id)), [y.display_id, y2.display_id], { timeout: T }).then(() => true, () => false);
  check("a pair dropped while a New sentence is shaped in place picks the pair row and closes the shaping", pickedAfterShape && (await page.locator('[data-testid="assign-solo"]').count()) === 0, await page.evaluate(() => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() ?? "no row"));
  // 짝은 API로 푼다(위 확인이 실패해 기다린 사이 알림이 사라졌어도 뒤 단계가 돈다)
  check("the API separates y and y′ again", shapedDrop.response.status() === 201 && (await unpair(pairOf(await readView(), y.id).id)).ok());
  await page.waitForLoadState("networkidle");

  // 7. 뒷정리 - y·y′를 다시 맺는다(x·x′는 사람이 맺은 짝으로 남는다)
  const repaired = await page.request.post(`${api}${docPath}/pairs`, { headers, data: { revision: (await readView()).document.revision, unit_ids: [y.id, y2.id] } });
  check("the API pairs y and y′ again", repaired.status() === 201 && isPaired(await readView(), y, y2));
});

// 따로 쓴 문서에서도 끌어 짝 맺기(설계 2026-11-20 D8) - 시드 9번 묶음(한글 반쪽 뒤에 영어 반쪽)의 평소 Old 칸에서 한글 본문 문장을 영어 본문 문장에 놓는다.
// 한 언어 문서의 조용함은 그대로다(readPairAt의 배치 조건). 맺은 짝은 알림의 Undo로 풀어 시드를 그대로 둔다
await runStep("assign: drag a KO piece onto its EN counterpart in a KO/EN separate document to pair them, Undo separates", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const bundles = await (await page.request.get(`${BASE}/api/bundles`, { headers })).json();
  const bundle = bundles.find((item) => item.title === PAIR_TABLES_TITLE);
  check("the demo seed has the separate-tables bundle", bundle !== undefined);
  if (!bundle) return;
  const api = `${BASE}/api/bundles/${bundle.id}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const doc = (await getJson("/documents")).find((item) => item.side === "old" && item.status === "ready");
  check("its document is laid out KO/EN separate", doc?.language_layout === "ko_en_separate", doc?.language_layout);
  if (!doc) return;
  const readView = () => getJson(`/documents/${doc.id}/view`);
  const pairOf = (view, unitId) => view.pairs.find((pair) => pair.unit_ids.includes(unitId)) ?? null;
  const before = await readView();
  // 두 절반의 본문 문장(시드 _build_pair_tables_bundle) - 앞의 대응 표 단계는 표만 다루고 시드 그대로 둔다
  const findBody = (lang, text) => before.units.find((unit) => unit.group_unit_id === null && unit.kind === "sentence" && unit.lang === lang && unit.text.includes(text));
  const ko = findBody("ko", "합성 세척기의 준비");
  const en = findBody("en", "preparation of the synthetic washer");
  check("the KO and EN body sentences are there and in no pair", Boolean(ko && en) && pairOf(before, ko.id) === null && pairOf(before, en.id) === null, JSON.stringify(before.pairs));
  if (!ko || !en || pairOf(before, ko.id) !== null || pairOf(before, en.id) !== null) return;

  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  // 조각 글의 첫 글줄 위 한 점 - Old 칸 가운데로 굴린 뒤에 잰다(가장자리 자동 스크롤에 걸리지 않게)
  const pointOn = async (id) => {
    await pieceOf(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const readCard = () => page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
    dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
  }));
  const isPairCall = (method, pattern) => (response) => response.request().method() === method && pattern.test(new URL(response.url()).pathname);

  await page.goto(`${BASE}/bundles/${bundle.id}/assign`);
  await wait(page, "assign-bar");
  await pieceOf(ko.id).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  check("the separate document opens in the plain view, not Pair view", (await page.locator('[data-testid="assign-pair-ko"]').count()) === 0);

  // 1. 끄는 동안 - 한글 문장을 영어 문장 위로. 카드 끝은 → pair, 영어 조각이 놓을 자리
  const from = await pointOn(ko.id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y, { steps: 5 });
  const to = await pointOn(en.id);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(100);
  const over = await readCard();
  check("dragging the KO sentence over the EN one says Pair with it and the card ends with → pair", over.note === `Pair with ${en.display_id}` && !over.refused && over.dest === "→ pair", JSON.stringify(over));
  check("the EN piece is the drop target", (await pieceOf(en.id).getAttribute("data-drop")) === "over");

  // 2. 놓으면 바로 저장 - API에서 두 문장이 한 짝, 알림에 Undo
  const posted = page.waitForResponse(isPairCall("POST", /\/pairs$/), { timeout: T });
  await page.mouse.up();
  check("the drop posts the pair and gets 201", (await posted).status() === 201);
  const toast = page.locator('[data-testid="toast-ok"]', { hasText: "Paired" });
  await toast.waitFor({ timeout: T });
  const paired = await readView();
  check("the KO and EN sentences are one pair in the API", pairOf(paired, ko.id) !== null && pairOf(paired, ko.id) === pairOf(paired, en.id), JSON.stringify(paired.pairs));
  await page.waitForLoadState("networkidle");

  // 3. Undo가 짝을 풀어 시드가 처음 그대로다
  const deleted = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await toast.locator('[data-testid^="toast-action-"]').click();
  check("Undo undoes the pair step (200)", (await deleted).status() === 200);
  await page.locator('[data-testid="toast-ok"]', { hasText: "Undone: Pair" }).waitFor({ timeout: T });
  const after = await readView();
  check("after Undo the two sentences are apart and the document has the pairs it had", pairOf(after, ko.id) === null && pairOf(after, en.id) === null && JSON.stringify(after.pairs) === JSON.stringify(before.pairs), JSON.stringify(after.pairs));
  await page.waitForLoadState("networkidle");
});

// 끌어서 합치기(B6, 사용자 결정 2026-11-20 3-a · 3-b) - 같은 언어 이웃 박스에 놓으면 틈의 Join처럼 합치고, 떨어진 같은 언어 박스는 까닭과 함께 거절한다.
// 한 언어 문서(en_only)에서 본다 - 짝이 없는 문서에서도 합치기는 된다. 합친 것은 Ctrl+Z로 되돌려 시드가 처음 그대로다(되살린 Unit은 옛 ID)
await runStep("assign: drag a box onto its same-language neighbour to merge, even in a one-language document; Ctrl+Z splits it back", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const isFree = (unit) => unit.kind === "sentence" && !unit.noise_kind && (unit.status === null || unit.status === "unassigned");
  let found = null;
  for (const item of (await getJson("/documents")).filter((doc) => doc.side === "old" && doc.status === "ready" && doc.language_layout === "en_only")) {
    const order = (await getJson(`/documents/${item.id}/view`)).units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
    const at = order.findIndex((_, i) => i + 2 < order.length && order.slice(i, i + 3).every((unit) => isFree(unit) && unit.lang === order[i].lang));
    if (at >= 0) {
      found = { doc: item, a: order[at], b: order[at + 1], c: order[at + 2] };
      break;
    }
  }
  check("a one-language document has three free sentences in a row", found !== null);
  if (!found) return;
  const { doc, a, b, c } = found;
  const readView = () => getJson(`/documents/${doc.id}/view`);
  const isActive = (view, id) => view.units.some((unit) => unit.id === id);
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const pointOn = async (id) => {
    await pieceOf(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const dragOnto = async (fromId, toId) => {
    const from = await pointOn(fromId);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 5 });
    const to = await pointOn(toId);
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(100);
    return page.evaluate(() => ({
      note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
      dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
      refused: document.querySelector('[data-testid="drag-card"]')?.hasAttribute("data-refused") ?? false,
    }));
  };
  const edits = [];
  page.on("request", (request) => {
    if (/\/documents\/\d+\/edits$/.test(new URL(request.url()).pathname)) edits.push(request.postData());
  });

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await pieceOf(a.id).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");

  // 1. 떨어진 같은 언어(a → c) - 까닭, 놓아도 쓰지 않는다
  const overFar = await dragOnto(a.id, c.id);
  const farDrop = await pieceOf(c.id).getAttribute("data-drop");
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("a over c (two boxes down) is refused: only neighbours merge", overFar.refused && overFar.note === "Only sentences next to each other can be merged." && farDrop === "refused", JSON.stringify({ overFar, farDrop }));
  check("the refused drop writes nothing", edits.length === 0 && isActive(await readView(), a.id) && isActive(await readView(), c.id), String(edits.length));

  // 2. 이웃(b → a) - Merge with a, → merge. 놓으면 용지 순서대로 [a, b]를 합친다
  const overNear = await dragOnto(b.id, a.id);
  check("b over its neighbour a says Merge with a and ends with → merge", !overNear.refused && overNear.note === `Merge with ${a.display_id}` && overNear.dest === "→ merge" && (await pieceOf(a.id).getAttribute("data-drop")) === "over", JSON.stringify(overNear));
  const merged = page.waitForResponse((response) => /\/edits$/.test(new URL(response.url()).pathname), { timeout: T });
  await page.mouse.up();
  check("the drop merges [a, b] (200)", (await merged).status() === 200 && JSON.stringify(JSON.parse(edits.at(-1)).op) === JSON.stringify({ type: "merge", unit_ids: [a.id, b.id] }), edits.at(-1));
  await page.locator('[data-testid="toast-ok"]', { hasText: "Merged" }).waitFor({ timeout: T });
  const afterMerge = await readView();
  check("a and b are one box now", !isActive(afterMerge, a.id) && !isActive(afterMerge, b.id) && afterMerge.units.some((unit) => unit.text.startsWith(a.text.slice(0, 10)) && unit.text.endsWith(b.text.slice(-10))));
  await page.waitForLoadState("networkidle");

  // 3. Ctrl+Z가 합치기를 되돌린다 - 옛 ID 그대로
  const undone = page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z undoes the merge (200)", (await undone).status() === 200);
  const afterUndo = await readView();
  check("a and b are back with their own ids", isActive(afterUndo, a.id) && isActive(afterUndo, b.id));
  await page.waitForLoadState("networkidle");
});

// 언어를 바꾸면 모양도(B6-3, 사용자 결정 2026-11-20 3-a · 3-c) - 이웃 짝의 한쪽을 같은 언어로 바꾸면 합치고, 합친 박스의 끝 조각을 다른 언어로 바꾸면 다시 짝,
// 떨어진 짝은 짝만 푼다. 알림은 무엇이 됐는지 말하고, Ctrl+Z가 한 단계씩 처음 모양(옛 ID · 짝)으로 돌린다 - 끝나면 시드 그대로다
await runStep("assign: a language change merges a neighbour pair, a merged box's end piece splits back into the pair, a far pair only separates; Ctrl+Z steps back", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  const isFree = (unit) => unit.kind === "sentence" && !unit.noise_kind && (unit.status === null || unit.status === "unassigned");
  // 이웃 짝(연달아 배치)과 떨어진 짝(따로 배치 - 한글 반쪽과 영어 반쪽의 짝) - 두 구성원 모두 미배정 문장
  const findPair = async (layout, isNear) => {
    for (const item of (await getJson("/documents")).filter((doc) => doc.side === "old" && doc.status === "ready" && doc.language_layout === layout)) {
      const view = await getJson(`/documents/${item.id}/view`);
      const order = view.units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
      const hit = view.pairs.find((pair) => {
        const at = pair.unit_ids.map((id) => order.findIndex((unit) => unit.id === id)).sort((a, b) => a - b);
        return at.length === 2 && at.every((index) => index >= 0 && isFree(order[index])) && (at[1] - at[0] === 1) === isNear && new Set(at.map((index) => order[index].lang)).size === 2;
      });
      if (hit) {
        const [ko, en] = hit.unit_ids.map((id) => order.find((unit) => unit.id === id)).sort((a) => (a.lang === "ko" ? -1 : 1));
        return { doc: item, pair: hit, ko, en };
      }
    }
    return null;
  };
  // 떨어진 짝은 시드에 없다 - 짝 없는 문장끼리 API로 맺고(끝에 풀어 시드 그대로) 연다
  const makeFarPair = async () => {
    for (const item of (await getJson("/documents")).filter((doc) => doc.side === "old" && doc.status === "ready" && doc.language_layout === "ko_en_interleaved")) {
      const view = await getJson(`/documents/${item.id}/view`);
      const order = view.units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
      const loose = order.filter((unit) => isFree(unit) && unit.pair_id === null);
      const ko = loose.find((unit) => unit.lang === "ko");
      const en = ko ? loose.find((unit) => unit.lang === "en" && Math.abs(order.indexOf(unit) - order.indexOf(ko)) > 1) : undefined;
      if (!ko || !en) continue;
      const made = await page.request.post(`${api}/documents/${item.id}/pairs`, { headers, data: { revision: view.document.revision, unit_ids: [ko.id, en.id] } });
      if (made.status() === 201) return { doc: item, pair: (await made.json()).pair, ko, en };
    }
    return null;
  };
  const found = await findPair("ko_en_interleaved", true);
  const far = await makeFarPair();
  check("the seed has a free neighbour KO/EN pair, and two loose far sentences pair by the API", found !== null && far !== null);
  if (!found || !far) return;
  const { doc, pair, ko, en } = found;
  const readView = () => getJson(`/documents/${doc.id}/view`);
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const edits = [];
  page.on("request", (request) => {
    if (/\/documents\/\d+\/edits$/.test(new URL(request.url()).pathname)) edits.push(JSON.parse(request.postData()));
  });
  const editDone = () => page.waitForResponse((response) => /\/edits$/.test(new URL(response.url()).pathname), { timeout: T });
  const undoDone = () => page.waitForResponse((response) => response.url().includes("/decisions/undo"), { timeout: T });
  const openMenu = async (unitId) => {
    await pieceOf(unitId).scrollIntoViewIfNeeded();
    await pieceOf(unitId).click({ button: "right" });
    await wait(page, "assign-ctx-menu");
  };
  const toastOk = (text) => page.locator('[data-testid="toast-ok"]', { hasText: text });

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await pieceOf(ko.id).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");

  // 1. EN 쪽을 KO로 - 이웃이라 합친다
  await openMenu(en.id);
  let done = editDone();
  await page.locator('[data-testid="assign-ctx-lang-ko"]').click();
  check("KO on the English member merges the neighbour pair in one edit (200)", (await done).status() === 200 && JSON.stringify(edits.at(-1).op) === JSON.stringify({ type: "switch_language", unit_id: en.id, lang: "ko", merge_pair: true }) && edits.at(-1).confirm === true, JSON.stringify(edits.at(-1)));
  await toastOk("Merged the pair").waitFor({ timeout: T });
  let view = await readView();
  const merged = view.units.find((unit) => unit.can_unmerge && unit.text.startsWith(ko.text.slice(0, 8)));
  check("the pair is one Korean box now, its pieces listed", merged !== undefined && merged.lang === "ko" && !view.units.some((unit) => unit.id === ko.id || unit.id === en.id) && JSON.stringify(merged.merge_pieces) === JSON.stringify([ko.text, en.text]), JSON.stringify(merged?.merge_pieces));
  await page.waitForLoadState("networkidle");

  // 2. 합친 박스의 끝 조각을 EN으로 - 다시 짝(옛 ID)
  await openMenu(merged.id);
  check("the merged box lists each piece", (await page.locator('[data-testid^="assign-ctx-piece-"][role="group"]').count()) === 2);
  done = editDone();
  await page.locator('[data-testid="assign-ctx-piece-1-en"]').click();
  check("EN on the last piece splits it off (200)", (await done).status() === 200 && JSON.stringify(edits.at(-1).op) === JSON.stringify({ type: "switch_language", unit_id: merged.id, lang: "en", piece: 1 }), JSON.stringify(edits.at(-1)));
  await toastOk("Split into a KO/EN pair").waitFor({ timeout: T });
  view = await readView();
  const again = view.pairs.find((item) => item.unit_ids.includes(ko.id));
  check("the two boxes are back with their own ids as one KO/EN pair", again !== undefined && JSON.stringify([...again.unit_ids].sort()) === JSON.stringify([ko.id, en.id].sort()) && view.units.find((unit) => unit.id === en.id)?.lang === "en");
  await page.waitForLoadState("networkidle");

  // 3. Ctrl+Z 두 번 - 합친 박스로, 다시 처음 짝으로(같은 짝 id · 상태)
  let undone = undoDone();
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z brings the merged box back (200)", (await undone).status() === 200 && (await readView()).units.some((unit) => unit.id === merged.id));
  await page.waitForLoadState("networkidle");
  undone = undoDone();
  await page.keyboard.press("ControlOrMeta+z");
  check("Ctrl+Z again brings the first pair back as it was", (await undone).status() === 200 && JSON.stringify((await readView()).pairs.find((item) => item.id === pair.id)) === JSON.stringify(pair), JSON.stringify((await readView()).pairs.find((item) => item.id === pair.id)));
  await page.waitForLoadState("networkidle");

  // 4. 떨어진 짝(따로 배치 문서) - EN 쪽을 KO로: 짝만 푼다
  const readFar = () => getJson(`/documents/${far.doc.id}/view`);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${far.doc.id}"]`).click();
  await pieceOf(far.en.id).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  await openMenu(far.en.id);
  done = editDone();
  await page.locator('[data-testid="assign-ctx-lang-ko"]').click();
  check("KO on a far pair member only separates (200)", (await done).status() === 200 && edits.at(-1).op.merge_pair === false, JSON.stringify(edits.at(-1)));
  await toastOk("Separated the pair — they are apart, so not merged").waitFor({ timeout: T });
  view = await readFar();
  check("the far member is Korean and the pair is gone", view.units.find((unit) => unit.id === far.en.id)?.lang === "ko" && !view.pairs.some((item) => item.id === far.pair.id));
  await page.waitForLoadState("networkidle");
  undone = undoDone();
  await page.keyboard.press("ControlOrMeta+z");
  const farUndo = await undone;
  view = await readFar();
  check("Ctrl+Z brings the far pair and the language back", farUndo.status() === 200 && view.units.find((unit) => unit.id === far.en.id)?.lang === "en" && JSON.stringify(view.pairs.find((item) => item.id === far.pair.id)?.unit_ids) === JSON.stringify(far.pair.unit_ids), JSON.stringify({ status: farUndo.status(), body: await farUndo.text(), lang: view.units.find((unit) => unit.id === far.en.id)?.lang, pair: view.pairs.find((item) => item.unit_ids.includes(far.ko.id)), want: far.pair }));
  await page.waitForLoadState("networkidle");
  // 뒷정리 - API로 맺은 떨어진 짝을 푼다
  await page.request.delete(`${api}/documents/${far.doc.id}/pairs/${far.pair.id}?revision=${view.document.revision}`, { headers });
});

// 짝 카드 안 순서(설계 2026-11-20-assign-mockup1 D8) - 고른 박스 왼쪽 손잡이를 끌어 짝 위로 놓으면 순서가 바뀌고(편집 reorder_pair) Undo가 되돌린다.
// 박스 전체 끌기는 손잡이 누름을 받지 않는다(상태 글이 순서 옮기기다). 끝나면 pair_seq가 비어 시드가 처음 그대로다
await runStep("assign: the grip reorders a pair card, Undo restores it", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const getJson = async (path) => (await page.request.get(`${api}${path}`, { headers })).json();
  const sourceOrder = (one, two) => one.pos_seq - two.pos_seq || (one.spans[0]?.[1] ?? 0) - (two.spans[0]?.[1] ?? 0) || one.id - two.id;
  // 위아래로 붙은 미배정 한/영 문장 둘의 짝 - 카드 하나
  const findCard = (view) => {
    const order = view.units.filter((unit) => unit.group_unit_id === null).sort(sourceOrder);
    const isFree = (unit) => unit.kind === "sentence" && (unit.status === null || unit.status === "unassigned") && (unit.pair_seq ?? null) === null;
    for (const pair of view.pairs) {
      const members = pair.unit_ids.map((id) => order.findIndex((unit) => unit.id === id)).sort((one, two) => one - two);
      if (members.length !== 2 || members[0] < 0 || members[1] - members[0] !== 1) continue;
      const [upper, lower] = members.map((index) => order[index]);
      if (isFree(upper) && isFree(lower) && upper.lang !== lower.lang) return { pair, upper, lower };
    }
    return null;
  };
  let doc = null;
  let card = null;
  for (const item of (await getJson("/documents")).filter((entry) => entry.side === "old" && entry.status === "ready" && entry.language_layout === "ko_en_interleaved")) {
    card = findCard(await getJson(`/documents/${item.id}/view`));
    if (card) {
      doc = item;
      break;
    }
  }
  check("an interleaved document has an open KO/EN pair card", card !== null, doc?.doc_code ?? "none");
  if (!card) return;
  const { pair, upper, lower } = card;
  const readView = () => getJson(`/documents/${doc.id}/view`);
  const seqOf = (view, unit) => view.units.find((entry) => entry.id === unit.id)?.pair_seq ?? null;
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  // 위 박스가 아래 박스보다 용지에서 먼저 오나
  const isUpperFirst = () => page.evaluate(([one, two]) => {
    const first = document.querySelector(`[data-testid="assign-paper-piece-${one}"]`);
    const second = document.querySelector(`[data-testid="assign-paper-piece-${two}"]`);
    return first !== null && second !== null && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [upper.id, lower.id]);
  const isEditCall = (pattern) => (response) => response.request().method() === "POST" && pattern.test(new URL(response.url()).pathname);

  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  await pieceOf(lower.id).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  check("the card shows the upper box first", await isUpperFirst());

  // 아래 박스를 고르면 그 박스 왼쪽에 손잡이
  await pieceOf(lower.id).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await pieceOf(lower.id).click();
  const grip = page.locator(`[data-testid="assign-paper-grip-${lower.id}"]`);
  await grip.waitFor({ timeout: T });
  check("the picked box in the pair card has a grip, its partner has none", (await page.locator(`[data-testid="assign-paper-grip-${upper.id}"]`).count()) === 0);

  // 손잡이를 위 박스 위쪽으로 끈다 - 상태 글은 카드 안 옮기기, 끝은 "→ order", 놓일 자리 선
  const from = await grip.boundingBox();
  const to = await pieceOf(upper.id).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, to.y + 3, { steps: 12 });
  await page.waitForTimeout(100);
  const during = await page.evaluate(() => ({
    note: document.querySelector('[data-testid="drag-status"]')?.textContent ?? "",
    dest: document.querySelector('[data-testid="drag-card"] .drag-card-dest')?.textContent ?? "",
    line: !(document.querySelector('[data-testid="drop-line"]')?.hidden ?? true),
  }));
  check("dragging the grip says Move inside the pair card, → order, with a drop line", during.note === "Move inside the pair card" && during.dest === "→ order" && during.line, JSON.stringify(during));
  const edited = page.waitForResponse(isEditCall(/\/documents\/\d+\/edits$/), { timeout: T });
  await page.mouse.up();
  const response = await edited;
  const op = JSON.parse(response.request().postData()).op;
  check("the drop sends reorder_pair with the lower box first (200)", response.status() === 200 && op.type === "reorder_pair" && op.pair_id === pair.id && JSON.stringify(op.unit_ids) === JSON.stringify([lower.id, upper.id]), `${response.status()} ${JSON.stringify(op)}`);
  await page.waitForLoadState("networkidle");
  const flipped = await page.waitForFunction(([one, two]) => {
    const first = document.querySelector(`[data-testid="assign-paper-piece-${one}"]`);
    const second = document.querySelector(`[data-testid="assign-paper-piece-${two}"]`);
    return first !== null && second !== null && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [lower.id, upper.id], { timeout: T }).then(() => true, () => false);
  const after = await readView();
  check("the card now shows the lower box first", flipped);
  check("the view API orders the card lower → upper", seqOf(after, lower) === 0 && seqOf(after, upper) === 1, JSON.stringify([seqOf(after, lower), seqOf(after, upper)]));

  // Undo가 원문 순서로 되돌린다 - pair_seq가 비어 시드가 처음 그대로다
  const undone = page.waitForResponse(isEditCall(/\/decisions\/undo$/), { timeout: T });
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo answers 200", (await undone).status() === 200);
  await page.waitForLoadState("networkidle");
  const restored = await page.waitForFunction(([one, two]) => {
    const first = document.querySelector(`[data-testid="assign-paper-piece-${one}"]`);
    const second = document.querySelector(`[data-testid="assign-paper-piece-${two}"]`);
    return first !== null && second !== null && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [upper.id, lower.id], { timeout: T }).then(() => true, () => false);
  const back = await readView();
  check("after Undo the card shows the upper box first again", restored);
  check("after Undo the view API has no card order", seqOf(back, lower) === null && seqOf(back, upper) === null);
});

// AI는 제안만 한다(설계 2026-11-19-ai-suggest-only) - 그림의 분류 추천은 카드로 오고, 사람이 Use(A)로 받으면 그림 아래 캡션이 초안에 함께 따라온다
await runStep("assign: an AI-suggested figure takes its caption along when used", { drafting: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = (path, body) => (body === undefined ? page.request.get(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers }) : page.request.post(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers, data: body }));
  const status = await api("/ai/status");
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  // 캡션 단위가 딸린 미배정 그림 - 분류 추천이 없으면 요청한다(첫 진입 미리 분류가 이미 했으면 그대로 쓴다)
  const units = (await (await api("/units?limit=1000")).json()).items;
  const caption = units.find((unit) => unit.kind === "caption" && units.some((other) => other.unit_id === unit.group_unit_id && other.kind === "figure" && other.status === "unassigned"));
  check("the fresh bundle has an open figure with a caption", Boolean(caption));
  if (!caption) return;
  const figure = units.find((unit) => unit.unit_id === caption.group_unit_id);
  const readLive = async () => (await (await api("/ai/suggestions?kind=classify&result=applied&limit=500")).json()).items.find((item) => item.adoption === null && (item.content.unit_ids ?? []).includes(figure.unit_id));
  if (!(await readLive())) await api("/ai/classify", { unit_ids: [figure.unit_id] });
  for (let tries = 0; tries < 60; tries += 1) {
    const jobs = (await (await api("/ai/status")).json()).jobs;
    if (jobs.queued + jobs.running === 0) break;
    await page.waitForTimeout(500);
  }
  const suggestion = await readLive();
  const figureNow = (await (await api("/units?limit=1000")).json()).items.find((unit) => unit.unit_id === figure.unit_id);
  check("the AI suggestion for the figure waits as a card - the figure stays unassigned", Boolean(suggestion) && figureNow?.status === "unassigned", figureNow?.status);
  if (!suggestion) return;
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  // 그림은 그림 탭에서 고른다(시안 2 D3)
  await openFigures(page, figure.document_id);
  await selectRowById(page, figure.display_id);
  await page.locator('[data-testid^="assign-rec-"] .dest-chip[data-source="ai"]').first().waitFor({ timeout: T });
  await page.keyboard.press("Shift+A");
  const line = page.locator(`[data-testid="assign-caption-${caption.lang}"]`);
  await line.waitFor({ timeout: T });
  check("Use puts the figure's caption in the decide box", (await line.innerText()).trim() === caption.text.trim(), await line.innerText());
  const primary = page.locator('[data-testid="assign-primary"]');
  check("Confirm is on for a captioned figure", await primary.isEnabled());
  await takeShot("sop-assign-ai-figure-caption.png");
  await primary.click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  const targets = (await (await api(`/groups/by-unit/${figure.unit_id}`)).json()).targets;
  const figureTarget = targets.find((target) => target.kind === "figure");
  const saved = targets.find((target) => target.source_unit_ids.includes(caption.unit_id));
  check("the caption is confirmed in place under the figure", saved?.status === "confirmed" && figureTarget !== undefined && saved.parent_target_id === figureTarget.id, saved?.status);
  const taken = (await (await api(`/ai/suggestions/${suggestion.id}`)).json()).adoption;
  check("the used suggestion counts as taken as is", taken === "as_is", taken);
});

// 배정 화면 첫 진입 - PREPARE=1일 때만(머리말의 전제). 자동 칸 추천은 숨겨 두어 돌지 않는다(쪼개기 먼저 설계 §14 승인): 쌓인 분류가 없고 알림 · Background 줄 · 분류 제안이 없으며,
// 묶기 계획은 그대로 돌아 AI suggested 수는 잇기 제안에서만 나온다
await runStep(PREPARE_STEP, {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  const bundleId = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${bundleId}${path}`, { headers })).json();
  const status = await getJson("/ai/status");
  check("backend has AI on (PREPARE=1 needs the fake AI and AI_AUTO_PREPARE=true)", status.ai_enabled === true);
  const before = await getJson("/ai/suggestions?kind=classify");
  check("no AI suggestion before the first entry", before.total === 0, String(before.total));

  const prepared = page.waitForResponse((response) => /\/ai\/prepare$/.test(new URL(response.url()).pathname), { timeout: T });
  await page.goto(`${BASE}/bundles/${bundleId}/assign`);
  const out = await (await prepared).json();
  check("the first entry queues no classify job", out.queued === 0, JSON.stringify(out));
  // 묶기 계획은 저절로 선다 - 다 끝난 뒤에 본다
  let jobs = (await getJson("/ai/status")).jobs;
  for (let step = 0; step < 60 && jobs.queued + jobs.running > 0; step += 1) {
    await page.waitForTimeout(1000);
    jobs = (await getJson("/ai/status")).jobs;
  }
  check("no toast says the remaining rows are classified", (await page.locator('[data-testid="toast-ok"]', { hasText: "in the background" }).count()) === 0);

  await page.locator('[data-testid="top-bar-ai"]').click();
  await wait(page, "ai-jobs-popover");
  check("the AI job list has no Background request", (await page.locator('[data-testid="ai-jobs-popover"] [data-testid^="ai-jobs-request-"][data-testid$="-background"]').count()) === 0);
  await takeShot("sop-assign-prepare-popover.png");
  await page.keyboard.press("Escape");
  const after = await getJson("/ai/suggestions?kind=classify");
  check("no classify suggestion after the jobs finish", after.total === 0, String(after.total));

  // AI suggested 칩의 수는 잇기 제안이 덮는 줄뿐이다 - 제안이 없으면 0(칩이 없거나 수가 빈다)
  await page.reload();
  await wait(page, "assign-bar");
  await page.waitForLoadState("networkidle");
  const matched = (await getJson("/ai/suggestions?kind=match&result=applied&limit=500")).items.filter((item) => item.adoption === null).flatMap((item) => item.content.unit_ids ?? []).length;
  const count = page.locator('[data-testid="assign-filter-ai_suggested"] .schip-n');
  const shown = (await count.count()) === 0 ? 0 : Number((await count.textContent()) || 0);
  check("the AI suggested count comes from match suggestions only", matched === 0 ? shown === 0 : shown > 0 && shown <= matched, `${shown} of ${matched}`);
  await takeShot("sop-assign-prepare-done.png");
});
}
