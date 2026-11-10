// 되돌림·다시 열기·요청 거둠 쪽지 - 작성자가 개요를 열면 왜 돌아왔는지와 의미 검토 확인이 지워졌다는 사실이 먼저 보인다(전에는 History 줄을 눌러야 보였다).
"use client";

import { CornerDownLeft } from "lucide-react";
import Link from "next/link";

import { getLatestReviewEvent } from "@/lib/api-manage";
import type { Bundle } from "@/lib/api-sop";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";
import { useLoaded } from "@/lib/use-loaded";

const NOTE_TITLE: Record<string, string> = {
  "review.return": "overview.returned",
  "review.reopen": "overview.reopened",
  "review.withdraw": "overview.withdrawn",
};

export function ReviewReturnNote({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const isOpen = bundle.status === "in_progress";
  // 다시 검토를 요청하면 최근 검토 기록이 요청으로 바뀌어 쪽지가 사라진다
  const latest = useLoaded(() => (isOpen ? getLatestReviewEvent(bundle.id) : Promise.resolve(null)), `${bundle.id}:${bundle.status}`);
  const event = latest.data;
  const titleKey = event ? NOTE_TITLE[event.action] : undefined;
  if (!isOpen || !event || !titleKey) return null;
  return (
    <section className="return-note" data-testid="overview-return-note" data-action={event.action}>
      <CornerDownLeft size={16} strokeWidth={1.5} aria-hidden />
      <div className="grid min-w-0 gap-1">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold leading-5 text-ink">
          {t(titleKey)}
          <span className="font-mono text-[11px] font-normal text-ink-3">{`${event.actor} · ${formatKstShort(event.occurred_at)}`}</span>
        </h2>
        {event.reason && (
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-ink" data-testid="overview-return-reason">
            {event.reason}
          </p>
        )}
        <p className="text-ink-2">
          {t("overview.checksCleared")}{" "}
          <Link href={getStageHref(bundle.id, "outputs")} className="text-link" data-testid="overview-return-outputs">
            {t("overview.openOutputs")}
          </Link>
        </p>
      </div>
    </section>
  );
}
