// 검토 요청 확인 창 - 개요의 요청 칸과 결과 화면의 검토 띠가 같은 창을 쓴다. 요청하면 Bundle이 잠기고 검토자에게 넘어간다.
"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { humanizeApiError } from "@/lib/api-errors";
import { requestReview, type Bundle } from "@/lib/api-sop";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, putBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";

export function RequestReviewModal({ bundle, onClose }: { bundle: Bundle; onClose: () => void }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      putBundle(await requestReview(bundle.id, bundle.revision));
      onClose();
    } catch (err) {
      setError(err);
      setSaving(false);
      // revision·상태가 바뀌어 409일 수 있다 - 새 묶음으로 다시 시도할 수 있게 불러온다
      void loadBundle(bundle.id);
    }
  }

  const reviewers = bundle.members.filter((member) => member.role === "reviewer").map((member) => member.login_id);
  return (
    <Modal
      title={t("overview.requestReviewTitle")}
      onClose={onClose}
      isBusy={saving}
      size="sm"
      testId="request-review"
      footer={
        <>
          <button type="button" className="btn" data-testid="request-review-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid="request-review-confirm" disabled={saving} onClick={handleConfirm}>
            {t("overview.requestReview")}
          </button>
        </>
      }
    >
      <p className="text-ink-2">{t("overview.requestReviewBody")}</p>
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-ink-2">
        <span className="font-semibold text-ink">{getBundleLabel(bundle)}</span>
        <span>{t("overview.reviewers", { names: reviewers.join(", ") })}</span>
      </div>
      {error !== null && (
        <p className="text-danger" data-testid="request-review-error">
          {humanizeApiError(error, t)}
        </p>
      )}
    </Modal>
  );
}
