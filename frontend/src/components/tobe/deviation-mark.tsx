// SOP 절 이름 뒤의 알림 표시 둘 - "표준과 다름"(표준 골격에서 벗어난 절: 사용자 항목 · 이름을 바꾸거나 뺀 표준 항목. 아이콘만이라 사유는 툴팁, 포커스로도 닿는다)과
// "비어 있음"(필수 절인데 비었다). 둘 다 알림일 뿐 검토 요청을 막지 않는다. Documents의 칸 상태 표 · 결과물 C · Assign New 칸의 절 머리가 같은 표시를 쓴다
"use client";

import { GitFork } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export function DeviationMark({ reason, testId }: { reason: string | null; testId: string }): ReactNode {
  const { t } = useI18n();
  return (
    <Tooltip label={reason ? t("tobe.outline.differsReason", { reason }) : t("tobe.outline.differs")} align="start">
      <span className="slot-dev" role="img" tabIndex={0} aria-label={t("tobe.outline.differs")} data-testid={testId}>
        <GitFork size={12} strokeWidth={1.5} aria-hidden />
      </span>
    </Tooltip>
  );
}

export function EmptyRequiredMark({ testId }: { testId: string }): ReactNode {
  const { t } = useI18n();
  return (
    <Tooltip label={t("outputs.emptyRequiredTip")} align="start">
      <span className="pill warn empty-required" tabIndex={0} data-testid={testId}>
        {t("outputs.emptyRequired")}
      </span>
    </Tooltip>
  );
}
