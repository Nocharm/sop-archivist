// 문서 - Bundle에 올린 Old SOP와 New 문서. 번호·버전·제목은 칸에서 바로 고치고(제목을 누르면 그 문서의 Split), 언어 배치를 고르고, 추출 상태와 경고를 본다.
"use client";

import { Download, Eye, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, type DragEvent } from "react";

import { DeleteDocumentModal } from "@/components/documents/delete-document-modal";
import { AuxPill, DocStatusPill, getDocReason, WarningChips, WarningCountChip } from "@/components/documents/doc-status";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { PreviewModal } from "@/components/documents/preview-popover";
import { UploadModal } from "@/components/documents/upload-modal";
import { EquisLink } from "@/components/equis/equis-link";
import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { InlineText } from "@/components/inline-text";
import { ReadOnlyNote } from "@/components/read-only-note";
import { ToBeSection } from "@/components/tobe/tobe-section";
import { DataList, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { Truncate } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { VersionInput } from "@/components/ui/version-input";
import { listReadingDocuments } from "@/lib/ai-jobs-model";
import { useAiJobsSelect } from "@/lib/ai-jobs-store";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadDocumentFile } from "@/lib/api-manage";
import { LANGUAGE_LAYOUTS, listDocuments, refreshEquis, updateDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { hasRefreshingEquis } from "@/lib/equis-model";
import { useI18n } from "@/lib/i18n";
import { getEditOriginalHref } from "@/lib/stages";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { saveBlob } from "@/lib/save-file";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useElementWidth } from "@/lib/use-element-width";
import { useLoaded } from "@/lib/use-loaded";

const SKELETON_ROWS = 4;


// 동작 칸 폭 - 아이콘 단추 셋(24px × 3 + 간격 2px × 2 = 76px). 단추가 모자란 줄(거절된 줄)도 오른쪽 끝에 붙는다
const ACTIONS_WIDTH = "w-[80px]";

// 표가 이 폭(본문 폭, px)에 다 들어가지 않으면 뒤쪽 네 열(추출·보조·경고·동작)을 한 열 두 줄로 접는다 - 한 줄 배치의 표 최소 폭(영어 약 1223, 한국어 약 1176)보다 조금 크게
const TRAIL_WRAP_BELOW = 1230;

// 언어 배치 드롭다운 고정 폭 - 기본 라벨은 영어·한국어 모두 말줄임 없이 들어가야 한다(말줄임은 유난히 긴 내용 몫). 고정 폭 트리거는 테두리 2 + 왼쪽 여백 8 + 오른쪽 여백(화살표 자리) 22를 쓰니 내용 폭은 178 - 32 = 146px이고, 가장 긴 "KO/EN interleaved"는 그림 22 + 간격 8 + 글자 106 = 136px(맥 Chrome에서 잰 값) - 글꼴 렌더링이 다른 Windows에서도 들어가도록 10px 여유를 둔다
const LAYOUT_SELECT_WIDTH = 178;

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
  // 목록은 표 하나다 - 표·카드 전환은 없앴다(문서 줄은 칸을 나란히 견주는 자료다)
  const view = "table" as const;
  const [hostRef, hostWidth] = useElementWidth();
  // 카드는 열 정의가 자리(card)로만 쓰여 접을 일이 없다 - 접는 건 표뿐
  const isTrailWrapped = hostWidth !== null && hostWidth < TRAIL_WRAP_BELOW;
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

  // Old 구역 먼저, New 구역 다음 - 구역 안 순서는 서버가 준 그대로
  // 위 목록은 Old 문서다. 이미 쓴 New 문서의 파일은 아래 New 목록의 그 줄에 붙어 보인다 - 읽지 못해 줄이 없는 New 파일만 여기 남는다(지울 수 있게)
  const isStrayNew = (document: SopDocument) => document.side === "new" && document.target_doc_id === null;
  const rows = data === null ? null : [...data.filter((document) => document.side === "old"), ...data.filter(isStrayNew)];
  const hasStrayNew = rows?.some(isStrayNew) ?? false;

  // 늘 보이되 흐린 아이콘 단추(.row-actions-quiet) - 펼치는 라벨 대신 툴팁이라 왼쪽 알약을 덮지 않는다. 자리는 오른쪽 끝 고정 폭이라 줄마다 오른쪽 끝이 같다
  const renderActions = (document: SopDocument) => {
    const items = [
      ...(document.status === "ready"
        ? [
            { key: "preview", icon: Eye, label: t("documents.preview"), danger: false, run: () => setPreviewing(document) },
            { key: "download", icon: Download, label: t("documents.download"), danger: false, run: () => void handleDownload(document) },
          ]
        : []),
      ...(canEdit ? [{ key: "delete", icon: Trash2, label: t("documents.deleteShort"), danger: true, run: () => setDeleting(document) }] : []),
    ];
    return (
      <span className={`row-actions-quiet flex justify-end gap-0.5 ${ACTIONS_WIDTH}`}>
        {items.map(({ key, icon: Icon, label, danger, run }) => (
          <Tooltip key={key} label={label} align="end">
            <button type="button" className={`btn ghost icon h-6 w-6 ${danger ? "text-danger" : ""}`} aria-label={label} data-testid={`documents-${document.id}-${key}`} onClick={run}>
              <Icon size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        ))}
      </span>
    );
  };
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
  // 좁을 때 한 열 한 줄 - 왼쪽에 추출·보조 검사 아이콘(또는 알약)과 경고 개수 칩, 오른쪽 끝에 아이콘 단추
  const trailColumn: DataColumn<SopDocument> = {
    key: "trail",
    header: t("documents.col.trailWithWarnings"),
    card: "none",
    className: "align-middle",
    minWidth: 200, // 상태 아이콘 둘 + 경고 칩 + 단추 셋
    skeletonWidth: 180,
    cell: (document) => {
      const warnings = document.extraction?.warnings ?? [];
      return (
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <DocStatusPill status={document.status} testId={`documents-${document.id}-status`} />
            <AuxPill document={document} testId={`documents-${document.id}-aux`} />
            {warnings.length > 0 && <WarningCountChip warnings={warnings} testId={`documents-${document.id}-warnings`} />}
          </span>
          {renderActions(document)}
        </span>
      );
    },
  };

  // 제목 칸만 여러 줄이라 나머지 칸은 줄 가운데에 맞춘다(align-middle)
  const columns: DataColumn<SopDocument>[] = [
    // 줄이 없는 New 파일이 섞여 있을 때만 쪽을 보인다(Old·New는 화면 언어와 상관없이 영어 - 도메인 용어)
    ...(hasStrayNew
      ? [{ key: "side", header: t("documents.colSide"), card: "none" as const, className: "align-middle", nowrap: true, skeletonWidth: 32, cell: (document: SopDocument) => <span className={`side-tag ${document.side}`}>{document.side === "old" ? "Old" : "New"}</span> }]
      : []),
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
        {reading.has(document.id) && (
          <Tooltip label={t("documents.aiReading")}>
            <span className="inline-flex text-st-ai" tabIndex={0} role="img" aria-label={t("documents.aiReading")} data-testid={`documents-${document.id}-ai-reading`}>
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
            </span>
          </Tooltip>
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
      minWidth: 164,
      skeletonWidth: 320,
      cell: (document) => {
        const { equis } = document;
        // EQUIS에 있는 문서의 제목은 EQUIS가 정한다 - 연필 대신 자물쇠가 같은 자리에 서고, 옆 아이콘이 EQUIS 원본을 연다
        const title = (
          <InlineText
            value={document.title}
            placeholder={t("documents.colTitle")}
            editable={canEdit && !equis?.title_locked}
            width="fill"
            maxLength={500}
            href={getEditOriginalHref(bundleId, document.id)}
            editLabel={t("common.edit")}
            testId={`documents-${document.id}-title`}
            onSave={(next) => saveField(document, { title: next })}
          />
        );
        const fileName = <Truncate text={document.file_name} className="px-[7px] font-mono text-[11px] font-normal leading-4 text-ink-3" />;
        return (
        <>
          {document.status !== "ready" ? (
            // 읽기 전용 제목도 링크 제목(.inline-link)과 같은 안쪽 여백·굵기 - 거절된 줄 글이 옆 줄과 어긋나지 않는다
            <span className="block max-w-full px-1.5 text-[13px] font-semibold leading-6" data-testid={`documents-${document.id}-title`}>
              {document.title ? <Truncate text={document.title} className="one-line" /> : <span className="text-ink-4">–</span>}
            </span>
          ) : equis ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <span className="min-w-0">{title}</span>
              {equis.title_locked && <TitleLock testId={`documents-${document.id}-title-lock`} />}
              {equis.doc_url && <EquisLink href={equis.doc_url} testId={`documents-${document.id}-equis-link`} />}
            </span>
          ) : (
            title
          )}
          {equis ? (
            // 표시는 파일 이름 줄의 오른쪽 끝 - 열도 줄 높이도 늘지 않는다. 좁으면 파일 이름이 먼저 줄고(최소 96px), 그다음 표시가 말줄임된다
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-[96px] flex-1">{fileName}</span>
              <EquisStatus
                equis={equis}
                testId={`documents-${document.id}-equis`}
                canEdit={canEdit}
                onRefresh={() => void handleEquisRefresh(document)}
                onUseCurrentNumber={() => void saveField(document, { doc_code: equis.number }).catch(() => undefined)}
              />
            </span>
          ) : (
            fileName
          )}
          {document.status !== "ready" && (
            <span className="block px-[7px] text-xs font-normal text-danger" data-testid={`documents-${document.id}-reason`}>
              {getDocReason(document, t)}
            </span>
          )}
        </>
        );
      },
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
            width={LAYOUT_SELECT_WIDTH}
            value={document.language_layout}
            disabled={!canEdit}
            options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} />, tip: t(`layoutKind.${layout}`) }))}
            onChange={(next) => void saveField(document, { language_layout: next }).catch(() => undefined)}
          />
        ) : (
          <span className="text-ink-4">–</span>
        ),
    },
    ...(isTrailWrapped ? [trailColumn] : [statusColumn, auxColumn, warningsColumn, actionsColumn]),
  ];

  return (
    <div
      className="dense relative flex min-h-full flex-col bg-surface"
      data-testid="documents-drop"
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
        <div ref={hostRef}>
        {/* 목록 둘 - 지금 있는 문서(Old)와 만들 문서(New, 아래). 머리 모양이 같다 */}
        <div className="flex min-h-[44px] items-center gap-2 border-b border-line px-[var(--pad)] py-2">
          <h2 className="page-title" data-testid="documents-old-title">
            {t("documents.oldTitle")}
          </h2>
          <span className="text-xs text-ink-3">{t("documents.oldLead")}</span>
        </div>
        <DataList
          view={view}
          rows={rows}
          columns={columns}
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

      {/* New 문서 목록(옛 To-Be 화면) - 올린 문서 목록과 한 화면, 한 스크롤이다. 문서를 못 읽었어도 이 목록은 따로 읽는다 */}
      <ToBeSection
        bundleId={bundleId}
        documents={data}
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
