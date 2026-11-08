// 검토 - 검토자는 결과물을 읽고 검토 완료 또는 이유를 적어 되돌린다. 작성자는 상태를 보고, 끝난 묶음을 이유를 적어 다시 연다(명세 §12-9).
// 확정·완료는 일반 버튼이고 전자서명이 아니다. "Review complete"이지 "approved"가 아니다 - 정식 승인은 Veeva에서 한다.
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { OutputCView } from "@/components/outputs/output-c";
import { BundleStatusPill } from "@/components/status";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { completeReview, getOutputC, reopenReview, returnReview, type OutputLang } from "@/lib/api-sop";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";

type ReasonAction = "return" | "reopen";

export default function ReviewPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const [lang, setLang] = useState<OutputLang>("ko");
  const output = useLoaded(() => getOutputC(bundleId, lang), `${bundleId}:${lang}:${bundle?.revision ?? 0}`);
  const showSkeleton = useDelayedFlag(output.data === null && output.error === null);
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isReviewer = bundle?.my_role === "reviewer";
  const isAuthor = bundle?.my_role === "author";

  async function run(action: () => Promise<Parameters<typeof putBundle>[0]>, message: string) {
    setBusy(true);
    try {
      putBundle(await action());
      showToast(message);
      setReasonFor(null);
      setReason("");
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // 상태·revision이 바뀌어 거절됐을 수 있다(409) - 새 값을 받아야 다시 눌렀을 때 같은 이유로 실패하지 않는다
      void loadBundle(bundleId);
    } finally {
      setBusy(false);
    }
  }

  if (!bundle) return null;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" data-testid="review">
      <div className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-line bg-surface px-[var(--pad)] py-2">
        <h1 className="page-title ul">{t("stage.review")}</h1>
        <BundleStatusPill status={bundle.status} testId="review-status" />
        <span className="text-ink-2" data-testid="review-hint">
          {bundle.status === "in_progress" ? t("review.hintProgress") : bundle.status === "in_review" ? (isReviewer ? t("review.hintReviewer") : t("review.hintWaiting")) : t("review.hintDone")}
        </span>
        <span className="flex-1" />
        <div className="flex gap-0.5 rounded-md bg-sunken p-0.5" role="group" aria-label={t("outputs.edition")}>
          {(["ko", "en"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={lang === item} className={`h-[26px] rounded px-2.5 font-mono text-xs ${lang === item ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`} data-testid={`review-lang-${item}`} onClick={() => setLang(item)}>
              {item.toUpperCase()}
            </button>
          ))}
        </div>
        {bundle.status === "in_progress" && isAuthor && (
          <Link href={getStageHref(bundleId, "overview")} className="btn" data-testid="review-go-overview">
            {t("review.toOverview")}
          </Link>
        )}
        {bundle.status === "in_review" && isReviewer && (
          <>
            <button type="button" className="btn" data-testid="review-return" disabled={busy} onClick={() => setReasonFor("return")}>
              {t("review.return")}
            </button>
            <button type="button" className="btn pri" data-testid="review-complete" disabled={busy} onClick={() => void run(() => completeReview(bundleId, bundle.revision), t("review.completed"))}>
              {t("review.complete")}
            </button>
          </>
        )}
        {bundle.status === "done" && isAuthor && (
          <button type="button" className="btn" data-testid="review-reopen" disabled={busy} onClick={() => setReasonFor("reopen")}>
            {t("review.reopen")}
          </button>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto bg-bg">
        {output.data ? (
          <OutputCView data={output.data} lang={lang} />
        ) : output.error !== null ? (
          <p className="p-6 text-ink-2">{humanizeApiError(output.error, t)}</p>
        ) : (
          <div className="p-4">{showSkeleton && <span className="sk h-[420px] w-full max-w-[760px]" />}</div>
        )}
      </div>
      {reasonFor && (
        <Modal
          title={reasonFor === "return" ? t("review.returnTitle") : t("review.reopenTitle")}
          onClose={() => setReasonFor(null)}
          testId="review-reason"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setReasonFor(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn pri"
                data-testid="review-reason-confirm"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(
                    () => (reasonFor === "return" ? returnReview(bundleId, bundle.revision, reason.trim()) : reopenReview(bundleId, bundle.revision, reason.trim())),
                    reasonFor === "return" ? t("review.returned") : t("review.reopened"),
                  )
                }
              >
                {reasonFor === "return" ? t("review.return") : t("review.reopen")}
              </button>
            </>
          }
        >
          <p className="text-ink-2">{reasonFor === "return" ? t("review.returnBody") : t("review.reopenBody")}</p>
          <textarea className="h-24 w-full rounded-md border border-line-2 bg-surface p-2 text-[13px]" data-testid="review-reason-text" value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
        </Modal>
      )}
    </div>
  );
}
