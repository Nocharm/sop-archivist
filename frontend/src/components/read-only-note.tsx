// 읽기 전용 알림 - 편집 단추가 사라진 화면의 머리글에 "왜 못 고치는지"를 한 줄로 둔다(검토 대기·검토 완료·검토자).
"use client";

import { Lock } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import type { BundleStatus, MemberRole } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { getReadOnlyReason } from "@/lib/read-only";

interface ReadOnlyNoteProps {
  bundle: { status: BundleStatus; my_role: MemberRole | null } | null;
  /** 화면 이름 - `<testId>-readonly`가 된다 */
  testId: string;
}

export function ReadOnlyNote({ bundle, testId }: ReadOnlyNoteProps) {
  const { t } = useI18n();
  const reason = getReadOnlyReason(bundle);
  if (reason === null) return null;
  return (
    <Tooltip label={t(`readonly.${reason}.body`)}>
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-ink-3" tabIndex={0} data-testid={`${testId}-readonly`}>
        <Lock size={12} strokeWidth={1.5} aria-hidden />
        {t(`readonly.${reason}`)}
      </span>
    </Tooltip>
  );
}
