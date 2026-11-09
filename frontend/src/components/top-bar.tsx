// 상단 막대 44px - 워드마크·버전, 묶음 안이면 묶음 제목과 합성 표시, 오른쪽에 사용자 메뉴(계정·관리·레이아웃·로그아웃)와 언어 스위치. app-shell이 로그인한 모든 화면에 한 번 둔다.
"use client";

import { FlaskConical, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DevUserSwitcher } from "@/components/dev-user-switcher";
import { LangToggle } from "@/components/lang-toggle";
import { BackLink, NavProgress } from "@/components/nav-host";
import { UserMenu } from "@/components/user-menu";
import { useBundle } from "@/lib/bundle-store";
import { parseBundlePath } from "@/lib/stages";
import { getBundleLabel } from "@/lib/bundle-label";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

// next.config.ts env가 package.json version을 빌드 때 인라인한다
const APP_VERSION = process.env.APP_VERSION ?? "";

export function TopBar() {
  const { t } = useI18n();
  const { me, signOut } = useSession();
  const inBundle = parseBundlePath(usePathname());
  const { bundle } = useBundle(inBundle?.bundleId ?? null);

  return (
    <header className="tb" data-testid="top-bar">
      <Link href="/" data-testid="top-bar-service" className="tb-brand">
        SOP Archivist
      </Link>
      <span data-testid="top-bar-version" className="tb-dim font-mono text-[11px]">
        {`v${APP_VERSION}`}
      </span>
      <BackLink />
      {inBundle && (
        <>
          <span className="tb-sep" aria-hidden />
          <span data-testid="top-bar-bundle-title" className="min-w-0 truncate">
            {bundle ? getBundleLabel(bundle) : ""}
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
      <UserMenu />
      {/* 신원을 못 읽었을 때(/api/me 실패)도 로그아웃은 늘 할 수 있어야 한다 - 메뉴가 없으니 단추로 */}
      {!me && (
        <button type="button" data-testid="top-bar-signout" className="btn ghost" onClick={signOut}>
          <LogOut size={16} strokeWidth={1.5} aria-hidden />
          {t("nav.signOut")}
        </button>
      )}
      <LangToggle testId="top-bar-lang" tone="chrome" />
      <NavProgress />
    </header>
  );
}
