// Assign 범례 - 고른 조각이 없으면 오른쪽 칸 전체로, 고른 뒤에는 오른쪽 위 (i)에 호버·포커스로 보인다(설계 §3.5).
"use client";

import { CircleCheck, Info, Link2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

function Row({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="legend-row">
      <span className="legend-swatch">{swatch}</span>
      <span>{children}</span>
    </div>
  );
}

export function AssignLegend() {
  const { t } = useI18n();
  return (
    <div className="assign-legend" data-testid="assign-legend">
      <section>
        <h3>{t("assign.legend.old")}</h3>
        <Row swatch={<span className="ptag ko">KO</span>}>{t("assign.legend.lang")}</Row>
        <Row swatch={<CircleCheck size={14} strokeWidth={2} className="pmark classified" aria-hidden />}>{t("assign.legend.confirmed")}</Row>
        <Row swatch={<Sparkles size={14} strokeWidth={1.6} className="pmark ai" aria-hidden />}>{t("assign.legend.ai")}</Row>
        <Row swatch={<Link2 size={14} strokeWidth={1.6} className="pmark pair" aria-hidden />}>{t("assign.legend.pair")}</Row>
        <Row swatch={<span className="strip-note">→ 1.1</span>}>{t("assign.legend.goneTo")}</Row>
      </section>
      <section>
        <h3>{t("assign.legend.new")}</h3>
        <Row swatch={<span className="legend-box" data-state="candidate" />}>{t("assign.legend.candidate")}</Row>
        <Row swatch={<span className="legend-box" data-state="picked" />}>{t("assign.legend.picked")}</Row>
        <Row swatch={<span className="new-src">← 1-012</span>}>{t("assign.legend.source")}</Row>
        <Row swatch={<span className="legend-box" data-state="unsourced" />}>{t("assign.legend.unsourced")}</Row>
      </section>
      <section>
        <h3>{t("assign.legend.keys")}</h3>
        <Row swatch={<kbd>↑↓</kbd>}>{t("assign.legend.keyMove")}</Row>
        <Row swatch={<kbd>↵</kbd>}>{t("assign.legend.keyConfirm")}</Row>
        <Row swatch={<><kbd>H</kbd> <kbd>U</kbd></>}>{t("assign.legend.keyHoldClear")}</Row>
        <Row swatch={<kbd>Shift</kbd>}>{t("assign.legend.keyBulk")}</Row>
        <Row swatch={<kbd>Ctrl</kbd>}>{t("assign.legend.keyCtrl")}</Row>
      </section>
    </div>
  );
}

export function LegendButton() {
  const { t } = useI18n();
  return (
    <span className="legend-wrap">
      <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("assign.legend.button")} data-testid="assign-legend-button">
        <Info size={15} strokeWidth={1.5} aria-hidden />
      </button>
      <span className="legend-pop" role="tooltip">
        <AssignLegend />
      </span>
    </span>
  );
}
