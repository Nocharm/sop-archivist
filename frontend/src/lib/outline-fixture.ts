/** 골격을 읽는 순수 모델 시험이 함께 쓰는 합성 골격 - 서버가 ToBe.outline_items와 절에 싣는 값을 시험마다 되풀이해 적지 않는다. 화면 코드는 가져오지 않는다(칸 목록은 서버가 준다) */
import type { OutlineItem, SectionOutline } from "./api-sop";

type SlotSeed = readonly [key: string, title: string];

/** 15칸 골격 - 표준을 문서 사본으로 옮긴 걸음의 서버 표준과 같은 키·순서 */
const LEGACY_SLOTS: readonly SlotSeed[] = [
  ["purpose", "Purpose"],
  ["scope", "Scope"],
  ["definitions", "Definitions"],
  ["responsibilities", "Responsibilities"],
  ["general_requirements", "General requirements"],
  ["general_requirements.safety", "Safety"],
  ["general_requirements.operation", "Operation"],
  ["procedures", "Procedures"],
  ["procedures.procedure", "Procedure"],
  ["procedures.electronic_record_control", "Electronic record control"],
  ["procedures.troubleshooting", "Troubleshooting"],
  ["procedures.maintenance", "Maintenance"],
  ["document_relationships", "Document relationships"],
  ["document_relationships.attachments", "Attachments"],
  ["document_relationships.appendices", "Appendices"],
];

/** 15칸 골격의 키 - 서버 순서 */
export const LEGACY_KEYS: readonly string[] = LEGACY_SLOTS.map(([key]) => key);

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
      ...patches[key],
    };
    made.set(key, item);
    return item;
  });
}

/** 15칸 골격 - 5·6·7은 named_children(줄을 세지 않는다), 번호는 1…7과 5.1 · 5.2 · 6.1–6.4 · 7.1 · 7.2 */
export function makeLegacyOutline(code: string, patches: Readonly<Record<string, Partial<OutlineItem>>> = {}): OutlineItem[] {
  return makeOutline(code, LEGACY_SLOTS, patches);
}

/** 세 수준 골격(a › a.b › a.b.c)과 옆의 최상위 칸 z - 수준이 둘이라고 가정한 코드를 잡는다 */
export function makeDeepOutline(code: string, patches: Readonly<Record<string, Partial<OutlineItem>>> = {}): OutlineItem[] {
  return makeOutline(code, [["a", "A"], ["a.b", "B"], ["a.b.c", "C"], ["z", "Z"]], patches);
}

/** 절 시험 값에 얹는 골격 칸 - 기본은 줄을 세는 최상위 일반 칸 */
export function makeSectionOutline(patch: Partial<SectionOutline> = {}): SectionOutline {
  return { kind: "general", level: 0, counts_lines: true, default_style: "numbered", ...patch };
}
