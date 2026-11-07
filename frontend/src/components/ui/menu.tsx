// 트리거에 붙는 메뉴 - 위치를 잰 뒤 띄우고, 바깥 mousedown·Esc로 닫으며 닫히면 포커스를 연 곳으로 돌린다. 위·아래 화살표로 항목을 옮긴다.
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
  children: ReactNode;
}

const ITEM_SELECTOR = "[role=menuitem]:not(:disabled),[role=menuitemradio]:not(:disabled)";

export function Menu({ anchorRef, onClose, testId, align = "start", children }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    const layer = pushEscLayer();
    const anchor = anchorRef.current;
    const menuEl = menuRef.current;
    // 첫 프레임에 크기를 재고 그다음에 보인다 - 잘못된 자리에 한 번 그려졌다 옮겨 가지 않게
    const frame = requestAnimationFrame(() => {
      if (!menuEl || !anchor) return;
      setPos(placeBelow(anchor.getBoundingClientRect(), menuEl.getBoundingClientRect(), align));
      menuEl.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
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
  }, [anchorRef, align]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid={testId}
      className="menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

interface MenuRadioProps {
  checked: boolean;
  onSelect: () => void;
  testId: string;
  children: ReactNode;
}

export function MenuRadio({ checked, onSelect, testId, children }: MenuRadioProps) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} data-testid={testId} className="menu-item" onClick={onSelect}>
      {children}
      {checked && <Check size={14} strokeWidth={1.5} className="check" aria-hidden />}
    </button>
  );
}
