// 무엇을 올리는지 고르는 두 칸 카드 - Old SOP / New SOP·WI. 창이 좁아도 위아래로 쌓지 않고 늘 나란히 둔다.
"use client";

import { FileCheck2, FileStack } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { DocSide } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

const SIDES: Array<{ side: DocSide; icon: typeof FileStack; title: string }> = [
  { side: "old", icon: FileStack, title: "Old SOP" },
  { side: "new", icon: FileCheck2, title: "New SOP · WI" },
];

export function SideChoice({ value, onChange }: { value: DocSide; onChange: (next: DocSide) => void }) {
  const { t } = useI18n();

  // 라디오 묶음 손버릇 - 좌우 화살표로 옮긴다
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = value === "old" ? "new" : "old";
    onChange(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="upload-side-${next}"]`)?.focus());
  }

  return (
    <div className="side-choice" role="radiogroup" aria-label={t("documents.uploadSide")} onKeyDown={handleKeyDown}>
      {SIDES.map(({ side, icon: Icon, title }) => (
        <button
          key={side}
          type="button"
          role="radio"
          aria-checked={value === side}
          tabIndex={value === side ? 0 : -1}
          className="side-card"
          data-testid={`upload-side-${side}`}
          onClick={() => onChange(side)}
        >
          <span className="side-card-pic" aria-hidden>
            <Icon size={20} strokeWidth={1.5} />
          </span>
          <span className="grid min-w-0 gap-0.5 text-left">
            <b className="text-[14px] leading-5">{title}</b>
            <span className="text-xs text-ink-3">{t(side === "old" ? "documents.sideOldHint" : "documents.sideNewHint")}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
