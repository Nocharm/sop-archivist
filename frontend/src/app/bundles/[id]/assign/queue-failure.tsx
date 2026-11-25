// 실패해 멈춘 명령의 알림 한 줄 - 위쪽 줄 바로 아래. 창(dialog)이 아니라 글쇠를 막지 않는다(그동안 누른 것은 뒤에 쌓인다).
"use client";

import { CircleAlert, RotateCw, X } from "lucide-react";

import { useI18n } from "@/lib/i18n";

interface QueueFailureProps {
  text: string;
  onRetry: () => void;
  onDiscard: () => void;
}

export function QueueFailure({ text, onRetry, onDiscard }: QueueFailureProps) {
  const { t } = useI18n();
  return (
    <div className="queue-failed" role="alert" data-testid="assign-queue-failed">
      <CircleAlert size={14} strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1" data-testid="assign-queue-failed-text">{text}</span>
      <button type="button" className="btn pri h-7" data-testid="assign-queue-retry" onClick={onRetry}>
        <RotateCw size={14} strokeWidth={1.5} aria-hidden />
        {t("assign.queue.retry")}
      </button>
      <button type="button" className="btn h-7" data-testid="assign-queue-discard" onClick={onDiscard}>
        <X size={14} strokeWidth={1.5} aria-hidden />
        {t("assign.queue.discard")}
      </button>
    </div>
  );
}
