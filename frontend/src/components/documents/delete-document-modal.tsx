// 문서 지우기 확인 - 아이콘·제목·대상·요약 상자. 사람이 정한 단위가 걸려 있으면 서버가 409로 먼저 묻고, 그 수를 보인 뒤 한 번 더 확인받는다.
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { deleteDocument, type SopDocument } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface DeleteDocumentModalProps {
  bundleId: number;
  document: SopDocument;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteDocumentModal({ bundleId, document, onClose, onDeleted }: DeleteDocumentModalProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // 서버가 알려 준, 판단이 걸린 단위 수 - 있으면 두 번째 확인이다
  const [decidedCount, setDecidedCount] = useState<number | null>(null);

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      await deleteDocument(bundleId, document.id, document.revision, decidedCount !== null);
      onDeleted();
    } catch (err) {
      const unitIds = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule.unit_ids : null;
      if (Array.isArray(unitIds)) setDecidedCount(unitIds.length);
      else setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("documents.deleteTitle")}
      onClose={onClose}
      testId="delete-document"
      footer={
        <>
          <button type="button" className="btn" data-testid="delete-document-cancel" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn danger" data-testid="delete-document-confirm" disabled={saving} onClick={() => void handleDelete()}>
            {decidedCount === null ? t("common.delete") : t("documents.deleteAnyway")}
          </button>
        </>
      }
    >
      <div className="grid justify-items-center gap-2 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-danger-tint text-danger" aria-hidden>
          <Trash2 size={20} strokeWidth={1.5} />
        </span>
        <span className="font-mono text-xs text-ink-3">{document.doc_code || document.file_name}</span>
      </div>
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-ink-2" data-testid="delete-document-summary">
        <span>{t("documents.deleteBody")}</span>
        {decidedCount !== null && <span className="font-semibold text-danger">{t("documents.deleteDecided", { n: decidedCount })}</span>}
      </div>
      {error !== null && <p className="text-danger">{humanizeApiError(error, t)}</p>}
    </Modal>
  );
}
