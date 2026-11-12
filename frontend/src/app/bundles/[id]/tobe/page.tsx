// To-Be 목록 - 새 SOP·WI 표를 고치고 통째로 저장한다. SOP는 칸 N/A(사유), WI는 단계를 줄 아래에서 편다. Excel 템플릿 내려받기·가져오기(명세 §12-5).
"use client";

import { ChevronRight, Download, FileUp, FilePlus, ListTree, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { UploadWritten } from "@/components/tobe/upload-written";
import { BundleLoadError } from "@/components/bundle-load-error";
import { ReadOnlyNote } from "@/components/read-only-note";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { MorphButton } from "@/components/ui/morph-button";
import { CollapseRow } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadToBeTemplate, getToBe, importToBe, listDocuments, putToBe, SLOT_KEYS, type ToBe } from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildDownloadName } from "@/lib/download-name";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { useLeaveGuard } from "@/lib/leave-guard";
import { navigate } from "@/lib/nav-buffer";
import { saveBlob } from "@/lib/save-file";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { addStep, buildToBeInput, changeDocType, createDraft, findDraftProblem, isDraftDirty, isSameToBe, orderDocs, removeDoc, removeStep, renameDoc, setNaSlot, type DraftDoc, type ToBeDraft } from "@/lib/tobe-draft";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { useLoaded } from "@/lib/use-loaded";
import { getBundleLabel } from "@/lib/bundle-label";


/** 상위 칸 하나와 그 하위 칸들(slotKey가 "상위."로 시작) - 단 나눔에서 떨어지지 않게 묶는다 */
const SLOT_GROUPS: (typeof SLOT_KEYS[number])[][] = SLOT_KEYS.filter((key) => !key.includes(".")).map((top) => SLOT_KEYS.filter((key) => key === top || key.startsWith(`${top}.`)));

const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent";

/** 409 revision_conflict - 보낸 revision이 서버 것보다 낡았다 */
function isRevisionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.rule?.code === "revision_conflict";
}

export default function ToBePage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  const { data, error, isLoading, reload } = useLoaded(() => getToBe(bundleId), String(bundleId));
  // 경계를 아직 확인하지 않은 Old 단위 - 있으면 작성 문서 올리기 곁에 쪼개기를 먼저 끝내라고 안내만 한다(막지 않는다)
  const { data: docs } = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const uncheckedBoundaries = docs?.filter((doc) => doc.side === "old").reduce((sum, doc) => sum + doc.unchecked_boundaries, 0) ?? 0;
  const [uploadOpen, setUploadOpen] = useState(false);
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  // 초안은 불러온 목록에 묶인다 - 저장·다시 불러오기로 새 목록이 오면 저절로 버려진다
  const [edit, setEdit] = useState<{ base: ToBe; draft: ToBeDraft } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // 저장하지 않은 편집이 있을 때 막은 링크 이동 - 확인하면 버리고 간다
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  // 가져오기 전에 한 번 묻는다 - 목록이 비어 있지 않으면 파일이 통째로 바꾼다
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  // 고치는 동안 다른 곳에서 To-Be가 저장됐다 - 최신을 불러올지 묻는다
  const [hasConflict, setHasConflict] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const draft = data && edit?.base === data ? edit.draft : data ? createDraft(data) : null;
  const dirty = data !== null && draft !== null && isDraftDirty(draft, data);
  const rows = draft ? orderDocs(draft.docs) : [];
  useLeaveGuard(dirty, setLeaveTo);
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
    // 서버는 줄을 말하지 않고 거절한다 - 보내기 전에 어느 줄인지 알린다
    const problem = findDraftProblem(draft);
    if (problem) {
      showToast(t(problem.kind === "empty_code" ? "tobe.problemEmptyCode" : "tobe.problemNaReason", { n: problem.row, code: problem.code }), "error");
      return;
    }
    setSaving(true);
    try {
      try {
        await putToBe(bundleId, buildToBeInput(draft, data.revision));
      } catch (err) {
        if (!isRevisionConflict(err)) throw err;
        // revision은 Bundle 것이라 멤버·제목만 바뀌어도 밀린다 - To-Be가 그대로면 새 revision으로 한 번 더 보낸다
        const latest = await getToBe(bundleId);
        if (!isSameToBe(latest, data)) {
          setHasConflict(true);
          return;
        }
        await putToBe(bundleId, buildToBeInput(draft, latest.revision));
      }
      showToast(t("common.saved"));
      reload();
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/⌘+S - 고친 것이 있으면 저장한다. 고칠 수 있는 화면에서는 브라우저의 "페이지 저장"이 뜨지 않게 늘 막는다
  const handleSaveKey = useEffectEvent((event: KeyboardEvent) => {
    if (!canEdit || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (dirty && !saving && document.querySelector('[role="dialog"]') === null) void handleSave();
  });
  useEffect(() => {
    window.addEventListener("keydown", handleSaveKey);
    return () => window.removeEventListener("keydown", handleSaveKey);
  }, []);

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
      // revision이 밀려 거절됐으면 최신을 불러와야 다시 고른 파일이 같은 이유로 또 거절되지 않는다
      if (isRevisionConflict(err)) reload();
    } finally {
      setSaving(false);
      setPendingImport(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function pickImportFile(file: File) {
    if (data !== null && data.docs.length > 0) setPendingImport(file);
    else void handleImport(file);
  }

  function cancelImport() {
    setPendingImport(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleTemplate() {
    try {
      saveBlob(await downloadToBeTemplate(bundleId), buildDownloadName([bundle ? getBundleLabel(bundle) : undefined, "tobe"], "xlsx"));
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
          {/* 상위 칸과 그 하위 칸을 한 묶음으로 감싸 단이 갈라질 때 함께 움직인다 - 사유 입력은 체크한 줄 바로 아래 */}
          <div className="grid gap-x-6 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
            {SLOT_GROUPS.map((group) => (
              <div key={group[0]} className="grid content-start gap-1">
                {group.map((slotKey) => {
                  const slot = draft.na_slots.find((item) => item.doc_key === doc.key && item.slot_key === slotKey);
                  const child = slotKey.includes(".");
                  return (
                    <div key={slotKey} className={`grid gap-1 ${child ? "pl-5" : ""}`}>
                      <Checkbox
                        testId={`tobe-${doc.key}-na-${slotKey}`}
                        checked={slot !== undefined}
                        disabled={!canEdit}
                        onChange={(next) => update(setNaSlot(draft, doc.key, slotKey, next))}
                        label={<span className={slot ? "text-ink-3" : ""}>{SLOT_LABELS[slotKey]}</span>}
                      />
                      {slot && (
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
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      );
    }
    const steps = draft.wi_steps.filter((step) => step.doc_key === doc.key).sort((a, b) => a.step_no - b.step_no);
    return (
      <div className="grid gap-1 py-1" data-testid={`tobe-${doc.key}-steps`}>
        {steps.map((step) => (
          // 마지막 칸은 단계 지우기 단추가 라벨까지 펼쳐질 폭 - 펼쳐져도 단계 이름 입력을 덮지 않는다
          <div key={step.step_no} className="grid grid-cols-[48px_minmax(0,1fr)_128px] items-center gap-2">
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
              <span className="mbtn-set justify-self-end">
                <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeStep")} testId={`tobe-${doc.key}-remove-step-${step.step_no}`} onClick={() => update(removeStep(draft, doc.key, step.step_no))} />
              </span>
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
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-[var(--pad)]">
        <h1 className="page-title ul">To-Be</h1>
        <ReadOnlyNote bundle={bundle} testId="tobe" />
        <span className="flex-1" />
        <button type="button" className="btn ghost" data-testid="tobe-template" onClick={() => void handleTemplate()}>
          <Download size={14} strokeWidth={1.5} aria-hidden />
          {t("tobe.template")}
        </button>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" data-testid="tobe-import-file" onChange={(event) => event.target.files?.[0] && pickImportFile(event.target.files[0])} />
            <Tooltip label={t("tobe.importHint")}>
              <button type="button" className="btn ghost" data-testid="tobe-import" disabled={saving || dirty} onClick={() => fileRef.current?.click()}>
                <FileUp size={14} strokeWidth={1.5} aria-hidden />
                {t("tobe.import")}
              </button>
            </Tooltip>
            {uncheckedBoundaries > 0 && (
              <span className="text-xs text-ink-3" data-testid="tobe-upload-written-hint">
                {t("tobe.uploadWritten.splitFirst", { n: uncheckedBoundaries })}
              </span>
            )}
            <button type="button" className="btn ghost" data-testid="tobe-upload-written" disabled={saving || dirty} onClick={() => setUploadOpen(true)}>
              <FilePlus size={14} strokeWidth={1.5} aria-hidden />
              {t("tobe.uploadWritten")}
            </button>
            <button type="button" className="btn" data-testid="tobe-add" onClick={addDoc}>
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              {t("tobe.addDoc")}
            </button>
            {/* 주 버튼 하나 - 고친 것이 있을 때만 켜진다. 라벨은 같은 칸에서 바뀐다 */}
            <button type="button" className="btn pri" data-testid="tobe-save" aria-keyshortcuts="Control+S Meta+S" disabled={!dirty || saving} onClick={() => void handleSave()}>
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
        <BundleLoadError error={error} onRetry={reload} testId="tobe" />
      ) : (
        <table className="dtable border-t border-line" data-testid="tobe-list">
          <thead>
            <tr>
              <th className="w-8" aria-label={t("tobe.details")} />
              <th className="w-40 min-w-[160px]">{t("tobe.colCode")}</th>
              <th className="min-w-[196px]">{t("tobe.colTitle")}</th>
              <th className="w-24">{t("tobe.colType")}</th>
              <th className="w-[180px] min-w-[180px]">{t("tobe.colParent")}</th>
              <th className="w-24">{t("tobe.colEntrance")}</th>
              <th className="w-28">{t("tobe.colEquipment")}</th>
              <th className="w-32">{t("tobe.colDetail")}</th>
              {/* 빼기 단추가 라벨까지 펼쳐질 폭을 미리 잡는다 - 펼쳐져도 옆 칸(세부)의 글자를 덮지 않는다 */}
              {canEdit && <th className="w-[108px]" aria-label={t("common.delete")} />}
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
                        <Tooltip label={t("tobe.details")}>
                          <button type="button" className="btn ghost icon h-6 w-6" aria-expanded={isOpen} aria-label={t("tobe.details")} data-testid={`${prefix}-toggle`} onClick={() => toggleOpen(doc.key)}>
                            <ChevronRight size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-[var(--dur-base)] ${isOpen ? "rotate-90" : ""}`} />
                          </button>
                        </Tooltip>
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
                        <Select
                          testId={`${prefix}-type`}
                          ariaLabel={t("tobe.colType")}
                          size="sm"
                          className="w-full"
                          value={doc.doc_type}
                          disabled={!canEdit || isMatch}
                          options={[
                            { value: "sop", label: "SOP" },
                            { value: "wi", label: "WI" },
                          ]}
                          onChange={(next) => update(changeDocType(draft, doc.key, next))}
                        />
                      </td>
                      <td>
                        {doc.doc_type === "wi" ? (
                          <Select
                            testId={`${prefix}-parent`}
                            ariaLabel={t("tobe.colParent")}
                            size="sm"
                            mono
                            width={160}
                            value={doc.parent_key ?? ""}
                            disabled={!canEdit}
                            options={[
                              { value: "", label: t("tobe.noParent") },
                              ...sops.map((sop) => ({ value: sop.key, label: sop.code.trim() || t("tobe.noCode"), tip: sop.code.trim() || t("tobe.noCode") })),
                            ]}
                            onChange={(next) => patchDoc(doc.key, { parent_key: next || null })}
                          />
                        ) : (
                          <span className="text-ink-4">–</span>
                        )}
                      </td>
                      <td>
                        <span className={`tag ${isMatch ? "" : "text-ink-3"}`}>{isMatch ? t("tobe.entranceMatch") : t("tobe.entranceAssign")}</span>
                      </td>
                      <td>
                        {doc.doc_type === "sop" ? (
                          <Checkbox className="mt-1.5" testId={`${prefix}-equipment`} ariaLabel={t("tobe.colEquipment")} checked={doc.is_equipment_sop} disabled={!canEdit} onChange={(next) => patchDoc(doc.key, { is_equipment_sop: next })} />
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
                        <td className="text-right">
                          <span className="row-actions mbtn-set">
                          {isMatch ? (
                            <Tooltip label={t("tobe.matchLocked")} align="end">
                              <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeDoc")} testId={`${prefix}-remove`} disabled />
                            </Tooltip>
                          ) : (
                            <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeDoc")} testId={`${prefix}-remove`} onClick={() => update(removeDoc(draft, doc.key))} />
                          )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                  return [
                    row,
                    <CollapseRow key={`${doc.key}-detail`} open={isOpen} colSpan={canEdit ? 8 : 7} className="bg-sunken">
                      {renderDetail(doc)}
                    </CollapseRow>,
                  ];
                })}
          </tbody>
        </table>
      )}
      {uploadOpen && <UploadWritten bundleId={bundleId} onClose={() => setUploadOpen(false)} onUploaded={() => { reload(); void loadBundle(bundleId); }} />}
      {leaveTo !== null && (
        <ConfirmModal
          title={t("tobe.leaveTitle")}
          summary={<span>{t("tobe.leaveBody")}</span>}
          confirmLabel={t("tobe.leaveConfirm")}
          danger
          testId="tobe-leave"
          onClose={() => setLeaveTo(null)}
          onConfirm={() => {
            setLeaveTo(null);
            setEdit(null);
            navigate(leaveTo, { immediate: true });
          }}
        />
      )}
      {pendingImport !== null && (
        <ConfirmModal
          title={t("tobe.importTitle")}
          target={pendingImport.name}
          summary={t("tobe.importBody", { n: data?.docs.length ?? 0 })}
          confirmLabel={t("tobe.importConfirm")}
          confirmIcon={FileUp}
          busy={saving}
          testId="tobe-import-modal"
          onConfirm={() => void handleImport(pendingImport)}
          onClose={cancelImport}
        />
      )}
      {hasConflict && (
        <ConfirmModal
          title={t("tobe.conflictTitle")}
          summary={t("tobe.conflictBody")}
          confirmLabel={t("tobe.conflictConfirm")}
          confirmIcon={RefreshCw}
          testId="tobe-conflict"
          onConfirm={() => {
            setHasConflict(false);
            setEdit(null);
            reload();
            void loadBundle(bundleId);
          }}
          onClose={() => setHasConflict(false)}
        />
      )}
      {draft !== null && rows.length === 0 && (
        <EmptyState icon={ListTree} testId="tobe-empty" title={t("tobe.emptyTitle")} body={canEdit ? t("tobe.emptyEdit") : t("tobe.empty")} />
      )}
    </div>
  );
}
