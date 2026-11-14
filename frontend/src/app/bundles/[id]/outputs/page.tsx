// 결과물 한 벌 - A(옛 줄과 새 문장 대조 7열)·B(흐름)·C(새 문서 미리 보기), 요약 숫자, 의미 검토 4항목, Excel 내보내기(명세 §12-8).
// 판(한글판/영어판)이 없다 - 화면 UI 언어는 위치 표기·칸 이름 같은 라벨 언어로만 보낸다. Excel은 요청 중 → 파일 생성 / 실패 두 단계로 보인다(디자인 문서 10절).
// C의 순서·깊이·표시와 의미 확인은 화면에 먼저 얹고 뒤에서 한 번에 하나씩 저장한다(제품 명세 §7.13 C 순서 바꾸기) - 저장 응답으로 그 문서만 맞추고 C 전체를 다시 받지 않는다.
"use client";

import { Download, RefreshCw, Table2, Workflow } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { ExportPreviewModal } from "@/components/outputs/export-preview";
import { OutputARowView } from "@/components/outputs/output-a-row";
import { OutputBCard } from "@/components/outputs/output-b-card";
import { OutputCView } from "@/components/outputs/output-c";
import { ReadOnlyNote } from "@/components/read-only-note";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { LoadMoreRows } from "@/components/ui/load-more";
import { showToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import {
  getOutputA,
  getOutputB,
  getOutputC,
  getSummary,
  putSemanticChecks,
  putTargetOrder,
  SEMANTIC_CHECK_KEYS,
  type Bundle,
  type CoverStatus,
  type OutputC,
  type OutputLang,
  type TargetOrderResult,
} from "@/lib/api-sop";
import { loadBundle, putBundle, readBundleRevision, setBundleRevision, useBundle } from "@/lib/bundle-store";
import { acceptSaved, addEdit, hasUnsentEdits, rebaseDraft, rejectSaved, sendDraft, startDraft, type CEdit, type DocDraft } from "@/lib/c-edit-model";
import {
  canSendJob,
  EMPTY_QUEUE,
  enqueueJob,
  findOtherSave,
  finishJob,
  getDataRevision,
  getPendingSave,
  isOwnSave,
  releaseHold,
  takeNextJob,
  trackBundleSave,
  type CViewMark,
  type PendingSave,
  type SaveHold,
  type SaveJob,
} from "@/lib/c-save-queue";
import { useI18n } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/leave-guard";
import { navigate } from "@/lib/nav-buffer";
import { buildAScreenLines } from "@/lib/output-groups";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { readOutputsView, writeOutputsView, type OutputsTab } from "@/lib/outputs-view-prefs";
import { Checkbox } from "@/components/ui/checkbox";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { getStageHref } from "@/lib/stages";

/** 요약 숫자 순서 - 확정률은 따로 % 글로 */
const SUMMARY_ITEMS = ["old_rows", "assigned", "no_destination", "duplicate", "deleted", "moved", "new", "translated", "single_language"] as const;

// 삭제·바깥 문서 이동처럼 자리가 없는 보낸 곳과 변경 종류는 코드값 대신 화면 문구로 보인다(모르는 값은 그대로)
function labelCode(t: (key: string) => string, prefix: string, code: string): string {
  const key = `${prefix}.${code}`;
  const text = t(key);
  return text === key ? code : text;
}

function toCoverStatus(status: string): CoverStatus {
  return status === "confirmed" || status === "on_hold" || status === "ai_suggested" ? status : "unassigned";
}

const NO_DRAFTS: ReadonlyMap<number, DocDraft> = new Map();

/** 받은 결과물 C - 어느 받기(requestKey)의 것이고 어느 라벨 언어인지(그 C 위에 얹는 저장 응답도 같은 언어로 받는다) */
interface CState {
  bundleId: number | null;
  requestKey: string | null;
  base: OutputC | null;
  lang: OutputLang;
  error: unknown;
}

const EMPTY_C: CState = { bundleId: null, requestKey: null, base: null, lang: "en", error: null };

/** 다시 읽어야 바로잡히는 거절 - 다른 곳에서 바뀌었거나(409) 보낸 목록이 서버와 어긋났다(422). 네트워크 오류 등은 다시 읽지 않는다 */
function isStaleRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 422);
}

/** 서버 오류(5xx) - 순서 저장은 커밋 뒤에 응답 문서를 만들다 실패할 수 있어, 저장됐을 수 있다(묶음·C를 다시 읽어 서버 값을 보인다) */
function isServerError(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 500;
}

export default function OutputsPage() {
  // 라벨 언어 - 위치 표기·칸 이름·흐름 노드 이름을 화면 언어로 받는다(내용은 한 벌)
  const { t, lang } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  // 탭은 마지막으로 본 값에서 다시 연다 - 다른 단계에 다녀와도 처음(C)으로 돌아가지 않는다
  const [view, setView] = useState(readOutputsView);
  const { tab } = view;
  function setTab(next: OutputsTab) {
    setView((prev) => ({ ...prev, tab: next }));
    writeOutputsView({ tab: next });
  }
  // 이 화면이 저장으로 올린 revision - 결과물·요약을 다시 받는 계기로 쓰지 않는다(바뀐 C 문서는 응답으로 맞추고, 순서·깊이·표시·의미 확인은 요약 숫자를 바꾸지 않는다)
  const [ownRevisions, setOwnRevisions] = useState<ReadonlySet<number>>(() => new Set());
  const dataRevision = getDataRevision(bundle?.revision ?? 0, ownRevisions);
  const key = `${bundleId}:${lang}:${dataRevision}`;
  const outA = useLoaded(() => (tab === "a" ? getOutputA(bundleId, lang) : Promise.resolve(null)), `a:${tab}:${key}`);
  const outB = useLoaded(() => (tab === "b" ? getOutputB(bundleId, lang) : Promise.resolve(null)), `b:${tab}:${key}`);
  const summary = useLoaded(() => getSummary(bundleId), `${bundleId}:${dataRevision}`);

  // C - 받은 C와 초안을 한 응답 처리 안에서 함께 맞추려고(adoptC) useLoaded 대신 직접 받는다. 다른 탭에 다녀와도 받은 C는 남아 새로 받는 동안 보인다
  const [cReloads, setCReloads] = useState(0);
  const cRequestKey = tab === "c" ? `${key}#${cReloads}` : null;
  const [cState, setCState] = useState<CState>(EMPTY_C);
  // 문서마다 저장 안 된 편집을 얹은 초안 - 보이는 C는 draft.shown, 없으면 받은 문서
  const [drafts, setDraftsView] = useState<ReadonlyMap<number, DocDraft>>(NO_DRAFTS);
  const baseC = cState.bundleId === bundleId ? cState.base : null;
  const outC = { data: baseC, error: cState.requestKey === cRequestKey ? cState.error : null, reload: () => setCReloads((count) => count + 1) };
  const shownC = useMemo(
    () => (baseC && drafts.size > 0 ? { ...baseC, docs: baseC.docs.map((doc) => drafts.get(doc.target_doc_id)?.shown ?? doc) } : baseC),
    [baseC, drafts],
  );
  const current = tab === "a" ? outA : tab === "b" ? outB : outC;
  // 결과물 A는 수천 행이 될 수 있어 묶음씩 그린다. 함께 쓰는 칸은 전체 목록에서 정해 두어야 이어 그린 첫 줄이 윗줄과 비교된다
  const linesA = useMemo(() => buildAScreenLines(outA.data ?? []), [outA.data]);
  const rowsA = useProgressiveList(linesA, `a:${key}`);
  const showSkeleton = useDelayedFlag(current.data === null && current.error === null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // 의미 확인 - 누르면 화면에서 먼저 바뀌고, 보낼 때 마지막으로 고른 값을 싣는다(null이면 묶음 값)
  const [shownChecks, setShownChecks] = useState<Record<string, boolean> | null>(null);

  // 저장 줄 - 묶음 revision을 쓰는 요청은 한 번에 하나(c-save-queue). 화면에 그리지 않는 값이라 ref에 둔다
  const queueRef = useRef(EMPTY_QUEUE);
  const draftsRef = useRef<ReadonlyMap<number, DocDraft>>(NO_DRAFTS);
  const checksRef = useRef<Record<string, boolean> | null>(null);
  // 보이는 C와 받기 형편 - fetch는 받기 시작한 C의 수, fetching은 지금 받는 중(저장을 own으로 셀지 isOwnSave가 본다)
  const cRef = useRef({ state: EMPTY_C, fetch: 0, fetching: false });
  // 409·422·5xx 뒤 다시 읽을 때까지의 멈춤
  const holdRef = useRef<SaveHold>("none");
  // 화면을 떠나면 응답은 묶음 캐시만 맞추고 다음 저장을 보내지 않는다. owner는 묶음마다 날아가는 저장(trackBundleSave)에서 이 화면을 가린다
  const mountedRef = useRef(false);
  const ownerRef = useRef<object>({});
  const laneWaitRef = useRef(false);
  // 아직 보내지 않은 일(떠나면 사라진다) - 이탈 가드와 C 다시 받기 실패 안내가 본다. 줄을 움직일 때마다(pump) 맞춘다
  const [pendingSave, setPendingSave] = useState<PendingSave>("none");
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  // 확인 창에서 버리고 나가기를 고르면 떠날 때 다시 알리지 않는다
  const isDiscardConfirmedRef = useRef(false);
  useLeaveGuard(pendingSave !== "none", setLeaveTo);
  // 응답 처리(비동기)가 읽는 최신 값
  const latestRef = useRef({ tab, t });
  useEffect(() => {
    latestRef.current = { tab, t };
  });

  /**
   * 받은 C를 보인다 - 초안마다 rebaseDraft로 맞추고(날아가는 저장은 그대로, 다른 곳에서 바뀌어 기다리던 편집을 버리면 알린다),
   * 다시 읽은 뒤의 C면 멈춘 문서 저장을 다시 보낸다. 초안·C를 한 번에 바꿔 받은 C와 초안이 어긋난 화면이 그려지지 않는다.
   */
  function adoptC(requestKey: string, fetch: number, data: OutputC, labelLang: OutputLang) {
    const c = cRef.current;
    c.fetching = false;
    const byDoc = new Map<number, DocDraft>();
    let dropped = false;
    if (c.state.bundleId === bundleId) {
      for (const [docId, draft] of draftsRef.current) {
        const rebased = rebaseDraft(draft, data.docs.find((doc) => doc.target_doc_id === docId));
        if (rebased.draft) byDoc.set(docId, rebased.draft);
        dropped = dropped || rebased.dropped;
      }
    }
    draftsRef.current = byDoc;
    c.state = { bundleId, requestKey, base: data, lang: labelLang, error: null };
    setCState(c.state);
    setDraftsView(byDoc);
    if (dropped) showToast(latestRef.current.t("outputs.c.changedElsewhere"), "error");
    holdRef.current = releaseHold(holdRef.current, fetch);
    pump();
  }

  function setDraft(docId: number, draft: DocDraft) {
    const byDoc = new Map(draftsRef.current).set(docId, draft);
    draftsRef.current = byDoc;
    setDraftsView(byDoc);
  }

  /** 지금의 C 받기 형편 - 받는 중이거나 C 탭이 아니면 그때 보이는 결과물이 저장 전 것일 수 있다 */
  function readCMark(): CViewMark {
    return { fetch: cRef.current.fetch, busy: cRef.current.fetching || latestRef.current.tab !== "c" };
  }

  /** 날아가는 요청에 실리지 않은 바뀜이 남은 일 - 편집이 남은 문서, 아직 안 보낸 의미 확인 */
  function readPendingSave(): PendingSave {
    const waiting: SaveJob[] = [...draftsRef.current].filter(([, draft]) => hasUnsentEdits(draft)).map(([docId]) => ({ kind: "doc", docId }));
    if (checksRef.current !== null && queueRef.current.pending.some((job) => job.kind === "checks")) waiting.push({ kind: "checks" });
    return getPendingSave(holdRef.current, waiting);
  }

  // 떠날 때 보내지 못한 일이 남았으면 알린다 - 떠난 뒤에는 줄을 다시 돌리지 않는다(두 화면의 저장이 겹치지 않게)
  const notifyUnsentOnLeave = useEffectEvent(() => {
    if (readPendingSave() !== "none" && !isDiscardConfirmedRef.current) showToast(t("outputs.c.notSaved"), "error");
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      notifyUnsentOnLeave();
    };
  }, []);

  /** 누를 때·응답 뒤·C를 받은 뒤에 부른다 - 보낼 수 있는 일을 보내고, 남은 일을 화면 상태(이탈 가드)에 옮긴다 */
  function pump() {
    if (!mountedRef.current) return;
    sendNextJob();
    setPendingSave(readPendingSave());
  }

  /** 날아가는 요청이 없으면 줄 앞의 일을 보낸다. 보낼 것이 없어진 일(되돌린 문서 등)은 건너뛴다 */
  function sendNextJob() {
    if (laneWaitRef.current) return;
    // 떠났다 돌아오기 전 화면의 저장이 아직 날아가면 그 뒤에 보낸다 - 같은 묶음에 두 저장이 겹치지 않게
    const other = findOtherSave(bundleId, ownerRef.current);
    if (other) {
      laneWaitRef.current = true;
      void other.then(() => {
        laneWaitRef.current = false;
        pump();
      });
      return;
    }
    const canTake = (job: SaveJob) => canSendJob(holdRef.current, job);
    for (let next = takeNextJob(queueRef.current, canTake); next !== null; next = takeNextJob(queueRef.current, canTake)) {
      queueRef.current = next.queue;
      if (startJob(next.job)) return;
      queueRef.current = finishJob(queueRef.current);
    }
  }

  function startJob(job: SaveJob): boolean {
    // 묶음 캐시의 지금 revision - 저장 응답마다 바로 고쳐 둔다(setBundleRevision·putBundle)
    const revision = readBundleRevision(bundleId);
    if (revision === null) return false;
    if (job.kind === "checks") {
      const checks = checksRef.current;
      if (!checks) return false;
      const request = putSemanticChecks(bundleId, revision, checks);
      trackBundleSave(bundleId, ownerRef.current, request);
      request.then((saved) => handleChecksSaved(saved, checks), handleChecksFailed);
      return true;
    }
    const draft = draftsRef.current.get(job.docId);
    if (!draft || draft.edits.length === 0) return false;
    const sent = sendDraft(draft);
    draftsRef.current = new Map(draftsRef.current).set(job.docId, sent.draft);
    const mark = readCMark();
    // 응답 문서는 지금 보이는 C의 라벨 언어로 받는다 - 다른 언어의 C 위에 얹히지 않게
    const request = putTargetOrder(bundleId, cRef.current.state.lang, { revision, target_doc_id: job.docId, items: sent.items });
    trackBundleSave(bundleId, ownerRef.current, request);
    request.then(
      (result) => handleDocSaved(job.docId, mark, result),
      (err: unknown) => handleDocFailed(job.docId, err),
    );
    return true;
  }

  function handleDocSaved(docId: number, sent: CViewMark, result: TargetOrderResult) {
    // 화면을 떠난 뒤의 응답 - 묶음 캐시만 맞춘다(다음 화면이 낡은 revision으로 보내지 않게). 알림·다음 저장은 없다
    if (!mountedRef.current) {
      setBundleRevision(bundleId, result.revision);
      return;
    }
    queueRef.current = finishJob(queueRef.current);
    const draft = draftsRef.current.get(docId);
    if (draft) setDraft(docId, acceptSaved(draft, result.doc));
    // 보내고 받는 사이에 C를 받았거나 받는 중이면 own이 아니다 - revision이 키를 바꿔 그 저장이 든 C를 다시 받는다
    if (isOwnSave(sent, readCMark())) setOwnRevisions((prev) => new Set(prev).add(result.revision));
    setBundleRevision(bundleId, result.revision);
    pump();
  }

  function handleDocFailed(docId: number, err: unknown) {
    if (!mountedRef.current) return;
    queueRef.current = finishJob(queueRef.current);
    // 저장 안 된 바뀜 전부(보낸 것과 그 뒤에 누른 것)를 되돌린다 - 되돌린 것이 있을 때만 알린다
    const draft = draftsRef.current.get(docId);
    if (draft && draft.edits.length > 0) {
      const translate = latestRef.current.t;
      setDraft(docId, rejectSaved(draft));
      showToast(`${translate("outputs.c.rolledBack")} ${humanizeApiError(err, translate)}`, "error");
    }
    // 5xx는 서버가 저장했을 수 있다 - 409·422처럼 묶음과 C를 다시 읽어 서버 값을 보이고, 낡은 revision으로 다음 것을 보내지 않는다
    if (isStaleRejection(err) || isServerError(err)) holdForReload();
    pump();
  }

  function handleChecksSaved(saved: Bundle, sent: Record<string, boolean>) {
    if (!mountedRef.current) {
      putBundle(saved);
      return;
    }
    queueRef.current = finishJob(queueRef.current);
    // 의미 확인은 결과물·요약에 들지 않아 늘 이 화면 것이다
    setOwnRevisions((prev) => new Set(prev).add(saved.revision));
    putBundle(saved);
    // 보낸 뒤에 또 눌렀으면 그 값이 남아 다음 요청이 싣는다
    if (checksRef.current === sent) {
      checksRef.current = null;
      setShownChecks(null);
    }
    pump();
  }

  function handleChecksFailed(err: unknown) {
    if (!mountedRef.current) return;
    queueRef.current = finishJob(queueRef.current);
    checksRef.current = null;
    setShownChecks(null);
    const translate = latestRef.current.t;
    showToast(`${translate("outputs.checks.rolledBack")} ${humanizeApiError(err, translate)}`, "error");
    if (isStaleRejection(err)) holdForReload();
    pump();
  }

  /**
   * 409·422(·문서 저장 5xx) - 묶음을 다시 읽을 때까지 모든 저장을, 그 뒤 새로 받은 C가 올 때까지 문서 저장을 멈춘다. 기다리던 문서 저장은 새 C 위에
   * 다시 얹어(adoptC) 새 revision으로 보낸다 - 낡은 revision으로 줄줄이 보내 알림이 문서마다 뜨지 않게. C를 받지 못하면 다시 시도할 때까지 멈춘 채 둔다.
   */
  function holdForReload() {
    if (holdRef.current === "bundle") return;
    holdRef.current = "bundle";
    void loadBundle(bundleId).then(() => {
      if (!mountedRef.current) return;
      holdRef.current = { docsFromFetch: cRef.current.fetch + 1 };
      setCReloads((count) => count + 1);
      pump();
    });
  }

  // 위·아래·깊이·번호 표시 - 화면 문서에 먼저 얹고(번호는 미리 센다) 그 문서의 저장을 줄에 넣는다. 깊이·표시는 그 줄에만 붙는다
  function editC(docId: number, edit: CEdit) {
    const doc = baseC?.docs.find((item) => item.target_doc_id === docId);
    const next = doc && addEdit(draftsRef.current.get(docId) ?? startDraft(doc), edit);
    if (!next) return;
    setDraft(docId, next);
    queueRef.current = enqueueJob(queueRef.current, { kind: "doc", docId });
    pump();
  }

  function toggleCheck(checkKey: string, value: boolean) {
    if (!bundle) return;
    const current = checksRef.current ?? Object.fromEntries(SEMANTIC_CHECK_KEYS.map((item) => [item, bundle.semantic_checks[item] === true]));
    const next = { ...current, [checkKey]: value };
    checksRef.current = next;
    setShownChecks(next);
    queueRef.current = enqueueJob(queueRef.current, { kind: "checks" });
    pump();
  }

  // C 받기 - 받기 번호를 매기고, 키가 바뀌어 버려진 받기의 결과는 쓰지 않는다(받은 C는 adoptC가 초안과 함께 맞춘다)
  const startCFetch = useEffectEvent((requestKey: string, isAlive: () => boolean) => {
    const fetch = ++cRef.current.fetch;
    cRef.current.fetching = true;
    const labelLang = lang;
    // 떠났다 돌아오기 전 화면의 저장이 아직 날아가면 그 뒤에 받는다 - 그 저장 전에 읽힌 C 위에 누름이 얹혀 저장을 덮지 않게
    const other = findOtherSave(bundleId, ownerRef.current) ?? Promise.resolve();
    other.then(() => getOutputC(bundleId, labelLang)).then(
      (data) => {
        if (isAlive()) adoptC(requestKey, fetch, data, labelLang);
      },
      (error: unknown) => {
        if (!isAlive()) return;
        cRef.current.fetching = false;
        // 멈춘 문서 저장은 풀지 않는다 - 낡은 C 위의 편집을 다시 얹지 않고 보내면 다른 곳의 바뀜을 덮는다. 화면이 실패를 알리고 다시 시도를 준다
        setCState((prev) => ({ ...prev, requestKey, error }));
      },
    );
  });
  useEffect(() => {
    if (cRequestKey === null) return;
    const c = cRef.current;
    let alive = true;
    startCFetch(cRequestKey, () => alive);
    return () => {
      alive = false;
      c.fetching = false;
    };
  }, [cRequestKey]);

  const sum = summary.data;
  const checkValues: Record<string, unknown> | undefined = shownChecks ?? bundle?.semantic_checks;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px]" data-testid="outputs">
      <div className="dense grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-surface">
        <div className="flex h-[52px] items-center gap-3 border-b border-line px-[var(--pad)]">
          <h1 className="page-title ul">{t("stage.outputs")}</h1>
          <ReadOnlyNote bundle={bundle} testId="outputs" />
          <div className="ml-2 flex gap-0.5 rounded-md bg-sunken p-0.5" role="tablist">
            {(["a", "b", "c"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={`h-[26px] rounded-sm px-2.5 text-xs ${tab === item ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
                data-testid={`outputs-tab-${item}`}
                onClick={() => setTab(item)}
              >
                {t(`outputs.tab.${item}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-auto">
          {current.error !== null && current.data === null ? (
            <BundleLoadError error={current.error} onRetry={current.reload} testId="outputs" />
          ) : current.data === null ? (
            <div className="p-4">{showSkeleton && <span className="sk h-[420px] w-full" />}</div>
          ) : tab === "a" && outA.data?.length === 0 ? (
            <EmptyState icon={Table2} testId="output-a-empty" title={t("outputs.emptyTitle")} body={t("outputs.emptyA")} />
          ) : tab === "a" && outA.data ? (
            <table className="dtable out-a table-fixed" data-testid="output-a">
              {/* 열 폭을 고정한다 - 글이 길어도 표가 틀을 넘지 않고, 긴 칸은 줄 수로만 커진다. 원문·새 문장 열이 남은 폭을 반씩 나눈다 */}
              <colgroup>
                {/* Row는 네 자리(옛 줄 1,000개 넘는 묶음)까지 한 줄 - 44px에서는 두 줄로 꺾였다 */}
                <col style={{ width: 52 }} />
                <col style={{ width: 112 }} />
                <col />
                <col style={{ width: "14%" }} />
                <col />
                <col style={{ width: "12%" }} />
                <col style={{ width: 116 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t("outputs.colRow")}</th>
                  <th>{t("outputs.colOldUnit")}</th>
                  <th>{t("outputs.colSource")}</th>
                  <th>{t("outputs.colDest")}</th>
                  <th>{t("outputs.colNew")}</th>
                  <th>{t("outputs.colRemark")}</th>
                  <th>{t("bundles.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rowsA.visible.map((line, index) => (
                  <OutputARowView
                    key={`${line.row.row_no}-${line.row.unit_id}-${index}`}
                    line={line}
                    index={index}
                    destKindLabel={line.row.dest_kind ? labelCode(t, "outputs.dest", line.row.dest_kind) : ""}
                    changeLabel={line.row.change_type ? labelCode(t, "change", line.row.change_type) : null}
                    status={toCoverStatus(line.row.status)}
                  />
                ))}
                {rowsA.hasMore && <LoadMoreRows sentinelRef={rowsA.sentinelRef} columns={7} testId="output-a-more" />}
              </tbody>
            </table>
          ) : tab === "b" && outB.data && !outB.data.nodes.some((node) => node.kind === "old") ? (
            <EmptyState icon={Workflow} testId="output-b-empty" title={t("outputs.emptyTitle")} body={t("outputs.emptyB")} />
          ) : tab === "b" && outB.data ? (
            <div className="grid gap-3 p-[var(--pad)]" data-testid="output-b">
              {outB.data.nodes
                .filter((node) => node.kind === "old")
                .map((node) => (
                  <OutputBCard key={node.id} node={node} nodes={outB.data?.nodes ?? []} edges={outB.data?.edges.filter((edge) => edge.source === node.id) ?? []} />
                ))}
            </div>
          ) : tab === "c" && shownC ? (
            <>
              {/* 앞서 받은 C를 보이는 채 다시 받기가 실패했다 - 위에 붙어 스크롤해도 보이고, 멈춘 저장은 다시 시도로 받은 C 위에서 나간다 */}
              {outC.error !== null && (
                <p
                  className="sticky top-0 z-[2] flex flex-wrap items-center gap-3 border-b border-line bg-surface px-[var(--pad)] py-2 text-[13px] text-ink-2"
                  role="alert"
                  data-testid="output-c-reload-error"
                >
                  <span>
                    {`${t("outputs.c.reloadFailed")} ${humanizeApiError(outC.error, t)}${pendingSave === "held" ? ` ${t("outputs.c.waitingReload")}` : ""}`}
                  </span>
                  <button type="button" className="btn" data-testid="output-c-reload-retry" onClick={outC.reload}>
                    <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
                    {t("common.retry")}
                  </button>
                </p>
              )}
              <OutputCView
                data={shownC}
                resetKey={`c:${key}`}
                onMove={canEdit ? (docId, locationKey, targetId, dir) => editC(docId, { kind: "move", locationKey, targetId, dir }) : undefined}
                onIndent={canEdit ? (docId, targetId, depth) => editC(docId, { kind: "indent", targetId, depth }) : undefined}
                onMark={canEdit ? (docId, targetId, style) => editC(docId, { kind: "style", targetId, style }) : undefined}
                tobeHref={canEdit ? getStageHref(bundleId, "tobe") : undefined} />
            </>
          ) : null}
        </div>
      </div>

      <aside className="grid content-start gap-3 overflow-y-auto border-l border-line px-3 py-[18px]" data-testid="outputs-side">
        <section className="side-box grid gap-2" data-testid="outputs-summary">
          <h2 className="side-box-title">{t("outputs.summary")}</h2>
          {sum ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular-nums">
              {SUMMARY_ITEMS.map((item) => (
                <div key={item} className="contents">
                  <dt className="text-ink-2">{t(`outputs.sum.${item}`)}</dt>
                  <dd className="text-right" data-testid={`outputs-sum-${item}`}>{sum[item]}</dd>
                </div>
              ))}
              <dt className="text-ink-2">{t("outputs.sum.rate")}</dt>
              {/* 서버·Excel과 같은 반올림(floor(rate*100 + 0.5)) */}
              <dd className="text-right" data-testid="outputs-sum-rate">{Math.floor(sum.confirmed_rate * 100 + 0.5)}%</dd>
            </dl>
          ) : (
            <span className="sk h-32 w-full" />
          )}
        </section>
        <section className="side-box grid gap-2" data-testid="outputs-checks">
          <h2 className="side-box-title">{t("outputs.checks")}</h2>
          {SEMANTIC_CHECK_KEYS.map((item) => (
            <Checkbox
              key={item}
              testId={`outputs-check-${item}`}
              checked={checkValues?.[item] === true}
              disabled={!canEdit}
              onChange={(next) => void toggleCheck(item, next)}
              label={t(`outputs.check.${item}`)}
            />
          ))}
        </section>
        <section className="side-box grid gap-2" data-testid="outputs-export">
          <h2 className="side-box-title">Excel</h2>
          <button type="button" className="btn w-full justify-start" data-testid="outputs-export-open" onClick={() => setIsPreviewOpen(true)}>
            <Download size={14} strokeWidth={1.5} aria-hidden />
            {t("outputs.export")}
          </button>
        </section>
      </aside>
      {isPreviewOpen && <ExportPreviewModal bundleId={bundleId} onClose={() => setIsPreviewOpen(false)} />}
      {leaveTo !== null && (
        <ConfirmModal
          title={t("outputs.leaveTitle")}
          summary={t("outputs.leaveBody")}
          confirmLabel={t("outputs.leaveConfirm")}
          danger
          testId="outputs-leave"
          onClose={() => setLeaveTo(null)}
          onConfirm={() => {
            const href = leaveTo;
            isDiscardConfirmedRef.current = true;
            setLeaveTo(null);
            navigate(href, { immediate: true });
          }}
        />
      )}
    </div>
  );
}
