// 결과물 판 고르기 - 상단 막대 언어 스위치(LangToggle)와 같은 네모 두 칸 KO | EN. 결과물·검토 화면이 같이 쓴다.
"use client";

import type { OutputLang } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

const EDITIONS: OutputLang[] = ["ko", "en"];

export function EditionToggle({ value, onChange, testId }: { value: OutputLang; onChange: (next: OutputLang) => void; testId: string }) {
  const { t } = useI18n();
  return (
    <div className="lang-toggle surface" role="group" aria-label={t("outputs.edition")}>
      {EDITIONS.map((item) => (
        <button key={item} type="button" aria-pressed={value === item} data-testid={`${testId}-${item}`} onClick={() => onChange(item)}>
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
