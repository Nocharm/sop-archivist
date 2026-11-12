// Bundle을 못 불러온 화면 - 없거나 멤버가 아니면(403·404) 다시 시도가 소용없으니 목록으로 돌아갈 길을 주고, 그 밖의 실패는 다시 시도를 준다.
"use client";

import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { isBundleUnavailable } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";

interface BundleLoadErrorProps {
  error: unknown;
  onRetry: () => void;
  /** 화면 이름 - `<testId>-missing` 또는 `<testId>-error`·`<testId>-retry`가 된다 */
  testId: string;
}

export function BundleLoadError({ error, onRetry, testId }: BundleLoadErrorProps) {
  const { t } = useI18n();
  if (isBundleUnavailable(error)) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("bundle.missingTitle")}
        body={t("bundle.missingBody")}
        testId={`${testId}-missing`}
        action={
          <Link href="/" className="btn" data-testid={`${testId}-back`}>
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
            {t("bundle.backToList")}
          </Link>
        }
      />
    );
  }
  return <LoadError error={error} onRetry={onRetry} testId={testId} />;
}
