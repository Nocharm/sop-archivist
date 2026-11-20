// Assign 빈 템플릿(엮은 New 문서) 기본 보기의 순서 · 칸 옮기기 · 번호 표시 저장(시안 2 D6) - Order 화면과 같은 길: CEdit(c-edit-model)를 화면 문서에 먼저 얹고
// 저장은 c-save-queue로 한 번에 하나씩 PUT …/targets/order. 응답(그 문서의 C 모양)은 엮은 문서 위에 칸 · 순서 · 번호 · 깊이 · 표시로 얹어 두고(applyCOrder),
// 다시 받은 엮은 문서가 같은 모양이 되면(서버가 따라잡음) 걷는다. 실패하면 저장 안 된 편집을 모두 버리고 알린다(409 · 422는 묶음 revision을 다시 읽는다).
// 끌어 옮긴 저장이 끝나면 Undo가 든 알림 - Undo는 같은 길로 되돌리는 편집을 보낸다.
"use client";

import { useEffect, useRef, useState } from "react";

import { showToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { putTargetOrder, type ComposedDoc, type OutputLang, type TargetOrderResult } from "@/lib/api-sop";
import { loadBundle, readBundleRevision, setBundleRevision } from "@/lib/bundle-store";
import { acceptSaved, addEdit, rejectSaved, sendDraft, startDraft, type CEdit, type DocDraft, type PlaceEdit } from "@/lib/c-edit-model";
import { EMPTY_QUEUE, enqueueJob, findOtherSave, finishJob, takeNextJob, trackBundleSave, type SaveQueue } from "@/lib/c-save-queue";
import { applyCOrder, buildPlaceUndo, isSameCOrder, toOutputCDoc } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";

/** 한 문서의 저장 상태 - draft는 C 모양, sending은 날아가는 요청에 실린 줄(박스 쉬머), undo는 날아가는 요청이 끝나면 띄울 Undo 알림 */
interface OrderState {
  docId: number;
  draft: DocDraft;
  sending: readonly number[];
  undo: { note: string; edits: readonly CEdit[] } | null;
}

export interface ComposedOrder {
  /** 화면 문서 - 기다리는 편집 · 받은 저장을 얹은 엮은 문서(없으면 받은 그대로) */
  doc: ComposedDoc | null;
  /** 저장이 날아가는 중 */
  busy: boolean;
  /** 날아가는 저장에 실린 줄 */
  pendingIds: ReadonlySet<number>;
  /** 편집 묶음을 화면에 얹고 저장을 줄에 넣는다 - 하나라도 얹을 수 없으면 아무것도 하지 않고 false */
  apply: (edits: readonly CEdit[]) => boolean;
  /** 끌어 옮긴 place 편집 - 저장이 끝나면 note와 Undo가 든 알림 */
  place: (edit: PlaceEdit, note: string) => boolean;
}

/** 저장 상태가 지금 문서의 것이고 아직 얹어 보여야 하나 - 기다리는 · 날아가는 편집이 없고 받은 문서가 저장된 모양과 같으면 서버가 따라잡은 것이다 */
function readLive(state: OrderState | null, doc: ComposedDoc | null): OrderState | null {
  if (!state || !doc || state.docId !== doc.target_doc_id) return null;
  if (state.draft.edits.length === 0 && state.sending.length === 0 && isSameCOrder(toOutputCDoc(doc), state.draft.saved)) return null;
  return state;
}

const NO_IDS: ReadonlySet<number> = new Set();

export function useComposedOrder({ bundleId, doc, labelLang }: { bundleId: number; doc: ComposedDoc | null; labelLang: OutputLang }): ComposedOrder {
  const { t } = useI18n();
  const [view, setView] = useState<OrderState | null>(null);
  // 이벤트 · 응답이 읽는 최신 값 - 렌더 중에는 읽지 않는다
  const stateRef = useRef<OrderState | null>(null);
  const docRef = useRef(doc);
  const queueRef = useRef<SaveQueue>(EMPTY_QUEUE);
  const ownerRef = useRef({});
  const waitingRef = useRef(false);
  const tRef = useRef(t);
  useEffect(() => {
    docRef.current = doc;
    tRef.current = t;
  });

  const live = readLive(view, doc);
  const shown = live && doc ? applyCOrder(doc, live.draft.shown) : doc;

  function put(next: OrderState | null) {
    stateRef.current = next;
    setView(next);
  }

  /** 지금 얹을 초안 - 날아가는 저장이 있으면 그 초안에 잇고, 없으면 받은 문서(그 위의 받은 저장)에서 새로 - 그새 들어온 줄까지 실어야 서버가 받는다(order_mismatch) */
  function readDraft(current: ComposedDoc): DocDraft {
    const state = readLive(stateRef.current, current);
    if (state && (state.sending.length > 0 || state.draft.edits.length > 0)) return state.draft;
    const base = toOutputCDoc(state ? applyCOrder(current, state.draft.saved) : current);
    return startDraft(base);
  }

  function apply(edits: readonly CEdit[], undo: OrderState["undo"] = null): boolean {
    const current = docRef.current;
    if (!current || edits.length === 0) return false;
    const before = readDraft(current);
    let draft: DocDraft | null = before;
    for (const edit of edits) draft = draft && addEdit(draft, edit);
    if (!draft) return false;
    const state = readLive(stateRef.current, current);
    put({ docId: current.target_doc_id, draft, sending: state?.sending ?? [], undo: undo ?? state?.undo ?? null });
    queueRef.current = enqueueJob(queueRef.current, { kind: "doc", docId: current.target_doc_id });
    pump();
    return true;
  }

  function place(edit: PlaceEdit, note: string): boolean {
    const current = docRef.current;
    if (!current) return false;
    const before = readDraft(current);
    const after = addEdit(before, edit);
    if (!after) return false;
    return apply([edit], { note, edits: buildPlaceUndo(before.shown, after.shown, edit) });
  }

  /** 날아가는 요청이 없으면 기다리는 저장을 보낸다 - 떠났다 돌아오기 전 화면(Order 등)의 저장이 날아가면 그 뒤에 */
  function pump() {
    if (waitingRef.current) return;
    const other = findOtherSave(bundleId, ownerRef.current);
    if (other) {
      waitingRef.current = true;
      void other.then(() => {
        waitingRef.current = false;
        pump();
      });
      return;
    }
    const next = takeNextJob(queueRef.current);
    if (!next) return;
    queueRef.current = next.queue;
    const state = stateRef.current;
    const revision = readBundleRevision(bundleId);
    if (!state || next.job.kind !== "doc" || state.docId !== next.job.docId || state.draft.edits.length === 0 || revision === null) {
      queueRef.current = finishJob(queueRef.current);
      return;
    }
    const sent = sendDraft(state.draft);
    const sending = state.draft.edits.flatMap((edit) => ("targetIds" in edit ? edit.targetIds : [edit.targetId]));
    const undo = state.undo;
    put({ ...state, draft: sent.draft, sending, undo: null });
    const request = putTargetOrder(bundleId, labelLang, { revision, target_doc_id: state.docId, items: sent.items });
    trackBundleSave(bundleId, ownerRef.current, request);
    request.then(
      (result) => handleSaved(result, undo),
      (err: unknown) => handleFailed(state.docId, err),
    );
  }

  function handleSaved(result: TargetOrderResult, undo: OrderState["undo"]) {
    queueRef.current = finishJob(queueRef.current);
    setBundleRevision(bundleId, result.revision);
    const state = stateRef.current;
    if (state && state.docId === result.target_doc_id) {
      const draft = acceptSaved(state.draft, result.doc);
      put({ ...state, draft, sending: [] });
      if (draft.edits.length > 0) queueRef.current = enqueueJob(queueRef.current, { kind: "doc", docId: state.docId });
    }
    if (undo && undo.edits.length > 0) {
      const translate = tRef.current;
      showToast(undo.note, "ok", { action: { label: translate("common.undo"), run: () => void apply(undo.edits) } });
    }
    pump();
  }

  function handleFailed(docId: number, err: unknown) {
    queueRef.current = finishJob(queueRef.current);
    const state = stateRef.current;
    const translate = tRef.current;
    if (state && state.docId === docId) put({ ...state, draft: rejectSaved(state.draft), sending: [], undo: null });
    showToast(`${translate("assign.composedOrder.rolledBack")} ${humanizeApiError(err, translate)}`, "error");
    // 409 · 422는 revision이나 보낸 목록이 낡았다, 5xx는 서버가 저장했을 수 있다 - 묶음을 다시 읽어야 다음 저장이 같은 이유로 거절되지 않는다
    if (err instanceof ApiError && (err.status === 409 || err.status === 422 || err.status >= 500)) void loadBundle(bundleId);
    pump();
  }

  return {
    doc: shown,
    busy: live !== null && live.sending.length > 0,
    pendingIds: live && live.sending.length > 0 ? new Set(live.sending) : NO_IDS,
    apply: (edits) => apply(edits),
    place,
  };
}
