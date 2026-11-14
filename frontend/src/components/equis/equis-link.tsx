// 제목 옆 EQUIS 원본 링크 - 새 탭으로 연다. 서버가 평문 HTTP라 그냥 링크다(secure context API에 기대지 않는다).
"use client";

import { ExternalLink } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export function EquisLink({ href, testId }: { href: string; testId: string }) {
  const { t } = useI18n();
  return (
    <Tooltip label={t("equis.open")}>
      <a className="btn ghost icon h-6 w-6 shrink-0" href={href} target="_blank" rel="noopener noreferrer" aria-label={t("equis.open")} data-testid={testId}>
        <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
      </a>
    </Tooltip>
  );
}
