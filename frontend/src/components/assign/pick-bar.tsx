// 박스 아래 단추 줄 - 마지막에 누른 박스 하나에만 뜨는 한 줄(쪼개기 먼저 §8). 무엇을 보일지는 buildPickBar가 정하고 이 부품은 그리기만 한다.
// 차례: [잇기] | [손질] | [이을 상대] … [⋯]. 잇기 뒤 칸(.pick-tools)이 남은 폭을 재어 손질 · 이을 상대의 이름을 덜 쓰는 것부터 접고, 그래도 모자라면 손질이 뒤에서부터 숨는다(@container).
// 호버 · 포커스는 배치를 바꾸지 않는다 - 접힌 단추의 이름은 툴팁(data-tip)으로 본다(올린 단추가 포인터 밑에서 빠지면 호버가 진동한다).
// ⋯를 누르는 순간 숨은 손질을 메뉴에 넣는다. 못 하는 손질도 이름을 보이고 까닭은 툴팁(data-tip)과 aria-label에 둔다.
"use client";

import { Combine, Ellipsis, Link2, ListTree, Scissors, Spline, Unlink, ArrowDownToLine, ArrowUpToLine, type LucideIcon } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";

import { Menu } from "@/components/ui/menu";
import { isMousePress } from "@/lib/assign-key-target";
import { useI18n } from "@/lib/i18n";
import type { PickSide } from "@/lib/doc-shape-model";
import type { PickBar as PickBarModel, PickMoreId, PickToolId } from "@/lib/pick-bar-model";

export interface PickBarProps {
  bar: PickBarModel;
  toolLabel: (id: PickToolId) => string;
  /** 단추에 붙일 글쇠 글("S" · "⇧J ⇧J") - 없으면 null */
  keyOf: (id: PickToolId | "link") => string | null;
  busy: boolean;
  testId: string;
  onLink: () => void;
  onStartLink: (to: PickSide) => void;
  onTool: (id: PickToolId) => void;
  onMore: (id: PickMoreId) => void;
}

const TOOL_ICONS: Record<PickToolId, LucideIcon> = { split: Scissors, merge_prev: ArrowUpToLine, merge_next: ArrowDownToLine, pair: Combine };
const LINK_KEYS = { link: "assign.pick.link", replace: "assign.pick.replace", add: "assign.pick.add", unlink: "assign.pick.unlink" } as const;
const MORE_KEYS: Record<PickMoreId, string> = { show_linked: "assign.pick.showLinked", unlink: "assign.pick.unlink", tools: "assign.pick.moreTools" };

/** 마우스로 누른 뒤에는 포커스를 용지로 - 단추에 남으면 Space · Enter가 그 단추를 다시 누른다(B1) */
function returnFocus(event: MouseEvent<HTMLElement>) {
  if (isMousePress(event)) event.currentTarget.closest<HTMLElement>(".pane-body")?.focus({ preventScroll: true });
}

export function PickBar({ bar, toolLabel, keyOf, busy, testId, onLink, onStartLink, onTool, onMore }: PickBarProps) {
  const { t } = useI18n();
  const moreRef = useRef<HTMLButtonElement>(null);
  const toolsRef = useRef<HTMLSpanElement>(null);
  // 열린 ⋯ 메뉴 - 연 순간 폭이 모자라 숨은 손질
  const [hidden, setHidden] = useState<readonly PickToolId[] | null>(null);
  const { link, tools, startLink, more } = bar;
  if (bar.at === null) return null;

  function openMore() {
    // display: none으로 숨은 손질만 - 이름만 접힌 단추는 offsetParent가 남는다
    setHidden(tools.filter((tool) => toolsRef.current?.querySelector<HTMLElement>(`[data-part="${tool.id}"]`)?.offsetParent === null).map((tool) => tool.id));
  }

  const linkKey = keyOf("link");
  const isLinkOff = busy || link?.reasonKey != null;
  return (
    <div className="pick-bar" role="group" aria-label={t("assign.pick.bar")} data-testid={testId}>
      {link && (
        <button
          type="button"
          className="btn pri h-7 pick-link"
          data-part="link"
          data-kind={link.kind}
          data-testid={`${testId}-link`}
          aria-disabled={isLinkOff ? "true" : undefined}
          data-tip={link.reasonKey ? t(link.reasonKey) : undefined}
          onClick={(event) => {
            returnFocus(event);
            if (!isLinkOff) onLink();
          }}
        >
          {link.kind === "unlink" ? <Unlink size={14} strokeWidth={1.5} aria-hidden /> : <Link2 size={14} strokeWidth={1.5} aria-hidden />}
          {t(LINK_KEYS[link.kind])}
          {link.isEnter ? <kbd>↵</kbd> : linkKey !== null && <kbd>{linkKey}</kbd>}
        </button>
      )}
      {link && tools.length > 0 && <span className="pick-sep" data-part="sep" aria-hidden />}
      {(tools.length > 0 || startLink || more.length > 0) && (
        <span ref={toolsRef} className="pick-tools">
          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool.id];
            const key = keyOf(tool.id);
            const name = `${toolLabel(tool.id)}${key ? ` ${key}` : ""}`;
            const reason = tool.reasonKey ? t(tool.reasonKey) : null;
            const isOff = busy || tool.reasonKey !== null;
            return (
              <button
                key={tool.id}
                type="button"
                className="mbtn"
                data-part={tool.id}
                data-testid={`${testId}-tool-${tool.id}`}
                aria-disabled={isOff ? "true" : undefined}
                aria-label={reason ?? name}
                data-tip={reason ?? name}
                onClick={(event) => {
                  returnFocus(event);
                  if (!isOff) onTool(tool.id);
                }}
              >
                <Icon size={15} strokeWidth={1.5} aria-hidden />
                <span className="mbtn-label" aria-hidden>
                  {name}
                </span>
              </button>
            );
          })}
          {startLink && tools.length > 0 && <span className="pick-sep" data-part="sep" aria-hidden />}
          {startLink && (
            <button type="button" className="mbtn" data-part="start" data-testid={`${testId}-start`} aria-label={t("assign.pick.start")} data-tip={t("assign.pick.start")} onClick={(event) => {
              returnFocus(event);
              onStartLink(startLink);
            }}>
              <Spline size={15} strokeWidth={1.5} aria-hidden />
              <span className="mbtn-label" aria-hidden>
                {t("assign.pick.start")}
              </span>
            </button>
          )}
          {more.length > 0 && (
            <button ref={moreRef} type="button" className="mbtn" data-part="more" data-testid={`${testId}-more`} aria-label={t("assign.pick.more")} data-tip={t("assign.pick.more")} aria-haspopup="menu" aria-expanded={hidden !== null} onClick={openMore}>
              <Ellipsis size={15} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </span>
      )}
      {hidden !== null && (
        <Menu anchorRef={moreRef} onClose={() => setHidden(null)} testId={`${testId}-more-list`} align="end" label={t("assign.pick.more")}>
          {tools.filter((tool) => hidden.includes(tool.id)).map((tool) => (
            <button key={tool.id} type="button" role="menuitem" className="menu-item" aria-disabled={busy || tool.reasonKey !== null ? "true" : undefined} data-testid={`${testId}-more-${tool.id}`} onClick={() => {
              if (busy || tool.reasonKey !== null) return;
              setHidden(null);
              onTool(tool.id);
            }}>
              {tool.reasonKey ? t(tool.reasonKey) : toolLabel(tool.id)}
            </button>
          ))}
          {more.map((id) => (
            <button key={id} type="button" role="menuitem" className="menu-item" data-testid={`${testId}-more-${id}`} onClick={() => {
              setHidden(null);
              onMore(id);
            }}>
              {id === "show_linked" ? <ListTree size={14} strokeWidth={1.5} aria-hidden /> : id === "unlink" ? <Unlink size={14} strokeWidth={1.5} aria-hidden /> : null}
              {t(MORE_KEYS[id])}
            </button>
          ))}
        </Menu>
      )}
    </div>
  );
}
