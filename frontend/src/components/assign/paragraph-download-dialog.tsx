// 문단 Excel 받기 창 - 표 · 삭제한 줄 · 그림 자리 · 옛 문서 목차를 넣을지 묻는다(F1-R2). Space 미리보기(한 단)와 문서 대시보드가 같이 쓴다.
"use client";

import { Download, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_INCLUDE, type ParagraphInclude } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

const KEYS: (keyof ParagraphInclude)[] = ["tables", "deleted", "figures", "toc"];

interface ParagraphDownloadDialogProps {
  busy: boolean;
  onConfirm: (include: ParagraphInclude) => void;
  onClose: () => void;
}

export function ParagraphDownloadDialog({ busy, onConfirm, onClose }: ParagraphDownloadDialogProps) {
  const { t } = useI18n();
  const [include, setInclude] = useState<ParagraphInclude>(DEFAULT_INCLUDE);
  return (
    <Modal
      title={t("assign.paraDownload.title")}
      onClose={onClose}
      testId="space-download-dialog"
      isBusy={busy}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" data-testid="space-download-cancel" disabled={busy} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid="space-download-confirm" disabled={busy} onClick={() => onConfirm(include)}>
            <Download size={16} strokeWidth={1.5} aria-hidden />
            {busy ? t("outputs.exporting") : t("outputs.preview.download")}
          </button>
        </>
      }
    >
      <div className="grid gap-2.5">
        {KEYS.map((key) => (
          <Checkbox key={key} checked={include[key]} onChange={(next) => setInclude((previous) => ({ ...previous, [key]: next }))} testId={`space-download-${key}`} label={t(`assign.paraDownload.${key}`)} />
        ))}
      </div>
    </Modal>
  );
}
