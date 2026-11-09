// 언어 스위치 - 네모난 두 칸 EN | KO, 지금 언어 칸이 채워진다. 상단 막대(이름 오른쪽)와 로그인 박스(오른쪽 위)가 같이 쓴다.
"use client";

import { useI18n } from "@/lib/i18n";

const LANGS = [
  { value: "en", label: "EN" },
  { value: "ko", label: "KO" },
] as const;

export function LangToggle({ testId, tone = "surface" }: { testId: string; tone?: "chrome" | "surface" }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className={`lang-toggle ${tone}`} role="group" aria-label={t("nav.langSwitch")} data-testid={testId}>
      {LANGS.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={lang === item.value}
          data-testid={`${testId}-${item.value}`}
          onClick={() => setLang(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
