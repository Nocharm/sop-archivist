// 문서 머리의 확대 −/+ - 평소엔 흐리고 그 문서에 마우스를 올리면 진해진다. Ctrl+휠·Ctrl ±와 같은 값을 움직인다.
"use client";

import { Minus, Plus } from "lucide-react";

import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { useI18n } from "@/lib/i18n";

export function PaneZoom({ value, onStep, testId }: { value: number; onStep: (dir: "+" | "-") => void; testId: string }) {
  const { t } = useI18n();
  // 감싼 span 하나가 `.pane-zoom span` 규칙을 받으므로 `Tooltip`을 단추마다 두지 않고 맡겨 둔 툴팁을 쓴다
  const tip = useDelegatedTip();
  return (
    <span className="pane-zoom" role="group" aria-label={t("assign.zoom")} {...tip.handlers}>
      <button type="button" aria-label={t("assign.zoomOut")} data-tip={t("assign.zoomOut")} data-testid={`${testId}-out`} disabled={value <= 0.7} onClick={() => onStep("-")}>
        <Minus size={12} strokeWidth={1.8} aria-hidden />
      </button>
      <span data-testid={`${testId}-value`}>{Math.round(value * 100)}%</span>
      <button type="button" aria-label={t("assign.zoomIn")} data-tip={t("assign.zoomIn")} data-testid={`${testId}-in`} disabled={value >= 1.6} onClick={() => onStep("+")}>
        <Plus size={12} strokeWidth={1.8} aria-hidden />
      </button>
      {tip.node}
    </span>
  );
}
