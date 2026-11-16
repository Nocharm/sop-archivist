// New 목록의 줄 하나(Documents 화면 설계 §6) - 식별(종류 · 번호 · EQUIS), 제목 줄, 딸린 정보 줄을 글자로 읽는다. 고치는 칸은 펼친 곳(ToBePanel)에 있다.
"use client";

import { Pencil, Trash2, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { DocRow, type RowAction } from "@/components/documents/doc-row";
import { FileName } from "@/components/documents/file-name";
import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { SlotBar } from "@/components/tobe/slot-bar";
import { ClampText } from "@/components/ui/clamp-text";
import type { EquisInfo, SopDocument, TargetDoc, ToBe } from "@/lib/api-sop";
import { getDocRemoveBlock } from "@/lib/destination-manage-model";
import { useI18n } from "@/lib/i18n";
import type { SlotRow, SlotSummary } from "@/lib/slot-status-model";
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
  /** SOP 줄의 칸 15개와 그 요약(목록이 줄마다 한 번 센다) - WI는 null */
  slots: { rows: readonly SlotRow[]; summary: SlotSummary } | null;
  /** EQUIS가 아는 값의 제안 수 - 고칠 수 있을 때만 센다 */
  hintCount: number;
  /** 상위 SOP를 못 찾은 WI(있어서는 안 되는 자료) */
  noParent: boolean;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  /** 접어도 남은, 저장하지 않은 N/A 사유가 이 줄에 있다 */
  hasUnsavedNa: boolean;
  onRemove: () => void;
  onEquisRefresh: () => void;
  panel: () => ReactNode;
}

export function ToBeRow({ doc, isChild, tobe, saved, written, equis, stepCount, slots, hintCount, noParent, canEdit, open, onToggle, hasUnsavedNa, onRemove, onEquisRefresh, panel }: ToBeRowProps) {
  const { t } = useI18n();
  const prefix = `tobe-${doc.key}`;
  const block = saved ? getDocRemoveBlock(tobe, saved) : null;
  const isWritten = doc.entrance === "match";
  // 줄에 이름을 적는 N/A 칸 - 덮인 칸도 N/A로 센다(요약의 na와 같은 집합)
  const firstNa = slots?.rows.find((row) => row.state.kind === "na" || row.state.kind === "covered");
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
          {/* 이미 쓴 SOP는 칸이 파일의 절을 따라 문장 수를 세지 않는다 - 막대와 "n of 15" 없이 N/A · 정할 칸만 */}
          {slots !== null && !isWritten && (
            <>
              <SlotBar rows={slots.rows} testId={`${prefix}-bar`} />
              <span data-testid={`${prefix}-filled`}>{t("tobe.row.filled", { filled: slots.summary.filled, total: slots.rows.length })}</span>
            </>
          )}
          {slots !== null && firstNa !== undefined && (
            <span className="meta-na" data-testid={`${prefix}-na-summary`}>
              <span className="pill quiet">{t("tobe.row.na", { n: slots.summary.na })}</span>
              {/* 자리가 모자라면 칸 이름이 말줄임으로 줄고 "+k"는 남는다 */}
              <span className="meta-na-name">
                <span className="meta-na-label">
                  {firstNa.number} {firstNa.label}
                </span>
                {slots.summary.na > 1 && <span className="flex-none">{` +${slots.summary.na - 1}`}</span>}
              </span>
            </span>
          )}
          {slots !== null && slots.summary.decide > 0 && (
            <span className="pill warn" data-testid={`${prefix}-decide`}>
              {t("tobe.slots.decide", { n: slots.summary.decide })}
            </span>
          )}
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
              <span className="meta-eq-text">{t("tobe.colEquipment")}</span>
            </span>
          )}
          {doc.doc_type === "wi" && <span data-testid={`${prefix}-steps-count`}>{t("tobe.row.steps", { n: stepCount })}</span>}
          {/* 제안 자체는 펼친 곳의 그 칸 옆에 있다 - 칩은 펼치기만 한다 */}
          {hintCount > 0 && (
            <button
              type="button"
              className="equis-hint"
              data-testid={`${prefix}-hints`}
              onClick={() => {
                if (!open) onToggle();
              }}
            >
              <span className="src-badge">EQUIS</span>
              {t("tobe.row.equisHints", { n: hintCount })}
            </button>
          )}
          {noParent && (
            <span className="pill warn" data-testid={`${prefix}-no-parent`}>
              {t("tobe.row.noParent")}
            </span>
          )}
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
