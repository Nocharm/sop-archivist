// KO/EN 언어 표시 한 벌 - Split·Assign 조각 위 테두리의 탭(올리거나 고를 때)이 같은 모양(.lang-token, data-lang으로 KO 파랑·EN 초록)을 쓴다.
// 언어가 없는 단위(neutral)는 그리지 않는다. 툴팁은 감싼 영역의 useDelegatedTip이 data-tip으로 띄운다.
import type { UnitLang } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface LangTokenProps {
  lang: UnitLang;
  /** 자리 클래스 - Split 탭은 "strip-lang" */
  className?: string;
  testId?: string;
  tabIndex?: number;
}

export function LangToken({ lang, className, testId, tabIndex }: LangTokenProps) {
  const { t } = useI18n();
  if (lang === "neutral") return null;
  const label = t(`paper.lang.${lang}`);
  return (
    <span className={className ? `lang-token ${className}` : "lang-token"} data-lang={lang} role="img" aria-label={label} data-tip={label} tabIndex={tabIndex} data-testid={testId}>
      {lang.toUpperCase()}
    </span>
  );
}
