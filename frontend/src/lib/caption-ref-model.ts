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

/** 참조를 다시 이을 수 있는 묶음 - 표 또는 그림 전부. 용지 순서 */
export function listRefCandidates(kind: ViewCaptionRef["kind"], units: ReadonlyMap<number, ViewUnit>): ViewUnit[] {
  return [...units.values()].filter((unit) => unit.kind === kind && (kind === "figure" || unit.table_id !== null)).sort((a, b) => a.pos_seq - b.pos_seq);
}

/** 다시 매긴 번호 표시 - "표 1 → 표 3", 원문 번호가 없어 붙였으면 "+ 표 3" */
export function formatRenumber(change: RenumberChange): string {
  return change.from_label === "" ? `+ ${change.to_label}` : `${change.from_label} → ${change.to_label}`;
}
