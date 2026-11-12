// 작은 언어 표시 - 용지 언어 막대와 같은 모양(3x13 색 막대 + 회색 mono 글자). 색은 CSS가 data-lang으로 칠한다.
export interface LangMarkProps {
  lang: "ko" | "en" | "neutral";
  testId?: string;
}

export function LangMark({ lang, testId }: LangMarkProps) {
  return (
    <span className="lmark" data-lang={lang === "neutral" ? undefined : lang} data-testid={testId}>
      {lang === "neutral" ? "–" : lang.toUpperCase()}
    </span>
  );
}
