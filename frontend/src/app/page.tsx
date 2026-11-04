// 홈(자리표시) - 내가 누구인지, 어떤 권한을 가졌는지, AI를 쓸 수 있는지만 보여 준다. 제품 화면은 후속 작업.
"use client";

import { Bot, ShieldCheck, UserRound } from "lucide-react";

import { hasPermission, PERMISSIONS } from "@/lib/access";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/session";

export default function HomePage() {
  const { t, lang } = useI18n();
  const me = useMe();
  // 표시 순서는 백엔드 정렬(알파벳)이 아니라 카탈로그 순서
  const granted = PERMISSIONS.filter((key) => hasPermission(me, key));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10">
      <section data-testid="home-identity" className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <UserRound size={16} strokeWidth={1.5} className="text-gray-500" />
          {getDisplayName(me, lang)}
        </h1>
        <p className="text-sm text-gray-600">{me.login_id}</p>
        {me.dept_path ? (
          <p className="text-sm text-gray-600">{me.dept_path}</p>
        ) : (
          me.department && <p className="text-sm text-gray-600">{me.department}</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ShieldCheck size={16} strokeWidth={1.5} className="text-gray-500" />
          {t("home.permissions")}
        </h2>
        {granted.length === 0 ? (
          <p data-testid="home-permissions-empty" className="text-sm text-gray-500">
            {t("home.permissionsEmpty")}
          </p>
        ) : (
          <ul data-testid="home-permissions" className="flex flex-wrap gap-2">
            {granted.map((key) => (
              <li
                key={key}
                data-testid={`home-permission-${key}`}
                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-700"
              >
                {t(`permission.${key}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Bot size={16} strokeWidth={1.5} className="text-gray-500" />
          {t("home.ai")}
        </h2>
        <p data-testid="home-ai-status" className="text-sm text-gray-700">
          {me.ai_enabled ? t("home.aiOn") : t("home.aiOff")}
        </p>
      </section>
    </div>
  );
}
