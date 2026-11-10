// Assign 머리 막대의 초기화 메뉴 - 지금 연 Old 문서 초기화가 위, 묶음 전체는 선 아래 위험색으로 한 단계 더 깊이 둔다(실수로 묶음 전체를 누르지 않게).
"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import type { ResetScope } from "@/components/assign/reset-modal";
import { Menu } from "@/components/ui/menu";
import { useI18n } from "@/lib/i18n";

interface ResetMenuProps {
  /** 지금 연 Old 문서 - 없으면 문서 항목을 막는다 */
  document: { id: number; label: string } | null;
  disabled?: boolean;
  onPick: (scope: ResetScope) => void;
}

export function ResetMenu({ document, disabled = false, onPick }: ResetMenuProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function pick(scope: ResetScope) {
    setOpen(false);
    onPick(scope);
  }

  return (
    <>
      <button ref={anchorRef} type="button" className="btn h-7" aria-haspopup="menu" aria-expanded={open} data-testid="assign-reset" disabled={disabled} onClick={() => setOpen((prev) => !prev)}>
        <RotateCcw size={12} strokeWidth={1.5} aria-hidden />
        {t("assign.reset.menu")}
        <ChevronDown size={12} strokeWidth={1.5} className="select-chevron" aria-hidden />
      </button>
      {open && (
        <Menu anchorRef={anchorRef} onClose={() => setOpen(false)} testId="assign-reset-list" align="start">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-testid="assign-reset-document"
            disabled={document === null}
            onClick={() => document && pick({ kind: "document", documentId: document.id, label: document.label })}
          >
            <span className="flex-none">{t("assign.reset.document")}</span>
            {document && <span className="ml-auto min-w-0 truncate pl-3 font-mono text-[11px] text-ink-3">{document.label}</span>}
          </button>
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" className="menu-item danger" data-testid="assign-reset-bundle" onClick={() => pick({ kind: "bundle" })}>
            {t("assign.reset.bundle")}
          </button>
        </Menu>
      )}
    </>
  );
}
