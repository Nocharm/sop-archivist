// 문서 - 묶음에 올린 옛 SOP와 새 문서. 번호·판·제목은 칸에서 바로 고치고, 언어 배치를 고르고, 추출 상태와 경고를 본다(디자인 문서 8절 표 화면).
"use client";

import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { DeleteDocumentModal } from "@/components/documents/delete-document-modal";
import { AuxPill, DocStatusPill, getDocReason, WarningChips } from "@/components/documents/doc-status";
import { UploadModal } from "@/components/documents/upload-modal";
import { InlineText } from "@/components/inline-text";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadDocumentFile } from "@/lib/api-manage";
import { LANGUAGE_LAYOUTS, listDocuments, updateDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { saveBlob } from "@/lib/save-file";
import { useLoaded } from "@/lib/use-loaded";

const SKELETON_ROWS = 4;

export default function DocumentsPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const { data, error, isLoading, reload } = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<SopDocument | null>(null);

  async function handleDownload(document: SopDocument) {
    try {
      saveBlob(await downloadDocumentFile(bundleId, document.id), document.file_name);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";

  // 문서가 바뀌면 개요 숫자·다음 행동도 바뀐다 - 묶음도 같이 다시 읽는다
  function refreshAll() {
    reload();
    void loadBundle(bundleId);
  }

  async function saveField(document: SopDocument, change: Omit<DocumentUpdateInput, "revision">) {
    try {
      await updateDocument(bundleId, document.id, { revision: document.revision, ...change });
      showToast(t("common.saved"));
      refreshAll();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // 다른 사람이 먼저 고쳤으면 최신으로 맞춘다
      reload();
      throw err;
    }
  }

  return (
    <div className="dense flex min-h-full flex-col bg-surface">
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-[var(--pad)]">
        <h1 className="page-title ul">{t("documents.title")}</h1>
        {canEdit && (
          <button type="button" className="btn pri" data-testid="documents-upload" onClick={() => setUploading(true)}>
            <Upload size={16} strokeWidth={1.5} aria-hidden />
            {t("documents.upload")}
          </button>
        )}
      </div>

      {error !== null && data === null ? (
        <div data-testid="documents-error" className="flex items-center gap-3 px-[var(--pad)] py-6 text-ink-2">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : data !== null && data.length === 0 ? (
        <p data-testid="documents-empty" className="border-t border-line px-[var(--pad)] py-6 text-ink-3">
          {canEdit ? t("documents.emptyEdit") : t("documents.empty")}
        </p>
      ) : (
        <table className="dtable border-t border-line" data-testid="documents-list">
          <thead>
            <tr>
              <th>{t("documents.colSide")}</th>
              <th>{t("documents.colCode")}</th>
              <th>{t("documents.colVersion")}</th>
              <th>{t("documents.colTitle")}</th>
              <th>{t("documents.colLayout")}</th>
              <th>{t("documents.colExtraction")}</th>
              <th>{t("documents.colAux")}</th>
              <th>{t("documents.colWarnings")}</th>
              <th aria-label={t("manage.rowActions")} />
            </tr>
          </thead>
          <tbody>
            {data === null
              ? showSkeleton &&
                Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} data-testid="documents-skeleton">
                    {[32, 56, 72, 320, 150, 56, 64, 80, 40].map((width, cell) => (
                      <td key={cell}>
                        <span className="sk h-5" style={{ width }} />
                      </td>
                    ))}
                  </tr>
                ))
              : data.map((document) => {
                  const ready = document.status === "ready";
                  const prefix = `documents-${document.id}`;
                  return (
                    <tr key={document.id} data-testid={`${prefix}-row`}>
                      <td className="whitespace-nowrap">{t(`documents.side.${document.side}`)}</td>
                      <td>
                        <InlineText
                          value={document.doc_code}
                          placeholder={t("documents.addCode")}
                          editable={canEdit}
                          mono
                          width={96}
                          maxLength={100}
                          testId={`${prefix}-code`}
                          onSave={(doc_code) => saveField(document, { doc_code })}
                        />
                      </td>
                      <td>
                        <InlineText
                          value={document.doc_version}
                          placeholder={t("documents.addVersion")}
                          editable={canEdit}
                          width={72}
                          maxLength={50}
                          testId={`${prefix}-version`}
                          onSave={(doc_version) => saveField(document, { doc_version })}
                        />
                      </td>
                      <td className="min-w-[260px]">
                        <InlineText
                          value={document.title}
                          placeholder={t("documents.addTitle")}
                          editable={canEdit && ready}
                          width={300}
                          maxLength={500}
                          testId={`${prefix}-title`}
                          onSave={(title) => saveField(document, { title })}
                        />
                        <span className="block truncate font-mono text-[11px] leading-4 text-ink-3">{document.file_name}</span>
                        {!ready && (
                          <span className="block text-xs text-danger" data-testid={`${prefix}-reason`}>
                            {getDocReason(document, t)}
                          </span>
                        )}
                      </td>
                      <td>
                        {ready ? (
                          <select
                            data-testid={`${prefix}-layout`}
                            className="h-7 rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink disabled:opacity-60"
                            value={document.language_layout}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const next = LANGUAGE_LAYOUTS.find((layout) => layout === event.target.value);
                              if (next) void saveField(document, { language_layout: next }).catch(() => undefined);
                            }}
                          >
                            {LANGUAGE_LAYOUTS.map((layout) => (
                              <option key={layout} value={layout}>
                                {t(`layoutKind.${layout}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-ink-4">–</span>
                        )}
                      </td>
                      <td>
                        <DocStatusPill status={document.status} testId={`${prefix}-status`} />
                      </td>
                      <td>
                        <AuxPill document={document} testId={`${prefix}-aux`} />
                      </td>
                      <td>
                        <WarningChips warnings={document.extraction?.warnings ?? []} testId={`${prefix}-warnings`} />
                      </td>
                      <td className="w-[72px]">
                        <span className="row-actions inline-flex gap-0.5">
                          {document.status === "ready" && (
                            <Tooltip label={t("manage.downloadOriginal")} align="end">
                              <button
                                type="button"
                                className="btn ghost icon h-7 w-7"
                                data-testid={`${prefix}-download`}
                                aria-label={t("manage.downloadOriginal")}
                                onClick={() => void handleDownload(document)}
                              >
                                <Download size={14} strokeWidth={1.5} aria-hidden />
                              </button>
                            </Tooltip>
                          )}
                          {canEdit && (
                            <Tooltip label={t("documents.deleteTitle")} align="end">
                              <button
                                type="button"
                                className="btn ghost icon h-7 w-7"
                                data-testid={`${prefix}-delete`}
                                aria-label={t("documents.deleteTitle")}
                                onClick={() => setDeleting(document)}
                              >
                                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                              </button>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      )}

      {uploading && <UploadModal bundleId={bundleId} onClose={() => setUploading(false)} onUploaded={refreshAll} />}
      {deleting && (
        <DeleteDocumentModal
          bundleId={bundleId}
          document={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            showToast(t("documents.deleted"));
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
