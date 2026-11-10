// 확인 창 한 벌 - 아이콘·제목·대상·요약 상자(디자인 문서 11절). window.confirm은 쓰지 않는다.
"use client";

import { TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Modal } from "@/components/modal";
import { useI18n } from "@/lib/i18n";

interface ConfirmModalProps {
  title: string;
  target?: string;
  summary: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 확정 단추 앞 아이콘 - 지우기는 Trash2처럼 동작을 드러낸다 */
  confirmIcon?: LucideIcon;
  busy?: boolean;
  /** 확정할 것이 없거나 아직 모를 때(미리 세는 중) 확정 단추만 막는다 - busy와 달리 창은 닫을 수 있다 */
  confirmDisabled?: boolean;
  testId: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({ title, target, summary, confirmLabel, danger = false, confirmIcon: ConfirmIcon, busy = false, confirmDisabled = false, testId, onConfirm, onClose }: ConfirmModalProps) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      onClose={onClose}
      testId={testId}
      isBusy={busy}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className={`btn ${danger ? "danger" : "pri"}`} data-testid={`${testId}-confirm`} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {ConfirmIcon && <ConfirmIcon size={16} strokeWidth={1.5} aria-hidden />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="grid justify-items-center gap-2 text-center">
        <span className="grid size-11 place-items-center rounded-lg bg-st-hold-tint text-st-hold" aria-hidden>
          <TriangleAlert size={20} strokeWidth={1.5} />
        </span>
        {target && <span className="font-mono text-xs text-ink-3">{target}</span>}
      </div>
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-ink-2">{summary}</div>
    </Modal>
  );
}
