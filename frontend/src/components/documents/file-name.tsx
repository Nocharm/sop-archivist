// 파일 이름 - 가운데를 폭으로 줄인다. 머리는 줄어들며 말줄임, 꼬리(마지막 12자, 확장자 포함)는 늘 보인다. 전체 이름은 툴팁(포커스로도 닿는다).
"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { splitFileName } from "@/lib/truncate-middle";

export function FileName({ name, testId, className = "" }: { name: string; testId?: string; className?: string }) {
  const [head, tail] = splitFileName(name);
  return (
    <Tooltip label={name} align="start" shrinks>
      <span className={`file-name ${className}`} tabIndex={0} data-testid={testId}>
        {head !== "" && <span className="file-name-head">{head}</span>}
        <span className="file-name-tail">{tail}</span>
      </span>
    </Tooltip>
  );
}
