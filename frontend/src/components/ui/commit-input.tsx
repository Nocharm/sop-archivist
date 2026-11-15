// 떠나거나 Enter를 누르면 저장되는 글 입력 - 치는 동안은 제 값을 들고, 저장된 값이 밖에서 바뀌면(다시 받음) 그 값을 따라간다.
// Esc는 고친 것을 버린다. 값이 그대로면 저장하지 않는다. Save 단추 없이 칸마다 저장하는 목록이 쓴다.
"use client";

import { useState, type KeyboardEvent } from "react";

interface CommitInputProps {
  value: string;
  /** 떠나거나 Enter - 값이 바뀌었을 때만 불린다(앞뒤 공백은 걷어 낸 값). 저장이 거절됐으면 false를 돌려준다 - 칸이 저장된 값으로 돌아간다 */
  onCommit: (next: string) => void | Promise<boolean>;
  className?: string;
  testId: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** 떠났는데 비어 있다 - 비어 있으면 안 되는 칸이 거둘 때 쓴다(없으면 빈 값도 저장한다) */
  onEmpty?: () => void;
}

export function CommitInput({ value, onCommit, className, testId, placeholder, maxLength, disabled, ariaLabel, autoFocus, onEmpty }: CommitInputProps) {
  const [text, setText] = useState(value);
  // 저장된 값이 바뀌면 그 값으로 - 렌더 중 상태 맞추기
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }

  function commit() {
    const next = text.trim();
    if (next === "" && onEmpty) {
      setText(value);
      onEmpty();
      return;
    }
    if (next === value) {
      if (text !== value) setText(value);
      return;
    }
    // 거절되면 저장된 값은 그대로라 밖에서 바뀌는 것이 없다 - 여기서 적던 글을 거둔다
    void Promise.resolve(onCommit(next)).then((isSaved) => {
      if (isSaved === false) setText(value);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    else if (event.key === "Escape" && text !== value) {
      // 고친 것만 버린다 - 그대로면 Esc는 바깥(창 닫기 등)의 것이다
      event.stopPropagation();
      setText(value);
    }
  }

  return (
    <input
      className={className}
      data-testid={testId}
      value={text}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
