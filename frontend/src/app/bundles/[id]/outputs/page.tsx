// 결과물 한 벌 - A(옛 줄과 새 문장 대조 7열)·B(흐름)·C(새 문서 미리 보기), 요약 숫자, 의미 검토 4항목, Excel 내보내기(명세 §12-8).
// 판(한글판/영어판)이 없다 - 화면 UI 언어는 위치 표기·칸 이름 같은 라벨 언어로만 보낸다. Excel은 요청 중 → 파일 생성 / 실패 두 단계로 보인다(디자인 문서 10절).
"use client";

import { Download, Table2, Workflow } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ExportPreviewModal } from "@/components/outputs/export-preview";
import { OutputARowView } from "@/components/outputs/output-a-row";
import { OutputBCard } from "@/components/outputs/output-b-card";
import { OutputCView } from "@/components/outputs/output-c";
import { ReadOnlyNote } from "@/components/read-only-note";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { LoadMoreRows } from "@/components/ui/load-more";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import {
  getOutputA,
  getOutputB,
  getOutputC,
  getSummary,
  putSemanticChecks,
  putTargetOrder,
  SEMANTIC_CHECK_KEYS,
  type CoverStatus,
  type NumberStyle,
} from "@/lib/api-sop";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { buildAScreenLines } from "@/lib/output-groups";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { readOutputsView, writeOutputsView, type OutputsTab } from "@/lib/outputs-view-prefs";
import { buildPatchItems, buildTargetOrder, type MoveDir } from "@/lib/target-order";
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
  const key = `${bundleId}:${lang}:${bundle?.revision ?? 0}`;
  const outA = useLoaded(() => (tab === "a" ? getOutputA(bundleId, lang) : Promise.resolve(null)), `a:${tab}:${key}`);
  const outB = useLoaded(() => (tab === "b" ? getOutputB(bundleId, lang) : Promise.resolve(null)), `b:${tab}:${key}`);
  const outC = useLoaded(() => (tab === "c" ? getOutputC(bundleId, lang) : Promise.resolve(null)), `c:${tab}:${key}`);
  const summary = useLoaded(() => getSummary(bundleId), `${bundleId}:${bundle?.revision ?? 0}`);
  const current = tab === "a" ? outA : tab === "b" ? outB : outC;
  // 결과물 A는 수천 행이 될 수 있어 묶음씩 그린다. 함께 쓰는 칸은 전체 목록에서 정해 두어야 이어 그린 첫 줄이 윗줄과 비교된다
  const linesA = useMemo(() => buildAScreenLines(outA.data ?? []), [outA.data]);
  const rowsA = useProgressiveList(linesA, `a:${key}`);
  const showSkeleton = useDelayedFlag(current.data === null && current.error === null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [savingChecks, setSavingChecks] = useState(false);

  const [moving, setMoving] = useState(false);

  // 칸 안에서 옮긴 새 문서 전체 순서를 보낸다(서버는 그 문서의 새 문장 전부를 받는다) - C가 한 벌이라 다른 판을 읽지 않는다
  async function moveTarget(targetDocId: number, locationKey: string, targetId: number, dir: MoveDir) {
    if (!outC.data || !bundle || moving) return;
    setMoving(true);
    try {
      const order = buildTargetOrder(outC.data, targetDocId, locationKey, targetId, dir);
      if (order) {
        await putTargetOrder(bundleId, { revision: bundle.revision, target_doc_id: targetDocId, items: order.map((id) => ({ target_id: id })) });
        await loadBundle(bundleId);
      }
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      void loadBundle(bundleId);
    } finally {
      setMoving(false);
    }
  }

  // 깊이 하나를 바꿔도 서버는 문서 전체 순서를 받는다. 깊이는 그 줄에만 붙는다(짝 상대에 옮기지 않는다)
  async function indentTarget(targetDocId: number, targetId: number, depth: number) {
    if (!outC.data || !bundle || moving) return;
    setMoving(true);
    try {
      const items = buildPatchItems(outC.data, targetDocId, new Map([[targetId, { indent_level: depth }]]));
      if (items) {
        await putTargetOrder(bundleId, { revision: bundle.revision, target_doc_id: targetDocId, items });
        await loadBundle(bundleId);
      }
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      void loadBundle(bundleId);
    } finally {
      setMoving(false);
    }
  }

  // 번호 표시는 이 줄만 보내고 이 줄에만 붙는다 - 짝 상대도 번역도 따라 바뀌지 않는다
  async function markTarget(targetDocId: number, targetId: number, style: NumberStyle) {
    if (!outC.data || !bundle || moving) return;
    setMoving(true);
    try {
      const items = buildPatchItems(outC.data, targetDocId, new Map([[targetId, { number_style: style }]]));
      if (items) {
        await putTargetOrder(bundleId, { revision: bundle.revision, target_doc_id: targetDocId, items });
        await loadBundle(bundleId);
      }
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      void loadBundle(bundleId);
    } finally {
      setMoving(false);
    }
  }

  async function toggleCheck(checkKey: string, value: boolean) {
    if (!bundle) return;
    setSavingChecks(true);
    try {
      const checks = Object.fromEntries(SEMANTIC_CHECK_KEYS.map((item) => [item, item === checkKey ? value : bundle.semantic_checks[item] === true]));
      putBundle(await putSemanticChecks(bundleId, bundle.revision, checks));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      void loadBundle(bundleId);
    } finally {
      setSavingChecks(false);
    }
  }

  const sum = summary.data;

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
          ) : tab === "c" && outC.data ? (
            <OutputCView
              data={outC.data}
              onMove={canEdit ? (docId, sectionKey, targetId, dir) => void moveTarget(docId, sectionKey, targetId, dir) : undefined}
              onIndent={canEdit ? (docId, targetId, depth) => void indentTarget(docId, targetId, depth) : undefined}
              onMark={canEdit ? (docId, targetId, style) => void markTarget(docId, targetId, style) : undefined}
              // 다시 받는 동안의 깊이는 낡았다 - 연달아 누른 Tab이 낡은 깊이로 보내지 않게 막는다
              moving={moving || outC.isLoading} tobeHref={canEdit ? getStageHref(bundleId, "tobe") : undefined} />
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
              checked={bundle?.semantic_checks[item] === true}
              disabled={!canEdit || savingChecks}
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
