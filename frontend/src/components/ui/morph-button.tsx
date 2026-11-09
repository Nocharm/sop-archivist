// 모핑 단추 - 평소 아이콘만 보이고 호버·키보드 포커스 때 라벨이 옆으로 펼쳐진다. 마우스를 의도적으로 올려야 라벨이 보여 실수 클릭을 줄인다.
// 위험 동작(tone=danger)은 펼칠 때 위험색 바탕이 된다. 확인 모달 안 최종 단추처럼 처음부터 라벨이 필요하면 revealLabel.
"use client";

import type { LucideIcon } from "lucide-react";

type MorphTone = "default" | "danger" | "primary";

interface MorphButtonProps {
  icon: LucideIcon;
  label: string;
  tone?: MorphTone;
  onClick?: () => void;
  testId: string;
  disabled?: boolean;
  revealLabel?: boolean;
  type?: "button" | "submit";
}

export function getMorphClassName(tone: MorphTone, revealLabel: boolean): string {
  return ["mbtn", tone === "default" ? "" : tone, revealLabel ? "reveal" : ""].filter(Boolean).join(" ");
}

export function MorphButton({ icon: Icon, label, tone = "default", onClick, testId, disabled = false, revealLabel = false, type = "button" }: MorphButtonProps) {
  return (
    <button type={type} className={getMorphClassName(tone, revealLabel)} aria-label={label} data-testid={testId} disabled={disabled} onClick={onClick}>
      <Icon size={16} strokeWidth={1.5} aria-hidden />
      <span className="mbtn-label" aria-hidden>
        {label}
      </span>
    </button>
  );
}
