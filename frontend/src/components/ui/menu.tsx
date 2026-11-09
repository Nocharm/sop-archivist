// 트리거에 붙는 떠 있는 목록 - 메뉴(Menu)와 값 고르기(Select)가 같이 쓴다. 위치를 잰 뒤 띄우고, 바깥 mousedown·Esc·Tab으로 닫으며
// 닫히면 포커스를 연 곳으로 돌린다. 위·아래·Home·End로 항목을 옮기고 글자를 치면 그 글자로 시작하는 항목으로 간다.
"use client";

import { Check } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";

interface MenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  testId: string;
  align?: "start" | "end";
  /** listbox는 Select가 쓴다 - 항목이 role=option이고 고른 항목에서 포커스를 시작한다 */
  role?: "menu" | "listbox";
  /** 목록 폭을 트리거 폭 이상으로 맞춘다(Select) */
  matchAnchorWidth?: boolean;
  id?: string;
  children: ReactNode;
}

const ITEM_SELECTOR = "[role=menuitem]:not(:disabled),[role=menuitemradio]:not(:disabled),[role=option]:not(:disabled)";
const TYPEAHEAD_RESET_MS = 600; // 이 시간 안에 친 글자는 이어서 찾는다

export function Menu({ anchorRef, onClose, testId, align = "start", role = "menu", matchAnchorWidth = false, id, children }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined);
  const typeahead = useRef({ text: "", at: 0 });
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    const layer = pushEscLayer();
    const anchor = anchorRef.current;
    const menuEl = menuRef.current;
    // 첫 프레임에 크기를 재고 그다음에 보인다 - 잘못된 자리에 한 번 그려졌다 옮겨 가지 않게
    const frame = requestAnimationFrame(() => {
      if (!menuEl || !anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();
      const width = matchAnchorWidth ? Math.max(menuRect.width, anchorRect.width) : menuRect.width;
      if (matchAnchorWidth) setMinWidth(anchorRect.width);
      setPos(placeBelow(anchorRect, { width, height: menuRect.height }, align));
      // 고른 항목이 있으면 거기서 시작한다 - 긴 목록에서도 지금 값이 보이게
      const start = menuEl.querySelector<HTMLElement>("[aria-selected=true]:not(:disabled)") ?? menuEl.querySelector<HTMLElement>(ITEM_SELECTOR);
      start?.focus({ preventScroll: true });
      start?.scrollIntoView({ block: "nearest" });
    });
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuEl?.contains(target) || anchor?.contains(target)) return;
      requestClose();
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && isTopEscLayer(layer)) {
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      popEscLayer(layer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      // 키보드 사용자가 제자리로 돌아오게 - 다른 곳을 눌러 닫았으면 그 포커스를 뺏지 않는다
      if (!document.activeElement || document.activeElement === document.body || menuEl?.contains(document.activeElement)) {
        anchor?.focus({ preventScroll: true });
      }
    };
  }, [anchorRef, align, matchAnchorWidth]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") {
      // 목록 안에서 Tab으로 돌지 않는다 - 닫고 다음 칸으로 간다
      onClose();
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      next = findTypeaheadIndex(items, index, event.key);
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: "nearest" });
  }

  function findTypeaheadIndex(items: HTMLElement[], index: number, key: string): number | null {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at < TYPEAHEAD_RESET_MS ? state.text + key.toLowerCase() : key.toLowerCase();
    state.at = now;
    // 같은 글자를 거듭 치면 그 글자로 시작하는 다음 항목으로 돈다
    const isRepeat = state.text.length > 1 && [...state.text].every((char) => char === state.text[0]);
    const needle = isRepeat ? state.text[0] : state.text;
    const startAt = isRepeat || state.text.length === 1 ? index + 1 : index;
    for (let step = 0; step < items.length; step += 1) {
      const candidate = (startAt + step) % items.length;
      if ((items[candidate].textContent ?? "").trim().toLowerCase().startsWith(needle)) return candidate;
    }
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role={role}
      data-testid={testId}
      className="menu"
      style={{ ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }), minWidth }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

interface MenuRadioProps {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  testId: string;
  children: ReactNode;
}

export function MenuRadio({ checked, disabled = false, onSelect, testId, children }: MenuRadioProps) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} disabled={disabled} data-testid={testId} className="menu-item" onClick={onSelect}>
      {children}
      {checked && <Check size={14} strokeWidth={1.5} className="check" aria-hidden />}
    </button>
  );
}
