// New 문서 목록(새로 만들 SOP·WI) - Documents 화면의 Old 문서 목록 아래에 놓인다. 줄을 번호로 더하고, 칸마다 바로 저장한다(초안·Save 없음).
// SOP는 칸 N/A(사유), WI는 단계를 줄 아래에서 편다. 이미 쓴 파일은 그 줄에 붙어 보인다. Excel 템플릿 내려받기·가져오기는 메뉴에 있다.
// EQUIS가 아는 값(종류·장비 번호)은 줄에 작은 제안으로 뜨고 사람이 눌러 넣는다 - 자동으로 바꾸지 않는다.
"use client";

import { ChevronRight, Download, Eye, FileUp, ListTree, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ClipboardEvent } from "react";

import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { BundleLoadError } from "@/components/bundle-load-error";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { ListReader } from "@/components/tobe/list-reader";
import { Checkbox } from "@/components/ui/checkbox";
import { CommitInput } from "@/components/ui/commit-input";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu } from "@/components/ui/menu";
import { MorphButton } from "@/components/ui/morph-button";
import { CollapseRow, Truncate } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { VersionInput } from "@/components/ui/version-input";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import {
  addToBeDoc,
  addWiStep,
  clearNaSlot,
  downloadToBeTemplate,
  getToBe,
  getToBeRead,
  importToBe,
  LANGUAGE_LAYOUTS,
  refreshEquis,
  removeToBeDoc,
  removeWiStep,
  renameWiStep,
  setNaSlot,
  SLOT_KEYS,
  updateToBeDoc,
  type DocumentUpdateInput,
  type SopDocument,
  type ToBe,
  type ToBeDocPatch,
} from "@/lib/api-sop";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildDownloadName } from "@/lib/download-name";
import { hasRefreshingEquis, normalizeDocNumber } from "@/lib/equis-model";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { NEW_DOCUMENTS_ANCHOR } from "@/lib/stages";
import { listEquisHints, planAddRows, readCodes } from "@/lib/tobe-add-model";
import { createDraft, orderDocs, type DraftDoc } from "@/lib/tobe-draft";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { useLoaded } from "@/lib/use-loaded";

/** 상위 칸 하나와 그 하위 칸들(slotKey가 "상위."로 시작) - 단 나눔에서 떨어지지 않게 묶는다 */
const SLOT_GROUPS: (typeof SLOT_KEYS[number])[][] = SLOT_KEYS.filter((key) => !key.includes(".")).map((top) => SLOT_KEYS.filter((key) => key === top || key.startsWith(`${top}.`)));

const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:text-ink-2";

/** 409 revision_conflict - 보낸 revision이 서버 것보다 낡았다 */
function isRevisionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.rule?.code === "revision_conflict";
}

/** 화면 키("id-<줄 id>")에서 줄 id */
function readDocId(key: string): number {
  return Number(key.slice(3));
}

interface ToBeSectionProps {
  bundleId: number;
  /** Documents 화면이 읽은 문서 목록 - 줄에 붙은 쓴 파일을 찾고, 올린 New 문서가 바뀌었는지 아는 데 쓴다. 아직 못 읽었으면 null */
  documents: SopDocument[] | null;
  /** 줄에 붙은 쓴 파일에 하는 일 - 미리 보기·내려받기·지우기와 그 파일의 버전·언어 배치 고치기(Documents 화면이 Old 문서에 쓰는 것과 같다) */
  file: {
    onPreview: (document: SopDocument) => void;
    onDownload: (document: SopDocument) => void;
    onDelete: (document: SopDocument) => void;
    onSave: (document: SopDocument, change: Omit<DocumentUpdateInput, "revision">) => Promise<unknown>;
  };
}

export function ToBeSection({ bundleId, documents, file }: ToBeSectionProps) {
  const { t } = useI18n();
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  const { data, error, isLoading, reload } = useLoaded(() => getToBe(bundleId), String(bundleId));
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 줄 하나를 저장한 응답 - 다시 받은 목록이 올 때까지 이쪽이 더 새롭다(받은 목록이 바뀌면 저절로 버려진다)
  const [fresh, setFresh] = useState<{ base: ToBe; tobe: ToBe } | null>(null);
  const tobe = data !== null && fresh?.base === data ? fresh.tobe : data;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // 체크만 하고 사유를 아직 적지 않은 N/A 칸("줄 키:칸 키") - 사유를 적어야 저장된다
  const [pendingNa, setPendingNa] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState("");
  // 가져오기 전에 한 번 묻는다 - 목록이 비어 있지 않으면 파일이 통째로 바꾼다
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 새 문서 목록 AI 읽기 - 아직 정하지 않은 제안이 있으면 목록 머리에 표시가 뜬다. AI 작업이 끝나면 다시 받는다. AI가 꺼져 있으면 길이 없다
  const proposal = useLoaded(() => getToBeRead(bundleId), String(bundleId));
  const aiJobs = useAiJobs(bundleId, proposal.reload);
  const aiOn = aiJobs.status?.ai_enabled ?? false;
  const readJobs = aiJobs.status?.by_kind.tobe_list;
  const stoppedReadJobs = readJobs ? readJobs.failed + readJobs.stale + readJobs.cancelled : 0;
  const [isReading, setIsReading] = useState(false);

  const list = tobe ? createDraft(tobe) : null;
  const rows = list ? orderDocs(list.docs) : [];
  const sops = list ? list.docs.filter((doc) => doc.doc_type === "sop") : [];
  const savedByCode = new Map((tobe?.docs ?? []).map((doc) => [doc.code, doc]));
  // 줄 번호의 EQUIS 표시 - 저장된 번호로 찾는다
  const equisByCode = new Map((tobe?.docs ?? []).map((doc) => [normalizeDocNumber(doc.code), doc.equis ?? null]));
  // 조회는 저장 응답 뒤에 끝난다 - 조회 중인 줄이 있으면 조금 뒤 다시 읽는다
  useEquisPolling(hasRefreshingEquis(tobe?.docs), reload);

  /** 그 줄에 붙은 쓴 파일(문서) - 없으면 null */
  const findFile = (code: string): SopDocument | null => {
    const documentId = savedByCode.get(code)?.document_id ?? null;
    return documentId === null ? null : ((documents ?? []).find((item) => item.id === documentId) ?? null);
  };

  // 올리기 창에서 New 파일을 올리거나 지우면 이 목록의 줄도 바뀐다 - 그때 다시 읽는다
  const hasDocuments = documents !== null;
  const newDocsKey = (documents ?? []).filter((doc) => doc.side === "new").map((doc) => `${doc.id}:${doc.doc_code}:${doc.target_doc_id ?? ""}`).join(",");
  const seenNewDocsRef = useRef<string | null>(null);
  const reloadList = useEffectEvent(() => reload());
  useEffect(() => {
    if (!hasDocuments) return;
    const previous = seenNewDocsRef.current;
    seenNewDocsRef.current = newDocsKey;
    if (previous !== null && previous !== newDocsKey) void Promise.resolve().then(() => reloadList());
  }, [hasDocuments, newDocsKey]);

  // 주소가 이 목록을 가리키면(옛 /tobe, 개요의 다음 할 일) 두 목록이 다 그려진 뒤 이 자리로 스크롤한다.
  // 브라우저의 해시 이동은 위 목록이 채워지기 전에 끝나서, 늦게 채워진 목록이 이 영역을 화면 아래로 민다
  const hasToBe = data !== null;
  useEffect(() => {
    if (!hasDocuments || !hasToBe) return;
    if (window.location.hash === `#${NEW_DOCUMENTS_ANCHOR}`) document.getElementById(NEW_DOCUMENTS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [hasDocuments, hasToBe]);

  /** 줄 하나를 쓴다 - 응답의 새 목록을 바로 보이고, 거절되면 까닭을 알리고 다시 받는다(칸이 저장된 값으로 돌아간다) */
  async function runWrite(write: () => Promise<ToBe>): Promise<boolean> {
    if (!data) return false;
    setSaving(true);
    try {
      const next = await write();
      setFresh({ base: data, tobe: next });
      // 목록이 바뀌면 개요의 숫자·다음 할 일도 바뀐다
      void loadBundle(bundleId);
      return true;
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      reload();
      return false;
    } finally {
      setSaving(false);
    }
  }

  function saveDoc(doc: DraftDoc, patch: ToBeDocPatch): Promise<boolean> {
    return runWrite(() => updateToBeDoc(bundleId, readDocId(doc.key), patch));
  }

  function changeType(doc: DraftDoc, next: DraftDoc["doc_type"]) {
    if (next === "sop") {
      void saveDoc(doc, { doc_type: "sop" });
      return;
    }
    // WI는 상위 SOP가 있어야 한다 - 목록의 첫 SOP(자기 자신 말고) 아래로 두고, 사람이 옆 칸에서 바꾼다
    const parent = sops.find((sop) => sop.key !== doc.key);
    if (!parent) showToast(t("tobe.needSop"), "error");
    else void saveDoc(doc, { doc_type: "wi", parent_code: parent.code });
  }

  async function handleEquisRefresh(code: string) {
    try {
      const { requested } = await refreshEquis(bundleId, code);
      showToast(t(requested ? "equis.refreshed" : "equis.refreshSkipped"));
      reload();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 번호로 줄을 더한다 - 여러 번호(붙여 넣은 줄들)면 하나씩 차례로. 이미 있는 번호는 건너뛰고 몇 개였는지 알린다 */
  async function addCodes(text: string) {
    if (!tobe || saving) return;
    const plan = planAddRows(readCodes(text), tobe.docs);
    if (plan.rows.length === 0) {
      if (plan.skipped.length > 0) showToast(t("tobe.addSkippedOnly", { n: plan.skipped.length }), "error");
      return;
    }
    let added = 0;
    for (const row of plan.rows) {
      // 하나가 거절되면 거기서 멈춘다 - 뒤의 WI가 그 SOP 아래로 갈 수 있다
      if (!(await runWrite(() => addToBeDoc(bundleId, row)))) break;
      added += 1;
    }
    if (added > 0) {
      setAdding("");
      showToast(plan.skipped.length > 0 ? t("tobe.addedSkipped", { n: added, skipped: plan.skipped.length }) : t("tobe.added", { n: added }));
    }
  }

  function handleAddPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    // 한 줄이면 그냥 붙여 넣는다 - 여러 줄(Excel의 열을 복사한 것 등)이면 그대로 줄마다 더한다
    if (readCodes(text).length < 2) return;
    event.preventDefault();
    void addCodes(text);
  }

  async function handleImport(picked: File) {
    if (!tobe) return;
    setSaving(true);
    try {
      await importToBe(bundleId, picked, tobe.revision);
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

  function pickImportFile(picked: File) {
    if (tobe !== null && tobe.docs.length > 0) setPendingImport(picked);
    else void handleImport(picked);
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

  function setNaPending(key: string, isOn: boolean) {
    setPendingNa((prev) => {
      const next = new Set(prev);
      if (isOn) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function renderDetail(doc: DraftDoc) {
    if (!list) return null;
    const docId = readDocId(doc.key);
    if (doc.doc_type === "sop") {
      return (
        <div className="grid gap-1 py-1" data-testid={`tobe-${doc.key}-slots`}>
          <p className="text-xs text-ink-3">{t("tobe.naHint")}</p>
          {/* 상위 칸과 그 하위 칸을 한 묶음으로 감싸 단이 갈라질 때 함께 움직인다 - 사유 입력은 체크한 줄 바로 아래 */}
          <div className="grid gap-x-6 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
            {SLOT_GROUPS.map((group) => (
              <div key={group[0]} className="grid content-start gap-1">
                {group.map((slotKey) => {
                  const slot = list.na_slots.find((item) => item.doc_key === doc.key && item.slot_key === slotKey);
                  const pendingKey = `${doc.key}:${slotKey}`;
                  const isPending = slot === undefined && pendingNa.has(pendingKey);
                  const child = slotKey.includes(".");
                  return (
                    <div key={slotKey} className={`grid gap-1 ${child ? "pl-5" : ""}`}>
                      <Checkbox
                        testId={`tobe-${doc.key}-na-${slotKey}`}
                        checked={slot !== undefined || isPending}
                        disabled={!canEdit}
                        onChange={(next) => {
                          // 체크하면 사유 칸이 열리고, 사유를 적어야 저장된다. 풀면 바로 지운다
                          if (next) setNaPending(pendingKey, true);
                          else if (slot) void runWrite(() => clearNaSlot(bundleId, docId, slotKey));
                          else setNaPending(pendingKey, false);
                        }}
                        label={<span className={slot ? "text-ink-3" : ""}>{SLOT_LABELS[slotKey]}</span>}
                      />
                      {(slot || isPending) && (
                        <CommitInput
                          className={CELL_INPUT}
                          testId={`tobe-${doc.key}-na-${slotKey}-reason`}
                          placeholder={t("tobe.naReason")}
                          value={slot?.reason ?? ""}
                          maxLength={2000}
                          disabled={!canEdit}
                          autoFocus={isPending}
                          // 사유 없이 떠나면 체크를 거둔다(이미 저장된 칸이면 사유가 돌아온다)
                          onEmpty={() => setNaPending(pendingKey, false)}
                          onCommit={(reason) =>
                            runWrite(() => setNaSlot(bundleId, docId, slotKey, reason)).then((isSaved) => {
                              // 거절됐어도(문장이 든 칸) 체크를 거둔다 - 저장되지 않은 체크가 남지 않게
                              setNaPending(pendingKey, false);
                              return isSaved;
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
    const steps = list.wi_steps.filter((step) => step.doc_key === doc.key).sort((a, b) => a.step_no - b.step_no);
    return (
      <div className="grid gap-1 py-1" data-testid={`tobe-${doc.key}-steps`}>
        {steps.map((step) => (
          // 마지막 칸은 단계 지우기 단추가 라벨까지 펼쳐질 폭 - 펼쳐져도 단계 이름 입력을 덮지 않는다
          <div key={step.step_no} className="grid grid-cols-[48px_minmax(0,1fr)_128px] items-center gap-2">
            {/* 서버의 단계 번호 그대로 - 결과물 C·Excel과 같은 번호다 */}
            <span className="stg-n justify-self-end" aria-hidden>
              {step.step_no}
            </span>
            <CommitInput
              className={CELL_INPUT}
              testId={`tobe-${doc.key}-step-${step.step_no}`}
              value={step.title}
              maxLength={500}
              placeholder={t("tobe.stepTitle")}
              disabled={!canEdit}
              onCommit={(title) => runWrite(() => renameWiStep(bundleId, docId, step.step_no, title))}
            />
            {canEdit && (
              <span className="mbtn-set justify-self-end">
                <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeStep")} testId={`tobe-${doc.key}-remove-step-${step.step_no}`} onClick={() => void runWrite(() => removeWiStep(bundleId, docId, step.step_no))} />
              </span>
            )}
          </div>
        ))}
        {canEdit && (
          <button type="button" className="btn ghost h-7 justify-self-start" data-testid={`tobe-${doc.key}-add-step`} disabled={saving} onClick={() => void runWrite(() => addWiStep(bundleId, docId, ""))}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            {t("tobe.addStep")}
          </button>
        )}
      </div>
    );
  }

  const colSpan = canEdit ? 8 : 7;
  return (
    <section className="dense flex flex-col border-t border-line bg-surface" aria-labelledby={NEW_DOCUMENTS_ANCHOR} data-testid="tobe-section">
      {/* 화면 제목 밑줄은 화면에 한 번만 쓴다 - 영역 머리는 밑줄 없이 */}
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-line px-[var(--pad)] py-2">
        <h2 id={NEW_DOCUMENTS_ANCHOR} className="page-title scroll-mt-4">
          {t("documents.tobeTitle")}
        </h2>
        <span className="text-xs text-ink-3">{t("documents.tobeLead")}</span>
        <span className="flex-1" />
        {/* 저장 중 - 칸마다 바로 저장하므로 단추 대신 작은 표시만 */}
        <span className="text-xs text-ink-3" aria-live="polite" data-testid="tobe-saving">
          {saving ? t("common.saving") : ""}
        </span>
        {/* AI가 읽어 둔 제안 - 사람이 보고 정하기를 기다린다(검토자에게는 보이지 않는다) */}
        {canEdit && proposal.data !== null && (
          <button type="button" className="btn h-7 text-st-ai" data-testid="tobe-proposal" onClick={() => setIsReading(true)}>
            <Sparkles size={14} strokeWidth={1.5} aria-hidden />
            {t("tobe.read.pending", { n: proposal.data.docs.length })}
          </button>
        )}
        {canEdit && <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" data-testid="tobe-import-file" onChange={(event) => event.target.files?.[0] && pickImportFile(event.target.files[0])} />}
        {/* Excel 템플릿·가져오기는 가끔 쓰는 일이라 메뉴에 둔다 */}
        <Tooltip label={t("tobe.more")} suppressed={menuOpen}>
          <button ref={menuRef} type="button" className="btn ghost icon" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t("tobe.more")} data-testid="tobe-more" onClick={() => setMenuOpen((prev) => !prev)}>
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </Tooltip>
        {menuOpen && (
          <Menu anchorRef={menuRef} onClose={() => setMenuOpen(false)} testId="tobe-more-menu" align="end">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="tobe-template"
              onClick={() => {
                setMenuOpen(false);
                void handleTemplate();
              }}
            >
              <Download size={14} strokeWidth={1.5} aria-hidden />
              {t("tobe.template")}
            </button>
            {canEdit && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="tobe-import"
                disabled={saving}
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                <FileUp size={14} strokeWidth={1.5} aria-hidden />
                <span className="grid">
                  {t("tobe.import")}
                  <span className="text-[11px] text-ink-3">{t("tobe.importHint")}</span>
                </span>
              </button>
            )}
            {/* 템플릿에 맞지 않는 파일이나 글 - AI가 켜져 있을 때만 */}
            {canEdit && aiOn && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="tobe-read-open"
                onClick={() => {
                  setMenuOpen(false);
                  setIsReading(true);
                }}
              >
                <Sparkles size={14} strokeWidth={1.5} aria-hidden />
                <span className="grid">
                  {t("tobe.read.menu")}
                  <span className="text-[11px] text-ink-3">{t("tobe.read.menuHint")}</span>
                </span>
              </button>
            )}
          </Menu>
        )}
      </div>

      {error !== null && data === null ? (
        <BundleLoadError error={error} onRetry={reload} testId="tobe" />
      ) : (
        <table className="dtable tobe-table border-t border-line" data-testid="tobe-list">
          <thead>
            <tr>
              <th className="w-8" aria-label={t("tobe.details")} />
              <th className="w-40 min-w-[160px]">{t("tobe.colCode")}</th>
              <th className="min-w-[196px] max-[1279px]:min-w-[156px]">{t("tobe.colTitle")}</th>
              <th className="w-24">{t("tobe.colType")}</th>
              <th className="w-[168px] min-w-[168px] max-[1279px]:w-[160px] max-[1279px]:min-w-[160px]">{t("tobe.colParent")}</th>
              <th className="w-[184px] max-[1279px]:w-[164px]">{t("tobe.colWritten")}</th>
              <th className="w-28 max-[1279px]:w-16 max-[1279px]:whitespace-normal">{t("tobe.colEquipment")}</th>
              <th className="w-32 max-[1279px]:w-24">{t("tobe.colDetail")}</th>
              {/* 빼기 단추가 라벨까지 펼쳐질 폭을 미리 잡는다 - 펼쳐져도 옆 칸(세부)의 글자를 덮지 않는다 */}
              {canEdit && <th className="w-[108px] min-w-[108px] max-[1279px]:w-[100px] max-[1279px]:min-w-[100px]" aria-label={t("common.delete")} />}
            </tr>
          </thead>
          <tbody>
            {list === null
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
                  const written = findFile(doc.code);
                  const isOpen = open.has(doc.key);
                  const naCount = list.na_slots.filter((slot) => slot.doc_key === doc.key).length;
                  const stepCount = list.wi_steps.filter((step) => step.doc_key === doc.key).length;
                  const prefix = `tobe-${doc.key}`;
                  const equis = equisByCode.get(normalizeDocNumber(doc.code)) ?? null;
                  // EQUIS에 있는 번호의 제목은 EQUIS가 정한다 - 다른 값을 보내도 서버가 EQUIS 이름으로 되돌린다
                  const isTitleLocked = equis?.title_locked === true;
                  const hints = canEdit ? listEquisHints(doc, equis) : [];
                  const codeInput = (
                    <CommitInput
                      className={`${CELL_INPUT} min-w-0 font-mono`}
                      testId={`${prefix}-code`}
                      value={doc.code}
                      maxLength={100}
                      placeholder={t("tobe.codePlaceholder")}
                      ariaLabel={t("tobe.colCode")}
                      // 쓴 파일이 붙은 줄의 번호는 그 파일의 번호다
                      disabled={!canEdit || isMatch}
                      // 번호는 비울 수 없다 - 비우고 떠나면 저장된 번호로 돌아간다
                      onEmpty={() => undefined}
                      onCommit={(code) => saveDoc(doc, { code })}
                    />
                  );
                  const titleInput = (
                    <CommitInput className={`${CELL_INPUT} min-w-0 text-ellipsis`} testId={`${prefix}-title`} value={doc.title} maxLength={500} ariaLabel={t("tobe.colTitle")} disabled={!canEdit || isTitleLocked} onCommit={(title) => saveDoc(doc, { title })} />
                  );
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
                        {equis ? (
                          // 좁은 칸이라 아이콘만 둔다 - 글은 툴팁과 펼친 정보에 있다
                          <span className="flex items-center gap-1">
                            {codeInput}
                            <EquisStatus equis={equis} testId={`${prefix}-equis`} compact canEdit={canEdit} onRefresh={() => void handleEquisRefresh(doc.code)} />
                          </span>
                        ) : (
                          codeInput
                        )}
                      </td>
                      <td>
                        {isTitleLocked ? (
                          <span className="flex items-center gap-1">
                            {titleInput}
                            <TitleLock testId={`${prefix}-title-lock`} />
                          </span>
                        ) : (
                          titleInput
                        )}
                        {/* EQUIS가 아는 값 - 줄과 다를 때만 뜨고, 눌러야 들어간다 */}
                        {hints.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {hints.map((hint) =>
                              hint.kind === "type" ? (
                                <button key="type" type="button" className="equis-hint" data-testid={`${prefix}-hint-type`} onClick={() => void saveDoc(doc, { doc_type: "sop" })}>
                                  <span className="src-badge">EQUIS</span>
                                  {t("tobe.hint.type")}
                                </button>
                              ) : (
                                <button key="equipment" type="button" className="equis-hint" data-testid={`${prefix}-hint-equipment`} onClick={() => void saveDoc(doc, { is_equipment_sop: true })}>
                                  <span className="src-badge">EQUIS</span>
                                  {t("tobe.hint.equipment", { tag: hint.tag })}
                                </button>
                              ),
                            )}
                          </span>
                        )}
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
                          onChange={(next) => changeType(doc, next)}
                        />
                      </td>
                      <td>
                        {doc.doc_type === "wi" ? (
                          <Select
                            testId={`${prefix}-parent`}
                            ariaLabel={t("tobe.colParent")}
                            size="sm"
                            mono
                            width={148}
                            value={doc.parent_key ?? ""}
                            disabled={!canEdit}
                            options={sops.map((sop) => ({ value: sop.key, label: sop.code.trim() || t("tobe.noCode"), tip: sop.code.trim() || t("tobe.noCode") }))}
                            onChange={(next) => {
                              const parent = sops.find((sop) => sop.key === next);
                              if (parent) void saveDoc(doc, { parent_code: parent.code });
                            }}
                          />
                        ) : (
                          <span className="text-ink-4">–</span>
                        )}
                      </td>
                      <td>
                        {written ? (
                          // 쓴 파일은 이 줄에 붙어 있다 - 따로 줄을 만들지 않는다. 버전·언어 배치는 줄을 펼치면 있다
                          <span className="flex w-[168px] min-w-0 items-center gap-0.5 max-[1279px]:w-[152px]" data-testid={`${prefix}-written`}>
                            <Truncate className="min-w-0 flex-1 font-mono text-xs text-ink-2" text={written.file_name} />
                            <span className="row-actions-quiet flex flex-none gap-0.5">
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
                          </span>
                        ) : (
                          <span className="text-ink-4" data-testid={`${prefix}-not-written`}>
                            {t("tobe.notWritten")}
                          </span>
                        )}
                      </td>
                      <td>
                        {doc.doc_type === "sop" ? (
                          <Checkbox className="mt-1.5" testId={`${prefix}-equipment`} ariaLabel={t("tobe.colEquipment")} checked={doc.is_equipment_sop} disabled={!canEdit} onChange={(next) => void saveDoc(doc, { is_equipment_sop: next })} />
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
                              <MorphButton icon={Trash2} tone="danger" label={t("tobe.removeDoc")} testId={`${prefix}-remove`} onClick={() => void runWrite(() => removeToBeDoc(bundleId, readDocId(doc.key)))} />
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                  return [
                    row,
                    <CollapseRow key={`${doc.key}-detail`} open={isOpen} colSpan={colSpan} className="bg-sunken">
                      {written && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 pt-1.5 text-xs" data-testid={`${prefix}-written-detail`}>
                          <span className="text-ink-3">{t("tobe.colWritten")}</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-ink-3">{t("documents.colVersion")}</span>
                            <VersionInput value={written.doc_version} disabled={!canEdit} testId={`${prefix}-written-version`} onCommit={(doc_version) => void file.onSave(written, { doc_version }).catch(() => undefined)} />
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-ink-3">{t("documents.colLayout")}</span>
                            <Select
                              testId={`${prefix}-written-layout`}
                              ariaLabel={t("documents.colLayout")}
                              size="sm"
                              value={written.language_layout}
                              disabled={!canEdit}
                              options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} />, tip: t(`layoutKind.${layout}`) }))}
                              onChange={(next) => void file.onSave(written, { language_layout: next }).catch(() => undefined)}
                            />
                          </span>
                        </div>
                      )}
                      {renderDetail(doc)}
                    </CollapseRow>,
                  ];
                })}
            {/* 번호로 더하기 - 번호를 적고 Enter면 그 줄이 저장된다. 여러 줄을 붙여 넣으면 줄마다 하나씩 더한다 */}
            {list !== null && canEdit && (
              <tr data-testid="tobe-add-row">
                <td />
                <td colSpan={colSpan - 1}>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addCodes(adding);
                    }}
                  >
                    <input
                      // 줄의 번호 칸과 같은 폭 - 칸이 표 끝까지 늘어나지 않게
                      className={`${CELL_INPUT} max-w-[152px] flex-none font-mono`}
                      data-testid="tobe-add-code"
                      value={adding}
                      maxLength={100}
                      placeholder={t("tobe.addPlaceholder")}
                      aria-label={t("tobe.addDoc")}
                      disabled={saving}
                      onChange={(event) => setAdding(event.target.value)}
                      onPaste={handleAddPaste}
                    />
                    <button type="submit" className="btn h-7" data-testid="tobe-add" disabled={saving || adding.trim() === ""}>
                      <Plus size={14} strokeWidth={1.5} aria-hidden />
                      {t("tobe.addDoc")}
                    </button>
                    <span className="text-xs text-ink-3">{t("tobe.addHint")}</span>
                  </form>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {pendingImport !== null && (
        <ConfirmModal
          title={t("tobe.importTitle")}
          target={pendingImport.name}
          summary={t("tobe.importBody", { n: tobe?.docs.length ?? 0 })}
          confirmLabel={t("tobe.importConfirm")}
          confirmIcon={FileUp}
          busy={saving}
          testId="tobe-import-modal"
          onConfirm={() => void handleImport(pendingImport)}
          onClose={cancelImport}
        />
      )}
      {isReading && tobe !== null && (
        <ListReader
          bundleId={bundleId}
          tobe={tobe}
          proposal={proposal.data}
          stoppedJobs={stoppedReadJobs}
          onClose={() => setIsReading(false)}
          onListChanged={() => {
            reload();
            void loadBundle(bundleId);
          }}
          onProposalChanged={proposal.reload}
          onRequested={aiJobs.watch}
        />
      )}
      {list !== null && rows.length === 0 && (
        <EmptyState icon={ListTree} testId="tobe-empty" title={t("tobe.emptyTitle")} body={canEdit ? t("tobe.emptyEdit") : t("tobe.empty")} />
      )}
    </section>
  );
}
