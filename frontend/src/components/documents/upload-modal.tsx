// 문서 업로드 - Old SOP(입구 1) 파일을 하나씩 차례로 올린다. 이미 쓴 New 문서는 To-Be 화면에서 올린다. 서버가 올릴 때 바로 추출하고
// 문서 번호·버전·언어 배치를 미리 채우므로, 파일마다 결과와 채운 값(출처 표)을 보이고 그 자리에서 고칠 수 있다.
"use client";

import { Loader2, Scissors, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { DocStatusPill, getDocReason } from "@/components/documents/doc-status";
import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { InlineText } from "@/components/inline-text";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { VersionInput } from "@/components/ui/version-input";
import { humanizeApiError } from "@/lib/api-errors";
import { LANGUAGE_LAYOUTS, updateDocument, uploadDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";

interface UploadRow {
  name: string;
  state: "waiting" | "uploading" | "done" | "error";
  document?: SopDocument;
  error?: unknown;
  /** 서버가 채운 칸의 출처 - 사람이 고친 칸은 지운다 */
  sources?: Partial<Record<PrefillField, PrefillSource>>;
}

type PrefillField = "doc_code" | "doc_version" | "language_layout";
type PrefillSource = "file_name" | "content" | "ai";

function SourceBadge({ source }: { source: PrefillSource | undefined }) {
  const { t } = useI18n();
  if (!source) return null;
  return <span className={`src-badge ${source}`}>{t(`documents.source.${source}`)}</span>;
}

interface UploadModalProps {
  bundleId: number;
  onClose: () => void;
  /** 파일 하나가 끝날 때마다 - 목록을 바로 다시 그린다 */
  onUploaded: () => void;
  /** 부모가 다시 읽은 최신 문서 - 업로드 뒤 늦게 끝나는 AI 제안(ai_meta)을 결과 행에 보인다 */
  latest?: SopDocument[];
}

export function UploadModal({ bundleId, onClose, onUploaded, latest = [] }: UploadModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const running = rows?.some((row) => row.state === "waiting" || row.state === "uploading") ?? false;

  // 결과 행에서 바로 고친다 - 고친 칸은 출처 표가 사라진다
  async function saveRow(index: number, field: PrefillField, change: Omit<DocumentUpdateInput, "revision">) {
    const document = rows?.[index]?.document;
    if (!document) return;
    try {
      const updated = await updateDocument(bundleId, document.id, { revision: document.revision, ...change });
      setRows((prev) =>
        prev?.map((row, i) => {
          if (i !== index) return row;
          const sources = { ...row.sources };
          delete sources[field];
          return { ...row, document: updated, sources };
        }) ?? null,
      );
      onUploaded();
    } catch (error) {
      showToast(humanizeApiError(error, t), "error");
    }
  }

  async function handleUpload() {
    const queue = files.map((file): UploadRow => ({ name: file.name, state: "waiting" }));
    setRows(queue);
    // 동시에 올리면 서버 파싱 자리(최대 2)를 다투므로 차례로 올린다
    for (const [index, file] of files.entries()) {
      setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "uploading" } : row)) ?? null);
      try {
        const document = await uploadDocument(bundleId, { file, side: "old" });
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "done", document, sources: document.prefill_sources ?? {} } : row)) ?? null);
        onUploaded();
      } catch (error) {
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "error", error } : row)) ?? null);
      }
    }
  }

  const hasReady = rows?.some((row) => row.document?.status === "ready") ?? false;
  const footer =
    rows === null ? (
      <>
        <button type="button" className="btn" data-testid="upload-cancel" onClick={onClose}>
          <X size={16} strokeWidth={1.5} aria-hidden />
          {t("common.cancel")}
        </button>
        <button type="button" className="btn pri" data-testid="upload-submit" disabled={files.length === 0} onClick={() => void handleUpload()}>
          {t("documents.uploadCount", { n: files.length })}
        </button>
      </>
    ) : (
      <>
        <button type="button" className={hasReady ? "btn" : "btn pri"} data-testid="upload-done" disabled={running} onClick={onClose}>
          {t("common.close")}
        </button>
        {/* 읽힌 문서가 있으면 다음 단계로 바로 간다 - 닫고 레일에서 Split을 다시 찾지 않게 */}
        {hasReady && !running && (
          <Link href={getStageHref(bundleId, "split")} className="btn pri" data-testid="upload-go-split" onClick={onClose}>
            <Scissors size={16} strokeWidth={1.5} aria-hidden />
            {t("upload.goSplit")}
          </Link>
        )}
      </>
    );

  return (
    <Modal title={t("documents.upload")} onClose={onClose} isBusy={running} testId="upload" footer={footer} size="xl">
      {rows === null ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".docx,.pdf"
              data-testid="upload-files"
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <button type="button" className="btn" data-testid="upload-pick" onClick={() => fileRef.current?.click()}>
              <Upload size={16} strokeWidth={1.5} aria-hidden />
              {t("documents.pickFiles")}
            </button>
            <p className="text-xs text-ink-3">{t("documents.pickHint")}</p>
            {files.length > 0 && (
              <ul className="space-y-0.5 font-mono text-xs text-ink-2" data-testid="upload-picked">
                {files.map((file) => (
                  <li key={file.name} className="truncate">
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="upload-results" data-testid="upload-results">
          <div className="upload-row head">
            <span>{t("documents.file")}</span>
            <span>{t("documents.colCode")}</span>
            <span>{t("documents.colVersion")}</span>
            <span>{t("documents.colLayout")}</span>
          </div>
          {rows.map((row, index) => {
            const document = row.state === "done" ? row.document : undefined;
            const aiMeta = document ? latest.find((item) => item.id === document.id)?.ai_meta : undefined;
            const editable = document?.status === "ready";
            return (
              <div key={row.name} className="upload-row" data-testid={`upload-row-${index}`}>
                <span className="grid min-w-0 gap-0.5">
                  <span className="block truncate font-mono text-xs">{row.name}</span>
                  {row.state === "uploading" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                      <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
                      {t("documents.reading")}
                    </span>
                  ) : document ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <DocStatusPill status={document.status} />
                      {document.status !== "ready" && <span className="text-xs text-danger">{getDocReason(document, t)}</span>}
                    </span>
                  ) : row.state === "error" ? (
                    <span className="text-xs text-danger">{humanizeApiError(row.error, t)}</span>
                  ) : (
                    <span className="text-xs text-ink-4">{t("documents.waiting")}</span>
                  )}
                </span>
                {document && editable ? (
                  <>
                    <span className="src-cell">
                      <InlineText
                        value={document.doc_code}
                        placeholder={t("documents.colCode")}
                        editable
                        mono
                        width="fill"
                        maxLength={100}
                        testId={`upload-row-${index}-code`}
                        onSave={(doc_code) => saveRow(index, "doc_code", { doc_code })}
                      />
                      <SourceBadge source={row.sources?.doc_code} />
                      {!document.doc_code && aiMeta?.doc_code && (
                        <AiSuggestChip value={aiMeta.doc_code} testId={`upload-row-${index}-code-ai`} onAccept={() => void saveRow(index, "doc_code", { doc_code: aiMeta.doc_code ?? "" })} />
                      )}
                    </span>
                    <span className="src-cell">
                      <VersionInput value={document.doc_version} testId={`upload-row-${index}-version`} onCommit={(doc_version) => void saveRow(index, "doc_version", { doc_version })} />
                      <SourceBadge source={row.sources?.doc_version} />
                      {!document.doc_version && aiMeta?.doc_version && (
                        <AiSuggestChip value={aiMeta.doc_version} testId={`upload-row-${index}-version-ai`} onAccept={() => void saveRow(index, "doc_version", { doc_version: aiMeta.doc_version ?? "" })} />
                      )}
                    </span>
                    <span className="src-cell">
                      <Select
                        testId={`upload-row-${index}-layout`}
                        ariaLabel={t("documents.colLayout")}
                        size="sm"
                        value={document.language_layout}
                        options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} /> }))}
                        onChange={(language_layout) => void saveRow(index, "language_layout", { language_layout })}
                      />
                      <SourceBadge source={row.sources?.language_layout} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-ink-4">–</span>
                    <span className="text-ink-4">–</span>
                    <span className="text-ink-4">–</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
