// 모달 한 벌 - 바깥 누름(mousedown)과 Esc로 닫는다. 관리 화면의 폼·확인 창이 공유한다(window.confirm은 브라우저 자동화를 막아 쓰지 않는다).
"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { BUTTON_ICON } from "@/lib/ui-classes";

interface ModalProps {
  title: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
  /** 하단 버튼 줄 - 비우면 본문만 그린다 */
  footer?: ReactNode;
}

export function Modal({ title, onClose, testId, children, footer }: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  // 최신 onClose를 읽되 리스너를 다시 걸지 않는다
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    // click이 아니라 mousedown 기준 - 모달 안에서 드래그를 시작해 바깥에서 손을 떼도 잘못 닫히지 않는다
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/40 px-4 py-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className="w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <button type="button" data-testid={`${testId}-close`} className={BUTTON_ICON} aria-label={t("common.close")} onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
