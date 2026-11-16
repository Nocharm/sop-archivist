// New 목록의 줄 하나(Documents 화면 설계 §6) - 식별(종류 · 번호 · EQUIS), 제목 줄, 딸린 정보 줄을 글자로 읽는다. 고치는 칸은 펼친 곳(ToBePanel)에 있다.
"use client";

import { Pencil, Trash2, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { DocRow, type RowAction } from "@/components/documents/doc-row";
import { FileName } from "@/components/documents/file-name";
import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { ClampText } from "@/components/ui/clamp-text";
import type { EquisInfo, SopDocument, TargetDoc, ToBe } from "@/lib/api-sop";
import { getDocRemoveBlock } from "@/lib/destination-manage-model";
import { useI18n } from "@/lib/i18n";
import type { DraftDoc } from "@/lib/tobe-draft";

const REMOVE_BLOCK_KEYS = {
  written: "tobe.matchLocked",
  hasSentences: "assign.tree.why.hasSentences",
  hasChildren: "assign.tree.why.hasChildren",
} as const;

interface ToBeRowProps {
  doc: DraftDoc;
  /** SOP 아래 들인 WI */
  isChild: boolean;
  tobe: ToBe;
  /** 저장된 줄 - 빼기를 막는 까닭을 이것으로 읽는다 */
  saved: TargetDoc | undefined;
  /** 이 줄에 붙은 쓴 파일 */
  written: SopDocument | null;
  equis: EquisInfo | null;
  stepCount: number;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  /** 접어도 남은, 저장하지 않은 N/A 사유가 이 줄에 있다 */
  hasUnsavedNa: boolean;
  onRemove: () => void;
  onEquisRefresh: () => void;
  panel: () => ReactNode;
}

export function ToBeRow({ doc, isChild, tobe, saved, written, equis, stepCount, canEdit, open, onToggle, hasUnsavedNa, onRemove, onEquisRefresh, panel }: ToBeRowProps) {
  const { t } = useI18n();
  const prefix = `tobe-${doc.key}`;
  const block = saved ? getDocRemoveBlock(tobe, saved) : null;
  const actions: RowAction[] = canEdit
    ? [
        { key: "edit", icon: Pencil, label: t("common.edit"), testId: `${prefix}-edit`, run: onToggle },
        { key: "remove", icon: Trash2, danger: true, label: t("tobe.removeDoc"), testId: `${prefix}-remove`, blocked: block === null ? undefined : t(REMOVE_BLOCK_KEYS[block]), run: onRemove },
      ]
    : [];
  const code = doc.code.trim();
  return (
    <DocRow
      prefix={prefix}
      kind={doc.doc_type}
      isChild={isChild}
      open={open}
      onToggle={onToggle}
      toggleLabel={t("tobe.details")}
      identity={
        <>
          <span className="doc-kind" data-testid={`${prefix}-kind`}>
            {doc.doc_type === "sop" ? "SOP" : "WI"}
          </span>
          <ClampText text={code || t("tobe.noCode")} className="doc-code" testId={`${prefix}-code-text`}>
            {code || t("tobe.noCode")}
          </ClampText>
          {equis && <EquisStatus equis={equis} testId={`${prefix}-equis`} compact canEdit={canEdit} onRefresh={onEquisRefresh} />}
        </>
      }
      title={
        <>
          {doc.title.trim() === "" ? (
            <span className="doc-title-empty" data-testid={`${prefix}-title-text`}>
              {t("tobe.row.noTitle")}
            </span>
          ) : (
            <ClampText text={doc.title} testId={`${prefix}-title-text`} />
          )}
          {equis?.title_locked === true && <TitleLock testId={`${prefix}-title-lock`} />}
        </>
      }
      meta={
        <>
          {written ? (
            <span className="doc-meta-file">
              <FileName name={written.file_name} testId={`${prefix}-written`} />
              {written.doc_version !== "" && <span className="doc-meta-ver">v{written.doc_version}</span>}
            </span>
          ) : (
            <span data-testid={`${prefix}-not-written`}>{t("tobe.notWritten")}</span>
          )}
          {doc.doc_type === "sop" && doc.is_equipment_sop && (
            <span className="doc-meta-tag" data-testid={`${prefix}-equipment-tag`}>
              <Wrench size={12} strokeWidth={1.5} aria-hidden />
              {t("tobe.colEquipment")}
            </span>
          )}
          {doc.doc_type === "wi" && <span data-testid={`${prefix}-steps-count`}>{t("tobe.row.steps", { n: stepCount })}</span>}
          {hasUnsavedNa && (
            <span className="pill warn" data-testid={`${prefix}-unsaved`}>
              {t("tobe.slots.unsaved")}
            </span>
          )}
        </>
      }
      actions={actions}
      panel={panel}
    />
  );
}
