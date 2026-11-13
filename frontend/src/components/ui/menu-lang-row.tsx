// 메뉴 안 언어 한 줄 - "Language" 라벨과 KO | EN 두 칸. 지금 언어 칸은 고른 모양으로 꺼져 있고 다른 칸만 누른다(Split 우클릭 메뉴, 이후 Assign 그 자리 메뉴).
// 두 칸은 메뉴 항목(menuitemradio)이라 ↑↓로 차례로 닿고, 줄 안에서는 ←→로 옮긴다. 꺼진 칸은 aria-disabled(포커스를 받아 까닭 툴팁을 보인다)이고
// 까닭은 data-tip - 감싼 메뉴의 useDelegatedTip이 띄운다.
"use client";

import { Languages } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { UnitLang } from "@/lib/api-sop";

type PickLang = Exclude<UnitLang, "neutral">;

const OPTIONS: readonly PickLang[] = ["ko", "en"];

interface MenuLangRowProps {
  label: string;
  /** 지금 언어 - neutral이면 두 칸 모두 누를 수 있다 */
  current: UnitLang | undefined;
  /** 줄 전체가 꺼진 까닭(글이 아님·읽기 전용) - 없으면 null */
  disabledReason: string | null;
  /** 지금 언어 칸의 툴팁 */
  currentReason: string;
  onPick: (lang: PickLang) => void;
  /** 줄 `{testId}`, 칸 `{testId}-ko`·`{testId}-en` */
  testId: string;
}

export function MenuLangRow({ label, current, disabledReason, currentReason, onPick, testId }: MenuLangRowProps) {
  // 줄 안 ←→ - 두 칸 사이를 오간다(메뉴의 ↑↓·Home·End는 그대로)
  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }

  return (
    <div role="group" aria-label={label} className="menu-lang-row" data-testid={testId}>
      <Languages size={14} strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="menu-lang-seg" onKeyDown={handleKeyDown}>
        {OPTIONS.map((lang) => {
          const isCurrent = current === lang;
          const reason = disabledReason ?? (isCurrent ? currentReason : null);
          const text = lang.toUpperCase();
          return (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={isCurrent}
              aria-disabled={reason !== null ? "true" : undefined}
              aria-label={reason ? `${label} ${text} - ${reason}` : `${label} ${text}`}
              data-tip={reason ?? undefined}
              data-tip-side="right"
              data-testid={`${testId}-${lang}`}
              onClick={() => {
                if (reason === null) onPick(lang);
              }}
            >
              {text}
            </button>
          );
        })}
      </span>
    </div>
  );
}
