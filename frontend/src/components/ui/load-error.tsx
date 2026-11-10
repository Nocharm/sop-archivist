// 불러오기 실패 한 줄 - 사람 말 문구와 다시 시도 단추. 화면마다 따로 그리던 것을 하나로 모았다(다시 시도 없는 실패 화면을 만들지 않는다).
"use client";

import { RefreshCw } from "lucide-react";

import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";

interface LoadErrorProps {
  error: unknown;
  onRetry: () => void;
  /** 화면·자리 이름 - `<testId>-error`와 `<testId>-retry`가 된다 */
  testId: string;
  /** 목록 아래처럼 좁은 자리 - 바깥 여백을 줄인다 */
  compact?: boolean;
}

export function LoadError({ error, onRetry, testId, compact = false }: LoadErrorProps) {
  const { t } = useI18n();
  return (
    <p className={`flex flex-wrap items-center gap-3 text-ink-2 ${compact ? "px-3 py-2 text-[13px]" : "p-6"}`} role="alert" data-testid={`${testId}-error`}>
      {humanizeApiError(error, t)}
      <button type="button" className="btn" data-testid={`${testId}-retry`} onClick={onRetry}>
        <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
        {t("common.retry")}
      </button>
    </p>
  );
}
