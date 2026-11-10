// 검토 요청 거두기 - 작성자가 검토를 기다리는 Bundle을 스스로 작업 중으로 되돌린다. 개요의 요청 칸과 검토 화면 머리가 같은 단추·확인 창을 쓴다.
"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { withdrawReview, type Bundle } from "@/lib/api-sop";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, putBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";

interface WithdrawReviewButtonProps {
  bundle: Bundle;
  /** 놓이는 자리의 단추 모양(`btn`, `btn wide`) */
  className: string;
  /** 단추의 testid - 확인 창은 `<testId>-modal`이다 */
  testId: string;
}

export function WithdrawReviewButton({ bundle, className, testId }: WithdrawReviewButtonProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      // 성공하면 Bundle이 작업 중이 되어 이 단추를 그리던 자리가 사라진다
      putBundle(await withdrawReview(bundle.id, bundle.revision));
      showToast(t("review.withdrawn"));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // 그 사이 검토자가 끝냈거나 되돌렸을 수 있다(409) - 새 상태를 받아 단추를 맞춘다
      void loadBundle(bundle.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <button type="button" className={className} data-testid={testId} disabled={busy} onClick={() => setConfirming(true)}>
        <Undo2 size={16} strokeWidth={1.5} aria-hidden />
        {t("review.withdraw")}
      </button>
      {confirming && (
        <ConfirmModal
          title={t("review.withdrawTitle")}
          target={getBundleLabel(bundle)}
          summary={t("review.withdrawBody")}
          confirmLabel={t("review.withdraw")}
          confirmIcon={Undo2}
          busy={busy}
          testId={`${testId}-modal`}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
