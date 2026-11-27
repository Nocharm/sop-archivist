// 문서 - Bundle에 올린 Old SOP와 New 문서. Old 목록은 두 줄 줄(OldRow)로 값을 읽고 펼친 곳에서 고친다(제목을 누르면 그 문서의 Assign 한 단 보기). 아래는 New 목록.
"use client";

import { FileText, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, type DragEvent } from "react";

import { DeleteDocumentModal } from "@/components/documents/delete-document-modal";
import { OldRow } from "@/components/documents/old-row";
import { PreviewModal } from "@/components/documents/preview-popover";
import { UploadModal } from "@/components/documents/upload-modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { ToBeSection } from "@/components/tobe/tobe-section";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { showToast } from "@/components/ui/toast";
import { listReadingDocuments } from "@/lib/ai-jobs-model";
import { useAiJobsSelect } from "@/lib/ai-jobs-store";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadDocumentFile } from "@/lib/api-manage";
import { listDocuments, refreshEquis, updateDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { hasRefreshingEquis } from "@/lib/equis-model";
import { useI18n } from "@/lib/i18n";
import { listOldRows } from "@/lib/old-row-model";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { saveBlob } from "@/lib/save-file";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useLoaded } from "@/lib/use-loaded";

const SKELETON_ROWS = 4;

export default function DocumentsPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const { data, error, isLoading, reload } = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  // 올리기 창 - 단추로 열면 빈 채로, 화면에 파일을 끌어다 놓으면 그 파일을 담아 연다
  const [uploading, setUploading] = useState<File[] | null>(null);
  const [isDropping, setIsDropping] = useState(false);
  const [deleting, setDeleting] = useState<SopDocument | null>(null);
  const [previewing, setPreviewing] = useState<SopDocument | null>(null);
  // 펼친 Old 줄 - 여러 줄을 함께 펼쳐 둘 수 있다
  const [open, setOpen] = useState<Set<number>>(new Set());
  // 업로드 뒤 AI가 비운 번호·버전을 묻는 작업이 끝나면 목록을 다시 읽어 제안이 바로 보이게 한다
  const aiJobs = useAiJobs(bundleId, reload);
  // 문서 정보(번호·버전)를 AI가 읽는 중인 문서 - 공용 작업 목록에서 고른다(문자열 키라 같은 값이면 다시 그리지 않는다)
  const readingKey = useAiJobsSelect((snapshot) => [...listReadingDocuments(snapshot.data, bundleId)].sort((a, b) => a - b).join(","), "");
  const reading = new Set(readingKey === "" ? [] : readingKey.split(",").map(Number));
  // EQUIS 조회는 업로드·저장 응답 뒤에 끝난다 - 조회 중인 줄이 있는 동안만 목록을 다시 읽어 표시와 제목이 따라오게 한다
  useEquisPolling(hasRefreshingEquis(data), reload);

  async function handleDownload(document: SopDocument) {
    try {
      saveBlob(await downloadDocumentFile(bundleId, document.id), document.file_name);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";

  // 문서가 바뀌면 개요 숫자·다음 행동도 바뀐다 - 묶음도 같이 다시 읽는다
  const canDrop = canEdit && uploading === null;
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // 파일을 끄는 것만 받는다 - 글자나 링크를 끄는 것은 그대로 둔다
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDropping(true);
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDropping(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) setUploading(files);
  }

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

  async function handleEquisRefresh(document: SopDocument) {
    try {
      const { requested } = await refreshEquis(bundleId, document.doc_code);
      showToast(t(requested ? "equis.refreshed" : "equis.refreshSkipped"));
      reload();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  function toggleOpen(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 위 목록은 Old 문서다. 이미 쓴 New 문서의 파일은 아래 New 목록의 그 줄에 붙어 보인다 - 읽지 못해 줄이 없는 New 파일만 여기 남는다(지울 수 있게)
  const rows = data === null ? null : listOldRows(data);

  return (
    <div
      className="dense relative flex min-h-full flex-col bg-surface"
      data-testid="documents-drop"
      // New 목록에서 WI 줄을 끄는 동안 이 틀에 data-parent-drag가 붙고 CSS가 SOP 줄 말고 전부를 흐린다(tobe-section.tsx)
      data-parent-drag-root=""
      // 화면 아무 데나 파일을 놓으면 올리기 창이 그 파일을 담아 열린다(창이 이미 열려 있으면 받지 않는다)
      onDragOver={canDrop ? handleDragOver : undefined}
      onDragLeave={canDrop ? () => setIsDropping(false) : undefined}
      onDrop={canDrop ? handleDrop : undefined}
    >
      {isDropping && (
        <div className="drop-veil" aria-hidden data-testid="documents-drop-veil">
          <Upload size={20} strokeWidth={1.5} aria-hidden />
          {t("documents.dropHint")}
        </div>
      )}
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line px-[var(--pad)]">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title ul">{t("documents.title")}</h1>
          <ReadOnlyNote bundle={bundle} testId="documents" />
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button type="button" className="btn pri" data-testid="documents-upload" onClick={() => setUploading([])}>
              <Upload size={16} strokeWidth={1.5} aria-hidden />
              {t("documents.upload")}
            </button>
          )}
        </div>
      </div>

      {error !== null && data === null ? (
        <BundleLoadError error={error} onRetry={reload} testId="documents" />
      ) : rows !== null && rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          testId="documents-empty"
          title={t("documents.emptyTitle")}
          body={canEdit ? t("documents.emptyEdit") : t("documents.empty")}
          action={
            canEdit && (
              <button type="button" className="btn pri" data-testid="documents-empty-upload" onClick={() => setUploading([])}>
                <Upload size={16} strokeWidth={1.5} aria-hidden />
                {t("documents.upload")}
              </button>
            )
          }
        />
      ) : (
        // docs-old - 머리와 목록을 함께 묶는다. WI 줄을 끄는 동안 이 묶음이 한 번 흐려진다(components.css)
        <div className="docs-old">
        {/* 목록 둘 - 지금 있는 문서(Old)와 만들 문서(New, 아래). 머리 모양이 같다 */}
        <div className="flex min-h-[44px] items-center gap-2 border-b border-line px-[var(--pad)] py-2">
          <h2 className="page-title" data-testid="documents-old-title">
            {t("documents.oldTitle")}
          </h2>
          {rows !== null && (
            <span className="count" data-testid="documents-old-count">
              {rows.length}
            </span>
          )}
          <span className="text-xs text-ink-3">{t("documents.oldLead")}</span>
        </div>
        <div className="doc-list" data-testid="documents-list">
          {rows === null
            ? showSkeleton &&
              Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <div key={index} className="doc-row" aria-hidden>
                  <span />
                  <span className="grid gap-1.5">
                    <span className="sk h-5 w-[120px]" />
                    <span className="sk h-4 w-[48px]" />
                  </span>
                  <span className="grid gap-1.5">
                    <span className="sk h-5" style={{ width: 300 }} />
                    <span className="sk h-4" style={{ width: 220 }} />
                  </span>
                  <span />
                </div>
              ))
            : rows.map((document) => (
                <OldRow
                  key={document.id}
                  document={document}
                  bundleId={bundleId}
                  canEdit={canEdit}
                  isReading={reading.has(document.id)}
                  open={open.has(document.id)}
                  onToggle={() => toggleOpen(document.id)}
                  onSave={(change) => saveField(document, change)}
                  onEquisRefresh={() => void handleEquisRefresh(document)}
                  onPreview={() => setPreviewing(document)}
                  onDownload={() => void handleDownload(document)}
                  onDelete={() => setDeleting(document)}
                />
              ))}
        </div>
        </div>
      )}

      {/* New 문서 목록(옛 To-Be 화면) - 올린 문서 목록과 한 화면, 한 스크롤이다. 문서를 못 읽었어도 이 목록은 따로 읽는다 */}
      <ToBeSection
        bundleId={bundleId}
        documents={data}
        onUpload={() => setUploading([])}
        file={{ onPreview: setPreviewing, onDownload: (document) => void handleDownload(document), onDelete: setDeleting, onSave: saveField }}
      />

      {uploading !== null && (
        <UploadModal
          bundleId={bundleId}
          initialFiles={uploading}
          latest={data ?? []}
          onClose={() => setUploading(null)}
          onUploaded={() => {
            refreshAll();
            aiJobs.watch();
          }}
        />
      )}
      {previewing && <PreviewModal bundleId={bundleId} document={previewing} onClose={() => setPreviewing(null)} />}
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
