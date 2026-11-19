// SOP smoke steps for the documents screen(s), in their original order. Run through ../pw-smoke-sop.mjs (ONLY="<prefix>").
// Step bodies sit at column 0 inside run() on purpose: they moved verbatim, and re-indenting would change multi-line strings.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCRIPT_DIR,
  BASE,
  SHOT_DIR,
  T,
  VIEWPORT,
  check,
  runStep,
  wait,
  getText,
  getBox,
  installCommitCounter,
  halfBundleId,
  freshBundleId,
  readToBe,
  WI_LIST_KEY,
  readOutline,
  findRemovableChapter,
} from "./common.mjs";



// 일부러 거절당하는 저장이 있어 콘솔 오류를 허용한다
// New 문서 목록은 칸마다 바로 저장한다(v1.0.33) - Save 단추와 초안이 없다. 떠나거나 Enter를 누르면 그 칸이 저장된다
const settleToBe = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-testid="tobe-saving"]')?.textContent === "", null, { timeout: T });
  await page.waitForLoadState("networkidle");
};

// N/A 칸 상태 표(Documents 화면 설계 §8) - 칸마다 상태를 먼저 보이고, N/A는 사유와 함께 Save N/A로만 저장된다. 편집기는 화면에 하나이고 접거나 떠나도 사유가 남는다.
// 거절 응답(409·500)이 콘솔에 찍혀 콘솔 오류를 허용한다. 만든 N/A는 끝에 API로도 지워 처음 수로 되돌린다
// 회사 SOP 템플릿의 아홉 장(backend outline.TEMPLATE_OUTLINE의 최상위 항목). 그 아래 항목(범주 · 절차 · 부록)은 문서마다 달라
// 번호 · 위계와 함께 서버가 준 그 문서의 골격(ToBe.outline_items)에서 읽는다 - 화면도 같은 값을 그린다
const TEMPLATE_CHAPTERS = ["purpose", "scope", "definitions", "responsibilities", "general_requirements", "procedures", "document_relationships", "attachments", "appendices"];
const ASSOCIATED_KEY = "document_relationships.associated_documents";
const slotNumber = (item) => (item.shows_number ? (item.number ?? "") : "");
/** "번호 이름" - 번호 없는 항목은 이름만, 부록은 번호가 든 이름(label "Appendix n. 제목")만. 화면의 formatSlotName과 같은 글 */
const slotName = (item) => (item.shows_number ? [item.number, item.title_en].filter(Boolean).join(" ") : item.label);
/** 결과물 C · 엮은 문서의 절이 문장을 받는가 - 하위만 묶는 절(group)과 앱이 채우는 절(auto_list)은 줄이 없어도 빈 칸이 아니다(서버 422 slot_not_assignable) */

// New 목록의 두 줄 줄(Documents 화면 설계 §4·§6) - 줄은 글자로 읽고, 누르거나 Enter로 펼친 곳에서 고친다. 줄 끝 단추는 올리거나 포커스가 들어올 때만 보이고 좁은 틀에서는 ⋯ 메뉴 하나다
const TOBE_ROWS = '[data-testid="tobe-list"] [data-testid^="tobe-id-"][data-testid$="-row"]';
// API 목록의 보이는 순서(SOP마다 그 아래 WI, 부모 없는 WI는 끝) - 화면의 orderDocs와 따로 센다
const orderToBe = (docs) => {
  const sops = docs.filter((doc) => doc.doc_type === "sop");
  const sopCodes = new Set(sops.map((doc) => doc.code));
  return [
    ...sops.flatMap((sop) => [{ doc: sop, child: false }, ...docs.filter((doc) => doc.doc_type === "wi" && doc.parent_code === sop.code).map((doc) => ({ doc, child: true }))]),
    ...docs.filter((doc) => doc.doc_type === "wi" && !sopCodes.has(doc.parent_code)).map((doc) => ({ doc, child: false })),
  ];
};
// 숨는 단추는 opacity만 바꾸고 전환이 있다 - 그 값이 될 때까지 기다린다
const waitOpacityOf = (page, testId, value) =>
  page.waitForFunction(({ id, v }) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el !== null && Number(getComputedStyle(el).opacity) === v;
  }, { id: testId, v: value }, { timeout: 2000 }).then(() => true, () => false);
const blurAll = (page) => page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));

// 합성 SOP 파일을 .shots/synthetic에 만든다 - 저장소에 사본을 두면 OS마다 PNG 압축 바이트가 달라 어긋난다.
// BACKEND_PYTHON - venv가 없는 워크트리에서 다른 체크아웃의 venv python을 절대 경로로 쓴다(링크를 만들지 않게)
function buildSyntheticFiles() {
  const backend = resolve(SCRIPT_DIR, "../../../backend");
  const out = resolve(SHOT_DIR, "synthetic");
  const python = process.env.BACKEND_PYTHON || [".venv/bin/python", ".venv/Scripts/python.exe"].map((path) => resolve(backend, path)).find(existsSync);
  if (!python) throw new Error(`backend venv python not found under ${backend}/.venv (or set BACKEND_PYTHON)`);
  execFileSync(python, ["-c", "import sys; from pathlib import Path; from scripts.synthetic_sop import build_synthetic_bundle; build_synthetic_bundle(Path(sys.argv[1]))", out], { cwd: backend, stdio: "inherit" });
  return out;
}

// 올리기 창의 두 묶음(Documents 화면 설계 §9) - 고른 파일은 Old · New 묶음으로 나뉘어 보이고, 쪽은 단추 · 줄 끌기 · 묶음에 파일 놓기로 정한다.
// 아래 두 단계는 저마다 새 묶음(New 목록에 SOP-01과 그 아래 WI-05)에서 하고 끝에 그 묶음을 지운다
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UPLOAD_SAMPLES = {
  old6: "SYNTHETIC_OLD-6_Hanil_Centrifuge_Cleaning.docx",
  wi05: "SYNTHETIC_WI-05_Hanil_Centrifuge_Cleaning.docx",
  wi04: "SYNTHETIC_WI-04_Labogene_Centrifuge_Operation.docx",
};
async function openUploadBundle(page, title) {
  const samples = buildSyntheticFiles();
  const headers = { "X-Dev-User": "dev.admin", "Content-Type": "application/json" };
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title, is_synthetic: true } })).json();
  const docs = [{ code: "SOP-01", doc_type: "sop", title: "Synthetic SOP" }, { code: "WI-05", doc_type: "wi", parent_code: "SOP-01", title: "Synthetic listed WI" }];
  const listed = await page.request.put(`${BASE}/api/bundles/${created.id}/tobe`, { headers, data: { revision: created.revision, docs, na_slots: [], wi_steps: [{ code: "WI-05", step_no: 1, title: "Clean" }] } });
  check("a new bundle with two listed New documents is ready", listed.ok());
  return {
    id: created.id,
    headers,
    // 합성 표본은 읽어서, 지어낸 파일은 글자로 준다 - setInputFiles는 경로와 버퍼를 한 번에 섞어 받지 않는다
    sample: (name) => ({ name, mimeType: DOCX_MIME, buffer: readFileSync(`${samples}/${name}`) }),
    made: (name, text = name) => ({ name, mimeType: DOCX_MIME, buffer: Buffer.from(text) }),
    // 문서가 없는 묶음의 Documents 화면에서 올리기 창을 연다
    openWindow: async () => {
      await wait(page, "documents-empty-upload");
      await page.locator('[data-testid="documents-empty-upload"]').click();
      await wait(page, "upload-picked");
    },
    remove: async () => {
      const bundle = await (await page.request.get(`${BASE}/api/bundles/${created.id}`, { headers })).json();
      await page.request.delete(`${BASE}/api/bundles/${created.id}?revision=${bundle.revision}`, { headers });
    },
  };
}

export async function run() {

// Old 목록의 두 줄 줄(Documents 화면 설계 §4·§5) - 줄은 글자로 읽고, 누르거나 Enter로 펼친 곳에서 고친다. 제목은 Assign 한 단 보기로 가는 링크, 줄 끝 단추는 올리거나 포커스가 들어올 때만
await runStep("documents: Old rows read in two lines, expand to edit, delete prompt", {}, async ({ page, takeShot }) => {
  const OLD_ROWS = '[data-testid="documents-list"] [data-testid^="documents-"][data-testid$="-row"]';
  const LAYOUT_NAMES = { ko_en_interleaved: "KO/EN interleaved", ko_en_separate: "KO/EN separate", en_only: "English only", ko_only: "Korean only" };
  // 숨는 단추는 opacity만 바꾸고 전환이 있다 - 그 값이 될 때까지 기다린다(뒤 단계의 waitOpacityOf는 이 단계 뒤에 선언된다)
  const opacityBecomes = (testId, value) =>
    page.waitForFunction(({ id, v }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el !== null && Number(getComputedStyle(el).opacity) === v;
    }, { id: testId, v: value }, { timeout: 2000 }).then(() => true, () => false);
  const apiDocs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const expected = [...apiDocs.filter((doc) => doc.side === "old"), ...apiDocs.filter((doc) => doc.side === "new" && doc.target_doc_id === null)];
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(OLD_ROWS).first().waitFor({ timeout: T });
  check("documents is the current step", (await page.locator('[data-testid="stage-nav-documents"]').getAttribute("aria-current")) === "page");
  // 1. 표가 아니다 - 줄 수와 머리의 수, 닫힌 줄에는 고치는 칸이 없다
  check("the Old list is not a table", (await page.locator('[data-testid="documents-list"] table').count()) === 0);
  check(
    "one row per Old document (and New file without a row), and the head counts them",
    (await page.locator(OLD_ROWS).count()) === expected.length && (await getText(page, "documents-old-count")).trim() === String(expected.length),
    `${await page.locator(OLD_ROWS).count()} rows, head ${await getText(page, "documents-old-count").catch(() => "none")}, api ${expected.length}`,
  );
  check("a closed row has no field to edit", (await page.locator(`[data-testid="documents-list"] :is(input, select, [role='combobox'])`).count()) === 0);
  // 정상 상태는 글자 없이 아이콘(aria-label "Ready"/"Checked", data-state="ok"), 예외만 글자 알약
  const okStatus = page.locator('[data-testid^="documents-"][data-testid$="-status"][data-state="ok"]').first();
  check("extraction status icon reads Ready", (await okStatus.getAttribute("aria-label")) === "Ready");
  // 2. 줄의 값 - 첫 읽힌 문서
  const first = expected.find((doc) => doc.status === "ready");
  const docId = first.id;
  const prefix = `documents-${docId}`;
  const firstRow = page.locator(`[data-testid="${prefix}-row"]`);
  const textOf = async (testId) => ((await page.locator(`[data-testid="${testId}"]`).first().textContent()) ?? "").trim();
  check(
    "the row reads the number, the version, the language layout and the file",
    (await textOf(`${prefix}-code-text`)) === (first.doc_code || "No number") &&
      (await textOf(`${prefix}-version-text`)) === (first.doc_version ? `v${first.doc_version}` : "No version") &&
      (await textOf(`${prefix}-layout-text`)) === LAYOUT_NAMES[first.language_layout] &&
      (await textOf(`${prefix}-file`)) === first.file_name,
    `${await textOf(`${prefix}-code-text`)} | ${await textOf(`${prefix}-version-text`)} | ${await textOf(`${prefix}-layout-text`)} | ${await textOf(`${prefix}-file`)}`,
  );
  // 3. 펼치기 - 딸린 정보 글을 누르면 열리고 다시 누르면 닫힌다. Enter로도 열고 닫힌다
  const panel = page.locator(`[data-testid="${prefix}-panel"]`);
  const toggle = page.locator(`[data-testid="${prefix}-toggle"]`);
  await page.locator(`[data-testid="${prefix}-layout-text"]`).click();
  await panel.waitFor({ timeout: T });
  check("clicking the row's meta line opens it, the chevron reads Details", (await panel.isVisible()) && (await toggle.getAttribute("aria-label")) === "Details" && (await toggle.getAttribute("aria-expanded")) === "true");
  await page.locator(`[data-testid="${prefix}-layout-text"]`).click();
  await panel.waitFor({ state: "detached", timeout: T });
  check("clicking it again closes it", (await toggle.getAttribute("aria-expanded")) === "false");
  await firstRow.focus();
  await page.keyboard.press("Enter");
  await panel.waitFor({ timeout: T });
  check("Enter on the row opens it", (await toggle.getAttribute("aria-expanded")) === "true");
  await page.keyboard.press("Enter");
  await panel.waitFor({ state: "detached", timeout: T });
  check("Enter again closes it", (await toggle.getAttribute("aria-expanded")) === "false");
  await toggle.click();
  await panel.waitFor({ timeout: T });
  // 보조 검사의 정상 아이콘은 펼친 곳에 있다(줄에는 예외만)
  const list = await getText(page, "documents-list");
  const okAux = page.locator('[data-testid^="documents-"][data-testid$="-aux"][data-state="ok"]');
  check("aux check label", (await okAux.count()) > 0 ? (await okAux.first().getAttribute("aria-label")) === "Checked" : list.includes("Aux check unavailable"), list);
  // 버전 칸 - 숫자와 점만 받고, 위 단추는 소수점 아래가 0이면 앞자리를 올린다. 줄의 버전 글이 따라 바뀐다
  const version = page.locator(`[data-testid="${prefix}-version"]`);
  const before = await version.inputValue();
  const rowY = (await firstRow.boundingBox()).y;
  await version.fill("v2.9a");
  check("version keeps only digits and a dot", (await version.inputValue()) === "2.9", await version.inputValue());
  await version.press("Enter");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator(`[data-testid="${prefix}-version-up"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === "2.10", docId, { timeout: T });
  check("version up moves the minor number", true);
  check("row did not move while editing", Math.abs((await firstRow.boundingBox()).y - rowY) < 1);
  const followed = await page.waitForFunction((id) => document.querySelector(`[data-testid="documents-${id}-version-text"]`)?.textContent?.trim() === "v2.10", docId, { timeout: T }).then(() => true, () => false);
  check("the row's version follows the saved value", followed, await textOf(`${prefix}-version-text`));
  await takeShot("sop-documents.png");
  // 되돌린다 - 원래 빈 값이면 x로 비운다
  await version.hover();
  if (before === "") await page.locator(`[data-testid="${prefix}-version-clear"]`).click();
  else {
    await version.fill(before);
    await version.press("Enter");
  }
  await page.waitForFunction(([id, value]) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === value, [docId, before], { timeout: T });
  await toggle.click();
  await panel.waitFor({ state: "detached", timeout: T });
  // 4. 줄 끝 단추 - 평소 숨고, 올리거나 Tab으로 들어오면 보인다. 오른쪽 끝이 줄마다 같다
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.mouse.move(0, 0);
  check("row-end buttons are hidden at rest", await opacityBecomes(`${prefix}-acts`, 0));
  await firstRow.hover();
  check("hovering the row shows them", await opacityBecomes(`${prefix}-acts`, 1));
  await page.mouse.move(0, 0);
  check("leaving the row hides them again", await opacityBecomes(`${prefix}-acts`, 0));
  await firstRow.focus();
  for (let i = 0; i < 12 && (await page.evaluate(() => document.activeElement?.dataset.testid ?? "")) !== `${prefix}-preview`; i += 1) await page.keyboard.press("Tab");
  check("Tab reaches Preview and shows the buttons", (await page.evaluate(() => document.activeElement?.dataset.testid ?? "")) === `${prefix}-preview` && (await opacityBecomes(`${prefix}-acts`, 1)));
  const rights = await page.locator('[data-testid="documents-list"] [data-testid$="-acts"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
  check("every row's buttons end at the same right edge", rights.length > 0 && Math.max(...rights) - Math.min(...rights) <= 1, rights.join(","));
  await page.mouse.move(0, 0);
  await firstRow.hover();
  await page.locator(`[data-testid="${prefix}-delete"]`).click();
  await wait(page, "delete-document");
  await takeShot("sop-documents-delete.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="delete-document"]').waitFor({ state: "detached", timeout: T });
  check("delete prompt closes with Esc", true);
  // 좁은 틀 - 묶음 대신 ⋯ 하나가 같은 일을 메뉴로 한다. 앱 틀은 1120px 아래로 줄지 않아(.app min-width) 창을 줄여서는 목록 틀이 문턱(840px)보다 좁아지지 않는다 -
  // New 목록 단계처럼 목록 틀의 폭만 문턱 아래로 묶어 컨테이너 질의를 본다(문턱이 바뀌면 이 폭도 맞춘다)
  const narrow = await page.addStyleTag({ content: '[data-testid="documents-list"] { max-width: 820px; }' });
  try {
    await page.mouse.move(0, 0);
    check("a narrow list hides the button group", (await firstRow.evaluate((row) => getComputedStyle(row.querySelector(".doc-acts")).display)) === "none");
    await firstRow.hover();
    await page.locator(`[data-testid="${prefix}-more"]`).click();
    await wait(page, `${prefix}-more-menu`);
    const menu = page.locator(`[data-testid="${prefix}-more-menu"]`);
    check(
      "the menu holds Preview, Download and Delete",
      (await menu.locator(`[data-testid="${prefix}-preview-item"]`).count()) === 1 && (await menu.locator(`[data-testid="${prefix}-download-item"]`).count()) === 1 && (await menu.locator(`[data-testid="${prefix}-delete-item"]`).count()) === 1,
    );
    await page.locator(`[data-testid="${prefix}-delete-item"]`).click();
    await wait(page, "delete-document");
    check("Delete in the menu opens the delete prompt", true);
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="delete-document"]').waitFor({ state: "detached", timeout: T });
  } finally {
    await narrow.evaluate((tag) => tag.remove());
  }
  // 5. 빈 값과 받지 못한 파일(Review Focus 4) - 목록 응답을 바꿔 다시 읽는다
  const docsRoute = "**/api/bundles/*/documents";
  // 빈 값은 읽힌 문서에서만 줄에 버전 자리가 있다 - 읽힌 Old 문서 하나와 다른 Old 문서 하나
  const olds = apiDocs.filter((doc) => doc.side === "old");
  const blank = olds.find((doc) => doc.status === "ready");
  const refused = olds.find((doc) => doc.id !== blank.id);
  await page.route(docsRoute, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const patched = body.map((doc) => {
      if (doc.id === blank.id) return { ...doc, doc_code: "", doc_version: "", title: "", ai_meta: null, equis: null };
      if (doc.id === refused.id) return { ...doc, status: "rejected", status_reason: "no_text_layer", extraction: null };
      return doc;
    });
    return route.fulfill({ response, json: patched });
  });
  try {
    await page.reload();
    const blankRow = page.locator(`[data-testid="documents-${blank.id}-row"]`);
    await blankRow.waitFor({ timeout: T });
    check(
      "an Old document with nothing filled reads No number, No version and No title",
      (await textOf(`documents-${blank.id}-code-text`)) === "No number" &&
        (await textOf(`documents-${blank.id}-version-text`)) === "No version" &&
        (await page.locator(`[data-testid="documents-${blank.id}-version-text"]`).evaluate((el) => el.classList.contains("pill"))) &&
        (await textOf(`documents-${blank.id}-title`)) === "No title",
      `${await textOf(`documents-${blank.id}-code-text`)} | ${await textOf(`documents-${blank.id}-version-text`)} | ${await textOf(`documents-${blank.id}-title`)}`,
    );
    check("that row does not overflow", await blankRow.evaluate((row) => row.scrollWidth <= row.clientWidth));
    const refusedPrefix = `documents-${refused.id}`;
    check("a refused file has no chevron", (await page.locator(`[data-testid="${refusedPrefix}-toggle"]`).count()) === 0);
    check("its reason shows under the row", (await textOf(`${refusedPrefix}-reason`)) !== "");
    const refusedButtons = await page.locator(`[data-testid="${refusedPrefix}-acts"] button`).evaluateAll((els) => els.map((el) => el.dataset.testid));
    check("its only row-end button is Delete", JSON.stringify(refusedButtons) === JSON.stringify([`${refusedPrefix}-delete`]), refusedButtons.join(","));
    check("it ends with a Rejected pill", (await textOf(`${refusedPrefix}-status`)) === "Rejected", await textOf(`${refusedPrefix}-status`));
    check("it shows no number and no version", (await page.locator(`[data-testid="${refusedPrefix}-code-text"], [data-testid="${refusedPrefix}-version-text"]`).count()) === 0);
    await page.locator(`[data-testid="${refusedPrefix}-reason"]`).click();
    await page.waitForTimeout(400);
    check("pressing it does not open anything", (await page.locator(`[data-testid="${refusedPrefix}-panel"]`).count()) === 0);
  } finally {
    await page.unroute(docsRoute);
  }
  // 6. 긴 번호(100자, 설계 §5) - 식별 자리 안에서 두 줄로 접혀 잘리고 제목 자리를 밀지 않는다. API로 바꾸고 끝에 되돌린다
  const longTarget = olds.find((doc) => doc.status === "ready" && doc.id !== first.id) ?? first;
  const jsonHeaders = { "X-Dev-User": "qa.member", "Content-Type": "application/json" };
  const docUrl = `${BASE}/api/bundles/${halfBundleId}/documents/${longTarget.id}`;
  const readTarget = async () => (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers: jsonHeaders })).json()).find((doc) => doc.id === longTarget.id);
  const longCode = `SOP-${"LONGNUMBER".repeat(10)}`.slice(0, 100);
  const beforeLong = await readTarget();
  const patchedLong = await (await page.request.patch(docUrl, { headers: jsonHeaders, data: { revision: beforeLong.revision, doc_code: longCode } })).json();
  try {
    check("the API took the 100-character number", patchedLong.doc_code === longCode, String(patchedLong.doc_code));
    await page.reload();
    const longPrefix = `documents-${longTarget.id}`;
    await page.locator(`[data-testid="${longPrefix}-code-text"]`).waitFor({ timeout: T });
    const fit = await page.evaluate((longId) => {
      const rows = [...document.querySelectorAll('[data-testid="documents-list"] .doc-row')];
      const longRow = rows.find((row) => row.dataset.testid === `documents-${longId}-row`);
      // 견줄 보통 줄 - 긴 번호가 아닌 다른 줄(받지 못한 줄도 화살표 자리를 비워 제목이 같은 x다)
      const normalRow = rows.find((row) => row !== longRow);
      const code = document.querySelector(`[data-testid="documents-${longId}-code-text"]`).getBoundingClientRect();
      const column = longRow.querySelector(".doc-id").getBoundingClientRect();
      return {
        codeRight: code.right,
        columnRight: column.right,
        codeHeight: code.height,
        titleLeft: longRow.querySelector(".doc-title").getBoundingClientRect().left,
        normalTitleLeft: normalRow ? normalRow.querySelector(".doc-title").getBoundingClientRect().left : null,
      };
    }, longTarget.id);
    check(
      "a 100-character number stays inside the identity column, at most two lines, and does not push the title",
      fit.normalTitleLeft !== null && fit.codeRight <= fit.columnRight + 0.5 && fit.codeHeight <= 2 * 18 + 1 && Math.abs(fit.titleLeft - fit.normalTitleLeft) <= 1,
      JSON.stringify(fit),
    );
  } finally {
    const current = await readTarget();
    await page.request.patch(docUrl, { headers: jsonHeaders, data: { revision: current.revision, doc_code: beforeLong.doc_code } });
    check("the number is put back", (await readTarget()).doc_code === beforeLong.doc_code);
  }
  // 7. 좁은 줄의 EQUIS 표시 - 딸린 정보 줄이 4단계까지 줄어 글자가 숨어도 단추에 이름이 있고 포커스하면 툴팁으로 뜬다.
  //    로컬은 EQUIS가 꺼져 있을 수 있어 첫 줄에 합성 표시를 얹고, 틀과 딸린 정보 줄을 좁혀 줄어드는 단계를 끝까지 올린다
  const SYNTHETIC_EQUIS = {
    state: "found", refreshing: false, verdict: "ok", reasons: [], notes: [], current: { version: "14.0", status: "Effective", effective_date: "2025-09-17", retired_date: "" },
    in_progress: [], retired: null, number: first.doc_code || "SOP-SYN-1", trail: [], ambiguous: [], name: "Synthetic Name", subtype: "", owning_department: "",
    plant: "", area: "", legacy_numbers: [], equipment_tag: "", doc_url: null, title_locked: false, fetched_at: null,
  };
  await page.route(docsRoute, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({ response, json: body.map((doc) => (doc.id === first.id ? { ...doc, equis: SYNTHETIC_EQUIS } : doc)) });
  });
  // 좁히는 스타일은 다시 읽은 뒤에 넣는다 - 다시 읽으면 넣어 둔 style 태그가 사라진다
  let squeeze = null;
  try {
    await page.reload();
    const marker = page.locator(`[data-testid="${prefix}-equis"]`);
    await marker.waitFor({ timeout: T });
    squeeze = await page.addStyleTag({ content: '[data-testid="documents-list"] { max-width: 820px; } [data-testid="documents-list"] .doc-meta { max-width: 220px; }' });
    const hidden = await page.waitForFunction((id) => {
      const meta = document.querySelector(`[data-testid="documents-${id}-row"] .doc-meta`);
      const text = document.querySelector(`[data-testid="documents-${id}-equis"] .equis-text`);
      return meta?.dataset.fit === "4" && text !== null && getComputedStyle(text).display === "none";
    }, docId, { timeout: T }).then(() => true, () => false);
    check("a squeezed meta line hides the EQUIS text", hidden);
    const name = (await marker.getAttribute("aria-label")) ?? "";
    check("the icon-only EQUIS marker keeps its name", name !== "", name);
    await marker.focus();
    const tip = page.locator('[role="tooltip"]', { hasText: name });
    check("focusing it shows its text as a tooltip", await tip.waitFor({ timeout: 2000 }).then(() => true, () => false));
  } finally {
    if (squeeze !== null) await squeeze.evaluate((tag) => tag.remove());
    await page.unroute(docsRoute);
  }
  // 8. 제목은 링크다 - 그 문서가 Assign 한 단 보기로 열린다
  await page.reload();
  await firstRow.waitFor({ timeout: T });
  await page.locator(`[data-testid="${prefix}-title"]`).click();
  await page.waitForURL(/\/assign/, { timeout: T });
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  check("the title opens the document in the one-document view", (await getText(page, "assign-old-tag")) === "Old" && (await page.locator('[data-testid="assign-new"]').count()) === 0);
  // 뒤 단계들은 양 단에서 시작한다
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await firstRow.waitFor({ timeout: T });
});

// 읽기 전용(검토자 · 검토 대기 묶음) - Old 줄은 펼쳐지고 값은 글자로만 보인다. 고치는 칸 · 지우기 · 올리기가 없고 미리 보기 · 내려받기는 남는다
await runStep("documents: a reviewer reads Old rows, nothing edits", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  const docs = await (await page.request.get(`${BASE}/api/bundles/${reviewId}/documents`, { headers: { "X-Dev-User": "qa.lead" } })).json();
  const ready = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  const prefix = `documents-${ready.id}`;
  await page.goto(`${BASE}/bundles/${reviewId}/documents`);
  await wait(page, `${prefix}-row`);
  await page.locator(`[data-testid="${prefix}-layout-text"]`).click();
  await wait(page, `${prefix}-panel`);
  check("an Old row opens for a reviewer", (await page.locator(`[data-testid="${prefix}-toggle"]`).getAttribute("aria-expanded")) === "true");
  const list = page.locator('[data-testid="documents-list"]');
  check("no field to edit anywhere in the Old list", (await list.locator("input, select, [role='combobox']").count()) === 0);
  check("number and version read as text", ((await getText(page, `${prefix}-code`)).trim() === (ready.doc_code || "No number")) && ((await getText(page, `${prefix}-version`)).trim() === (ready.doc_version || "No version")));
  check("no Delete", (await list.locator('[data-testid$="-delete"]').count()) === 0);
  check("no AI or EQUIS suggestion chips", (await list.locator('[data-testid$="-code-ai"], [data-testid$="-version-ai"], [data-testid$="-version-equis"]').count()) === 0);
  check("Preview and Download stay", (await list.locator(`[data-testid="${prefix}-preview"]`).count()) === 1 && (await list.locator(`[data-testid="${prefix}-download"]`).count()) === 1);
  check("no Upload button", (await page.locator('[data-testid="documents-upload"]').count()) === 0);
});

await runStep("old Edit original addresses open the document in the one-document view", {}, async ({ page, takeShot }) => {
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

await runStep("new documents: nested rows, N/A detail, each cell saves as you leave it", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first().waitFor({ timeout: T });
  const codes = await page.locator('[data-testid$="-code-text"][data-testid^="tobe-id-"]').evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
  check("SOP first, its WIs under it", codes[0] === "SOP-CF" && codes.slice(1).every((code) => code.startsWith("WI-")), codes.join(","));
  check("there is no Save button and no draft bar", (await page.locator('[data-testid="tobe-save"], [data-testid="tobe-dirty"]').count()) === 0);
  const sopRow = page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first();
  const sopKey = (await sopRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${sopKey}-toggle"]`).click();
  await wait(page, `tobe-${sopKey}-slots`);
  check(
    "troubleshooting is N/A with its reason",
    (await page.locator(`[data-testid="tobe-${sopKey}-slot-procedures.troubleshooting"]`).getAttribute("data-state")) === "na" && (await getText(page, `tobe-${sopKey}-na-procedures.troubleshooting-text`)).trim() !== "",
  );
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
  // N/A는 사유를 적어 Save N/A(Enter)로만 저장된다 - Mark N/A만으로는 아무것도 저장되지 않는다
  // 문장이 들지 않은 칸으로 한다(문장이 든 칸은 서버가 N/A를 거절한다) - 9장 Appendices(합성 SOP는 부록이 없다)
  const appendices = `tobe-${sopKey}-na-appendices`;
  const wasNa = (await page.locator(`[data-testid="tobe-${sopKey}-slot-appendices"]`).getAttribute("data-state")) === "na";
  if (!wasNa) {
    await page.locator(`[data-testid="tobe-${sopKey}-slot-appendices"]`).hover();
    await page.locator(`[data-testid="${appendices}-mark"]`).click();
    await wait(page, `${appendices}-reason`);
    const countNa = async () => (await readToBe(page, halfBundleId)).na_slots.filter((slot) => slot.slot_key === "appendices").length;
    check("Mark N/A saves nothing before its reason", (await countNa()) === 0);
    await page.locator(`[data-testid="${appendices}-reason"]`).fill("Smoke: covered elsewhere");
    await page.keyboard.press("Enter");
    await settleToBe(page);
    check("the reason saves the N/A section", (await countNa()) === 1);
    await page.locator(`[data-testid="tobe-${sopKey}-slot-appendices"]`).hover();
    await page.locator(`[data-testid="${appendices}-restore"]`).click();
    await settleToBe(page);
    check("Restore removes it at once", (await countNa()) === 0);
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
  // 번호를 고쳐도 같은 줄이다(줄 id가 그대로) - 번호 칸은 줄을 펼친 곳에 있다
  await page.locator(`[data-testid="tobe-id-${added.id}-toggle"]`).click();
  await wait(page, `tobe-id-${added.id}-code`);
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
  await page.locator(`[data-testid="tobe-id-${marked.id}-toggle"]`).click();
  await wait(page, `tobe-id-${marked.id}-equipment`);
  await page.locator(`[data-testid="tobe-id-${marked.id}-equipment"]`).click();
  await settleToBe(page);
  await page.locator(`[data-testid="tobe-id-${marked.id}-type-wi"]`).click();
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
// 일부러 거절당하는 저장(409 · 500)은 따로 아래 단계에 둔다 - 이 단계는 콘솔 오류를 허용하지 않는다
await runStep("new documents: the section table shows each section's state and saves N/A only with a reason", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const start = await readToBe(page, halfBundleId);
  const naBefore = start.na_slots.length;
  const sop = start.docs.find((doc) => doc.doc_type === "sop");
  const prefix = `tobe-id-${sop.id}`;
  const outline = readOutline(start, sop.code);
  const slotKeys = outline.map((item) => item.key);
  const itemOf = new Map(outline.map((item) => [item.key, item]));
  const slotParent = (key) => itemOf.get(key)?.parent_key ?? null;
  // 다른 SOP 줄 - 접힌 줄에 적던 사유가 있을 때 그 줄의 Mark N/A를 누른다(끝에 지운다)
  await page.request.post(`${BASE}/api/bundles/${halfBundleId}/tobe/docs`, { headers: { ...headers, "Content-Type": "application/json" }, data: { code: "SOP-95", doc_type: "sop", parent_code: null } });
  const otherSop = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "SOP-95");
  // …/na/…로 가는 요청 모두(메서드 · 주소)
  const naCalls = [];
  page.on("request", (request) => {
    if (/\/tobe\/docs\/\d+\/na\//.test(request.url())) naCalls.push(`${request.method()} ${decodeURIComponent(new URL(request.url()).pathname)}`);
  });
  const countCalls = (method, key) => naCalls.filter((line) => line.startsWith(`${method} `) && (key === undefined || line.endsWith(`/na/${key}`))).length;
  const slot = (key) => page.locator(`[data-testid="${prefix}-slot-${key}"]`);
  const readState = (key) => slot(key).getAttribute("data-state");
  const stateText = async (key) => ((await page.locator(`[data-testid="${prefix}-slot-${key}-state"]`).textContent()) ?? "").trim();
  const editor = (key) => page.locator(`[data-testid="${prefix}-na-${key}-editor"]`);
  const reason = (key) => page.locator(`[data-testid="${prefix}-na-${key}-reason"]`);
  const button = (key, kind) => page.locator(`[data-testid="${prefix}-na-${key}-${kind}"]`);
  const hasMark = async (key) => (await button(key, "mark").count()) === 1;
  // 숨는 단추는 opacity만 바꾸고 전환이 있다 - 그 값이 될 때까지 기다린다
  const waitOpacity = (testId, value) =>
    page.waitForFunction(({ id, v }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el !== null && Number(getComputedStyle(el).opacity) === v;
    }, { id: testId, v: value }, { timeout: 2000 }).then(() => true, () => false);
  const focusedTestId = () => page.evaluate(() => document.activeElement?.dataset.testid ?? null);
  // 줄을 펼치고 펼침 전환이 끝날 때까지 - 전환 중에는 접힘 틀(overflow hidden)이 내용보다 낮아, 줄에 올리는 스크롤이 페이지 대신 그 틀을 굴린다
  const openRow = async (rowPrefix, inner) => {
    await page.locator(`[data-testid="${rowPrefix}-toggle"]`).click();
    await wait(page, inner);
    await page.waitForFunction((id) => {
      const fold = document.querySelector(`[data-testid="${id}"]`)?.closest(".fold-inner");
      return fold !== null && fold !== undefined && fold.clientHeight >= fold.scrollHeight;
    }, inner, { timeout: T });
  };
  try {
    check("the row is the equipment SOP SOP-CF", sop.code === "SOP-CF" && sop.is_equipment_sop, sop.code);
    await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
    await openRow(prefix, `${prefix}-slots`);
    // 1. 템플릿 골격 - 최상위는 아홉 장이고, 표의 줄은 서버가 준 그 문서의 골격 그대로다(순서 · 번호 · 들여쓰기). 머리의 수는 줄들의 상태에서 센 것과 같다
    const rows = await page.locator(`[data-testid="${prefix}-slots"] [data-slot]`).evaluateAll((els) => els.map((el) => [el.dataset.slot, el.dataset.state]));
    const tops = outline.filter((item) => item.level === 0).map((item) => item.key);
    check("the outline has the template's nine chapters in order", JSON.stringify(tops) === JSON.stringify(TEMPLATE_CHAPTERS), tops.join(","));
    check("the table lists the document's outline in the server's order", JSON.stringify(rows.map(([key]) => key)) === JSON.stringify(slotKeys), rows.map(([key]) => key).join(","));
    const shownNumbers = await page.locator(`[data-testid="${prefix}-slots"] [data-slot] .slot-num`).evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    check("each row shows the server's number, and none where there is none", JSON.stringify(shownNumbers) === JSON.stringify(outline.map(slotNumber)), shownNumbers.join(","));
    const categories = outline.filter((item) => item.parent_key === "general_requirements");
    check("the seed has a category under chapter 5, without a number", categories.length > 0 && categories.every((item) => item.number === null && item.level === 1), JSON.stringify(categories.map((item) => [item.key, item.number])));
    // 하위 칸은 24px, 그 아래 수준(7.1.x)은 한 단 더 들인다
    const indentOf = (key) => page.locator(`[data-testid="${prefix}-slot-${key}"] .slot-name`).evaluate((el) => parseFloat(getComputedStyle(el).marginLeft));
    const indents = [await indentOf("document_relationships"), await indentOf(ASSOCIATED_KEY), await indentOf(`${ASSOCIATED_KEY}.form`)];
    check("sub-sections indent one step per level", JSON.stringify(indents) === JSON.stringify([0, 24, 48]), indents.join(","));
    // 문장 있는 칸 · 빈 칸은 문장을 받는 칸만 세고, N/A는 그 표시가 붙은 줄 전부
    const assignable = new Set(outline.filter((item) => item.is_assignable).map((item) => item.key));
    const tally = (...kinds) => rows.filter(([key, state]) => assignable.has(key) && kinds.includes(state)).length;
    const naRows = rows.filter(([, state]) => state === "na" || state === "covered").length;
    const summary = (await getText(page, `${prefix}-slots-summary`)).trim();
    check("the head counts what the rows say", summary === `${tally("filled", "sub")} with sentences · ${tally("empty")} empty · ${naRows} N/A`, summary);
    // 2. 문장이 든 칸 - 수를 적고 N/A 단추가 없다. 자기 수가 없는 상위 칸은 "하위 칸에 있음"
    const counts = (start.slot_counts ?? []).filter((row) => row.target_doc_id === sop.id && row.count > 0);
    const countOf = new Map(counts.map((row) => [row.slot_key, row.count]));
    check("the seed has sections with sentences", counts.length > 0);
    for (const { slot_key: key, count } of counts) {
      const state = await readState(key);
      const text = await stateText(key);
      const buttons = await slot(key).locator(`button:not([data-testid*="-outline-"])`).count(); // 이름 바꾸기(골격) 단추는 따로 센다
      check(`${key} shows its sentences and has no N/A button`, state === "filled" && text === (count === 1 ? "1 sentence" : `${count} sentences`) && buttons === 0, `${state} ${text} ${buttons}`);
      const parent = slotParent(key);
      if (parent !== null && !countOf.has(parent)) check(`${parent} holds sentences in its sub-sections`, (await readState(parent)) === "sub", await readState(parent));
    }
    // 3. N/A인 칸 - 사유와 Edit reason · Restore
    const seedReason = start.na_slots.find((na) => na.code === sop.code && na.slot_key === "procedures.troubleshooting")?.reason ?? "";
    const troubleText = await getText(page, `${prefix}-na-procedures.troubleshooting-text`);
    check(
      "troubleshooting is N/A with its reason, and can be edited or restored",
      (await readState("procedures.troubleshooting")) === "na" && seedReason !== "" && troubleText.includes(seedReason.slice(0, 20)) && (await button("procedures.troubleshooting", "edit").count()) === 1 && (await button("procedures.troubleshooting", "restore").count()) === 1,
      troubleText,
    );
    // 4. 문장을 받지 않는 줄 - 하위만 묶는 칸(7 · 7.1)은 하위의 문장 수만 보이고(없으면 상태 자리가 빈다), 앱이 채우는 칸(7.2)은 설명만 있고 Mark N/A가 없다
    const countBelow = (key) => counts.filter((row) => row.slot_key.startsWith(`${key}.`)).reduce((sum, row) => sum + row.count, 0);
    for (const key of ["document_relationships", ASSOCIATED_KEY]) {
      const below = countBelow(key);
      check(
        `${key} only groups its sub-sections: it shows their sentences or nothing`,
        itemOf.get(key)?.kind === "group" && (await readState(key)) === (below > 0 ? "sub" : "group") && (await stateText(key)) === (below > 0 ? `${below} in sub-sections` : ""),
        `${itemOf.get(key)?.kind} ${await readState(key)} "${await stateText(key)}" ${below}`,
      );
    }
    check(
      "the work-instruction list is filled by the app: a note, no state and no Mark N/A",
      itemOf.get(WI_LIST_KEY)?.kind === "auto_list" && (await readState(WI_LIST_KEY)) === "auto" && (await stateText(WI_LIST_KEY)) === "" && (await getText(page, `${prefix}-slot-${WI_LIST_KEY}-auto-note`)).trim() === "Filled from this SOP's work instructions" && !(await hasMark(WI_LIST_KEY)),
      `${itemOf.get(WI_LIST_KEY)?.kind} ${await readState(WI_LIST_KEY)} "${await stateText(WI_LIST_KEY)}"`,
    );
    // 빈 칸의 Mark N/A는 줄에 올릴 때만
    await page.mouse.move(0, 0);
    // P: 하위 칸이 모두 비었고 Mark N/A가 그려진 상위 칸(합성 SOP에서는 7.1 Associated Documents와 그 아래 선택 항목 넷), E: P의 빈 하위 칸(끝의 것)
    const emptyKeys = rows.filter(([, state]) => state === "empty").map(([key]) => key);
    let parentKey = null;
    for (const key of slotKeys) {
      const children = slotKeys.filter((child) => slotParent(child) === key);
      if (children.length > 0 && children.every((child) => emptyKeys.includes(child)) && (await hasMark(key))) {
        parentKey = key;
        break;
      }
    }
    const children = slotKeys.filter((child) => slotParent(child) === parentKey);
    const leafKey = children.at(-1);
    const siblingKey = children[0];
    check("the seed has an empty parent with empty sub-sections", parentKey !== null && leafKey !== siblingKey && (await hasMark(leafKey)) && (await hasMark(siblingKey)), String(parentKey));
    const leafMark = `${prefix}-na-${leafKey}-mark`;
    check("an empty section's Mark N/A is hidden until its row is hovered", await waitOpacity(leafMark, 0));
    await slot(leafKey).hover();
    check("hovering the row shows Mark N/A", await waitOpacity(leafMark, 1));
    // 5. 사유 없이는 저장되지 않는다 - 칸을 떠나도 편집기는 그대로
    await button(leafKey, "mark").click();
    await editor(leafKey).waitFor({ timeout: T });
    check("Mark N/A opens the editor with the focus in it and Save off", (await focusedTestId()) === `${prefix}-na-${leafKey}-reason` && (await button(leafKey, "save").isDisabled()), await focusedTestId());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    check("Enter with no reason sends nothing", countCalls("PUT") === 0, naCalls.join(" | "));
    await page.locator('[data-testid="tobe-section"] h2').click();
    check("leaving the editor keeps it open", (await editor(leafKey).count()) === 1);
    // 6. 한 번에 하나 - 적는 중에 다른 칸을 열면 열린 것으로 돌아간다
    await reason(leafKey).fill("Smoke: covered elsewhere");
    let otherKey = null;
    for (const key of emptyKeys) {
      if (key !== parentKey && !children.includes(key) && (await hasMark(key))) {
        otherKey = key;
        break;
      }
    }
    await slot(otherKey).hover();
    await button(otherKey, "mark").click();
    await page.waitForFunction((id) => document.activeElement?.dataset.testid === id, `${prefix}-na-${leafKey}-reason`, { timeout: 2000 }).then(() => undefined, () => undefined);
    check(
      "another Mark N/A keeps the one editor and asks to finish first",
      (await editor(leafKey).count()) === 1 && (await editor(otherKey).count()) === 0 && (await getText(page, `${prefix}-na-${leafKey}-finish-first`)).trim() === "Save or cancel this reason first.",
      otherKey,
    );
    check("the focus goes back to the open editor", (await focusedTestId()) === `${prefix}-na-${leafKey}-reason`, await focusedTestId());
    // 7. 접어도 남는다
    await page.locator(`[data-testid="${prefix}-toggle"]`).click();
    await wait(page, `${prefix}-unsaved`);
    check("a folded row with a reason being written says so", (await getText(page, `${prefix}-unsaved`)).trim() === "Unsaved N/A reason");
    await openRow(prefix, `${prefix}-na-${leafKey}-reason`);
    check("unfolding brings the reason back", (await reason(leafKey).inputValue()) === "Smoke: covered elsewhere");
    // 7b. 접힌 줄에 적던 사유가 있는 채 다른 SOP 줄의 Mark N/A - 그 줄이 다시 펼쳐지고 편집기로 돌아간다(설계 §8). 아무것도 보내지 않는다
    await page.locator(`[data-testid="${prefix}-toggle"]`).click();
    await wait(page, `${prefix}-unsaved`);
    const otherPrefix = `tobe-id-${otherSop.id}`;
    await openRow(otherPrefix, `${otherPrefix}-slots`);
    await page.locator(`[data-testid="${otherPrefix}-slot-purpose"]`).hover();
    await page.locator(`[data-testid="${otherPrefix}-na-purpose-mark"]`).click();
    await page.waitForFunction((id) => document.activeElement?.dataset.testid === id, `${prefix}-na-${leafKey}-reason`, { timeout: T }).then(() => undefined, () => undefined);
    check(
      "Mark N/A in another SOP row reopens the folded row and asks to finish first",
      (await page.locator(`[data-testid="${prefix}-toggle"]`).getAttribute("aria-expanded")) === "true" &&
        (await page.locator(`[data-testid="${prefix}-na-${leafKey}-finish-first"]`).isVisible()) &&
        (await page.locator(`[data-testid="${otherPrefix}-na-purpose-editor"]`).count()) === 0,
    );
    check("the focus is in the folded row's reason, which kept its text, and nothing was sent", (await focusedTestId()) === `${prefix}-na-${leafKey}-reason` && (await reason(leafKey).inputValue()) === "Smoke: covered elsewhere" && countCalls("PUT") === 0, await focusedTestId());
    await page.locator(`[data-testid="${otherPrefix}-toggle"]`).click();
    await page.locator(`[data-testid="${otherPrefix}-panel"]`).waitFor({ state: "detached", timeout: T });
    // 8. 떠나기 전에 묻는다
    await page.locator('[data-testid="stage-nav-assign"]').click();
    await wait(page, "tobe-leave");
    check("leaving with a reason being written asks first and stays", new URL(page.url()).pathname.endsWith("/documents"), page.url());
    await page.locator('[data-testid="tobe-leave-close"]').click();
    await page.locator('[data-testid="tobe-leave"]').waitFor({ state: "detached", timeout: T });
    // 9. 저장은 한 번 - Enter를 연달아 두 번
    await reason(leafKey).focus();
    const putDone = page.waitForResponse((response) => response.request().method() === "PUT" && decodeURIComponent(response.url()).endsWith(`/na/${leafKey}`), { timeout: T });
    // 두 번을 한 작업 안에서 보낸다 - 둘째가 첫 저장의 다시 그리기 전에 닿는다(따로 누르면 기계가 바쁠 때만 그렇게 된다)
    await page.evaluate(() => {
      for (let i = 0; i < 2; i += 1) document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    });
    const putResponse = await putDone;
    await settleToBe(page);
    await editor(leafKey).waitFor({ state: "detached", timeout: T });
    check("Enter twice saves once", countCalls("PUT", leafKey) === 1 && putResponse.status() === 200, naCalls.join(" | "));
    check("the saved section turns N/A", (await readState(leafKey)) === "na", await readState(leafKey));
    check("after saving, the focus is on that section's Edit reason", (await focusedTestId()) === `${prefix}-na-${leafKey}-edit`, await focusedTestId());
    check("the server holds one more N/A", (await readToBe(page, halfBundleId)).na_slots.length === naBefore + 1);
    await page.reload();
    await openRow(prefix, `${prefix}-slots`);
    check("it is still N/A after a reload", (await readState(leafKey)) === "na");
    // 10. 쓴 사유 칩과 Esc
    await slot(siblingKey).hover();
    await button(siblingKey, "mark").click();
    await editor(siblingKey).waitFor({ timeout: T });
    const chipText = async (index) => ((await button(siblingKey, `chip-${index}`).textContent()) ?? "").trim();
    check("the used reasons come as chips, most used first", (await chipText(0)) === seedReason.trim() && (await chipText(1)) === "Smoke: covered elsewhere", `${await chipText(0)} | ${await chipText(1)}`);
    await button(siblingKey, "chip-1").click();
    check("a chip puts its reason in the box", (await reason(siblingKey).inputValue()) === "Smoke: covered elsewhere");
    const putsBefore = countCalls("PUT");
    await reason(siblingKey).press("Escape");
    check(
      "Esc closes the editor, keeps the row open and saves nothing",
      (await editor(siblingKey).count()) === 0 && (await page.locator(`[data-testid="${prefix}-toggle"]`).getAttribute("aria-expanded")) === "true" && countCalls("PUT") === putsBefore,
    );
    check("after Esc, the focus is on that section's Mark N/A", (await focusedTestId()) === `${prefix}-na-${siblingKey}-mark`, await focusedTestId());
    // Esc는 편집기 어디에서나 - 칩에 포커스가 있어도 닫힌다
    await button(siblingKey, "mark").click();
    await editor(siblingKey).waitFor({ timeout: T });
    await button(siblingKey, "chip-0").focus();
    await page.keyboard.press("Escape");
    check("Esc from a chip closes the editor too", (await editor(siblingKey).count()) === 0 && (await focusedTestId()) === `${prefix}-na-${siblingKey}-mark`, await focusedTestId());
    // 11. 상위 칸이 덮는다 - 따로 N/A인 하위 칸은 제 사유 그대로
    await slot(parentKey).hover();
    await button(parentKey, "mark").click();
    await reason(parentKey).fill("Smoke: no relationships");
    await button(parentKey, "save").click();
    await editor(parentKey).waitFor({ state: "detached", timeout: T });
    await settleToBe(page);
    // 상위 칸의 "번호 이름"은 지금 서버 골격에서 읽는다(번호 없는 칸이면 이름만 - 글에 빈칸이 남지 않는다)
    const parentLabel = slotName(readOutline(await readToBe(page, halfBundleId), sop.code).find((item) => item.key === parentKey));
    const coveredText = (await getText(page, `${prefix}-na-${siblingKey}-text`)).trim();
    check("an N/A parent covers its sub-sections", (await readState(siblingKey)) === "covered" && coveredText === `Covered by ${parentLabel}`, `${coveredText} | ${parentLabel}`);
    check("a sub-section with its own N/A keeps it", (await readState(leafKey)) === "na");
    // 12. 고치고 되돌린다
    await slot(parentKey).hover();
    await button(parentKey, "edit").click();
    await editor(parentKey).waitFor({ timeout: T });
    check("Edit reason opens the saved reason", (await reason(parentKey).inputValue()) === "Smoke: no relationships");
    await reason(parentKey).fill("Smoke: no relationships, edited");
    await reason(parentKey).press("Enter");
    await editor(parentKey).waitFor({ state: "detached", timeout: T });
    await settleToBe(page);
    const edited = (await readToBe(page, halfBundleId)).na_slots.find((na) => na.code === sop.code && na.slot_key === parentKey);
    check("the edited reason is saved", edited?.reason === "Smoke: no relationships, edited", edited?.reason);
    await slot(parentKey).hover();
    const deleteDone = page.waitForResponse((response) => response.request().method() === "DELETE" && decodeURIComponent(response.url()).endsWith(`/na/${parentKey}`), { timeout: T });
    await button(parentKey, "restore").click();
    const deleted = await deleteDone;
    const restoredToast = page.locator('[data-testid="toast-ok"]', { hasText: "Restored" }).last();
    await restoredToast.waitFor({ timeout: T });
    const toastText = ((await restoredToast.textContent()) ?? "").trim();
    check("Restore removes it at once and says so", deleted.status() === 200 && toastText.includes(`Restored ${parentLabel} in ${sop.code}`), toastText);
    await settleToBe(page);
    check("the covered sub-section is empty again", (await readState(siblingKey)) === "empty", await readState(siblingKey));
    await slot(leafKey).hover();
    // 두 번 누름을 한 작업 안에서 보낸다 - 지우기는 한 번만 간다
    await button(leafKey, "restore").evaluate((el) => {
      el.click();
      el.click();
    });
    await settleToBe(page);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.dataset.state === "empty", `${prefix}-slot-${leafKey}`, { timeout: T });
    check("restoring the sub-section brings the count back", (await readToBe(page, halfBundleId)).na_slots.length === naBefore);
    check("Restore pressed twice in one go removes once", countCalls("DELETE", leafKey) === 1, naCalls.join(" | "));
    // WI 줄을 펼치면 단계만 있고 칸 표는 없다
    const wi = start.docs.find((doc) => doc.doc_type === "wi");
    await openRow(`tobe-id-${wi.id}`, `tobe-id-${wi.id}-steps`);
    check("a WI row opens its steps and no section table", (await page.locator(`[data-testid="tobe-id-${wi.id}-slots"]`).count()) === 0);
  } finally {
    // 만든 N/A를 API로도 지운다(중간에 멈췄어도 처음 수로)
    const now = await readToBe(page, halfBundleId);
    const startKeys = new Set(start.na_slots.map((na) => `${na.code}|${na.slot_key}`));
    for (const na of now.na_slots) {
      const doc = now.docs.find((item) => item.code === na.code);
      if (!startKeys.has(`${na.code}|${na.slot_key}`) && doc) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${doc.id}/na/${encodeURIComponent(na.slot_key)}`, { headers });
    }
    check("the N/A count is back where it started", (await readToBe(page, halfBundleId)).na_slots.length === naBefore);
    if (otherSop) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${otherSop.id}`, { headers });
    check("the extra SOP is gone again", (await readToBe(page, halfBundleId)).docs.length === start.docs.length);
  }
});

// 절차 선언(표준 골격 계획 스텝 5) - 6장의 절차를 문서마다 더하고, 이름을 고치고, 순서를 바꾸고, 뺀다. 더한 절차는 칸 상태 표에 6.x로 보인다.
// 서버에 가는 저장은 모두 받아들여지는 것뿐이라 콘솔 오류를 허용하지 않는다(같은 제목 · 빈 제목은 화면이 보내기 전에 거둔다). 더한 절차는 끝에 화면에서 빼고, 중간에 멈췄으면 API로 지워 처음 골격으로 되돌린다
await runStep("new documents: declare a procedure, rename it, see it in the sections table as 6.x, remove it", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const PARENT = "procedures";
  const ADDED_TITLE = "Smoke declared procedure";
  const RENAMED_TITLE = "Smoke renamed procedure";
  const start = await readToBe(page, halfBundleId);
  const sop = start.docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
  const prefix = `tobe-id-${sop.id}`;
  const startKeys = readOutline(start, sop.code).map((item) => item.key);
  const parent = readOutline(start, sop.code).find((item) => item.key === PARENT);
  const listSiblings = (tobe) => readOutline(tobe, sop.code).filter((item) => item.parent_key === PARENT);
  const siblings = listSiblings(start);
  const rowId = (key) => `${prefix}-outline-${key}`;
  const part = (key, name) => page.locator(`[data-testid="${rowId(key)}-${name}"]`);
  const addInput = page.locator(`[data-testid="${prefix}-outline-add-${PARENT}-input"]`);
  const addButton = page.locator(`[data-testid="${prefix}-outline-add-${PARENT}"]`);
  const slotText = async (key, cell) => ((await page.locator(`[data-testid="${prefix}-slot-${key}"] .${cell}`).textContent()) ?? "").trim();
  try {
    await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
    await page.locator(`[data-testid="${prefix}-toggle"]`).click();
    await wait(page, `${prefix}-outline-group-${PARENT}`);
    // 펼침 전환이 끝날 때까지 - 전환 중에는 접힘 틀이 내용보다 낮다
    await page.waitForFunction((id) => {
      const fold = document.querySelector(`[data-testid="${id}"]`)?.closest(".fold-inner");
      return fold !== null && fold !== undefined && fold.clientHeight >= fold.scrollHeight;
    }, `${prefix}-slots`, { timeout: T });

    // 1. 묶음 - 머리는 골격이 준 부모의 이름과 번호이고, 줄은 서버가 준 절차 그대로다. 묶음은 칸 상태 표 위에 있다
    const groupText = await getText(page, `${prefix}-outline-group-${PARENT}`);
    check("the group is titled with the parent's name and number", groupText.includes(`${parent.title_en} (${parent.number})`), groupText.slice(0, 80));
    const shownKeys = await page.locator(`[data-testid="${prefix}-outline-group-${PARENT}"] > [data-testid^="${prefix}-outline-${PARENT}."]`).evaluateAll((els, p) => els.map((el) => el.dataset.testid.slice(p.length)), `${prefix}-outline-`);
    check("the group lists the document's procedures in the server's order", JSON.stringify(shownKeys) === JSON.stringify(siblings.map((item) => item.key)), shownKeys.join(","));
    const groupBox = await page.locator(`[data-testid="${prefix}-outline-group-${PARENT}"]`).boundingBox();
    const tableBox = await page.locator(`[data-testid="${prefix}-slots"]`).boundingBox();
    check("the declare lists sit above the sections table", groupBox !== null && tableBox !== null && groupBox.y + groupBox.height <= tableBox.y + 1, JSON.stringify({ groupBox, tableBox }));
    const offered = sop.is_equipment_sop ? (start.outline_suggestions?.[PARENT] ?? []).filter((name) => !siblings.some((item) => item.title_en.trim().toLowerCase() === name.trim().toLowerCase())) : [];
    const chips = await page.locator(`[data-testid^="${prefix}-outline-chip-${PARENT}-"]`).allInnerTexts();
    check("the chips are the suggested names not used yet", JSON.stringify(chips.map((text) => text.trim())) === JSON.stringify(offered), `${chips.join(",")} vs ${offered.join(",")}`);
    // 줄이 든 절차는 줄 수를 적고 빼기 단추가 없다
    const busy = siblings.find((item) => (start.slot_counts ?? []).some((row) => row.target_doc_id === sop.id && row.slot_key === item.key && row.count + row.heading_count > 0));
    if (busy) check("a procedure that holds lines shows the count and has no Remove", (await part(busy.key, "count").count()) === 1 && (await part(busy.key, "remove").count()) === 0);

    // 2. 더하기 - 끝자리에 다음 번호로 들어가고 칸 상태 표에 6.x로 보인다. 칸은 비워진다
    check("Add is off while the field is empty", await addButton.isDisabled());
    await addInput.fill(ADDED_TITLE);
    await addButton.click();
    await settleToBe(page);
    const added = listSiblings(await readToBe(page, halfBundleId)).find((item) => item.title_en === ADDED_TITLE);
    check("Add declares a procedure at the end with the next number", added?.origin === "declared" && added.number === `${parent.number}.${siblings.length + 1}`, JSON.stringify(added));
    await wait(page, rowId(added.key));
    check("the new row shows its number and title, and the add field is cleared", (await getText(page, rowId(added.key))).trim().startsWith(added.number) && (await part(added.key, "title-en").inputValue()) === ADDED_TITLE && (await addInput.inputValue()) === "");
    check("the sections table lists it as 6.x", (await slotText(added.key, "slot-num")) === added.number && (await slotText(added.key, "slot-name")) === ADDED_TITLE);
    check("a new procedure holds no lines: no count, and Remove is there", (await part(added.key, "count").count()) === 0 && (await part(added.key, "remove").count()) === 1);

    // 3. 이름 - Enter로 저장되고 키와 번호는 그대로다. 칸 상태 표의 이름이 따라간다. 한글 제목도 같은 줄에서 적는다
    await part(added.key, "title-en").fill(RENAMED_TITLE);
    await part(added.key, "title-en").press("Enter");
    await settleToBe(page);
    await part(added.key, "title-ko").fill("스모크 절차");
    await part(added.key, "title-ko").press("Enter");
    await settleToBe(page);
    const renamed = listSiblings(await readToBe(page, halfBundleId)).find((item) => item.key === added.key);
    check("renaming saves on Enter and keeps the key and the number", renamed?.title_en === RENAMED_TITLE && renamed.title_ko === "스모크 절차" && renamed.number === added.number, JSON.stringify(renamed));
    check("the sections table follows the new name", (await slotText(added.key, "slot-name")) === RENAMED_TITLE);

    // 4. 서버에 보내기 전에 거두는 것 - 같은 제목(대소문자 무시)은 Add가 꺼지고, 비운 영어 제목은 저장된 제목으로 돌아간다
    await addInput.fill(RENAMED_TITLE.toUpperCase());
    check("a title already in the list cannot be added again", (await addButton.isDisabled()) && (await page.locator(`[data-testid="${prefix}-outline-add-${PARENT}-problem"]`).count()) === 1);
    await addInput.fill("");
    const errorsBefore = await page.locator('[data-testid="toast-error"]').count();
    await part(added.key, "title-en").fill("");
    await part(added.key, "title-en").press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="toast-error"]').length > n, errorsBefore, { timeout: T });
    check("an empty English title is refused and the saved title comes back", (await part(added.key, "title-en").inputValue()) === RENAMED_TITLE && listSiblings(await readToBe(page, halfBundleId)).find((item) => item.key === added.key)?.title_en === RENAMED_TITLE);

    // 5. 순서 - 위로 올리면 번호만 따라가고 키는 그대로다. 아래로 내려 제자리로
    if (siblings.length > 0) {
      const above = siblings[siblings.length - 1];
      await page.locator(`[data-testid="${rowId(added.key)}"]`).hover();
      await part(added.key, "up").click();
      await settleToBe(page);
      const raised = listSiblings(await readToBe(page, halfBundleId));
      check(
        "Move up trades places with the row above: the numbers follow, the keys stay",
        raised.find((item) => item.key === added.key)?.number === above.number && raised.find((item) => item.key === above.key)?.number === added.number,
        raised.map((item) => `${item.key}=${item.number}`).join(","),
      );
      check("the sections table shows the new number", (await slotText(added.key, "slot-num")) === above.number);
      await page.locator(`[data-testid="${rowId(added.key)}"]`).hover();
      await part(added.key, "down").click();
      await settleToBe(page);
      check("Move down puts it back at the end", listSiblings(await readToBe(page, halfBundleId)).find((item) => item.key === added.key)?.number === added.number && (await part(added.key, "down").isDisabled()));
    }

    // 6. 빼기 - 줄과 칸 상태 표의 줄이 함께 사라지고 골격은 처음 그대로다
    await page.locator(`[data-testid="${rowId(added.key)}"]`).hover();
    await part(added.key, "remove").click();
    await settleToBe(page);
    const endKeys = readOutline(await readToBe(page, halfBundleId), sop.code).map((item) => item.key);
    check("Remove takes the procedure out and the outline is as it was", JSON.stringify(endKeys) === JSON.stringify(startKeys), endKeys.join(","));
    check("its row is gone from the list and from the sections table", (await page.locator(`[data-testid="${rowId(added.key)}"]`).count()) === 0 && (await page.locator(`[data-testid="${prefix}-slot-${added.key}"]`).count()) === 0);
  } finally {
    // 중간에 멈췄으면 더한 절차를 API로 지운다
    const left = listSiblings(await readToBe(page, halfBundleId)).filter((item) => !startKeys.includes(item.key));
    for (const item of left) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${sop.id}/outline/${encodeURIComponent(item.key)}`, { headers });
  }
});

// 표준과 다름(표준 골격 계획 스텝 6) - 비어 있는 필수 장 하나를 사유와 함께 빼면 뒤 장의 번호가 당겨지고, 뺀 줄은 줄이 그어진 채 남아 되살린다.
// 사유 없이는 저장 단추가 꺼져 서버에 거절이 가지 않으니 콘솔 오류를 허용하지 않는다. 중간에 멈췄으면 API로 되살린다
/**
 * 반쪽 Bundle SOP의 최상위 장 가운데 뺄 수 있는 것 - 표준 · 필수이고, 자기와 하위에 N/A도 문장 · 칸 제목도 없고, 뒤에 장이 있는 것.
 * 하위의 N/A까지 본다 - 장을 빼면 하위의 N/A가 지워지고 되살려도 돌아오지 않아, 뒤 단계가 기대는 시드의 N/A(procedures.troubleshooting)를 잃는다
 */

await runStep("new documents: remove a standard chapter with a reason, later chapters shift up, restore it", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const REASON = "Smoke: not used in this SOP";
  const start = await readToBe(page, halfBundleId);
  const sop = start.docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
  const prefix = `tobe-id-${sop.id}`;
  const found = findRemovableChapter(start, sop);
  check("the SOP has an empty required chapter that can be removed", found !== null, readOutline(start, sop.code).map((item) => item.key).join(","));
  if (found === null) return;
  const { target, next } = found;
  const findItem = (tobe, key) => tobe.outline_items.find((item) => item.code === sop.code && item.key === key);
  const deviationsBefore = start.outline_items.filter((item) => item.code === sop.code && item.is_deviation).length;
  const slotText = async (key, cell) => ((await page.locator(`[data-testid="${prefix}-slot-${key}"] .${cell}`).textContent()) ?? "").trim();
  const editor = (name) => page.locator(`[data-testid="${prefix}-remove-${target.key}-${name}"]`);
  try {
    await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
    await page.locator(`[data-testid="${prefix}-toggle"]`).click();
    await wait(page, `${prefix}-slots`);
    // 1. 빼기 - 줄 끝 단추가 사유 칸을 열고, 사유가 비면 저장 단추가 꺼져 있다
    await page.locator(`[data-testid="${prefix}-slot-${target.key}"]`).hover();
    await page.locator(`[data-testid="${prefix}-outline-${target.key}-remove"]`).click();
    await wait(page, `${prefix}-remove-${target.key}-editor`);
    check("Remove is off until a reason is typed", await editor("save").isDisabled());
    await editor("reason").fill(REASON);
    await editor("reason").press("Enter");
    await settleToBe(page);
    const after = await readToBe(page, halfBundleId);
    const removed = findItem(after, target.key);
    check("the chapter is removed with its reason and counts as differing", removed?.is_removed === true && removed.is_deviation && removed.deviation_reason === REASON, JSON.stringify(removed));
    check("the next chapter takes its number", findItem(after, next.key)?.number === target.number, `${findItem(after, next.key)?.number} vs ${target.number}`);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.dataset.state === "removed", `${prefix}-slot-${target.key}`, { timeout: T });
    check("the row stays as Removed with no number and the differs mark", (await slotText(target.key, "slot-num")) === "" && (await getText(page, `${prefix}-slot-${target.key}-state`)).includes("Removed") && (await page.locator(`[data-testid="${prefix}-slot-${target.key}-differs"]`).count()) === 1);
    check("the sections table shows the next chapter with the freed number", (await slotText(next.key, "slot-num")) === target.number);
    check("the document row counts the deviation", (await getText(page, `${prefix}-deviations`)).includes(`${deviationsBefore + 1} differ from standard`));
    // 2. 되살리기 - 표준 그대로, 번호도 제자리
    await page.locator(`[data-testid="${prefix}-slot-${target.key}"]`).hover();
    await page.locator(`[data-testid="${prefix}-outline-${target.key}-restore"]`).click();
    await settleToBe(page);
    const restored = await readToBe(page, halfBundleId);
    check("Restore brings the standard chapter back with its number and no reason", findItem(restored, target.key)?.is_removed === false && findItem(restored, target.key)?.is_deviation === false && findItem(restored, target.key)?.number === target.number && findItem(restored, next.key)?.number === next.number);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.dataset.state !== "removed", `${prefix}-slot-${target.key}`, { timeout: T });
    check("the row is back with its number and without the mark", (await slotText(target.key, "slot-num")) === target.number && (await page.locator(`[data-testid="${prefix}-slot-${target.key}-differs"]`).count()) === 0);
  } finally {
    if (findItem(await readToBe(page, halfBundleId), target.key)?.is_removed) {
      await page.request.patch(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${sop.id}/outline/${encodeURIComponent(target.key)}`, { headers, data: { is_removed: false } });
    }
  }
});

// 거절된 N/A 저장 - 409 slot_has_targets(그 사이 문장이 들어왔다)는 둘 곳이 없어 편집기를 닫고, 그 밖의 실패는 적던 사유를 남긴다.
// 거절 응답이 콘솔에 찍혀 이 단계만 콘솔 오류를 허용한다
await runStep("new documents: a refused N/A save closes the editor, any other failure keeps the reason", { allowConsoleErrors: true }, async ({ page }) => {
  const start = await readToBe(page, halfBundleId);
  const sop = start.docs.find((doc) => doc.doc_type === "sop");
  const prefix = `tobe-id-${sop.id}`;
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(`[data-testid="${prefix}-toggle"]`).click();
  await wait(page, `${prefix}-slots`);
  await page.waitForFunction((id) => {
    const fold = document.querySelector(`[data-testid="${id}"]`)?.closest(".fold-inner");
    return fold !== null && fold !== undefined && fold.clientHeight >= fold.scrollHeight;
  }, `${prefix}-slots`, { timeout: T });
  // Mark N/A가 그려진 빈 칸 하나
  const key = await page.locator(`[data-testid="${prefix}-slots"] [data-slot][data-state="empty"]`).evaluateAll((rows, p) => rows.map((row) => row.dataset.slot).find((k) => document.querySelector(`[data-testid="${p}-na-${k}-mark"]`) !== null), prefix);
  check("the seed has an empty section to mark", Boolean(key), String(key));
  const slot = page.locator(`[data-testid="${prefix}-slot-${key}"]`);
  const button = (kind) => page.locator(`[data-testid="${prefix}-na-${key}-${kind}"]`);
  const editor = page.locator(`[data-testid="${prefix}-na-${key}-editor"]`);
  const reason = page.locator(`[data-testid="${prefix}-na-${key}-reason"]`);
  const countErrors = () => page.locator('[data-testid="toast-error"]').count();
  const waitNewError = async (before) => {
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="toast-error"]').length > n, before, { timeout: T });
    return ((await page.locator('[data-testid="toast-error"]').last().textContent()) ?? "").trim();
  };
  let answer = 409;
  await page.route("**/tobe/docs/*/na/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: answer, contentType: "application/json", body: JSON.stringify(answer === 409 ? { detail: { code: "slot_has_targets", slots: [] } } : { detail: "Synthetic server error" }) })
      : route.continue(),
  );
  try {
    let errorsBefore = await countErrors();
    await slot.hover();
    await button("mark").click();
    await reason.fill("Smoke: refused");
    await reason.press("Enter");
    const conflictText = await waitNewError(errorsBefore);
    await settleToBe(page);
    check("a 409 says why and closes the editor", conflictText.includes("A section with new sentences cannot be N/A or removed.") && (await editor.count()) === 0, conflictText);
    answer = 500;
    errorsBefore = await countErrors();
    await slot.hover();
    await button("mark").click();
    await reason.fill("Smoke: kept");
    await reason.press("Enter");
    await waitNewError(errorsBefore);
    await settleToBe(page);
    check("any other failure keeps the editor and the reason", (await editor.count()) === 1 && (await reason.inputValue()) === "Smoke: kept");
    await button("cancel").click();
    check("Cancel closes it and puts the focus on Mark N/A", (await editor.count()) === 0 && (await page.evaluate(() => document.activeElement?.dataset.testid ?? null)) === `${prefix}-na-${key}-mark`);
  } finally {
    await page.unroute("**/tobe/docs/*/na/*");
    check("no N/A was saved", (await readToBe(page, halfBundleId)).na_slots.length === start.na_slots.length);
  }
});

await runStep("new documents: rows read in two lines, a click or Enter opens a row, row-end buttons show on hover or focus", {}, async ({ page }) => {
  const tobe = await readToBe(page, halfBundleId);
  const deletes = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && /\/tobe\/docs\/\d+$/.test(new URL(request.url()).pathname)) deletes.push(request.url());
  });
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  // 1. 표가 아니라 줄 상자 - 줄 수, 머리의 수, 순서, 종류와 들임
  const expected = orderToBe(tobe.docs);
  check("the New list is not a table", (await page.locator('[data-testid="tobe-list"] table').count()) === 0);
  check("one row per document, and the head counts them", (await page.locator(TOBE_ROWS).count()) === tobe.docs.length && (await getText(page, "tobe-count")).trim() === String(tobe.docs.length), await getText(page, "tobe-count").catch(() => "no count"));
  const shown = await page.locator('[data-testid="tobe-list"] [data-testid$="-code-text"]').evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
  check("the numbers read in order, each SOP with its WIs under it", JSON.stringify(shown) === JSON.stringify(expected.map(({ doc }) => doc.code)), shown.join(","));
  const kinds = await page.locator(TOBE_ROWS).evaluateAll((els) => els.map((el) => `${el.dataset.kind}${el.hasAttribute("data-child") ? "+child" : ""}`));
  check("SOP rows are sop, the WIs under them are nested wi rows", JSON.stringify(kinds) === JSON.stringify(expected.map(({ doc, child }) => `${doc.doc_type}${child ? "+child" : ""}`)), kinds.join(","));
  // 2. 줄에는 고치는 칸이 없다
  check("a closed row has no field to edit", (await page.locator('[data-testid="tobe-list"] .doc-row :is(input, select)').count()) === 0);
  // 3. 펼치기 - 제목 글을 누르면 열리고 다시 누르면 닫힌다. Enter로 열고 Space로 닫는다(쪽은 그대로)
  const sop = expected[0].doc;
  const sopPrefix = `tobe-id-${sop.id}`;
  const panel = (prefix) => page.locator(`[data-testid="${prefix}-panel"]`);
  const toggleOf = (prefix) => page.locator(`[data-testid="${prefix}-toggle"]`);
  await page.locator(`[data-testid="${sopPrefix}-title-text"]`).click();
  await panel(sopPrefix).waitFor({ timeout: T });
  check("clicking the row's title opens it", (await panel(sopPrefix).isVisible()) && (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "true");
  await page.locator(`[data-testid="${sopPrefix}-title-text"]`).click();
  await panel(sopPrefix).waitFor({ state: "detached", timeout: T });
  check("clicking it again closes it", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "false");
  const sopRow = page.locator(`[data-testid="${sopPrefix}-row"]`);
  await sopRow.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Enter");
  await panel(sopPrefix).waitFor({ timeout: T });
  check("Enter on the row opens it", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "true");
  await page.keyboard.press(" ");
  await panel(sopPrefix).waitFor({ state: "detached", timeout: T });
  check("Space closes it and does not scroll the page", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "false" && (await page.evaluate(() => window.scrollY)) === scrollBefore);
  const second = expected[1].doc;
  await toggleOf(sopPrefix).click();
  await toggleOf(`tobe-id-${second.id}`).click();
  await panel(`tobe-id-${second.id}`).waitFor({ timeout: T });
  check("several rows can stay open", (await page.locator('[data-testid="tobe-list"] [data-testid$="-panel"]').count()) === 2);
  await toggleOf(sopPrefix).click();
  await toggleOf(`tobe-id-${second.id}`).click();
  await page.locator('[data-testid="tobe-list"] [data-testid$="-panel"]').first().waitFor({ state: "detached", timeout: T });
  // 4. 글자를 긁은 것은 펼침이 아니다
  const titleBox = await getBox(page, `${sopPrefix}-title-text`);
  await page.mouse.move(titleBox.x + 4, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + 64, titleBox.y + titleBox.height / 2, { steps: 6 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  await page.waitForTimeout(400);
  check("selecting the title's text does not open the row", selected !== "" && (await page.locator('[data-testid="tobe-list"] [data-testid$="-panel"]').count()) === 0, JSON.stringify(selected));
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  // 5. 줄 끝 단추 - 평소 숨고, 올리거나 Tab으로 들어오면 보인다. 오른쪽 끝이 줄마다 같다
  await blurAll(page);
  await page.mouse.move(0, 0);
  check("row-end buttons are hidden at rest", await waitOpacityOf(page, `${sopPrefix}-acts`, 0));
  await sopRow.hover();
  check("hovering the row shows them", await waitOpacityOf(page, `${sopPrefix}-acts`, 1));
  await page.mouse.move(0, 0);
  check("leaving the row hides them again", await waitOpacityOf(page, `${sopPrefix}-acts`, 0));
  await sopRow.focus();
  for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement?.dataset.testid ?? "")) !== `${sopPrefix}-edit`; i += 1) await page.keyboard.press("Tab");
  check("Tab reaches Edit and shows the buttons", (await page.evaluate(() => document.activeElement?.dataset.testid ?? "")) === `${sopPrefix}-edit` && (await waitOpacityOf(page, `${sopPrefix}-acts`, 1)));
  const rights = await page.locator('[data-testid="tobe-list"] [data-testid$="-acts"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
  check("every row's buttons end at the same right edge", rights.length === tobe.docs.length && Math.max(...rights) - Math.min(...rights) <= 1, rights.join(","));
  await page.keyboard.press("Enter");
  await panel(sopPrefix).waitFor({ timeout: T });
  check("Edit opens the row", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "true");
  const focusInPanel = () =>
    page
      .waitForFunction((id) => {
        const active = document.activeElement;
        return active instanceof HTMLInputElement && document.querySelector(`[data-testid="${id}"]`)?.contains(active) === true;
      }, `${sopPrefix}-panel`, { timeout: 2000 })
      .then(() => true, () => false);
  check("Edit puts the focus in the expanded row's first field", await focusInPanel(), await page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName));
  // Edit는 펼친다 - 이미 펼친 줄에서 눌러도 접지 않는다
  await sopRow.hover();
  await page.locator(`[data-testid="${sopPrefix}-edit"]`).click();
  await page.waitForTimeout(400);
  check("Edit on an open row keeps it open", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "true" && (await panel(sopPrefix).isVisible()) && (await focusInPanel()));
  // 화살표 단추는 아이콘만이라 올리면 뜻이 뜬다 - 줄의 제목 글을 덮지 않는다. 줄 끝 단추에 올렸을 때는 그 단추의 툴팁만 뜬다
  await page.mouse.move(0, 0);
  await toggleOf(sopPrefix).hover();
  const chevTip = page.locator('[role="tooltip"]', { hasText: "Sections and steps" });
  await chevTip.waitFor({ timeout: T });
  const chevTipBox = await chevTip.boundingBox();
  const sopTitleBox = await getBox(page, `${sopPrefix}-title-text`);
  const overlapsTitle = chevTipBox.x < sopTitleBox.x + sopTitleBox.width && sopTitleBox.x < chevTipBox.x + chevTipBox.width && chevTipBox.y < sopTitleBox.y + sopTitleBox.height && sopTitleBox.y < chevTipBox.y + chevTipBox.height;
  check("hovering the chevron names it and does not cover the title", !overlapsTitle, JSON.stringify({ chevTipBox, sopTitleBox }));
  await page.mouse.move(0, 0);
  await page.locator(`[data-testid="${sopPrefix}-edit"]`).hover({ force: true });
  await page.locator('[role="tooltip"]', { hasText: "Edit" }).waitFor({ timeout: T });
  check("hovering a row-end button shows only that button's tip", (await page.locator('[role="tooltip"]').count()) === 1, String(await page.locator('[role="tooltip"]').allTextContents()));
  await toggleOf(sopPrefix).click();
  await panel(sopPrefix).waitFor({ state: "detached", timeout: T });
  // 6. 뺄 수 없는 줄은 Remove가 꺼지고 올리면 까닭이 뜬다 - 누름으로 지우기 요청이 가지 않는다
  const readTip = async (testId) => {
    await page.mouse.move(0, 0);
    await page.locator(`[data-testid="${testId}"]`).hover({ force: true });
    const tip = page.locator('[role="tooltip"]').last();
    await tip.waitFor({ timeout: T });
    return ((await tip.textContent()) ?? "").trim();
  };
  // 시드의 SOP는 문장도 있어 그 까닭이 먼저다 - 문장 없이 WI만 거느린 SOP를 API로 잠깐 더한다(끝에 지운다)
  const apiHeaders = { "X-Dev-User": "qa.member", "Content-Type": "application/json" };
  const addDoc = (data) => page.request.post(`${BASE}/api/bundles/${halfBundleId}/tobe/docs`, { headers: apiHeaders, data });
  await addDoc({ code: "SOP-96", doc_type: "sop", parent_code: null });
  await addDoc({ code: "WI-96", doc_type: "wi", parent_code: "SOP-96" });
  const withExtra = await readToBe(page, halfBundleId);
  const extraSop = withExtra.docs.find((doc) => doc.code === "SOP-96");
  const extraWi = withExtra.docs.find((doc) => doc.code === "WI-96");
  try {
    await page.reload();
    await page.locator(`[data-testid="tobe-id-${extraSop.id}-row"]`).waitFor({ timeout: T });
    const parentRemove = page.locator(`[data-testid="tobe-id-${extraSop.id}-remove"]`);
    check("an SOP with WIs under it cannot be removed, and says why", (await parentRemove.isDisabled()) && (await readTip(`tobe-id-${extraSop.id}-remove`)) === "WIs sit under this SOP. Delete them first.");
    const counted = new Set((tobe.sentence_counts ?? []).map((row) => row.target_doc_id));
    const busyWi = tobe.docs.find((doc) => doc.doc_type === "wi" && doc.entrance === "assign" && counted.has(doc.id));
    check("the seed has a WI that holds sentences", busyWi !== undefined);
    const busyRemove = page.locator(`[data-testid="tobe-id-${busyWi.id}-remove"]`);
    check("a WI with sentences cannot be removed, and says why", (await busyRemove.isDisabled()) && (await readTip(`tobe-id-${busyWi.id}-remove`)) === "Sentences are assigned here. Clear them first.");
    await parentRemove.click({ force: true });
    await busyRemove.click({ force: true });
    await page.waitForTimeout(300);
    check("pressing a disabled Remove sends no delete", deletes.length === 0 && (await readToBe(page, halfBundleId)).docs.length === withExtra.docs.length, deletes.join(" | "));
  } finally {
    for (const doc of [extraWi, extraSop]) if (doc) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${doc.id}`, { headers: apiHeaders });
    check("the extra SOP and WI are gone again", (await readToBe(page, halfBundleId)).docs.length === tobe.docs.length);
  }
  await page.reload();
  await sopRow.waitFor({ timeout: T });
  // 7. 좁은 틀 - 묶음 대신 ⋯ 하나가 같은 일을 메뉴로 한다. 앱 틀은 1120px 아래로 줄지 않아(.app min-width) 창을 줄여서는 목록 틀이 문턱(840px)보다 좁아지지 않는다 -
  //    목록 틀의 폭만 문턱 아래로 묶어 컨테이너 질의를 본다(문턱이 바뀌면 이 폭도 맞춘다)
  const narrow = await page.addStyleTag({ content: '[data-testid="tobe-list"] { max-width: 820px; }' });
  try {
    await page.mouse.move(0, 0);
    check("a narrow list hides the button group", (await sopRow.evaluate((row) => getComputedStyle(row.querySelector(".doc-acts")).display)) === "none");
    await sopRow.hover();
    check("hovering shows the ⋯ button", await waitOpacityOf(page, `${sopPrefix}-more`, 1));
    await page.locator(`[data-testid="${sopPrefix}-more"]`).click();
    await wait(page, `${sopPrefix}-more-menu`);
    check(
      "the menu holds Edit and Remove",
      (await page.locator(`[data-testid="${sopPrefix}-more-menu"] [data-testid="${sopPrefix}-edit-item"]`).count()) === 1 && (await page.locator(`[data-testid="${sopPrefix}-more-menu"] [data-testid="${sopPrefix}-remove-item"]`).count()) === 1,
    );
    await page.mouse.move(0, 0);
    check("the ⋯ button stays while its menu is open", await waitOpacityOf(page, `${sopPrefix}-more`, 1));
    await page.keyboard.press("Escape");
    await page.locator(`[data-testid="${sopPrefix}-more-menu"]`).waitFor({ state: "detached", timeout: T });
    check("Esc closes the menu", true);
    await sopRow.hover();
    await page.locator(`[data-testid="${sopPrefix}-more"]`).click();
    await wait(page, `${sopPrefix}-more-menu`);
    await page.locator('[data-testid="tobe-section"] h2').click();
    await page.locator(`[data-testid="${sopPrefix}-more-menu"]`).waitFor({ state: "detached", timeout: T });
    check("a click outside closes the menu", true);
    await sopRow.hover();
    await page.locator(`[data-testid="${sopPrefix}-more"]`).click();
    await page.locator(`[data-testid="${sopPrefix}-edit-item"]`).click();
    await panel(sopPrefix).waitFor({ timeout: T });
    check("Edit in the menu opens the row", (await toggleOf(sopPrefix).getAttribute("aria-expanded")) === "true");
    await toggleOf(sopPrefix).click();
    await panel(sopPrefix).waitFor({ state: "detached", timeout: T });
  } finally {
    await narrow.evaluate((tag) => tag.remove());
  }
  // 8. 펼친 곳에서 고친다 - WI의 상위 SOP와 종류, 쓴 파일이 붙은 줄은 번호와 종류가 잠긴다
  const wi = expected.find(({ doc }) => doc.doc_type === "wi" && doc.entrance === "assign").doc;
  const wiPrefix = `tobe-id-${wi.id}`;
  await toggleOf(wiPrefix).click();
  await wait(page, `${wiPrefix}-parent`);
  check("an open WI shows its parent SOP and its type", (await getText(page, `${wiPrefix}-parent`)).includes(wi.parent_code) && (await page.locator(`[data-testid="${wiPrefix}-type-wi"]`).getAttribute("aria-pressed")) === "true");
  const writtenDoc = tobe.docs.find((doc) => doc.entrance === "match");
  if (writtenDoc) {
    const writtenPrefix = `tobe-id-${writtenDoc.id}`;
    await toggleOf(writtenPrefix).click();
    await wait(page, `${writtenPrefix}-code`);
    check(
      "a row with a written file keeps its number and type locked",
      (await page.locator(`[data-testid="${writtenPrefix}-code"]`).isDisabled()) && (await page.locator(`[data-testid="${writtenPrefix}-type-sop"]`).isDisabled()) && (await page.locator(`[data-testid="${writtenPrefix}-type-wi"]`).isDisabled()),
    );
  }
});

// 읽기 전용(검토자 · 검토 대기 묶음) - 줄은 펼쳐지고 값은 글자로만 보인다. 고치는 칸 · 줄 끝 단추 · 칸 표의 단추 · 등록 칸이 없다
await runStep("new documents: a reviewer reads the rows and the section table, nothing edits", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  const tobe = (await (await page.request.get(`${BASE}/api/bundles/${reviewId}/tobe`, { headers: { "X-Dev-User": "qa.lead" } })).json());
  await page.goto(`${BASE}/bundles/${reviewId}/documents`);
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  const sop = tobe.docs.find((doc) => doc.doc_type === "sop");
  const wi = tobe.docs.find((doc) => doc.doc_type === "wi" && doc.parent_code === sop.code);
  const sopPrefix = `tobe-id-${sop.id}`;
  const wiPrefix = `tobe-id-${wi.id}`;
  await page.locator(`[data-testid="${sopPrefix}-title-text"]`).click();
  await wait(page, `${sopPrefix}-slots`);
  await page.locator(`[data-testid="${wiPrefix}-row"]`).click();
  await wait(page, `${wiPrefix}-code`);
  check("rows open for a reviewer", (await page.locator(`[data-testid="${sopPrefix}-toggle"]`).getAttribute("aria-expanded")) === "true" && (await page.locator(`[data-testid="${wiPrefix}-toggle"]`).getAttribute("aria-expanded")) === "true");
  const list = page.locator('[data-testid="tobe-list"]');
  check("no field to edit anywhere in the list", (await list.locator('input, select, [role="checkbox"]').count()) === 0);
  check("no row-end buttons", (await list.locator('[data-testid$="-acts"], [data-testid$="-more"], [data-testid$="-remove"], [data-testid$="-edit"]').count()) === 0);
  check("the section table has no N/A buttons", (await page.locator(`[data-testid="${sopPrefix}-slots"]`).locator('button[data-testid$="-mark"], button[data-testid$="-edit"], button[data-testid$="-restore"]').count()) === 0);
  check("no add field", (await page.locator('[data-testid="tobe-add-row"]').count()) === 0);
  check(
    "number, title, type and parent read as text",
    (await getText(page, `${wiPrefix}-code`)).trim() === wi.code && (await getText(page, `${wiPrefix}-title`)).trim() === wi.title.trim() && (await getText(page, `${wiPrefix}-type`)).trim() === "WI" && (await getText(page, `${wiPrefix}-parent`)).trim() === sop.code,
    `${await getText(page, `${wiPrefix}-code`)} | ${await getText(page, `${wiPrefix}-type`)} | ${await getText(page, `${wiPrefix}-parent`)}`,
  );
});

// 등록 칸과 줄의 칸 상태 요약(Documents 화면 설계 §6) - 번호 칸은 목록 머리 바로 아래에서 무엇을 더할지 미리 적고, SOP 줄은 칸 상태 막대(문장을 받는 칸마다 눈금 하나)와 요약 글, 단계는 문장 수를 보인다
await runStep("new documents: the add field says what it will add, a row shows its sections at a glance", {}, async ({ page }) => {
  const tobe = await readToBe(page, halfBundleId);
  const apiHeaders = { "X-Dev-User": "qa.member" };
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  // 1. 등록 칸의 자리 - 목록 머리 바로 아래, 첫 줄 위
  const addBox = await getBox(page, "tobe-add-row");
  const firstRowBox = await page.locator(TOBE_ROWS).first().boundingBox();
  check("the add field sits above the first row", addBox !== null && firstRowBox !== null && addBox.y < firstRowBox.y, `${addBox?.y} vs ${firstRowBox?.y}`);
  // 2. 미리 보기 - 적는 동안 무엇이 더해질지(종류 · 어느 SOP 아래), 이미 있는 번호면 Add가 꺼진다
  const input = page.locator('[data-testid="tobe-add-code"]');
  const readPreview = async () => ((await page.locator('[data-testid="tobe-add-preview"]').textContent()) ?? "").trim();
  const previewIs = (text) =>
    page.waitForFunction((want) => (document.querySelector('[data-testid="tobe-add-preview"]')?.textContent ?? "").trim() === want, text, { timeout: 2000 }).then(() => true, () => false);
  check("the preview speaks politely to screen readers", (await page.locator('[data-testid="tobe-add-preview"]').getAttribute("aria-live")) === "polite");
  await input.fill("WI-77");
  check("a WI number says which SOP it goes under", await previewIs("Adds WI WI-77 under SOP-CF"), await readPreview());
  await input.fill("SOP-77");
  check("an SOP number says it adds an SOP", await previewIs("Adds SOP SOP-77"), await readPreview());
  const firstWi = tobe.docs.find((doc) => doc.doc_type === "wi");
  await input.fill(firstWi.code);
  check("a number on the list says so", await previewIs(`${firstWi.code} is already on the list`), await readPreview());
  check("and Add is off", await page.locator('[data-testid="tobe-add"]').isDisabled());
  await input.fill("A-1, B-2");
  check("several numbers are counted", await previewIs("Adds 2 documents"), await readPreview());
  await input.fill("");
  check("an empty field shows the hint", await previewIs("Type a number and press Enter. Paste several lines to add them all."), await readPreview());
  // 3. 더하면 그 줄이 SOP-CF 아래에 생겨 잠깐 강조되고 화면 안에 있다. 포커스는 비운 칸에 남는다
  let added = null;
  try {
    await input.fill("WI-77");
    await Promise.all([page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/tobe/docs"), { timeout: T }), input.press("Enter")]);
    added = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "WI-77");
    const addedRow = page.locator(`[data-testid="tobe-id-${added.id}-row"]`);
    await addedRow.waitFor({ timeout: T });
    const flashed = await page
      .waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.hasAttribute("data-flash") === true, `tobe-id-${added.id}-row`, { timeout: 1500 })
      .then(() => true, () => false);
    check("the added row flashes", flashed);
    const shown = await page.locator('[data-testid="tobe-list"] [data-testid$="-code-text"]').evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    const sopAt = shown.indexOf("SOP-CF");
    const addedAt = shown.indexOf("WI-77");
    const between = shown.slice(sopAt + 1, addedAt);
    check(
      "it sits under SOP-CF as a nested WI",
      added.parent_code === "SOP-CF" && sopAt >= 0 && addedAt > sopAt && (await addedRow.getAttribute("data-child")) !== null && between.every((code) => tobe.docs.find((doc) => doc.code === code)?.doc_type === "wi"),
      shown.join(","),
    );
    const inView = await page
      .waitForFunction((id) => {
        const rect = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight;
      }, `tobe-id-${added.id}-row`, { timeout: 2000 })
      .then(() => true, () => false);
    check("the added row is on screen", inView);
    check("the focus stays in the emptied field", (await page.evaluate(() => document.activeElement?.dataset.testid ?? "")) === "tobe-add-code" && (await input.inputValue()) === "");
  } finally {
    if (added) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${added.id}`, { headers: apiHeaders });
  }
  // Enter 두 번을 한 작업 안에서 보내도 한 번만 더한다(둘째가 첫 저장의 다시 그리기 전에 닿는다)
  const posts = [];
  const countPost = (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/tobe/docs")) posts.push(request.url());
  };
  page.on("request", countPost);
  try {
    await input.fill("SOP-78");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/tobe/docs"), { timeout: T }),
      input.evaluate((el) => {
        for (let i = 0; i < 2; i += 1) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      }),
    ]);
    await settleToBe(page);
    check("Enter twice in the add field adds once", posts.length === 1, String(posts.length));
  } finally {
    page.off("request", countPost);
    const extra = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "SOP-78");
    if (extra) await page.request.delete(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${extra.id}`, { headers: apiHeaders });
  }
  await page.reload();
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  // 4. 칸 상태 막대 - 장식(aria-hidden)이고, 문장을 받는 칸마다 눈금 하나가 펼친 표의 그 칸 상태와 같은 순서다(묶음 7 · 7.1과 앱이 채우는 7.2는 눈금이 없다). 눈금에 올리면 칸 이름이 뜬다
  const sop = tobe.docs.find((doc) => doc.code === "SOP-CF");
  const sopPrefix = `tobe-id-${sop.id}`;
  const outline = readOutline(tobe, sop.code);
  const placeKeys = new Set(outline.filter((item) => item.is_assignable).map((item) => item.key));
  // 합성 SOP의 N/A 칸 - 선언한 절차 Troubleshooting(6장의 절차라 "6.n Troubleshooting")
  const troubleName = slotName(outline.find((item) => item.key === "procedures.troubleshooting"));
  check("the seed's N/A procedure has a number under chapter 6", /^6\.\d+ Troubleshooting$/.test(troubleName), troubleName);
  const bar = page.locator(`[data-testid="${sopPrefix}-bar"]`);
  check("the bar is decoration for screen readers", (await bar.getAttribute("aria-hidden")) === "true");
  const ticks = await bar.locator("i").evaluateAll((els) => els.map((el) => el.dataset.state));
  await page.locator(`[data-testid="${sopPrefix}-toggle"]`).click();
  await wait(page, `${sopPrefix}-slots`);
  const tableRows = await page.locator(`[data-testid="${sopPrefix}-slots"] [data-slot]`).evaluateAll((els) => els.map((el) => [el.dataset.slot, el.dataset.state]));
  const placeRows = tableRows.filter(([key]) => placeKeys.has(key));
  const states = placeRows.map(([, state]) => state);
  check("one tick per section that takes sentences, in the section table's order and states", placeKeys.size < tableRows.length && ticks.length === placeKeys.size && JSON.stringify(ticks) === JSON.stringify(states), `${ticks.join(",")} | ${states.join(",")}`);
  const troubleshootingAt = placeRows.findIndex(([key]) => key === "procedures.troubleshooting");
  await page.mouse.move(0, 0);
  await bar.locator("i").nth(troubleshootingAt).hover();
  const tip = page.locator('[data-testid="paper-tip"]');
  await tip.waitFor({ timeout: T });
  check("hovering a tick names the section", ((await tip.textContent()) ?? "").includes(troubleName), await tip.textContent());
  // 5. 요약 글 - 표에서 센 수와 같다. 채운 칸과 전체는 문장을 받는 칸만, N/A는 그 표시가 붙은 줄 전부
  const filled = states.filter((state) => state === "filled" || state === "sub").length;
  const na = tableRows.filter(([, state]) => state === "na" || state === "covered").length;
  const textOf = async (testId) => ((await page.locator(`[data-testid="${testId}"]`).textContent()) ?? "").trim();
  check("the row counts the filled sections", (await textOf(`${sopPrefix}-filled`)) === `${filled} of ${placeKeys.size} sections filled`, await textOf(`${sopPrefix}-filled`));
  const naSummary = await textOf(`${sopPrefix}-na-summary`);
  check("the row counts N/A and names the first one", naSummary.includes(`N/A ${na}`) && naSummary.includes(troubleName), naSummary);
  // 첫 N/A 칸 이름 - 다 보이면 툴팁이 없고, 말줄임으로 줄었으면 전체 이름이 툴팁으로 뜬다(줄인 폭은 주입한다)
  const naName = page.locator(`[data-testid="${sopPrefix}-na-name"]`);
  const nameTip = page.locator('[role="tooltip"]').filter({ hasText: troubleName });
  await naName.hover();
  await page.waitForTimeout(400);
  check("a first N/A name shown in full has no tooltip", (await nameTip.count()) === 0);
  await page.mouse.move(0, 0);
  const narrowName = await page.addStyleTag({ content: `[data-testid="${sopPrefix}-na-name"] { max-width: 40px; }` });
  await naName.focus();
  check("a cut first N/A name shows the whole name on focus", await nameTip.first().waitFor({ timeout: 2000 }).then(() => true, () => false));
  await narrowName.evaluate((el) => el.remove());
  // 줄어드는 순서 - 딸린 정보 줄을 조금씩 좁히면 첫 N/A 칸 이름 → Equipment SOP 글자 → 막대 차례로 빠지고, 다 빠지기 전에는 잘리지 않는다
  const metaLine = page.locator(`[data-testid="${sopPrefix}-row"] .doc-meta`);
  const stages = [];
  for (let width = 640; width >= 200; width -= 8) {
    const pin = await page.addStyleTag({ content: `[data-testid="${sopPrefix}-row"] .doc-meta { max-width: ${width}px; }` });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    stages.push(
      await metaLine.evaluate((meta, at) => {
        const shown = (selector) => {
          const el = meta.querySelector(selector);
          return el !== null && getComputedStyle(el).display !== "none";
        };
        const label = meta.querySelector(".meta-na-label");
        return { at, fit: Number(meta.dataset.fit), name: shown(".meta-na-name"), cut: label !== null && label.scrollWidth > label.clientWidth, eq: shown(".meta-eq-text"), bar: shown(".slot-bar"), over: meta.scrollWidth > meta.clientWidth };
      }, width),
    );
    await pin.evaluate((el) => el.remove());
  }
  // 이름이 먼저 말줄임으로 줄고(그동안 나머지는 그대로), Equipment SOP 글자가 빠졌으면 이름도 빠졌고, 막대가 빠졌으면 둘 다 빠졌다
  const inOrder = stages.every((s) => (s.eq || !s.name) && (s.bar || (!s.eq && !s.name)));
  const reached = [stages.some((s) => s.name && s.cut && s.eq && s.bar), stages.some((s) => !s.name && !s.eq && s.bar), stages.some((s) => !s.bar)];
  check("a narrowing row drops the first N/A name, then the Equipment SOP text, then the bar", inOrder && reached.every(Boolean), JSON.stringify(stages.filter((s, i) => i === 0 || JSON.stringify({ ...s, at: 0 }) !== JSON.stringify({ ...stages[i - 1], at: 0 }))));
  check("nothing is cut off before the last stage", stages.every((s) => s.fit === 4 || !s.over), JSON.stringify(stages.filter((s) => s.over)));
  await page.locator(`[data-testid="${sopPrefix}-toggle"]`).click();
  await page.locator(`[data-testid="${sopPrefix}-panel"]`).waitFor({ state: "detached", timeout: T });
  // 6. 단계의 문장 수 - 문장이 든 단계에는 수가 적히고 Remove step이 없다
  const stepCounts = (tobe.sentence_counts ?? []).filter((row) => row.wi_step !== null && row.count > 0);
  check("the seed has a WI step that holds sentences", stepCounts.length > 0);
  const busy = stepCounts[0];
  const busyWi = tobe.docs.find((doc) => doc.id === busy.target_doc_id);
  const busyPrefix = `tobe-id-${busyWi.id}`;
  const busySteps = tobe.wi_steps.filter((step) => step.code === busyWi.code);
  check("the WI row counts its steps", (await textOf(`${busyPrefix}-steps-count`)) === `Steps ${busySteps.length}`, await textOf(`${busyPrefix}-steps-count`));
  await page.locator(`[data-testid="${busyPrefix}-toggle"]`).click();
  await wait(page, `${busyPrefix}-steps`);
  check(
    "a step with sentences shows how many and has no Remove step",
    (await textOf(`${busyPrefix}-step-${busy.wi_step}-count`)) === (busy.count === 1 ? "1 sentence" : `${busy.count} sentences`) && (await page.locator(`[data-testid="${busyPrefix}-remove-step-${busy.wi_step}"]`).count()) === 0,
    await textOf(`${busyPrefix}-step-${busy.wi_step}-count`).catch(() => "no count"),
  );
  const counted = new Set(stepCounts.map((row) => `${row.target_doc_id}|${row.wi_step}`));
  const quietStep = tobe.wi_steps.find((step) => {
    const doc = tobe.docs.find((item) => item.code === step.code);
    return doc !== undefined && doc.id === busyWi.id && !counted.has(`${doc.id}|${step.step_no}`);
  });
  if (quietStep) {
    check(
      "a step without sentences has no count and keeps Remove step",
      (await page.locator(`[data-testid="${busyPrefix}-step-${quietStep.step_no}-count"]`).count()) === 0 && (await page.locator(`[data-testid="${busyPrefix}-remove-step-${quietStep.step_no}"]`).count()) === 1,
    );
  } else check("the busy WI has a step without sentences", false, busySteps.map((step) => step.step_no).join(","));
  // 7. 부모를 못 찾은 WI(있어서는 안 되는 자료) - 목록 끝 No parent SOP 묶음에 서고, 펼친 곳의 Parent SOP로 고칠 수 있다
  const ghost = tobe.docs.find((doc) => doc.doc_type === "wi" && doc.entrance === "assign");
  const tobeRoute = "**/api/bundles/*/tobe";
  await page.route(tobeRoute, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.docs = body.docs.map((doc) => (doc.id === ghost.id ? { ...doc, parent_code: "GHOST" } : doc));
    return route.fulfill({ response, json: body });
  });
  try {
    await page.reload();
    await wait(page, "tobe-loose");
    check("a WI without its parent sits under No parent SOP", (await textOf("tobe-loose")).includes("No parent SOP"), await textOf("tobe-loose"));
    const last = await page.locator(TOBE_ROWS).last().getAttribute("data-testid");
    check("that row is the last on the list", last === `tobe-id-${ghost.id}-row`, last);
    check("it carries a No parent SOP pill", (await page.locator(`[data-testid="tobe-id-${ghost.id}-no-parent"]`).count()) === 1);
    await page.locator(`[data-testid="tobe-id-${ghost.id}-toggle"]`).click();
    await wait(page, `tobe-id-${ghost.id}-parent`);
    check("opening it offers Parent SOP to fix it", (await page.locator(`[data-testid="tobe-id-${ghost.id}-parent"]`).count()) === 1);
    // 고칠 수 있는 고르기 칸이고 목록의 SOP를 모두 보인다
    const parentPick = page.locator(`[data-testid="tobe-id-${ghost.id}-parent"]`);
    const isPicker = (await parentPick.getAttribute("role")) === "combobox" && (await parentPick.isEnabled());
    await parentPick.click();
    await wait(page, `tobe-id-${ghost.id}-parent-list`);
    // 항목 값은 줄 키(id-<줄 id>), 글은 번호
    const sopDocs = tobe.docs.filter((doc) => doc.doc_type === "sop");
    const offered = await Promise.all(
      sopDocs.map(async (doc) => {
        const option = page.locator(`[data-testid="tobe-id-${ghost.id}-parent-option-id-${doc.id}"]`);
        return (await option.count()) === 1 && ((await option.textContent()) ?? "").includes(doc.code) ? 1 : 0;
      }),
    );
    check("Parent SOP is an editable pick list of the SOPs", isPicker && offered.every((count) => count === 1), `${isPicker} ${offered.join(",")}`);
    await page.keyboard.press("Escape");
  } finally {
    await page.unroute(tobeRoute);
  }
});

// 다시 받기가 저장 도중에 시작해(다른 칸의 거절) 저장 앞의 목록을 읽고 저장 뒤에 오면, 저장한 값이 되돌아 보였다 - 저장이 끝날 때 다시 받는 중이면 한 번 더 받는다.
// 제목 저장(PATCH)은 1.5초 붙잡고, 그동안 다른 줄의 번호를 겹치게 고쳐 거절시킨다. 그 거절의 다시 받기(GET)는 바로 읽되 제목 저장의 응답 뒤까지 붙잡는다
await runStep("new documents: a reload that starts during a save does not undo the save", { allowConsoleErrors: true }, async ({ page }) => {
  const tobe = await readToBe(page, halfBundleId);
  const sop = tobe.docs.find((doc) => doc.code === "SOP-CF");
  const wi = tobe.docs.find((doc) => doc.doc_type === "wi" && doc.entrance === "assign");
  const sopPrefix = `tobe-id-${sop.id}`;
  const wiPrefix = `tobe-id-${wi.id}`;
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  await page.locator(`[data-testid="${sopPrefix}-toggle"]`).click();
  await page.locator(`[data-testid="${wiPrefix}-toggle"]`).click();
  await wait(page, `${wiPrefix}-code`);
  const patchRoute = `**/api/bundles/${halfBundleId}/tobe/docs/${sop.id}`;
  await page.route(patchRoute, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return route.continue();
  });
  // 제목 저장의 응답이 화면에 닿고 조금 뒤 - 붙잡은 다시 받기를 그때 놓는다
  const titleDone = page
    .waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith(`/tobe/docs/${sop.id}`), { timeout: T })
    .then(() => new Promise((resolve) => setTimeout(resolve, 300)));
  let heldGets = 0;
  const getRoute = `**/api/bundles/${halfBundleId}/tobe`;
  await page.route(getRoute, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    heldGets += 1;
    await titleDone;
    return route.fulfill({ response });
  });
  const newTitle = "Smoke: saved during a reload";
  try {
    await page.locator(`[data-testid="${sopPrefix}-title"]`).fill(newTitle);
    await page.keyboard.press("Enter");
    // 제목 저장이 붙잡힌 동안 다른 줄의 번호를 SOP-CF로 - 서버가 거절하고 목록을 다시 받는다
    await page.locator(`[data-testid="${wiPrefix}-code"]`).fill("SOP-CF");
    await page.keyboard.press("Enter");
    await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
    await titleDone;
    await page.unroute(getRoute);
    await settleToBe(page);
    await page.waitForTimeout(500);
    check("the reload started during the save and read before it", heldGets >= 1, String(heldGets));
    check("the saved title is still on the row", ((await page.locator(`[data-testid="${sopPrefix}-title-text"]`).textContent()) ?? "").trim() === newTitle, await page.locator(`[data-testid="${sopPrefix}-title-text"]`).textContent());
    check("and in the field", (await page.locator(`[data-testid="${sopPrefix}-title"]`).inputValue()) === newTitle);
  } finally {
    await page.unroute(patchRoute);
    await page.unroute(getRoute);
    await page.request.patch(`${BASE}/api/bundles/${halfBundleId}/tobe/docs/${sop.id}`, { headers: { "X-Dev-User": "qa.member", "Content-Type": "application/json" }, data: { title: sop.title } });
    check("the title is back for the next steps", (await readToBe(page, halfBundleId)).docs.find((doc) => doc.id === sop.id).title === sop.title);
  }
});

// WI 줄을 SOP 줄에 끌어 상위 SOP 바꾸기(Documents 화면 설계 §7) - 놓으면 바로 저장되고 알림의 Undo가 되돌린다. Restore의 알림도 Undo를 지닌다(§8).
// 둘째 SOP는 API로 만들고 끝에 지운다. 거절되는 Undo · 늦춘 저장이 있어 콘솔 오류를 허용한다
await runStep("new documents: drag a WI onto another SOP to change its parent, Undo on the toast puts it back", { allowConsoleErrors: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  await installCommitCounter(page);
  const start = await readToBe(page, halfBundleId);
  const sopCf = start.docs.find((doc) => doc.code === "SOP-CF");
  // 쓴 파일이 없는 WI 둘(부모 SOP-CF) - 끌어 옮기고 되돌린다
  const [w, x] = start.docs.filter((doc) => doc.doc_type === "wi" && doc.parent_code === "SOP-CF" && doc.document_id === null);
  const seedReason = start.na_slots.find((na) => na.code === "SOP-CF" && na.slot_key === "procedures.troubleshooting")?.reason ?? "";
  const parentOf = async (id) => (await readToBe(page, halfBundleId)).docs.find((doc) => doc.id === id)?.parent_code ?? null;
  const setParent = (id, code) => page.request.patch(`${api}/tobe/docs/${id}`, { headers: jsonHeaders, data: { parent_code: code } });
  // 화면에서 나간 줄 PATCH와 N/A 요청(page.request로 보낸 것은 잡히지 않는다)
  const patches = [];
  const naCalls = [];
  const pageErrors = [];
  page.on("request", (request) => {
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (request.method() === "PATCH" && /\/tobe\/docs\/\d+$/.test(path)) patches.push({ path, body: request.postData() ?? "" });
    if (/\/tobe\/docs\/\d+\/na\//.test(path)) naCalls.push({ method: request.method(), path, body: request.postData() ?? "" });
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  const row = (doc) => page.locator(`[data-testid="tobe-id-${doc.id}-row"]`);
  const titleOf = (doc) => page.locator(`[data-testid="tobe-id-${doc.id}-title-text"]`);
  const card = page.locator('[data-testid="drag-card"]');
  const noteText = () => page.locator('[data-testid="drag-status"]').evaluate((el) => (el.textContent ?? "").trim() || null);
  // 갈 곳은 표 끝에도 짧게(놓을 수 있을 때만) - 거절 이유는 상태 글에만
  const destText = () => card.locator(".drag-card-dest").evaluate((el) => (el.textContent ?? "").trim() || null);
  const dropOf = (locator) => locator.getAttribute("data-drop");
  const dropCount = () => page.locator("[data-drop]").count();
  const opacityOf = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));
  const waitOpacity = (testId, value) =>
    page.waitForFunction(({ id, v }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el !== null && Number(getComputedStyle(el).opacity) === v;
    }, { id: testId, v: value }, { timeout: 2000 }).then(() => true, () => false);
  const commits = () => page.evaluate(() => window.__commits ?? 0);
  const waitPatch = (id) => page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith(`/tobe/docs/${id}`), { timeout: T });
  const waitGet = () => page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith(`/bundles/${halfBundleId}/tobe`), { timeout: T });
  const openRows = async () => {
    await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
    await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  };
  // 상자를 창 위에서 top px에 둔다(앱 틀이 스크롤 칸) - 가장자리 자동 스크롤 띠(44px) 밖이다. 끄는 도중에도 쓴다
  const scrollTo = (locator, top = 320) => locator.evaluate((el, gap) => {
    const pane = el.closest(".frame-view");
    pane.scrollTop += el.getBoundingClientRect().top - gap;
  }, top);
  // 줄 안의 한 점 - 왼쪽 쪽(fx 0.35)이라 오른쪽 위의 알림과 겹치지 않는다
  const pointAt = async (locator, fx = 0.35, fy = 0.5) => {
    const box = await locator.boundingBox();
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  };
  // 상자 위쪽 24px 안(줄은 거의 가운데) - 펼친 칸 표처럼 창보다 긴 상자도 창 안의 점이다
  const moveOver = async (locator, fx = 0.35) => {
    await scrollTo(locator);
    const box = await locator.boundingBox();
    const point = { x: box.x + box.width * fx, y: box.y + Math.min(box.height / 2, 24) };
    await page.mouse.move(point.x, point.y, { steps: 6 });
    return point;
  };
  // 제목 글에서 누르고 문턱을 넘긴다 - 표가 뜰 때까지
  const startDrag = async (doc) => {
    await scrollTo(titleOf(doc));
    const point = await pointAt(titleOf(doc), 0.3);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 10, { steps: 5 });
    await card.waitFor({ timeout: T });
  };
  // 끌어 놓고 저장 응답과 다시 그리기를 기다린다
  const dropOn = async (doc, target) => {
    await startDrag(doc);
    await moveOver(row(target));
    const saved = waitPatch(doc.id);
    await page.mouse.up();
    const response = await saved;
    await settleToBe(page);
    return response;
  };
  const toastFor = (tone, text) => page.locator(`[data-testid="toast-${tone}"]`, { hasText: text }).last();
  let sopDrag = null;
  try {
    check("the seed has SOP-CF and two WIs without a written file under it", sopCf !== undefined && w !== undefined && x !== undefined, `${sopCf?.code} ${w?.code} ${x?.code}`);
    await openRows();
    const sopCount = start.docs.filter((doc) => doc.doc_type === "sop").length;
    check("with one SOP on the list no row drags", sopCount !== 1 || (await page.locator('[data-testid="tobe-list"] [data-drag-box]').count()) === 0, `${sopCount} SOPs`);

    await page.request.post(`${api}/tobe/docs`, { headers: jsonHeaders, data: { code: "SOP-DRAG", doc_type: "sop", parent_code: null } });
    const withDrag = await readToBe(page, halfBundleId);
    sopDrag = withDrag.docs.find((doc) => doc.code === "SOP-DRAG") ?? null;
    await openRows();

    // 1. 끌 수 있는 줄 - WI 줄마다, SOP 줄과 Old 줄에는 없다. 올리면 들린다
    const boxes = await page.locator('[data-testid="tobe-list"] [data-drag-box]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    const wiRows = withDrag.docs.filter((doc) => doc.doc_type === "wi").map((doc) => `tobe-id-${doc.id}-row`);
    const sopRows = withDrag.docs.filter((doc) => doc.doc_type === "sop").map((doc) => `tobe-id-${doc.id}-row`);
    check("every WI row drags and no SOP row does", wiRows.every((id) => boxes.includes(id)) && sopRows.every((id) => !boxes.includes(id)), boxes.join(","));
    check("Old rows do not drag", (await page.locator('[data-testid="documents-list"] [data-drag-box]').count()) === 0);
    await scrollTo(titleOf(w));
    const wPoint = await pointAt(titleOf(w), 0.3);
    await page.mouse.move(wPoint.x, wPoint.y);
    await page.waitForTimeout(300);
    const lifted = await row(w).evaluate((el) => getComputedStyle(el).boxShadow);
    await scrollTo(row(sopCf));
    const sopPoint = await pointAt(row(sopCf), 0.35, 0.3);
    await page.mouse.move(sopPoint.x, sopPoint.y);
    await page.waitForTimeout(300);
    const sopShadow = await row(sopCf).evaluate((el) => getComputedStyle(el).boxShadow);
    check("hovering a WI row lifts it, an SOP row stays flat", lifted !== "none" && sopShadow === "none", `${lifted} | ${sopShadow}`);

    // 2. 누르고 바로 떼면 펼친다
    await scrollTo(titleOf(w));
    const clickPoint = await pointAt(titleOf(w), 0.3);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await wait(page, `tobe-id-${w.id}-panel`);
    check("a press and release without moving opens the row", (await page.locator(`[data-testid="tobe-id-${w.id}-panel"]`).count()) === 1 && (await card.count()) === 0);
    await page.locator(`[data-testid="tobe-id-${w.id}-toggle"]`).click();
    await page.locator(`[data-testid="tobe-id-${w.id}-panel"]`).waitFor({ state: "detached", timeout: T });

    // 3. 끄는 동안 - 표 · 놓을 줄 · 끄는 줄 · 화면 틀의 표시, SOP 줄만 또렷, 올린 줄의 단추 숨김, 줄들 위를 지나도 다시 그리지 않는다
    await page.locator(`[data-testid="tobe-id-${sopCf.id}-toggle"]`).click();
    await wait(page, `tobe-id-${sopCf.id}-slots`);
    await startDrag(w);
    // 펼침 전환 · 툴팁 같은 늦은 커밋이 가라앉은 뒤부터 센다
    await page.waitForTimeout(300);
    const before = await commits();
    const passStart = await pointAt(row(w), 0.35);
    for (let i = 0; i < 30; i += 1) await page.mouse.move(passStart.x + (i % 2) * 40, Math.min(passStart.y + i * 9, 640));
    check("passing over rows for 30 steps does not re-render", (await commits()) === before, `${before} -> ${await commits()}`);
    await moveOver(row(sopDrag));
    check("the card reads Parent SOP: SOP-DRAG over another SOP", (await noteText()) === "Parent SOP: SOP-DRAG", await noteText());
    check("the card ends with → SOP-DRAG", (await destText()) === "→ SOP-DRAG", String(await destText()));
    check(
      "the SOP row is the drop target, the WI row is the source, the screen is marked",
      (await dropOf(row(sopDrag))) === "over" && (await row(w).getAttribute("data-drag-src")) !== null && (await page.locator('[data-testid="documents-drop"]').getAttribute("data-parent-drag")) !== null,
    );
    const dims = { x: await opacityOf(row(x)), old: await opacityOf(page.locator(".docs-old")), sopCf: await opacityOf(row(sopCf)), sopDrag: await opacityOf(row(sopDrag)) };
    check("other WI rows and the Old list dim, SOP rows stay clear", dims.x < 1 && dims.old < 1 && dims.sopCf === 1 && dims.sopDrag === 1, JSON.stringify(dims));
    // Old 줄은 목록 묶음(.docs-old)째 한 번만 흐린다 - 줄 자신까지 흐리면 0.35 × 0.35가 된다. 조상까지 곱한 실제 불투명도를 잰다
    const oldRowOpacity = await page.locator('[data-testid="documents-list"] .doc-row[data-kind="old"]').first().evaluate((el) => {
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    });
    check("an Old row dims once, as much as one dimming", Math.abs(oldRowOpacity - 0.35) < 0.01, String(oldRowOpacity));
    // ⋯의 testid는 단추에 있고 숨김(opacity)은 그 겉 .doc-more에 걸린다 - 겉 상자를 잰다
    const isMoreHidden = await page.waitForFunction((id) => {
      const wrap = document.querySelector(`[data-testid="${id}"]`)?.closest(".doc-more");
      return wrap != null && Number(getComputedStyle(wrap).opacity) === 0;
    }, `tobe-id-${sopDrag.id}-more`, { timeout: 2000 }).then(() => true, () => false);
    check("the hovered row's buttons stay hidden while dragging", (await waitOpacity(`tobe-id-${sopDrag.id}-acts`, 0)) && isMoreHidden);

    // 4. 못 놓는 곳은 이유를 말한다 - 그 밖은 표시도 메모도 없다
    await moveOver(row(x));
    check("over another WI: refused, A WI cannot be a parent", (await card.getAttribute("data-refused")) !== null && (await noteText()) === "A WI cannot be a parent" && (await destText()) === null && (await dropOf(row(x))) === "refused", await noteText());
    await moveOver(row(sopCf));
    check("over its own parent: refused, Already under this SOP", (await noteText()) === "Already under this SOP" && (await destText()) === null && (await dropOf(row(sopCf))) === "refused", await noteText());
    const silentOver = {};
    for (const [name, locator] of [
      ["own row", row(w)],
      ["Old row", page.locator('[data-testid="documents-list"] [data-testid^="documents-"][data-testid$="-row"]').first()],
      ["open panel", page.locator(`[data-testid="tobe-id-${sopCf.id}-slots"]`)],
      ["add row", page.locator('[data-testid="tobe-add-row"]')],
      ["empty", page.locator('[data-testid="tobe-count"]')],
    ]) {
      await moveOver(locator, 0.5);
      silentOver[name] = `${await dropCount()}:${await noteText()}:${await destText()}`;
    }
    check("nothing is marked over its own row, an Old row, an open panel, the add row or empty space", Object.values(silentOver).every((value) => value === "0:null:null"), JSON.stringify(silentOver));

    // 5. 놓이지 않는 것 - Esc, WI 위에 놓기, 빈 곳에 놓기
    await moveOver(row(sopDrag));
    await page.keyboard.press("Escape");
    const afterEsc = {
      card: await card.count(),
      drop: await dropCount(),
      mark: await page.locator("[data-parent-drag]").count(),
      src: await page.locator("[data-drag-src]").count(),
    };
    await page.mouse.up();
    check("Esc cancels and clears every mark", Object.values(afterEsc).every((n) => n === 0), JSON.stringify(afterEsc));
    await startDrag(w);
    await moveOver(row(x));
    await page.mouse.up();
    await startDrag(w);
    await moveOver(page.locator('[data-testid="tobe-count"]'), 0.5);
    await page.mouse.up();
    await page.waitForTimeout(400);
    check("Esc, a drop on a WI and a drop on empty space save nothing", patches.length === 0, JSON.stringify(patches));

    // 6. 놓는다 - PATCH 하나, 새 SOP 아래로 가서 번쩍이고 펼쳐지지 않는다, 알림에 Undo
    const flashed = page.waitForFunction((id) => document.querySelector(`[data-testid="tobe-id-${id}-row"]`)?.hasAttribute("data-flash"), w.id, { timeout: T }).then(() => true, () => false);
    const dropped = await dropOn(w, sopDrag);
    check("one PATCH with the new parent", patches.length === 1 && patches[0].path.endsWith(`/tobe/docs/${w.id}`) && patches[0].body === '{"parent_code":"SOP-DRAG"}' && dropped.status() === 200, JSON.stringify(patches));
    const order = await page.locator(`[data-testid="tobe-list"] .doc-row`).evaluateAll((els) => els.map((el) => el.dataset.testid));
    check("the WI row now sits right under SOP-DRAG as a child", order.indexOf(`tobe-id-${w.id}-row`) === order.indexOf(`tobe-id-${sopDrag.id}-row`) + 1 && (await row(w).getAttribute("data-child")) !== null, order.join(","));
    check("the moved row flashes", await flashed);
    check("the press after the drag is swallowed, the row does not open", (await page.locator(`[data-testid="tobe-id-${w.id}-panel"]`).count()) === 0);
    const movedToast = toastFor("ok", `${w.code} moved under SOP-DRAG`);
    await movedToast.waitFor({ timeout: T });
    const action = movedToast.locator('[data-testid^="toast-action-"]');
    check("the toast names the WI and the SOP and offers Undo", (await action.count()) === 1 && ((await action.textContent()) ?? "").trim() === "Undo");
    await page.reload();
    await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
    check("the new parent is saved", (await parentOf(w.id)) === "SOP-DRAG");

    // 7. 글쇠로 Undo
    await setParent(w.id, "SOP-CF");
    await openRows();
    await dropOn(w, sopDrag);
    const undoSaved = waitPatch(w.id);
    await toastFor("ok", `${w.code} moved under SOP-DRAG`).locator('[data-testid^="toast-action-"]').focus();
    await page.keyboard.press("Enter");
    await undoSaved;
    const backToast = toastFor("ok", `${w.code} moved under SOP-CF`);
    await backToast.waitFor({ timeout: T });
    check(
      "Enter on Undo puts the WI back under SOP-CF",
      patches.at(-1)?.body === '{"parent_code":"SOP-CF"}' && (await parentOf(w.id)) === "SOP-CF" && (await backToast.locator('[data-testid^="toast-action-"]').count()) === 0,
      JSON.stringify(patches.at(-1)),
    );

    // 8. 같은 일을 하는 길(G12) - 펼친 곳의 Parent SOP
    await openRows();
    await page.locator(`[data-testid="tobe-id-${w.id}-toggle"]`).click();
    await wait(page, `tobe-id-${w.id}-parent`);
    const picked = waitPatch(w.id);
    await page.locator(`[data-testid="tobe-id-${w.id}-parent"]`).click();
    await page.locator(`[data-testid="tobe-id-${w.id}-parent-option-id-${sopDrag.id}"]`).click();
    await picked;
    await settleToBe(page);
    check("Parent SOP in the open row still moves it", (await parentOf(w.id)) === "SOP-DRAG");
    await setParent(w.id, "SOP-CF");
    await openRows();

    // 9. Alt는 글자 긁기
    const title = titleOf(w);
    await scrollTo(title);
    const titleBox = await title.boundingBox();
    await page.mouse.move(titleBox.x + 2, titleBox.y + titleBox.height / 2);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(titleBox.x + titleBox.width - 2, titleBox.y + titleBox.height / 2, { steps: 10 });
    const altCards = await card.count();
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    check("Alt+drag selects the row's text and does not drag", altCards === 0 && selected !== "", `${altCards} "${selected}"`);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    // 10. 열린 메뉴는 줄을 누르면 닫힌다(G2 - 누름에서 preventDefault를 부르지 않는다)
    await page.locator('[data-testid="tobe-more"]').click();
    await wait(page, "tobe-more-menu");
    await scrollTo(titleOf(w));
    const menuPoint = await pointAt(titleOf(w), 0.3);
    await page.mouse.click(menuPoint.x, menuPoint.y);
    const menuClosed = await page.locator('[data-testid="tobe-more-menu"]').waitFor({ state: "detached", timeout: 2000 }).then(() => true, () => false);
    check("pressing a row closes an open menu", menuClosed);
    await openRows();

    // 11. 그사이 바뀐 뒤의 Undo - 남이 바꾼 것을 덮지 않는다
    await dropOn(w, sopDrag);
    const patchesBeforeStale = patches.length;
    await setParent(w.id, "SOP-CF");
    const reread = waitGet();
    await toastFor("ok", `${w.code} moved under SOP-DRAG`).locator('[data-testid^="toast-action-"]').click();
    await reread;
    const staleToast = toastFor("info", "The list changed after that. Nothing was undone.");
    await staleToast.waitFor({ timeout: T });
    check("Undo after someone else moved it writes nothing and says why", patches.length === patchesBeforeStale && (await parentOf(w.id)) === "SOP-CF", JSON.stringify(patches.slice(patchesBeforeStale)));
    await openRows();

    // 12. 잇달아 둘, 다른 화면에서 Undo - 알림마다 제 Undo
    await dropOn(w, sopDrag);
    await dropOn(x, sopDrag);
    check("two drops leave two Undo toasts", (await page.locator('[data-testid^="toast-action-"]').count()) === 2, String(await page.locator('[data-testid^="toast-action-"]').count()));
    await page.locator('[data-testid="stage-nav-outputs"]').click();
    await page.waitForURL(/\/outputs/, { timeout: T });
    const elsewhere = waitPatch(w.id);
    await toastFor("ok", `${w.code} moved under SOP-DRAG`).locator('[data-testid^="toast-action-"]').click();
    await elsewhere;
    await page.waitForTimeout(500);
    check("Undo from another screen puts back only its own WI", (await parentOf(w.id)) === "SOP-CF" && (await parentOf(x.id)) === "SOP-DRAG" && pageErrors.length === 0, pageErrors.join(" | "));
    await setParent(x.id, "SOP-CF");
    await openRows();

    // 13. 저장이 도는 사이에는 끌리지 않는다
    const slowRoute = `**/api/bundles/${halfBundleId}/tobe/docs/${w.id}`;
    await page.route(slowRoute, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.continue();
    });
    try {
      await startDrag(w);
      await moveOver(row(sopDrag));
      const slowSaved = waitPatch(w.id);
      await page.mouse.up();
      await scrollTo(titleOf(x));
      const xPoint = await pointAt(titleOf(x), 0.3);
      const xBox = (await row(x).getAttribute("data-drag-box")) !== null;
      await page.mouse.move(xPoint.x, xPoint.y);
      await page.mouse.down();
      await page.mouse.move(xPoint.x, xPoint.y + 40, { steps: 8 });
      const savingCards = await card.count();
      await page.mouse.up();
      check("while the save runs no row drags", !xBox && savingCards === 0, `${xBox} ${savingCards}`);
      await slowSaved;
      await settleToBe(page);
      check("after the save the rows drag again", (await row(x).getAttribute("data-drag-box")) !== null);
    } finally {
      await page.unroute(slowRoute);
    }
    await setParent(w.id, "SOP-CF");
    await openRows();

    // 14. Restore의 Undo - 지우기 전의 사유로 다시 N/A
    const prefix = `tobe-id-${sopCf.id}`;
    await page.locator(`[data-testid="${prefix}-toggle"]`).click();
    await wait(page, `${prefix}-slots`);
    const slotRow = page.locator(`[data-testid="${prefix}-slot-procedures.troubleshooting"]`);
    await slotRow.scrollIntoViewIfNeeded();
    await slotRow.hover();
    const cleared = page.waitForResponse((response) => response.request().method() === "DELETE" && decodeURIComponent(response.url()).endsWith("/na/procedures.troubleshooting"), { timeout: T });
    await page.locator(`[data-testid="${prefix}-na-procedures.troubleshooting-restore"]`).click();
    await cleared;
    // 알림의 칸 이름은 서버 골격의 "번호 이름"(선언한 절차 Troubleshooting - 6장의 둘째 절차)
    const restoredToast = toastFor("ok", `Restored ${slotName(readOutline(start, "SOP-CF").find((item) => item.key === "procedures.troubleshooting"))} in SOP-CF`);
    await restoredToast.waitFor({ timeout: T });
    check("Restore says so with an Undo", (await restoredToast.locator('[data-testid^="toast-action-"]').count()) === 1);
    const naSaved = page.waitForResponse((response) => response.request().method() === "PUT" && decodeURIComponent(response.url()).endsWith("/na/procedures.troubleshooting"), { timeout: T });
    await restoredToast.locator('[data-testid^="toast-action-"]').click();
    await naSaved;
    const put = naCalls.filter((call) => call.method === "PUT").at(-1);
    const back = (await readToBe(page, halfBundleId)).na_slots.find((na) => na.code === "SOP-CF" && na.slot_key === "procedures.troubleshooting");
    check("Undo saves the N/A again with the reason it had", seedReason !== "" && put !== undefined && JSON.parse(put.body).reason === seedReason && back?.reason === seedReason, `${put?.body} | ${back?.reason}`);
  } finally {
    // 중간에 멈췄어도 누른 단추를 놓는다(눌려 있지 않으면 아무 일도 없다)
    await page.mouse.up();
    for (const doc of [w, x]) if (doc && (await parentOf(doc.id)) !== "SOP-CF") await setParent(doc.id, "SOP-CF");
    const now = await readToBe(page, halfBundleId);
    if (seedReason !== "" && !now.na_slots.some((na) => na.code === "SOP-CF" && na.slot_key === "procedures.troubleshooting")) {
      await page.request.put(`${api}/tobe/docs/${sopCf.id}/na/procedures.troubleshooting`, { headers: jsonHeaders, data: { reason: seedReason } });
    }
    if (sopDrag) await page.request.delete(`${api}/tobe/docs/${sopDrag.id}`, { headers });
    const end = await readToBe(page, halfBundleId);
    check("the WIs are back under SOP-CF and SOP-DRAG is gone", [w, x].every((doc) => !doc || end.docs.find((item) => item.id === doc.id)?.parent_code === "SOP-CF") && !end.docs.some((doc) => doc.code === "SOP-DRAG"));
  }
});

// 긴 목록에서 위의 WI를 아래 끝 SOP로 끌어(가장자리 자동 스크롤) 놓으면 그 줄은 새 자리에서 보인다 - 미끄러지는 중의 옛 자리로 화면을 끌고 올라가지 않는다.
// SOP 둘과 그 사이 WI 12개는 API로 만들고 끝에 지운다
await runStep("new documents: a WI dragged far down a long list stays in view where it lands", { allowConsoleErrors: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const api = `${BASE}/api/bundles/${halfBundleId}`;
  const isLongDoc = (doc) => doc.code.startsWith("WI-LONG-") || doc.code.startsWith("SOP-LONG-");
  const frameScroll = () => page.evaluate(() => document.querySelector(".frame-view")?.scrollTop ?? -1);
  try {
    const post = (data) => page.request.post(`${api}/tobe/docs`, { headers: jsonHeaders, data });
    await post({ code: "SOP-LONG-A", doc_type: "sop", parent_code: null });
    for (let i = 1; i <= 12; i += 1) await post({ code: `WI-LONG-${String(i).padStart(2, "0")}`, doc_type: "wi", parent_code: "SOP-LONG-A" });
    await post({ code: "SOP-LONG-B", doc_type: "sop", parent_code: null });
    const tobe = await readToBe(page, halfBundleId);
    const byCode = (code) => tobe.docs.find((doc) => doc.code === code);
    const [sopA, moving, sopB] = [byCode("SOP-LONG-A"), byCode("WI-LONG-01"), byCode("SOP-LONG-B")];
    const rowOf = (doc) => page.locator(`[data-testid="tobe-id-${doc.id}-row"]`);
    await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
    await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
    // SOP-LONG-A를 창 위쪽에 둔다 - 끌 줄은 가장자리 띠 밖이고 SOP-LONG-B는 창 아래 밖이다
    await rowOf(sopA).evaluate((el) => {
      const pane = el.closest(".frame-view");
      pane.scrollTop += el.getBoundingClientRect().top - 120;
    });
    const startBox = await rowOf(sopB).boundingBox();
    check("the target SOP starts below the window", startBox.y > VIEWPORT.height, JSON.stringify(startBox));
    const title = await page.locator(`[data-testid="tobe-id-${moving.id}-title-text"]`).boundingBox();
    const from = { x: title.x + Math.min(title.width * 0.3, 40), y: title.y + title.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 10, { steps: 5 });
    await page.locator('[data-testid="drag-card"]').waitFor({ timeout: T });
    // 창 아래 가장자리(자동 스크롤 띠 44px 안)에 멈춰 앱 틀이 끝까지 내려가게 한다
    await page.mouse.move(from.x, VIEWPORT.height - 12, { steps: 10 });
    await page.waitForFunction(() => {
      const pane = document.querySelector(".frame-view");
      return pane !== null && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
    }, null, { timeout: T });
    const targetBox = await rowOf(sopB).boundingBox();
    await page.mouse.move(from.x, targetBox.y + Math.min(targetBox.height / 2, 24), { steps: 6 });
    const note = await page.locator('[data-testid="drag-status"]').evaluate((el) => (el.textContent ?? "").trim() || null);
    const dest = await page.locator('[data-testid="drag-card"] .drag-card-dest').evaluate((el) => (el.textContent ?? "").trim() || null);
    check("auto-scroll brought SOP-LONG-B under the pointer", note === "Parent SOP: SOP-LONG-B" && dest === "→ SOP-LONG-B", `${note} / ${dest}`);
    const scrollAtDrop = await frameScroll();
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith(`/tobe/docs/${moving.id}`), { timeout: T });
    await page.mouse.up();
    check("the drop saves", (await saved).status() === 200);
    await settleToBe(page);
    // 미끄러짐(--dur-slow)과 스크롤이 끝난 뒤
    await page.waitForTimeout(800);
    const landed = await rowOf(moving).boundingBox();
    const scrollAfter = await frameScroll();
    check("the moved row is inside the window where it landed", landed !== null && landed.y >= 44 && landed.y + landed.height <= VIEWPORT.height, JSON.stringify(landed));
    check("the view did not jump back toward the row's old place", scrollAfter >= scrollAtDrop - 80, `${scrollAtDrop} -> ${scrollAfter}`);
  } finally {
    await page.mouse.up();
    // WI부터 지운다 - 아래에 WI가 있는 SOP는 지울 수 없다
    const now = await readToBe(page, halfBundleId);
    const made = now.docs.filter(isLongDoc).sort((a, b) => (a.doc_type === b.doc_type ? 0 : a.doc_type === "wi" ? -1 : 1));
    for (const doc of made) await page.request.delete(`${api}/tobe/docs/${doc.id}`, { headers });
    check("the long-list rows are gone again", !(await readToBe(page, halfBundleId)).docs.some(isLongDoc));
  }
});

// 읽기 전용 Bundle(검토 대기, 검토자)에서는 끌 상자가 없다 - 눌러 움직여도 끌기가 아니고 떼면 펼친다
await runStep("new documents: nothing drags on a read-only bundle", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  const tobe = await (await page.request.get(`${BASE}/api/bundles/${reviewId}/tobe`, { headers: { "X-Dev-User": "qa.lead" } })).json();
  const wi = tobe.docs.find((doc) => doc.doc_type === "wi");
  let patchCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/tobe\/docs\/\d+$/.test(new URL(request.url()).pathname)) patchCount += 1;
  });
  await page.goto(`${BASE}/bundles/${reviewId}/documents`);
  await page.locator(TOBE_ROWS).first().waitFor({ timeout: T });
  check("no row carries a drag box", (await page.locator('[data-testid="tobe-list"] [data-drag-box]').count()) === 0);
  const wiRow = page.locator(`[data-testid="tobe-id-${wi.id}-row"]`);
  await wiRow.scrollIntoViewIfNeeded();
  // 줄 오른쪽의 빈 자리에서 누른다 - 글자 위를 지나면 글자가 긁혀 떼도 펼치지 않는다(지금의 규칙)
  const box = await wiRow.boundingBox();
  const from = { x: box.x + box.width * 0.92, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y, { steps: 8 });
  const cards = await page.locator('[data-testid="drag-card"]').count();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("pressing and moving 40px does not drag or save", cards === 0 && patchCount === 0, `${cards} ${patchCount}`);
  check("releasing opens the row", (await page.locator(`[data-testid="tobe-id-${wi.id}-toggle"]`).getAttribute("aria-expanded")) === "true");
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
  // 미리 보기는 그 줄을 펼친 곳의 Written file 묶음에 있다
  const writtenRow = page.locator('[data-testid="tobe-list"] [data-testid$="-row"]').filter({ has: page.locator('[data-testid$="-written"]:not([data-testid$="-not-written"])') }).first();
  const writtenPrefix = (await writtenRow.getAttribute("data-testid")).replace(/-row$/, "");
  await page.locator(`[data-testid="${writtenPrefix}-toggle"]`).click();
  await page.locator(`[data-testid="${writtenPrefix}-written-preview"]`).click();
  await wait(page, "documents-preview-split");
  check("the file's preview opens from the row", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="documents-preview-split"]').waitFor({ state: "detached", timeout: T });
  // Excel 템플릿·가져오기는 메뉴에 있다
  await page.locator('[data-testid="tobe-more"]').click();
  await wait(page, "tobe-more-menu");
  check("the Excel template and import sit in the menu", (await page.locator('[data-testid="tobe-template"]').count()) === 1 && (await page.locator('[data-testid="tobe-import"]').count()) === 1);
  await page.keyboard.press("Escape");
  // 펼친 줄에 그 파일의 버전과 언어 배치가 있다
  await page.locator(`[data-testid="${writtenPrefix}-written-detail"]`).waitFor({ timeout: T });
  check("opening the row shows the file's version and language layout", (await page.locator('[data-testid$="-written-version"]').count()) === 1 && (await page.locator('[data-testid$="-written-layout"]').count()) === 1);
});

// 올리는 창구 하나(v1.0.31) - Old와 New 파일을 한 창에서 올린다. 앱이 파일 이름의 번호로 쪽을 먼저 고르고, New 파일은 번호가 같은 빈 줄에 붙는다.
// 묶음을 만들 권한이 있는 사람으로 새 묶음에서 하고, 끝에 그 묶음을 지운다(올릴 파일은 backend venv로 합성 생성기를 돌려 만든다)
await runStep("documents: one upload window takes Old and New files", { devUser: "dev.admin" }, async ({ page, takeShot }) => {
  const samples = buildSyntheticFiles();
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

await runStep("documents: the upload window sorts files into Old and New groups, a row drags between them, files drop in", { devUser: "dev.admin" }, async ({ page }) => {
  const bundle = await openUploadBundle(page, "SYNTHETIC upload groups");
  // 이 단계는 올리지 않는다 - 끝까지 0이어야 한다
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/bundles/${bundle.id}/documents`) uploads += 1;
  });
  const input = page.locator('[data-testid="upload-files"]');
  const submit = page.locator('[data-testid="upload-submit"]');
  const card = page.locator('[data-testid="drag-card"]');
  const item = (index) => page.locator(`[data-testid="upload-picked-${index}"]`);
  const group = (side) => page.locator(`[data-testid="upload-group-${side}"]`);
  const groupOf = (index) => item(index).evaluate((el) => el.closest("[data-upload-zone]")?.dataset.uploadZone ?? null);
  const waitGroup = (index, side) =>
    page.waitForFunction(([at, zone]) => document.querySelector(`[data-testid="upload-picked-${at}"]`)?.closest("[data-upload-zone]")?.dataset.uploadZone === zone, [index, side], { timeout: T });
  const countOf = async (side) => (await getText(page, `upload-group-${side}-count`)).trim();
  const pressed = async (index) => ((await page.locator(`[data-testid="upload-side-${index}-new"]`).getAttribute("aria-pressed")) === "true" ? "new" : "old");
  const note = async (index) => (await getText(page, `upload-note-${index}`)).replace(/\s+/g, " ").trim();
  const rowCount = () => page.locator('[data-testid="upload"] .upload-item').count();
  const waitSubmit = (state) => page.locator(`[data-testid="upload-submit"]${state === "on" ? ":not([disabled])" : "[disabled]"}`).waitFor({ timeout: T }).then(() => true, () => false);
  const cardNote = () => page.locator('[data-testid="drag-status"]').evaluate((el) => (el.textContent ?? "").trim() || null);
  const cardDest = () => card.locator(".drag-card-dest").evaluate((el) => (el.textContent ?? "").trim() || null);
  const centerOf = async (locator) => {
    const box = await locator.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // 묶음의 머리 위로 간다 - 머리도 놓을 곳이고 줄 안의 단추를 피한다
  const moveOver = async (side) => {
    const point = await centerOf(group(side).locator(".upload-group-head"));
    await page.mouse.move(point.x, point.y, { steps: 8 });
  };
  // 줄의 크기 글에서 누르고 문턱을 넘긴다 - 표가 뜰 때까지(단추 · 고르기 칸 · 포커스를 받는 파일 이름 밖)
  const startDrag = async (index) => {
    await item(index).scrollIntoViewIfNeeded();
    const point = await centerOf(page.locator(`[data-testid="upload-size-${index}"]`));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 10, { steps: 5 });
    await card.waitFor({ timeout: T });
  };
  const dragTo = async (index, side) => {
    await startDrag(index);
    await moveOver(side);
    await page.mouse.up();
    await waitGroup(index, side);
  };
  // 누른 채 움직였을 때 표가 떴나 - 끌기가 아닌 누름이면 0
  const pressOn = async (testId) => {
    const point = await centerOf(page.locator(`[data-testid="${testId}"]`));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 30, { steps: 6 });
    const cards = await card.count();
    await page.mouse.up();
    return cards;
  };
  const four = () => [bundle.sample(UPLOAD_SAMPLES.old6), bundle.sample(UPLOAD_SAMPLES.wi05), bundle.sample(UPLOAD_SAMPLES.wi04), bundle.made("SYNTHETIC_notes.docx")];
  try {
    await page.goto(`${BASE}/bundles/${bundle.id}/documents`);
    await bundle.openWindow();
    check("an empty window shows both groups with a place to drop", (await page.locator('[data-testid="upload-group-old-empty"], [data-testid="upload-group-new-empty"]').count()) === 2 && (await submit.isDisabled()));

    // 1. 두 묶음 - 자리 번호는 고른 순서다(0 OLD-6, 1 WI-05, 2 WI-04, 3 번호 없음)
    await input.setInputFiles(four());
    await item(3).waitFor({ timeout: T });
    // New 목록을 읽은 뒤에 쪽이 정해진다
    await waitGroup(1, "new");
    const groups = [await groupOf(0), await groupOf(1), await groupOf(2), await groupOf(3)].join(",");
    check("the files sort into the Old group and the New group, each with its count", groups === "old,new,old,old" && (await countOf("old")) === "3" && (await countOf("new")) === "1", `${groups} | ${await countOf("old")} ${await countOf("new")}`);
    check("an Old row says what uploading adds", (await note(0)) === "Adds OLD-6 to Old documents", await note(0));
    check("a New row says which listed row it attaches to", (await note(1)).includes("WI-05"), await note(1));
    check("a file without a number says so and that it is set later", (await note(3)).includes("No number in the file name") && (await note(3)).includes("Set it after it is read"), await note(3));
    const size = (await getText(page, "upload-size-0")).trim();
    check("each row shows the file size", /^\d+(\.\d)? (KB|MB)$/.test(size), size);

    // 2. 고르기는 더한다 - 같은 파일은 늘지 않고 앞서 고른 쪽이 남는다(Review Focus 5)
    await page.locator('[data-testid="upload-side-0-new"]').click();
    await waitGroup(0, "new");
    await input.setInputFiles([bundle.sample(UPLOAD_SAMPLES.old6), bundle.made("SYNTHETIC_extra.docx")]);
    await item(4).waitFor({ timeout: T });
    const sidesAfter = [await pressed(0), await pressed(1), await pressed(2), await pressed(3), await pressed(4)].join(",");
    check("choosing again adds: the same file is not added twice and keeps the side chosen for it", (await rowCount()) === 5 && sidesAfter === "new,new,old,old,old", `${await rowCount()} rows | ${sidesAfter}`);
    await page.locator('[data-testid="upload-side-0-old"]').click();
    await waitGroup(0, "old");
    await page.locator('[data-testid="upload-remove-4"]').click();
    await item(4).waitFor({ state: "detached", timeout: T });
    check("the remove button takes a row out", (await rowCount()) === 4, String(await rowCount()));

    // 3. 줄을 끌어 묶음을 바꾼다 - 제 묶음 위에서는 표시가 없다
    check("rows are draggable boxes while picking", (await page.locator('[data-testid="upload"] .upload-item[data-drag-box]').count()) === 4);
    await startDrag(2);
    check("the card carries the side the row is on and the file name", (await card.locator(".drag-card-id").innerText()).trim() === "Old" && (await card.locator(".drag-card-text").innerText()).includes("WI-04"));
    await moveOver("old");
    check("over its own group nothing is marked and the card says nothing", (await page.locator("[data-drop]").count()) === 0 && (await cardNote()) === null && (await cardDest()) === null, String(await cardNote()));
    await moveOver("new");
    check("over the other group the card reads Side: New and that group is the drop target", (await cardNote()) === "Side: New" && (await group("new").getAttribute("data-drop")) === "over", String(await cardNote()));
    check("over the other group the card ends with → New", (await cardDest()) === "→ New", String(await cardDest()));
    await page.mouse.up();
    await waitGroup(2, "new");
    check("dropping moves the row to the New group, the same as pressing New", (await pressed(2)) === "new" && (await note(2)).startsWith("Creates"), await note(2));
    check("nothing stays marked after the drop", (await page.locator("[data-drop], [data-drag-src]").count()) === 0 && (await card.count()) === 0);
    // 줄 안의 단추 · 고르기 칸에서 누른 것은 끌기가 아니다(G4)
    const guarded = [await pressOn("upload-side-2-old"), await pressOn("upload-kind-2")];
    check("a press that starts on the Old | New buttons or a select is not a drag and changes nothing", guarded.join(",") === "0,0" && (await pressed(2)) === "new", guarded.join(","));

    // 4. Esc는 끌기만 취소한다 - 창은 그대로 열려 있다
    await startDrag(0);
    await moveOver("new");
    await page.keyboard.press("Escape");
    check(
      "Esc cancels the drag only: no card, the window stays open, the row stays in the Old group",
      (await card.count()) === 0 && (await page.locator('[data-testid="upload"]').count()) === 1 && (await groupOf(0)) === "old" && (await page.locator("[data-drop]").count()) === 0,
    );
    await page.mouse.up();

    // 5. 단추도 같은 결과다(G12)
    await page.locator('[data-testid="upload-side-2-old"]').click();
    await waitGroup(2, "old");
    check("the Old button does what the drag does", (await note(2)) === "Adds WI-04 to Old documents", await note(2));
    // 자판으로 - 줄이 다른 묶음으로 옮겨 가도(다시 그려진다) 포커스가 그 줄의 같은 단추에 남아 잇달아 누를 수 있다
    await page.locator('[data-testid="upload-side-2-new"]').focus();
    await page.keyboard.press("Enter");
    await waitGroup(2, "new");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
    check("pressing New from the keyboard keeps focus on that button in the moved row", focused === "upload-side-2-new", String(focused));

    // 6. 올리기 단추가 꺼지는 때 - 새 줄이 생기는 WI는 상위 SOP를 골라야 한다(지금 규칙)
    await page.locator('[data-testid="upload-kind-2"]').click();
    await page.locator('[data-testid="upload-kind-2-option-wi"]').click();
    check("a WI that makes a new row turns Upload off until its parent SOP is picked", await waitSubmit("off"));
    await page.locator('[data-testid="upload-parent-2"]').click();
    await page.locator('[data-testid="upload-parent-2-option-SOP-01"]').click();
    check("picking the parent SOP turns Upload on", await waitSubmit("on"));
    await dragTo(2, "old");
    check("dragging that row to the Old group keeps Upload on", (await submit.isEnabled()) && (await note(2)) === "Adds WI-04 to Old documents", await note(2));

    // 7. 붙일 수 없는 쪽 - New 목록의 WI-05에 이미 파일이 붙은 것으로 읽히게 하고 창을 다시 연다(같은 파일 넷)
    await page.locator('[data-testid="upload-cancel"]').click();
    await page.locator('[data-testid="upload"]').waitFor({ state: "detached", timeout: T });
    const tobeRoute = `**/api/bundles/${bundle.id}/tobe`;
    await page.route(tobeRoute, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({ response, json: { ...body, docs: body.docs.map((doc) => (doc.code === "WI-05" ? { ...doc, entrance: "match", document_id: 9 } : doc)) } });
    });
    try {
      await bundle.openWindow();
      await input.setInputFiles(four());
      const isRed = await page.locator('[data-testid="upload-note-1"].text-danger').waitFor({ timeout: T }).then(() => true, () => false);
      check("a New file whose listed row already has a file says why in red and Upload is off", isRed && (await note(1)).includes("already has a written file") && (await submit.isDisabled()), await note(1));
      await dragTo(1, "old");
      check("dragging it to the Old group turns Upload on", await waitSubmit("on"));
    } finally {
      await page.unroute(tobeRoute);
    }

    // 8. 창 안에 파일을 놓는다 - 묶음 위면 그 쪽, 창의 다른 곳이면 앱이 고른다
    const transfer = (name) =>
      page.evaluateHandle((fileName) => {
        const data = new DataTransfer();
        data.items.add(new File(["x"], fileName));
        return data;
      }, name);
    const url = page.url();
    const toNew = await transfer("dropped-new.docx");
    await page.dispatchEvent('[data-testid="upload-group-new"]', "dragover", { dataTransfer: toNew });
    check("dragging a file over a group marks that group and the window", (await group("new").getAttribute("data-drop")) === "over" && (await page.locator('[data-testid="upload"] [data-file-drag]').count()) === 1);
    await page.dispatchEvent('[data-testid="upload-group-new"]', "drop", { dataTransfer: toNew });
    await item(4).waitFor({ timeout: T });
    // 파일 이름은 머리와 꼬리 두 조각으로 그려진다 - 보이는 글(innerText)이 아니라 textContent로 읽는다
    const droppedName = await item(4).locator(".file-name").evaluate((el) => el.textContent);
    check("dropping it on the New group adds it there with New pressed", (await groupOf(4)) === "new" && (await pressed(4)) === "new" && droppedName === "dropped-new.docx", droppedName);
    check("the marks go away after the drop", (await page.locator("[data-drop], [data-file-drag]").count()) === 0);
    const toAny = await transfer("dropped-any.docx");
    await page.dispatchEvent('[data-testid="upload"] h2', "dragover", { dataTransfer: toAny });
    await page.dispatchEvent('[data-testid="upload"] h2', "drop", { dataTransfer: toAny });
    await item(5).waitFor({ timeout: T });
    check("dropping on the title of the window lets the app pick the side", (await groupOf(5)) === "old" && (await pressed(5)) === "old");
    // 같은 파일을 다시 놓는다 - 다른 묶음 위에 놓아도 줄이 늘지 않고 제자리다
    await page.dispatchEvent('[data-testid="upload"] h2', "drop", { dataTransfer: toAny });
    await page.dispatchEvent('[data-testid="upload-group-new"]', "drop", { dataTransfer: toAny });
    await page.waitForTimeout(300);
    check("the same file dropped again adds no row and stays where it was", (await rowCount()) === 6 && (await groupOf(5)) === "old", String(await rowCount()));
    // 스크립트가 보낸 놓기는 브라우저가 파일을 열지 않는다 - 창이 끌기와 놓기를 가져갔는지(preventDefault)를 직접 본다
    const taken = await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "dropped-any.docx"));
      const title = document.querySelector('[data-testid="upload"] h2');
      return ["dragover", "drop"].map((type) => !title.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data })));
    });
    check("the window takes the file drag and the drop, so the browser does not open the file", taken.every(Boolean) && page.url() === url && (await rowCount()) === 6, `${taken} | ${page.url()}`);

    // 9. 많은 파일 - 묶음 영역만 스크롤하고 아래 단추는 창 안에 남는다
    await input.setInputFiles(Array.from({ length: 30 }, (_, at) => bundle.made(`SYNTHETIC_many-${String(at + 1).padStart(2, "0")}.docx`)));
    await item(35).waitFor({ timeout: T });
    const area = await page.locator('[data-testid="upload-picked"]').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    const submitBox = await submit.boundingBox();
    check(
      "with many files the groups scroll inside the window and Upload stays in view",
      area.scroll > area.client && submitBox.y + submitBox.height <= page.viewportSize().height,
      `${area.scroll} > ${area.client} | bottom ${Math.round(submitBox.y + submitBox.height)}`,
    );
    await page.locator('[data-testid="upload-cancel"]').click();
    check("nothing was uploaded in this step", uploads === 0, String(uploads));
  } finally {
    await bundle.remove();
  }
});

// 올리는 국면 - 묶음과 줄이 제자리에 남고 줄의 아랫줄이 Waiting → Reading → 결과로 바뀐다. 차례는 Old 묶음 다음 New 묶음.
// 요청이 실패하는 줄을 일부러 만들므로(올리기 응답 하나를 500으로 바꾼다) 콘솔 오류는 세지 않는다
await runStep("documents: uploading keeps each row in its group and shows Waiting, Reading and the result", { devUser: "dev.admin", allowConsoleErrors: true }, async ({ page }) => {
  const bundle = await openUploadBundle(page, "SYNTHETIC upload results");
  const docsRoute = `**/api/bundles/${bundle.id}/documents`;
  const row = (index) => page.locator(`[data-testid="upload-row-${index}"]`);
  const state = (index) => page.locator(`[data-testid="upload-row-${index}-state"]`);
  const groupOfRow = (index) => row(index).evaluate((el) => el.closest("[data-upload-zone]")?.dataset.uploadZone ?? null);
  const stateOf = async (index) => `${await state(index).getAttribute("data-state")}:${(await state(index).innerText()).trim()}`;
  const readDocuments = async () => (await page.request.get(`${BASE}/api/bundles/${bundle.id}/documents`, { headers: bundle.headers })).json();
  try {
    await page.goto(`${BASE}/bundles/${bundle.id}/documents`);
    await bundle.openWindow();
    // 0 OLD-6(Old) · 1 WI-05(New, 목록 줄에 붙는다) · 2 내용이 docx가 아닌 파일(번호가 없어 Old) · 3 요청이 실패할 파일(Old)
    await page.locator('[data-testid="upload-files"]').setInputFiles([
      bundle.sample(UPLOAD_SAMPLES.old6),
      bundle.sample(UPLOAD_SAMPLES.wi05),
      bundle.made("SYNTHETIC_broken.docx", "SYNTHETIC: this is not a Word file"),
      bundle.made("SYNTHETIC_refused.docx"),
    ]);
    await page.waitForFunction(() => document.querySelector('[data-testid="upload-side-1-new"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
    // 올리기 요청을 1.2초씩 늦춘다 - 읽는 중인 줄과 기다리는 줄을 볼 틈. 줄 3의 요청은 서버에 보내지 않고 500으로 답한다
    await page.route(docsRoute, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((done) => setTimeout(done, 1200));
      if (route.request().postDataBuffer()?.includes("SYNTHETIC_refused.docx")) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "synthetic failure" }) });
      return route.continue();
    });
    // 줄이 읽는 중이 되는 차례를 적어 둔다
    await page.evaluate(() => {
      window.__uploadingOrder = [];
      const root = document.querySelector('[data-testid="upload"]');
      new MutationObserver(() => {
        for (const el of root.querySelectorAll('[data-testid$="-state"][data-state="uploading"]')) {
          const index = Number(el.closest(".upload-item").dataset.index);
          if (window.__uploadingOrder.at(-1) !== index) window.__uploadingOrder.push(index);
        }
      }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    });

    // 1. 올리는 동안
    await page.locator('[data-testid="upload-submit"]').click();
    await page.locator('[data-testid="upload-row-0-state"][data-state="uploading"]').waitFor({ timeout: T });
    const during = [await stateOf(0), await stateOf(2), await stateOf(3), await stateOf(1)].join(" | ");
    check("the first Old row reads Reading and the rest wait", during === "uploading:Reading | waiting:Waiting | waiting:Waiting | waiting:Waiting", during);
    const groups = [await groupOfRow(0), await groupOfRow(1), await groupOfRow(2), await groupOfRow(3)].join(",");
    check(
      "the frame turns into the results and each row stays in its group",
      (await page.locator('[data-testid="upload-results"]').count()) === 1 && (await page.locator('[data-testid="upload-picked"]').count()) === 0 && groups === "old,new,old,old",
      groups,
    );
    // 올리는 동안 놓은 파일 - 받지 않되 브라우저가 열지 못하게 막기는 한다(열리면 올리던 것이 끊긴다)
    const midDrop = await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "dropped-late.docx"));
      const zone = document.querySelector('[data-testid="upload-group-old"]');
      return ["dragover", "drop"].map((type) => !zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data })));
    });
    check("a file dropped while uploading is blocked and adds no row", midDrop.every(Boolean) && (await page.locator('[data-testid="upload"] .upload-item').count()) === 4 && (await page.locator("[data-drop], [data-file-drag]").count()) === 0, String(midDrop));
    check("rows no longer drag, switch side or come out, and no file can be chosen", (await page.locator('[data-testid="upload"] [data-drag-box], [data-testid^="upload-side-"], [data-testid^="upload-remove-"], [data-testid="upload-pick"]').count()) === 0);
    const isCloseOff = await page.locator('[data-testid="upload-done"]').isDisabled();
    await page.keyboard.press("Escape");
    check("Close is off and Esc does not close the window while a file is read", isCloseOff && (await page.locator('[data-testid="upload"]').count()) === 1);

    // 2. 차례 - Old 묶음의 위에서 아래(줄 0 · 2 · 3), 그다음 New 묶음(줄 1)
    await page.locator('[data-testid="upload-done"]:not([disabled])').waitFor({ timeout: 120000 });
    const order = await page.evaluate(() => window.__uploadingOrder);
    check("the Old group uploads first from the top, then the New group", JSON.stringify(order) === "[0,2,3,1]", JSON.stringify(order));
    // 요청이 실패한 줄은 제 줄에만 까닭을 남기고, 그 뒤의 줄(줄 1)은 그대로 올라간다
    const failed = page.locator('[data-testid="upload-row-3-reason"]');
    const failedText = (await failed.count()) === 1 ? (await failed.innerText()).trim() : "";
    check(
      "a request that fails marks only its own row and the rows after it still upload",
      (await state(3).getAttribute("data-state")) === "error" && failedText !== "" && (await groupOfRow(3)) === "old" && (await state(1).getAttribute("data-state")) === "done" && (await state(2).getAttribute("data-state")) === "done",
      `${await state(3).getAttribute("data-state")} | ${failedText}`,
    );

    // 3. 끝난 뒤 - 읽힌 Old는 그 자리에서 고치고, New는 붙은 줄의 번호, 받지 못한 파일은 까닭과 함께 제 묶음에 남는다(Review Focus 5)
    const code = (await getText(page, "upload-row-0-code")).trim();
    check(
      "a read Old file is edited in place: number, version and language layout",
      code === "OLD-6" && (await page.locator('[data-testid="upload-row-0-version"]').count()) === 1 && (await page.locator('[data-testid="upload-row-0-layout"]').count()) === 1,
      code,
    );
    check("a New file shows the listed row it attached to", (await getText(page, "upload-row-1-listed")).trim() === "WI-05", await getText(page, "upload-row-1-listed"));
    const pill = (await page.locator('[data-testid="upload-row-2-status"]').count()) === 1 ? (await getText(page, "upload-row-2-status")).trim() : "";
    const why = page.locator('[data-testid="upload-row-2-reason"]');
    const whyText = (await why.count()) === 1 ? (await why.innerText()).trim() : "";
    check(
      "a file that was not accepted stays in its group with a pill and a red reason",
      (await state(2).getAttribute("data-state")) === "done" && ["Rejected", "Failed"].includes(pill) && whyText !== "" && (await why.evaluate((el) => el.classList.contains("text-danger"))) && (await groupOfRow(2)) === "old",
      `${await state(2).getAttribute("data-state")} | ${pill} | ${whyText}`,
    );
    check("Close is on and Go to Assign is there", (await page.locator('[data-testid="upload-done"]').isEnabled()) && (await page.locator('[data-testid="upload-go-assign"]').count()) === 1);
    const version = page.locator('[data-testid="upload-row-0-version"]');
    await version.fill("7.3");
    const saved = page.waitForResponse((response) => response.request().method() !== "GET" && /\/documents\/\d+$/.test(new URL(response.url()).pathname), { timeout: T });
    await version.press("Enter");
    await saved;
    const documents = await readDocuments();
    const old6 = documents.find((doc) => doc.doc_code === "OLD-6");
    check("changing the version in the row saves it", old6?.doc_version === "7.3", String(old6?.doc_version));

    // 4. 닫은 뒤 - 두 목록에 결과가 있다
    await page.locator('[data-testid="upload-done"]').click();
    const refused = documents.find((doc) => doc.file_name === "SYNTHETIC_broken.docx");
    const tobe = await (await page.request.get(`${BASE}/api/bundles/${bundle.id}/tobe`, { headers: bundle.headers })).json();
    const wi05 = tobe.docs.find((doc) => doc.code === "WI-05");
    const shown = (testId) => page.locator(`[data-testid="${testId}"]`).first().waitFor({ timeout: T }).then(() => getText(page, testId), () => "");
    check("after closing, the Old list has the OLD-6 row", (await shown(`documents-${old6?.id}-code-text`)).trim() === "OLD-6");
    check("the file that was not accepted is on the Old list with its reason", (await shown(`documents-${refused?.id}-reason`)).trim() !== "");
    const written = await shown(`tobe-id-${wi05?.id}-written`);
    check("the WI-05 row on the New list carries the file name", written.includes(UPLOAD_SAMPLES.wi05.slice(0, 12)), written);
  } finally {
    await page.unroute(docsRoute);
    await bundle.remove();
  }
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
  await page.locator('[data-testid^="tobe-id-"][data-testid$="-code-text"]').nth(3).waitFor({ timeout: T });
  const shownCodes = await page.locator('[data-testid^="tobe-id-"][data-testid$="-code-text"]').evaluateAll((cells) => cells.map((cell) => cell.value ?? cell.textContent));
  check("the new rows show on the list without a reload", ["SOP-QC-0300", "WI-QC-0301", "QC-0400"].every((code) => shownCodes.includes(code)), shownCodes.join(","));
  const left = await (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe/read`, { headers })).json();
  check("the proposal is closed once it is used", left === null && (await page.locator('[data-testid="tobe-proposal"]').count()) === 0);
  await removeBundle();
});
}
