// 대응 표 함께 벗기기 창(MD 1 F8a, 사용자 결정 2026-11-19) - 한/영 따로 문서에서 표를 벗길 때 다른 언어 절반의 대응 표를 한 번 묻는다.
// 가장 비슷한 표 하나만 미리 골라 두고, 목록에서 다른 표나 "이 표만"을 고를 수 있다. 함께 벗기면 편집 한 번이라 되돌리기 한 번에 둘 다 돌아온다.
"use client";

import { LayoutList, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { Truncate } from "@/components/ui/motion";
import type { CounterpartChoice } from "@/lib/counterpart-model";
import { useI18n } from "@/lib/i18n";

interface CounterpartModalProps {
  /** 대응 표가 있는 절반 - 벗기는 표의 반대 언어, 모르면 null */
  half: "en" | "ko" | null;
  /** 함께 벗길 후보 - 맨 앞이 가장 비슷한 표(미리 고름) */
  choices: readonly CounterpartChoice[];
  busy: boolean;
  /** 고른 대응 표(null이면 이 표만)로 벗긴다 */
  onConfirm: (counterpartId: number | null) => void;
  onClose: () => void;
}

export function CounterpartModal({ half, choices, busy, onConfirm, onClose }: CounterpartModalProps) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<number | null>(choices[0]?.tableId ?? null);
  const best = choices[0];
  const title = half
    ? t("assign.counterpart.title", { half: t(half === "en" ? "assign.counterpart.halfEn" : "assign.counterpart.halfKo"), n: best?.number ?? "" })
    : t("assign.counterpart.titleNoHalf", { n: best?.number ?? "" });
  return (
    <Modal
      title={title}
      onClose={onClose}
      testId="assign-counterpart"
      isBusy={busy}
      footer={
        <>
          <button type="button" className="btn" data-testid="assign-counterpart-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid="assign-counterpart-confirm" disabled={busy} onClick={() => onConfirm(picked)}>
            <LayoutList size={16} strokeWidth={1.5} aria-hidden />
            {t("assign.counterpart.run")}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-ink-2">{t("assign.counterpart.body")}</p>
      <fieldset className="grid gap-1" data-testid="assign-counterpart-list">
        <legend className="sr-only">{title}</legend>
        <div className="grid max-h-[40vh] gap-1 overflow-y-auto">
          {choices.map((choice, index) => (
            <label key={choice.tableId} className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-tint" data-testid={`assign-counterpart-option-${choice.tableId}`}>
              <input type="radio" name="counterpart" className="mt-1 accent-accent" checked={picked === choice.tableId} onChange={() => setPicked(choice.tableId)} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink">
                  <span className="font-semibold">{t("assign.counterpart.option", { n: choice.number, rows: choice.rows, cols: choice.cols })}</span>
                  {index === 0 && <span className="text-xs text-ink-3">{t("assign.counterpart.best")}</span>}
                </span>
                {choice.firstText && <Truncate text={choice.firstText} className="text-[13px] text-ink-2" />}
                {choice.rowsDiffer && <span className="text-xs text-st-hold">{t("assign.counterpart.rowsDifferNote")}</span>}
              </span>
            </label>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-tint" data-testid="assign-counterpart-only">
          <input type="radio" name="counterpart" className="accent-accent" checked={picked === null} onChange={() => setPicked(null)} />
          {t("assign.counterpart.only")}
        </label>
      </fieldset>
    </Modal>
  );
}
