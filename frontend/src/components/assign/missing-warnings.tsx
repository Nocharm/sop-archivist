// 누락 의심 경고 - 확인이 남아 있으면 배정 화면 위쪽 줄에 표시가 뜨고, 누르면 문서별 목록에서 원문 자리를 보거나 확인한다.
// 확인은 검토 요청 조건이다(Missing-text warnings closed). 전에는 쪼개기 화면에서만 할 수 있었다.
"use client";

import { Check, Locate, Scissors, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { ackWarning, type SopDocument } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { countPendingWarnings, listAckWarnings, type AckWarning } from "@/lib/missing-warnings-model";
import { readWarningText } from "@/lib/paper-model";
import { getStageHref } from "@/lib/stages";

interface MissingWarningsProps {
  bundleId: number;
  docs: readonly SopDocument[];
  canEdit: boolean;
  /** 좁은 줄 - 이름을 접고 수만 보인다 */
  compact: boolean;
  /** 이 화면에서 그 자리를 보일 수 있으면 보이고 true - 못 보이면(New 문서, 단위 없는 자리) false */
  onShow: (item: AckWarning) => boolean;
  /** 확인이 저장된 뒤 - 문서 목록을 다시 받는다 */
  onChanged: () => void;
}

export function MissingWarnings({ bundleId, docs, canEdit, compact, onShow, onChanged }: MissingWarningsProps) {
  const { t } = useI18n();
  const items = listAckWarnings(docs);
  const pending = countPendingWarnings(items);
  const [isOpen, setIsOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function handleAck(item: AckWarning) {
    setBusyId(item.warning.id);
    try {
      await ackWarning(bundleId, item.warning.id);
      showToast(t("split.warningChecked"));
      onChanged();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setBusyId(null);
    }
  }

  // 남은 것이 없으면 조용히 사라진다 - 열어 둔 목록은 닫을 때까지 남아 방금 확인한 줄이 보인다
  if (pending === 0 && !isOpen) return null;
  const label = t("assign.warnings.chip", { n: pending });
  return (
    <>
      {pending > 0 && (
        <Tooltip label={t("assign.warnings.tip")} suppressed={isOpen}>
          <button type="button" className="btn h-7 text-st-hold" aria-label={compact ? label : undefined} data-testid="assign-warnings" onClick={() => setIsOpen(true)}>
            <TriangleAlert size={14} strokeWidth={1.5} aria-hidden />
            {compact ? pending : label}
          </button>
        </Tooltip>
      )}
      {isOpen && (
        <Modal title={t("split.warnings")} onClose={() => setIsOpen(false)} isBusy={busyId !== null} testId="assign-warnings-modal">
          <p className="text-ink-2">{t("split.warningsInfo")}</p>
          {items.length === 0 || pending === 0 ? (
            <p className="flex items-center gap-1.5 text-ink-2" data-testid="assign-warnings-done">
              <Check size={14} strokeWidth={1.6} aria-hidden />
              {t("assign.warnings.allChecked")}
            </p>
          ) : null}
          <ul className="grid max-h-[50vh] gap-2 overflow-y-auto" data-testid="assign-warnings-list">
            {items.map((item) => {
              const { warning } = item;
              const isChecked = warning.acked_by !== null;
              return (
                <li key={warning.id} className="grid gap-1.5 rounded-md border border-line px-3 py-2" data-testid={`assign-warning-${warning.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{item.docLabel}</span>
                    <span className={`pill ${isChecked ? "quiet" : "warn"}`}>{isChecked ? t("status.warning.checked") : t(`warn.${warning.kind}`)}</span>
                    <span className="flex-1" />
                    {/* 그 자리를 이 화면에서 보이면 창을 닫고, 못 보이면(New 문서 등) 쪼개기 화면에서 연다 */}
                    {item.side === "old" ? (
                      <button
                        type="button"
                        className="btn ghost h-7"
                        data-testid={`assign-warning-show-${warning.id}`}
                        onClick={() => {
                          if (onShow(item)) setIsOpen(false);
                        }}
                      >
                        <Locate size={14} strokeWidth={1.5} aria-hidden />
                        {t("assign.warnings.show")}
                      </button>
                    ) : (
                      <Link href={`${getStageHref(bundleId, "split")}?doc=${item.docId}`} className="btn ghost h-7" data-testid={`assign-warning-split-${warning.id}`}>
                        <Scissors size={14} strokeWidth={1.5} aria-hidden />
                        {t("assign.warnings.openSplit")}
                      </Link>
                    )}
                    {!isChecked && canEdit && (
                      <button type="button" className="btn h-7" data-testid={`assign-warning-ack-${warning.id}`} disabled={busyId !== null} onClick={() => void handleAck(item)}>
                        <Check size={14} strokeWidth={1.6} aria-hidden />
                        {t("split.markChecked")}
                      </button>
                    )}
                  </div>
                  {/* 빠졌을 수 있는 글 그대로 - 원본 파일과 견줄 수 있게 줄이지 않는다 */}
                  <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{readWarningText(warning.detail)}</p>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </>
  );
}
