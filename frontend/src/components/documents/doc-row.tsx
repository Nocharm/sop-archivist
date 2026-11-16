// 문서 목록의 줄 틀(Documents 화면 설계 §4) - 두 목록이 같이 쓴다. 줄은 읽기(식별 · 제목 줄 · 딸린 정보 줄 · 끝), 누르거나 Enter · Space면 그 아래 펼친 곳이 열린다.
// 줄 끝 단추는 두 모양을 모두 그리고 CSS(목록 틀 폭의 컨테이너 질의)가 고른다 - 넓으면 아이콘 묶음, 좁으면 ⋯ 메뉴. 마우스가 있으면 올리거나 포커스가 들어올 때만 보인다.
"use client";

import { ChevronRight, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Menu } from "@/components/ui/menu";
import { Collapse } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { getRowOpenProps, shouldRowToggle } from "@/lib/row-open";

export interface RowAction {
  key: string;
  icon: LucideIcon;
  label: string;
  testId: string;
  danger?: boolean;
  /** 꺼진 까닭 - 있으면 단추가 꺼지고 툴팁·메뉴 항목의 작은 글에 뜬다 */
  blocked?: string;
  run: () => void;
}

interface DocRowProps {
  /** `${prefix}-row` · `-toggle` · `-acts` · `-more` · `-more-menu` · `-panel` */
  prefix: string;
  /** 바탕·나무 선, 다음 계획의 놓을 자리 판정 */
  kind: "old" | "sop" | "wi";
  /** SOP 아래 들인 WI */
  isChild?: boolean;
  open: boolean;
  onToggle: () => void;
  /** 화살표 단추의 aria-label */
  toggleLabel: string;
  identity: ReactNode;
  title: ReactNode;
  /** 한 줄 */
  meta: ReactNode;
  /** 딸린 정보 줄 아래 한 줄 */
  below?: ReactNode;
  /** 끝 자리의 상태 표시 */
  state?: ReactNode;
  /** 비면 단추와 그 자리가 없다 */
  actions: readonly RowAction[];
  /** 펼친 동안만 그린다 */
  panel: () => ReactNode;
  /** 줄 상자(.doc-row)에 그대로 얹는 data-* */
  rowData?: Readonly<Record<`data-${string}`, string | undefined>>;
  /** 자리 바꿈(useFlip)의 키 - 줄과 펼친 곳이 함께 움직이게 바깥 상자에 단다 */
  flipKey?: string;
}

export function DocRow({ prefix, kind, isChild = false, open, onToggle, toggleLabel, identity, title, meta, below, state, actions, panel, rowData, flipKey }: DocRowProps) {
  const { t } = useI18n();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const openProps = getRowOpenProps(onToggle);

  // 고르면 닫고 실행한다 - 닫힌 메뉴가 포커스를 ⋯ 단추로 돌린다
  function runFromMenu(action: RowAction) {
    setIsMenuOpen(false);
    action.run();
  }

  return (
    <div className="doc-item" data-open={open ? "" : undefined} data-flip-key={flipKey}>
      <div
        className="doc-row"
        data-kind={kind}
        data-child={isChild ? "" : undefined}
        data-testid={`${prefix}-row`}
        tabIndex={openProps.tabIndex}
        onKeyDown={openProps.onKeyDown}
        // 줄 안의 단추·링크·입력에서 누른 것과 글자를 긁고 뗀 것은 펼침이 아니다. 포털로 뜬 메뉴의 누름도 React 트리로 올라오므로 DOM 안의 것만 본다
        onClick={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (shouldRowToggle(event.target, (window.getSelection()?.toString() ?? "") !== "")) openProps.onClick();
        }}
        {...rowData}
      >
        {/* 아이콘만 있는 단추 - 뜻은 툴팁으로도 */}
        <Tooltip label={toggleLabel} align="start">
          <button type="button" className="doc-chev" aria-expanded={open} aria-label={toggleLabel} data-testid={`${prefix}-toggle`} onClick={onToggle}>
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </Tooltip>
        <div className="doc-id">{identity}</div>
        <div className="doc-main">
          <div className="doc-title">{title}</div>
          <div className="doc-meta">{meta}</div>
          {below}
        </div>
        <div className="doc-end">
          {state !== undefined && <span className="doc-state">{state}</span>}
          {actions.length > 0 && (
            <>
              <span className="doc-acts" data-no-drag data-testid={`${prefix}-acts`}>
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Tooltip key={action.key} label={action.blocked ?? action.label} align="end">
                      <button
                        type="button"
                        className={`btn ghost icon h-6 w-6${action.danger ? " text-danger" : ""}`}
                        aria-label={action.label}
                        data-testid={action.testId}
                        disabled={action.blocked !== undefined}
                        onClick={action.run}
                      >
                        <Icon size={16} strokeWidth={1.5} aria-hidden />
                      </button>
                    </Tooltip>
                  );
                })}
              </span>
              <span className="doc-more" data-no-drag>
                <Tooltip label={t("manage.rowActions")} suppressed={isMenuOpen} align="end">
                  <button
                    ref={moreRef}
                    type="button"
                    className="btn ghost icon h-6 w-6"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    aria-label={t("manage.rowActions")}
                    data-testid={`${prefix}-more`}
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                  </button>
                </Tooltip>
                {isMenuOpen && (
                  <Menu anchorRef={moreRef} onClose={() => setIsMenuOpen(false)} testId={`${prefix}-more-menu`} label={t("manage.rowActions")} align="end">
                    {actions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.key}
                          type="button"
                          role="menuitem"
                          className={`menu-item${action.danger && action.blocked === undefined ? " text-danger" : ""}`}
                          data-testid={`${action.testId}-item`}
                          disabled={action.blocked !== undefined}
                          onClick={() => runFromMenu(action)}
                        >
                          <Icon size={14} strokeWidth={1.5} aria-hidden />
                          {action.blocked === undefined ? (
                            action.label
                          ) : (
                            <span className="grid">
                              {action.label}
                              <span className="doc-menu-why">{action.blocked}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </Menu>
                )}
              </span>
            </>
          )}
        </div>
      </div>
      <Collapse open={open} className="doc-panel" testId={`${prefix}-panel`}>
        {panel}
      </Collapse>
    </div>
  );
}
