// 글을 치면서 고르는 칸 - 입력 칸 아래에 추천 목록이 뜬다. 친 글을 그대로 쓸 수도 있다(Select는 정해진 값만, 이것은 자유 입력 + 추천).
// 포커스는 입력 칸에 남고 ↑↓가 목록의 활성 항목(aria-activedescendant)을 옮긴다. Enter는 활성 항목을 고르고, Esc는 목록만 닫는다.
// 항목 testid는 `${testId}-option-${value}`(Select와 같다), 친 글 그대로 쓰기는 `${testId}-option-typed`.
"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";
import { getOptionTestId } from "@/components/ui/select";

export interface ComboboxOption {
  value: string;
  label: ReactNode;
  /** 오른쪽·아래의 보조 글(제목·출처) */
  hint?: ReactNode;
}

interface ComboboxProps {
  value: string;
  onChange: (text: string) => void;
  options: readonly ComboboxOption[];
  testId: string;
  ariaLabel: string;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  /** 친 글이 항목과 다를 때 맨 위에 두는 "그대로 쓰기" 항목의 글 - 없으면 그 항목을 두지 않는다 */
  typedLabel?: (text: string) => ReactNode;
  /** 항목이 하나도 없을 때의 안내(불러오는 중 포함) */
  emptyLabel?: string;
}

const MIN_LIST_WIDTH = 280; // 목록 최소 폭(px)
const TYPED = "\u0000typed"; // 그대로 쓰기 항목의 내부 값 - 실제 값과 겹치지 않는다

export function Combobox({ value, onChange, options, testId, ariaLabel, placeholder, mono = false, disabled = false, maxLength, autoFocus = false, typedLabel, emptyLabel }: ComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<(FloatingPos & { width: number }) | null>(null);

  const typed = value.trim();
  const showTyped = typedLabel !== undefined && typed !== "" && !options.some((option) => option.value === typed);
  const entries = [...(showTyped ? [{ value: TYPED, label: typedLabel(typed) }] : []), ...options];
  const activeIndex = active < entries.length ? active : -1;

  function choose(entry: ComboboxOption) {
    onChange(entry.value === TYPED ? typed : entry.value);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (entries.length > 0) setActive((activeIndex + step + entries.length) % entries.length);
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(entries[activeIndex]);
    } else if (event.key === "Tab") setOpen(false);
  }

  // 목록 자리 - 열려 있는 동안 스크롤·크기 변경마다 입력 칸 아래로 다시 맞춘다
  const measure = useEffectEvent(() => {
    const input = inputRef.current;
    const list = listRef.current;
    if (!input || !list) return;
    const rect = input.getBoundingClientRect();
    // 좁은 칸(옆 패널)에서도 코드와 보조 글이 한 줄씩 들어가게 - 입력 칸보다 좁아지지 않고, 화면 안으로 맞춘다
    const width = Math.min(Math.max(rect.width, MIN_LIST_WIDTH), window.innerWidth - 16);
    const next = placeBelow(rect, { width, height: list.getBoundingClientRect().height }, "end");
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === width ? prev : { ...next, width }));
  });
  const requestClose = useEffectEvent(() => setOpen(false));
  const isListed = open && entries.length + (emptyLabel ? 1 : 0) > 0;
  useEffect(() => {
    if (!isListed) return;
    // 목록이 떠 있는 동안 Esc는 목록만 닫는다 - 감싼 창(Modal)이 먼저 닫히지 않게 맨 위 층으로 쌓는다
    const layer = pushEscLayer();
    let frame = requestAnimationFrame(() => measure());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopEscLayer(layer)) return;
      event.stopPropagation();
      requestClose();
    };
    const handleDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !inputRef.current?.contains(target)) requestClose();
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("keydown", handleKey, true);
    document.addEventListener("mousedown", handleDown);
    return () => {
      cancelAnimationFrame(frame);
      popEscLayer(layer);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("mousedown", handleDown);
    };
  }, [isListed]);

  // 항목 수가 바뀌면 높이가 달라진다(위로 뒤집힌 목록이 입력 칸에서 떨어지지 않게)
  useEffect(() => {
    if (!isListed) return;
    const frame = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(frame);
  }, [isListed, entries.length]);

  // 활성 항목이 보이게
  useEffect(() => {
    if (activeIndex >= 0) listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={isListed}
        aria-controls={isListed ? listId : undefined}
        aria-activedescendant={isListed && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        data-testid={testId}
        className={`combo-input${mono ? " font-mono" : ""}`}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        // 창이 열리며 첫 칸으로 이 입력을 고를 때 - 창(Modal)이 포커스를 옮겨 준다
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isListed &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            data-testid={`${testId}-list`}
            className="menu combo-list"
            style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {entries.length === 0 && <p className="menu-label">{emptyLabel}</p>}
            {entries.map((entry, index) => (
              <div
                key={entry.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex ? "" : undefined}
                data-testid={entry.value === TYPED ? `${testId}-option-typed` : getOptionTestId(testId, entry.value)}
                className="menu-item opt combo-option"
                // 입력 칸의 포커스를 지킨다 - 누르는 순간 blur로 목록이 닫히지 않게
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(entry)}
              >
                <span className={`min-w-0 flex-1 ${mono && entry.value !== TYPED ? "font-mono" : ""}`}>{entry.label}</span>
                {"hint" in entry && entry.hint && <span className="combo-hint">{entry.hint}</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
