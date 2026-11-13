// 되돌리기·다시 하기 알림 문구 - "되돌림 — Split" 처럼 무엇을 거꾸로 했는지 말한다(사용자 요청 2026-11-13).
import type { EditStepResult } from "@/lib/api-sop";

export interface StepMessage {
  key: string;
  vars: Record<string, string | number>;
}

// 기록 종류(op) → 원래 한 일의 이름 메시지 키. 모르는 종류는 이름 없이 "Undone"만
const OP_KEYS: Record<string, string> = {
  split: "split.step.split",
  merge: "split.step.merge",
  unmerge: "split.step.unmerge",
  move_boundary: "split.step.move_boundary",
  carve: "split.step.carve",
  set_language: "split.step.set_language",
  split_table_rows: "split.step.split_table_rows",
  merge_table_rows: "split.step.merge_table_rows",
  set_layout_table: "split.step.set_layout_table",
  check_all: "split.step.check_all",
};

/** 원래 한 일 - 경계 확인 기록은 응답의 바뀐 뒤 값과 방향으로 확인·확인 취소를 가른다 */
function getActionKey(result: EditStepResult, kind: "undo" | "redo"): string | null {
  if (result.op === "boundary") {
    const wasChecked = kind === "undo" ? result.confirmed === false : result.confirmed === true;
    return wasChecked ? "split.step.check" : "split.step.uncheck";
  }
  return OP_KEYS[result.op] ?? null;
}

/** 경계 확인 하나면 그 Unit 번호를, 여럿이면 수를 붙인다 */
export function describeEditStep(result: EditStepResult, kind: "undo" | "redo", findDisplayId: (unitId: number) => string | null): StepMessage {
  const actionKey = getActionKey(result, kind);
  const base = kind === "undo" ? "split.undone" : "split.redone";
  if (actionKey === null) return { key: base, vars: {} };
  const count = result.boundary_unit_ids.length;
  const single = count === 1 ? findDisplayId(result.boundary_unit_ids[0]) : null;
  return { key: `${base}.what`, vars: { action: actionKey, target: single ?? (count > 1 ? count : "") } };
}
