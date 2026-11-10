// 문서 - Bundle에 올린 Old SOP와 New 문서. 번호·버전·제목은 칸에서 바로 고치고(제목을 누르면 그 문서의 Split), 언어 배치를 고르고, 추출 상태와 경고를 본다.
"use client";

import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { DeleteDocumentModal } from "@/components/documents/delete-document-modal";
import { AuxPill, DocStatusPill, getDocReason, WarningChips } from "@/components/documents/doc-status";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { PreviewModal } from "@/components/documents/preview-popover";
import { UploadModal } from "@/components/documents/upload-modal";
import { InlineText } from "@/components/inline-text";
import { ReadOnlyNote } from "@/components/read-only-note";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { MorphButton } from "@/components/ui/morph-button";
import { Truncate } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { VersionInput } from "@/components/ui/version-input";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadDocumentFile } from "@/lib/api-manage";
import { LANGUAGE_LAYOUTS, listDocuments, updateDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { saveBlob } from "@/lib/save-file";
import { useListView } from "@/lib/use-list-view";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useElementWidth } from "@/lib/use-element-width";
import { useLoaded } from "@/lib/use-loaded";

const SKELETON_ROWS = 4;

const LIST_KEY = "documents";

// 동작 칸이 미리 잡는 폭 - 아이콘 단추 셋(32px × 3 + 사이 2px × 2). 라벨은 이 자리 밖 왼쪽으로 겹쳐 펼쳐져(.mbtn-set) 다른 열이 움직이지 않는다.
// 가장 긴 라벨이 다 펼쳐질 폭(약 200px)을 잡으면 표가 본문 폭(1280)을 넘어 제목 열이 줄어든다
const ACTIONS_WIDTH = "w-[100px]";

// 표가 이 폭(본문 폭, px)에 다 들어가지 않으면 뒤쪽 네 열(추출·보조·경고·동작)을 한 열 두 줄로 접는다 - 한 줄 배치의 표 최소 폭(영어 약 1223, 한국어 약 1176)보다 조금 크게
const TRAIL_WRAP_BELOW = 1230;

export default function DocumentsPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const { data, error, isLoading, reload } = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<SopDocument | null>(null);
  const [previewing, setPreviewing] = useState<SopDocument | null>(null);
  const view = useListView(LIST_KEY);
  const [hostRef, hostWidth] = useElementWidth();
  // 카드는 열 정의가 자리(card)로만 쓰여 접을 일이 없다 - 접는 건 표뿐
  const isTrailWrapped = view === "table" && hostWidth !== null && hostWidth < TRAIL_WRAP_BELOW;
  // 업로드 뒤 AI가 비운 번호·버전을 묻는 작업이 끝나면 목록을 다시 읽어 제안이 바로 보이게 한다
  const aiJobs = useAiJobs(bundleId, reload);

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

  // Old 구역 먼저, New 구역 다음 - 구역 안 순서는 서버가 준 그대로
  const rows = data === null ? null : [...data.filter((document) => document.side === "old"), ...data.filter((document) => document.side !== "old")];

  const renderActions = (document: SopDocument) => (
    <span className={`mbtn-set ${ACTIONS_WIDTH}`}>
      {document.status === "ready" && (
        <MorphButton icon={Eye} label={t("documents.preview")} testId={`documents-${document.id}-preview`} onClick={() => setPreviewing(document)} />
      )}
      {document.status === "ready" && (
        <MorphButton icon={Download} label={t("manage.downloadOriginal")} testId={`documents-${document.id}-download`} onClick={() => void handleDownload(document)} />
      )}
      {canEdit && <MorphButton icon={Trash2} tone="danger" label={t("documents.deleteShort")} testId={`documents-${document.id}-delete`} onClick={() => setDeleting(document)} />}
    </span>
  );
  const renderWarnings = (document: SopDocument) => <WarningChips warnings={document.extraction?.warnings ?? []} testId={`documents-${document.id}-warnings`} />;

  // 뒤쪽 네 열 - 한 줄 배치(넓을 때와 카드). 카드는 status·aux가 배지, actions가 아랫줄 단추 자리다
  const statusColumn: DataColumn<SopDocument> = { key: "status", header: t("documents.colExtraction"), card: "badge", className: "align-middle", skeletonWidth: 56, cell: (document) => <DocStatusPill status={document.status} testId={`documents-${document.id}-status`} /> };
  const auxColumn: DataColumn<SopDocument> = { key: "aux", header: t("documents.colAux"), card: "badge", className: "align-middle", skeletonWidth: 64, cell: (document) => <AuxPill document={document} testId={`documents-${document.id}-aux`} /> };
  const warningsColumn: DataColumn<SopDocument> = { key: "warnings", header: t("documents.colWarnings"), className: "align-middle", skeletonWidth: 80, cell: renderWarnings };
  const actionsColumn: DataColumn<SopDocument> = {
    key: "actions",
    header: <span className="sr-only">{t("manage.rowActions")}</span>,
    card: "actions",
    className: "align-middle",
    skeletonWidth: 40,
    cell: renderActions,
  };
  // 좁을 때 한 열 두 줄 - 윗줄은 알약(왼쪽)과 줄 단추(오른쪽), 아랫줄은 경고를 길게(없으면 아랫줄을 비운다). 라벨이 펼쳐지는 곳은 윗줄뿐이라 경고를 덮지 않는다
  const trailColumn: DataColumn<SopDocument> = {
    key: "trail",
    header: `${t("documents.colExtraction")} · ${t("documents.colAux")}`,
    card: "none",
    className: "align-middle",
    minWidth: 290,
    skeletonWidth: 200,
    cell: (document) => {
      const hasWarnings = (document.extraction?.warnings ?? []).length > 0;
      return (
        <span className="flex flex-col gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <DocStatusPill status={document.status} testId={`documents-${document.id}-status`} />
              <AuxPill document={document} testId={`documents-${document.id}-aux`} />
            </span>
            {renderActions(document)}
          </span>
          {hasWarnings && renderWarnings(document)}
        </span>
      );
    },
  };

  // 제목 칸만 여러 줄이라 나머지 칸은 줄 가운데에 맞춘다(align-middle)
  const columns: DataColumn<SopDocument>[] = [
    // Old·New는 화면 언어와 상관없이 영어(도메인 용어). 카드에서는 구역 머리가 대신한다
    { key: "side", header: t("documents.colSide"), card: "none", className: "align-middle", nowrap: true, skeletonWidth: 32, cell: (document) => <span className={`side-tag ${document.side}`}>{document.side === "old" ? "Old" : "New"}</span> },
    {
      key: "code",
      header: t("documents.colCode"),
      card: "title",
      // SOP-CDO-111334(고정폭 14자)가 표·카드 어디서도 잘리지 않는 폭
      minWidth: 164,
      nowrap: true,
      className: "align-middle",
      skeletonWidth: 120,
      // AI 제안은 칸을 가리지 않고 옆에 둔다 - 눌러 받거나, 칸에 다른 값을 적어 고친다(채택 edited)
      cell: (document) => (
        <span className="inline-flex max-w-full items-center gap-1.5">
        <InlineText
          value={document.doc_code}
          placeholder={t("documents.colCode")}
          editable={canEdit}
          mono
          width={150}
          maxLength={100}
          testId={`documents-${document.id}-code`}
          onSave={(doc_code) => saveField(document, { doc_code })}
        />
        {canEdit && !document.doc_code && document.ai_meta?.doc_code && (
          <AiSuggestChip value={document.ai_meta.doc_code} testId={`documents-${document.id}-code-ai`} onAccept={() => void saveField(document, { doc_code: document.ai_meta?.doc_code ?? "" }).catch(() => undefined)} />
        )}
        </span>
      ),
    },
    {
      key: "version",
      header: t("documents.colVersion"),
      className: "align-middle",
      skeletonWidth: 72,
      cell: (document) => (
        <span className="inline-flex items-center gap-1.5">
        <VersionInput
          value={document.doc_version}
          disabled={!canEdit}
          testId={`documents-${document.id}-version`}
          onCommit={(doc_version) => void saveField(document, { doc_version }).catch(() => undefined)}
        />
        {canEdit && !document.doc_version && document.ai_meta?.doc_version && (
          <AiSuggestChip value={document.ai_meta.doc_version} testId={`documents-${document.id}-version-ai`} onAccept={() => void saveField(document, { doc_version: document.ai_meta?.doc_version ?? "" }).catch(() => undefined)} />
        )}
        </span>
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
            placeholder={t("documents.colTitle")}
            editable={canEdit && document.status === "ready"}
            width="fill"
            maxLength={500}
            href={document.status === "ready" ? `/bundles/${bundleId}/split?doc=${document.id}` : undefined}
            editLabel={t("common.edit")}
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
      className: "align-middle",
      skeletonWidth: 150,
      cell: (document) =>
        document.status === "ready" ? (
          <Select
            testId={`documents-${document.id}-layout`}
            ariaLabel={t("documents.colLayout")}
            size="sm"
            value={document.language_layout}
            disabled={!canEdit}
            options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} /> }))}
            onChange={(next) => void saveField(document, { language_layout: next }).catch(() => undefined)}
          />
        ) : (
          <span className="text-ink-4">–</span>
        ),
    },
    ...(isTrailWrapped ? [trailColumn] : [statusColumn, auxColumn, warningsColumn, actionsColumn]),
  ];

  return (
    <div className="dense flex min-h-full flex-col bg-surface">
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line px-[var(--pad)]">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title ul">{t("documents.title")}</h1>
          <ReadOnlyNote bundle={bundle} testId="documents" />
        </div>
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
        <LoadError error={error} onRetry={reload} testId="documents" />
      ) : data !== null && data.length === 0 ? (
        <EmptyState
          icon={FileText}
          testId="documents-empty"
          title={t("documents.emptyTitle")}
          body={canEdit ? t("documents.emptyEdit") : t("documents.empty")}
          action={
            canEdit && (
              <button type="button" className="btn pri" data-testid="documents-empty-upload" onClick={() => setUploading(true)}>
                <Upload size={16} strokeWidth={1.5} aria-hidden />
                {t("documents.upload")}
              </button>
            )
          }
        />
      ) : (
        <div ref={hostRef}>
        <DataList
          view={view}
          rows={rows}
          columns={columns}
          getRowGroup={(document) => ({ key: document.side, label: document.side === "old" ? t("documents.sideOldLong") : t("documents.sideNewLong") })}
          cardActions="row"
          getRowKey={(document) => document.id}
          testId="documents-list"
          rowTestId={(document) => `documents-${document.id}-row`}
          showSkeleton={showSkeleton}
          skeletonRows={SKELETON_ROWS}
          cardMinWidth={480}
        />
        </div>
      )}

      {uploading && (
        <UploadModal
          bundleId={bundleId}
          latest={data ?? []}
          onClose={() => setUploading(false)}
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
