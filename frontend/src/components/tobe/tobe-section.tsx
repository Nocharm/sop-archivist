// New 문서 목록(새로 만들 SOP·WI) - Documents 화면의 Old 문서 목록 아래에 놓인다. 줄을 번호로 더하고, 칸마다 바로 저장한다(초안·Save 없음).
// 줄은 두 줄로 읽고(ToBeRow), 누르면 펼친 곳(ToBePanel)에서 고친다 - SOP는 칸 상태 표, WI는 단계. 이미 쓴 파일은 그 줄에 붙어 보인다. Excel 템플릿 내려받기·가져오기는 메뉴에 있다.
// EQUIS가 아는 값(종류·장비 번호)은 펼친 곳의 그 칸 옆에 작은 제안으로 뜨고 사람이 눌러 넣는다 - 자동으로 바꾸지 않는다.
// WI 줄은 끌어 다른 SOP 줄에 놓으면 그 SOP 아래로 옮겨 바로 저장되고, 알림의 Undo가 앞의 부모로 되돌린다(설계 §7). Restore의 알림도 Undo를 지닌다(§8).
"use client";

import { Download, FileUp, ListTree, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type ClipboardEvent } from "react";

import { BundleLoadError } from "@/components/bundle-load-error";
import { ListReader } from "@/components/tobe/list-reader";
import { SlotTable } from "@/components/tobe/slot-table";
import { ToBePanel } from "@/components/tobe/tobe-panel";
import { ToBeRow } from "@/components/tobe/tobe-row";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu } from "@/components/ui/menu";
import { showToast } from "@/components/ui/toast";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { flashElement, useFlip } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
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
  refreshEquis,
  removeToBeDoc,
  removeWiStep,
  renameWiStep,
  setNaSlot,
  updateToBeDoc,
  type DocumentUpdateInput,
  type SopDocument,
  type ToBe,
  type ToBeDocPatch,
} from "@/lib/api-sop";
import { findUnderPoint, type BoxDragConfig, type DragPoint } from "@/lib/box-drag";
import { getBundleLabel } from "@/lib/bundle-label";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildDownloadName } from "@/lib/download-name";
import { hasRefreshingEquis, normalizeDocNumber } from "@/lib/equis-model";
import { useI18n } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/leave-guard";
import { navigate } from "@/lib/nav-buffer";
import { PARENT_REFUSAL_KEYS, buildParentCard, canDragParent, canUndoParentMove, resolveParentDrop } from "@/lib/parent-drop-model";
import { getRevealScrollTop, readUntransformedBox } from "@/lib/reveal-scroll";
import { saveBlob } from "@/lib/save-file";
import { buildSlotRows, canUndoRestore, formatSlotName, isNaEditDirty, listUsedReasons, summarizeSlots, type NaEdit, type SlotKey, type SlotRow, type SlotSummary } from "@/lib/slot-status-model";
import { NEW_DOCUMENTS_ANCHOR } from "@/lib/stages";
import { ADD_PREVIEW_KEYS, describeAdd, listEquisHints, planAddRows, readCodes, type AddPreview } from "@/lib/tobe-add-model";
import { createDraft, orderDocs, type DraftDoc } from "@/lib/tobe-draft";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useBoxDrag } from "@/lib/use-box-drag";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { useLoaded } from "@/lib/use-loaded";

const CELL_INPUT = "h-7 w-full rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink focus:border-accent focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:text-ink-2";

/** 409 revision_conflict - 보낸 revision이 서버 것보다 낡았다 */
function isRevisionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.rule?.code === "revision_conflict";
}

/** 등록 미리 보기 문구의 값 */
function readPreviewVars(preview: Exclude<AddPreview, { kind: "none" }>): Record<string, string | number> {
  switch (preview.kind) {
    case "wi":
      return { code: preview.code, parent: preview.parent };
    case "many":
      return { n: preview.n };
    default:
      return { code: preview.code };
  }
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
  const reloadingRef = useRef(false);
  // 지금 그려진 목록 - 쓰는 동안 다시 받은 목록이 왔는지 쓰기가 끝날 때 견준다
  const latestDataRef = useRef(data);
  useEffect(() => {
    reloadingRef.current = isLoading && data !== null;
    latestDataRef.current = data;
  }, [isLoading, data]);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 줄 하나를 저장한 응답 - 다시 받은 목록이 올 때까지 이쪽이 더 새롭다(받은 목록이 바뀌면 저절로 버려진다)
  const [fresh, setFresh] = useState<{ base: ToBe; tobe: ToBe } | null>(null);
  const tobe = data !== null && fresh?.base === data ? fresh.tobe : data;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // 진행 중인 쓰기 수 - saving은 다시 그린 뒤에야 닿아, 같은 작업 안의 두 번째 Enter·누름(N/A 저장 · Restore · 번호 더하기)은 이 값으로 막는다
  const writesRef = useRef(0);
  // N/A 사유 편집기 - 화면에 하나. Save N/A·Cancel(과 서버의 409)로만 닫히고 줄을 접어도 남는다
  const [naEdit, setNaEdit] = useState<NaEdit | null>(null);
  // 적던 사유가 있는 채 떠나려 한 주소 - 확인 창이 묻는다
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 방금 번호로 더한 마지막 줄 - 그려진 뒤 잠깐 강조하고 보이게 한다. seq는 같은 번호를 다시 더해도(빼고 다시) 한 번씩 강조하게
  const [justAdded, setJustAdded] = useState<{ code: string; seq: number } | null>(null);
  const flashedSeqRef = useRef(0);
  // 끌어 상위 SOP를 바꾼 줄 - 새 자리에 그려진 뒤 잠깐 강조한다. seq는 같은 줄을 다시 옮겨도 한 번씩
  const [moved, setMoved] = useState<{ key: string; seq: number } | null>(null);
  const flashedMoveRef = useRef(0);
  // 상위 SOP가 바뀐 뒤 줄들이 새 자리로 미끄러진다 - 목록 틀이 끌기의 root이자 자리 바꿈의 틀이다
  const flip = useFlip(listRef);
  // 칸 상태 막대의 눈금 툴팁 - 목록 틀 하나가 맡는다
  const barTip = useDelegatedTip();
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
  // 부모를 못 찾은 WI - orderDocs가 끝에 모아 둔다
  const looseCount = rows.filter(({ doc, depth }) => doc.doc_type === "wi" && depth === 0).length;
  const addPreview = describeAdd(adding, tobe?.docs ?? []);
  const sops = list ? list.docs.filter((doc) => doc.doc_type === "sop") : [];
  const docsByKey = new Map((list?.docs ?? []).map((doc) => [doc.key, doc]));
  // 줄마다 끌 수 있는지(canDragParent)에 쓰는 값
  const dragState = { canEdit, saving, sopKeys: sops.map((sop) => sop.key) };
  const savedByCode = new Map((tobe?.docs ?? []).map((doc) => [doc.code, doc]));
  // 다시 받은 목록에서 편집기의 문서가 사라졌거나 SOP가 아니게 됐으면 편집기를 닫는다 - 렌더 중 상태 맞추기
  if (naEdit !== null && tobe !== null && !tobe.docs.some((doc) => `id-${doc.id}` === naEdit.docKey && doc.doc_type === "sop")) setNaEdit(null);
  // 다시 받은 Bundle을 더는 고칠 수 없으면(검토 요청 · 끝남) 편집기를 닫는다 - 저장할 길이 없다
  if (naEdit !== null && bundle !== null && !canEdit) setNaEdit(null);
  useLeaveGuard(isNaEditDirty(naEdit), setLeaveTo);
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

  // 더한 줄이 목록에 그려진 뒤(커밋 뒤) 강조하고 창 밖이면 그쪽으로 스크롤한다. 포커스는 번호 칸에 둔다(저장하는 동안 꺼졌던 칸이라 포커스를 잃었다)
  const addedId = justAdded === null ? null : (tobe?.docs.find((doc) => doc.code === justAdded.code)?.id ?? null);
  useEffect(() => {
    if (justAdded === null || addedId === null || flashedSeqRef.current === justAdded.seq) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-testid="tobe-id-${addedId}-row"]`);
    if (!row) return;
    flashedSeqRef.current = justAdded.seq;
    flashElement(row);
    row.scrollIntoView({ block: "nearest" });
    addInputRef.current?.focus();
  }, [justAdded, addedId]);

  // 끌어 옮긴 줄이 새 자리에 그려진 뒤(커밋 뒤) 강조하고 창 밖이면 그쪽으로 스크롤한다.
  // 그 줄은 지금 옛 자리에서 미끄러져 오는 중이라(useFlip의 translateY) scrollIntoView는 옛 자리로 스크롤한다 - 미끄러짐을 되돌린 제자리로 정한다
  useEffect(() => {
    if (moved === null || flashedMoveRef.current === moved.seq) return;
    const row = listRef.current?.querySelector<HTMLElement>(`.doc-row[data-doc="${CSS.escape(moved.key)}"]`);
    if (!row) return;
    flashedMoveRef.current = moved.seq;
    flashElement(row);
    const scroller = row.closest<HTMLElement>(".frame-view, .overflow-auto, .overflow-y-auto");
    if (!scroller) return;
    const transform = getComputedStyle(row.closest("[data-flip-key]") ?? row).transform;
    const shiftY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    const next = getRevealScrollTop(scroller.getBoundingClientRect(), readUntransformedBox(row.getBoundingClientRect(), shiftY), scroller.scrollTop);
    if (next !== null) scroller.scrollTop = next;
  }, [moved]);

  /** 줄 쓰기의 결과 - 거절이면 그 오류를 함께 돌려준다(알림과 다시 받기는 이 안에서 한다). beforeApply는 응답을 얹기 바로 전에 한 번(자리 재기) */
  async function runWriteResult(write: () => Promise<ToBe>, options?: { beforeApply?: () => void }): Promise<{ ok: true } | { ok: false; error: unknown }> {
    if (!data) return { ok: false, error: null };
    writesRef.current += 1;
    setSaving(true);
    // 다시 받기가 이 쓰기와 겹치면(쓰기 전에 시작했거나, 쓰는 동안 다른 쓰기의 거절이 시작했다) 그 응답이 쓰기 앞의 목록을 읽었을 수 있어
    // 이 쓰기의 결과를 덮는다 - 끝나고 한 번 더 받는다. 쓰는 동안 이미 받아 온 목록이 있으면 결과를 그 목록 위에 얹는다
    const wasReloading = reloadingRef.current;
    try {
      const next = await write();
      const current = latestDataRef.current ?? data;
      const raced = wasReloading || reloadingRef.current || current !== data;
      options?.beforeApply?.();
      setFresh({ base: current, tobe: next });
      if (raced) reload();
      // 목록이 바뀌면 개요의 숫자·다음 할 일도 바뀐다
      void loadBundle(bundleId);
      return { ok: true };
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      reload();
      return { ok: false, error: err };
    } finally {
      writesRef.current -= 1;
      setSaving(false);
    }
  }

  /** 줄 하나를 쓴다 - 응답의 새 목록을 바로 보이고, 거절되면 까닭을 알리고 다시 받는다(칸이 저장된 값으로 돌아간다) */
  async function runWrite(write: () => Promise<ToBe>): Promise<boolean> {
    return (await runWriteResult(write)).ok;
  }

  /** 사유와 함께 N/A로 둔다. 409 slot_has_targets(그 사이 문장이 들어왔다)면 둘 곳이 없어 편집기를 닫고, 그 밖의 실패는 적던 사유를 남긴다 */
  async function saveNa(docId: number, slotKey: SlotKey, reason: string) {
    if (writesRef.current > 0) return;
    const result = await runWriteResult(() => setNaSlot(bundleId, docId, slotKey, reason));
    if (!result.ok && !(result.error instanceof ApiError && result.error.rule?.code === "slot_has_targets")) return;
    // 저장하는 사이 Esc로 닫고 다른 칸에 적기 시작했으면 그 편집기는 두고, 저장한 칸의 편집기만 닫는다
    const docKey = `id-${docId}`;
    setNaEdit((current) => (current !== null && current.docKey === docKey && current.slotKey === slotKey ? null : current));
  }

  /** 편집기를 열고 닫는다 - 접힌 줄에 적던 사유가 있어 다른 칸이 막히면(refused) 그 줄을 다시 펼쳐 편집기와 까닭이 보이게 한다 */
  function editNa(next: NaEdit | null) {
    if (next !== null && next.refused && !open.has(next.docKey)) setOpen((prev) => new Set(prev).add(next.docKey));
    setNaEdit(next);
  }

  /** N/A를 바로 지운다 - 그 칸은 빈 칸으로, 덮였던 하위 칸도 제 상태로 돌아간다. 알림의 Undo가 지우기 전의 사유로 다시 저장한다 */
  async function restoreNa(doc: DraftDoc, row: SlotRow) {
    if (writesRef.current > 0) return;
    const docId = readDocId(doc.key);
    // Restore는 N/A 칸에만 있다 - 사유는 지우기 전에 읽어 둔다
    const reason = row.state.kind === "na" ? row.state.reason : "";
    if (!(await runWrite(() => clearNaSlot(bundleId, docId, row.key)))) return;
    // 알림은 같은 글이면 앞의 것을 지운다 - 문서 번호를 적어 두 SOP의 같은 칸을 잇달아 되돌려도 알림마다 제 Undo가 남게
    const restoredIn = bundleId;
    showToast(t("tobe.slots.restored", { name: formatSlotName(row), code: doc.code }), "ok", {
      action: { label: t("common.undo"), run: () => void naUndoRef.current(restoredIn, docId, row.key, reason) },
    });
    setNaEdit((current) => (current !== null && current.docKey === doc.key && current.slotKey === row.key ? null : current));
  }

  /** Undo의 다시 읽기와 쓰기 - 진행 중인 쓰기로 세어 그동안 끌기 · Restore · N/A 저장이 시작되지 않게 한다(늦은 Undo가 그 사이의 놓기를 덮지 않게) */
  async function runUndo(forBundle: number, undo: () => Promise<void>) {
    writesRef.current += 1;
    try {
      await undo();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      writesRef.current -= 1;
      reload();
      void loadBundle(forBundle);
    }
  }

  /** Restore의 Undo - 다시 읽어 그 줄이 아직 SOP이고 그 칸이 N/A가 아닐 때만 지우기 전의 사유로 저장한다. 그사이 문장이 들어왔으면 서버가 409로 거절한다.
   * forBundle은 Restore한 Bundle - 알림은 화면을 넘어 남으므로 지금 그려진 Bundle이 아닐 수 있다 */
  function undoRestore(forBundle: number, docId: number, slotKey: SlotKey, reason: string) {
    return runUndo(forBundle, async () => {
      const fresh = await getToBe(forBundle);
      if (!canUndoRestore(fresh, docId, slotKey)) {
        showToast(t("tobe.undoStale"), "info");
        return;
      }
      await setNaSlot(forBundle, docId, slotKey, reason);
    });
  }

  /** 놓아서 상위 SOP를 바꾼다 - 바로 저장하고 Undo가 든 알림을 띄운다. 다른 줄 쓰기가 돌면 버린다(그동안은 끌기도 시작되지 않는다) */
  async function moveParent(doc: DraftDoc, parent: DraftDoc) {
    if (writesRef.current > 0) return;
    const docId = readDocId(doc.key);
    // 되돌릴 앞의 부모 - 부모를 못 찾은 WI는 없어 Undo를 주지 않는다(서버가 부모 없는 WI를 받지 않는다)
    const previous = doc.parent_key === null ? null : (docsByKey.get(doc.parent_key)?.code ?? null);
    const result = await runWriteResult(() => updateToBeDoc(bundleId, docId, { parent_code: parent.code }), {
      // 옮긴 줄이 첫째라 미끄러지는 동안 이웃 위로 지나간다
      beforeApply: () => flip.capture([doc.key, ...rows.map((row) => row.doc.key).filter((key) => key !== doc.key)]),
    });
    if (!result.ok) return;
    setMoved((prev) => ({ key: doc.key, seq: (prev?.seq ?? 0) + 1 }));
    // 알림은 같은 글이면 앞의 것을 지운다 - 번호를 적어 잇달아 옮겨도 알림마다 제 Undo가 남게
    const text = t("tobe.drag.moved", { wi: doc.code, sop: parent.code });
    const movedIn = bundleId;
    if (previous === null) showToast(text);
    else showToast(text, "ok", { action: { label: t("common.undo"), run: () => void parentUndoRef.current(movedIn, docId, doc.code, parent.code, previous) } });
  }

  /** 알림의 Undo - 다시 읽어 그 줄이 아직 놓았던 SOP 아래의 WI일 때만 앞의 부모로 저장한다. 아니면 쓰지 않고 알린다(남이 바꾼 것을 덮지 않는다).
   * 알림의 단추는 한 번뿐이라 진행 중인 쓰기로 막지 않는다. forBundle은 놓은 Bundle */
  function undoParentMove(forBundle: number, docId: number, wiCode: string, movedTo: string, previous: string) {
    return runUndo(forBundle, async () => {
      const fresh = await getToBe(forBundle);
      if (!canUndoParentMove(fresh, docId, movedTo)) {
        showToast(t("tobe.undoStale"), "info");
        return;
      }
      await updateToBeDoc(forBundle, docId, { parent_code: previous });
      showToast(t("tobe.drag.moved", { wi: wiCode, sop: previous }));
    });
  }
  // 알림은 화면을 넘어 남는다 - 콜백이 그 렌더의 함수를 붙들지 않게 가장 최근의 것을 미러한다(use-box-drag의 최신 config와 같은 짜임)
  const parentUndoRef = useRef(undoParentMove);
  const naUndoRef = useRef(undoRestore);
  useEffect(() => {
    parentUndoRef.current = undoParentMove;
    naUndoRef.current = undoRestore;
  });

  /** 포인터 아래 New 줄 상자와 그 문서 - 목록 틀 밖(Old 목록 등)이거나 줄 상자가 아니면(펼친 곳 · 등록 칸 · 빈 곳) null */
  function findDropRow(point: DragPoint): { el: HTMLElement; doc: DraftDoc } | null {
    const el = findUnderPoint(point, ".doc-row[data-doc]");
    const doc = el && listRef.current?.contains(el) ? docsByKey.get(el.dataset.doc ?? "") : undefined;
    return el && doc ? { el, doc } : null;
  }

  // WI 줄을 SOP 줄에 끈다(설계 §7) - 끄는 동안의 표시는 DOM 속성뿐이다(G11): 끄는 줄 data-drag-src, 화면 틀 data-parent-drag, 놓을 줄은 끌기 층이 다는 data-drop
  const parentDrag: BoxDragConfig<{ key: string }> = {
    pick: (event) => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>(".doc-row[data-drag-box]") : null;
      const doc = el ? docsByKey.get(el.dataset.doc ?? "") : undefined;
      // 저장이 도는 사이(다시 그리기 전)에도 끌지 않는다 - 응답 순서가 엇갈려 낡은 목록이 얹히지 않게
      if (!doc || writesRef.current > 0 || !canDragParent(doc, dragState)) return null;
      return { key: doc.key };
    },
    getCard: ({ key }) => buildParentCard(docsByKey.get(key) ?? { code: "", title: "" }, t("tobe.row.noTitle")),
    // Documents 화면의 스크롤 칸은 앱 틀(main.frame-view)이다
    getScrollers: () => {
      const pane = listRef.current?.closest<HTMLElement>(".frame-view, .overflow-auto, .overflow-y-auto");
      return pane ? [pane] : [];
    },
    onStart: ({ key }) => {
      listRef.current?.querySelector(`.doc-row[data-doc="${CSS.escape(key)}"]`)?.setAttribute("data-drag-src", "");
      listRef.current?.closest("[data-parent-drag-root]")?.setAttribute("data-parent-drag", "");
    },
    onMove: ({ key }, point) => {
      const source = docsByKey.get(key);
      const target = findDropRow(point);
      if (!source || !target) return { state: "none" };
      const drop = resolveParentDrop(source, target.doc);
      if (drop.kind === "move") return { state: "ok", note: t("tobe.drag.parent", { code: drop.parentCode }), target: target.el };
      if (drop.kind === "refused") return { state: "refused", note: t(PARENT_REFUSAL_KEYS[drop.reason]), target: target.el };
      return { state: "none" };
    },
    // 놓은 자리에서 다시 판단한다 - 마지막 move 뒤에 목록이 바뀌었을 수 있다
    onDrop: ({ key }, point) => {
      const source = docsByKey.get(key);
      const target = findDropRow(point);
      if (source && target && resolveParentDrop(source, target.doc).kind === "move") void moveParent(source, target.doc);
    },
    // 취소 때도 - 화면이 사라지며 끊긴 끌기도 치우게 문서 전체에서 찾는다
    onEnd: () => {
      for (const el of document.querySelectorAll(".doc-row[data-drag-src]")) el.removeAttribute("data-drag-src");
      document.querySelector("[data-parent-drag]")?.removeAttribute("data-parent-drag");
    },
  };
  // 끌 수 있는 줄이 하나도 없으면(읽기 전용 · 저장 중 · SOP가 하나뿐) 붙이지 않는다
  useBoxDrag(listRef, rows.some(({ doc }) => canDragParent(doc, dragState)) ? parentDrag : null);

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
    // 장비 SOP 표시는 SOP에만 있다 - 켜진 채 WI로 바꾸면 서버가 거절하므로 함께 끈다
    else void saveDoc(doc, { doc_type: "wi", parent_code: parent.code, ...(doc.is_equipment_sop ? { is_equipment_sop: false } : {}) });
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
    if (!tobe || writesRef.current > 0) return;
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
      setJustAdded((prev) => ({ code: plan.rows[added - 1].code, seq: (prev?.seq ?? 0) + 1 }));
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
    writesRef.current += 1;
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
      writesRef.current -= 1;
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

  /** SOP의 칸 상태 표 - WI는 N/A를 받지 않는다(서버 422 na_on_wi) */
  function renderSections(doc: DraftDoc, slots: { rows: readonly SlotRow[]; summary: SlotSummary } | null) {
    if (!tobe || slots === null) return null;
    const docId = readDocId(doc.key);
    return (
      <SlotTable
        prefix={`tobe-${doc.key}`}
        docKey={doc.key}
        rows={slots.rows}
        summary={slots.summary}
        isWritten={doc.entrance === "match"}
        canEdit={canEdit}
        saving={saving}
        usedReasons={listUsedReasons(tobe)}
        edit={naEdit}
        onEdit={editNa}
        onSave={(slotKey, reason) => saveNa(docId, slotKey, reason)}
        onRestore={(row) => void restoreNa(doc, row)}
      />
    );
  }

  return (
    <section className="dense flex flex-col border-t border-line bg-surface" aria-labelledby={NEW_DOCUMENTS_ANCHOR} data-testid="tobe-section">
      {/* 화면 제목 밑줄은 화면에 한 번만 쓴다 - 영역 머리는 밑줄 없이 */}
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-line px-[var(--pad)] py-2">
        <h2 id={NEW_DOCUMENTS_ANCHOR} className="page-title scroll-mt-4">
          {t("documents.tobeTitle")}
        </h2>
        {list !== null && (
          <span className="count" data-testid="tobe-count">
            {rows.length}
          </span>
        )}
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
        <>
          {/* 번호로 더하기 - 목록 머리 바로 아래. 적는 동안 무엇이 더해질지(planAddRows의 결과 그대로) 옆에 적는다. Enter면 그 줄이 저장되고, 여러 줄을 붙여 넣으면 줄마다 하나씩 더한다 */}
          {list !== null && canEdit && (
            <form
              // doc-add - WI 줄을 끄는 동안 흐려지는 곳(components.css)
              className="doc-add flex flex-wrap items-center gap-x-2 gap-y-1 px-[var(--pad)] py-2"
              data-testid="tobe-add-row"
              onSubmit={(event) => {
                event.preventDefault();
                void addCodes(adding);
              }}
            >
              <input
                ref={addInputRef}
                // 줄의 번호 칸과 같은 폭 - 칸이 줄 끝까지 늘어나지 않게
                className={`${CELL_INPUT} max-w-[152px] flex-none font-mono`}
                data-testid="tobe-add-code"
                value={adding}
                maxLength={100}
                placeholder={t("tobe.addPlaceholder")}
                aria-label={t("tobe.addDoc")}
                disabled={saving}
                onChange={(event) => setAdding(event.target.value)}
                onPaste={handleAddPaste}
                // Add가 꺼져 있어도(이미 있는 번호) Enter는 지금처럼 알림으로 답한다 - 꺼진 제출 단추는 Enter 제출을 막는다
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void addCodes(adding);
                }}
              />
              <button type="submit" className="btn h-7" data-testid="tobe-add" disabled={saving || addPreview.kind === "none" || addPreview.kind === "taken"}>
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                {t("tobe.addDoc")}
              </button>
              <span className={`min-w-0 text-xs ${addPreview.kind === "none" ? "text-ink-3" : "text-ink-2"}`} aria-live="polite" data-testid="tobe-add-preview">
                {addPreview.kind === "none" ? t("tobe.addHint") : t(ADD_PREVIEW_KEYS[addPreview.kind], readPreviewVars(addPreview))}
              </span>
            </form>
          )}
          <div ref={listRef} className="doc-list border-t border-line" data-testid="tobe-list" {...barTip.handlers}>
            {list === null || tobe === null
              ? showSkeleton &&
                Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="doc-row" aria-hidden>
                    <span />
                    <span className="sk h-5 w-[140px]" />
                    <span className="grid gap-1.5">
                      <span className="sk h-5" style={{ width: 300 }} />
                      <span className="sk h-4" style={{ width: 180 }} />
                    </span>
                    <span />
                  </div>
                ))
              : rows.map(({ doc, depth }, index) => {
                  const written = findFile(doc.code);
                  const saved = savedByCode.get(doc.code);
                  const steps = list.wi_steps.filter((step) => step.doc_key === doc.key).sort((a, b) => a.step_no - b.step_no);
                  const docId = readDocId(doc.key);
                  const equis = equisByCode.get(normalizeDocNumber(doc.code)) ?? null;
                  const hints = canEdit ? listEquisHints(doc, equis) : [];
                  // SOP 줄의 칸(그 문서 골격의 항목) - 줄과 펼친 곳의 표가 같은 값을 쓴다(줄마다 한 번)
                  const slotRows = saved !== undefined && saved.doc_type === "sop" ? buildSlotRows(tobe, saved) : null;
                  const slots = slotRows === null ? null : { rows: slotRows, summary: summarizeSlots(slotRows) };
                  const isLoose = doc.doc_type === "wi" && depth === 0;
                  const isFirstLoose = isLoose && index === rows.length - looseCount;
                  const row = (
                    <ToBeRow
                      key={doc.key}
                      doc={doc}
                      isChild={depth === 1}
                      tobe={tobe}
                      saved={saved}
                      written={written}
                      equis={equis}
                      stepCount={steps.length}
                      slots={slots}
                      hintCount={hints.length}
                      noParent={isLoose}
                      canEdit={canEdit}
                      draggable={canDragParent(doc, dragState)}
                      open={open.has(doc.key)}
                      onToggle={() => toggleOpen(doc.key)}
                      hasUnsavedNa={naEdit?.docKey === doc.key && isNaEditDirty(naEdit)}
                      onRemove={() => void runWrite(() => removeToBeDoc(bundleId, docId))}
                      onEquisRefresh={() => void handleEquisRefresh(doc.code)}
                      panel={() => (
                        <ToBePanel
                          doc={doc}
                          tobe={tobe}
                          saved={saved}
                          sops={sops}
                          steps={steps}
                          written={written}
                          // EQUIS가 아는 값 - 줄과 다를 때만 뜨고, 눌러야 들어간다
                          hints={hints}
                          // EQUIS에 있는 번호의 제목은 EQUIS가 정한다 - 다른 값을 보내도 서버가 EQUIS 이름으로 되돌린다
                          isTitleLocked={equis?.title_locked === true}
                          canEdit={canEdit}
                          saving={saving}
                          saveDoc={(patch) => saveDoc(doc, patch)}
                          changeType={(next) => changeType(doc, next)}
                          onAddStep={() => void runWrite(() => addWiStep(bundleId, docId, ""))}
                          onRenameStep={(stepNo, title) => runWrite(() => renameWiStep(bundleId, docId, stepNo, title))}
                          onRemoveStep={(stepNo) => void runWrite(() => removeWiStep(bundleId, docId, stepNo))}
                          file={file}
                          sections={renderSections(doc, slots)}
                        />
                      )}
                    />
                  );
                  // 부모를 못 찾은 WI는 목록 끝에 모인다(orderDocs) - 그 첫 줄 앞에 묶음 머리
                  return isFirstLoose ? (
                    <Fragment key={doc.key}>
                      <div className="doc-loose" data-testid="tobe-loose">
                        {t("tobe.row.noParent")}
                        <span className="count">{looseCount}</span>
                      </div>
                      {row}
                    </Fragment>
                  ) : (
                    row
                  );
                })}
          </div>
          {barTip.node}
        </>
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
      {leaveTo !== null && (
        <ConfirmModal
          title={t("tobe.leaveTitle")}
          summary={t("tobe.leaveBody")}
          confirmLabel={t("tobe.leaveConfirm")}
          danger
          testId="tobe-leave"
          onClose={() => setLeaveTo(null)}
          onConfirm={() => {
            const href = leaveTo;
            setLeaveTo(null);
            setNaEdit(null);
            navigate(href, { immediate: true });
          }}
        />
      )}
      {list !== null && rows.length === 0 && (
        <EmptyState icon={ListTree} testId="tobe-empty" title={t("tobe.emptyTitle")} body={canEdit ? t("tobe.emptyEdit") : t("tobe.empty")} />
      )}
    </section>
  );
}
