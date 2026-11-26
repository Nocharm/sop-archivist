// 용지마다 쓸 수 있는 손질 - Old 용지, 한 단으로 연 New(new-wide), 양 단의 New(new-pair)가 같은 표에서 읽는다(쪼개기 먼저 설계 §8 4-3).
// New 두 자리는 폭만 다르고 손질은 Old와 같다. 판단에 묶인 것(삭제 접기 · 필터 접기 · 그림 지우기 · 묶음째 고르기)만 Old에 있다 - New에는 판단 행이 없다.
export type PaperPlace = "old" | "new-wide" | "new-pair";

export interface DocTools {
  /** 저절로 삭제된 줄(목차 · 앞부분 · 개정 이력)을 블록으로 접고 사유 쓰기 · 삭제 취소(고칠 수 있을 때) */
  noise: boolean;
  /** 제목에서 바꾼 조항 묶음 머리와 "↺ 제목으로" */
  headingShift: boolean;
  /** 표 벗기기 · 다시 표로 */
  unwrap: boolean;
  /** 벗긴 표 머리의 AI 순서 제안 단추(AI가 꺼져 있으면 흐린 단추) */
  unwrapAi: boolean;
  /** 번호 칸 고치기 · 들여쓰기 */
  numberCell: boolean;
  /** 틈 합치기 */
  join: boolean;
  /** 글자 골라 새 박스 */
  carve: boolean;
  /** 두 번 눌러 나누기 */
  split: boolean;
  /** 벗긴 표 덩이 안 줄 순서 손잡이 */
  lineGrip: boolean;
  /** 삭제로 확정한 줄을 흐린 한 줄로 */
  deleted: boolean;
  /** 필터 접기 */
  fold: boolean;
  /** 그림 탭 카드의 지우기 */
  figureDelete: boolean;
  /** 표 · 그림 어디를 눌러도 묶음째 고르기(배정) */
  wholeBundle: boolean;
}

/** mode "unsourced"는 출처 없는 New 거르기 - 누르면 잇는 자리라 모양을 바꾸는 손질은 끈다(보기와 표 바꾸기는 지금처럼) */
export function buildDocTools(input: { place: PaperPlace; canEdit: boolean; mode: "old" | "unsourced" }): DocTools {
  const { place, canEdit, mode } = input;
  const shapes = canEdit && mode === "old";
  const isOld = place === "old";
  return {
    noise: true,
    headingShift: true,
    unwrap: canEdit,
    unwrapAi: canEdit,
    numberCell: shapes,
    join: shapes,
    carve: shapes,
    split: shapes,
    lineGrip: shapes,
    deleted: isOld,
    fold: isOld,
    figureDelete: isOld && canEdit,
    wholeBundle: isOld,
  };
}
