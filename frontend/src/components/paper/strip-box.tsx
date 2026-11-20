// 용지 줄 틀 하나 - 왼쪽 밖 앞머리(번호 칸) + 박스(.strip) + 박스 위 칩 줄 + 짝 대괄호(data-bracket). Old · 이미 쓴 New 용지(Paper)와 New 칸(NewPane)이 같은 틀을 쓴다(시안 2 D6).
// 틀만 그린다 - 앞머리 · 박스 안 · 칩은 쓰는 쪽이 넘기고, 속성(testid · 상태)도 쓰는 쪽 것을 그대로 단다. 앞머리가 없으면 같은 폭의 빈 자리라 박스 왼쪽 x가 맞는다.
import type { HTMLAttributes, ReactNode } from "react";

import type { PairBracket } from "@/lib/strip-pill-model";

import { STRIP_LEAD_EXTRA } from "./strip-lead";

/** 줄 상자 · 박스에 다는 속성 - data-* 속성을 객체로 넘길 수 있게 */
export type StripAttrs = HTMLAttributes<HTMLDivElement> & { [name: `data-${string}`]: string | number | undefined };

export interface StripBoxProps {
  /** 줄 상자(.strip-row)의 속성 - className은 strip-row 뒤에 붙는다 */
  rowAttrs?: StripAttrs;
  /** 앞머리(StripLead · NumberCell) - null이면 leadWidth 폭의 빈 자리 */
  lead: ReactNode;
  /** 앞머리가 없을 때 빈 자리의 번호 칸 폭(px) - 앞머리 전체는 여기에 STRIP_LEAD_EXTRA를 더한다 */
  leadWidth?: number;
  /** 앞머리 앞(줄 상자 맨 앞)에 놓는 것 - 벗긴 표의 세로선 */
  before?: ReactNode;
  /** 박스의 class - 기본 "strip" */
  boxClassName?: string;
  /** 이웃한 짝 카드에서 이 줄의 자리 - 박스에 data-bracket(앞머리는 쓰는 쪽이 같은 값을 넘긴다) */
  bracket?: PairBracket;
  boxAttrs?: StripAttrs;
  /** 박스 위 줄의 칩(출처 칩) - 박스 안 첫 줄 */
  chips?: ReactNode;
  children?: ReactNode;
}

export function StripBox({ rowAttrs, lead, leadWidth = 0, before, boxClassName = "strip", bracket, boxAttrs, chips, children }: StripBoxProps) {
  const { className: rowClass, ...rowRest } = rowAttrs ?? {};
  return (
    <div className={rowClass ? `strip-row ${rowClass}` : "strip-row"} {...rowRest}>
      {before}
      {lead ?? <span className="strip-lead-gap" style={{ width: leadWidth + STRIP_LEAD_EXTRA }} />}
      <div className={boxClassName} data-bracket={bracket} {...boxAttrs}>
        {chips}
        {children}
      </div>
    </div>
  );
}
