// 제목 → 문장 묶음(F8b) - 제목 스타일 조항을 문장으로 바꾼 줄(from_heading)을 조항 짝마다 묶어 Old 용지에 머리 하나를 단다:
// "[제목 → 문장] 제목 2개를 문장 짝 3개로 · ↺ 제목으로". 묶음은 첫 언어 조항에서 시작해 그 번역 조항(들)까지다 -
// 영어 조항 다음 한글 번역이면 영어 조항이 다시 올 때 새 묶음이다. 짝 없는 한글 조항(제 번호가 있다)은 앞 묶음에 든다.
import type { ViewUnit } from "./api-sop";

export interface HeadingShiftGroup {
  /** 묶음의 첫 단위(용지 순서) - 머리를 이 줄 위에 단다 */
  firstUnitId: number;
  /** 묶음의 바꾼 문장 전부 - "↺ 제목으로"가 보낸다(서버가 조항 줄 단위로 모은다) */
  unitIds: number[];
  /** 원래 제목 수 - 바꾼 조항 블록 수 */
  headingCount: number;
  /** 배정 줄 수 - 한/영 짝 하나가 한 줄, 짝 없는 문장도 한 줄 */
  pairCount: number;
  loneCount: number;
}

/** 용지 순서 - 블록 순번, 그다음 블록 안 시작 자리 */
function comparePosition(a: ViewUnit, b: ViewUnit): number {
  return a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id;
}

function isShifted(unit: ViewUnit): boolean {
  return unit.kind === "sentence" && unit.from_heading === true && !unit.noise_kind;
}

/** 바꾼 문장 묶음들(용지 순서) - 바꾼 문장이 아닌 단위가 끼면 묶음이 끊긴다 */
export function buildHeadingShiftGroups(units: Iterable<ViewUnit>): HeadingShiftGroup[] {
  const ordered = [...units].sort(comparePosition);
  const runs: ViewUnit[][] = [];
  let run: ViewUnit[] | null = null;
  for (const unit of ordered) {
    if (!isShifted(unit)) {
      run = null;
      continue;
    }
    const previous = run?.[run.length - 1];
    // 첫 언어 조항이 번역 다음에 다시 오면 새 조항 짝이다
    const startsClause = run !== null && previous !== undefined && unit.pos_seq !== previous.pos_seq && unit.lang === run[0].lang && previous.lang !== run[0].lang;
    if (run === null || startsClause) {
      run = [];
      runs.push(run);
    }
    run.push(unit);
  }
  return runs.map((members) => {
    const pairIds = new Set(members.flatMap((unit) => (unit.pair_id === null ? [] : [unit.pair_id])));
    return {
      firstUnitId: members[0].id,
      unitIds: members.map((unit) => unit.id),
      headingCount: new Set(members.map((unit) => unit.pos_seq)).size,
      pairCount: pairIds.size,
      loneCount: members.filter((unit) => unit.pair_id === null).length,
    };
  });
}

/** 묶음 머리 글의 문구 키와 값 - 모두 짝이면 "제목 n개를 문장 짝 m개로", 짝 없는 줄이 있으면 "제목 n개를 문장 m줄로" */
export function readHeadingShiftHead(group: HeadingShiftGroup): { key: string; values: { h: number; n: number } } {
  if (group.loneCount === 0) return { key: "assign.headingShift.headPairs", values: { h: group.headingCount, n: group.pairCount } };
  return { key: "assign.headingShift.headLines", values: { h: group.headingCount, n: group.pairCount + group.loneCount } };
}

/** 고른 줄(짝이면 두 단위)에서 "제목으로 되돌리기"가 보낼 단위 - 제목에서 바꾼 문장만. 없으면 빈 목록(단추를 두지 않는다) */
export function listHeadingBackUnits(units: readonly ViewUnit[]): number[] {
  return units.filter(isShifted).map((unit) => unit.id);
}
