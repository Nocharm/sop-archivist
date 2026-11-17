// Assign Remark - 결정 칸의 한 줄(RemarkLine)은 최근 사유를 바로 채우고, 새 글은 창에서 쓴다. 창의 칸 아래에는 내가 최근에 쓴 사유(모든 Bundle, 같은 글은 한 번)를 5개, 더 보기로 10개까지 보이고 누르면 칸을 채운다.
// 삭제·이동·보류처럼 사유가 꼭 있어야 하는 저장에서는 저장이 이 창을 먼저 열고, 확인하면 저장을 이어 간다(required).
"use client";

import { Check, ChevronDown, ChevronUp, FilePen, History, TriangleAlert, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/modal";
import { ClampText } from "@/components/ui/clamp-text";
import { Menu } from "@/components/ui/menu";
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

interface RemarkLineProps {
  text: string;
  /** 비었을 때 보일 글("–"·"선택") */
  emptyLabel: string;
  /** 지금 고른 곳에 꼭 필요한데 비었을 때의 까닭 - 글 자리에 경고로 보이고 연필이 늘 보인다 */
  needMessage: string | null;
  canEdit: boolean;
  disabled?: boolean;
  onEdit: () => void;
  /** 최근 Remark를 누르면 창을 거치지 않고 바로 채운다 */
  onPick: (text: string) => void;
  /** 바뀌면 최근 Remark를 다시 불러온다(저장 뒤 맨 앞 항목이 방금 쓴 글이 되게) */
  reloadKey: number;
  testId: string;
  editTestId: string;
}

/**
 * 결정 칸의 Remark 한 줄 - 이름 · 지금 글(두 줄까지, 넘치면 올렸을 때 전체, 오른쪽 위 연필은 올리거나 포커스일 때) ·
 * 맨 끝 최근 Remark 단추(맨 앞 글을 바로 채우고, 옆 화살표로 이전 것을 고른다). 글을 새로 쓰는 일은 창에서 한다.
 */
export function RemarkLine({ text, emptyLabel, needMessage, canEdit, disabled = false, onEdit, onPick, reloadKey, testId, editTestId }: RemarkLineProps) {
  const { t } = useI18n();
  const recent = useLoaded(() => listRecentRemarks(10), `recent-remarks-${reloadKey}`);
  const [isListOpen, setIsListOpen] = useState(false);
  const listRef = useRef<HTMLButtonElement>(null);
  const items = recent.data ?? [];
  const latest = items[0]?.text;
  const editLabel = t(text ? "remark.edit" : "remark.write");
  return (
    <div className="assign-remark" data-need={needMessage !== null ? "" : undefined}>
      <span className="flex-none text-xs leading-7 text-ink-3">{t("classify.reason")}</span>
      <div className="remark-body" data-empty={text ? undefined : ""}>
        {needMessage !== null ? (
          <span className="flex min-w-0 items-start gap-1.5 text-xs font-semibold leading-5 text-st-hold" data-testid={testId}>
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-[3px] flex-none" aria-hidden />
            <span className="clamp-2">{needMessage}</span>
          </span>
        ) : text ? (
          <ClampText text={text} className="text-[13px] leading-5 text-ink" testId={testId} />
        ) : (
          <span className="block text-xs leading-5 text-ink-3" data-testid={testId}>
            {emptyLabel}
          </span>
        )}
        {canEdit && (
          <span className="remark-edit">
            <Tooltip label={editLabel} align="end">
              <button type="button" className={`btn h-6 w-6 justify-center p-0 ${needMessage !== null ? "is-warn" : "ghost"}`} aria-label={editLabel} data-testid={editTestId} disabled={disabled} onClick={onEdit}>
                <FilePen size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </span>
        )}
      </div>
      {canEdit && latest !== undefined && (
        <div className="remark-recent-split">
          <Tooltip label={t("remark.pickRecent", { text: latest })} align="end" suppressed={isListOpen} shrinks>
            <button type="button" className="btn h-7 min-w-0 gap-1 rounded-r-none px-2 text-xs font-normal" data-testid={`${testId}-recent`} disabled={disabled} onClick={() => onPick(latest)}>
              <History size={13} strokeWidth={1.5} className="flex-none" aria-hidden />
              <span className="truncate">{latest}</span>
            </button>
          </Tooltip>
          <Tooltip label={t("remark.history")} align="end" suppressed={isListOpen}>
            <button
              ref={listRef}
              type="button"
              className="btn h-7 w-6 justify-center rounded-l-none border-l-0 p-0"
              aria-label={t("remark.history")}
              aria-haspopup="menu"
              aria-expanded={isListOpen}
              data-testid={`${testId}-history`}
              disabled={disabled}
              onClick={() => setIsListOpen((value) => !value)}
            >
              <ChevronDown size={13} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
          {isListOpen && (
            <Menu anchorRef={listRef} onClose={() => setIsListOpen(false)} testId={`${testId}-history-list`} align="end" label={t("remark.recent")}>
              <div className="menu-label">{t("remark.recent")}</div>
              {items.map((item, index) => (
                <button
                  key={item.text}
                  type="button"
                  role="menuitem"
                  className="menu-item remark-menu-item"
                  data-testid={`${testId}-history-${index}`}
                  onClick={() => {
                    setIsListOpen(false);
                    onPick(item.text);
                  }}
                >
                  <span className="clamp-2">{item.text}</span>
                </button>
              ))}
            </Menu>
          )}
        </div>
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
