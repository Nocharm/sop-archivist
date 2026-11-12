// 내 계정 - 내가 누구인지, 어떤 권한을 어디서(역할·부서·직접) 받았는지, AI를 쓸 수 있는지. 상단 막대의 이름을 누르면 온다(홈은 묶음 목록).
"use client";

import { Bot, KeyRound, ShieldCheck } from "lucide-react";

import { formatSourceText } from "@/components/permission-source-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { hasPermission, PERMISSIONS } from "@/lib/access";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/session";

export default function AccountPage() {
  const { t, lang } = useI18n();
  const me = useMe();
  // 표시 순서는 백엔드 정렬(알파벳)이 아니라 카탈로그 순서
  const granted = PERMISSIONS.filter((key) => hasPermission(me, key));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10">
      <section data-testid="account-identity" className="space-y-1">
        <h1 className="page-title ul w-fit">{getDisplayName(me, lang)}</h1>
        <p className="text-sm text-ink-2">{me.login_id}</p>
        {me.dept_path ? (
          <p className="text-sm text-ink-2">{me.dept_path}</p>
        ) : (
          me.department && <p className="text-sm text-ink-2">{me.department}</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck size={16} strokeWidth={1.5} className="text-ink-3" />
          {t("account.permissions")}
        </h2>
        {granted.length === 0 ? (
          <EmptyState icon={KeyRound} testId="account-permissions-empty" title={t("account.permissionsEmpty")} compact />
        ) : (
          <ul data-testid="account-permissions" className="divide-y divide-line border-y border-line">
            {granted.map((key) => {
              const sources = me.sources[key] ?? [];
              const sourcesText = sources.map((source) => formatSourceText(t, source, true)).join("\n");
              return (
                <li
                  key={key}
                  data-testid={`account-permission-${key}`}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="min-w-0 text-sm font-semibold text-ink">{t(`permission.${key}`)}</div>
                  {sources.length > 0 && (
                    <Tooltip label={sourcesText} align="end">
                      <span
                        tabIndex={0}
                        role="note"
                        aria-label={`${t("account.sources", { n: sources.length })}: ${sourcesText.replace(/\n/g, "; ")}`}
                        data-testid={`account-permission-source-${key}`}
                        className="tag shrink-0 cursor-default"
                      >
                        {t("account.sources", { n: sources.length })}
                      </span>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Bot size={16} strokeWidth={1.5} className="text-ink-3" />
          {t("account.ai")}
        </h2>
        <p data-testid="account-ai-status" className="text-sm text-ink-2">
          {me.ai_enabled ? t("account.aiOn") : t("account.aiOff")}
        </p>
      </section>
    </div>
  );
}
