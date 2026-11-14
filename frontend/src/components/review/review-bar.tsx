// 결과 화면 위의 검토 띠 - 상태 한 줄과, 역할·상태에 따라 한 자리에서 바뀌는 단추(요청 → 거두기 → 완료·되돌림 → 다시 열기).
// 확정·완료는 일반 버튼이고 전자서명이 아니다. "Review complete"이지 "approved"가 아니다 - 정식 승인은 EQUIS에서 한다.
"use client";

import { CircleCheck, RotateCcw, Send, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { RequestReviewModal } from "@/components/review/request-review-modal";
import { BundleStatusPill } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { showToast } from "@/components/ui/toast";
import { WithdrawReviewButton } from "@/components/withdraw-review";
import { humanizeApiError } from "@/lib/api-errors";
import { completeReview, getReadiness, reopenReview, returnReview, type Bundle } from "@/lib/api-sop";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, putBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";
import { useLoaded } from "@/lib/use-loaded";

type ReasonAction = "return" | "reopen";

export function ReviewBar({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const isReviewer = bundle.my_role === "reviewer";
  const isAuthor = bundle.my_role === "author";
  const isDrafting = bundle.status === "in_progress";
  // 요청 조건은 작성자가 작업 중일 때만 묻는다 - 그 밖에는 요청 단추가 없다
  const readiness = useLoaded(() => (isAuthor && isDrafting ? getReadiness(bundle.id) : Promise.resolve(null)), `${bundle.id}:${bundle.revision}:${isAuthor && isDrafting}`);
  const canRequest = readiness.data?.ready === true;
  const [requesting, setRequesting] = useState(false);
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  // 검토 완료는 Bundle을 잠그는 한 번의 누름이라 확인 창을 거친다(되돌림·다시 열기는 사유 창이 그 역할을 한다)
  const [completing, setCompleting] = useState(false);
  const [busy, setBusy] = useState(false);

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
      void loadBundle(bundle.id);
    } finally {
      setBusy(false);
    }
  }

  const hint = isDrafting ? (isAuthor ? (canRequest ? t("review.hintReady") : t("review.hintProgress")) : t("review.hintDrafting")) : bundle.status === "in_review" ? (isReviewer ? t("review.hintReviewer") : t("review.hintWaiting")) : t("review.hintDone");

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface px-[var(--pad)] py-1.5" role="region" aria-label={t("stage.review")} data-testid="review">
      <BundleStatusPill status={bundle.status} testId="review-status" />
      <span className="min-w-0 flex-1 text-ink-2" data-testid="review-hint">
        {hint}
      </span>
      {/* 단추 칸 - 역할·상태마다 내용만 바뀌고 자리는 오른쪽 끝 그대로다 */}
      <span className="flex flex-none items-center gap-2">
        {isDrafting && isAuthor && (
          <>
            {/* 꺼진 단추가 이유를 말한다 - 조건을 아직 못 읽었으면 비워 둔다 */}
            {!canRequest && readiness.data !== null && (
              <Link href={getStageHref(bundle.id, "overview")} className="text-link text-xs" data-testid="review-open-conditions">
                {t("review.openConditions")}
              </Link>
            )}
            <button type="button" className="btn pri" data-testid="review-request" disabled={!canRequest} onClick={() => setRequesting(true)}>
              <Send size={16} strokeWidth={1.5} aria-hidden />
              {t("overview.requestReview")}
            </button>
          </>
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
      </span>
      {requesting && <RequestReviewModal bundle={bundle} onClose={() => setRequesting(false)} />}
      {completing && (
        <ConfirmModal
          title={t("review.completeTitle")}
          target={getBundleLabel(bundle)}
          summary={t("review.completeBody")}
          confirmLabel={t("review.complete")}
          confirmIcon={CircleCheck}
          busy={busy}
          testId="review-complete-modal"
          onConfirm={() => void run(() => completeReview(bundle.id, bundle.revision), t("review.completed"))}
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
                    () => (reasonFor === "return" ? returnReview(bundle.id, bundle.revision, reason.trim()) : reopenReview(bundle.id, bundle.revision, reason.trim())),
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
