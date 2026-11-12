// 두 줄까지만 보이는 글 - 실제로 잘렸을 때만 툴팁(role=tooltip)에 전체 글을 띄우고, 키보드 포커스로도 닿는다.
"use client";

import { useState, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";

interface ClampTextProps {
  /** 툴팁에 띄울 전체 글 */
  text: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** 안에 이미 포커스가 가는 링크가 있으면 false - Tab이 두 번 서지 않게 */
  tabbable?: boolean;
}

export function ClampText({ text, children, className = "", testId, tabbable = true }: ClampTextProps) {
  const [isClamped, setIsClamped] = useState(false);

  // 툴팁은 150ms 뒤에 뜨므로 그 사이에 잘렸는지만 알면 된다
  function checkClamped(element: HTMLElement) {
    setIsClamped(element.scrollHeight > element.clientHeight + 1);
  }

  return (
    <Tooltip label={text} suppressed={!isClamped} align="start">
      <div
        tabIndex={tabbable ? 0 : undefined}
        className={`clamp-2 ${className}`}
        data-testid={testId}
        onPointerEnter={(event) => checkClamped(event.currentTarget)}
        onFocus={(event) => checkClamped(event.currentTarget)}
      >
        {children ?? text}
      </div>
    </Tooltip>
  );
}
