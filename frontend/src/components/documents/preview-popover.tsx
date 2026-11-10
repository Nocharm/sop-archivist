// 문서 미리보기 - 앱이 추출한 글의 앞부분(본문 블록 20개)을 종이 모양으로 보인다. 원본 파일 모양 재현은 하지 않는다.
"use client";

import Link from "next/link";

import { Modal } from "@/components/modal";
import { humanizeApiError } from "@/lib/api-errors";
import { getDocumentView, type SopDocument } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

// 보여 줄 앞부분 블록 수
const PREVIEW_BLOCKS = 20;

export function PreviewModal({ bundleId, document, onClose }: { bundleId: number; document: SopDocument; onClose: () => void }) {
  const { t } = useI18n();
  const view = useLoaded(() => getDocumentView(bundleId, document.id), `${bundleId}:${document.id}`);
  const blocks = (view.data?.blocks ?? []).filter((block) => block.part === "body" && block.kind !== "figure" && block.text.trim() !== "").slice(0, PREVIEW_BLOCKS);
  return (
    <Modal
      title={document.doc_code ? `${document.doc_code} · ${t("documents.preview")}` : t("documents.preview")}
      testId="documents-preview"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-3">{t("documents.previewScope", { n: PREVIEW_BLOCKS })}</span>
          <Link href={`/bundles/${bundleId}/split?doc=${document.id}`} className="btn" data-testid="documents-preview-split" onClick={onClose}>
            {t("documents.openSplit")}
          </Link>
          <button type="button" className="btn" data-testid="documents-preview-close" onClick={onClose}>
            {t("common.close")}
          </button>
        </>
      }
    >
      {view.error !== null && view.data === null ? (
        <p className="text-ink-2">{humanizeApiError(view.error, t)}</p>
      ) : view.data === null ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((row) => (
            <span key={row} className="sk h-4" style={{ width: `${60 + row * 9}%` }} />
          ))}
        </div>
      ) : (
        <div className="preview-paper" data-testid="documents-preview-text">
          {blocks.map((block) => (
            <p key={block.id} className={block.heading_level !== null ? "font-semibold text-ink" : undefined}>
              {block.text}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}
