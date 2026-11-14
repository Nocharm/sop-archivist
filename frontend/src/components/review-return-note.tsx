// 되돌림·다시 열기·요청 거둠 쪽지 - 작성자가 개요를 열면 왜 돌아왔는지와 의미 검토 확인이 지워졌다는 사실이 먼저 보인다(전에는 History 줄을 눌러야 보였다).
"use client";

import { CornerDownLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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

/** 사유는 8줄까지만 보이고 아래가 흐려진다 - 잘렸을 때만 "더 보기"가 나타나고 펼치면 안쪽 스크롤 없이 전부 보인다 */
function ReasonText({ text, prefix }: { text: string; prefix: string }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isClipped, setIsClipped] = useState(false);
  // 접힌 상태에서만 잘림을 잰다(펼치면 값을 그대로 둬 단추가 접기 노릇을 한다)
  function measureClip(element: HTMLElement | null) {
    if (element && !isOpen) setIsClipped(element.scrollHeight > element.clientHeight + 1);
  }
  return (
    <div className="grid justify-items-start gap-1">
      <div className="relative w-full">
        <p
          ref={measureClip}
          className={`whitespace-pre-wrap break-words text-ink ${isOpen ? "" : "max-h-40 overflow-hidden"}`}
          data-testid={`${prefix}-reason`}
        >
          {text}
        </p>
        {isClipped && !isOpen && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10" style={{ background: "linear-gradient(to top, var(--st-hold-tint), transparent)" }} aria-hidden />
        )}
      </div>
      {(isClipped || isOpen) && (
        <button type="button" className="text-link" aria-expanded={isOpen} data-testid={`${prefix}-more`} onClick={() => setIsOpen((prev) => !prev)}>
          {isOpen ? t("common.showLess") : t("common.showMore")}
        </button>
      )}
    </div>
  );
}

interface ReviewReturnNoteProps {
  bundle: Bundle;
  /** 안쪽 요소 id는 이 값에서 끝의 -note를 뗀 접두를 따른다(개요 기본값은 기존 스모크가 쓴다) */
  testId?: string;
}

export function ReviewReturnNote({ bundle, testId = "overview-return-note" }: ReviewReturnNoteProps) {
  const { t } = useI18n();
  const prefix = testId.replace(/-note$/, "");
  const isOpen = bundle.status === "in_progress";
  // 다시 검토를 요청하면 최근 검토 기록이 요청으로 바뀌어 쪽지가 사라진다
  const latest = useLoaded(() => (isOpen ? getLatestReviewEvent(bundle.id) : Promise.resolve(null)), `${bundle.id}:${bundle.status}`);
  const event = latest.data;
  const titleKey = event ? NOTE_TITLE[event.action] : undefined;
  if (!isOpen || !event || !titleKey) return null;
  return (
    <section className="return-note" data-testid={testId} data-action={event.action}>
      <CornerDownLeft size={16} strokeWidth={1.5} aria-hidden />
      <div className="grid min-w-0 gap-1">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold leading-5 text-ink">
          {t(titleKey)}
          <span className="font-mono text-[11px] font-normal text-ink-3">{`${event.actor} · ${formatKstShort(event.occurred_at)}`}</span>
        </h2>
        {event.reason && <ReasonText text={event.reason} prefix={prefix} />}
        <p className="text-ink-2">
          {t("overview.checksCleared")}{" "}
          <Link href={getStageHref(bundle.id, "outputs")} className="text-link" data-testid={`${prefix}-outputs`}>
            {t("overview.openOutputs")}
          </Link>
        </p>
      </div>
    </section>
  );
}
