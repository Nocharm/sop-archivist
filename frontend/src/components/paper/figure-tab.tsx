// 그림 탭 - 본문에서 뺀 그림을 카드로 문서 순서대로 그린다(시안 2 D3). 카드는 본문과 같은 용지 줄이라 누르면 그 그림을 고르고(결정 칸 · 보내기 · 끌어 보내기 · 캡션 자리),
// 줄 끝 단추로 본문 자리를 보거나(위치 판) 그 그림을 삭제로 확정한다(Remark 선택).
"use client";

import { LocateFixed, Trash2, X } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { RecentRemarks, REMARK_MAX_LENGTH } from "@/components/assign/remark-modal";
import { Modal } from "@/components/modal";
import { Paper } from "@/components/paper/paper";
import { useI18n } from "@/lib/i18n";

interface FigureTabProps {
  /** 본문 용지와 같은 속성 - 그릴 것과 그림 줄 고르기는 이 탭이 바꾼다 */
  paper: ComponentProps<typeof Paper>;
  /** 위치 보기 - 그 그림의 본문 자리 판을 연다 */
  onShowPosition: (unitId: number) => void;
  /** 삭제 확정 - 없으면 단추가 없다(줄이 없는 New 문서 · 고칠 수 없는 사람) */
  onDelete?: (unitId: number, reason: string) => Promise<void>;
}

export function FigureTab({ paper, onShowPosition, onDelete }: FigureTabProps) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function openDelete(unitId: number) {
    setReason("");
    setDeleting(unitId);
  }

  function renderActions(unitId: number) {
    const label = paper.model.units.get(unitId)?.display_id ?? "";
    return (
      <div className="figure-card-acts row-actions">
        <button type="button" className="figure-card-act" aria-label={t("figures.showPosition")} data-tip={t("figures.showPosition")} data-testid={`assign-figure-show-${unitId}`} onClick={() => onShowPosition(unitId)}>
          <LocateFixed size={14} strokeWidth={1.75} aria-hidden />
        </button>
        {onDelete && (
          <button type="button" className="figure-card-act" data-tone="danger" aria-label={t("figures.delete", { id: label })} data-tip={t("figures.delete", { id: label })} data-testid={`assign-figure-delete-${unitId}`} onClick={() => openDelete(unitId)}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <Paper {...paper} items={paper.model.figureItems} figureRows="only" strips={{ ...paper.strips, figureCard: { renderActions } }} />
      {deleting !== null && onDelete && (
        <Modal
          title={t("figures.deleteTitle", { id: paper.model.units.get(deleting)?.display_id ?? "" })}
          size="sm"
          isBusy={busy}
          testId="assign-figure-delete-modal"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="btn" data-testid="assign-figure-delete-cancel" onClick={() => setDeleting(null)}>
                <X size={16} strokeWidth={1.5} aria-hidden />
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn danger"
                data-testid="assign-figure-delete-confirm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onDelete(deleting, reason.trim());
                    setDeleting(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                {t("figures.deleteRun")}
              </button>
            </>
          }
        >
          <label className="grid gap-1">
            <span className="text-xs text-ink-2">{t("classify.reason")}</span>
            <textarea
              rows={3}
              className="block w-full resize-y rounded-md border border-line-2 bg-surface px-2 py-[5px] text-[13px] leading-[19px] text-ink focus:border-accent focus:outline-none"
              data-testid="assign-figure-delete-reason"
              placeholder={t("remark.blankDelete")}
              value={reason}
              maxLength={REMARK_MAX_LENGTH}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <RecentRemarks testId="assign-figure-delete-recent" onPick={setReason} />
        </Modal>
      )}
    </>
  );
}
