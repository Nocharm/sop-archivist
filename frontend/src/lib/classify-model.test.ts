// 분류 모델 - 줄=짝, 줄 상태는 덜 끝난 쪽, 저장 요청은 두 단위를 함께 담고 기존 새 문장을 고치며 N/A 칸은 고를 수 없다.
import { describe, expect, it } from "vitest";

import type { Decision, DocumentView, Group, GroupTarget, ToBe, UnitRow, ViewUnit, WrittenSentence } from "./api-sop";
import { listSiblingPlaces } from "./assign-model";
import {
  buildDestinationOptions,
  buildGroupSave,
  buildRows,
  buildSentenceSlots,
  findNextAfterSave,
  findSystemHold,
  getDestinationId,
  getRowStep,
  hasDraftChange,
  hasRowLanguage,
  buildCellOwners,
  isPlaceOption,
  isWrittenCell,
  listTreeOptions,
  listTreeRows,
  isSentenceUnit,
  isTranslationOf,
  listJoinedTargetIds,
  listLinkLeftovers,
  listUnpairedKeys,
  readCheckKey,
  pickRowStatus,
  previewLinkChange,
  previewSlotChange,
  readDestination,
  readHumanReason,
  readSlotKind,
  stepInList,
} from "./classify-model";
import type { Destination } from "./classify-model";
import { makeDeepOutline, makeTemplateOutline, TEMPLATE_PLACE_KEYS } from "./outline-fixture";

function makeViewUnit(id: number, lang: "ko" | "en", pos: number): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [[pos, 0, 3]], text: `t${id}`, lang, number: null, table_id: null, row_index: null,
    group_unit_id: null, status: "unassigned", pair_id: null, pos_seq: pos, block_id: pos, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [],
  };
}

function makeUnitRow(id: number, status: UnitRow["status"]): UnitRow {
  return {
    unit_id: id, document_id: 1, display_id: `D-${id}`, kind: "sentence", lang: "ko", text: `t${id}`, content_start: 0, table_id: null, row_index: null,
    group_unit_id: null, status, target_ids: [], target_doc_ids: [], pair_id: null,
    decision: { disposition: "unassigned", move_target_code: "", reason: "", status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 },
  };
}

const VIEW = {
  document: { id: 1 },
  extraction: null,
  tables: [],
  blocks: [],
  units: [makeViewUnit(10, "ko", 0), makeViewUnit(11, "en", 1), makeViewUnit(12, "en", 2)],
  pairs: [{ id: 5, status: "suggested", source: "code", unit_ids: [10, 11] }],
  edits: { can_undo: false, can_redo: false },
} as unknown as DocumentView;

describe("rows", () => {
  it("makes one row per pair and one per lone unit", () => {
    const unitRows = new Map([[10, makeUnitRow(10, "confirmed")], [11, makeUnitRow(11, "unassigned")], [12, makeUnitRow(12, "on_hold")]]);
    const rows = buildRows([VIEW], unitRows);
    expect(rows.map((row) => row.unitIds)).toEqual([[10, 11], [12]]);
    expect(rows[0].status).toBe("unassigned");
    expect(rows[0].pairStatus).toBe("suggested");
    expect(rows.map((row) => row.pairId)).toEqual([5, null]);
  });

  it("names the rows a pair row becomes once its pair is dissolved", () => {
    const unitRows = new Map([[10, makeUnitRow(10, "unassigned")], [11, makeUnitRow(11, "unassigned")], [12, makeUnitRow(12, "unassigned")]]);
    const [pairRow] = buildRows([VIEW], unitRows);
    const loose = { ...VIEW, pairs: [] } as unknown as DocumentView;
    expect(listUnpairedKeys(pairRow)).toEqual(buildRows([loose], unitRows).slice(0, 2).map((row) => row.key));
  });

  it("follows the less finished side", () => {
    expect(pickRowStatus(["confirmed", "on_hold"])).toBe("on_hold");
    expect(pickRowStatus(["confirmed", "confirmed"])).toBe("confirmed");
  });

  describe("next box after a save", () => {
    // 줄 이동 차례 - 문서 1의 a·b·(그림 f)·c, 문서 2의 d
    const order = ["a", "b", "f", "c", "d"];
    const doc = new Map([["a", 1], ["b", 1], ["f", 1], ["c", 1], ["d", 2]]);
    const confirmed = new Set(["a", "c"]);
    const scope = (from: string) => (key: string) => key !== from && doc.get(key) === doc.get(from) && key !== "f";
    const isOpen = (key: string) => !confirmed.has(key);

    it("picks the box right below after a delete, even a confirmed one", () => {
      expect(findNextAfterSave(order, "b", "below", scope("b"), isOpen)).toBe("c");
    });

    it("skips figure boxes and stops at the document's end, falling back to the box above", () => {
      expect(findNextAfterSave(order, "c", "below", scope("c"), isOpen)).toBe("b");
    });

    it("stays put when the document has no other box", () => {
      expect(findNextAfterSave(order, "d", "below", scope("d"), isOpen)).toBeNull();
    });

    it("moves to the next open box below without wrapping to the top", () => {
      expect(findNextAfterSave(order, "a", "open", scope("a"), isOpen)).toBe("b");
      expect(findNextAfterSave(order, "b", "open", scope("b"), isOpen)).toBeNull();
    });

    it("keeps the pick when the saved box is not in the order", () => {
      expect(findNextAfterSave(order, "u99", "below", scope("u99"), isOpen)).toBeNull();
    });
  });
});

const TOBE: ToBe = {
  revision: 1,
  docs: [
    { id: 6, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: false, order_index: 0, document_id: null, ref_parent_codes: [] },
    { id: 7, code: "WI-01", title: "", doc_type: "wi", parent_code: "SOP-CF", entrance: "assign", is_equipment_sop: false, order_index: 1, document_id: null, ref_parent_codes: [] },
    { id: 8, code: "WI-04", title: "", doc_type: "wi", parent_code: "SOP-CF", entrance: "match", is_equipment_sop: false, order_index: 2, document_id: 3, ref_parent_codes: [] },
  ],
  na_slots: [{ code: "SOP-CF", slot_key: "procedures", reason: "x" }],
  wi_steps: [{ code: "WI-01", step_no: 1, title: "Load" }],
  outline_items: makeTemplateOutline("SOP-CF"),
  outline_suggestions: {},
};

const DOCS = "document_relationships";
const ASSOCIATED = `${DOCS}.associated_documents`;

describe("destinations", () => {
  it("lists SOP slots, WI step parts, and greys out N/A including children", () => {
    const options = buildDestinationOptions(TOBE);
    expect(options.find((option) => option.id === "slot:6:procedures.p1")?.disabled).toBe(true);
    expect(options.find((option) => option.id === "slot:6:purpose")?.disabled).toBe(false);
    expect(options.filter((option) => option.docCode === "WI-01").map((option) => option.id)).toEqual(["step:7:1:instruction", "step:7:1:why"]);
    expect(options.some((option) => option.docCode === "WI-04")).toBe(false);
  });

  it("lists the SOP places in the outline's order with the item's own name and level", () => {
    const places = buildDestinationOptions({ ...TOBE, na_slots: [] }).filter((option) => option.destination.kind === "slot");
    expect(places.map((option) => option.id)).toEqual(TEMPLATE_PLACE_KEYS.map((key) => `slot:6:${key}`));
    // 7.1의 항목은 두 단 아래다(7 › 7.1 › Form)
    expect(places.map((option) => option.depth)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 2, 2, 1, 0, 0, 1]);
    // 이름은 그 항목의 것만 - 나무가 depth로 위계를 보이므로 "General Requirements › Safety"로 적지 않는다
    expect(places.slice(4, 7).map((option) => option.label)).toEqual(["General Requirements", "Safety", "Work"]);
  });

  it("names an appendix place by its label, which carries its number", () => {
    // 나무는 번호를 적지 않는다 - 부록(shows_number false)만 번호가 든 이름 "Appendix 1. …"으로 적어 어느 부록인지 보인다
    const options = buildDestinationOptions({ ...TOBE, na_slots: [] }).filter((option) => option.id.endsWith(":appendices.a1"));
    expect(options.map((option) => [option.destination.kind, option.label])).toEqual([["slot_heading", "Appendix 1. Alarm list"], ["slot", "Appendix 1. Alarm list"]]);
  });

  it("offers only the items that take sentences directly, and none that the document removed", () => {
    const outline = makeTemplateOutline("SOP-CF", { scope: { is_removed: true } });
    const options = buildDestinationOptions({ ...TOBE, na_slots: [], outline_items: outline });
    const ids = options.map((option) => option.id);
    // 묶음(7 · 7.1)과 앱이 채우는 목록(7.2)은 보낼 곳도 칸 제목 자리도 아니다
    for (const key of [DOCS, ASSOCIATED, `${DOCS}.work_instructions`, "scope"]) {
      expect(ids).not.toContain(`slot:6:${key}`);
      expect(ids).not.toContain(`heading:6:${key}`);
    }
    expect(ids).toContain(`slot:6:${ASSOCIATED}.form`);
    expect(ids).toContain(`heading:6:${ASSOCIATED}.form`);
    // 가까운 곳(같은 문서의 다른 칸)도 보낼 곳 목록만 읽으므로 묶음이 끼지 않는다
    const near = listSiblingPlaces(options, { kind: "slot", docId: 6, slotKey: "procedures.p1" }, 100);
    expect(near.map((option) => (option.destination.kind === "slot" ? option.destination.slotKey : ""))).toEqual(TEMPLATE_PLACE_KEYS.filter((key) => key !== "scope" && key !== "procedures.p1"));
  });

  it("reads each SOP from its own outline", () => {
    const second = { ...TOBE.docs[0], id: 9, code: "SOP-B", order_index: 5 };
    const tobe: ToBe = { ...TOBE, docs: [...TOBE.docs, second], na_slots: [], outline_items: [...makeTemplateOutline("SOP-CF"), ...makeDeepOutline("SOP-B")] };
    const places = buildDestinationOptions(tobe).filter((option) => option.destination.kind === "slot");
    expect(places.filter((option) => option.docCode === "SOP-CF")).toHaveLength(17);
    expect(places.filter((option) => option.docCode === "SOP-B").map((option) => option.id)).toEqual(["slot:9:a", "slot:9:a.b", "slot:9:a.b.c", "slot:9:z"]);
    // 골격이 없는 SOP(응답에 항목이 없다)는 보낼 칸이 없다
    expect(buildDestinationOptions({ ...tobe, outline_items: [] }).filter((option) => option.destination.kind === "slot")).toEqual([]);
  });
});

describe("destinations in a three-level outline", () => {
  const deep = (naKeys: string[], patches: Parameters<typeof makeDeepOutline>[1] = {}): ToBe => ({
    ...TOBE,
    na_slots: naKeys.map((slot_key) => ({ code: "SOP-CF", slot_key, reason: "x" })),
    outline_items: makeDeepOutline("SOP-CF", patches),
  });
  const placesOf = (tobe: ToBe) => buildDestinationOptions(tobe).filter((option) => option.destination.kind === "slot");

  it("indents by level, two deep", () => {
    expect(placesOf(deep([])).map((option) => [option.id, option.depth, option.label])).toEqual([
      ["slot:6:a", 0, "A"], ["slot:6:a.b", 1, "B"], ["slot:6:a.b.c", 2, "C"], ["slot:6:z", 0, "Z"],
    ]);
  });

  it("greys out every level under an N/A section and offers no heading place there", () => {
    const options = buildDestinationOptions(deep(["a"]));
    expect(options.filter((option) => option.disabled).map((option) => option.id)).toEqual(["slot:6:a", "slot:6:a.b", "slot:6:a.b.c"]);
    expect(options.filter((option) => option.destination.kind === "slot_heading").map((option) => option.id)).toEqual(["heading:6:z"]);
    // 가운데 수준만 N/A면 그 아래만 막힌다
    expect(placesOf(deep(["a.b"])).map((option) => option.disabled)).toEqual([false, true, true, false]);
  });

  it("follows parent_key through an ancestor that is not a place itself", () => {
    // a.b는 하위만 묶는 항목(group)이라 목록에 없다 - 그래도 a의 N/A는 a.b를 거쳐 a.b.c까지 닿는다
    const grouped = { "a.b": { kind: "group", is_assignable: false } } as const;
    expect(placesOf(deep([], grouped)).map((option) => [option.id, option.depth])).toEqual([["slot:6:a", 0], ["slot:6:a.b.c", 2], ["slot:6:z", 0]]);
    expect(placesOf(deep(["a"], grouped)).map((option) => option.disabled)).toEqual([true, true, false]);
    expect(placesOf(deep(["a.b"], grouped)).map((option) => option.disabled)).toEqual([false, true, false]);
  });
});

describe("tree rows", () => {
  const open: ToBe = { ...TOBE, na_slots: [] };
  /** 줄을 짧게 - 보낼 곳은 그 id, 묶음 이름 줄은 [id, 이름, 들여쓰기, N/A] */
  const read = (tobe: ToBe, canPickHeading = false) =>
    listTreeRows(tobe, listTreeOptions(buildDestinationOptions(tobe), canPickHeading)).map((row) => (row.kind === "place" ? row.option.id : [row.id, row.label, row.depth, row.isNa]));

  it("puts a plain heading row for each group above its first place, so 7.1's items keep their context", () => {
    const rows = read(open);
    const from = rows.indexOf("slot:6:procedures.p1");
    expect(rows.slice(from, from + 8)).toEqual([
      "slot:6:procedures.p1",
      [`group:6:${DOCS}`, "Document Relationships", 0, false],
      [`group:6:${ASSOCIATED}`, "Associated Documents", 1, false],
      `slot:6:${ASSOCIATED}.form`,
      `slot:6:${ASSOCIATED}.visual_aid`,
      `slot:6:${ASSOCIATED}.training_material`,
      `slot:6:${ASSOCIATED}.quality_risk_assessment`,
      // 앱이 채우는 목록(7.2 Work Instructions)은 줄이 없다 - 7.1 다음이 바로 7.3이다
      `slot:6:${DOCS}.references`,
    ]);
    // 이름 줄은 묶음 둘뿐이고, 보낼 곳은 그대로 다 있다(WI 자리 포함)
    expect(rows.filter((row) => typeof row !== "string")).toHaveLength(2);
    expect(rows.filter((row) => typeof row === "string")).toEqual(buildDestinationOptions(open).filter(isPlaceOption).map((option) => option.id));
  });

  it("puts the heading rows above the section-title place too, once", () => {
    const rows = read(open, true);
    const at = rows.findIndex((row) => typeof row !== "string" && row[0] === `group:6:${ASSOCIATED}`);
    expect(rows.slice(at - 1, at + 3)).toEqual([
      [`group:6:${DOCS}`, "Document Relationships", 0, false],
      [`group:6:${ASSOCIATED}`, "Associated Documents", 1, false],
      `heading:6:${ASSOCIATED}.form`,
      `slot:6:${ASSOCIATED}.form`,
    ]);
    expect(rows.filter((row) => typeof row !== "string")).toHaveLength(2);
  });

  it("marks a heading row N/A when it or a section above it is N/A", () => {
    const headingsOf = (naKey: string) => read({ ...open, na_slots: [{ code: "SOP-CF", slot_key: naKey, reason: "x" }] }).filter((row) => typeof row !== "string").map((row) => row[3]);
    expect(headingsOf(DOCS)).toEqual([true, true]);
    expect(headingsOf(ASSOCIATED)).toEqual([false, true]);
    expect(headingsOf("purpose")).toEqual([false, false]);
  });

  it("has no heading row for a group with no place under it, and keeps each document's rows apart", () => {
    // 7.1의 항목을 모두 뺀 문서 - 7.1은 그릴 하위가 없어 이름 줄도 없다(7은 7.3이 남아 있다)
    const removed = Object.fromEntries(["form", "visual_aid", "training_material", "quality_risk_assessment"].map((name) => [`${ASSOCIATED}.${name}`, { is_removed: true }]));
    const second = { ...TOBE.docs[0], id: 9, code: "SOP-B", order_index: 5 };
    const tobe: ToBe = { ...open, docs: [...TOBE.docs, second], outline_items: [...makeTemplateOutline("SOP-CF", removed), ...makeTemplateOutline("SOP-B")] };
    const headings = read(tobe).filter((row) => typeof row !== "string").map((row) => row[0]);
    expect(headings).toEqual([`group:6:${DOCS}`, `group:9:${DOCS}`, `group:9:${ASSOCIATED}`]);
  });
});

describe("save request", () => {
  const units = [
    { id: 10, kind: "sentence", lang: "ko" as const, text: "가", revision: 2 },
    { id: 11, kind: "sentence", lang: "en" as const, text: "A", revision: 3 },
  ];
  const group: Group = {
    units: [],
    targets: [
      {
        id: 90, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
        confirmed_text: "가", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
        grid: null, status: "confirmed", hold_reason: "", remark: "", warnings: [], source_unit_ids: [10], group_id: null, revision: 4, indent_level: 0,
      },
    ],
  };

  it("saves both units of a pair, updates the existing sentence and marks edits", () => {
    const body = buildGroupSave(
      { destination: { kind: "slot", docId: 6, slotKey: "purpose" }, texts: { u11: "A changed" }, reason: "", moveCode: "" },
      { units, group, tables: new Map() },
      "confirm",
    );
    expect(body.units.map((unit) => [unit.unit_id, unit.disposition])).toEqual([[10, "assigned"], [11, "assigned"]]);
    expect(body.targets[0]).toMatchObject({ id: 90, revision: 4, slot_key: "purpose", source_unit_ids: [10] });
    // 손대지 않은 기존 새 문장은 글을 보내지 않는다 - 서버가 지금 글을 둔다
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[1]).toMatchObject({ text: "A changed", lang: "en" });
    // 변경 종류는 싣지 않는다 - 서버가 글로 정한다
    expect(body.targets[1]).not.toHaveProperty("change_type");
    expect(body.removed_target_ids).toEqual([]);
  });

  it("deleting drops the new sentences and carries the reason", () => {
    const body = buildGroupSave({ destination: { kind: "delete" }, texts: {}, reason: " header ", moveCode: "" }, { units, group, tables: new Map() }, "confirm");
    expect(body.targets).toEqual([]);
    expect(body.removed_target_ids).toEqual([90]);
    expect(body.units[0]).toMatchObject({ disposition: "delete", reason: "header" });
  });

  it("reads the current destination back", () => {
    expect(readDestination(group, [10, 11])).toEqual({ kind: "slot", docId: 6, slotKey: "scope" });
  });
});

// --- v0.4.0 검토: 저장이 AI 제안·기존 새 문장을 망가뜨리지 않는다 ---

function makeTarget(extra: Partial<GroupTarget>): GroupTarget {
  return {
    id: 1, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
    grid: null, status: "ai_suggested", hold_reason: "", remark: "", warnings: [], source_unit_ids: [10], group_id: null, revision: 1, indent_level: 0, ...extra,
  };
}

const SCOPE = { kind: "slot", docId: 6, slotKey: "scope" } as const;
const ONE_UNIT = [{ id: 10, kind: "sentence", lang: "ko" as const, text: "원문", revision: 1 }];

function makeDraft(extra: Partial<Parameters<typeof buildGroupSave>[0]> = {}): Parameters<typeof buildGroupSave>[0] {
  return { destination: SCOPE, texts: {}, reason: "", moveCode: "", ...extra };
}

describe("save keeps AI suggestions as they are", () => {
  it("accepts an untouched AI rewrite by sending no text and no change type", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, ai_text: "말투만 바꾼 원문", change_type: "rewritten" })] };
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]).toMatchObject({ id: 90, source_unit_ids: [10] });
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[0]).not.toHaveProperty("change_type");
  });

  it("sends neither text nor change type when a confirmed sentence is saved again untouched", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "말투만", change_type: "rewritten", status: "confirmed" })] };
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ id: 90 });
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[0]).not.toHaveProperty("change_type");
  });

  it("sends the edited text without a change type - the server decides it", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "말투만", change_type: "rewritten", status: "confirmed" })] };
    const body = buildGroupSave(makeDraft({ texts: { t90: "말투만 다시" } }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ id: 90, text: "말투만 다시" });
    expect(body.targets[0]).not.toHaveProperty("change_type");
  });

  it("keeps every sentence of an AI split", () => {
    const group: Group = {
      units: [],
      targets: [makeTarget({ id: 90, ai_text: "앞 문장", change_type: null }), makeTarget({ id: 91, ai_text: "뒤 문장", change_type: null, order_index: 1 })],
    };
    expect(buildSentenceSlots(group, ONE_UNIT).map((slot) => [slot.key, slot.text])).toEqual([["t90", "앞 문장"], ["t91", "뒤 문장"]]);
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets.map((target) => target.id)).toEqual([90, 91]);
    expect(body.removed_target_ids).toEqual([]);
  });

  it("sends an AI merge once, not once per source unit", () => {
    const units = [
      { id: 10, kind: "sentence", lang: "ko" as const, text: "가", revision: 1 },
      { id: 12, kind: "sentence", lang: "ko" as const, text: "나", revision: 1 },
      { id: 11, kind: "sentence", lang: "en" as const, text: "A", revision: 1 },
    ];
    const group: Group = { units: [], targets: [makeTarget({ id: 90, ai_text: "가 나", source_unit_ids: [10, 12] })] };
    const body = buildGroupSave(makeDraft(), { units, group, tables: new Map() }, "confirm");
    expect(body.targets.filter((target) => target.id === 90)).toHaveLength(1);
    expect(body.targets.find((target) => target.id === 90)?.source_unit_ids).toEqual([10, 12]);
    expect(body.targets.find((target) => target.id === undefined)).toMatchObject({ lang: "en", source_unit_ids: [11], text: "A" });
  });

  it("keeps translations that ride along in the group", () => {
    const group: Group = {
      units: [],
      targets: [makeTarget({ id: 90, confirmed_text: "원문", status: "confirmed" }), makeTarget({ id: 95, origin: "translation", lang: "en", source_unit_ids: [], confirmed_text: "Source" })],
    };
    const body = buildGroupSave(makeDraft({ destination: { kind: "slot", docId: 6, slotKey: "purpose" } }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets.find((target) => target.id === 95)).toEqual({ key: "t95", id: 95, revision: 1, kind: "sentence", source_unit_ids: [] });
  });

  it("keeps a cell translation under a table that is saved again", () => {
    const units = [{ id: 30, kind: "table", lang: "neutral" as const, text: "", revision: 1 }];
    const tables = new Map([[30, { rows: 1, cols: 1, cells: [{ id: 31, lang: "ko" as const, text: "칸", row: 0, col: 0 }] }]]);
    const group: Group = {
      units: [],
      targets: [
        makeTarget({ id: 80, kind: "table", lang: "neutral", source_unit_ids: [30], grid: { rows: 1, cols: 1 } }),
        makeTarget({ id: 81, parent_target_id: 80, source_unit_ids: [31], cell_row: 0, cell_col: 0 }),
        makeTarget({ id: 82, parent_target_id: 80, origin: "translation", lang: "en", source_unit_ids: [], cell_row: 0, cell_col: 0 }),
      ],
    };
    const body = buildGroupSave(makeDraft(), { units, group, tables }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets.map((target) => target.id)).toEqual([80, 81, 82]);
  });

  it("treats an emptied sentence as the source text", () => {
    const body = buildGroupSave(makeDraft({ texts: { u10: "  " } }), { units: ONE_UNIT, group: null, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ text: "원문" });
  });
});

describe("caption targets under a table or figure", () => {
  const FIGURE = [{ id: 40, kind: "figure", lang: "neutral" as const, text: "", revision: 1 }];
  const ctxWithCaption = (id: number, lang: "ko" | "en", text: string, group: Group | null = null) => ({ units: FIGURE, group, tables: new Map(), captions: new Map([[40, [{ id, lang, text }]]]) });

  it("sends caption targets under the figure target", () => {
    const save = buildGroupSave(makeDraft(), ctxWithCaption(7, "ko", "그림 1 로터"), "confirm");
    expect(save.targets).toContainEqual(expect.objectContaining({ parent_key: "u40", source_unit_ids: [7], lang: "ko" }));
    // 캡션은 칸이 아니다 - 칸 좌표를 싣지 않는다
    expect(save.targets[1]).toEqual({ key: "u40-cap-7", target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, kind: "sentence", lang: "ko", text: "그림 1 로터", parent_key: "u40", source_unit_ids: [7] });
  });

  it("sends a rewritten caption's text and keeps the existing caption target's id and revision", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 60, kind: "figure", lang: "neutral", source_unit_ids: [40] }), makeTarget({ id: 61, parent_target_id: 60, source_unit_ids: [7], revision: 3, confirmed_text: "그림 1 로터" })] };
    const save = buildGroupSave(makeDraft({ captionTexts: { u7: "그림 1. 로터 조립" } }), ctxWithCaption(7, "ko", "그림 1 로터", group), "confirm");
    expect(save.targets.find((target) => target.parent_key === "u40")).toMatchObject({ id: 61, revision: 3, text: "그림 1. 로터 조립" });
    expect(save.removed_target_ids).toEqual([]);
  });

  it("sends a written caption without a source, and drops an old written one that a caption unit replaced", () => {
    const written = buildGroupSave(makeDraft({ captionTexts: { "w40:en": " Rotor " } }), { units: FIGURE, group: null, tables: new Map() }, "confirm");
    expect(written.targets[1]).toEqual(expect.objectContaining({ key: "u40-cap-en", lang: "en", text: "Rotor", source_unit_ids: [], parent_key: "u40" }));
    expect(written.targets[1]).not.toHaveProperty("change_type");

    const group: Group = { units: [], targets: [makeTarget({ id: 60, kind: "figure", lang: "neutral", source_unit_ids: [40] }), makeTarget({ id: 62, parent_target_id: 60, source_unit_ids: [], confirmed_text: "옛 캡션" })] };
    const replaced = buildGroupSave(makeDraft(), ctxWithCaption(7, "ko", "그림 1", group), "confirm");
    expect(replaced.removed_target_ids).toEqual([62]);
    expect(replaced.targets.map((target) => target.id ?? target.key)).toEqual([60, "u40-cap-7"]);
  });

  it("accepts an untouched AI caption by sending no text and no change type, and sends text once it is edited", () => {
    const group: Group = {
      units: [],
      targets: [
        makeTarget({ id: 60, kind: "figure", lang: "neutral", source_unit_ids: [40] }),
        makeTarget({ id: 63, parent_target_id: 60, source_unit_ids: [7], status: "ai_suggested", ai_text: "그림 1 로터", revision: 2 }),
      ],
    };
    const untouched = buildGroupSave(makeDraft(), ctxWithCaption(7, "ko", "그림 1 로터", group), "confirm");
    expect(untouched.targets[1]).toEqual({ key: "u40-cap-7", id: 63, revision: 2, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, kind: "sentence", parent_key: "u40", source_unit_ids: [7] });

    const edited = buildGroupSave(makeDraft({ captionTexts: { u7: "그림 1. 로터" } }), ctxWithCaption(7, "ko", "그림 1 로터", group), "confirm");
    expect(edited.targets[1]).toMatchObject({ id: 63, text: "그림 1. 로터" });
    expect(edited.targets[1]).not.toHaveProperty("change_type");
  });

  it("keys each caption target by its caption unit, so two same-language captions do not collide", () => {
    const ctx = { units: FIGURE, group: null, tables: new Map(), captions: new Map([[40, [{ id: 7, lang: "ko" as const, text: "그림 1." }, { id: 8, lang: "ko" as const, text: "로터" }]]]) };
    const save = buildGroupSave(makeDraft({ captionTexts: { u8: "로터 조립" } }), ctx, "confirm");
    expect(save.targets.slice(1).map((target) => [target.key, target.text])).toEqual([["u40-cap-7", "그림 1."], ["u40-cap-8", "로터 조립"]]);
  });

  it("counts a typed caption as an unsaved change", () => {
    expect(hasDraftChange({ destination: null, texts: {}, captionTexts: { ko: "로터" }, reason: null, moveCode: null })).toBe(true);
  });
});

describe("tables and step-less WIs", () => {
  it("saves a table unit as a table with its cells", () => {
    const units = [{ id: 30, kind: "table", lang: "neutral" as const, text: "", revision: 1 }];
    const tables = new Map([[30, { rows: 1, cols: 2, cells: [{ id: 31, lang: "ko" as const, text: "칸", row: 0, col: 1 }] }]]);
    const body = buildGroupSave(makeDraft(), { units, group: null, tables }, "confirm");
    expect(body.targets[0]).toMatchObject({ key: "u30", kind: "table", lang: "neutral", grid: { rows: 1, cols: 2 }, source_unit_ids: [30] });
    expect(body.targets[1]).toMatchObject({ kind: "sentence", parent_key: "u30", cell_row: 0, cell_col: 1, source_unit_ids: [31] });
    // 표 · 칸 종류도 서버가 표 모양으로 정한다
    expect(body.targets.filter((target) => "change_type" in target)).toEqual([]);
  });

  it("offers Instruction and Why without a step for a WI with no steps, and reads it back", () => {
    const tobe: ToBe = { ...TOBE, wi_steps: [] };
    const ids = buildDestinationOptions(tobe).filter((option) => option.docCode === "WI-01").map((option) => option.id);
    expect(ids).toEqual(["step:7:none:instruction", "step:7:none:why"]);
    const group: Group = { units: [], targets: [makeTarget({ id: 90, target_doc_id: 7, slot_key: null, wi_step: null, wi_part: "why" })] };
    const destination = readDestination(group, [10]);
    expect(destination).toEqual({ kind: "step", docId: 7, step: null, part: "why" });
    const body = buildGroupSave(makeDraft({ destination }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ target_doc_id: 7, slot_key: null, wi_step: null, wi_part: "why" });
  });
});

describe("hold without a destination", () => {
  it("holds the units as unassigned with no new sentences", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90 })] };
    const body = buildGroupSave(makeDraft({ destination: null }), { units: ONE_UNIT, group, tables: new Map() }, "hold", "모름");
    expect(body).toMatchObject({ action: "hold", hold_reason: "모름", targets: [], removed_target_ids: [90] });
    expect(body.units[0]).toMatchObject({ disposition: "unassigned", reason: "" });
  });

  it("still needs a destination to confirm", () => {
    expect(() => buildGroupSave(makeDraft({ destination: null }), { units: ONE_UNIT, group: null, tables: new Map() }, "confirm")).toThrow();
  });
});

describe("system hold codes", () => {
  const base: Decision = { disposition: "assigned", move_target_code: "", reason: "", status: "on_hold", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 };

  it("never treats a system code as the human reason", () => {
    expect(readHumanReason({ ...base, hold_reason: "system:related_unit_changed" })).toBe("");
    expect(readHumanReason({ ...base, reason: "system:ai_invalid_response" })).toBe("");
    expect(readHumanReason({ ...base, hold_reason: "다음 주 확인" })).toBe("다음 주 확인");
    expect(readHumanReason({ ...base, reason: "머리말", hold_reason: "x" })).toBe("머리말");
  });

  it("finds the system code to show as a label", () => {
    expect(findSystemHold({ ...base, hold_reason: "system:related_unit_changed" })).toBe("related_unit_changed");
    expect(findSystemHold({ ...base, hold_reason: "다음 주 확인" })).toBeNull();
  });
});

describe("checks and filters", () => {
  it("names AI and sentence checks, and falls back for unknown kinds", () => {
    expect(readCheckKey({ kind: "evidence_not_found", value: "q" })).toBe("check.evidence_not_found");
    expect(readCheckKey({ code: "number_mismatch" })).toBe("check.number_mismatch");
    expect(readCheckKey({ kind: "something_new" })).toBe("check.other");
  });

});

describe("stepInList", () => {
  const all = ["a", "b", "c", "d", "e"];
  const list = ["b", "d"];

  it("steps from a row outside the list to the nearest listed row in document order", () => {
    expect(stepInList(all, list, "c", 1)).toBe("d");
    expect(stepInList(all, list, "c", -1)).toBe("b");
  });

  it("stays on the last listed row past the end", () => {
    expect(stepInList(all, list, "e", 1)).toBe("d");
  });

  it("steps within the list and starts at the first row without an active one", () => {
    expect(stepInList(all, list, "b", 1)).toBe("d");
    expect(stepInList(all, list, null, 1)).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(stepInList(all, [], "c", 1)).toBeNull();
  });
});

describe("getRowStep", () => {
  it("moves down with J and the down arrow", () => {
    expect(getRowStep("j")).toBe(1);
    expect(getRowStep("ArrowDown")).toBe(1);
  });

  it("moves up with K and the up arrow", () => {
    expect(getRowStep("K")).toBe(-1);
    expect(getRowStep("ArrowUp")).toBe(-1);
  });

  it("ignores other keys", () => {
    expect(getRowStep("Enter")).toBeNull();
  });
});

describe("hasDraftChange", () => {
  const untouched = { destination: null, texts: {}, reason: null, moveCode: null };

  it("is false for a draft that only opened the editor", () => {
    expect(hasDraftChange(untouched)).toBe(false);
  });

  it("is true once a destination, a reason or a move code was touched", () => {
    expect(hasDraftChange({ ...untouched, destination: { kind: "delete" } })).toBe(true);
    // 사유를 지워 빈 글자로 만든 것도 저장 전 변경이다
    expect(hasDraftChange({ ...untouched, reason: "" })).toBe(true);
    expect(hasDraftChange({ ...untouched, moveCode: "QA-SOP-9" })).toBe(true);
  });

  it("is true for edited text", () => {
    expect(hasDraftChange({ ...untouched, texts: { "1:ko": "새 글" } })).toBe(true);
  });
});

describe("link destination saves the whole closed group", () => {
  const first = makeTarget({ id: 71, origin: "new_doc", target_doc_id: 9, slot_key: null, confirmed_text: "첫째", status: "confirmed", change_type: "rewritten", source_unit_ids: [10], revision: 3 });
  const second = makeTarget({ id: 72, origin: "new_doc", target_doc_id: 9, slot_key: null, confirmed_text: "둘째", status: "unassigned", change_type: null, source_unit_ids: [], revision: 1 });
  const contextOf = (targets: GroupTarget[]) => ({ units: ONE_UNIT, group: { units: [], targets }, tables: new Map() });

  it("echoes the sibling target of a split", () => {
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [71, 72] } }), contextOf([first, second]), "confirm");
    expect(body.units[0]).toMatchObject({ unit_id: 10, disposition: "assigned" });
    expect(body.targets.map((target) => [target.id, target.source_unit_ids])).toEqual([[71, [10]], [72, [10]]]);
    expect(body.removed_target_ids).toEqual([]);
  });

  it("removes the row's own slot sentence when it moves to a written sentence", () => {
    const slotSentence = makeTarget({ id: 80, source_unit_ids: [10] });
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [72] } }), contextOf([slotSentence, second]), "confirm");
    expect(body.removed_target_ids).toEqual([80]);
    expect(body.targets.map((target) => target.id)).toEqual([72]);
  });

  it("resets a written sentence that loses its only source", () => {
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [72] } }), contextOf([first, second]), "confirm");
    expect(body.removed_target_ids).toEqual([71]);
    expect(body.targets).toEqual([expect.objectContaining({ id: 72, source_unit_ids: [10] })]);
  });

  it("keeps the other source on a merged sentence", () => {
    const merged = makeTarget({ id: 73, origin: "new_doc", target_doc_id: 9, slot_key: null, status: "confirmed", change_type: "merged", source_unit_ids: [10, 11] });
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [72] } }), contextOf([merged, second]), "confirm");
    expect(body.targets.map((target) => [target.id, target.source_unit_ids])).toEqual([[73, [11]], [72, [10]]]);
    expect(body.targets[0]).not.toHaveProperty("change_type");
    expect(body.removed_target_ids).toEqual([]);
  });

  it("sends no change type on a link - an AI link, a fresh one or a confirmed one", () => {
    const suggested = makeTarget({ id: 74, origin: "new_doc", target_doc_id: 9, slot_key: null, status: "ai_suggested", change_type: "rewritten", source_unit_ids: [10] });
    for (const [id, target] of [[74, suggested], [72, second], [71, first]] as const) {
      const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [id] } }), contextOf([target]), "confirm");
      expect(body.targets[0]).toMatchObject({ id, source_unit_ids: [10] });
      expect(body.targets[0]).not.toHaveProperty("change_type");
    }
  });

  it("lists the other source units of a merged sentence so the group is closed", () => {
    const merged = makeTarget({ id: 73, origin: "new_doc", target_doc_id: 9, slot_key: null, status: "confirmed", change_type: "as_is", source_unit_ids: [11] });
    const other: Group["units"][number] = {
      unit_id: 11, display_id: "OLD-5-001", document_id: 5, kind: "sentence", lang: "ko", text: "다른 원문", group_id: null, cell_unit_ids: [],
      decision: { disposition: "assigned", move_target_code: "", reason: "같은 글자", status: "confirmed", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 4 },
    };
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [73] } }), { units: ONE_UNIT, group: { units: [other], targets: [merged] }, tables: new Map() }, "confirm");
    expect(body.units).toEqual([
      expect.objectContaining({ unit_id: 10, disposition: "assigned" }),
      { unit_id: 11, revision: 4, disposition: "assigned", move_target_code: "", reason: "같은 글자" },
    ]);
    expect(body.targets[0]).toMatchObject({ id: 73, source_unit_ids: [11, 10] });
  });

  it("saves only the language that has a written sentence", () => {
    const pairUnits = [ONE_UNIT[0], { id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 }];
    const english = makeTarget({ id: 75, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "en", status: "unassigned", change_type: null, source_unit_ids: [] });
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [75] } }), { units: pairUnits, group: { units: [], targets: [english] }, tables: new Map() }, "confirm");
    expect(body.units.map((unit) => unit.unit_id)).toEqual([20]);
    expect(body.targets[0]).toMatchObject({ id: 75, source_unit_ids: [20] });
  });

  it("previews as-is when the written sentence has the same text, otherwise rewritten", () => {
    const written = { kind: "sentence" as const, lang: "ko" as const, change_type: null, source_unit_ids: [] };
    expect(previewLinkChange({ ...written, confirmed_text: " 원문 " }, ONE_UNIT, [10])).toBe("as_is");
    expect(previewLinkChange({ ...written, confirmed_text: "원문을 고침" }, ONE_UNIT, [10])).toBe("rewritten");
    // 같은 언어 원문이 없으면 견줄 글이 없어 고침이다(번역은 화면이 따로 보인다)
    expect(previewLinkChange({ ...written, lang: "en", confirmed_text: "원문" }, ONE_UNIT, [10])).toBe("rewritten");
  });

  it("keeps the server's type once the row is saved as a source, and shows a table as as-is before that", () => {
    const saved = { kind: "sentence" as const, lang: "ko" as const, confirmed_text: "원문", change_type: "rewritten" as const, source_unit_ids: [10] };
    expect(previewLinkChange(saved, ONE_UNIT, [10])).toBe("rewritten");
    expect(previewLinkChange({ ...saved, source_unit_ids: [99] }, ONE_UNIT, [10])).toBe("as_is");
    expect(previewLinkChange({ kind: "table", lang: "neutral", confirmed_text: "", change_type: null, source_unit_ids: [] }, ONE_UNIT, [10])).toBe("as_is");
  });

  it("reads a link before a slot", () => {
    const slotSentence = makeTarget({ id: 80, source_unit_ids: [10] });
    expect(readDestination({ units: [], targets: [slotSentence, first] }, [10])).toEqual({ kind: "link", targetIds: [71] });
  });
});

describe("leaving a link and links next to other placements", () => {
  const decisionOf = (status: Decision["status"], reason = ""): Decision => ({ disposition: "assigned", move_target_code: "", reason, status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 3 });
  const unitOf = (id: number, lang: "ko" | "en", status: Decision["status"] = "confirmed"): Group["units"][number] => ({
    unit_id: id, display_id: `OLD-1-0${id}`, document_id: 1, kind: "sentence", lang, text: `원문 ${id}`, group_id: null, cell_unit_ids: [], decision: decisionOf(status),
  });
  const written = (id: number, sources: number[], lang: "ko" | "en" = "ko") =>
    makeTarget({ id, origin: "new_doc", target_doc_id: 9, slot_key: null, lang, confirmed_text: `문장 ${id}`, status: "confirmed", change_type: "rewritten", source_unit_ids: sources });

  it("picking a slot for a linked row takes the row off the written sentence", () => {
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group: { units: [unitOf(10, "ko")], targets: [written(71, [10])] }, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([71]);
    expect(body.targets.map((target) => target.source_unit_ids)).toEqual([[10]]);
    expect(body.targets[0]).toMatchObject({ slot_key: "scope" });
  });

  it("a slot for a merge-linked row keeps the other source and lists it", () => {
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group: { units: [unitOf(10, "ko"), unitOf(11, "ko")], targets: [written(71, [10, 11])] }, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets).toContainEqual(expect.objectContaining({ id: 71, source_unit_ids: [11] }));
    expect(body.units.map((unit) => unit.unit_id)).toEqual([10, 11]);
  });

  it("deleting a merge-linked row keeps the merged sentence for the other source", () => {
    const body = buildGroupSave(makeDraft({ destination: { kind: "delete" }, reason: "없앰" }), { units: ONE_UNIT, group: { units: [unitOf(10, "ko"), unitOf(11, "ko")], targets: [written(71, [10, 11])] }, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets).toEqual([expect.objectContaining({ id: 71, source_unit_ids: [11] })]);
    expect(body.units.map((unit) => [unit.unit_id, unit.disposition])).toEqual([[10, "delete"], [11, "assigned"]]);
  });

  it("linking one language of a placed pair leaves the other language placed", () => {
    const pairUnits = [ONE_UNIT[0], { id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 }];
    const koSlot = makeTarget({ id: 80, source_unit_ids: [10], status: "confirmed" });
    const enSlot = makeTarget({ id: 81, lang: "en", source_unit_ids: [20], status: "confirmed" });
    const koWritten = written(75, [], "ko");
    const body = buildGroupSave(
      makeDraft({ destination: { kind: "link", targetIds: [75] } }),
      { units: pairUnits, group: { units: [unitOf(10, "ko"), unitOf(20, "en")], targets: [koSlot, enSlot, koWritten] }, tables: new Map() },
      "confirm",
    );
    expect(body.removed_target_ids).toEqual([80]);
    expect(body.targets).toContainEqual(expect.objectContaining({ id: 81, source_unit_ids: [20], slot_key: "scope", target_doc_id: 6 }));
    expect(body.units.map((unit) => unit.unit_id)).toEqual([10, 20]);
  });

  it("echoes another unit's slot sentence with its place", () => {
    const otherSlot = makeTarget({ id: 90, source_unit_ids: [11], status: "confirmed", slot_key: "purpose" });
    const body = buildGroupSave(
      makeDraft({ destination: { kind: "link", targetIds: [71] } }),
      { units: ONE_UNIT, group: { units: [unitOf(11, "ko")], targets: [written(71, [11]), otherSlot] }, tables: new Map() },
      "confirm",
    );
    expect(body.targets).toContainEqual(expect.objectContaining({ id: 90, target_doc_id: 6, slot_key: "purpose", wi_step: null, wi_part: null, source_unit_ids: [11] }));
  });
});

describe("a one-language link on a pair row leaves the other language open", () => {
  const pairUnits = [ONE_UNIT[0], { id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 }];
  const english = makeTarget({ id: 75, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "en", status: "unassigned", change_type: null, source_unit_ids: [] });
  const groupUnit = (id: number, lang: "ko" | "en", disposition: Decision["disposition"], status: Decision["status"]): Group["units"][number] => ({
    unit_id: id, display_id: `OLD-1-0${id}`, document_id: 1, kind: "sentence", lang, text: `원문 ${id}`, group_id: null, cell_unit_ids: [],
    decision: { disposition, move_target_code: "", reason: "", status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 },
  });
  const contextOf = (korean: Group["units"][number]) => ({
    units: pairUnits, group: { units: [korean, groupUnit(20, "en", "unassigned", "unassigned")], targets: [english] }, tables: new Map(),
  });
  const open = contextOf(groupUnit(10, "ko", "unassigned", "unassigned"));
  const link: Destination = { kind: "link", targetIds: [75] };

  it("leaves the undecided other-language unit out of a confirm save", () => {
    const body = buildGroupSave(makeDraft({ destination: link }), open, "confirm");
    expect(body.units.map((unit) => unit.unit_id)).toEqual([20]);
    expect(body.targets).toEqual([expect.objectContaining({ id: 75, source_unit_ids: [20] })]);
  });

  it("releases the leftover unit in the same save", () => {
    // 한/영 짝 줄을 영어 새 문장 하나에만 잇는다 - 서버가 같은 저장 안에서 짝을 푼다
    expect(buildGroupSave(makeDraft({ destination: link }), open, "confirm").release_unit_ids).toEqual([10]);
  });

  it("still carries it in a hold save, which the server takes undecided", () => {
    const body = buildGroupSave(makeDraft({ destination: link }), open, "hold", "나중에");
    expect(body.units.map((unit) => [unit.unit_id, unit.disposition])).toEqual([[20, "assigned"], [10, "unassigned"]]);
    expect(body.release_unit_ids).toEqual([]);
  });

  it("lists the unit the link leaves behind", () => {
    expect(listLinkLeftovers(link, open)).toEqual([10]);
  });

  it("leaves nothing behind while the picked sentence's group has not arrived", () => {
    const unloaded = { units: pairUnits, group: { units: open.group.units, targets: [] } };
    expect(listLinkLeftovers(link, unloaded)).toEqual([]);
  });

  it("counts a unit held without a destination as left behind", () => {
    const held = contextOf(groupUnit(10, "ko", "unassigned", "on_hold"));
    expect(listLinkLeftovers(link, held)).toEqual([10]);
    expect(buildGroupSave(makeDraft({ destination: link }), held, "confirm").units.map((unit) => unit.unit_id)).toEqual([20]);
  });

  it("leaves nothing behind when the other language already has a decision", () => {
    const decided = contextOf(groupUnit(10, "ko", "delete", "confirmed"));
    expect(listLinkLeftovers(link, decided)).toEqual([]);
    expect(buildGroupSave(makeDraft({ destination: link }), decided, "confirm").units.map((unit) => unit.unit_id)).toEqual([20, 10]);
  });

  it("leaves nothing behind for a slot or when both languages are linked", () => {
    const korean = makeTarget({ id: 76, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "ko", status: "unassigned", change_type: null, source_unit_ids: [] });
    const both = { ...open, group: { units: open.group.units, targets: [english, korean] } };
    expect(listLinkLeftovers(SCOPE, open)).toEqual([]);
    expect(listLinkLeftovers(null, open)).toEqual([]);
    expect(listLinkLeftovers({ kind: "link", targetIds: [75, 76] }, both)).toEqual([]);
  });
});

describe("links across languages are translations", () => {
  const english = [{ id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 }];
  const pair = [ONE_UNIT[0], english[0]];
  const koTarget = makeTarget({ id: 71, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "ko", status: "unassigned", change_type: null, source_unit_ids: [] });
  const enTarget = makeTarget({ id: 72, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "en", status: "unassigned", change_type: null, source_unit_ids: [] });
  const contextOf = (units: typeof pair) => ({ units, group: { units: [], targets: [koTarget, enTarget] }, tables: new Map() });
  const both: Destination = { kind: "link", targetIds: [71, 72] };

  it("sources a linked sentence from the same-language unit when the row has one", () => {
    const body = buildGroupSave(makeDraft({ destination: both }), contextOf(pair), "confirm");
    expect(body.targets.map((target) => [target.id, target.source_unit_ids])).toEqual([[71, [10]], [72, [20]]]);
  });

  it("sources a linked sentence from every unit when the row lacks its language", () => {
    // 영어 단위만 있는 줄을 한글·영어 새 문장 둘에 잇는다 - 한글 새 문장은 그 영어 단위가 출처이고 종류는 서버가 번역으로 정한다
    const body = buildGroupSave(makeDraft({ destination: both }), contextOf(english), "confirm");
    expect(body.units.map((unit) => unit.unit_id)).toEqual([20]);
    const korean = body.targets.find((target) => target.id === 71);
    expect(korean).toMatchObject({ source_unit_ids: [20] });
    expect(korean).not.toHaveProperty("change_type");
    expect(body.targets.find((target) => target.id === 72)).toMatchObject({ source_unit_ids: [20] });
    expect(body.targets.find((target) => target.id === 72)).not.toHaveProperty("change_type");
    expect(body.release_unit_ids).toEqual([]);
  });

  it("leaves nothing behind when a one-language row links only the other language", () => {
    const korean: Destination = { kind: "link", targetIds: [71] };
    expect(listLinkLeftovers(korean, contextOf(english))).toEqual([]);
    const body = buildGroupSave(makeDraft({ destination: korean }), contextOf(english), "confirm");
    expect(body.units.map((unit) => unit.unit_id)).toEqual([20]);
    expect(body.targets.find((target) => target.id === 71)).toMatchObject({ source_unit_ids: [20] });
  });
});

describe("hand-written other language", () => {
  const enUnit = { id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 };
  const placed = makeTarget({ id: 90, lang: "en", confirmed_text: "Source", status: "confirmed", source_unit_ids: [20] });
  const group: Group = { units: [], targets: [placed] };

  it("adds an empty slot for a hand-written other language", () => {
    const slots = buildSentenceSlots(group, [enUnit], { lang: "ko", unitId: enUnit.id });
    expect(slots.at(-1)).toMatchObject({ key: `x${enUnit.id}`, target: null, lang: "ko", sourceIds: [enUnit.id], text: "", sourceText: null, isAiPending: false, isTranslated: true });
    expect(slots[0]).toMatchObject({ key: "t90", isTranslated: false });
  });

  it("saves the written sentence in the same place with its language and no change type", () => {
    const body = buildGroupSave(makeDraft({ otherLang: { lang: "ko", unitId: 20 }, texts: { x20: " 원문 번역 " } }), { units: [enUnit], group, tables: new Map() }, "confirm");
    const written = body.targets.find((target) => target.key === "x20");
    expect(written).toMatchObject({ target_doc_id: 6, slot_key: "scope", kind: "sentence", lang: "ko", text: "원문 번역", source_unit_ids: [20] });
    expect(written).not.toHaveProperty("change_type");
  });

  it("does not send an empty hand-written slot", () => {
    const body = buildGroupSave(makeDraft({ otherLang: { lang: "ko", unitId: 20 }, texts: { x20: "  " } }), { units: [enUnit], group, tables: new Map() }, "confirm");
    expect(body.targets.map((target) => target.key)).toEqual(["t90"]);
  });

  it("does not call a translated slot a split", () => {
    // 같은 영어 단위에서 나온 영어 칸 + 한글 칸 - 한글은 번역, 영어는 나눔이 아니다
    const saved = makeTarget({ id: 91, lang: "ko", confirmed_text: "번역", status: "confirmed", change_type: "translated", source_unit_ids: [20] });
    const slots = buildSentenceSlots({ units: [], targets: [placed, saved] }, [enUnit]);
    expect(slots.map((slot) => [slot.key, readSlotKind(slot, slots)])).toEqual([["t90", null], ["t91", "translated"]]);
  });

  it("still calls two same-language slots from one unit a split", () => {
    const second = makeTarget({ id: 92, lang: "en", confirmed_text: "Second", status: "confirmed", source_unit_ids: [20], order_index: 1 });
    const slots = buildSentenceSlots({ units: [], targets: [placed, second] }, [enUnit]);
    expect(slots.map((slot) => readSlotKind(slot, slots))).toEqual(["split", "split"]);
  });
});

describe("other language offers", () => {
  const koUnit = { id: 10, kind: "sentence", lang: "ko" as const, text: "원문", revision: 1 };
  const placed = makeTarget({ id: 90, lang: "ko", confirmed_text: "원문", status: "confirmed", source_unit_ids: [10] });

  it("treats headings and unbound cell sentences as text units, not tables or figures", () => {
    expect(["sentence", "heading", "cell_sentence"].map(isSentenceUnit)).toEqual([true, true, true]);
    expect(["table", "figure"].map(isSentenceUnit)).toEqual([false, false]);
  });

  it("has the language once a hand-written sentence in it is placed", () => {
    const written = makeTarget({ id: 91, lang: "en", confirmed_text: "Written", status: "confirmed", change_type: "translated", source_unit_ids: [10] });
    const group: Group = { units: [], targets: [placed, written] };
    expect(hasRowLanguage("en", buildSentenceSlots(group, [koUnit]), group, [10])).toBe(true);
  });

  it("has the language while its empty slot is open", () => {
    const group: Group = { units: [], targets: [placed] };
    expect(hasRowLanguage("en", buildSentenceSlots(group, [koUnit], { lang: "en", unitId: 10 }), group, [10])).toBe(true);
  });

  it("counts an AI translation of the row as having the language", () => {
    const translation = makeTarget({ id: 92, lang: "en", origin: "translation", ai_text: "Translated", source_unit_ids: [], translation_source_unit_id: 10 });
    const group: Group = { units: [], targets: [placed, translation] };
    expect(hasRowLanguage("en", buildSentenceSlots(group, [koUnit]), group, [10])).toBe(true);
    expect(hasRowLanguage("en", buildSentenceSlots(group, [koUnit]), group, [11])).toBe(false);
  });

  it("lacks the language when only the row's own language is placed", () => {
    const group: Group = { units: [], targets: [placed] };
    expect(hasRowLanguage("en", buildSentenceSlots(group, [koUnit]), group, [10])).toBe(false);
  });
});

describe("a neutral row linked to a sentence", () => {
  it("is not a translation - the server asks for a change type", () => {
    expect(isTranslationOf("ko", ["neutral"])).toBe(false);
    expect(isTranslationOf("neutral", ["ko"])).toBe(false);
    expect(isTranslationOf("en", ["ko"])).toBe(true);
    expect(isTranslationOf("ko", ["ko", "en"])).toBe(false);
  });

  it("links a neutral unit to a Korean sentence without a change type", () => {
    const digits = [{ id: 30, kind: "sentence", lang: "neutral" as const, text: "2.5", revision: 1 }];
    const korean = makeTarget({ id: 71, origin: "new_doc", target_doc_id: 9, slot_key: null, lang: "ko", confirmed_text: "2.5", status: "unassigned", change_type: null, source_unit_ids: [] });
    const body = buildGroupSave(
      makeDraft({ destination: { kind: "link", targetIds: [71] } }),
      { units: digits, group: { units: [], targets: [korean] }, tables: new Map() },
      "confirm",
    );
    expect(body.targets.find((target) => target.id === 71)).toMatchObject({ source_unit_ids: [30] });
    expect(body.targets.find((target) => target.id === 71)).not.toHaveProperty("change_type");
  });
});

// --- 칸 제목 목적지 ---

describe("slot heading destination", () => {
  const HEADING_UNITS = [
    { id: 20, kind: "heading", lang: "ko" as const, text: "목적", revision: 2 },
    { id: 21, kind: "sentence", lang: "en" as const, text: "Purpose", revision: 3 },
  ];
  const HEADING: Destination = { kind: "slot_heading", docId: 6, slotKey: "procedures" };

  it("offers a slot heading place right before each SOP section that is not N/A, none for WI", () => {
    const tobe: ToBe = { ...TOBE, na_slots: [{ code: "SOP-CF", slot_key: "scope", reason: "x" }] };
    const ids = buildDestinationOptions(tobe).map((option) => option.id);
    expect(ids).toContain("heading:6:procedures.p1");
    expect(ids.indexOf("heading:6:procedures.p1")).toBe(ids.indexOf("slot:6:procedures.p1") - 1);
    expect(ids.some((id) => id.startsWith("heading:6:scope"))).toBe(false);
    expect(ids.some((id) => id.startsWith("heading:7"))).toBe(false);
  });

  it("saves each heading unit of a pair row as its own slot heading with no text", () => {
    const body = buildGroupSave(makeDraft({ destination: HEADING }), { units: HEADING_UNITS, group: null, tables: new Map() }, "confirm");
    expect(body.targets.map((target) => [target.kind, target.target_doc_id, target.slot_key, target.source_unit_ids, target.text, target.lang])).toEqual([
      ["slot_heading", 6, "procedures", [20], undefined, undefined],
      ["slot_heading", 6, "procedures", [21], undefined, undefined],
    ]);
    expect(body.units.map((unit) => unit.disposition)).toEqual(["assigned", "assigned"]);
  });

  it("keeps the saved heading's id and revision, and removes a sentence the row had", () => {
    const group: Group = {
      units: [],
      targets: [
        makeTarget({ id: 70, kind: "slot_heading", slot_key: "procedures", lang: "ko", source_unit_ids: [20], revision: 5 }),
        makeTarget({ id: 71, kind: "sentence", slot_key: "scope", lang: "en", source_unit_ids: [21] }),
      ],
    };
    const body = buildGroupSave(makeDraft({ destination: HEADING }), { units: HEADING_UNITS, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ id: 70, revision: 5, kind: "slot_heading", source_unit_ids: [20] });
    expect(body.targets[1]).not.toHaveProperty("id");
    expect(body.removed_target_ids).toEqual([71]);
  });

  it("removes this row's slot heading link when the row goes to a slot", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 70, kind: "slot_heading", slot_key: "procedures", source_unit_ids: [20] })] };
    const body = buildGroupSave(makeDraft(), { units: [HEADING_UNITS[0]], group, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([70]);
  });

  it("re-sends the saved slot heading id and revision with the new section, removing nothing", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 70, kind: "slot_heading", slot_key: "procedures", lang: "ko", source_unit_ids: [20], revision: 5 })] };
    const body = buildGroupSave(makeDraft({ destination: { kind: "slot_heading", docId: 6, slotKey: "purpose" } }), { units: [HEADING_UNITS[0]], group, tables: new Map() }, "confirm");
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]).toMatchObject({ id: 70, revision: 5, kind: "slot_heading", slot_key: "purpose", target_doc_id: 6, source_unit_ids: [20] });
    expect(body.removed_target_ids).toEqual([]);
  });

  it("counts the same places whether or not the row can pick a slot heading", () => {
    const options = buildDestinationOptions(TOBE);
    const withHeadings = listTreeOptions(options, true);
    const without = listTreeOptions(options, false);
    expect(withHeadings.length).toBeGreaterThan(without.length);
    expect(without.some((option) => option.destination.kind === "slot_heading")).toBe(false);
    expect(withHeadings.filter(isPlaceOption).length).toBe(without.filter(isPlaceOption).length);
  });

  it("reads a group with slot heading targets back as the slot heading destination", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 70, kind: "slot_heading", slot_key: "procedures", source_unit_ids: [20] })] };
    expect(readDestination(group, [20, 21])).toEqual(HEADING);
  });
});

describe("buildGroupSave with a drop position", () => {
  const position = { placeId: "slot:6:scope", after: 41 };
  const context = (group: Group | null) => ({ units: ONE_UNIT, group, tables: new Map() });
  it("sends the position on a new sentence, and null for the front of the slot", () => {
    expect(buildGroupSave(makeDraft({ position }), context(null), "confirm").targets[0]).toMatchObject({ key: "u10", position: { after_target_id: 41 } });
    expect(buildGroupSave(makeDraft({ position: { placeId: "slot:6:scope", after: null } }), context(null), "confirm").targets[0].position).toEqual({ after_target_id: null });
  });
  it("adds no position key without a drop, or once the destination is no longer the dropped place", () => {
    expect(buildGroupSave(makeDraft(), context(null), "confirm").targets[0]).not.toHaveProperty("position");
    expect(buildGroupSave(makeDraft({ position: { placeId: "slot:6:purpose", after: 41 } }), context(null), "confirm").targets[0]).not.toHaveProperty("position");
  });
  it("sends it on a sentence that moves from another slot, not on one already in the slot", () => {
    const moved: Group = { units: [], targets: [makeTarget({ id: 90, slot_key: "purpose", confirmed_text: "원문", status: "confirmed" })] };
    expect(buildGroupSave(makeDraft({ position }), context(moved), "confirm").targets[0]).toMatchObject({ id: 90, slot_key: "scope", position: { after_target_id: 41 } });
    const here: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "원문", status: "confirmed" })] };
    expect(buildGroupSave(makeDraft({ position }), context(here), "confirm").targets[0]).not.toHaveProperty("position");
  });
  it("sends it on a table sentence but not on its cells", () => {
    const tables = new Map([[10, { rows: 1, cols: 1, cells: [{ id: 11, lang: "ko" as const, text: "칸", row: 0, col: 0 }] }]]);
    const body = buildGroupSave(makeDraft({ position }), { units: [{ id: 10, kind: "table", lang: "neutral" as const, text: "", revision: 1 }], group: null, tables }, "confirm");
    expect(body.targets.map((target) => [target.key, target.position ?? null])).toEqual([["u10", { after_target_id: 41 }], ["c11", null]]);
  });
});

describe("paragraph number stays in the number cell", () => {
  // 번호 범위(content_start)가 있는 줄 - New 초안은 번호를 뺀 내용이다
  const numbered = { id: 10, kind: "sentence", lang: "ko" as const, text: "6.2 합성 필터를 확인한다.", content_start: 4, revision: 1 };

  it("drafts the New sentence without the number and previews it as is", () => {
    expect(buildSentenceSlots(null, [numbered])).toMatchObject([{ key: "u10", text: "합성 필터를 확인한다.", sourceText: "합성 필터를 확인한다." }]);
    const body = buildGroupSave(makeDraft(), { units: [numbered], group: null, tables: new Map() }, "confirm");
    expect(body.targets).toMatchObject([{ key: "u10", text: "합성 필터를 확인한다." }]);
    expect(previewSlotChange(buildSentenceSlots(null, [numbered])[0], undefined)).toBe("as_is");
  });

  it("keeps the number in the draft while it is still text", () => {
    const typed = { ...numbered, content_start: 0 };
    expect(buildSentenceSlots(null, [typed])[0].text).toBe("6.2 합성 필터를 확인한다.");
  });

  it("reads a confirmed sentence equal to the content as as-is", () => {
    const target = { kind: "sentence" as const, lang: "ko" as const, confirmed_text: "합성 필터를 확인한다.", change_type: null, source_unit_ids: [] };
    expect(previewLinkChange(target, [numbered], [10])).toBe("as_is");
    expect(previewLinkChange({ ...target, confirmed_text: numbered.text }, [numbered], [10])).toBe("as_is");
  });
});

describe("previewSlotChange", () => {
  // 서버 _decide_change_type과 같은 규칙 - 결정 칸의 "=" / "수정" 표시
  const [fresh] = buildSentenceSlots(null, ONE_UNIT);

  it("reads a new slot as as-is until its text differs from the source, and an emptied one as the source", () => {
    expect(previewSlotChange(fresh, undefined)).toBe("as_is");
    expect(previewSlotChange(fresh, " 원문 ")).toBe("as_is");
    expect(previewSlotChange(fresh, "  ")).toBe("as_is");
    expect(previewSlotChange(fresh, "원문을 고침")).toBe("rewritten");
  });

  it("keeps the server's type for an untouched or emptied saved sentence, and previews an edit from its text", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "고친 글", change_type: "rewritten", status: "confirmed" })] };
    const [saved] = buildSentenceSlots(group, ONE_UNIT);
    expect(previewSlotChange(saved, undefined)).toBe("rewritten");
    expect(previewSlotChange(saved, "")).toBe("rewritten");
    expect(previewSlotChange(saved, "원문")).toBe("as_is");
  });
});

describe("join destination adds the row as a source of a placed sentence", () => {
  // 안 쓴 문서에 놓인 새 문장(origin units)은 글·자리를 지금 그대로 되보내고 출처만 늘린다
  const placed = makeTarget({ id: 60, target_doc_id: 6, slot_key: "scope", confirmed_text: "관리자는 설정 값을 바꾼다.", status: "confirmed", change_type: "as_is", source_unit_ids: [11], revision: 4 });
  const first: Group["units"][number] = {
    unit_id: 11, display_id: "OLD-5-001", document_id: 5, kind: "sentence", lang: "ko", text: "설정 값을 바꾼다.", group_id: null, cell_unit_ids: [],
    decision: { disposition: "assigned", move_target_code: "", reason: "", status: "confirmed", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 3 },
  };
  const join: Destination = { kind: "join", docId: 6, targetId: 60 };
  const context = (targets: GroupTarget[]) => ({ units: ONE_UNIT, group: { units: [first], targets }, tables: new Map() });

  it("sends the placed sentence with both sources and no text or change type", () => {
    const body = buildGroupSave(makeDraft({ destination: join }), context([placed]), "confirm");
    expect(body.targets).toEqual([expect.objectContaining({ id: 60, revision: 4, source_unit_ids: [11, 10], target_doc_id: 6, slot_key: "scope" })]);
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[0]).not.toHaveProperty("change_type");
    expect(body.units).toEqual([expect.objectContaining({ unit_id: 10, disposition: "assigned" }), { unit_id: 11, revision: 3, disposition: "assigned", move_target_code: "", reason: "" }]);
  });

  it("removes the row's own earlier sentence and keeps unrelated ones", () => {
    const own = makeTarget({ id: 80, source_unit_ids: [10] });
    const body = buildGroupSave(makeDraft({ destination: join }), context([placed, own]), "confirm");
    expect(body.removed_target_ids).toEqual([80]);
    expect(body.targets.map((target) => target.id)).toEqual([60]);
  });

  it("does not repeat a source that is already there", () => {
    const already = makeTarget({ ...placed, source_unit_ids: [11, 10] });
    const body = buildGroupSave(makeDraft({ destination: join }), context([already]), "confirm");
    expect(body.targets[0].source_unit_ids).toEqual([11, 10]);
  });

  it("leaves the other language of a pair open like a link does", () => {
    const pairUnits = [ONE_UNIT[0], { id: 20, kind: "sentence", lang: "en" as const, text: "Source", revision: 2 }];
    const body = buildGroupSave(makeDraft({ destination: join }), { units: pairUnits, group: { units: [first, { ...first, unit_id: 20, lang: "en", decision: { ...first.decision, disposition: "unassigned", status: "unassigned" } }], targets: [placed] }, tables: new Map() }, "confirm");
    expect(body.units.map((unit) => unit.unit_id)).toEqual([10, 11]);
    expect(body.release_unit_ids).toEqual([20]);
  });

  it("has its own destination id and lists the joined target", () => {
    expect(getDestinationId(join)).toBe("join:60");
    expect(listJoinedTargetIds(join)).toEqual([60]);
    expect(listJoinedTargetIds({ kind: "link", targetIds: [3, 4] })).toEqual([3, 4]);
    expect(listJoinedTargetIds(SCOPE)).toEqual([]);
  });
});

describe("linking a cell of a written table (mockup 2 D5)", () => {
  const table = makeTarget({ id: 40, origin: "new_doc", target_doc_id: 9, slot_key: null, kind: "table", lang: "neutral", status: "unassigned", change_type: null, source_unit_ids: [], revision: 7, grid: { rows: 1, cols: 2 } });
  const cell = makeTarget({ id: 41, origin: "new_doc", target_doc_id: 9, slot_key: null, parent_target_id: 40, cell_row: 0, cell_col: 0, confirmed_text: "원문", status: "unassigned", change_type: null, source_unit_ids: [], revision: 2 });
  const sibling = makeTarget({ id: 42, origin: "new_doc", target_doc_id: 9, slot_key: null, parent_target_id: 40, cell_row: 0, cell_col: 1, confirmed_text: "옆 칸", status: "confirmed", change_type: "as_is", source_unit_ids: [11], revision: 3 });
  const other: Group["units"][number] = {
    unit_id: 11, display_id: "OLD-5-002", document_id: 5, kind: "sentence", lang: "ko", text: "옆 칸", group_id: null, cell_unit_ids: [],
    decision: { disposition: "assigned", move_target_code: "", reason: "", status: "confirmed", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 2 },
  };
  const context = { units: ONE_UNIT, group: { units: [other], targets: [table, cell, sibling] }, tables: new Map() };

  it("adds the row to that cell only and echoes the table and sibling cells without a parent key", () => {
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [41] } }), context, "confirm");
    expect(body.units).toEqual([
      expect.objectContaining({ unit_id: 10, revision: 1, disposition: "assigned" }),
      { unit_id: 11, revision: 2, disposition: "assigned", move_target_code: "", reason: "" },
    ]);
    expect(body.targets).toEqual([
      { key: "t40", id: 40, revision: 7, kind: "table", source_unit_ids: [] },
      { key: "t41", id: 41, revision: 2, kind: "sentence", source_unit_ids: [10] },
      { key: "t42", id: 42, revision: 3, kind: "sentence", source_unit_ids: [11] },
    ]);
    expect(body.removed_target_ids).toEqual([]);
  });

  it("merges a second row into a linked cell", () => {
    const linked = { ...cell, source_unit_ids: [12], status: "confirmed" as const };
    const body = buildGroupSave(makeDraft({ destination: { kind: "link", targetIds: [41] } }), { ...context, group: { units: [other], targets: [table, linked, sibling] } }, "confirm");
    expect(body.targets.find((target) => target.id === 41)?.source_unit_ids).toEqual([12, 10]);
  });

  it("reads a cell link back as the row's destination", () => {
    const linked = { ...cell, source_unit_ids: [10] };
    expect(readDestination({ units: [], targets: [table, linked, sibling] }, [10])).toEqual({ kind: "link", targetIds: [41] });
    expect(isWrittenCell(linked)).toBe(true);
    // 표 새 문장 · 줄로 만든 칸 새 문장은 이미 쓴 문서의 칸이 아니다
    expect(isWrittenCell(table)).toBe(false);
    expect(isWrittenCell({ ...linked, origin: "units" })).toBe(false);
  });

  it("maps each written cell to its table row", () => {
    const row = { target_id: 40, table: { rows: 1, cols: 2, cells: [{ target_id: 41 }, { target_id: 42 }] } } as unknown as WrittenSentence;
    const owners = buildCellOwners([row]);
    expect([owners.get(41)?.target_id, owners.get(42)?.target_id, owners.has(40)]).toEqual([40, 40, false]);
  });
});
