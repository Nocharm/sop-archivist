// Assign 인스펙터 맨 아래 도움말 - 단축키와 표시(Old·New 줄 끝 표시, 이어진 곳 보기)의 뜻. 틀은 공통 `HelpPanel`이 맡는다.
"use client";

import { CircleCheck, FileCheck2, Link2, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AssignKeyboardMap } from "@/components/assign/assign-keyboard-map";
import { UnitStatusChip } from "@/components/status";
import { HelpPanel } from "@/components/ui/help-panel";
import { ASSIGN_KEYS, formatAssignKey, HELP_ONLY } from "@/lib/assign-keymap";
import { useDraftingOn } from "@/lib/drafting";
import { useI18n } from "@/lib/i18n";
import { PROGRESS_PART_FILL } from "@/lib/progress-model";

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
  const [isMapOpen, setMapOpen] = useState(false);
  // 새 문서를 숨긴 동안 고쳐 쓰기(E) · 칸으로 보내기 · 칸 제목의 설명을 뺀다
  const isDrafting = useDraftingOn() === true;
  const writeGesture = (press: string) => press.replace(/\{(\w+)\}/, (_whole, gesture: string) => t(`assign.help.${gesture}`));
  // 글쇠는 키 처리와 같은 표에서 - 여기에 따로 적지 않는다
  const keys: readonly (readonly [string, ReactNode])[] = [
    ...[...new Map(ASSIGN_KEYS.map((entry) => [entry.id, entry.labelKey]))].map(([id, labelKey]) => [t(labelKey), <kbd key={id}>{formatAssignKey(id)}</kbd>] as const),
    ...HELP_ONLY.filter((item) => isDrafting || !item.isDraftOnly).map(
      (item) => [t((isDrafting ? item.draftLabelKey : undefined) ?? item.labelKey), <kbd key={item.id}>{item.presses.map(writeGesture).join(" ")}</kbd>] as const,
    ),
  ];
  return (
    <>
      <HelpPanel
        screen="assign"
        keys={keys}
        keysFooter={
          <button type="button" className="btn ghost w-full" data-testid="assign-help-keyboard-map" onClick={() => setMapOpen(true)}>
            {t("assign.kbd.open")}
          </button>
        }
        marks={
          <>
            <Row swatch={<UnitStatusChip status="on_hold" size="sm" testId="assign-help-hold" />}>{t("assign.legend.holdChip")}</Row>
            <span className="help-panel-row flex-wrap" data-testid="assign-help-chips">
              {(["unassigned", "confirmed", "on_hold"] as const).map((st) => (
                <UnitStatusChip key={st} status={st} testId={`assign-help-chip-${st}`} />
              ))}
            </span>
            {/* 문서 대시보드 · 개요 막대의 색 - 이동은 옛 기록에만 있어 뺐다 */}
            <span className="help-panel-row flex-wrap" data-testid="assign-help-parts">
              {(["assigned", "deleted", "on_hold", "unassigned"] as const).map((part) => (
                <span key={part} className="inline-flex items-center gap-1">
                  <i className="inline-block size-2 rounded-sm" style={{ background: PROGRESS_PART_FILL[part] }} aria-hidden />
                  {t(`progress.part.${part}`)}
                </span>
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
            {isDrafting && <Row swatch={<span className="tree-sub">{t("assign.slotHeading")}</span>}>{t("assign.help.slotHeading")}</Row>}
            <Row swatch={<span className="legend-line" aria-hidden />}>{t("assign.help.markLine")}</Row>
            <Row swatch={<span className="legend-line is-dashed" aria-hidden />}>{t("assign.help.markUnsaved")}</Row>
          </>
        }
      />
    {isMapOpen && <AssignKeyboardMap onClose={() => setMapOpen(false)} />}
    </>
  );
}
