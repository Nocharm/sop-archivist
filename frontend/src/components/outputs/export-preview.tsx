// Excel 미리보기 창 - 서버가 지은 시트 모델 네 장을 탭으로 보이고, 받기는 응답 Content-Disposition 이름으로 저장한다(설계 §7.3·§9).
"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { SheetView } from "@/components/outputs/sheet-view";
import { LoadError } from "@/components/ui/load-error";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadExport, getExportPreview } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";
import { useLoaded } from "@/lib/use-loaded";

export function ExportPreviewModal({ bundleId, onClose }: { bundleId: number; onClose: () => void }) {
  const { t } = useI18n();
  const preview = useLoaded(() => getExportPreview(bundleId), String(bundleId));
  const [tabIndex, setTabIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const data = preview.data;
  const sheet = data?.sheets[tabIndex] ?? data?.sheets[0];

  // 저장 이름은 파일 응답의 이름이 먼저고, 헤더를 못 읽으면 미리보기가 알려 준 같은 이름
  async function handleDownload() {
    if (!data) return;
    setDownloading(true);
    try {
      const { blob, fileName } = await downloadExport(bundleId);
      saveBlob(blob, fileName ?? data.file_name);
      showToast(t("outputs.fileCreated"));
    } catch (err) {
      showToast(`${t("outputs.exportFailed")} ${humanizeApiError(err, t)}`, "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal
      title={t("outputs.preview.title")}
      onClose={onClose}
      testId="export-preview"
      size="sheet"
      isBusy={downloading}
      footer={
        <button type="button" className="btn pri" data-testid="export-preview-download" disabled={!data || downloading} onClick={() => void handleDownload()}>
          <Download size={14} strokeWidth={1.5} aria-hidden />
          {downloading ? t("outputs.exporting") : t("outputs.preview.download")}
        </button>
      }
    >
      {preview.error != null && !data && <LoadError error={preview.error} onRetry={preview.reload} testId="export-preview" />}
      {preview.isLoading && !data && preview.error == null && (
        <div className="grid gap-2" aria-busy="true" data-testid="export-preview-loading">
          <span className="sk h-5 w-1/2" />
          <span className="sk h-64 w-full" />
        </div>
      )}
      {data && sheet && (
        <>
          <p className="min-w-0 text-[13px] break-all text-ink-2" data-testid="export-preview-file-name">
            {data.file_name}
          </p>
          <div className="view-toggle flex-wrap">
            {data.sheets.map((item, index) => (
              <button
                key={item.name}
                type="button"
                // view-toggle 단추는 아이콘 폭(26px)이라 시트 이름이 겹친다 - 글 폭으로 넓힌다
                className="w-auto px-2.5 text-xs whitespace-nowrap"
                data-testid={`export-preview-tab-${index}`}
                aria-pressed={index === tabIndex}
                onClick={() => setTabIndex(index)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <SheetView key={tabIndex} sheet={sheet} />
        </>
      )}
    </Modal>
  );
}
