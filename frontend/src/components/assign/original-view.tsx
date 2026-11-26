// 원본 보기 - 원본 DOCX를 회색 책상 위 종이(인쇄 미리보기)로 그리고 고른 Unit의 문단(칸)을 칠해 따라간다(읽기만, D10).
// 그리기는 lib/use-original-render.ts(그림자 뿌리 안), 칠 · 굴림 · 배율 · 쪽 칩은 lib/use-original-follow.ts - 이 파일에는 이펙트가 없다.
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.2~5.5 (D7~D10)
"use client";

import { Download, RefreshCw } from "lucide-react";
import { useRef } from "react";

import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadOriginalFile } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { pickFollowTarget } from "@/lib/original-page-model";
import { saveBlob } from "@/lib/save-file";
import { useOriginalFollow } from "@/lib/use-original-follow";
import { useOriginalRender } from "@/lib/use-original-render";

export interface OriginalViewProps {
  bundleId: number;
  docId: number;
  /** 따라갈 고른 Unit들 - 표지가 있는 첫 Unit으로 간다 */
  pickedUnitIds: readonly number[];
  /** 글쇠를 꾹 누른 반복 중 - 움직임 없이 바로 간다 */
  repeating: boolean;
  testId: string;
}

export function OriginalView({ bundleId, docId, pickedUnitIds, repeating, testId }: OriginalViewProps) {
  const { t } = useI18n();
  const { state, host, marks, pageCount, renderedDocId, retry } = useOriginalRender(bundleId, docId);
  const scroller = useRef<HTMLDivElement | null>(null);
  const target = pickFollowTarget({ renderedDocId, docId, pickedUnitIds, marks });
  const { page } = useOriginalFollow({ host, scroller, target, repeating, renderedDocId, pageCount });
  const isBusy = state === "loading";
  const isReady = state === "ready";
  const isMissed = isReady && target !== null && target.marks.every((mark) => mark.id === "");

  async function handleDownload() {
    try {
      const { blob, fileName } = await downloadOriginalFile(bundleId, docId);
      saveBlob(blob, fileName ?? `document-${docId}`);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  const downloadButton = (
    // 누르기로 포커스를 가져가지 않는다 - Space 시트 안이라 포커스가 남으면 다음 Space 탁이 시트를 닫지 않고 또 받는다(시트 받기 단추와 같다)
    <button type="button" className="btn" data-testid={`${testId}-download`} onPointerDown={(event) => event.preventDefault()} onClick={() => void handleDownload()}>
      <Download size={14} strokeWidth={1.5} aria-hidden />
      {t("assign.original.download")}
    </button>
  );

  return (
    <div className="ov" data-testid={testId} data-state={state}>
      {isMissed && (
        <p className="ov-note" data-testid={`${testId}-missed`}>
          {t("assign.original.missed")}
        </p>
      )}
      {/* host는 상태와 상관없이 늘 둔다 - 그리기 훅이 이 자리에 그림자 뿌리를 연다 */}
      <div ref={scroller} className="ov-scroll" hidden={!isBusy && !isReady}>
        <div ref={host} className="ov-host" data-busy={isBusy ? "" : undefined} data-ready={isReady ? "" : undefined} />
      </div>
      {isBusy && (
        <div className="ov-shimmer" role="status" aria-label={t("assign.original.loading")} data-testid={`${testId}-loading`}>
          <span className="sk" />
        </div>
      )}
      {isReady && pageCount > 0 && (
        <span key={page} className="ov-chip" data-testid={`${testId}-page-chip`}>
          {t("assign.original.pageChip", { page, total: pageCount })}
        </span>
      )}
      {state === "pdf" && (
        <div className="ov-empty" data-testid={`${testId}-pdf`}>
          {t("assign.original.pdf")}
          {downloadButton}
        </div>
      )}
      {state === "none" && (
        <div className="ov-empty" data-testid={`${testId}-none`}>
          {t("assign.original.none")}
        </div>
      )}
      {state === "error" && (
        <div className="ov-empty" role="alert" data-testid={`${testId}-error`}>
          {t("assign.original.failed")}
          <div className="ov-empty-actions">
            <button type="button" className="btn" data-testid={`${testId}-retry`} onPointerDown={(event) => event.preventDefault()} onClick={retry}>
              <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
              {t("common.retry")}
            </button>
            {downloadButton}
          </div>
        </div>
      )}
    </div>
  );
}
