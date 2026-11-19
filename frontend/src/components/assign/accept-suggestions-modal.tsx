// AI 추천 일괄 수락 확인 창 - 종류(분류·묶기) 하나의 남은 추천을 범위(지금 Old 문서 / Bundle 전체)마다 서버에 물어 모양별 건수를 먼저 보인다.
// 경고가 있는 것·다듬기를 기다리는 묶기·AI가 본 뒤 바뀐 것은 빼고 그 수를 알리며, 삭제 추천은 따로 체크하고 공통 Remark를 적어야 받는다
// (설계 2026-11-19-ai-suggest-only D3, §5 3-2~3-4). 받은 것은 되돌리기 한 단계다.
"use client";

import { Sparkles, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { BusyLabel } from "@/components/ui/motion";
import { canAccept, countDeletes, countShapes, pickAcceptIds } from "@/lib/ai-accept-model";
import { getAcceptPreview, type AcceptKind } from "@/lib/api-sop";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

interface AcceptSuggestionsModalProps {
  bundleId: number;
  kind: AcceptKind;
  /** 지금 연 Old 문서 - 없으면 Bundle 전체만 고를 수 있다 */
  document: { id: number; label: string } | null;
  busy: boolean;
  onAccept: (ids: number[], deleteReason: string) => void;
  onClose: () => void;
}

export function AcceptSuggestionsModal({ bundleId, kind, document, busy, onAccept, onClose }: AcceptSuggestionsModalProps) {
  const { t } = useI18n();
  const [isBundle, setIsBundle] = useState(document === null);
  const [includeDeletes, setIncludeDeletes] = useState(false);
  const [remark, setRemark] = useState("");
  const documentId = isBundle || document === null ? null : document.id;
  const preview = useLoaded(() => getAcceptPreview(bundleId, kind, documentId), `${bundleId}:${kind}:${documentId ?? "all"}`);
  const items = preview.data?.items ?? [];
  const shapes = countShapes(items);
  const deletes = countDeletes(items);
  const total = pickAcceptIds(items, includeDeletes).length;
  const testId = "assign-accept-modal";

  const excluded = preview.data
    ? [
        { key: "warnings", n: preview.data.excluded_warnings },
        { key: "provisional", n: preview.data.excluded_provisional },
        { key: "changed", n: preview.data.excluded_changed },
        { key: "manual", n: preview.data.excluded_manual },
      ].filter((entry) => entry.n > 0)
    : [];

  return (
    <Modal
      title={t(`aiAccept.title.${kind}`)}
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
          <button
            type="button"
            className="btn pri"
            data-testid={`${testId}-confirm`}
            disabled={busy || preview.data === null || !canAccept(items, includeDeletes, remark)}
            onClick={() => onAccept(pickAcceptIds(items, includeDeletes), includeDeletes ? remark.trim() : "")}
          >
            <BusyLabel busy={busy} icon={<Sparkles size={16} strokeWidth={1.5} aria-hidden />} label={t("aiAccept.confirm", { n: total })} />
          </button>
        </>
      }
    >
      <fieldset className="grid gap-1" data-testid={`${testId}-scope`}>
        <legend className="mb-1 text-xs text-ink-3">{t("aiAccept.scope")}</legend>
        {document !== null && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
            <input type="radio" name="accept-scope" className="accent-accent" checked={!isBundle} data-testid={`${testId}-scope-document`} onChange={() => setIsBundle(false)} />
            <span className="min-w-0 truncate">{t("aiAccept.scopeDocument", { doc: document.label })}</span>
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
          <input type="radio" name="accept-scope" className="accent-accent" checked={isBundle} data-testid={`${testId}-scope-bundle`} onChange={() => setIsBundle(true)} />
          {t("aiAccept.scopeBundle")}
        </label>
      </fieldset>
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-ink-2" role="status" data-testid={`${testId}-counts`}>
        {preview.error !== null && preview.error !== undefined ? (
          <p className="text-danger">{humanizeApiError(preview.error, t)}</p>
        ) : preview.data === null ? (
          <p className="text-ink-3">{t("common.loading")}</p>
        ) : shapes.length === 0 && deletes === 0 ? (
          <p data-testid={`${testId}-empty`}>{t("aiAccept.empty")}</p>
        ) : (
          <ul className="grid gap-0.5">
            {shapes.map(({ shape, count }) => (
              <li key={shape} className="flex justify-between gap-3" data-testid={`${testId}-shape-${shape}`}>
                <span>{t(`aiAccept.shape.${shape}`)}</span>
                <span className="font-mono tabular-nums text-ink">{count}</span>
              </li>
            ))}
          </ul>
        )}
        {excluded.map((entry) => (
          <p key={entry.key} className="text-xs text-ink-3" data-testid={`${testId}-excluded-${entry.key}`}>
            {t(`aiAccept.excluded.${entry.key}`, { n: entry.n })}
          </p>
        ))}
      </div>
      {deletes > 0 && (
        <div className="grid gap-1.5" data-testid={`${testId}-deletes`}>
          <Checkbox checked={includeDeletes} onChange={setIncludeDeletes} testId={`${testId}-include-deletes`} label={t("aiAccept.includeDeletes", { n: deletes })} />
          {includeDeletes && (
            <label className="grid gap-1 text-xs text-ink-3">
              {t("aiAccept.deleteRemark")}
              <input
                className="input h-8 text-[13px] text-ink"
                value={remark}
                maxLength={2000}
                data-testid={`${testId}-remark`}
                placeholder={t("aiAccept.deleteRemarkHint")}
                onChange={(event) => setRemark(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
