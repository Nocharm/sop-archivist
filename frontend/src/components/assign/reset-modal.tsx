// 배정 초기화 확인 창 - 열자마자 dry_run으로 몇 줄이 미배정·보류로 가고 새 문장 몇 개가 지워지는지 세어 보인 뒤, 확정하면 같은 범위를 실제로 지운다.
"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { resetAssignments } from "@/lib/api-sop";
import { loadBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

/** 초기화 범위 - 지금 연 Old 문서 하나 또는 묶음 전체 */
export type ResetScope = { kind: "document"; documentId: number; label: string } | { kind: "bundle" };

interface ResetModalProps {
  bundleId: number;
  scope: ResetScope;
  /** 묶음 revision - 초기화는 올리지 않으므로 미리 세기와 실제 실행에 같은 값을 쓴다 */
  revision: number;
  onDone: () => void;
  onClose: () => void;
}

export function ResetModal({ bundleId, scope, revision, onDone, onClose }: ResetModalProps) {
  const { t } = useI18n();
  const documentId = scope.kind === "document" ? scope.documentId : undefined;
  const preview = useLoaded(() => resetAssignments(bundleId, { revision, document_id: documentId, dry_run: true }), `${bundleId}:${documentId ?? "all"}:${revision}`);
  const [busy, setBusy] = useState(false);
  const counts = preview.data;
  const total = counts ? counts.unassigned_units + counts.held_units + counts.deleted_targets + counts.held_targets : 0;

  async function runReset() {
    setBusy(true);
    try {
      const result = await resetAssignments(bundleId, { revision, document_id: documentId });
      showToast(t("assign.reset.done", { n: result.unassigned_units }));
      onDone();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // revision이 낡았을 수 있다 - 묶음을 다시 받으면 창이 새 revision으로 다시 센다
      void loadBundle(bundleId);
    } finally {
      setBusy(false);
    }
  }

  let summary;
  if (preview.error !== null) {
    summary = (
      <span className="text-st-hold" role="status" data-testid="assign-reset-error">
        {humanizeApiError(preview.error, t)}
      </span>
    );
  } else if (!counts) {
    summary = <span className="sk h-5 w-3/5" data-testid="assign-reset-loading" />;
  } else if (total === 0) {
    summary = <span data-testid="assign-reset-nothing">{t("assign.reset.nothing")}</span>;
  } else {
    summary = (
      <ul className="grid gap-0.5" data-testid="assign-reset-counts">
        <li data-testid="assign-reset-count-unassigned">{t("assign.reset.unassigned", { n: counts.unassigned_units })}</li>
        {counts.held_units > 0 && <li data-testid="assign-reset-count-held">{t("assign.reset.held", { n: counts.held_units })}</li>}
        {counts.deleted_targets > 0 && <li data-testid="assign-reset-count-deleted">{t("assign.reset.deleted", { n: counts.deleted_targets })}</li>}
        {counts.held_targets > 0 && <li data-testid="assign-reset-count-held-targets">{t("assign.reset.heldTargets", { n: counts.held_targets })}</li>}
      </ul>
    );
  }

  return (
    <ConfirmModal
      title={t(scope.kind === "document" ? "assign.reset.documentTitle" : "assign.reset.bundleTitle")}
      target={scope.kind === "document" ? scope.label : undefined}
      summary={summary}
      confirmLabel={t("assign.reset.confirm")}
      confirmIcon={RotateCcw}
      danger
      busy={busy}
      confirmDisabled={!counts || total === 0}
      testId="assign-reset-modal"
      onConfirm={() => void runReset()}
      onClose={onClose}
    />
  );
}
