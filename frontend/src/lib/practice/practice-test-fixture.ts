// 시험용으로 손으로 줄인 연습 자료 - 설계 2026-11-26-practice-page §4.1-7의 꼴을 따른 합성 글(사용 설명서 문장). 시험만 가져온다.
// 진짜 자료는 backend/scripts/dump_practice_fixture.py가 뽑는 practice-fixture.json이다 - 이 파일은 그 자리를 대신하지 않는다.

import type {
  Bundle,
  Decision,
  DocumentView,
  GroupTarget,
  SopDocument,
  UnitRow,
  ViewBlock,
  ViewNumber,
  ViewTable,
  ViewUnit,
  WrittenSentence,
} from "../api-sop";

import type { PracticeFixture } from "./practice-state";

export const TEST_OLD_DOC = 900001;
export const TEST_NEW_DOC = 900002;
export const TEST_TABLE = 501;
/** 쓰임마다 Unit id(설계 §4.2 표의 차례) */
export const TEST_UNITS = {
  title: 101,
  toc: 102,
  pairAKo: 103,
  pairAEn: 104,
  pairBKo: 105,
  pairBEn: 106,
  twoSentences: 107,
  brokenHead: 108,
  brokenTail: 109,
  table: 110,
  cellKey: 111,
  cellMeaning: 112,
  unwrappedKey: 113,
  unwrappedMeaning: 114,
} as const;
export const TEST_TARGETS = { aPrime: 301, bPrime: 302, heading: 303 } as const;

const AT = "2026-11-26T00:00:00+09:00";

const NUMBER: ViewNumber = { value: null, read: null, source: null, is_set: false, content_start: 0, from_text: false, note: null };

function buildBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, part: "body", kind: "paragraph", text, page: 1, page_basis: "none", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body",
    ...extra,
  };
}

function buildUnit(id: number, docCode: string, blockId: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `${docCode}-${String(id % 100).padStart(3, "0")}`, kind: "sentence", spans: [[blockId, 0, text.length]], text,
    lang: /[가-힣]/.test(text) ? "ko" : "en", number: { ...NUMBER }, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: blockId, block_id: blockId, is_edited: false, can_unmerge: false, merge_pieces: [],
    split_suggestion_id: null, ref: null, caption_refs: [], noise_kind: null, noise_reason: "",
    ...extra,
  };
}

function buildDocument(id: number, side: "old" | "new", fileName: string, docCode: string): SopDocument {
  return {
    id, side, file_name: fileName, file_format: "docx", size_bytes: 1000, doc_code: docCode, doc_version: "1.0", title: "Practice",
    language_layout: "ko_en_interleaved", status: "ready", status_reason: "", revision: 3, target_doc_id: side === "new" ? 401 : null,
    uploaded_by: "practice", uploaded_at: AT, extraction: { id: id - 899000, aux_status: "ok", warnings: [] },
  };
}

function buildView(doc: SopDocument, blocks: ViewBlock[], units: ViewUnit[], tables: ViewTable[], pairs: DocumentView["pairs"]): DocumentView {
  const { extraction, ...document } = doc;
  return {
    document, extraction, has_number_ranges: true, tables, blocks,
    part_groups: [{ key: "body", part: "body", refs: [], block_count: blocks.length, same_as: null }],
    units, pairs, edits: { can_undo: false, can_redo: false },
  };
}

const DECISION: Decision = {
  disposition: "unassigned", move_target_code: "", reason: "", status: "unassigned", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1,
};

function buildRow(docId: number, unit: ViewUnit): UnitRow {
  return {
    unit_id: unit.id, document_id: docId, display_id: unit.display_id, kind: unit.kind, lang: unit.lang, text: unit.text,
    content_start: unit.number?.content_start ?? 0, table_id: unit.table_id, row_index: unit.row_index, group_unit_id: unit.group_unit_id,
    status: "unassigned", decision: { ...DECISION }, target_ids: [], target_doc_ids: [], pair_id: unit.pair_id,
    has_caption_target: false, caption_figure_id: null,
  };
}

function buildTarget(id: number, text: string, kind: GroupTarget["kind"] = "sentence"): GroupTarget {
  return {
    id, target_doc_id: 401, slot_key: "purpose", wi_step: null, wi_part: null, section_path: "1. Purpose", order_index: id - 300,
    lang: "ko", kind, confirmed_text: text, ai_text: "", change_type: null, origin: "written", new_unit_id: id - 100,
    translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null, grid: null, status: "unassigned",
    hold_reason: "", remark: "", warnings: [], source_unit_ids: [], group_id: null, revision: 1, indent_level: 0,
  };
}

function buildWritten(target: GroupTarget): WrittenSentence {
  return {
    target_id: target.id, target_doc_id: target.target_doc_id, doc_code: "SOP-NEW-001", section_path: target.section_path,
    order_index: target.order_index, lang: target.lang, kind: target.kind === "slot_heading" ? "sentence" : target.kind,
    text: target.confirmed_text, status: target.status, change_type: target.change_type, source_unit_ids: [], partner_target_id: null,
    remark: "", revision: target.revision,
  };
}

/** 부를 때마다 새 객체 - 시험끼리 상태를 나누지 않는다 */
export function buildPracticeTestFixture(): PracticeFixture {
  const u = TEST_UNITS;
  const oldDoc = buildDocument(TEST_OLD_DOC, "old", "SYNTHETIC_PRACTICE-OLD.docx", "SOP-OLD-001");
  const newDoc = buildDocument(TEST_NEW_DOC, "new", "SYNTHETIC_PRACTICE-NEW.docx", "SOP-NEW-001");
  const oldBlocks = [
    buildBlock(1, 1, "연습용 SOP — Assign 따라 하기", { heading_level: 1 }),
    buildBlock(2, 2, "목차 ........ 1"),
    buildBlock(3, 3, "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다."),
    buildBlock(4, 4, "Decide where each Old Unit goes in the new document and confirm it."),
    buildBlock(5, 5, "추천 카드가 뜨면 Enter로 확정합니다."),
    buildBlock(6, 6, "When a suggestion card appears, press Enter to confirm."),
    buildBlock(7, 7, "정할 수 없는 Unit은 보류합니다. 보류한 Unit은 On hold에 모입니다."),
    buildBlock(8, 8, "끊긴 문장의 앞 조각은"),
    buildBlock(9, 9, "다음 문단에서 이어집니다."),
    buildBlock(10, 10, "J", { kind: "table_cell", table_id: TEST_TABLE, row_index: 0, col_index: 0 }),
    buildBlock(11, 11, "다음 줄", { kind: "table_cell", table_id: TEST_TABLE, row_index: 0, col_index: 1 }),
  ];
  const code = oldDoc.doc_code;
  const tableUnit = buildUnit(u.table, code, 10, "", { kind: "table", spans: [], number: null, table_id: TEST_TABLE, lang: "neutral" });
  const cells = [
    buildUnit(u.cellKey, code, 10, "J", { kind: "cell_sentence", table_id: TEST_TABLE, row_index: 0, group_unit_id: u.table, number: null }),
    buildUnit(u.cellMeaning, code, 11, "다음 줄", { kind: "cell_sentence", table_id: TEST_TABLE, row_index: 0, group_unit_id: u.table, number: null }),
  ];
  const oldUnits = [
    buildUnit(u.title, code, 1, "연습용 SOP — Assign 따라 하기", { kind: "heading" }),
    buildUnit(u.toc, code, 2, "목차 ........ 1", { noise_kind: "toc" }),
    buildUnit(u.pairAKo, code, 3, "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.", { pair_id: 701 }),
    buildUnit(u.pairAEn, code, 4, "Decide where each Old Unit goes in the new document and confirm it.", { pair_id: 701 }),
    buildUnit(u.pairBKo, code, 5, "추천 카드가 뜨면 Enter로 확정합니다.", { pair_id: 702 }),
    buildUnit(u.pairBEn, code, 6, "When a suggestion card appears, press Enter to confirm.", { pair_id: 702 }),
    buildUnit(u.twoSentences, code, 7, "정할 수 없는 Unit은 보류합니다. 보류한 Unit은 On hold에 모입니다."),
    buildUnit(u.brokenHead, code, 8, "끊긴 문장의 앞 조각은"),
    buildUnit(u.brokenTail, code, 9, "다음 문단에서 이어집니다."),
    tableUnit,
    ...cells,
  ];
  const wrappedTable: ViewTable = {
    id: TEST_TABLE, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 2, is_layout: false, is_band: false, anchor: null, lang: null,
  };
  const unwrapped = [
    buildUnit(u.unwrappedKey, code, 10, "J", { table_id: TEST_TABLE, row_index: 0 }),
    buildUnit(u.unwrappedMeaning, code, 11, "다음 줄", { table_id: TEST_TABLE, row_index: 0 }),
  ];
  const pairs: DocumentView["pairs"] = [
    { id: 701, status: "confirmed", source: "rule", unit_ids: [u.pairAKo, u.pairAEn] },
    { id: 702, status: "confirmed", source: "rule", unit_ids: [u.pairBKo, u.pairBEn] },
  ];
  const newBlocks = [
    buildBlock(21, 1, "1. 목적", { heading_level: 1 }),
    buildBlock(22, 2, "Old Unit마다 새 문서의 어디로 갈지 정합니다."),
    buildBlock(23, 3, "추천 카드가 뜨면 Enter로 확정합니다."),
  ];
  const newUnits = [
    buildUnit(201, newDoc.doc_code, 21, "1. 목적", { kind: "heading", status: null }),
    buildUnit(202, newDoc.doc_code, 22, "Old Unit마다 새 문서의 어디로 갈지 정합니다.", { status: null }),
    buildUnit(203, newDoc.doc_code, 23, "추천 카드가 뜨면 Enter로 확정합니다.", { status: null }),
  ];
  const targets = [
    buildTarget(TEST_TARGETS.heading, "1. 목적", "slot_heading"),
    buildTarget(TEST_TARGETS.aPrime, "Old Unit마다 새 문서의 어디로 갈지 정합니다."),
    buildTarget(TEST_TARGETS.bPrime, "추천 카드가 뜨면 Enter로 확정합니다."),
  ];
  return {
    _generated: "frontend/src/lib/practice/practice-test-fixture.ts (hand-made for tests)",
    bundle: {
      id: -1, code: "BND-PRACTICE", title: "Practice", document_count: 2, description: "", status: "in_progress", is_synthetic: true,
      semantic_checks: {}, revision: 1, created_by: "practice", created_at: AT, updated_at: AT, my_role: "author",
      members: [{ login_id: "practice", role: "author", name: "Practice", korean_name: "연습", active: true }],
      progress: { total: 9, unassigned: 9, confirmed: 0, on_hold: 0, assigned: 0, deleted: 0, moved: 0, figures_total: 0, figures_decided: 0, single_language: 0 },
      tidy: { refs: 0, captions: 0, ai_waiting: 0 }, next_action: "decide_units",
      ai_jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0 },
    } satisfies Bundle,
    documents: [oldDoc, newDoc],
    views: {
      [TEST_OLD_DOC]: buildView(oldDoc, oldBlocks, oldUnits, [wrappedTable], pairs),
      [TEST_NEW_DOC]: buildView(newDoc, newBlocks, newUnits, [], []),
    },
    units: oldUnits.map((unit) => buildRow(TEST_OLD_DOC, unit)),
    tobe: {
      revision: 1,
      docs: [{
        id: 401, code: "SOP-NEW-001", title: "Practice New", doc_type: "sop", parent_code: null, entrance: "match", is_equipment_sop: false,
        order_index: 0, document_id: TEST_NEW_DOC, ref_parent_codes: [],
      }],
      na_slots: [], wi_steps: [], outline_items: [], outline_suggestions: {},
    },
    written: targets.filter((target) => target.kind !== "slot_heading").map(buildWritten),
    targets: Object.fromEntries(targets.map((target) => [String(target.id), target])),
    candidates: {
      [u.pairBKo]: [{ target_id: TEST_TARGETS.bPrime, target_doc_id: 401, doc_code: "SOP-NEW-001", section_path: "1. Purpose", text: "추천 카드가 뜨면 Enter로 확정합니다.", basis: "text" }],
    },
    tableVariants: {
      [TEST_TABLE]: {
        wrapped: { table: wrappedTable, units: [tableUnit, ...cells] },
        unwrapped: { table: { ...wrappedTable, is_layout: true }, units: unwrapped },
      },
    },
  };
}
