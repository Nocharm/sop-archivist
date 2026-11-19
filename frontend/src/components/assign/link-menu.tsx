// Assign 그 자리 메뉴 - 추천을 누른 곳 옆, New 문장이면 이음 선이 닿는 끝 옆(선이 없으면 누른 곳), 이동해 간 조각 옆에 뜬다. 마우스를 멀리 옮기지 않고 확정·취소·잇기·끊기를 고른다.
// Split의 "Split here" 상자처럼 조금 늦게 보인다(바로 다음 동작을 가리지 않게). 누른 요소를 따라 스크롤에 함께 움직인다.
// inline이면 떠 있지 않고 누른 New 문단 상자 안 아래에 단추 줄로 들어간다(NewPane이 펼치며 넣는다) - 눈이 누른 문단에 머문다(사용자 결정 2026-11-19).
"use client";

import { Check, Link2, Unlink, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, popEscLayer, pushEscLayer } from "@/components/ui/floating";
import type { LinkMenuItem } from "@/lib/assign-model";
import { useI18n } from "@/lib/i18n";
import { findDrawnLinkEnd } from "@/components/assign/link-lines";
import { placeLinkMenu, placeLinkMenuAtLineEnd } from "@/lib/link-menu-place";

interface LinkMenuProps {
  anchor: HTMLElement;
  /** 메뉴가 덮지 않을 상자들 - 함께 골라지는 New 짝 문장, 그 줄의 Old 조각. 비면 anchor 하나 */
  cover?: HTMLElement[];
  /** 누른 자리(요소 기준). null이면 요소 아래 왼쪽 - 이동해 와서 포인터가 먼 곳에 있을 때 */
  offset: { x: number; y: number } | null;
  /** 고른 줄의 Old 조각 - New 문장을 마우스로 눌렀고 그 조각과의 선이 그려져 있으면 메뉴를 선 끝 옆에 놓는다 */
  lineUnits?: readonly number[];
  items: LinkMenuItem[];
  /** 고르기만 하고 저장하지 않았다 */
  isUnsaved: boolean;
  /** Confirm을 막는 까닭 - 있으면 Confirm이 꺼지고 메뉴 머리에 까닭이 적힌다(결정 칸 Confirm과 같은 막기) */
  confirmBlock?: string | null;
  busy: boolean;
  onAction: (item: LinkMenuItem) => void;
  onClose: () => void;
  /** 누른 New 문단 상자 안에 단추 줄로 - 자리를 재지 않고 문서 흐름에 놓인다 */
  inline?: boolean;
}

// CSS .link-menu 등장 지연(380ms)이 끝난 뒤 포커스를 옮긴다 - 숨은 동안은 포커스를 받을 수 없다
const FOCUS_DELAY_MS = 400;
const ITEM_SELECTOR = "[role=menuitem]:not(:disabled)";

export function LinkMenu({ anchor, cover = [], offset, lineUnits = [], items, isUnsaved, confirmBlock = null, busy, onAction, onClose, inline = false }: LinkMenuProps) {
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
    if (inline) return; // 문단 상자 안에 있어 스스로 따라 움직인다
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setPos(null);
      return;
    }
    const box = menuEl.getBoundingClientRect();
    // 세로 자리는 덮지 않을 상자를 모두 합친 테두리 기준 - 함께 골라진 짝 문장을 가리지 않게(Old 우클릭 메뉴와 같은 방식)
    const boxes = [rect, ...cover.filter((el) => el !== anchor && el.isConnected).map((el) => el.getBoundingClientRect())];
    const row = { top: Math.min(...boxes.map((item) => item.top)), bottom: Math.max(...boxes.map((item) => item.bottom)), left: rect.left };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // 키보드·이동으로 열었으면(offset 없음) 선을 찾지 않는다 - 그때는 줄 왼쪽 아래 그대로
    const end = offset && anchor.matches(".new-line") ? findDrawnLinkEnd(anchor, lineUnits) : null;
    const { top, left } = end ? placeLinkMenuAtLineEnd(row, end, box, viewport) : placeLinkMenu(row, offset ? rect.left + offset.x : null, box, viewport, offset ? rect.top + offset.y : null);
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
    // 고른 직후에는 새 이음 선이 아직 안 그려졌을 수 있다 - 숨어 있던 메뉴가 나타나는 순간 한 번 더 재서 선 끝에 맞춘다
    menuEl?.addEventListener("animationstart", schedule);
    let alive = true;
    // 문단 안 단추 줄(inline)은 누른 순간 접으면 그 아래 줄이 올라와 누른 것이 다른 곳에 닿는다 - 클릭이 끝난 뒤에 닫는다.
    // 그 클릭이 다른 문단을 골라 새 메뉴를 열었으면 이 메뉴는 이미 떼어져(alive=false) 새 메뉴를 닫지 않는다
    const closeAfterClick = () => queueMicrotask(() => {
      if (alive) requestClose();
    });
    const handleDown = (event: PointerEvent) => {
      if (menuEl?.contains(event.target as Node)) return;
      if (inline) document.addEventListener("click", closeAfterClick, { once: true });
      else requestClose();
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
      menuEl?.removeEventListener("animationstart", schedule);
      popEscLayer(layer);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      alive = false;
      document.removeEventListener("pointerdown", handleDown);
      document.removeEventListener("click", closeAfterClick);
      window.removeEventListener("keydown", handleKey, true);
      // 메뉴 안에 있던 포커스는 누른 곳으로 돌린다 - 키보드 사용자가 제자리에서 이어 가게
      const active = document.activeElement;
      if (!active || active === document.body || menuEl?.contains(active)) {
        const back = anchor.matches("button") ? anchor : anchor.querySelector<HTMLElement>("button");
        back?.focus({ preventScroll: true });
      }
    };
  }, [anchor, inline]);

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

  const look: Record<LinkMenuItem, { label: string; Icon: typeof Check; className: string; tone: string; kbd?: string }> = {
    confirm: { label: t("classify.confirm"), Icon: Check, className: "btn pri h-7", tone: "primary", kbd: "↵" },
    cancel: { label: t("common.cancel"), Icon: X, className: "btn h-7", tone: "quiet", kbd: inline ? "Esc" : undefined },
    link: { label: t("assign.menu.link"), Icon: Link2, className: "btn pri h-7", tone: "primary" },
    unlink: { label: t("assign.menu.unlink"), Icon: Unlink, className: "btn h-7 link-menu-unlink", tone: "unlink" },
    close: { label: t("common.close"), Icon: X, className: "btn ghost h-7", tone: "quiet", kbd: "Esc" },
  };

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("assign.menu.label")}
      data-link-menu=""
      data-inline={inline ? "" : undefined}
      data-testid="assign-link-menu"
      className={inline ? "line-acts" : "link-menu"}
      style={inline ? undefined : pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={handleKeyDown}
      // 문단 상자 안 - 단추 줄을 눌러도 그 문단을 다시 고르지 않게
      onClick={inline ? (event) => event.stopPropagation() : undefined}
    >
      {isUnsaved && (
        <span className="link-menu-note" data-testid="assign-link-menu-unsaved">
          {t("assign.unsaved")}
        </span>
      )}
      {confirmBlock && items.includes("confirm") && (
        <span className="link-menu-note" data-testid="assign-link-menu-blocked">
          {confirmBlock}
        </span>
      )}
      <span className={inline ? "line-acts-row" : "link-menu-row"}>
        {items.map((item) => {
          const { label, Icon, className, tone, kbd } = look[item];
          return (
            <button key={item} type="button" role="menuitem" className={inline ? "strip-act" : className} data-tone={inline ? tone : undefined} disabled={(busy && item !== "close") || (item === "confirm" && confirmBlock !== null)} data-testid={`assign-link-menu-${item}`} onClick={() => onAction(item)}>
              <Icon size={inline ? 13 : 14} strokeWidth={inline ? 2 : 1.5} aria-hidden />
              {label}
              {kbd && <kbd>{kbd}</kbd>}
            </button>
          );
        })}
      </span>
    </div>
  );
  return inline ? menu : createPortal(menu, document.body);
}
