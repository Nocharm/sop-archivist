// 쪼개기 화면 왼쪽 아래 도움말 - 내용만 정하고 틀은 공통 `HelpPanel`이 맡는다.
"use client";

import { CircleCheck, FolderCheck, Link2, Scissors, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";

import { LangMark } from "@/components/lang-mark";
import { UnitStatusChip } from "@/components/status";
import { HelpPanel } from "@/components/ui/help-panel";
import { useI18n } from "@/lib/i18n";

export function SplitHelp() {
  const { t } = useI18n();
  const keys: readonly (readonly [string, string])[] = [
    [t("split.keyCheck"), "↵"],
    [t("split.keyMove"), "↑ ↓ · J K"],
    [t("split.keyCut"), t("split.doubleClick")],
    [t("split.keyCutMove"), t("split.drag")],
    [t("split.keySplit"), "S"],
    [t("split.keyUncheck"), "U"],
    [t("split.keyHold"), "H"],
    [t("split.keyUndo"), "Ctrl Z"],
  ];
  return (
    <HelpPanel
      screen="split"
      keys={keys.map(([label, key]) => [label, <kbd key={label}>{key}</kbd>] as const)}
      marks={
        <>
          <span className="help-panel-row">
            <LangMark lang="ko" testId="split-help-lang-ko" />
            <LangMark lang="en" testId="split-help-lang-en" />
            {t("split.legendLang")}
          </span>
          <span className="help-panel-row">
            <UnitStatusChip status="on_hold" size="sm" testId="split-help-hold" />
            {t("split.legendHoldChip")}
          </span>
          <span className="help-panel-row">
            <span className="legend-pairbar" aria-hidden>
              <span className="strip-lead-bar" data-lang="ko" />
              <span className="strip-lead-bar" data-lang="en" />
            </span>
            {t("split.legendPairBar")}
          </span>
          <span className="help-panel-row">
            <CircleCheck size={14} strokeWidth={2} className="pmark checked" aria-hidden />
            {t("split.legendChecked")}
          </span>
          <span className="help-panel-row">
            <Link2 size={14} strokeWidth={1.6} className="pmark pair" aria-hidden />
            {t("split.legendPair")}
          </span>
          <span className="help-panel-row">
            <FolderCheck size={14} strokeWidth={1.6} className="pmark classified" aria-hidden />
            {t("split.legendClassified")}
          </span>
          <span className="help-panel-row">
            <Sparkles size={14} strokeWidth={1.6} className="pmark ai" aria-hidden />
            {t("split.legendAi")}
          </span>
          <span className="help-panel-row">
            <WandSparkles size={14} strokeWidth={1.6} className="pmark suggest" aria-hidden />
            {t("split.markSuggest")}
          </span>
          <span className="help-panel-row">
            <Scissors size={14} strokeWidth={1.6} className="pmark edited" aria-hidden />
            {t("split.legendEdited")}
          </span>
          <span className="help-panel-row">
            <TriangleAlert size={14} strokeWidth={1.6} className="pmark warn" aria-hidden />
            {t("split.markWarn")}
          </span>
          <span className="help-panel-row">
            <span className="help-panel-partner" aria-hidden />
            {t("split.legendPartner")}
          </span>
        </>
      }
    />
  );
}
