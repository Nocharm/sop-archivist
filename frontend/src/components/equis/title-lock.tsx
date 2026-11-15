// 잠긴 제목 표시 - EQUIS에 있는 문서의 제목은 EQUIS가 정한다. 연필이 있던 자리에 같은 크기로 서고, 포커스로도 이유를 읽는다.
"use client";

import { Lock } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export function TitleLock({ testId }: { testId: string }) {
  const { t } = useI18n();
  return (
    <Tooltip label={t("equis.titleLocked")}>
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-ink-4" tabIndex={0} role="img" aria-label={t("equis.titleLocked")} data-testid={testId}>
        <Lock size={13} strokeWidth={1.5} aria-hidden />
      </span>
    </Tooltip>
  );
}
