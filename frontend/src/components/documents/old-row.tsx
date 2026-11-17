// Old 목록의 줄 하나(Documents 화면 설계 §5) - 식별(번호 · 버전), 제목 줄(누르면 Assign 한 단 보기), 딸린 정보 줄(언어 배치 · 파일 이름 · EQUIS)을 글자로 읽는다.
// 고치는 칸은 펼친 곳에 있다(줄은 읽기, 펼치면 고치기). 받지 못한 파일은 펼쳐지지 않고 까닭이 줄 아래에 붙는다.
"use client";

import { Download, Eye, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";

import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { DocRow, type RowAction } from "@/components/documents/doc-row";
import { AuxPill, DocStatusPill, getDocReason, WarningChips, WarningCountChip } from "@/components/documents/doc-status";
import { FileName } from "@/components/documents/file-name";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { EquisLink } from "@/components/equis/equis-link";
import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { ClampText } from "@/components/ui/clamp-text";
import { CommitInput } from "@/components/ui/commit-input";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { VersionInput } from "@/components/ui/version-input";
import { LANGUAGE_LAYOUTS, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { canExpandOld, isStrayNew, listOldActions, type OldActionKey } from "@/lib/old-row-model";
import { getEditOriginalHref } from "@/lib/stages";

const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:text-ink-2";

// 언어 배치 드롭다운 고정 폭 - 고정 폭 트리거는 테두리 2 + 왼쪽 여백 8 + 오른쪽 여백(화살표 자리) 22를 쓰니 내용 폭은 178 - 32 = 146px이고, 가장 긴 "KO/EN interleaved"는 그림 22 + 간격 8 + 글자 106 = 136px(맥 Chrome에서 잰 값) - 글꼴 렌더링이 다른 Windows에서도 들어가도록 10px 여유를 둔다
const LAYOUT_SELECT_WIDTH = 178;

type Change = Omit<DocumentUpdateInput, "revision">;

interface OldRowProps {
  document: SopDocument;
  bundleId: number;
  canEdit: boolean;
  /** AI가 번호 · 버전을 읽는 중 */
  isReading: boolean;
  open: boolean;
  onToggle: () => void;
  /** 저장 - 실패하면 알림을 띄우고 throw한다(page.tsx saveField) */
  onSave: (change: Change) => Promise<void>;
  onEquisRefresh: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function OldRow({ document, bundleId, canEdit, isReading, open, onToggle, onSave, onEquisRefresh, onPreview, onDownload, onDelete }: OldRowProps) {
  const { t } = useI18n();
  const prefix = `documents-${document.id}`;
  const { equis } = document;
  const isRead = document.status === "ready";
  const warnings = document.extraction?.warnings ?? [];
  // 제안 칩은 누르면 저장한다 - 거절 알림은 onSave가 띄운다
  const accept = (change: Change) => void onSave(change).catch(() => undefined);
  const actionOf: Record<OldActionKey, RowAction> = {
    preview: { key: "preview", icon: Eye, label: t("documents.preview"), testId: `${prefix}-preview`, run: onPreview },
    download: { key: "download", icon: Download, label: t("documents.download"), testId: `${prefix}-download`, run: onDownload },
    delete: { key: "delete", icon: Trash2, label: t("documents.deleteShort"), testId: `${prefix}-delete`, danger: true, run: onDelete },
  };
  const titleText = document.title.trim();
  const titleBody = titleText === "" ? <span className="doc-title-empty">{t("documents.noTitle")}</span> : document.title;

  return (
    <DocRow
      prefix={prefix}
      kind="old"
      open={open}
      onToggle={onToggle}
      toggleLabel={t("documents.details")}
      expandable={canExpandOld(document)}
      identity={
        <>
          <span className="doc-id-line">
            {document.doc_code === "" ? (
              <span className="doc-id-empty" data-testid={`${prefix}-code-text`}>
                {t("documents.noNumber")}
              </span>
            ) : (
              <ClampText text={document.doc_code} className="doc-code" testId={`${prefix}-code-text`} />
            )}
            {/* AI 제안은 빈 번호 바로 옆 - 누르면 저장되고, 펼친 곳에서 다른 값을 적어 고칠 수도 있다 */}
            {canEdit && !document.doc_code && document.ai_meta?.doc_code && <AiSuggestChip value={document.ai_meta.doc_code} testId={`${prefix}-code-ai`} onAccept={() => accept({ doc_code: document.ai_meta?.doc_code ?? "" })} />}
            {isReading && (
              <Tooltip label={t("documents.aiReading")}>
                <span className="inline-flex text-st-ai" tabIndex={0} role="img" aria-label={t("documents.aiReading")} data-testid={`${prefix}-ai-reading`}>
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
                </span>
              </Tooltip>
            )}
            {/* 읽지 못해 New 목록 줄이 없는 New 파일만 표시한다(도메인 용어라 영어) - Old 표시는 목록 머리가 말한다 */}
            {isStrayNew(document) && (
              <span className="side-tag new" data-testid={`${prefix}-side`}>
                New
              </span>
            )}
          </span>
          {isRead && (
            <span className="doc-id-line doc-ver">
              {document.doc_version === "" ? (
                // 버전이 비면 검토를 요청할 수 없다(missing_doc_versions) - 그래서 호박색 알약
                <span className="pill warn" data-testid={`${prefix}-version-text`}>
                  {t("documents.noVersion")}
                </span>
              ) : (
                <span data-testid={`${prefix}-version-text`}>v{document.doc_version}</span>
              )}
              {/* 비어 있으면 EQUIS의 지금 판을 제안한다 - 이 칸은 올린 파일의 판이라 자동으로 넣지 않는다("지금 판이 아님" 판정이 뜻을 잃는다) */}
              {canEdit && !document.doc_version && !document.ai_meta?.doc_version && equis?.current?.version && (
                <button type="button" className="ai-suggest" data-testid={`${prefix}-version-equis`} aria-label={t("documents.acceptEquis", { value: equis.current.version })} onClick={() => accept({ doc_version: equis.current?.version ?? "" })}>
                  <span className="truncate font-mono">{equis.current.version}</span>
                  <span className="src-badge">EQUIS</span>
                </button>
              )}
              {canEdit && !document.doc_version && document.ai_meta?.doc_version && <AiSuggestChip value={document.ai_meta.doc_version} testId={`${prefix}-version-ai`} onAccept={() => accept({ doc_version: document.ai_meta?.doc_version ?? "" })} />}
            </span>
          )}
        </>
      }
      title={
        <>
          {isRead ? (
            // 제목은 링크다(그 문서가 Assign 한 단 보기로 열린다) - 포커스는 링크에 한 번만 선다
            <ClampText text={titleText === "" ? t("documents.noTitle") : document.title} tabbable={false}>
              <Link className="doc-title-link" href={getEditOriginalHref(bundleId, document.id)} data-testid={`${prefix}-title`}>
                {titleBody}
              </Link>
            </ClampText>
          ) : (
            <ClampText text={titleText === "" ? t("documents.noTitle") : document.title} testId={`${prefix}-title`}>
              {titleBody}
            </ClampText>
          )}
          {/* 제목 줄은 글 + 끝 묶음 두 칸이라 자물쇠와 EQUIS 링크를 한 묶음에 */}
          {(equis?.title_locked === true || Boolean(equis?.doc_url)) && (
            <span className="inline-flex items-center">
              {equis?.title_locked === true && <TitleLock testId={`${prefix}-title-lock`} />}
              {equis?.doc_url && <EquisLink href={equis.doc_url} testId={`${prefix}-equis-link`} />}
            </span>
          )}
        </>
      }
      meta={
        <>
          {isRead && (
            <span data-testid={`${prefix}-layout-text`}>
              <LayoutLabel layout={document.language_layout} label={t(`layoutKind.${document.language_layout}`)} />
            </span>
          )}
          <span className="doc-meta-file">
            <FileName name={document.file_name} testId={`${prefix}-file`} />
          </span>
          {/* 누르면 지금의 정보 창(Look up again · Use current number) - 좁으면 CSS가 글자를 감추고 아이콘만 남긴다(.equis-text) */}
          {equis && <EquisStatus equis={equis} testId={`${prefix}-equis`} canEdit={canEdit} onRefresh={onEquisRefresh} onUseCurrentNumber={() => accept({ doc_code: equis.number })} />}
        </>
      }
      below={
        !isRead && (
          <span className="doc-why" data-testid={`${prefix}-reason`}>
            {getDocReason(document, t)}
          </span>
        )
      }
      state={
        <>
          {warnings.length > 0 && <WarningCountChip warnings={warnings} testId={`${prefix}-warnings`} />}
          {/* 보조 검사는 예외만 - 정상(Checked)은 펼친 곳에 */}
          {document.extraction && document.extraction.aux_status !== "ok" && <AuxPill document={document} testId={`${prefix}-aux`} />}
          <DocStatusPill status={document.status} testId={`${prefix}-status`} />
        </>
      }
      actions={listOldActions(document, canEdit).map((key) => actionOf[key])}
      panel={() => <OldPanel document={document} prefix={prefix} canEdit={canEdit} onSave={onSave} onEquisRefresh={onEquisRefresh} />}
    />
  );
}

interface OldPanelProps {
  document: SopDocument;
  prefix: string;
  canEdit: boolean;
  onSave: (change: Change) => Promise<void>;
  onEquisRefresh: () => void;
}

/** 펼친 곳 - 왼쪽은 고치는 칸(칸마다 바로 저장), 오른쪽은 EQUIS와 읽은 결과. 읽기 전용이면 값을 글자로만 */
function OldPanel({ document, prefix, canEdit, onSave, onEquisRefresh }: OldPanelProps) {
  const { t } = useI18n();
  const { equis } = document;
  const isTitleLocked = equis?.title_locked === true;
  // 칸이 저장 실패를 알면 적던 글을 거둔다(CommitInput) - 알림은 onSave가 띄운다
  const commit = (change: Change) => onSave(change).then(() => true, () => false);
  const accept = (change: Change) => void onSave(change).catch(() => undefined);
  const layoutLabel = <LayoutLabel layout={document.language_layout} label={t(`layoutKind.${document.language_layout}`)} />;

  return (
    <div className="doc-panel-grid">
      <div className="doc-panel-col doc-fields">
        <span className="doc-field-label">{t("documents.colCode")}</span>
        {canEdit ? (
          // 빈 번호도 저장한다(줄의 칸에서 고치던 때와 같다)
          <CommitInput className={`${CELL_INPUT} font-mono`} testId={`${prefix}-code`} value={document.doc_code} maxLength={100} placeholder={t("documents.colCode")} ariaLabel={t("documents.colCode")} onCommit={(doc_code) => commit({ doc_code })} />
        ) : (
          <span className="doc-field-text font-mono" data-testid={`${prefix}-code`}>
            {document.doc_code || t("documents.noNumber")}
          </span>
        )}

        <span className="doc-field-label">{t("documents.colVersion")}</span>
        {canEdit ? (
          <span className="flex min-w-0">
            <VersionInput value={document.doc_version} testId={`${prefix}-version`} onCommit={(doc_version) => accept({ doc_version })} />
          </span>
        ) : (
          <span className="doc-field-text" data-testid={`${prefix}-version`}>
            {document.doc_version || t("documents.noVersion")}
          </span>
        )}

        <span className="doc-field-label">{t("documents.colTitle")}</span>
        <span className="flex min-w-0 items-center gap-1">
          {canEdit ? (
            <CommitInput className={`${CELL_INPUT} min-w-0 text-ellipsis`} testId={`${prefix}-title-input`} value={document.title} maxLength={500} ariaLabel={t("documents.colTitle")} disabled={isTitleLocked} onCommit={(title) => commit({ title })} />
          ) : (
            <span className="doc-field-text" data-testid={`${prefix}-title-input`}>
              {document.title || t("documents.noTitle")}
            </span>
          )}
          {isTitleLocked && <TitleLock testId={`${prefix}-title-lock-field`} />}
        </span>

        <span className="doc-field-label">{t("documents.colLayout")}</span>
        {canEdit ? (
          <Select
            testId={`${prefix}-layout`}
            ariaLabel={t("documents.colLayout")}
            size="sm"
            width={LAYOUT_SELECT_WIDTH}
            value={document.language_layout}
            options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} />, tip: t(`layoutKind.${layout}`) }))}
            onChange={(next) => accept({ language_layout: next })}
          />
        ) : (
          <span className="doc-field-text" data-testid={`${prefix}-layout`}>
            {layoutLabel}
          </span>
        )}
      </div>

      <div className="doc-panel-col doc-fields">
        {equis && (
          <>
            <span className="doc-field-label">EQUIS</span>
            <span className="flex min-w-0">
              <EquisStatus equis={equis} testId={`${prefix}-panel-equis`} canEdit={canEdit} onRefresh={onEquisRefresh} onUseCurrentNumber={() => accept({ doc_code: equis.number })} />
            </span>
          </>
        )}
        <span className="doc-field-label">{t("documents.colExtraction")}</span>
        <span className="flex min-w-0">
          <DocStatusPill status={document.status} testId={`${prefix}-panel-status`} />
        </span>
        <span className="doc-field-label">{t("documents.colAux")}</span>
        <span className="flex min-w-0">
          <AuxPill document={document} testId={`${prefix}-panel-aux`} />
        </span>
        <span className="doc-field-label">{t("documents.colWarnings")}</span>
        <WarningChips warnings={document.extraction?.warnings ?? []} testId={`${prefix}-warnings-list`} />
      </div>
    </div>
  );
}
