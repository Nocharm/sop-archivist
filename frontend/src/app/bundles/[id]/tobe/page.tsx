// To-Be 목록 - 새 SOP·WI 표를 고치고 통째로 저장한다. SOP는 칸 N/A(사유), WI는 단계를 줄 아래에서 편다. Excel 템플릿 내려받기·가져오기(명세 §12-5).
"use client";

import { ChevronDown, ChevronRight, Download, FileUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadToBeTemplate, getToBe, importToBe, putToBe, SLOT_KEYS, type ToBe } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildDownloadName } from "@/lib/download-name";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { saveBlob } from "@/lib/save-file";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { addStep, buildToBeInput, changeDocType, createDraft, isDraftDirty, orderDocs, removeDoc, removeStep, renameDoc, setNaSlot, type DraftDoc, type ToBeDraft } from "@/lib/tobe-draft";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";


const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent";

export default function ToBePage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  const { data, error, isLoading, reload } = useLoaded(() => getToBe(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  // 초안은 불러온 목록에 묶인다 - 저장·다시 불러오기로 새 목록이 오면 저절로 버려진다
  const [edit, setEdit] = useState<{ base: ToBe; draft: ToBeDraft } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const draft = data && edit?.base === data ? edit.draft : data ? createDraft(data) : null;
  const dirty = data !== null && draft !== null && isDraftDirty(draft, data);
  const rows = draft ? orderDocs(draft.docs) : [];
  const sops = draft ? draft.docs.filter((doc) => doc.doc_type === "sop") : [];

  function update(next: ToBeDraft) {
    if (data) setEdit({ base: data, draft: next });
  }

  function patchDoc(key: string, patch: Partial<DraftDoc>) {
    if (draft) update({ ...draft, docs: draft.docs.map((doc) => (doc.key === key ? { ...doc, ...patch } : doc)) });
  }

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addDoc() {
    if (!draft) return;
    const key = `new-${genId()}`;
    const firstSop = sops[0]?.key ?? null;
    update({
      ...draft,
      docs: [...draft.docs, { key, code: "", title: "", doc_type: firstSop ? "wi" : "sop", parent_key: firstSop, is_equipment_sop: false, entrance: "assign" }],
    });
  }

  async function handleSave() {
    if (!draft || !data) return;
    setSaving(true);
    try {
      await putToBe(bundleId, buildToBeInput(draft, data.revision));
      showToast(t("common.saved"));
      reload();
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(file: File) {
    if (!data) return;
    setSaving(true);
    try {
      await importToBe(bundleId, file, data.revision);
      showToast(t("tobe.imported"));
      reload();
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleTemplate() {
    try {
      saveBlob(await downloadToBeTemplate(bundleId), buildDownloadName([bundle?.title, "tobe"], "xlsx"));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  function renderDetail(doc: DraftDoc) {
    if (!draft) return null;
    if (doc.doc_type === "sop") {
      return (
        <div className="grid gap-1 py-1" data-testid={`tobe-${doc.key}-slots`}>
          <p className="text-xs text-ink-3">{t("tobe.naHint")}</p>
          {SLOT_KEYS.map((slotKey) => {
            const slot = draft.na_slots.find((item) => item.doc_key === doc.key && item.slot_key === slotKey);
            const child = slotKey.includes(".");
            return (
              <div key={slotKey} className={`grid grid-cols-[220px_minmax(0,1fr)] items-center gap-3 ${child ? "pl-5" : ""}`}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid={`tobe-${doc.key}-na-${slotKey}`}
                    checked={slot !== undefined}
                    disabled={!canEdit}
                    onChange={(event) => update(setNaSlot(draft, doc.key, slotKey, event.target.checked))}
                  />
                  <span className={slot ? "text-ink-3" : ""}>{SLOT_LABELS[slotKey]}</span>
                </label>
                {slot ? (
                  <input
                    className={CELL_INPUT}
                    data-testid={`tobe-${doc.key}-na-${slotKey}-reason`}
                    placeholder={t("tobe.naReason")}
                    value={slot.reason}
                    maxLength={2000}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update({
                        ...draft,
                        na_slots: draft.na_slots.map((item) => (item === slot ? { ...item, reason: event.target.value } : item)),
                      })
                    }
                  />
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      );
    }
    const steps = draft.wi_steps.filter((step) => step.doc_key === doc.key).sort((a, b) => a.step_no - b.step_no);
    return (
      <div className="grid gap-1 py-1" data-testid={`tobe-${doc.key}-steps`}>
        {steps.map((step) => (
          <div key={step.step_no} className="grid grid-cols-[48px_minmax(0,1fr)_32px] items-center gap-2">
            {/* 서버의 단계 번호 그대로 - 결과물 C·Excel과 같은 번호다 */}
            <span className="stg-n justify-self-end" aria-hidden>
              {step.step_no}
            </span>
            <input
              className={CELL_INPUT}
              data-testid={`tobe-${doc.key}-step-${step.step_no}`}
              value={step.title}
              maxLength={500}
              placeholder={t("tobe.stepTitle")}
              disabled={!canEdit}
              onChange={(event) =>
                update({ ...draft, wi_steps: draft.wi_steps.map((item) => (item === step ? { ...item, title: event.target.value } : item)) })
              }
            />
            {canEdit && (
              <button
                type="button"
                className="btn ghost icon h-7 w-7"
                aria-label={t("tobe.removeStep")}
                data-testid={`tobe-${doc.key}-remove-step-${step.step_no}`}
                onClick={() => update(removeStep(draft, doc.key, step.step_no))}
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            className="btn ghost h-7 justify-self-start"
            data-testid={`tobe-${doc.key}-add-step`}
            onClick={() => update(addStep(draft, doc.key))}
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            {t("tobe.addStep")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="dense flex min-h-full flex-col bg-surface">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-[var(--pad)]">
        <h1 className="page-title ul">To-Be</h1>
        <span className="flex-1" />
        <button type="button" className="btn ghost" data-testid="tobe-template" onClick={() => void handleTemplate()}>
          <Download size={14} strokeWidth={1.5} aria-hidden />
          {t("tobe.template")}
        </button>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" data-testid="tobe-import-file" onChange={(event) => event.target.files?.[0] && void handleImport(event.target.files[0])} />
            <Tooltip label={t("tobe.importHint")}>
              <button type="button" className="btn ghost" data-testid="tobe-import" disabled={saving || dirty} onClick={() => fileRef.current?.click()}>
                <FileUp size={14} strokeWidth={1.5} aria-hidden />
                {t("tobe.import")}
              </button>
            </Tooltip>
            <button type="button" className="btn" data-testid="tobe-add" onClick={addDoc}>
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              {t("tobe.addDoc")}
            </button>
            {/* 주 버튼 하나 - 고친 것이 있을 때만 켜진다. 라벨은 같은 칸에서 바뀐다 */}
            <button type="button" className="btn pri" data-testid="tobe-save" disabled={!dirty || saving} onClick={() => void handleSave()}>
              <span className="stack">
                <span data-on={saving ? undefined : ""}>{t("common.save")}</span>
                <span data-on={saving ? "" : undefined}>{t("common.saving")}</span>
              </span>
            </button>
          </>
        )}
      </div>
      {dirty && (
        <div className="flex h-8 items-center gap-2 border-t border-line bg-st-hold-tint px-[var(--pad)] text-[13px] text-st-hold" data-testid="tobe-dirty">
          {t("tobe.unsaved")}
          <button type="button" className="btn ghost h-6" data-testid="tobe-discard" onClick={() => setEdit(null)}>
            {t("tobe.discard")}
          </button>
        </div>
      )}

      {error !== null && data === null ? (
        <div className="flex items-center gap-3 border-t border-line px-[var(--pad)] py-6 text-ink-2" data-testid="tobe-error">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <table className="dtable border-t border-line" data-testid="tobe-list">
          <thead>
            <tr>
              <th className="w-8" aria-label={t("tobe.details")} />
              <th className="w-40">{t("tobe.colCode")}</th>
              <th>{t("tobe.colTitle")}</th>
              <th className="w-24">{t("tobe.colType")}</th>
              <th className="w-40">{t("tobe.colParent")}</th>
              <th className="w-24">{t("tobe.colEntrance")}</th>
              <th className="w-28">{t("tobe.colEquipment")}</th>
              <th className="w-32">{t("tobe.colDetail")}</th>
              {canEdit && <th className="w-10" aria-label={t("common.delete")} />}
            </tr>
          </thead>
          <tbody>
            {draft === null
              ? showSkeleton &&
                Array.from({ length: 4 }, (_, index) => (
                  <tr key={index}>
                    {[16, 120, 300, 60, 100, 60, 40, 80].map((width, cell) => (
                      <td key={cell}>
                        <span className="sk h-5" style={{ width }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.flatMap(({ doc, depth }) => {
                  const isMatch = doc.entrance === "match";
                  const isOpen = open.has(doc.key);
                  const naCount = draft.na_slots.filter((slot) => slot.doc_key === doc.key).length;
                  const stepCount = draft.wi_steps.filter((step) => step.doc_key === doc.key).length;
                  const prefix = `tobe-${doc.key}`;
                  const row = (
                    <tr key={doc.key} data-testid={`${prefix}-row`}>
                      <td>
                        <button type="button" className="btn ghost icon h-6 w-6" aria-expanded={isOpen} aria-label={t("tobe.details")} data-testid={`${prefix}-toggle`} onClick={() => toggleOpen(doc.key)}>
                          {isOpen ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                        </button>
                      </td>
                      <td className={depth === 1 ? "pl-6" : undefined}>
                        <input
                          className={`${CELL_INPUT} font-mono`}
                          data-testid={`${prefix}-code`}
                          value={doc.code}
                          maxLength={100}
                          placeholder={t("tobe.codePlaceholder")}
                          disabled={!canEdit || isMatch}
                          onChange={(event) => update(renameDoc(draft, doc.key, event.target.value))}
                        />
                      </td>
                      <td>
                        <input className={CELL_INPUT} data-testid={`${prefix}-title`} value={doc.title} maxLength={500} disabled={!canEdit} onChange={(event) => patchDoc(doc.key, { title: event.target.value })} />
                      </td>
                      <td>
                        <select
                          className={CELL_INPUT}
                          data-testid={`${prefix}-type`}
                          value={doc.doc_type}
                          disabled={!canEdit || isMatch}
                          onChange={(event) => update(changeDocType(draft, doc.key, event.target.value === "wi" ? "wi" : "sop"))}
                        >
                          <option value="sop">SOP</option>
                          <option value="wi">WI</option>
                        </select>
                      </td>
                      <td>
                        {doc.doc_type === "wi" ? (
                          <select
                            className={`${CELL_INPUT} font-mono`}
                            data-testid={`${prefix}-parent`}
                            value={doc.parent_key ?? ""}
                            disabled={!canEdit}
                            onChange={(event) => patchDoc(doc.key, { parent_key: event.target.value || null })}
                          >
                            <option value="">{t("tobe.noParent")}</option>
                            {sops.map((sop) => (
                              <option key={sop.key} value={sop.key}>
                                {sop.code.trim() || t("tobe.noCode")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-ink-4">–</span>
                        )}
                      </td>
                      <td>
                        <span className={`tag ${isMatch ? "" : "text-ink-3"}`}>{isMatch ? t("tobe.entranceMatch") : t("tobe.entranceAssign")}</span>
                      </td>
                      <td>
                        {doc.doc_type === "sop" ? (
                          <input type="checkbox" className="mt-1.5" data-testid={`${prefix}-equipment`} aria-label={t("tobe.colEquipment")} checked={doc.is_equipment_sop} disabled={!canEdit} onChange={(event) => patchDoc(doc.key, { is_equipment_sop: event.target.checked })} />
                        ) : (
                          <span className="text-ink-4">–</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-ink-2">
                        <button type="button" className="rounded-sm px-1 hover:bg-hover" data-testid={`${prefix}-detail`} onClick={() => toggleOpen(doc.key)}>
                          {doc.doc_type === "sop" ? t("tobe.naCount", { n: naCount }) : t("tobe.stepCount", { n: stepCount })}
                        </button>
                      </td>
                      {canEdit && (
                        <td>
                          <Tooltip label={isMatch ? t("tobe.matchLocked") : t("tobe.removeDoc")} align="end">
                            <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("tobe.removeDoc")} data-testid={`${prefix}-remove`} disabled={isMatch} onClick={() => update(removeDoc(draft, doc.key))}>
                              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                            </button>
                          </Tooltip>
                        </td>
                      )}
                    </tr>
                  );
                  if (!isOpen) return [row];
                  return [
                    row,
                    <tr key={`${doc.key}-detail`} className="bg-sunken">
                      <td />
                      <td colSpan={canEdit ? 8 : 7}>{renderDetail(doc)}</td>
                    </tr>,
                  ];
                })}
          </tbody>
        </table>
      )}
      {draft !== null && rows.length === 0 && (
        <p className="px-[var(--pad)] py-6 text-ink-3" data-testid="tobe-empty">
          {canEdit ? t("tobe.emptyEdit") : t("tobe.empty")}
        </p>
      )}
    </div>
  );
}
