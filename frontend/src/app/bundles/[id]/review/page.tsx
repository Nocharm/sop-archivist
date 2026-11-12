// 검토 - 검토자는 결과물을 읽고 검토 완료 또는 이유를 적어 되돌린다. 작성자는 상태를 보고, 기다리는 요청을 거두거나 끝난 묶음을 이유를 적어 다시 연다(명세 §12-9).
// 확정·완료는 일반 버튼이고 전자서명이 아니다. "Review complete"이지 "approved"가 아니다 - 정식 승인은 Veeva에서 한다.
"use client";

import { CircleCheck, Gauge, RotateCcw, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { BundleLoadError } from "@/components/bundle-load-error";
import { Modal } from "@/components/modal";
import { EditionToggle } from "@/components/outputs/edition-toggle";
import { OutputCView } from "@/components/outputs/output-c";
import { ReviewReturnNote } from "@/components/review-return-note";
import { BundleStatusPill } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { LoadError } from "@/components/ui/load-error";
import { showToast } from "@/components/ui/toast";
import { WithdrawReviewButton } from "@/components/withdraw-review";
import { humanizeApiError } from "@/lib/api-errors";
import { completeReview, getOutputC, reopenReview, returnReview, type OutputLang } from "@/lib/api-sop";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";

type ReasonAction = "return" | "reopen";

export default function ReviewPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle, error: bundleError, reload: reloadBundle } = useBundle(bundleId);
  const [lang, setLang] = useState<OutputLang>("ko");
  const output = useLoaded(() => getOutputC(bundleId, lang), `${bundleId}:${lang}:${bundle?.revision ?? 0}`);
  const showSkeleton = useDelayedFlag(output.data === null && output.error === null);
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  // 검토 완료는 Bundle을 잠그는 한 번의 누름이라 확인 창을 거친다(되돌림·다시 열기는 사유 창이 그 역할을 한다)
  const [completing, setCompleting] = useState(false);
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
      setCompleting(false);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // 상태·revision이 바뀌어 거절됐을 수 있다(409) - 새 값을 받아야 다시 눌렀을 때 같은 이유로 실패하지 않는다
      void loadBundle(bundleId);
    } finally {
      setBusy(false);
    }
  }

  if (!bundle) {
    // 불러오지 못했으면 빈 화면 대신 이유와 다시 시도를 보인다
    return bundleError !== null ? <BundleLoadError error={bundleError} onRetry={reloadBundle} testId="review" /> : null;
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" data-testid="review">
      <div className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-line bg-surface px-[var(--pad)] py-2">
        <h1 className="page-title ul">{t("stage.review")}</h1>
        <BundleStatusPill status={bundle.status} testId="review-status" />
        <span className="text-ink-2" data-testid="review-hint">
          {bundle.status === "in_progress" ? t("review.hintProgress") : bundle.status === "in_review" ? (isReviewer ? t("review.hintReviewer") : t("review.hintWaiting")) : t("review.hintDone")}
        </span>
        <span className="flex-1" />
        <EditionToggle value={lang} onChange={setLang} testId="review-lang" />
        {bundle.status === "in_progress" && isAuthor && (
          <Link href={getStageHref(bundleId, "overview")} className="btn" data-testid="review-go-overview">
            <Gauge size={16} strokeWidth={1.5} aria-hidden />
            {t("review.toOverview")}
          </Link>
        )}
        {bundle.status === "in_review" && isAuthor && <WithdrawReviewButton bundle={bundle} className="btn" testId="review-withdraw" />}
        {bundle.status === "in_review" && isReviewer && (
          <>
            <button type="button" className="btn" data-testid="review-return" disabled={busy} onClick={() => setReasonFor("return")}>
              <Undo2 size={16} strokeWidth={1.5} aria-hidden />
              {t("review.return")}
            </button>
            <button type="button" className="btn pri" data-testid="review-complete" disabled={busy} onClick={() => setCompleting(true)}>
              <CircleCheck size={16} strokeWidth={1.5} aria-hidden />
              {t("review.complete")}
            </button>
          </>
        )}
        {bundle.status === "done" && isAuthor && (
          <button type="button" className="btn" data-testid="review-reopen" disabled={busy} onClick={() => setReasonFor("reopen")}>
            <RotateCcw size={16} strokeWidth={1.5} aria-hidden />
            {t("review.reopen")}
          </button>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto bg-bg min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,760px)_minmax(280px,1fr)] min-[1280px]:content-start">
        {/* 1280 미만에서는 용지 위에 쌓이고, 이상에서는 오른쪽 열 위에 놓인다. 쪽지가 없으면 빈 칸이다 */}
        <div className="order-first min-w-0 px-[var(--pad)] pt-[var(--pad)] empty:hidden min-[1280px]:order-none min-[1280px]:col-start-2 min-[1280px]:row-start-1 min-[1280px]:pl-0" data-testid="review-aside">
          <ReviewReturnNote bundle={bundle} testId="review-return-note" />
        </div>
        {output.data ? (
          <OutputCView data={output.data} lang={lang} />
        ) : output.error !== null ? (
          <LoadError error={output.error} onRetry={output.reload} testId="review-outputs" />
        ) : (
          <div className="p-4">{showSkeleton && <span className="sk h-[420px] w-full max-w-[760px]" />}</div>
        )}
      </div>
      {completing && (
        <ConfirmModal
          title={t("review.completeTitle")}
          target={getBundleLabel(bundle)}
          summary={t("review.completeBody")}
          confirmLabel={t("review.complete")}
          confirmIcon={CircleCheck}
          busy={busy}
          testId="review-complete-modal"
          onConfirm={() => void run(() => completeReview(bundleId, bundle.revision), t("review.completed"))}
          onClose={() => setCompleting(false)}
        />
      )}
      {reasonFor && (
        <Modal
          title={reasonFor === "return" ? t("review.returnTitle") : t("review.reopenTitle")}
          onClose={() => setReasonFor(null)}
          isBusy={busy}
          testId="review-reason"
          footer={
            <>
              <button type="button" className="btn" data-testid="review-reason-cancel" onClick={() => setReasonFor(null)}>
                <X size={16} strokeWidth={1.5} aria-hidden />
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
                {reasonFor === "return" ? <Undo2 size={16} strokeWidth={1.5} aria-hidden /> : <RotateCcw size={16} strokeWidth={1.5} aria-hidden />}
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
