// 상단 막대 44px - 워드마크·버전, 묶음 안이면 묶음 제목과 합성 표시, 오른쪽에 사용자 메뉴(계정·관리·레이아웃·로그아웃)와 언어 스위치. app-shell이 로그인한 모든 화면에 한 번 둔다.
"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DevUserSwitcher } from "@/components/dev-user-switcher";
import { LangToggle } from "@/components/lang-toggle";
import { BackLink, NavProgress } from "@/components/nav-host";
import { UserMenu } from "@/components/user-menu";
import { useBundle } from "@/lib/bundle-store";
import { parseBundlePath } from "@/lib/stages";

// next.config.ts env가 package.json version을 빌드 때 인라인한다
const APP_VERSION = process.env.APP_VERSION ?? "";

export function TopBar() {
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
      <UserMenu />
      <LangToggle testId="top-bar-lang" tone="chrome" />
      <NavProgress />
    </header>
  );
}
