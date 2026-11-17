// Assign 위쪽 줄의 더보기(⋯) - 자주 쓰지 않는 길을 한 메뉴로 모은다: 같은 글 일괄 확정 · AI 요청 · 원문 글꼴 · 초기화(맨 아래 위험색).
// 단추가 많아 위쪽 줄이 넘치던 것을 줄이려는 것(1.2.0 피드백). 글꼴은 같은 메뉴 안에서 한 단계 들어가 고른다.
"use client";

import { ChevronLeft, ChevronRight, Ellipsis, Link2, RotateCcw, Sparkles, Type } from "lucide-react";
import { useRef, useState } from "react";

import type { ResetScope } from "@/components/assign/reset-modal";
import type { AiAskItem } from "@/components/manage/ai-ask-menu";
import { SourceFontLists } from "@/components/paper/source-font-menu";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { Menu } from "@/components/ui/menu";
import { BusyLabel } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

interface AssignMoreMenuProps {
  canEdit: boolean;
  disabled: boolean;
  /** 원문이 같은 짝 수 - 0이면 항목이 없다 */
  identicalCount: number;
  onIdentical: () => void;
  aiItems: AiAskItem[];
  /** 지금 연 Old 문서 - 없으면 문서 초기화 항목을 막는다 */
  resetDocument: { id: number; label: string } | null;
  onReset: (scope: ResetScope) => void;
}

export function AssignMoreMenu({ canEdit, disabled, identicalCount, onIdentical, aiItems, resetDocument, onReset }: AssignMoreMenuProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"main" | "font" | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const tip = useDelegatedTip();

  function close() {
    setView(null);
  }
  function pick(run: () => void) {
    close();
    run();
  }
  async function runAi(item: AiAskItem) {
    close();
    setRunning(item.key);
    try {
      await item.run();
    } finally {
      setRunning(null);
    }
  }

  const label = t("assign.more");
  return (
    <>
      <Tooltip label={label} align="end" suppressed={view !== null}>
        <button
          ref={anchorRef}
          type="button"
          className="btn icon h-7 w-7"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={view !== null}
          data-testid="assign-more"
          disabled={running !== null}
          onClick={() => setView((prev) => (prev === null ? "main" : null))}
        >
          <BusyLabel busy={running !== null} icon={<Ellipsis size={14} strokeWidth={1.5} aria-hidden />} label={null} />
        </button>
      </Tooltip>
      {view === "font" && (
        <Menu anchorRef={anchorRef} onClose={close} testId="assign-more-list" align="end" label={t("paper.sourceFont")}>
          <button type="button" role="menuitem" className="menu-item" data-testid="assign-more-back" onClick={() => setView("main")}>
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
            {t("paper.sourceFont")}
          </button>
          <div className="menu-sep" role="separator" />
          <SourceFontLists />
        </Menu>
      )}
      {view === "main" && (
        <Menu anchorRef={anchorRef} onClose={close} testId="assign-more-list" align="end" label={label}>
          {canEdit && identicalCount > 0 && (
            <button type="button" role="menuitem" className="menu-item" data-testid="assign-identical" disabled={disabled} onClick={() => pick(onIdentical)}>
              <Link2 size={14} strokeWidth={1.5} aria-hidden />
              {t("assign.identical", { n: identicalCount })}
            </button>
          )}
          {canEdit && aiItems.length > 0 && (
            // display: contents - 꺼진 AI 항목의 까닭 툴팁 핸들러만 얹고 항목 배치는 Menu 그대로
            <div style={{ display: "contents" }} {...tip.handlers}>
              {aiItems.map((item) => {
                const reason = item.disabledReason ?? null;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    aria-disabled={reason || disabled ? "true" : undefined}
                    aria-label={reason ? `${item.label} - ${reason}` : undefined}
                    data-tip={reason ?? undefined}
                    data-tip-side="left"
                    data-testid={`assign-ai-menu-${item.key}`}
                    onClick={() => {
                      if (!reason && !disabled) void runAi(item);
                    }}
                  >
                    <Sparkles size={14} strokeWidth={1.5} className="text-st-ai" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
          <button type="button" role="menuitem" className="menu-item" data-testid="paper-font" onClick={() => setView("font")}>
            <Type size={14} strokeWidth={1.5} aria-hidden />
            {t("paper.sourceFont")}
            <ChevronRight size={14} strokeWidth={1.5} className="ml-auto" aria-hidden />
          </button>
          {canEdit && (
            <>
              <div className="menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="assign-reset-document"
                disabled={disabled || resetDocument === null}
                onClick={() => resetDocument && pick(() => onReset({ kind: "document", documentId: resetDocument.id, label: resetDocument.label }))}
              >
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                <span className="flex-none">{t("assign.reset.document")}</span>
                {resetDocument && <span className="ml-auto min-w-0 truncate pl-3 font-mono text-[11px] text-ink-3">{resetDocument.label}</span>}
              </button>
              <button type="button" role="menuitem" className="menu-item danger" data-testid="assign-reset-bundle" disabled={disabled} onClick={() => pick(() => onReset({ kind: "bundle" }))}>
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                {t("assign.reset.bundle")}
              </button>
            </>
          )}
          {tip.node}
        </Menu>
      )}
    </>
  );
}
