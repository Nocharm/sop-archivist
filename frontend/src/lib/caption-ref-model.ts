// 표·그림 참조 규칙 - Assign의 참조 카드가 보이는 라벨·대상, 다시 이을 후보, New 칸·결과물 C의 다시 매긴 번호 표시.
// 라벨은 원문 그대로의 번호다(다시 매긴 번호는 결과물이 정한다). 위치 참조의 방향은 저장하지 않아 대상 자리로 읽는다(서버 outputs와 같은 판단).
import type { RenumberChange, ViewCaptionRef, ViewUnit } from "@/lib/api-sop";

export interface CaptionRefInfo {
  /** "표 3"·"Figure 5"·"아래 표" - 참조 문장의 언어로 */
  label: string;
  /** 이은 묶음의 표시 ID - 못 찾았거나 문서에서 사라졌으면 null */
  targetDisplayId: string | null;
  missing: boolean;
}

const KIND_WORDS = { ko: { table: "표", figure: "그림" }, en: { table: "Table", figure: "Figure" } } as const;

/** 참조 하나의 라벨과 대상 - from은 참조를 가진 단위(라벨 언어와 위치 참조의 방향), 없으면 한국어·아래 */
export function describeCaptionRef(ref: ViewCaptionRef, units: ReadonlyMap<number, ViewUnit>, from?: ViewUnit): CaptionRefInfo {
  const target = ref.target_unit_id === null ? undefined : units.get(ref.target_unit_id);
  const isEnglish = from?.lang === "en";
  const word = KIND_WORDS[isEnglish ? "en" : "ko"][ref.kind];
  let label: string;
  if (ref.number !== null) {
    label = `${word} ${ref.number}`;
  } else {
    const isBelow = target === undefined || from === undefined || target.pos_seq >= from.pos_seq;
    label = isEnglish ? `the ${word.toLowerCase()} ${isBelow ? "below" : "above"}` : `${isBelow ? "아래" : "위"} ${word}`;
  }
  return { label, targetDisplayId: target?.display_id ?? null, missing: target === undefined };
}

/** 참조를 다시 이을 수 있는 묶음 - 표는 표마다 하나(행으로 나눈 표는 첫 행), 그림은 전부. 용지 순서 */
export function listRefCandidates(kind: ViewCaptionRef["kind"], units: ReadonlyMap<number, ViewUnit>): ViewUnit[] {
  if (kind === "figure") return [...units.values()].filter((unit) => unit.kind === "figure").sort((a, b) => a.pos_seq - b.pos_seq);
  const byTable = new Map<number, ViewUnit>();
  for (const unit of units.values()) {
    if ((unit.kind !== "table" && unit.kind !== "table_row") || unit.table_id === null) continue;
    const kept = byTable.get(unit.table_id);
    // 표 단위가 있으면 그것, 행으로 나눴으면 가장 앞 행(서버가 보기의 대상으로 고르는 것과 같다)
    if (kept === undefined || (kept.kind === "table_row" && (unit.kind === "table" || (unit.row_index ?? 0) < (kept.row_index ?? 0)))) byTable.set(unit.table_id, unit);
  }
  return [...byTable.values()].sort((a, b) => a.pos_seq - b.pos_seq);
}

/** 다시 매긴 번호 표시 - "표 1 → 표 3", 원문 번호가 없어 붙였으면 "+ 표 3" */
export function formatRenumber(change: RenumberChange): string {
  return change.from_label === "" ? `+ ${change.to_label}` : `${change.from_label} → ${change.to_label}`;
}
