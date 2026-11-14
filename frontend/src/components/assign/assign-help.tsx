// Assign 인스펙터 맨 아래 도움말 - 단축키와 표시(Old·New 줄 끝 표시, 이어진 곳 보기)의 뜻. 틀은 공통 `HelpPanel`이 맡는다.
"use client";

import { CircleCheck, FileCheck2, Link2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { UnitStatusChip } from "@/components/status";
import { HelpPanel } from "@/components/ui/help-panel";
import { useI18n } from "@/lib/i18n";

function Row({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="help-panel-row">
      <span className="help-panel-swatch">{swatch}</span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function AssignHelp() {
  const { t } = useI18n();
  const keys: readonly (readonly [string, ReactNode])[] = [
    [t("assign.legend.keyMove"), <kbd key="move">↑ ↓ · J K</kbd>],
    [t("assign.legend.keyConfirm"), <kbd key="confirm">↵</kbd>],
    [t("assign.legend.keyEdit"), <kbd key="edit">E</kbd>],
    [t("assign.help.keyHold"), <kbd key="hold">H</kbd>],
    [t("assign.help.keyClear"), <kbd key="clear">U</kbd>],
    [t("assign.help.keyShift"), <kbd key="shift">Shift + {t("assign.help.click")}</kbd>],
    [t("assign.help.keyCtrl"), <kbd key="ctrl">Ctrl + {t("assign.help.click")}</kbd>],
    [t("assign.help.keyZoom"), <kbd key="zoom">Ctrl + {t("assign.help.wheel")}</kbd>],
    [t("assign.help.keyUndo"), <kbd key="undo">Ctrl Z</kbd>],
    [t("assign.help.keyMenu"), <kbd key="menu">↑ ↓ ← →</kbd>],
    [t("assign.help.keyEsc"), <kbd key="esc">Esc</kbd>],
  ];
  return (
    <HelpPanel
      screen="assign"
      keys={keys}
      marks={
        <>
          <Row swatch={<UnitStatusChip status="on_hold" size="sm" testId="assign-help-hold" />}>{t("assign.legend.holdChip")}</Row>
          <span className="help-panel-row flex-wrap" data-testid="assign-help-chips">
            {(["unassigned", "ai_suggested", "confirmed", "on_hold"] as const).map((st) => (
              <UnitStatusChip key={st} status={st} testId={`assign-help-chip-${st}`} />
            ))}
          </span>
          <Row swatch={<CircleCheck size={14} strokeWidth={2} className="pmark classified" aria-hidden />}>{t("assign.legend.confirmed")}</Row>
          <Row swatch={<Sparkles size={14} strokeWidth={1.6} className="pmark ai" aria-hidden />}>{t("assign.legend.ai")}</Row>
          <Row
            swatch={
              <>
                <span className="legend-card" aria-hidden>
                  <i />
                  <i />
                </span>
                <Link2 size={14} strokeWidth={1.6} className="pmark pair" aria-hidden />
              </>
            }
          >{t("assign.legend.pair")}</Row>
          <Row
            swatch={
              <span className="strip-note">
                <FileCheck2 size={11} strokeWidth={1.75} aria-hidden />1.1
              </span>
            }
          >{t("assign.legend.goneTo")}</Row>
          <Row swatch={<span className="legend-box" data-state="candidate" />}>{t("assign.legend.candidate")}</Row>
          <Row swatch={<span className="legend-box" data-state="picked" />}>{t("assign.legend.picked")}</Row>
          <Row swatch={<span className="new-src">← 1-012</span>}>{t("assign.legend.source")}</Row>
          <Row swatch={<span className="legend-box" data-state="unsourced" />}>{t("assign.legend.unsourced")}</Row>
          <Row swatch={<span className="legend-box" data-state="hover" />}>{t("assign.help.markHover")}</Row>
          <Row swatch={<span className="legend-box" data-state="flash" />}>{t("assign.help.markJump")}</Row>
          <Row swatch={<span className="legend-box" data-state="picked" />}>{t("assign.help.markLand")}</Row>
          <Row swatch={<span className="tree-sub">{t("assign.slotHeading")}</span>}>{t("assign.help.slotHeading")}</Row>
          <Row swatch={<span className="legend-line" aria-hidden />}>{t("assign.help.markLine")}</Row>
          <Row swatch={<span className="legend-line is-dashed" aria-hidden />}>{t("assign.help.markUnsaved")}</Row>
        </>
      }
    />
  );
}
