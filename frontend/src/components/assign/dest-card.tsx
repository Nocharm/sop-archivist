// ① 추천 카드 하나 - 무엇(문서·자리), 글, 왜. 누르면 고른 곳이 된다. 유사도는 숫자로 보이지 않는다(명세 §7.10).
"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface DestCardProps {
  icon: LucideIcon;
  tone?: "link" | "place" | "danger";
  title: ReactNode;
  text?: ReactNode;
  note?: ReactNode;
  pressed: boolean;
  testId: string;
  onClick: () => void;
}

export function DestCard({ icon: Icon, tone = "place", title, text, note, pressed, testId, onClick }: DestCardProps) {
  return (
    <button type="button" className="dest-card" data-tone={tone} aria-pressed={pressed} data-testid={testId} onClick={onClick}>
      <span className="dest-card-icon" aria-hidden>
        <Icon size={14} strokeWidth={1.6} />
      </span>
      <span className="min-w-0">
        <span className="dest-card-title">{title}</span>
        {text && <span className="dest-card-text">{text}</span>}
        {note && <span className="dest-card-note">{note}</span>}
      </span>
    </button>
  );
}
