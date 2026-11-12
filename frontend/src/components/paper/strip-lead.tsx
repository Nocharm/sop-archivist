// 용지 줄 앞머리 - [절 번호 칸][3px 언어 막대]. 번호 칸 폭은 절 깊이별(들여쓰기로 읽힌다), 막대 색은 언어(KO·EN·없음). 짝 카드는 두 줄 막대가 틈 없이 맞붙는다.
// 뜻(언어·보류)은 색만으로 알리지 않는다 - 번호 칸·막대에 툴팁(data-tip, 감싼 용지의 useDelegatedTip이 띄운다), 같은 글을 sr-only로.
import type { PairBracket } from "@/lib/strip-pill-model";

/** 막대 3px + 막대와 조각 사이 틈 5px - 앞머리 폭 = 번호 칸 폭 + 이 값 */
export const STRIP_LEAD_EXTRA = 8;

export interface StripLeadProps {
  /** 번호 칸 폭(px) - 앞머리 전체는 여기에 STRIP_LEAD_EXTRA를 더한다 */
  width: number;
  /** 절의 첫 블록에만 번호, 나머지는 null(빈 칸) */
  number: string | null;
  lang: "ko" | "en" | null;
  bracket?: PairBracket;
  dim: boolean;
  /** 언어·보류 설명 - 비면 툴팁·sr-only 글을 두지 않는다 */
  tip: string;
  /** testid 앞말 - 앞머리 `{testId}-lead-{id}`, 번호 `{testId}-num-{id}` */
  testId: string;
  id: number | string;
  onClick?: () => void;
}

export function StripLead({ width, number, lang, bracket, dim, tip, testId, id, onClick }: StripLeadProps) {
  const tipAttr = tip === "" ? undefined : tip;
  return (
    <span className="strip-lead" style={{ width: width + STRIP_LEAD_EXTRA }} data-bracket={bracket} data-dim={dim ? "" : undefined} data-testid={`${testId}-lead-${id}`} onClick={onClick}>
      {tipAttr && <span className="sr-only">{tipAttr}</span>}
      <span className="strip-lead-num" data-tip={tipAttr} data-testid={number !== null ? `${testId}-num-${id}` : undefined}>
        {!dim && number}
      </span>
      <span className="strip-lead-bar" data-lang={lang ?? undefined} data-tip={tipAttr} aria-hidden />
    </span>
  );
}
