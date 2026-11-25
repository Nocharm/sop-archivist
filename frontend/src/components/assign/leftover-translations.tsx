// 남은 AI 번역 목록 - 확정하지 않은 번역(AI 제안 · 보류)은 검토 요청을 막는데, 출처 Old 줄이 나누기 · 합치기로 없어졌거나 배정이 취소되면 어느 줄에서도 보이지 않는다.
// 위쪽 줄의 "Leftover AI translations · n" 단추와 개요의 새 문장 관문 카드가 연다. 출처가 살아 있으면 그 줄로 가거나 확정하고, 없으면 지우기만 한다.
"use client";

import { Check, Languages, LocateFixed, Trash2 } from "lucide-react";

import { Modal } from "@/components/modal";
import { LangToken } from "@/components/paper/lang-token";
import { ClampText } from "@/components/ui/clamp-text";
import type { OpenTranslation } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface LeftoverTranslationsProps {
  items: readonly OpenTranslation[];
  busy: boolean;
  onSettle: (item: OpenTranslation, action: "confirm" | "remove") => void;
  onGo: (item: OpenTranslation) => void;
  onClose: () => void;
}

export function LeftoverTranslations({ items, busy, onSettle, onGo, onClose }: LeftoverTranslationsProps) {
  const { t } = useI18n();
  return (
    <Modal title={t("assign.openTranslation.title", { n: items.length })} subtitle={t("assign.openTranslation.lead")} onClose={onClose} testId="assign-leftover" size="lg">
      <ul className="grid gap-2" data-testid="assign-leftover-list">
        {items.map((item) => (
          <li key={item.id} className="grid gap-1.5 rounded-md border border-line px-3 py-2" data-testid={`assign-leftover-${item.id}`}>
            <span className="flex min-w-0 items-center gap-2 text-xs text-ink-2">
              <Languages size={14} strokeWidth={1.5} className="flex-none" aria-hidden />
              <span className="font-mono">{item.target_doc_code}</span>
              {item.source_unit_id !== null ? (
                <span className="font-mono">← {item.source_display_id}</span>
              ) : (
                <span data-testid={`assign-leftover-${item.id}-no-source`}>{t("assign.openTranslation.noSource")}</span>
              )}
              {item.source_unit_id !== null && !item.can_confirm && <span data-testid={`assign-leftover-${item.id}-unplaced`}>{t("assign.openTranslation.unplaced")}</span>}
            </span>
            <span className="flex min-w-0 items-start gap-1.5 text-[13px] leading-5 text-ink">
              <LangToken lang={item.lang} />
              <span className="min-w-0 flex-1">
                <ClampText text={item.text} testId={`assign-leftover-${item.id}-text`} />
              </span>
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {item.row_unit_id !== null && (
                <button type="button" className="btn ghost h-7" data-testid={`assign-leftover-${item.id}-go`} onClick={() => onGo(item)}>
                  <LocateFixed size={14} strokeWidth={1.5} aria-hidden />
                  {t("assign.openTranslation.go")}
                </button>
              )}
              {item.can_confirm && (
                <button type="button" className="btn h-7" data-testid={`assign-leftover-${item.id}-confirm`} disabled={busy} onClick={() => onSettle(item, "confirm")}>
                  <Check size={14} strokeWidth={1.5} aria-hidden />
                  {t("assign.hidden.translationConfirm")}
                </button>
              )}
              <button type="button" className="btn h-7" data-testid={`assign-leftover-${item.id}-remove`} disabled={busy} onClick={() => onSettle(item, "remove")}>
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                {t("assign.hidden.translationRemove")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
