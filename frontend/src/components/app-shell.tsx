// 로그인한 화면의 공통 틀 - 상단 막대 + 본문. 묶음 안이면 본문 앞에 단계 이동을 둔다. /api/me가 올 때까지(또는 실패하면) 본문 대신 로딩·오류를 보여 페이지가 me 없이 그려지지 않게 한다.
"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NavHost } from "@/components/nav-host";
import { StageNav } from "@/components/stage-nav";
import { TopBar } from "@/components/top-bar";
import { ToastHost } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { parseBundlePath } from "@/lib/stages";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { me, error, reloadMe } = useSession();
  const pathname = usePathname();
  const inBundle = parseBundlePath(pathname);

  let body: ReactNode;
  if (me) {
    // 경로가 바뀔 때마다 새로 그려 진입 전환을 한 번 탄다(같은 경로의 쿼리 변경은 그대로).
    // 사용자가 바뀌어도(dev 전환) 다시 그린다 - 앞 사용자로 불러온 원문·제안이 남아 보이지 않게
    body = (
      <div key={`${me.login_id}:${pathname}`} className="page-enter">
        {children}
      </div>
    );
  } else if (error !== null) {
    body = (
      <div data-testid="app-shell-error" className="mx-auto w-full max-w-md space-y-3 px-4 py-12 text-center">
        <p className="text-ink-2">{humanizeApiError(error, t)}</p>
        <button type="button" data-testid="app-shell-retry" className="btn" onClick={reloadMe}>
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
          {t("common.retry")}
        </button>
      </div>
    );
  } else {
    body = (
      <div data-testid="app-shell-loading" className="flex items-center justify-center gap-2 py-12 text-ink-3">
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="app">
      {me && <NavHost />}
      <TopBar />
      {inBundle && me ? (
        <div className="frame min-h-0">
          <StageNav bundleId={inBundle.bundleId} current={inBundle.stage} />
          <main className="frame-view">{body}</main>
        </div>
      ) : (
        <main className="app-main">{body}</main>
      )}
      <ToastHost />
    </div>
  );
}
