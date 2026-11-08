// 상단 막대 44px - 워드마크·버전, 묶음 안이면 묶음 제목과 합성 표시, 오른쪽에 사용자·배치·언어·관리·로그아웃(디자인 문서 8절). app-shell이 로그인한 모든 화면에 한 번 둔다.
"use client";

import { FlaskConical, Languages, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DevUserSwitcher } from "@/components/dev-user-switcher";
import { LayoutMenu } from "@/components/layout-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { canSeeAdmin } from "@/lib/access";
import { useBundle } from "@/lib/bundle-store";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { parseBundlePath } from "@/lib/stages";

// next.config.ts env가 package.json version을 빌드 때 인라인한다
const APP_VERSION = process.env.APP_VERSION ?? "";

export function TopBar() {
  const { t, lang, setLang } = useI18n();
  const { me, signOut } = useSession();
  const inBundle = parseBundlePath(usePathname());
  const { bundle } = useBundle(inBundle?.bundleId ?? null);
  const nextLang = lang === "ko" ? "en" : "ko";

  return (
    <header className="tb" data-testid="top-bar">
      <Link href="/" data-testid="top-bar-service" className="tb-brand">
        SOP Archivist
      </Link>
      <span data-testid="top-bar-version" className="tb-dim font-mono text-[11px]">
        {`v${APP_VERSION}`}
      </span>
      {inBundle && (
        <>
          <span className="tb-sep" aria-hidden />
          <span data-testid="top-bar-bundle-title" className="min-w-0 truncate">
            {bundle?.title ?? ""}
          </span>
          {bundle?.is_synthetic && (
            <span data-testid="top-bar-synthetic" className="tag">
              <FlaskConical size={12} strokeWidth={1.5} aria-hidden />
              Synthetic data
            </span>
          )}
        </>
      )}
      <span className="flex-1" />
      <DevUserSwitcher />
      {me && (
        <Link href="/account" data-testid="top-bar-user" className="whitespace-nowrap rounded-md px-1 hover:underline">
          {getDisplayName(me, lang)}
          {me.department && <span className="tb-dim">{` · ${me.department}`}</span>}
        </Link>
      )}
      <LayoutMenu />
      <button
        type="button"
        data-testid="top-bar-lang"
        className="btn ghost"
        aria-label={t("nav.langSwitch")}
        onClick={() => setLang(nextLang)}
      >
        <Languages size={16} strokeWidth={1.5} aria-hidden />
        {nextLang === "ko" ? "한국어" : "English"}
      </button>
      {me && canSeeAdmin(me) && (
        <Tooltip label={t("nav.admin")} align="end">
          <Link href="/admin" data-testid="top-bar-admin-link" className="btn ghost icon" aria-label={t("nav.admin")}>
            <Settings size={16} strokeWidth={1.5} aria-hidden />
          </Link>
        </Tooltip>
      )}
      <Tooltip label={t("nav.signOut")} align="end">
        <button type="button" data-testid="top-bar-signout" className="btn ghost icon" aria-label={t("nav.signOut")} onClick={signOut}>
          <LogOut size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
    </header>
  );
}
