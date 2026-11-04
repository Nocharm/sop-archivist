// 언어 전환 버튼(영어 <-> 한국어) - 상단 바와 로그인 카드가 같이 쓴다. 눌렀을 때 바뀔 언어 이름을 보여 준다.
"use client";

import { Languages } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function LangToggle({ testId }: { testId: string }) {
  const { t, lang, setLang } = useI18n();
  const next = lang === "ko" ? "en" : "ko";
  return (
    <button
      type="button"
      data-testid={testId}
      title={t("nav.langSwitch")}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100"
      onClick={() => setLang(next)}
    >
      <Languages size={16} strokeWidth={1.5} />
      {next === "ko" ? "한국어" : "English"}
    </button>
  );
}
