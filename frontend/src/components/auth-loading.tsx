// 인증 전환 중 풀스크린 로딩 - providers.tsx 게이트와 로그인 페이지가 모드 확정·콜백 처리·복귀 이동 동안 같이 쓴다.
"use client";

import { Loader2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function AuthLoadingScreen() {
  const { t } = useI18n();
  return (
    <div data-testid="auth-loading" className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
        <p>{t("auth.signingIn")}</p>
      </div>
    </div>
  );
}
