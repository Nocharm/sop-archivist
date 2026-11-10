// 쪼개기 화면 왼쪽 아래 도움말 - 단축키와 용지 표시의 뜻을 탭 둘로 한곳에 둔다. 접을 수 있고 접힘·탭은 이 브라우저에 남는다.
"use client";

import { ChevronDown, ChevronUp, CircleCheck, FolderCheck, Link2, Scissors, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { setSplitHelpOpen, setSplitHelpTab, useSplitHelpPrefs, type SplitHelpTab } from "@/lib/split-help-prefs";

const TABS: readonly SplitHelpTab[] = ["keys", "marks"];
const TAB_LABELS: Record<SplitHelpTab, string> = { keys: "split.keys", marks: "split.helpMarks" };

export function SplitHelp() {
  const { t } = useI18n();
  const { isOpen, tab } = useSplitHelpPrefs();
  const keys: readonly (readonly [string, string])[] = [
    ["split.keyCheck", "↵"],
    ["split.keyMove", "↑ ↓ · J K"],
    ["split.keyCut", t("split.doubleClick")],
    ["split.keyCutMove", t("split.drag")],
    ["split.keySplit", "S"],
    ["split.keyUncheck", "U"],
    ["split.keyHold", "H"],
    ["split.keyUndo", "Ctrl Z"],
  ];
  return (
    <div className="split-help" data-testid="split-help">
      <div className="flex items-center gap-1">
        {isOpen ? (
          <div className="flex min-w-0 flex-1 gap-0.5 rounded-md bg-sunken p-0.5" role="tablist" aria-label={t("split.help")}>
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`h-[24px] min-w-0 flex-1 truncate rounded-sm px-2 text-xs ${tab === key ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
                data-testid={`split-help-tab-${key}`}
                onClick={() => setSplitHelpTab(key)}
              >
                {t(TAB_LABELS[key])}
              </button>
            ))}
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-semibold text-ink-3">{t("split.help")}</span>
        )}
        <button
          type="button"
          className="btn ghost icon h-7 w-7 flex-none"
          aria-expanded={isOpen}
          aria-label={t(isOpen ? "split.helpHide" : "split.helpShow")}
          data-testid="split-help-toggle"
          onClick={() => setSplitHelpOpen(!isOpen)}
        >
          {isOpen ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronUp size={14} strokeWidth={1.5} aria-hidden />}
        </button>
      </div>
      {isOpen && tab === "keys" && (
        <dl className="split-help-body grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1" role="tabpanel" data-testid="split-help-keys">
          {keys.map(([label, key]) => (
            <div key={label} className="contents">
              <dt>{t(label)}</dt>
              <dd>
                <kbd>{key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {isOpen && tab === "marks" && (
        <div className="split-help-body grid gap-1" role="tabpanel" data-testid="split-help-marks">
          <span className="split-help-row">
            <span className="ptag duo ko">
              <span>KO</span>
              <span>H</span>
            </span>
            {t("split.legendLangHold")}
          </span>
          <span className="split-help-row">
            <CircleCheck size={14} strokeWidth={2} className="pmark checked" aria-hidden />
            {t("split.legendChecked")}
          </span>
          <span className="split-help-row">
            <Link2 size={14} strokeWidth={1.6} className="pmark pair" aria-hidden />
            {t("split.legendPair")}
          </span>
          <span className="split-help-row">
            <FolderCheck size={14} strokeWidth={1.6} className="pmark classified" aria-hidden />
            {t("split.legendClassified")}
          </span>
          <span className="split-help-row">
            <Sparkles size={14} strokeWidth={1.6} className="pmark ai" aria-hidden />
            {t("split.legendAi")}
          </span>
          <span className="split-help-row">
            <WandSparkles size={14} strokeWidth={1.6} className="pmark suggest" aria-hidden />
            {t("split.markSuggest")}
          </span>
          <span className="split-help-row">
            <Scissors size={14} strokeWidth={1.6} className="pmark edited" aria-hidden />
            {t("split.legendEdited")}
          </span>
          <span className="split-help-row">
            <TriangleAlert size={14} strokeWidth={1.6} className="pmark warn" aria-hidden />
            {t("split.markWarn")}
          </span>
          <span className="split-help-row">
            <span className="split-help-partner" aria-hidden />
            {t("split.legendPartner")}
          </span>
        </div>
      )}
    </div>
  );
}
