// 정보 아이콘 - 개념 설명을 본문 문단 대신 이름 옆 (i)에 숨긴다. 호버·키보드 포커스 때 Tooltip으로 보인다.
"use client";

import { Info } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";

export function InfoTip({ text, testId, align = "start" }: { text: string; testId: string; align?: "start" | "end" | "center" }) {
  return (
    <Tooltip label={text} align={align}>
      <span className="info-tip" tabIndex={0} role="img" aria-label={text} data-testid={testId}>
        <Info size={14} strokeWidth={1.5} aria-hidden />
      </span>
    </Tooltip>
  );
}
