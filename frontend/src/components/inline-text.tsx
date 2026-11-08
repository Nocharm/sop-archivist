// 표 칸 안에서 바로 고치는 짧은 글 - 빈 값은 점선 칩으로 같은 자리를 차지하고, 누르면 입력이 된다. Enter·바깥 누름은 저장, Esc는 취소.
"use client";

import { useState, type KeyboardEvent } from "react";

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
  /** 입력 폭(px) - 보기와 고치기가 같은 폭이라 옆 칸이 밀리지 않는다 */
  width: number;
}

export function InlineText({ value, placeholder, editable, testId, mono = false, maxLength, onSave, width }: InlineTextProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const font = mono ? "font-mono" : "";

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
        className={`h-6 rounded-sm border border-focus bg-surface px-1.5 text-[13px] text-ink outline-none ${font}`}
        style={{ width }}
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
      className={`max-w-full truncate rounded-sm px-1 text-left hover:bg-hover ${font}`}
      style={{ minWidth: 24 }}
      onClick={() => setDraft(value)}
    >
      {value}
    </button>
  ) : (
    <button
      type="button"
      data-testid={testId}
      className="h-6 whitespace-nowrap rounded-sm border border-dashed border-line-2 px-1.5 text-xs text-ink-3 hover:bg-hover"
      onClick={() => setDraft("")}
    >
      {placeholder}
    </button>
  );
}
