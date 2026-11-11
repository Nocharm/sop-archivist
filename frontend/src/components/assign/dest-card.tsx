// ① 추천 카드 하나 - 종류 아이콘, 무엇(문서·자리), 글(2줄), 아래 줄(언어·절 번호·근거). 누르면 고른 곳이 된다(저장 전이면 "아직 저장 안 됨"). 유사도는 숫자로 보이지 않는다(명세 §7.10).
"use client";

import type { LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

interface DestCardProps {
  icon: LucideIcon;
  tone?: "link" | "place" | "danger";
  title: ReactNode;
  text?: ReactNode;
  /** 아래 줄 - 언어·절 번호·근거 칩 */
  foot?: ReactNode;
  pressed: boolean;
  /** 고르기만 하고 저장하지 않았을 때 보이는 표시 */
  pending?: ReactNode;
  testId: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function DestCard({ icon: Icon, tone = "place", title, text, foot, pressed, pending, testId, onClick }: DestCardProps) {
  return (
    <button type="button" className="dest-card" data-tone={tone} aria-pressed={pressed} data-testid={testId} onClick={onClick}>
      <span className="dest-card-icon" aria-hidden>
        <Icon size={14} strokeWidth={1.6} />
      </span>
      <span className="min-w-0">
        <span className="dest-card-title">{title}</span>
        {text && <span className="dest-card-text">{text}</span>}
        {foot && <span className="dest-card-foot">{foot}</span>}
        {pending && (
          <span className="dest-card-pending" data-testid={`${testId}-pending`}>
            {pending}
          </span>
        )}
      </span>
    </button>
  );
}
