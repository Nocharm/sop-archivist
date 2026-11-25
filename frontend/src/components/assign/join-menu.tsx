// Assign 놓인 New 문장 메뉴 - 아직 안 쓴 문서에 놓인 문장을 누르면 그 줄 오른쪽 아래에 뜨는 작은 메뉴("이 문장에 잇기", 자리를 고를 수 있으면 "이 줄 다음에 놓기").
// 고르기만 하고 저장하지 않는다(결정 칸의 Confirm). 바깥을 누르거나 Esc를 누르면 닫히고, 누른 줄을 따라 스크롤에 함께 움직인다.
// inline이면 떠 있지 않고 누른 문장 상자 안 아래에 단추 줄로 들어간다(NewPane이 펼치며 넣는다, 사용자 결정 2026-11-19).
"use client";

import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, popEscLayer, pushEscLayer } from "@/components/ui/floating";
import { isMousePress } from "@/lib/assign-key-target";
import { useI18n } from "@/lib/i18n";
import { placeLinkMenu } from "@/lib/link-menu-place";

export type JoinMenuItem = "join" | "after";

interface JoinMenuProps {
  /** 누른 문장 줄 상자 */
  anchor: HTMLElement;
  /** 누른 자리(줄 기준). 없으면 줄 아래 왼쪽 */
  offset: { x: number; y: number } | null;
  /** 잇고 나면 한 문장에 든 Old 줄 수 */
  lineCount: number;
  /** 이 줄 다음에 놓기를 보일 수 있나 - 고른 줄이 이미 그 칸에 있으면 자리를 바꿀 수 없다 */
  canPlaceAfter: boolean;
  onPick: (item: JoinMenuItem, isMouse: boolean) => void;
  onClose: () => void;
  /** 누른 문장 상자 안에 단추 줄로 - 자리를 재지 않고 문서 흐름에 놓인다 */
  inline?: boolean;
}

const ITEM_SELECTOR = "[role=menuitem]:not(:disabled)";

export function JoinMenu({ anchor, offset, lineCount, canPlaceAfter, onPick, onClose, inline = false }: JoinMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const requestClose = useEffectEvent(() => onClose());

  // 자리 - 줄의 지금 위치에서 다시 잰다(스크롤·크기 변경마다 한 프레임에 한 번). 줄이 사라지면 닫고, 화면 밖이면 숨긴다
  const measure = useEffectEvent(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;
    if (!anchor.isConnected) {
      requestClose();
      return;
    }
    if (inline) return; // 문장 상자 안에 있어 스스로 따라 움직인다
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setPos(null);
      return;
    }
    const box = menuEl.getBoundingClientRect();
    const next = placeLinkMenu({ top: rect.top, bottom: rect.bottom, left: rect.left }, offset ? rect.left + offset.x : null, box, { width: window.innerWidth, height: window.innerHeight }, offset ? rect.top + offset.y : null);
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  });

  useEffect(() => {
    const layer = pushEscLayer();
    const menuEl = menuRef.current;
    let frame = requestAnimationFrame(() => measure());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    menuEl?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
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
      popEscLayer(layer);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      alive = false;
      document.removeEventListener("pointerdown", handleDown);
      document.removeEventListener("click", closeAfterClick);
      window.removeEventListener("keydown", handleKey, true);
      // 메뉴 안에 있던 포커스는 누른 줄의 단추로 돌린다 - 키보드 사용자가 제자리에서 이어 가게(고르면 페이지가 Confirm으로 옮긴다)
      const active = document.activeElement;
      if (!active || active === document.body || menuEl?.contains(active)) anchor.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    };
  }, [anchor, inline]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    // 단추 줄(inline)은 옆으로 놓여 ←→도 받는다
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

  const itemClass = inline ? "strip-act join-act" : "join-menu-item";
  const items = (
    <>
      <button type="button" role="menuitem" className={itemClass} data-tone={inline ? "primary" : undefined} data-testid="assign-join-menu-join" onClick={(event) => onPick("join", isMousePress(event))}>
        <span>{t("assign.joinMenu.join")}</span>
        <em>{t("assign.joinMenu.joinNote", { n: lineCount })}</em>
      </button>
      {canPlaceAfter && (
        <button type="button" role="menuitem" className={itemClass} data-tone={inline ? "quiet" : undefined} data-testid="assign-join-menu-after" onClick={(event) => onPick("after", isMousePress(event))}>
          <span>{t("assign.joinMenu.after")}</span>
          <em>{t("assign.joinMenu.afterNote")}</em>
        </button>
      )}
    </>
  );
  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("assign.joinMenu.label")}
      data-inline={inline ? "" : undefined}
      data-testid="assign-join-menu"
      className={inline ? "line-acts" : "join-menu"}
      style={inline ? undefined : pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={handleKeyDown}
      // 문장 상자 안 - 단추 줄을 눌러도 그 문장을 다시 누른 것으로 치지 않게
      onClick={inline ? (event) => event.stopPropagation() : undefined}
    >
      {inline ? <span className="line-acts-row">{items}</span> : items}
    </div>
  );
  return inline ? menu : createPortal(menu, document.body);
}
