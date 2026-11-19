// 두 줄까지만 보이는 글 - 실제로 잘렸을 때만 툴팁(role=tooltip)에 전체 글을 띄우고, 키보드 포커스로도 닿는다.
"use client";

import { useState, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { isBoxDragActive } from "@/lib/box-drag";

interface ClampTextProps {
  /** 툴팁에 띄울 전체 글 */
  text: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** 안에 이미 포커스가 가는 링크가 있으면 false - Tab이 두 번 서지 않게 */
  tabbable?: boolean;
  /** flex 줄 안에서 툴팁 자리까지 줄어들게 한다(Tooltip shrinks) - 아니면 긴 글이 제 폭을 지켜 옆으로 넘친다 */
  shrinks?: boolean;
}

export function ClampText({ text, children, className = "", testId, tabbable = true, shrinks = false }: ClampTextProps) {
  const [isClamped, setIsClamped] = useState(false);

  // 툴팁은 150ms 뒤에 뜨므로 그 사이에 잘렸는지만 알면 된다
  function checkClamped(element: HTMLElement) {
    setIsClamped(element.scrollHeight > element.clientHeight + 1);
  }

  return (
    <Tooltip label={text} suppressed={!isClamped} align="start" shrinks={shrinks}>
      <div
        tabIndex={tabbable ? 0 : undefined}
        className={`clamp-2 ${className}`}
        data-testid={testId}
        // 상자를 끄는 동안 지나가는 글은 재지 않는다 - 포인터가 움직일 때마다 다시 그리지 않게(끌어다 놓기 G11). 툴팁도 그동안 뜨지 않는다
        onPointerEnter={(event) => {
          if (!isBoxDragActive()) checkClamped(event.currentTarget);
        }}
        onFocus={(event) => checkClamped(event.currentTarget)}
      >
        {children ?? text}
      </div>
    </Tooltip>
  );
}
