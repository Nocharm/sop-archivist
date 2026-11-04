// 로그인한 화면의 공통 틀 - 상단 바 + 본문. /api/me가 올 때까지(또는 실패하면) 본문 대신 로딩·오류를 보여 페이지가 me 없이 그려지지 않게 한다.
"use client";

import { Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { TopBar } from "@/components/top-bar";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { me, error, reloadMe } = useSession();

  let body: ReactNode;
  if (me) {
    body = children;
  } else if (error !== null) {
    body = (
      <div data-testid="app-shell-error" className="mx-auto w-full max-w-md space-y-3 px-4 py-12 text-center">
        <p className="text-sm text-gray-700">{humanizeApiError(error, t)}</p>
        <button
          type="button"
          data-testid="app-shell-retry"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
          onClick={reloadMe}
        >
          <RefreshCw size={16} strokeWidth={1.5} />
          {t("common.retry")}
        </button>
      </div>
    );
  } else {
    body = (
      <div data-testid="app-shell-loading" className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex flex-1 flex-col">{body}</main>
    </div>
  );
}
