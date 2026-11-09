// 문서 올리기 - 옛 SOP(입구 1) 또는 새 문서(입구 2)를 고르고 파일을 하나씩 차례로 올린다. 서버가 올릴 때 바로 추출하므로 파일마다 결과를 보인다.
"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { DocStatusPill, getDocReason } from "@/components/documents/doc-status";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";
import { humanizeApiError } from "@/lib/api-errors";
import { uploadDocument, type DocSide, type SopDocument, type TargetDocType } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { INPUT_FIELD } from "@/lib/ui-classes";

interface UploadRow {
  name: string;
  state: "waiting" | "uploading" | "done" | "error";
  document?: SopDocument;
  error?: unknown;
}

interface UploadModalProps {
  bundleId: number;
  onClose: () => void;
  /** 파일 하나가 끝날 때마다 - 목록을 바로 다시 그린다 */
  onUploaded: () => void;
}

export function UploadModal({ bundleId, onClose, onUploaded }: UploadModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<DocSide>("old");
  const [docType, setDocType] = useState<TargetDocType>("sop");
  const [parentCode, setParentCode] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const running = rows?.some((row) => row.state === "waiting" || row.state === "uploading") ?? false;

  async function handleUpload() {
    const queue = files.map((file): UploadRow => ({ name: file.name, state: "waiting" }));
    setRows(queue);
    // 동시에 올리면 서버 파싱 자리(최대 2)를 다투므로 차례로 올린다
    for (const [index, file] of files.entries()) {
      setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "uploading" } : row)) ?? null);
      try {
        const document = await uploadDocument(bundleId, { file, side, docType, parentCode: parentCode.trim() });
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "done", document } : row)) ?? null);
        onUploaded();
      } catch (error) {
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "error", error } : row)) ?? null);
      }
    }
  }

  const footer =
    rows === null ? (
      <>
        <button type="button" className="btn" data-testid="upload-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn pri" data-testid="upload-submit" disabled={files.length === 0} onClick={() => void handleUpload()}>
          {t("documents.uploadCount", { n: files.length })}
        </button>
      </>
    ) : (
      <button type="button" className="btn pri" data-testid="upload-done" disabled={running} onClick={onClose}>
        {t("common.close")}
      </button>
    );

  return (
    <Modal title={t("documents.upload")} onClose={onClose} isBusy={running} testId="upload" footer={footer}>
      {rows === null ? (
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-ink-2">{t("documents.uploadSide")}</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="side" data-testid="upload-side-old" checked={side === "old"} className="mt-1" onChange={() => setSide("old")} />
              <span>
                {t("documents.sideOldLong")}
                <span className="block text-xs text-ink-3">{t("documents.sideOldHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="side" data-testid="upload-side-new" checked={side === "new"} className="mt-1" onChange={() => setSide("new")} />
              <span>
                {t("documents.sideNewLong")}
                <span className="block text-xs text-ink-3">{t("documents.sideNewHint")}</span>
              </span>
            </label>
          </fieldset>
          {side === "new" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-ink-2">{t("documents.docType")}</span>
                <Select
                  testId="upload-doc-type"
                  ariaLabel={t("documents.docType")}
                  className="w-full"
                  value={docType}
                  options={[
                    { value: "sop", label: "SOP" },
                    { value: "wi", label: "WI" },
                  ]}
                  onChange={setDocType}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-ink-2">{t("documents.parentCode")}</span>
                <input data-testid="upload-parent-code" className={`${INPUT_FIELD} font-mono`} value={parentCode} maxLength={100} onChange={(event) => setParentCode(event.target.value)} />
              </label>
            </div>
          )}
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
        <ul className="divide-y divide-line" data-testid="upload-results">
          {rows.map((row) => (
            <li key={row.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{row.name}</span>
                {row.state === "done" && row.document && row.document.status !== "ready" && (
                  <span className="block text-xs text-danger">{getDocReason(row.document, t)}</span>
                )}
                {row.state === "error" && <span className="block text-xs text-danger">{humanizeApiError(row.error, t)}</span>}
              </span>
              {row.state === "uploading" ? (
                <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
                  {t("documents.reading")}
                </span>
              ) : row.state === "done" && row.document ? (
                <DocStatusPill status={row.document.status} />
              ) : row.state === "error" ? (
                <span className="pill danger">{t("documents.notUploaded")}</span>
              ) : (
                <span className="text-xs text-ink-4">{t("documents.waiting")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
