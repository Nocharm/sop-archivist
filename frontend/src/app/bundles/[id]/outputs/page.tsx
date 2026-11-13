// 결과물 한 벌 - A(옛 줄과 새 문장 대조 7열)·B(흐름)·C(새 문서 미리 보기), 요약 숫자, 의미 검토 4항목, Excel 내보내기(명세 §12-8).
// 판(한글판/영어판)이 없다 - 화면 UI 언어는 위치 표기·칸 이름 같은 라벨 언어로만 보낸다. Excel은 요청 중 → 파일 생성 / 실패 두 단계로 보인다(디자인 문서 10절).
// C의 순서·깊이·표시와 의미 확인은 화면에 먼저 얹고 뒤에서 한 번에 하나씩 저장한다(설계 §5.6) - 저장 응답으로 그 문서만 맞추고 C 전체를 다시 받지 않는다.
"use client";

import { Download, Table2, Workflow } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ExportPreviewModal } from "@/components/outputs/export-preview";
import { OutputARowView } from "@/components/outputs/output-a-row";
import { OutputBCard } from "@/components/outputs/output-b-card";
import { OutputCView } from "@/components/outputs/output-c";
import { ReadOnlyNote } from "@/components/read-only-note";
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
  type TargetOrderResult,
} from "@/lib/api-sop";
import { loadBundle, putBundle, setBundleRevision, useBundle } from "@/lib/bundle-store";
import { acceptSaved, addEdit, rejectSaved, sendDraft, startDraft, type CEdit, type DocDraft } from "@/lib/c-edit-model";
import { EMPTY_QUEUE, enqueueJob, finishJob, getDataRevision, takeNextJob, type SaveJob } from "@/lib/c-save-queue";
import { useI18n } from "@/lib/i18n";
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

/** 다시 읽어야 바로잡히는 거절 - 다른 곳에서 바뀌었거나(409) 보낸 목록이 서버와 어긋났다(422). 네트워크 오류 등은 다시 읽지 않는다 */
function isStaleRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 422);
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
  const outC = useLoaded(() => (tab === "c" ? getOutputC(bundleId, lang) : Promise.resolve(null)), `c:${tab}:${key}`);
  const summary = useLoaded(() => getSummary(bundleId), `${bundleId}:${dataRevision}`);
  const current = tab === "a" ? outA : tab === "b" ? outB : outC;
  // 결과물 A는 수천 행이 될 수 있어 묶음씩 그린다. 함께 쓰는 칸은 전체 목록에서 정해 두어야 이어 그린 첫 줄이 윗줄과 비교된다
  const linesA = useMemo(() => buildAScreenLines(outA.data ?? []), [outA.data]);
  const rowsA = useProgressiveList(linesA, `a:${key}`);
  const showSkeleton = useDelayedFlag(current.data === null && current.error === null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // 보이는 C - 문서마다 저장 안 된 편집을 얹은 초안(draft.shown), 없으면 받은 문서. 초안은 받은 C(base)에 묶여 C를 새로 받으면 버려진다
  const [draftView, setDraftView] = useState<{ base: OutputC | null; byDoc: ReadonlyMap<number, DocDraft> }>({ base: null, byDoc: NO_DRAFTS });
  const drafts = draftView.base !== null && draftView.base === outC.data ? draftView.byDoc : NO_DRAFTS;
  const shownC = useMemo(
    () => (outC.data && drafts.size > 0 ? { ...outC.data, docs: outC.data.docs.map((doc) => drafts.get(doc.target_doc_id)?.shown ?? doc) } : outC.data),
    [outC.data, drafts],
  );
  // 의미 확인 - 누르면 화면에서 먼저 바뀌고, 보낼 때 마지막으로 고른 값을 싣는다(null이면 묶음 값)
  const [shownChecks, setShownChecks] = useState<Record<string, boolean> | null>(null);

  // 저장 줄 - 묶음 revision을 쓰는 요청은 한 번에 하나(c-save-queue). 화면에 그리지 않는 값이라 ref에 둔다
  const queueRef = useRef(EMPTY_QUEUE);
  const draftsRef = useRef<ReadonlyMap<number, DocDraft>>(NO_DRAFTS);
  const draftBaseRef = useRef<OutputC | null>(null);
  const checksRef = useRef<Record<string, boolean> | null>(null);
  // 마지막 저장 응답의 revision - 다음 요청이 싣는다. 없으면 묶음 값
  const revisionRef = useRef<number | null>(null);
  // C를 새로 받을 때마다 하나씩 - 그 전에 날린 문서 저장의 응답은 초안에 얹지 않는다
  const generationRef = useRef(0);
  // 응답 처리(비동기)가 읽는 최신 값
  const latestRef = useRef({ bundle, lang, t });
  useEffect(() => {
    latestRef.current = { bundle, lang, t };
  });
  // C를 새로 받으면(라벨 언어·바깥 revision) 초안과 기다리는 문서 저장을 그 값으로 다시 시작한다 - 의미 확인은 C와 무관해 남긴다.
  // 다른 탭으로 가 C가 비는 것은 새로 받은 것이 아니다 - 기다리는 저장은 그대로 보낸다(돌아오면 C를 새로 받는다)
  useEffect(() => {
    if (outC.data === null) return;
    generationRef.current += 1;
    draftBaseRef.current = outC.data;
    draftsRef.current = NO_DRAFTS;
    revisionRef.current = null;
    queueRef.current = { ...queueRef.current, pending: queueRef.current.pending.filter((job) => job.kind === "checks") };
  }, [outC.data]);

  function setDraft(docId: number, draft: DocDraft) {
    const byDoc = new Map(draftsRef.current).set(docId, draft);
    draftsRef.current = byDoc;
    setDraftView({ base: draftBaseRef.current, byDoc });
  }

  /** 날아가는 요청이 없으면 줄 앞의 일을 보낸다 - 누를 때와 응답을 처리한 뒤에 부른다. 보낼 것이 없어진 일(되돌린 문서 등)은 건너뛴다 */
  function pump() {
    for (let next = takeNextJob(queueRef.current); next !== null; next = takeNextJob(queueRef.current)) {
      queueRef.current = next.queue;
      if (startJob(next.job)) return;
      queueRef.current = finishJob(queueRef.current);
    }
  }

  function startJob(job: SaveJob): boolean {
    const { bundle: latest, lang: labelLang } = latestRef.current;
    if (!latest) return false;
    const revision = revisionRef.current ?? latest.revision;
    if (job.kind === "checks") {
      const checks = checksRef.current;
      if (!checks) return false;
      putSemanticChecks(bundleId, revision, checks).then((saved) => handleChecksSaved(saved, checks), handleChecksFailed);
      return true;
    }
    const draft = draftsRef.current.get(job.docId);
    if (!draft || draft.edits.length === 0) return false;
    const sent = sendDraft(draft);
    draftsRef.current = new Map(draftsRef.current).set(job.docId, sent.draft);
    const generation = generationRef.current;
    putTargetOrder(bundleId, labelLang, { revision, target_doc_id: job.docId, items: sent.items }).then(
      (result) => handleDocSaved(job.docId, generation, result),
      (err: unknown) => handleDocFailed(job.docId, generation, err),
    );
    return true;
  }

  function handleDocSaved(docId: number, generation: number, result: TargetOrderResult) {
    revisionRef.current = result.revision;
    queueRef.current = finishJob(queueRef.current);
    if (generation === generationRef.current) {
      const draft = draftsRef.current.get(docId);
      if (draft) setDraft(docId, acceptSaved(draft, result.doc));
      setOwnRevisions((prev) => new Set(prev).add(result.revision));
    }
    // 그 전 C에서 보낸 저장이면 own에 넣지 않는다 - 새로 받은 C가 이 저장 전 것일 수 있어 한 번 더 받게 한다
    setBundleRevision(bundleId, result.revision);
    pump();
  }

  function handleDocFailed(docId: number, generation: number, err: unknown) {
    const translate = latestRef.current.t;
    queueRef.current = finishJob(queueRef.current);
    // 저장 안 된 바뀜 전부(보낸 것과 그 뒤에 누른 것)를 되돌린다 - 다른 문서의 기다리는 바뀜은 이어 보낸다
    const draft = draftsRef.current.get(docId);
    if (generation === generationRef.current && draft) setDraft(docId, rejectSaved(draft));
    showToast(`${translate("outputs.c.rolledBack")} ${humanizeApiError(err, translate)}`, "error");
    if (isStaleRejection(err)) {
      revisionRef.current = null;
      void loadBundle(bundleId);
    }
    pump();
  }

  function handleChecksSaved(saved: Bundle, sent: Record<string, boolean>) {
    revisionRef.current = saved.revision;
    queueRef.current = finishJob(queueRef.current);
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
    queueRef.current = finishJob(queueRef.current);
    checksRef.current = null;
    setShownChecks(null);
    showToast(humanizeApiError(err, latestRef.current.t), "error");
    if (isStaleRejection(err)) {
      revisionRef.current = null;
      void loadBundle(bundleId);
    }
    pump();
  }

  // 위·아래·깊이·번호 표시 - 화면 문서에 먼저 얹고(번호는 미리 센다) 그 문서의 저장을 줄에 넣는다. 깊이·표시는 그 줄에만 붙는다
  function editC(docId: number, edit: CEdit) {
    const doc = outC.data?.docs.find((item) => item.target_doc_id === docId);
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
                <col style={{ width: 44 }} />
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
            <OutputCView
              data={shownC}
              resetKey={`c:${key}`}
              onMove={canEdit ? (docId, locationKey, targetId, dir) => editC(docId, { kind: "move", locationKey, targetId, dir }) : undefined}
              onIndent={canEdit ? (docId, targetId, depth) => editC(docId, { kind: "indent", targetId, depth }) : undefined}
              onMark={canEdit ? (docId, targetId, style) => editC(docId, { kind: "style", targetId, style }) : undefined}
              tobeHref={canEdit ? getStageHref(bundleId, "tobe") : undefined} />
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
    </div>
  );
}
