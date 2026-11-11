// 값 하나를 고르는 드롭다운 - 브라우저 기본 <select> 대신 쓴다. 떠 있는 목록은 Menu(listbox)를 같이 써서 위치·Esc·포커스 규칙이 메뉴와 같다.
// 항목 testid는 `${testId}-option-${value}`(빈 값은 `none`) - 스모크가 트리거를 누르고 이 항목을 누른다.
"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";

export interface SelectOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  /** 고정 폭 트리거에서 값이 잘릴 때 툴팁에 보일 글자(label이 노드일 때) */
  tip?: string;
}

interface SelectProps<V extends string> {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  testId: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** sm은 표 칸 안(28px), md는 폼(--ctl) */
  size?: "sm" | "md";
  /** 상단 막대처럼 어두운 바탕 위 */
  tone?: "default" | "chrome";
  mono?: boolean;
  /** 트리거 폭을 px로 고정 - 값은 말줄임(잘릴 때만 툴팁), 화살표는 늘 보인다 */
  width?: number;
  /** 폭 같은 배치만 - 모양은 .select-trigger가 정한다 */
  className?: string;
}

export function getOptionTestId(testId: string, value: string): string {
  return `${testId}-option-${value === "" ? "none" : value}`;
}

export function Select<V extends string>({
  value,
  options,
  onChange,
  testId,
  ariaLabel,
  disabled = false,
  size = "md",
  tone = "default",
  mono = false,
  width,
  className = "",
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [isClipped, setIsClipped] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  function choose(next: V) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  // 닫힌 트리거에서도 위·아래로 열린다(기본 select와 같은 손버릇)
  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  }

  const classes = ["select-trigger", size, tone === "chrome" ? "chrome" : "", mono ? "font-mono" : "", className].filter(Boolean).join(" ");

  // 고정 폭에서 값이 잘리는지는 올릴 때 잰다 - 잘릴 때만 툴팁이 뜬다
  function checkClipped() {
    const nodes = triggerRef.current?.querySelectorAll<HTMLElement>(".select-value, .select-value *") ?? [];
    setIsClipped([...nodes].some((node) => node.scrollWidth > node.clientWidth));
  }

  const tipText = selected?.tip ?? (typeof selected?.label === "string" ? selected.label : "");

  const trigger = (
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        data-fixed={width === undefined ? undefined : ""}
        style={width === undefined ? undefined : { width }}
        disabled={disabled}
        className={classes}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        onPointerEnter={width === undefined ? undefined : checkClipped}
        onFocus={width === undefined ? undefined : checkClipped}
      >
        <span className="select-value">{selected?.label ?? value}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="select-chevron" aria-hidden />
      </button>
  );

  return (
    <>
      {width === undefined ? trigger : <Tooltip label={tipText} suppressed={open || !isClipped || tipText === ""}>{trigger}</Tooltip>}
      {open && (
        <Menu anchorRef={triggerRef} onClose={() => setOpen(false)} testId={`${testId}-list`} role="listbox" matchAnchorWidth id={listId}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                data-testid={getOptionTestId(testId, option.value)}
                className={`menu-item opt${mono ? " font-mono" : ""}`}
                onClick={() => choose(option.value)}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {isSelected && <Check size={14} strokeWidth={1.5} className="check" aria-hidden />}
              </button>
            );
          })}
        </Menu>
      )}
    </>
  );
}
