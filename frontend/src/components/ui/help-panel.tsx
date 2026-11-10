// 도움말 패널 - 단축키와 표시의 뜻을 탭 둘로 한곳에 둔다. 내용(키 목록·표시 줄)은 화면이 넘기고, 접힘·탭은 화면별로 이 브라우저에 남는다.
"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { setHelpOpen, setHelpTab, useHelpPrefs, type HelpScreen, type HelpTab } from "@/lib/help-prefs";

const TABS: readonly HelpTab[] = ["keys", "marks"];
const TAB_LABELS: Record<HelpTab, string> = { keys: "split.keys", marks: "split.helpMarks" };

export interface HelpPanelProps {
  screen: HelpScreen;
  /** [설명, 글쇠] 한 쌍씩. 설명은 번역을 마친 글 */
  keys: readonly (readonly [string, ReactNode])[];
  /** 표시 탭 내용 - `.help-panel-row` 줄들 */
  marks: ReactNode;
}

export function HelpPanel({ screen, keys, marks }: HelpPanelProps) {
  const { t } = useI18n();
  const { isOpen, tab } = useHelpPrefs(screen);
  const testId = `${screen}-help`;
  return (
    <div className="help-panel" data-testid={testId}>
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
                data-testid={`${testId}-tab-${key}`}
                onClick={() => setHelpTab(screen, key)}
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
          data-testid={`${testId}-toggle`}
          onClick={() => setHelpOpen(screen, !isOpen)}
        >
          {isOpen ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronUp size={14} strokeWidth={1.5} aria-hidden />}
        </button>
      </div>
      {isOpen && tab === "keys" && (
        <dl className="help-panel-body grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1" role="tabpanel" data-testid={`${testId}-keys`}>
          {keys.map(([label, key]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd>{key}</dd>
            </div>
          ))}
        </dl>
      )}
      {isOpen && tab === "marks" && (
        <div className="help-panel-body grid gap-1" role="tabpanel" data-testid={`${testId}-marks`}>
          {marks}
        </div>
      )}
    </div>
  );
}
