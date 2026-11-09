// 권한 출처 한 줄(개인/부서 칩 + 대상 이름 + 역할/직접 부여) - 관리 > 권한 > 유효 권한 조회와 홈의 내 권한이 공유한다. isSelf면 개인 부여 대상을 "본인"으로 쓴다.
"use client";

import { Building2, UserRound } from "lucide-react";

import type { EffectiveSource } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { CHIP } from "@/lib/ui-classes";

export function SourceLine({ source, isSelf = false }: { source: EffectiveSource; isSelf?: boolean }) {
  const { t } = useI18n();
  const Icon = source.kind === "dept" ? Building2 : UserRound;
  const subject = isSelf && source.kind === "user" ? t("account.sourceYou") : source.subject_name || source.subject_id;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
      <span className={`${CHIP} gap-1`}>
        <Icon size={16} strokeWidth={1.5} />
        {t(`effective.source.${source.kind}`)}
      </span>
      <span>{subject}</span>
      <span className="text-ink-3">{source.role === null ? t("effective.sourceDirect") : t("effective.sourceRole", { role: source.role })}</span>
    </li>
  );
}
