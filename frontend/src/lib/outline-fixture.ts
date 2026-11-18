/** 골격을 읽는 순수 모델 시험이 함께 쓰는 합성 골격 - 서버가 ToBe.outline_items와 절에 싣는 값을 시험마다 되풀이해 적지 않는다. 화면 코드는 가져오지 않는다(칸 목록은 서버가 준다) */
import type { OutlineItem, OutlineKind, SectionOutline } from "./api-sop";

type SlotSeed = readonly [key: string, title: string];

/**
 * [키, 이름] 목록(위계 순서)에서 문서 하나(code)의 골격 항목을 만든다. 위계는 키의 점, 번호는 형제 순서(1 · 5.1 · 5.1.1),
 * 하위가 있는 항목은 named_children(직접 놓인 줄을 세지 않는다), 나머지는 general. patches로 키마다 값을 덮는다
 */
export function makeOutline(code: string, slots: readonly SlotSeed[], patches: Readonly<Record<string, Partial<OutlineItem>>> = {}): OutlineItem[] {
  const made = new Map<string, OutlineItem>();
  const childCounts = new Map<string | null, number>();
  return slots.map(([key, title]) => {
    const dot = key.lastIndexOf(".");
    const parent = dot < 0 ? undefined : made.get(key.slice(0, dot));
    const parentKey = parent?.key ?? null;
    const order = (childCounts.get(parentKey) ?? 0) + 1;
    childCounts.set(parentKey, order);
    const hasChildren = slots.some(([other]) => other.startsWith(`${key}.`));
    const item: OutlineItem = {
      code,
      key,
      parent_key: parentKey,
      level: parent ? parent.level + 1 : 0,
      number: parent ? `${parent.number}.${order}` : String(order),
      shows_number: true,
      title_en: title,
      title_ko: "",
      label: parent ? `${parent.label} › ${title}` : title,
      kind: hasChildren ? "named_children" : "general",
      is_required: true,
      default_style: "numbered",
      is_assignable: true,
      counts_lines: !hasChildren,
      origin: "standard",
      is_removed: false,
      deviation_reason: null,
      is_deviation: false,
      ...patches[key],
    };
    made.set(key, item);
    return item;
  });
}

type TemplateSeed = readonly [key: string, title: string, kind: OutlineKind, number: string | null];

const DOCS = "document_relationships";
const ASSOCIATED = `${DOCS}.associated_documents`;

/**
 * 회사 SOP 템플릿 골격(1–9장)에 문서가 선언한 것을 더한 한 벌 - 5장 범주 둘(Safety · Work), 6장 절차 하나, 9장 부록 하나.
 * 번호는 서버가 주는 그대로다: 범주는 번호가 없고, 7.1의 선택 항목 넷은 비어 있어 번호가 없고(내보내지 않는다), 부록은 자기 차례("1")
 */
const TEMPLATE_SLOTS: readonly TemplateSeed[] = [
  ["purpose", "Purpose", "general", "1"],
  ["scope", "Scope", "general", "2"],
  ["definitions", "Definitions", "general", "3"],
  ["responsibilities", "Responsibilities", "general", "4"],
  ["general_requirements", "General Requirements", "category_table", "5"],
  ["general_requirements.safety", "Safety", "general", null],
  ["general_requirements.work", "Work", "general", null],
  ["procedures", "Procedures", "named_children", "6"],
  ["procedures.p1", "Procedure 1", "general", "6.1"],
  [DOCS, "Document Relationships", "group", "7"],
  [ASSOCIATED, "Associated Documents", "group", "7.1"],
  [`${ASSOCIATED}.form`, "Form", "general", null],
  [`${ASSOCIATED}.visual_aid`, "Visual Aid", "general", null],
  [`${ASSOCIATED}.training_material`, "Training Material", "general", null],
  [`${ASSOCIATED}.quality_risk_assessment`, "Quality Risk Assessment", "general", null],
  [`${DOCS}.work_instructions`, "Work Instructions", "auto_list", "7.2"],
  [`${DOCS}.references`, "References", "general", "7.3"],
  ["attachments", "Attachments", "general", "8"],
  ["appendices", "Appendices", "named_children", "9"],
  ["appendices.a1", "Alarm list", "general", "1"],
];

/** 템플릿 골격의 키 - 서버 순서 */
export const TEMPLATE_KEYS: readonly string[] = TEMPLATE_SLOTS.map(([key]) => key);

/** 템플릿 골격에서 문장을 직접 받는 항목의 키 - 묶음(7 · 7.1)과 앱이 채우는 목록(7.2)을 뺀 것 */
export const TEMPLATE_PLACE_KEYS: readonly string[] = TEMPLATE_SLOTS.filter(([, , kind]) => kind !== "group" && kind !== "auto_list").map(([key]) => key);

/** 회사 템플릿 골격 - 종류마다의 배정·줄 세기·기본 표시는 서버 규칙과 같다(묶음·자동 목록은 문장을 받지 않고, general만 줄을 세고, 6장·9장과 그 하위만 번호 표시) */
export function makeTemplateOutline(code: string, patches: Readonly<Record<string, Partial<OutlineItem>>> = {}): OutlineItem[] {
  const made = new Map<string, OutlineItem>();
  return TEMPLATE_SLOTS.map(([key, title, kind, number]) => {
    const dot = key.lastIndexOf(".");
    const parent = dot < 0 ? undefined : made.get(key.slice(0, dot));
    const top = key.split(".")[0];
    const isAppendix = parent?.key === "appendices";
    const item: OutlineItem = {
      code,
      key,
      parent_key: parent?.key ?? null,
      level: parent ? parent.level + 1 : 0,
      number,
      // 부록은 이름(label)에 번호가 들어 있어 번호를 따로 적지 않는다
      shows_number: !isAppendix,
      title_en: title,
      title_ko: "",
      label: isAppendix ? `Appendix ${number}. ${title}` : parent ? `${parent.label} › ${title}` : title,
      kind,
      is_required: parent?.key !== ASSOCIATED,
      default_style: top === "procedures" || top === "appendices" ? "numbered" : "bullet",
      is_assignable: kind !== "group" && kind !== "auto_list",
      counts_lines: kind === "general",
      origin: parent !== undefined && parent.kind !== "group" ? "declared" : "standard",
      is_removed: false,
      deviation_reason: null,
      is_deviation: false,
      ...patches[key],
    };
    made.set(key, item);
    return item;
  });
}

/** 세 수준 골격(a › a.b › a.b.c)과 옆의 최상위 칸 z - 수준이 둘이라고 가정한 코드를 잡는다 */
export function makeDeepOutline(code: string, patches: Readonly<Record<string, Partial<OutlineItem>>> = {}): OutlineItem[] {
  return makeOutline(code, [["a", "A"], ["a.b", "B"], ["a.b.c", "C"], ["z", "Z"]], patches);
}

/** 절 시험 값에 얹는 골격 칸 - 기본은 줄을 세는 최상위 일반 칸(앱이 채우는 줄 없음) */
export function makeSectionOutline(patch: Partial<SectionOutline> = {}): SectionOutline {
  return { kind: "general", level: 0, counts_lines: true, default_style: "numbered", shows_number: true, auto_items: [], deviation_reason: null, is_empty_required: false, ...patch };
}
