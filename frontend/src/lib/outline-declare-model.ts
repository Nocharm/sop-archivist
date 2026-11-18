// SOP 문서가 선언하는 항목(템플릿의 6장 절차 · 9장 부록 · 5장 범주)의 목록을 읽는 순수 모델 - 화면은 이 결과를 그리기만 한다.
// 선언을 받는 부모는 키가 아니라 종류(named_children · category_table)로 찾는다 - 관리자가 표준 골격을 고쳐도 그대로 돈다.
// 여기의 판단(뺄 수 있나 · 같은 제목)은 단추를 미리 가리는 근거일 뿐이고, 서버가 저장할 때 같은 규칙을 다시 검사한다.
import type { OutlineItem, OutlineKind, TargetDoc, ToBe } from "./api-sop";

/** 뺄 수 없는 까닭 - 줄(문장 · 칸 제목)이 든 항목, 문서가 선언한 것이 아닌 항목(표준 항목은 여기서 고치지 않는다) */
export type OutlineRemoveBlock = "hasLines" | "notDeclared";

/** 적은 영어 제목의 문제 - 비었다, 같은 묶음에 이미 있다 */
export type OutlineTitleProblem = "empty" | "duplicate";

export interface DeclareRow {
  key: string;
  /** 제목 앞에 적는 글 - 절차 "6.2", 부록 "Appendix 1."(번호가 든 머리말), 번호 없는 항목(범주)은 "" */
  number: string;
  title_en: string;
  title_ko: string;
  /** 그 항목과 하위에 든 줄 수 - 문장과 칸 제목에 이은 옛 제목을 함께 센다(둘 다 빼기를 막는다) */
  lineCount: number;
  /** 같은 부모의 항목들 안에서의 자리(0부터) - 순서를 바꿀 때 서버에 보내는 값의 기준 */
  position: number;
  /** 제목을 고칠 수 있는가 - 문서가 선언한 항목만 */
  canRename: boolean;
  canRemove: boolean;
  /** canRemove가 false인 까닭 */
  removeBlock: OutlineRemoveBlock | null;
  /** 한 자리 위 · 아래로 옮길 수 있는가 - 문서가 선언한 항목이고 그쪽에 형제가 있을 때 */
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface DeclareGroup {
  parentKey: string;
  kind: OutlineKind;
  /** 부모의 번호("6") - 없으면 "" */
  number: string;
  /** 부모의 영어 제목 */
  title: string;
  rows: DeclareRow[];
  /** 아직 쓰지 않은 권장 이름 - 표준이 준 순서 */
  suggestions: string[];
}

const DECLARABLE_KINDS: readonly OutlineKind[] = ["named_children", "category_table"];

/** 이 부모의 권장 이름(Electronic Record Control · Troubleshooting · Maintenance)은 장비 SOP에만 권한다 - 다른 부모의 것은 늘 보인다 */
const EQUIPMENT_ONLY_PARENT = "procedures";

/** 같은 제목인지 견줄 때의 모양 - 앞뒤 공백과 대소문자를 무시한다(서버 duplicate_outline_title과 같은 기준) */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/** 번호를 적지 않는 항목(부록)은 번호가 이름(label "Appendix 2. 제목")에 들어 있다 - 제목을 뗀 머리말을 적는다 */
function formatNumber(item: OutlineItem): string {
  if (item.shows_number) return item.number ?? "";
  const head = item.label.endsWith(item.title_en) ? item.label.slice(0, item.label.length - item.title_en.length).trim() : "";
  return head !== "" ? head : (item.number ?? "");
}

/**
 * 그 SOP의 선언 묶음 - 선언을 받는 부모 항목마다 하나, 골격 순서대로. 뺀 항목은 읽지 않는다.
 * 이미 쓴 문서(entrance "match")는 구조가 파일의 것이라 묶음이 없고, WI는 골격이 없어 빈 목록이다
 */
export function buildDeclareGroups(tobe: ToBe, doc: TargetDoc): DeclareGroup[] {
  if (doc.doc_type !== "sop" || doc.entrance === "match") return [];
  const items = tobe.outline_items.filter((item) => item.code === doc.code && !item.is_removed);
  const parents = new Map(items.map((item) => [item.key, item.parent_key]));
  const isUnder = (key: string, ancestor: string): boolean => {
    for (let parent = parents.get(key) ?? null; parent !== null; parent = parents.get(parent) ?? null) if (parent === ancestor) return true;
    return false;
  };
  const counts = new Map<string, number>();
  for (const row of tobe.slot_counts ?? []) {
    if (row.target_doc_id === doc.id) counts.set(row.slot_key, row.count + row.heading_count);
  }

  return items
    .filter((item) => DECLARABLE_KINDS.includes(item.kind))
    .map((parent) => {
      const children = items.filter((item) => item.parent_key === parent.key);
      const rows = children.map((item, position): DeclareRow => {
        const lineCount = items.reduce((sum, other) => (other.key === item.key || isUnder(other.key, item.key) ? sum + (counts.get(other.key) ?? 0) : sum), 0);
        const isDeclared = item.origin === "declared";
        const removeBlock: OutlineRemoveBlock | null = !isDeclared ? "notDeclared" : lineCount > 0 ? "hasLines" : null;
        return {
          key: item.key,
          number: formatNumber(item),
          title_en: item.title_en,
          title_ko: item.title_ko,
          lineCount,
          position,
          canRename: isDeclared,
          canRemove: removeBlock === null,
          removeBlock,
          // 표준 항목은 자리도 여기서 옮기지 않는다(서버 422 outline_standard_item) - 선언한 항목이 그 위아래로 옮겨 갈 수는 있다
          canMoveUp: isDeclared && position > 0,
          canMoveDown: isDeclared && position < children.length - 1,
        };
      });
      const used = new Set(rows.map((row) => normalizeTitle(row.title_en)));
      const offered = parent.key === EQUIPMENT_ONLY_PARENT && !doc.is_equipment_sop ? [] : (tobe.outline_suggestions[parent.key] ?? []);
      const suggestions: string[] = [];
      for (const name of offered) {
        const title = name.trim();
        // 표준에 같은 이름이 두 번 적혀 있어도 칩은 하나
        if (title === "" || used.has(normalizeTitle(title))) continue;
        used.add(normalizeTitle(title));
        suggestions.push(title);
      }
      return { parentKey: parent.key, kind: parent.kind, number: parent.shows_number ? (parent.number ?? "") : "", title: parent.title_en, rows, suggestions };
    });
}

/** 묶음에 적으려는 영어 제목의 문제 - 없으면 null. exceptKey는 이름을 고치는 그 줄(자기 제목과는 겹쳐도 된다) */
export function checkOutlineTitle(group: DeclareGroup, title: string, exceptKey?: string): OutlineTitleProblem | null {
  const wanted = normalizeTitle(title);
  if (wanted === "") return "empty";
  return group.rows.some((row) => row.key !== exceptKey && normalizeTitle(row.title_en) === wanted) ? "duplicate" : null;
}
