// 나눌 선 옆 작은 상자 - "Split here"(S)와 Cancel(Esc). Split과 Assign이 Paper의 renderAtCut으로 같이 쓴다.
"use client";

import { Scissors, X } from "lucide-react";

import { useI18n } from "@/lib/i18n";

interface CutPopProps {
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** 단추 testid 앞말 - `${prefix}-cut-run`·`${prefix}-cut-cancel` */
  testIdPrefix: string;
}

export function CutPop({ busy, onRun, onCancel, testIdPrefix }: CutPopProps) {
  const { t } = useI18n();
  return (
    <span className="cut-pop" role="group" aria-label={t("split.split")} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="btn pri h-7" data-testid={`${testIdPrefix}-cut-run`} disabled={busy} onClick={onRun}>
        <Scissors size={14} strokeWidth={1.5} aria-hidden />
        {t("split.cutHere")} <kbd>S</kbd>
      </button>
      <button type="button" className="btn h-7" data-testid={`${testIdPrefix}-cut-cancel`} onClick={onCancel}>
        <X size={14} strokeWidth={1.5} aria-hidden />
        {t("common.cancel")} <kbd>Esc</kbd>
      </button>
    </span>
  );
}
