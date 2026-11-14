// Assign Remark - 사유는 창에서 쓴다. 칸 아래에 내가 최근에 쓴 사유(모든 Bundle, 같은 글은 한 번)를 5개, 더 보기로 10개까지 보이고 누르면 칸을 채운다.
// 삭제·이동·보류처럼 사유가 꼭 있어야 하는 저장에서는 저장이 이 창을 먼저 열고, 확인하면 저장을 이어 간다(required).
"use client";

import { Check, ChevronDown, ChevronUp, History, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Modal } from "@/components/modal";
import { Tooltip } from "@/components/ui/tooltip";
import { listRecentRemarks } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

const SHOWN = 5; // 처음 보이는 수 - 더 보기로 서버 상한(10)까지
export const REMARK_MAX_LENGTH = 2000;
const LONG_REMARK = 90; // 이 글자 수부터 두 줄을 넘을 수 있다(창 폭 448px, 13px 글)

interface RecentRemarksProps {
  onPick: (text: string) => void;
  testId: string;
}

/** 내가 최근에 쓴 사유 - 누르면 그 글을 넘긴다. 하나도 없으면 아무것도 그리지 않는다 */
export function RecentRemarks({ onPick, testId }: RecentRemarksProps) {
  const { t } = useI18n();
  const recent = useLoaded(() => listRecentRemarks(10), "recent-remarks");
  const [isMore, setIsMore] = useState(false);
  const items = recent.data ?? [];
  if (items.length === 0) return null;
  const shown = isMore ? items : items.slice(0, SHOWN);
  return (
    <div className="grid gap-1" data-testid={testId}>
      <span className="flex items-center gap-1 text-xs text-ink-3">
        <History size={12} strokeWidth={1.5} aria-hidden />
        {t("remark.recent")}
      </span>
      <div className="grid gap-1">
        {shown.map((item, index) => (
          // 두 줄을 넘는 글만 툴팁으로 전체를 보인다(대략 두 줄 길이로 가른다 - 항목이 열 개뿐이라 잴 것까지는 없다)
          <Tooltip key={item.text} label={item.text} suppressed={item.text.length < LONG_REMARK} align="start">
            <button type="button" className="remark-recent" data-testid={`${testId}-${index}`} onClick={() => onPick(item.text)}>
              <span className="clamp-2">{item.text}</span>
            </button>
          </Tooltip>
        ))}
      </div>
      {items.length > SHOWN && (
        <button type="button" className="btn ghost h-7 justify-self-start px-1.5 text-xs font-normal" data-testid={`${testId}-more`} aria-expanded={isMore} onClick={() => setIsMore((value) => !value)}>
          {isMore ? <ChevronUp size={13} strokeWidth={1.5} aria-hidden /> : <ChevronDown size={13} strokeWidth={1.5} aria-hidden />}
          {isMore ? t("remark.less") : t("remark.more", { n: items.length - SHOWN })}
        </button>
      )}
    </div>
  );
}

interface RemarkModalProps {
  title: string;
  initial: string;
  /** 비우면 확인할 수 없다 - 그때 보일 까닭 */
  requiredMessage: string | null;
  /** 칸 위의 안내(무엇에 대한 사유인지) */
  intro?: ReactNode;
  confirmLabel: string;
  onConfirm: (text: string) => void;
  onClose: () => void;
  testId: string;
}

export function RemarkModal({ title, initial, requiredMessage, intro, confirmLabel, onConfirm, onClose, testId }: RemarkModalProps) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const isBlocked = requiredMessage !== null && text.trim() === "";
  function submit() {
    if (!isBlocked) onConfirm(text.trim());
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      testId={testId}
      footer={
        <>
          <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid={`${testId}-confirm`} disabled={isBlocked} onClick={submit}>
            <Check size={16} strokeWidth={1.5} aria-hidden />
            {confirmLabel}
          </button>
        </>
      }
    >
      {intro}
      <label className="grid gap-1">
        <span className="flex items-baseline justify-between gap-2 text-xs text-ink-2">
          {t("classify.reason")}
          {requiredMessage !== null && (
            <span className={isBlocked ? "text-st-hold" : "text-ink-3"} data-testid={`${testId}-required`}>
              {requiredMessage}
            </span>
          )}
        </span>
        <textarea
          rows={4}
          className="block w-full resize-y rounded-md border border-line-2 bg-surface px-2 py-[5px] text-[13px] leading-[19px] text-ink focus:border-accent focus:outline-none"
          data-testid={`${testId}-text`}
          value={text}
          maxLength={REMARK_MAX_LENGTH}
          placeholder={t("remark.placeholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // 칸 안 Enter는 줄바꿈 - Ctrl+Enter로 확인한다
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <span className="text-[11px] text-ink-3">{t("remark.ctrlEnter")}</span>
      </label>
      <RecentRemarks testId={`${testId}-recent`} onPick={setText} />
    </Modal>
  );
}
