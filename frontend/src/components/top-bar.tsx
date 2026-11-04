// 상단 바 - 서비스 이름·버전, 현재 사용자, 관리 링크, 언어, 로그아웃, dev 사용자 전환기. app-shell이 로그인한 모든 화면에 한 번 둔다.
"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { DevUserSwitcher } from "@/components/dev-user-switcher";
import { LangToggle } from "@/components/lang-toggle";
import { canSeeAdmin } from "@/lib/access";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

// next.config.ts env가 package.json version을 빌드 때 인라인한다
const APP_VERSION = process.env.APP_VERSION ?? "";

export function TopBar() {
  const { t, lang } = useI18n();
  const { me, signOut } = useSession();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4">
      <div className="flex items-baseline gap-2">
        <Link href="/" data-testid="top-bar-service" className="text-base font-semibold text-gray-900">
          SOP Archivist
        </Link>
        <span data-testid="top-bar-version" className="text-xs text-gray-500">
          {`v${APP_VERSION}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <DevUserSwitcher />
        {me && (
          <span data-testid="top-bar-user" className="text-sm text-gray-700">
            {getDisplayName(me, lang)}
            {me.department && <span className="text-gray-500">{` · ${me.department}`}</span>}
          </span>
        )}
        {me && canSeeAdmin(me) && (
          <Link
            href="/admin"
            data-testid="top-bar-admin-link"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <Settings size={16} strokeWidth={1.5} />
            {t("nav.admin")}
          </Link>
        )}
        <LangToggle testId="top-bar-lang" />
        <button
          type="button"
          data-testid="top-bar-signout"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100"
          onClick={signOut}
        >
          <LogOut size={16} strokeWidth={1.5} />
          {t("nav.signOut")}
        </button>
      </div>
    </header>
  );
}
