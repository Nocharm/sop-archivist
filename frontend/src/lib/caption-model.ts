// 표·그림 캡션 규칙 - 화면이 "캡션이 있어야 하는데 없다"를 같은 기준으로 판단한다(Old 머리 줄의 Caption needed, 위쪽 줄 남은 수).

import type { Disposition } from "./api-sop";

export interface CaptionNeedInput {
  hasCaption: boolean;
  /** 저장된 판단의 처리 - 삭제·이동한 묶음은 새 문서에 가지 않아 캡션이 필요 없다(명세 §3.4) */
  disposition: Disposition | undefined;
  /** 이미 쓴 New 문서의 묶음이거나 그 문서에 이은 묶음(입구 2) - 캡션은 그 문서가 정한다 */
  isLinkedToWritten: boolean;
}

/** 캡션이 없고 있어야 하는 묶음 - 미배정·보류·배정은 true, 삭제·이동·입구 2는 false */
export function isCaptionNeeded({ hasCaption, disposition, isLinkedToWritten }: CaptionNeedInput): boolean {
  if (hasCaption || isLinkedToWritten) return false;
  return disposition !== "delete" && disposition !== "move_external";
}
