// 없는 주소 - Next 기본 영어 화면 대신 앱 틀 안(상단 바 아래)에서 같은 빈 화면 부품으로 목록에 돌아갈 길을 준다.
"use client";

import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={FileQuestion}
      title={t("notFound.title")}
      body={t("notFound.body")}
      testId="not-found"
      action={
        <Link href="/" className="btn" data-testid="not-found-back">
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
          {t("bundle.backToList")}
        </Link>
      }
    />
  );
}
