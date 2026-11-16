// New 줄을 펼친 곳(Documents 화면 설계 §6) - 왼쪽 Document(번호 · 제목 · 종류 · 상위 SOP · 장비 SOP · 쓴 파일), 오른쪽 SOP는 칸 상태 표, WI는 단계.
// 칸마다 바로 저장한다(글 칸은 떠나거나 Enter, 고르는 칸은 고르는 즉시). 읽기 전용이면 값을 글자로만 보이고 쓴 파일의 미리 보기 · 내려받기만 남는다.
"use client";

import { Download, Eye, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { LayoutLabel } from "@/components/documents/layout-picto";
import { FileName } from "@/components/documents/file-name";
import { TitleLock } from "@/components/equis/title-lock";
import { Checkbox } from "@/components/ui/checkbox";
import { CommitInput } from "@/components/ui/commit-input";
import { MorphButton } from "@/components/ui/morph-button";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { VersionInput } from "@/components/ui/version-input";
import { LANGUAGE_LAYOUTS, type DocumentUpdateInput, type SopDocument, type TargetDoc, type ToBe, type ToBeDocPatch } from "@/lib/api-sop";
import { getStepCount, getStepRemoveBlock } from "@/lib/destination-manage-model";
import { useI18n } from "@/lib/i18n";
import type { EquisHint } from "@/lib/tobe-add-model";
import type { DraftDoc, DraftStep } from "@/lib/tobe-draft";

const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:text-ink-2";

interface ToBePanelProps {
  doc: DraftDoc;
  /** 단계마다 든 문장 수(sentence_counts)를 읽는다 */
  tobe: ToBe;
  /** 저장된 줄 - 없으면(있어서는 안 된다) 단계의 문장 수를 0으로 읽는다 */
  saved: TargetDoc | undefined;
  /** 상위 SOP로 고를 수 있는 줄 - 목록 순서 */
  sops: readonly DraftDoc[];
  steps: readonly DraftStep[];
  written: SopDocument | null;
  /** EQUIS가 아는 값의 제안 - 고칠 수 있을 때만 온다 */
  hints: readonly EquisHint[];
  isTitleLocked: boolean;
  canEdit: boolean;
  saving: boolean;
  saveDoc: (patch: ToBeDocPatch) => Promise<boolean>;
  changeType: (next: DraftDoc["doc_type"]) => void;
  /** 단계 쓰기 - 더하기 · 이름 고치기 · 빼기 */
  onAddStep: () => void;
  onRenameStep: (stepNo: number, title: string) => Promise<boolean>;
  onRemoveStep: (stepNo: number) => void;
  file: {
    onPreview: (document: SopDocument) => void;
    onDownload: (document: SopDocument) => void;
    onDelete: (document: SopDocument) => void;
    onSave: (document: SopDocument, change: Omit<DocumentUpdateInput, "revision">) => Promise<unknown>;
  };
  /** SOP의 칸 상태 표 - 상태(편집기 · 저장)는 목록이 든다 */
  sections: ReactNode;
}

export function ToBePanel({ doc, tobe, saved, sops, steps, written, hints, isTitleLocked, canEdit, saving, saveDoc, changeType, onAddStep, onRenameStep, onRemoveStep, file, sections }: ToBePanelProps) {
  const { t } = useI18n();
  const prefix = `tobe-${doc.key}`;
  // 쓴 파일이 붙은 줄의 번호와 종류는 그 파일의 것이다
  const isMatch = doc.entrance === "match";
  const typeHint = hints.find((hint) => hint.kind === "type");
  const equipmentHint = hints.find((hint) => hint.kind === "equipment");
  const parentCode = sops.find((sop) => sop.key === doc.parent_key)?.code.trim() || t("tobe.noCode");
  const readStepCount = (stepNo: number) => (saved ? getStepCount(tobe, saved.id, stepNo) : 0);

  return (
    <div className="doc-panel-grid">
      <section className="doc-panel-col" aria-label={t("tobe.panel.document")}>
        <h3 className="doc-panel-head">{t("tobe.panel.document")}</h3>
        <div className="doc-fields">
          <span className="doc-field-label">{t("tobe.colCode")}</span>
          {canEdit ? (
            <CommitInput
              className={`${CELL_INPUT} font-mono`}
              testId={`${prefix}-code`}
              value={doc.code}
              maxLength={100}
              placeholder={t("tobe.codePlaceholder")}
              ariaLabel={t("tobe.colCode")}
              disabled={isMatch}
              // 번호는 비울 수 없다 - 비우고 떠나면 저장된 번호로 돌아간다
              onEmpty={() => undefined}
              onCommit={(code) => saveDoc({ code })}
            />
          ) : (
            <span className="doc-field-text font-mono" data-testid={`${prefix}-code`}>
              {doc.code}
            </span>
          )}

          <span className="doc-field-label">{t("tobe.colTitle")}</span>
          <span className="flex min-w-0 items-center gap-1">
            {canEdit ? (
              <CommitInput className={`${CELL_INPUT} min-w-0 text-ellipsis`} testId={`${prefix}-title`} value={doc.title} maxLength={500} ariaLabel={t("tobe.colTitle")} disabled={isTitleLocked} onCommit={(title) => saveDoc({ title })} />
            ) : (
              <span className="doc-field-text" data-testid={`${prefix}-title`}>
                {doc.title}
              </span>
            )}
            {isTitleLocked && <TitleLock testId={`${prefix}-title-lock-field`} />}
          </span>

          <span className="doc-field-label">{t("tobe.colType")}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {canEdit ? (
              <span className="view-toggle doc-type" role="group" aria-label={t("tobe.colType")} data-testid={`${prefix}-type`}>
                {(["sop", "wi"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={doc.doc_type === type}
                    data-testid={`${prefix}-type-${type}`}
                    disabled={isMatch}
                    onClick={() => {
                      if (doc.doc_type !== type) changeType(type);
                    }}
                  >
                    {type === "sop" ? "SOP" : "WI"}
                  </button>
                ))}
              </span>
            ) : (
              <span className="doc-field-text" data-testid={`${prefix}-type`}>
                {doc.doc_type === "sop" ? "SOP" : "WI"}
              </span>
            )}
            {/* EQUIS가 아는 값 - 줄과 다를 때만 뜨고, 눌러야 들어간다 */}
            {typeHint && (
              <button type="button" className="equis-hint" data-testid={`${prefix}-hint-type`} onClick={() => void saveDoc({ doc_type: "sop" })}>
                <span className="src-badge">EQUIS</span>
                {t("tobe.hint.type")}
              </button>
            )}
          </span>

          {doc.doc_type === "wi" ? (
            <>
              <span className="doc-field-label">{t("tobe.colParent")}</span>
              {canEdit ? (
                <Select
                  testId={`${prefix}-parent`}
                  ariaLabel={t("tobe.colParent")}
                  size="sm"
                  mono
                  width={180}
                  value={doc.parent_key ?? ""}
                  options={sops.map((sop) => ({ value: sop.key, label: sop.code.trim() || t("tobe.noCode"), tip: sop.code.trim() || t("tobe.noCode") }))}
                  onChange={(next) => {
                    const parent = sops.find((sop) => sop.key === next);
                    if (parent) void saveDoc({ parent_code: parent.code });
                  }}
                />
              ) : (
                <span className="doc-field-text font-mono" data-testid={`${prefix}-parent`}>
                  {parentCode}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="doc-field-label">{t("tobe.colEquipment")}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {canEdit ? (
                  <Checkbox testId={`${prefix}-equipment`} ariaLabel={t("tobe.colEquipment")} checked={doc.is_equipment_sop} onChange={(next) => void saveDoc({ is_equipment_sop: next })} />
                ) : (
                  <span className="doc-field-text" data-testid={`${prefix}-equipment`}>
                    {t(doc.is_equipment_sop ? "common.yes" : "common.no")}
                  </span>
                )}
                {equipmentHint && (
                  <button type="button" className="equis-hint" data-testid={`${prefix}-hint-equipment`} onClick={() => void saveDoc({ is_equipment_sop: true })}>
                    <span className="src-badge">EQUIS</span>
                    {t("tobe.hint.equipment", { tag: equipmentHint.tag })}
                  </button>
                )}
              </span>
            </>
          )}

          {written && (
            <>
              {/* 쓴 파일은 이 줄에 붙어 있다 - 이름 · 버전 · 언어 배치와 미리 보기 · 내려받기 · 지우기를 여기 모은다. 긴 파일 이름이 읽히게 라벨 아래 칸 폭 전체를 쓴다 */}
              <span className="doc-field-label doc-field-wide mt-1">{t("tobe.colWritten")}</span>
              <div className="doc-field-wide grid min-w-0 gap-1.5" data-testid={`${prefix}-written-detail`}>
                <span className="flex min-w-0 items-center gap-0.5">
                  <FileName name={written.file_name} className="min-w-0 flex-1 font-mono text-xs text-ink-2" />
                  <Tooltip label={t("documents.preview")} align="end">
                    <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("documents.preview")} data-testid={`${prefix}-written-preview`} onClick={() => file.onPreview(written)}>
                      <Eye size={16} strokeWidth={1.5} aria-hidden />
                    </button>
                  </Tooltip>
                  <Tooltip label={t("documents.download")} align="end">
                    <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("documents.download")} data-testid={`${prefix}-written-download`} onClick={() => file.onDownload(written)}>
                      <Download size={16} strokeWidth={1.5} aria-hidden />
                    </button>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip label={t("tobe.deleteWritten")} align="end">
                      <button type="button" className="btn ghost icon h-6 w-6 text-danger" aria-label={t("tobe.deleteWritten")} data-testid={`${prefix}-written-delete`} onClick={() => file.onDelete(written)}>
                        <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                      </button>
                    </Tooltip>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-ink-3">{t("documents.colVersion")}</span>
                    {canEdit ? (
                      <VersionInput value={written.doc_version} testId={`${prefix}-written-version`} onCommit={(doc_version) => void file.onSave(written, { doc_version }).catch(() => undefined)} />
                    ) : (
                      <span className="doc-field-text" data-testid={`${prefix}-written-version`}>
                        {written.doc_version}
                      </span>
                    )}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-ink-3">{t("documents.colLayout")}</span>
                    {canEdit ? (
                      <Select
                        testId={`${prefix}-written-layout`}
                        ariaLabel={t("documents.colLayout")}
                        size="sm"
                        value={written.language_layout}
                        options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} />, tip: t(`layoutKind.${layout}`) }))}
                        onChange={(next) => void file.onSave(written, { language_layout: next }).catch(() => undefined)}
                      />
                    ) : (
                      <span className="doc-field-text" data-testid={`${prefix}-written-layout`}>
                        <LayoutLabel layout={written.language_layout} label={t(`layoutKind.${written.language_layout}`)} />
                      </span>
                    )}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {doc.doc_type === "sop" ? (
        <div className="doc-panel-col">{sections}</div>
      ) : (
        <section className="doc-panel-col" aria-label={t("tobe.panel.steps")}>
          <h3 className="doc-panel-head">{t("tobe.panel.steps")}</h3>
          <div className="grid gap-1" data-testid={`${prefix}-steps`}>
            {steps.map((step) => (
              // 마지막 칸은 단계 지우기 단추가 라벨까지 펼쳐질 폭 - 펼쳐져도 단계 이름 입력을 덮지 않는다
              <div key={step.step_no} className="grid grid-cols-[48px_minmax(0,1fr)_128px] items-center gap-2">
                {/* 서버의 단계 번호 그대로 - 결과물 C·Excel과 같은 번호다 */}
                <span className="stg-n justify-self-end" aria-hidden>
                  {step.step_no}
                </span>
                {canEdit ? (
                  <CommitInput className={CELL_INPUT} testId={`${prefix}-step-${step.step_no}`} value={step.title} maxLength={500} placeholder={t("tobe.stepTitle")} onCommit={(title) => onRenameStep(step.step_no, title)} />
                ) : (
                  <span className="doc-field-text" data-testid={`${prefix}-step-${step.step_no}`}>
                    {step.title}
                  </span>
                )}
                {/* 문장이 든 단계는 수를 적고 빼기 단추를 두지 않는다 - 둘은 같은 자리에 갈마든다 */}
                <span className="flex items-center justify-end gap-2">
                  {readStepCount(step.step_no) > 0 && (
                    <span className="doc-step-count" data-testid={`${prefix}-step-${step.step_no}-count`}>
                      {readStepCount(step.step_no) === 1 ? t("tobe.slots.sentenceOne") : t("tobe.slots.sentences", { n: readStepCount(step.step_no) })}
                    </span>
                  )}
                  {canEdit && (saved === undefined || getStepRemoveBlock(tobe, saved, step.step_no) === null) && (
                    <span className="mbtn-set">
                      <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeStep")} testId={`${prefix}-remove-step-${step.step_no}`} onClick={() => onRemoveStep(step.step_no)} />
                    </span>
                  )}
                </span>
              </div>
            ))}
            {canEdit && (
              <button type="button" className="btn ghost h-7 justify-self-start" data-testid={`${prefix}-add-step`} disabled={saving} onClick={onAddStep}>
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                {t("tobe.addStep")}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
