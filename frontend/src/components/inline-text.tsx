// 표 칸 안에서 바로 고치는 짧은 글 - 빈 값은 점선 칩으로 같은 자리를 차지하고, 누르면 입력이 된다. Enter·바깥 누름은 저장, Esc는 취소.
"use client";

import { useState, type KeyboardEvent } from "react";

import { Truncate } from "@/components/ui/motion";

// 보기·빈 칩·입력이 같은 상자다(높이 24, 테두리 1, 좌우 6) - 눌러 고치기로 바뀌어도 글자 자리와 칸 폭이 그대로다
const BOX = "block h-6 max-w-full rounded-sm border px-1.5 text-left text-[13px] leading-[22px]";

interface InlineTextProps {
  value: string;
  placeholder: string;
  /** 고칠 수 없으면 글자만(빈 값은 –) */
  editable: boolean;
  testId: string;
  mono?: boolean;
  maxLength: number;
  /** 저장 - 실패하면 throw. 입력은 그대로 열려 있다 */
  onSave: (next: string) => Promise<void>;
  /** 상자 폭(px) 또는 칸 폭 채우기 - 보기와 고치기가 같은 폭이라 옆 칸이 밀리지 않는다 */
  width: number | "fill";
}

export function InlineText({ value, placeholder, editable, testId, mono = false, maxLength, onSave, width }: InlineTextProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const font = mono ? "font-mono" : "";
  const fill = width === "fill" ? "w-full" : "";
  const style = width === "fill" ? undefined : { width };

  if (!editable) {
    return value ? (
      <span className={font} data-testid={testId}>
        {value}
      </span>
    ) : (
      <span className="text-ink-4" data-testid={testId}>
        –
      </span>
    );
  }

  async function commit() {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (next === value) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setDraft(null);
    } catch {
      // 호출한 쪽이 알림을 띄운다 - 입력은 열어 두어 다시 고칠 수 있게
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setDraft(null);
    }
  }

  if (draft !== null) {
    return (
      <input
        data-testid={`${testId}-input`}
        className={`${BOX} border-focus bg-surface text-ink outline-none ${font} ${fill}`}
        style={style}
        value={draft}
        maxLength={maxLength}
        autoFocus
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit()}
      />
    );
  }

  return value ? (
    <button
      type="button"
      data-testid={testId}
      className={`${BOX} border-transparent hover:bg-hover ${font} ${fill}`}
      style={style}
      onClick={() => setDraft(value)}
    >
      {/* one-line: 카드 제목의 두 줄 자르기에서 빼서 상자 높이를 지킨다 */}
      <Truncate text={value} className="one-line" />
    </button>
  ) : (
    <button
      type="button"
      data-testid={testId}
      className={`${BOX} overflow-hidden whitespace-nowrap border-dashed border-line-2 text-xs text-ink-3 hover:bg-hover ${fill}`}
      style={style}
      onClick={() => setDraft("")}
    >
      {placeholder}
    </button>
  );
}
