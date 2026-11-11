// To-Be 화면의 "이미 쓴 문서 올리기" 창 - New SOP·WI 파일 하나를 올린다. 서버가 읽어 To-Be 목록에 입구 2(Match) 줄을 만든다.
"use client";

import { Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { getDocReason } from "@/components/documents/doc-status";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { uploadDocument, type TargetDocType } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { INPUT_FIELD } from "@/lib/ui-classes";

interface UploadWrittenProps {
  bundleId: number;
  onClose: () => void;
  /** 올리기가 끝났다 - 목록을 다시 불러온다 */
  onUploaded: () => void;
}

export function UploadWritten({ bundleId, onClose, onUploaded }: UploadWrittenProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<TargetDocType>("sop");
  const [parentCode, setParentCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!file) return;
    setBusy(true);
    try {
      const document = await uploadDocument(bundleId, { file, side: "new", docType, parentCode: docType === "wi" ? parentCode.trim() : "" });
      // 읽기에 실패·거절된 파일도 문서로 남지만 목록 줄은 만들지 않는다 - 그때는 사유만 알리고 창은 닫는다
      if (document.status !== "ready") {
        showToast(getDocReason(document, t), "error");
      }
      onUploaded();
      onClose();
    } catch (error) {
      showToast(humanizeApiError(error, t), "error");
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn" data-testid="tobe-upload-written-cancel" disabled={busy} onClick={onClose}>
        <X size={16} strokeWidth={1.5} aria-hidden />
        {t("common.cancel")}
      </button>
      <button type="button" className="btn pri" data-testid="tobe-upload-written-submit" disabled={!file || busy} onClick={() => void handleSubmit()}>
        {t("tobe.uploadWritten.submit")}
      </button>
    </>
  );

  return (
    <Modal title={t("tobe.uploadWritten")} onClose={onClose} isBusy={busy} testId="tobe-upload-written-modal" footer={footer} size="md">
      <div className="space-y-3">
        <p className="text-xs text-ink-3">{t("tobe.uploadWritten.hint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-ink-2">{t("documents.docType")}</span>
            <Select
              testId="tobe-upload-written-type"
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
          {docType === "wi" && (
            <label className="space-y-1">
              <span className="text-xs text-ink-2">{t("documents.parentCode")}</span>
              <input data-testid="tobe-upload-written-parent" className={`${INPUT_FIELD} font-mono`} value={parentCode} maxLength={100} onChange={(event) => setParentCode(event.target.value)} />
            </label>
          )}
        </div>
        <div className="space-y-1">
          <input ref={fileRef} type="file" accept=".docx,.pdf" data-testid="tobe-upload-written-file" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="button" className="btn" data-testid="tobe-upload-written-pick" onClick={() => fileRef.current?.click()}>
            <Upload size={16} strokeWidth={1.5} aria-hidden />
            {t("documents.pickFiles")}
          </button>
          <p className="text-xs text-ink-3">{t("documents.pickHint")}</p>
          {file && (
            <p className="truncate font-mono text-xs text-ink-2" data-testid="tobe-upload-written-picked">
              {file.name}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
