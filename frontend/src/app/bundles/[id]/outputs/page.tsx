// 결과물 - A(단위별 표)·B(흐름)·C(새 문서 미리 보기) × 한글판/영어판, 요약 숫자, 의미 검토 4항목, Excel 내보내기(명세 §12-8).
// 표 안 값은 고른 판의 언어로 API가 채워 준다. Excel은 요청 중 → 파일 생성 / 실패 두 단계로 보인다(디자인 문서 10절).
"use client";

import { ArrowRight, Download, Table2, Workflow } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { EditionToggle } from "@/components/outputs/edition-toggle";
import { OutputCView } from "@/components/outputs/output-c";
import { ReadOnlyNote } from "@/components/read-only-note";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { UnitStatusPill } from "@/components/status";
import { LoadMoreRows } from "@/components/ui/load-more";
import { Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import {
  downloadExport,
  getOutputA,
  getOutputB,
  getOutputC,
  getSummary,
  listAllUnits,
  putSemanticChecks,
  putTargetOrder,
  SEMANTIC_CHECK_KEYS,
  type CoverStatus,
  type OutputLang,
} from "@/lib/api-sop";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { buildDownloadName } from "@/lib/download-name";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { readOutputsView, writeOutputsView, type OutputsTab } from "@/lib/outputs-view-prefs";
import { findPartnerTarget } from "@/lib/section-number";
import { buildIndentItems, buildTargetOrder, type MoveDir } from "@/lib/target-order";
import { Checkbox } from "@/components/ui/checkbox";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { getBundleLabel } from "@/lib/bundle-label";
import { getStageHref } from "@/lib/stages";

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
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  // 탭과 언어는 마지막으로 본 값에서 다시 연다 - 다른 단계에 다녀와도 처음(C·KO)으로 돌아가지 않는다
  const [view, setView] = useState(readOutputsView);
  const { tab, lang } = view;
  function setTab(next: OutputsTab) {
    setView((prev) => ({ ...prev, tab: next }));
    writeOutputsView({ tab: next });
  }
  function setLang(next: OutputLang) {
    setView((prev) => ({ ...prev, lang: next }));
    writeOutputsView({ lang: next });
  }
  const key = `${bundleId}:${lang}:${bundle?.revision ?? 0}`;
  const outA = useLoaded(() => (tab === "a" ? getOutputA(bundleId, lang) : Promise.resolve(null)), `a:${tab}:${key}`);
  const outB = useLoaded(() => (tab === "b" ? getOutputB(bundleId, lang) : Promise.resolve(null)), `b:${tab}:${key}`);
  const outC = useLoaded(() => (tab === "c" ? getOutputC(bundleId, lang) : Promise.resolve(null)), `c:${tab}:${key}`);
  const summary = useLoaded(() => getSummary(bundleId), `${bundleId}:${bundle?.revision ?? 0}`);
  const current = tab === "a" ? outA : tab === "b" ? outB : outC;
  // 결과물 A는 수천 행이 될 수 있어 묶음씩 그린다 - 판을 바꾸면 처음부터
  const rowsA = useProgressiveList(outA.data ?? [], `a:${lang}:${key}`);
  const showSkeleton = useDelayedFlag(current.data === null && current.error === null);
  const [exporting, setExporting] = useState<OutputLang | null>(null);
  const [savingChecks, setSavingChecks] = useState(false);

  const [moving, setMoving] = useState(false);

  // 한 판에서 옮기면 다른 판을 함께 읽어 새 문서 전체 순서를 보낸다(서버는 그 문서의 새 문장 전부를 받는다)
  async function moveTarget(targetDocId: number, locationKey: string, targetId: number, dir: MoveDir) {
    if (!outC.data || !bundle || moving) return;
    setMoving(true);
    try {
      const other = await getOutputC(bundleId, lang === "ko" ? "en" : "ko");
      const order = buildTargetOrder(outC.data, other, targetDocId, locationKey, targetId, dir);
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

  // 깊이 하나를 바꿔도 서버는 문서 전체 순서를 받는다. 한/영 짝 원문 줄의 상대에도 같은 깊이를 보내 두 판의 번호가 같게 한다
  async function indentTarget(targetDocId: number, targetId: number, depth: number) {
    if (!outC.data || !bundle || moving) return;
    setMoving(true);
    try {
      const [other, units] = await Promise.all([getOutputC(bundleId, lang === "ko" ? "en" : "ko"), listAllUnits(bundleId)]);
      const docIds = new Set(buildIndentItems(outC.data, other, targetDocId, new Map())?.map((item) => item.target_id) ?? []);
      const partner = findPartnerTarget(targetId, units, docIds);
      const levels = new Map([[targetId, depth]]);
      if (partner !== null) levels.set(partner, depth);
      const items = buildIndentItems(outC.data, other, targetDocId, levels);
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

  async function handleExport(exportLang: OutputLang) {
    setExporting(exportLang);
    try {
      const blob = await downloadExport(bundleId, exportLang);
      saveBlob(blob, buildDownloadName([bundle ? getBundleLabel(bundle) : undefined, exportLang.toUpperCase()], "xlsx"));
      showToast(t("outputs.fileCreated"));
    } catch (err) {
      showToast(`${t("outputs.exportFailed")} ${humanizeApiError(err, t)}`, "error");
    } finally {
      setExporting(null);
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

  const sum = summary.data?.[lang];

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
          <span className="flex-1" />
          <EditionToggle value={lang} onChange={setLang} testId="outputs-lang" />
        </div>
        <div className="min-h-0 overflow-auto">
          {current.error !== null && current.data === null ? (
            <LoadError error={current.error} onRetry={current.reload} testId="outputs" />
          ) : current.data === null ? (
            <div className="p-4">{showSkeleton && <span className="sk h-[420px] w-full" />}</div>
          ) : tab === "a" && outA.data?.length === 0 ? (
            <EmptyState icon={Table2} testId="output-a-empty" title={t("outputs.emptyTitle")} body={t("outputs.emptyA")} />
          ) : tab === "a" && outA.data ? (
            <table className="dtable" data-testid="output-a">
              <thead>
                <tr>
                  <th>{t("outputs.colOldUnit")}</th>
                  <th>{t("outputs.colSource")}</th>
                  <th>{t("outputs.colDest")}</th>
                  <th>{t("outputs.colNewChange")}</th>
                  <th>{t("bundles.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rowsA.visible.map((row, index) => (
                  <tr key={`${row.unit_id}-${index}`} data-testid={`output-a-row-${index}`}>
                    <td className="whitespace-nowrap">
                      <span className="font-mono text-xs">
                        {row.old_doc_code} <span className="text-ink-3">{row.location.section}</span>
                      </span>
                      <span className="block font-mono text-[11px] text-ink-3">{row.display_id}</span>
                    </td>
                    <td style={{ fontFamily: "var(--font-source)" }}>{row.source_text || <span className="text-ink-4">–</span>}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-mono text-xs">{row.dest_doc_code}</span>
                      <span className="block text-xs text-ink-3">{row.dest_location || labelCode(t, "outputs.dest", row.dest_kind)}</span>
                      {row.dest_number && (
                        <span className="block whitespace-pre-line font-mono text-[11px] text-ink-2" data-testid={`output-a-number-${index}`}>
                          {row.dest_number}
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: "var(--font-source)" }}>
                      {row.confirmed_text || <span className="text-ink-4">–</span>}
                      {row.change_type && <span className="block text-xs text-ink-3" style={{ fontFamily: "var(--font-ui)" }}>{labelCode(t, "change", row.change_type)}</span>}
                    </td>
                    <td>
                      <UnitStatusPill status={toCoverStatus(row.status)} />
                    </td>
                  </tr>
                ))}
                {rowsA.hasMore && <LoadMoreRows sentinelRef={rowsA.sentinelRef} columns={5} testId="output-a-more" />}
              </tbody>
            </table>
          ) : tab === "b" && outB.data && !outB.data.nodes.some((node) => node.kind === "old") ? (
            <EmptyState icon={Workflow} testId="output-b-empty" title={t("outputs.emptyTitle")} body={t("outputs.emptyB")} />
          ) : tab === "b" && outB.data ? (
            <div className="grid gap-3 p-[var(--pad)]" data-testid="output-b">
              {outB.data.nodes
                .filter((node) => node.kind === "old")
                .map((node) => {
                  const edges = outB.data?.edges.filter((edge) => edge.source === node.id) ?? [];
                  const total = edges.reduce((acc, edge) => acc + edge.count, 0) || 1;
                  return (
                    <section key={node.id} className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 rounded-lg border border-line bg-surface p-3">
                      <div>
                        <span className="font-mono text-[13px] font-semibold">{node.label}</span>
                        <Truncate className="text-xs text-ink-3" text={node.title} />
                        <span className="text-xs tabular-nums text-ink-2">{t("outputs.units", { n: node.count })}</span>
                      </div>
                      <ul className="grid gap-1">
                        {edges.map((edge) => {
                          const targetNode = outB.data?.nodes.find((item) => item.id === edge.target);
                          return (
                            <li key={edge.target} className="grid grid-cols-[16px_140px_minmax(0,1fr)_40px] items-center gap-2 text-[13px]">
                              <ArrowRight size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
                              <Truncate className="font-mono text-xs" text={targetNode?.label ?? edge.target} />
                              <span className="track">
                                <i style={{ width: `${(edge.count / total) * 100}%`, background: targetNode?.kind === "delete" ? "var(--danger-fill)" : targetNode?.kind === "unassigned" ? "var(--st-none-fill)" : undefined }} />
                              </span>
                              <span className="text-right tabular-nums text-ink-2">{edge.count}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
            </div>
          ) : tab === "c" && outC.data ? (
            <OutputCView
              data={outC.data}
              lang={lang}
              onMove={canEdit ? (docId, sectionKey, targetId, dir) => void moveTarget(docId, sectionKey, targetId, dir) : undefined}
              onIndent={canEdit ? (docId, targetId, depth) => void indentTarget(docId, targetId, depth) : undefined}
              // 다시 받는 동안의 깊이는 낡았다 - 연달아 누른 Tab이 낡은 깊이로 보내지 않게 막는다
              moving={moving || outC.isLoading} tobeHref={canEdit ? getStageHref(bundleId, "tobe") : undefined} />
          ) : null}
        </div>
      </div>

      <aside className="grid content-start gap-3 overflow-y-auto border-l border-line px-3 py-[18px]" data-testid="outputs-side">
        <section className="side-box grid gap-2" data-testid="outputs-summary">
          <h2 className="side-box-title">{t("outputs.summary", { lang: lang.toUpperCase() })}</h2>
          {sum ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular-nums">
              {(["old_units", "assigned", "unassigned", "duplicate", "deleted", "moved", "new"] as const).map((item) => (
                <div key={item} className="contents">
                  <dt className="text-ink-2">{t(`outputs.sum.${item}`)}</dt>
                  <dd className="text-right">{sum[item]}</dd>
                </div>
              ))}
              <dt className="text-ink-2">{t("outputs.sum.rate")}</dt>
              <dd className="text-right">{Math.round(sum.confirmed_rate * 100)}%</dd>
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
          {(["ko", "en"] as const).map((item) => (
            <button key={item} type="button" className="btn w-full justify-start" data-testid={`outputs-export-${item}`} disabled={exporting !== null} onClick={() => void handleExport(item)}>
              <Download size={14} strokeWidth={1.5} aria-hidden />
              <span className="stack">
                <span data-on={exporting === item ? undefined : ""}>{t("outputs.export", { lang: item.toUpperCase() })}</span>
                <span data-on={exporting === item ? "" : undefined}>{t("outputs.exporting")}</span>
              </span>
            </button>
          ))}
        </section>
      </aside>
    </div>
  );
}
