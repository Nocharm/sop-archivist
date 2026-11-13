// 용지 줄 앞머리 - 절 번호 칸. 번호 칸 폭은 절 깊이별(들여쓰기로 읽힌다). 짝 카드는 첫 줄만 번호를 보이고 둘째 줄부터는 첫 줄 폭을 따른다.
// 보류는 색만으로 알리지 않는다 - 번호 칸에 툴팁(data-tip, 감싼 용지의 useDelegatedTip이 띄운다), 같은 글을 sr-only로.
import type { PairBracket } from "@/lib/strip-pill-model";

/** 번호 칸과 조각 사이 틈 5px - 앞머리 폭 = 번호 칸 폭 + 이 값 */
export const STRIP_LEAD_EXTRA = 5;

export interface StripLeadProps {
  /** 번호 칸 폭(px) - 앞머리 전체는 여기에 STRIP_LEAD_EXTRA를 더한다 */
  width: number;
  /** 절의 첫 블록에만 번호, 나머지는 null(빈 칸) */
  number: string | null;
  bracket?: PairBracket;
  dim: boolean;
  /** 보류 설명 - 비면 툴팁·sr-only 글을 두지 않는다 */
  tip: string;
  /** testid 앞말 - 앞머리 `{testId}-lead-{id}`, 번호 `{testId}-num-{id}` */
  testId: string;
  id: number | string;
  onClick?: () => void;
}

export function StripLead({ width, number, bracket, dim, tip, testId, id, onClick }: StripLeadProps) {
  const tipAttr = tip === "" ? undefined : tip;
  // 좁은 창에서 번호 칸이 말줄임되면 전체 번호를 볼 길이 툴팁뿐이다(글 앞 번호도 숨겼으므로)
  const shownNumber = !dim && number ? `§ ${number}` : null;
  const numTip = [shownNumber, tipAttr].filter(Boolean).join(" · ") || undefined;
  return (
    <span className="strip-lead" style={{ width: width + STRIP_LEAD_EXTRA }} data-bracket={bracket} data-dim={dim ? "" : undefined} data-testid={`${testId}-lead-${id}`} onClick={onClick}>
      {tipAttr && <span className="sr-only">{tipAttr}</span>}
      <span className="strip-lead-num" data-tip={numTip} data-testid={number !== null ? `${testId}-num-${id}` : undefined}>
        {!dim && number}
      </span>
    </span>
  );
}
