// Assign 그 자리 메뉴 - 추천·New 문장을 누른 곳 옆이나 이동해 간 조각 옆에 뜬다. 마우스를 멀리 옮기지 않고 확정·취소·잇기·끊기를 고른다.
// Split의 "Split here" 상자처럼 조금 늦게 보인다(바로 다음 동작을 가리지 않게). 누른 요소를 따라 스크롤에 함께 움직인다.
"use client";

import { Check, Link2, Unlink, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, popEscLayer, pushEscLayer } from "@/components/ui/floating";
import type { LinkMenuItem } from "@/lib/assign-model";
import { useI18n } from "@/lib/i18n";

interface LinkMenuProps {
  anchor: HTMLElement;
  /** 누른 자리(요소 기준). null이면 요소 아래 왼쪽 - 이동해 와서 포인터가 먼 곳에 있을 때 */
  offset: { x: number; y: number } | null;
  items: LinkMenuItem[];
  /** 고르기만 하고 저장하지 않았다 */
  isUnsaved: boolean;
  busy: boolean;
  onAction: (item: LinkMenuItem) => void;
  onClose: () => void;
}

const EDGE = 8; // 화면 가장자리와 띄울 최소 간격(px)
const GAP = 10; // 누른 자리와 메뉴 사이(px)
const NAV_INDENT = 24; // 이동해 온 조각에서 메뉴를 들여 놓는 폭(px) - 조각 앞 KO/EN 태그를 가리지 않게
// CSS .link-menu 등장 지연(380ms)이 끝난 뒤 포커스를 옮긴다 - 숨은 동안은 포커스를 받을 수 없다
const FOCUS_DELAY_MS = 400;
const ITEM_SELECTOR = "[role=menuitem]:not(:disabled)";

export function LinkMenu({ anchor, offset, items, isUnsaved, busy, onAction, onClose }: LinkMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const requestClose = useEffectEvent(() => onClose());

  // 자리 - 요소의 지금 위치에서 다시 잰다(스크롤·크기 변경마다 한 프레임에 한 번). 요소가 화면 밖으로 나가면 숨긴다
  const measure = useEffectEvent(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;
    if (!anchor.isConnected) {
      requestClose();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setPos(null);
      return;
    }
    const box = menuEl.getBoundingClientRect();
    const x = offset ? rect.left + offset.x - 16 : rect.left + NAV_INDENT;
    const y = offset ? rect.top + offset.y : rect.bottom;
    const left = Math.min(Math.max(x, EDGE), window.innerWidth - box.width - EDGE);
    let top = y + GAP;
    if (top + box.height > window.innerHeight - EDGE) top = (offset ? rect.top + offset.y : rect.top) - GAP - box.height;
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  });

  useEffect(() => {
    const layer = pushEscLayer();
    const menuEl = menuRef.current;
    let frame = requestAnimationFrame(() => measure());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const focusFirst = () => {
      if (!menuEl?.contains(document.activeElement)) menuEl?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    };
    const focusTimer = window.setTimeout(focusFirst, FOCUS_DELAY_MS);
    // 화면이 바쁘면 등장 애니메이션이 늦게 시작해 400ms에 아직 숨어 있을 수 있다 - 그때는 포커스가 안 들어가므로 다 나타난 뒤에 한 번 더
    menuEl?.addEventListener("animationend", focusFirst);
    const handleDown = (event: PointerEvent) => {
      if (!menuEl?.contains(event.target as Node)) requestClose();
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopEscLayer(layer)) return;
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("pointerdown", handleDown);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(focusTimer);
      menuEl?.removeEventListener("animationend", focusFirst);
      popEscLayer(layer);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("keydown", handleKey, true);
      // 메뉴 안에 있던 포커스는 누른 곳으로 돌린다 - 키보드 사용자가 제자리에서 이어 가게
      const active = document.activeElement;
      if (!active || active === document.body || menuEl?.contains(active)) {
        const back = anchor.matches("button") ? anchor : anchor.querySelector<HTMLElement>("button");
        back?.focus({ preventScroll: true });
      }
    };
  }, [anchor]);

  // 항목이 바뀌면(잇기 → 확정) 크기가 달라진다
  useEffect(() => {
    const frame = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(frame);
  }, [items, isUnsaved]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % list.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
    else if (event.key === "Tab") {
      onClose();
      return;
    }
    // 화면 단축키(↑↓ 줄 옮기기 등)가 메뉴 안의 키를 받지 않게
    event.stopPropagation();
    if (next === null || list.length === 0) return;
    event.preventDefault();
    list[next]?.focus();
  }

  const look: Record<LinkMenuItem, { label: string; Icon: typeof Check; className: string; kbd?: string }> = {
    confirm: { label: t("classify.confirm"), Icon: Check, className: "btn pri h-7", kbd: "↵" },
    cancel: { label: t("common.cancel"), Icon: X, className: "btn h-7" },
    link: { label: t("assign.menu.link"), Icon: Link2, className: "btn pri h-7" },
    unlink: { label: t("assign.menu.unlink"), Icon: Unlink, className: "btn h-7 link-menu-unlink" },
    close: { label: t("common.close"), Icon: X, className: "btn ghost h-7", kbd: "Esc" },
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("assign.menu.label")}
      data-link-menu=""
      data-testid="assign-link-menu"
      className="link-menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={handleKeyDown}
    >
      {isUnsaved && (
        <span className="link-menu-note" data-testid="assign-link-menu-unsaved">
          {t("assign.unsaved")}
        </span>
      )}
      <span className="link-menu-row">
        {items.map((item) => {
          const { label, Icon, className, kbd } = look[item];
          return (
            <button key={item} type="button" role="menuitem" className={className} disabled={busy && item !== "close"} data-testid={`assign-link-menu-${item}`} onClick={() => onAction(item)}>
              <Icon size={14} strokeWidth={1.5} aria-hidden />
              {label}
              {kbd && <kbd>{kbd}</kbd>}
            </button>
          );
        })}
      </span>
    </div>,
    document.body,
  );
}
