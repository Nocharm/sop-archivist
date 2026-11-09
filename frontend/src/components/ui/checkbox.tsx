// 체크박스 - 숨긴 네이티브 입력 위에 토큰으로 네모를 그린다. 키보드·스크린리더는 네이티브 입력을 그대로 쓰고, 브라우저 기본 모양은 보이지 않는다.
"use client";

import { Check, Minus } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, testId, label, ariaLabel, disabled = false, indeterminate = false, className = "" }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // indeterminate는 속성이 아니라 DOM 프로퍼티라 렌더 뒤에 맞춘다
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={`cbx ${disabled ? "is-disabled" : ""} ${className}`}>
      <input
        ref={inputRef}
        type="checkbox"
        className="cbx-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cbx-box" aria-hidden>
        {indeterminate ? <Minus size={12} strokeWidth={2.5} /> : checked && <Check size={12} strokeWidth={2.5} />}
      </span>
      {label !== undefined && <span className="cbx-label">{label}</span>}
    </label>
  );
}
