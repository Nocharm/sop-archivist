// 패널 안의 한 줄 안내·오류 상자 - 관리 패널과 모달 폼이 공유한다. 오류는 사람 말 문구만 받는다(원문은 humanizeApiError가 이미 걸렀다).
import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";

interface InlineNoticeProps {
  testId: string;
  tone: "error" | "info";
  children: ReactNode;
}

export function InlineNotice({ testId, tone, children }: InlineNoticeProps) {
  const Icon = tone === "error" ? CircleAlert : Info;
  return (
    <div
      data-testid={testId}
      role={tone === "error" ? "alert" : "status"}
      className="flex items-start gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
    >
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-gray-500" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
