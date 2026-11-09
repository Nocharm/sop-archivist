// 문서 - 묶음에 올린 옛 SOP와 새 문서. 번호·판·제목은 칸에서 바로 고치고, 언어 배치를 고르고, 추출 상태와 경고를 본다(디자인 문서 8절 표 화면).
"use client";

import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { DeleteDocumentModal } from "@/components/documents/delete-document-modal";
import { AuxPill, DocStatusPill, getDocReason, WarningChips } from "@/components/documents/doc-status";
import { UploadModal } from "@/components/documents/upload-modal";
import { InlineText } from "@/components/inline-text";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { Truncate } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadDocumentFile } from "@/lib/api-manage";
import { LANGUAGE_LAYOUTS, listDocuments, updateDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { saveBlob } from "@/lib/save-file";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

const SKELETON_ROWS = 4;
const LIST_KEY = "documents";

export default function DocumentsPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const { data, error, isLoading, reload } = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<SopDocument | null>(null);
  const view = useListView(LIST_KEY);

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

  const columns: DataColumn<SopDocument>[] = [
    { key: "side", header: t("documents.colSide"), nowrap: true, skeletonWidth: 32, cell: (document) => t(`documents.side.${document.side}`) },
    {
      key: "code",
      header: t("documents.colCode"),
      card: "title",
      skeletonWidth: 56,
      cell: (document) => (
        <InlineText
          value={document.doc_code}
          placeholder={t("documents.addCode")}
          editable={canEdit}
          mono
          width={112}
          maxLength={100}
          testId={`documents-${document.id}-code`}
          onSave={(doc_code) => saveField(document, { doc_code })}
        />
      ),
    },
    {
      key: "version",
      header: t("documents.colVersion"),
      skeletonWidth: 72,
      cell: (document) => (
        <InlineText
          value={document.doc_version}
          placeholder={t("documents.addVersion")}
          editable={canEdit}
          width={96}
          maxLength={50}
          testId={`documents-${document.id}-version`}
          onSave={(doc_version) => saveField(document, { doc_version })}
        />
      ),
    },
    {
      key: "title",
      header: t("documents.colTitle"),
      card: "title",
      grow: true,
      minWidth: 220,
      skeletonWidth: 320,
      cell: (document) => (
        <>
          <InlineText
            value={document.title}
            placeholder={t("documents.addTitle")}
            editable={canEdit && document.status === "ready"}
            width="fill"
            maxLength={500}
            testId={`documents-${document.id}-title`}
            onSave={(title) => saveField(document, { title })}
          />
          <Truncate text={document.file_name} className="px-[7px] font-mono text-[11px] font-normal leading-4 text-ink-3" />
          {document.status !== "ready" && (
            <span className="block px-[7px] text-xs font-normal text-danger" data-testid={`documents-${document.id}-reason`}>
              {getDocReason(document, t)}
            </span>
          )}
        </>
      ),
    },
    {
      key: "layout",
      header: t("documents.colLayout"),
      skeletonWidth: 150,
      cell: (document) =>
        document.status === "ready" ? (
          <Select
            testId={`documents-${document.id}-layout`}
            ariaLabel={t("documents.colLayout")}
            size="sm"
            value={document.language_layout}
            disabled={!canEdit}
            options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: t(`layoutKind.${layout}`) }))}
            onChange={(next) => void saveField(document, { language_layout: next }).catch(() => undefined)}
          />
        ) : (
          <span className="text-ink-4">–</span>
        ),
    },
    { key: "status", header: t("documents.colExtraction"), card: "badge", skeletonWidth: 56, cell: (document) => <DocStatusPill status={document.status} testId={`documents-${document.id}-status`} /> },
    { key: "aux", header: t("documents.colAux"), card: "badge", skeletonWidth: 64, cell: (document) => <AuxPill document={document} testId={`documents-${document.id}-aux`} /> },
    {
      key: "warnings",
      header: t("documents.colWarnings"),
      skeletonWidth: 80,
      cell: (document) => <WarningChips warnings={document.extraction?.warnings ?? []} testId={`documents-${document.id}-warnings`} />,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("manage.rowActions")}</span>,
      card: "actions",
      className: "w-[72px]",
      skeletonWidth: 40,
      cell: (document) => (
        <span className="row-actions inline-flex gap-0.5">
          {document.status === "ready" && (
            <Tooltip label={t("manage.downloadOriginal")} align="end">
              <button
                type="button"
                className="btn ghost icon h-7 w-7"
                data-testid={`documents-${document.id}-download`}
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
                data-testid={`documents-${document.id}-delete`}
                aria-label={t("documents.deleteTitle")}
                onClick={() => setDeleting(document)}
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="dense flex min-h-full flex-col bg-surface">
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line px-[var(--pad)]">
        <h1 className="page-title ul">{t("documents.title")}</h1>
        <div className="flex items-center gap-2">
          <ListViewToggle listKey={LIST_KEY} view={view} testId="documents-view" />
          {canEdit && (
            <button type="button" className="btn pri" data-testid="documents-upload" onClick={() => setUploading(true)}>
              <Upload size={16} strokeWidth={1.5} aria-hidden />
              {t("documents.upload")}
            </button>
          )}
        </div>
      </div>

      {error !== null && data === null ? (
        <div data-testid="documents-error" className="flex items-center gap-3 px-[var(--pad)] py-6 text-ink-2">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" data-testid="documents-retry" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : data !== null && data.length === 0 ? (
        <p data-testid="documents-empty" className="px-[var(--pad)] py-6 text-ink-3">
          {canEdit ? t("documents.emptyEdit") : t("documents.empty")}
        </p>
      ) : (
        <DataList
          view={view}
          rows={data}
          columns={columns}
          getRowKey={(document) => document.id}
          testId="documents-list"
          rowTestId={(document) => `documents-${document.id}-row`}
          showSkeleton={showSkeleton}
          skeletonRows={SKELETON_ROWS}
          cardMinWidth={360}
        />
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
