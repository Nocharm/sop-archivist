// 입구 2 짝 맞추기 - 이미 쓴 새 문서의 문장마다 옛 단위를 출처로 잇거나 신규로 확정한다. 글자가 같은 1:1 후보는 코드가 찾아 한 번에 확정한다(명세 §12-7).
// 원문 3단 뼈대: 왼쪽 새 문장 목록, 가운데 고른 새 문장과 옛 단위 후보, 오른쪽 출처·변경 종류·확정. 유사도는 보이지 않는다.
"use client";

import { Link2, Search, Sparkles } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { UnitStatusIcon, UnitStatusPill } from "@/components/status";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import {
  clearDecision,
  confirmMatchesInBulk,
  getGroupByTarget,
  getOutputC,
  listAllUnits,
  listIdenticalCandidates,
  saveGroup,
  type CoverStatus,
  type OutputCItem,
  type UnitRow,
} from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { buildIdenticalBatches } from "@/lib/match-model";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";

interface NewSentence {
  item: OutputCItem;
  docCode: string;
  section: string;
  lang: "ko" | "en";
}

type Filter = "open" | "done" | "all";

function toCoverStatus(status: string): CoverStatus {
  return status === "confirmed" || status === "on_hold" || status === "ai_suggested" ? status : "unassigned";
}

export default function MatchPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  const [reloadKey, setReloadKey] = useState(0);
  const key = `${bundleId}:${reloadKey}`;
  const outputs = useLoaded(() => Promise.all([getOutputC(bundleId, "ko"), getOutputC(bundleId, "en")]), key);
  const identical = useLoaded(() => listIdenticalCandidates(bundleId), key);
  const units = useLoaded(() => listAllUnits(bundleId), key);
  const showSkeleton = useDelayedFlag(outputs.data === null);

  // 두 언어판의 입구 2 문서에서 새 문장을 모은다 - 언어판마다 자기 언어 문장만 나온다
  const sentences = useMemo(() => {
    const list: NewSentence[] = [];
    for (const [index, output] of (outputs.data ?? []).entries()) {
      const lang = index === 0 ? "ko" : "en";
      for (const doc of output.docs.filter((item) => item.entrance === "match")) {
        for (const section of doc.sections) {
          for (const item of section.items) if (item.kind === "sentence" && item.lang === lang) list.push({ item, docCode: doc.code, section: section.label, lang });
        }
      }
    }
    return list;
  }, [outputs.data]);
  const [filter, setFilter] = useState<Filter>("open");
  const visible = sentences.filter((entry) => filter === "all" || (filter === "open") === (entry.item.status !== "confirmed"));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = sentences.find((entry) => entry.item.target_id === selectedId) ?? visible[0] ?? null;

  const group = useLoaded(() => (selected ? getGroupByTarget(bundleId, selected.item.target_id) : Promise.resolve(null)), `${selected?.item.target_id}:${reloadKey}`);
  const target = group.data?.targets.find((item) => item.id === selected?.item.target_id) ?? null;
  const linked = target?.source_unit_ids ?? [];

  const unitMap = new Map((units.data ?? []).map((row) => [row.unit_id, row]));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [changeType, setChangeType] = useState<"tone" | "rewritten">("rewritten");
  const [busy, setBusy] = useState(false);
  // 출처 후보: 같은 언어의 아직 정하지 않은 옛 단위. 검색어가 있으면 글자로 거른다
  const candidates: UnitRow[] = (units.data ?? []).filter(
    (row) =>
      selected !== null &&
      row.lang === selected.lang &&
      row.group_unit_id === null &&
      (row.status === "unassigned" || linked.includes(row.unit_id) || picked.includes(row.unit_id)) &&
      (query.trim() === "" || row.text.toLowerCase().includes(query.trim().toLowerCase()) || row.display_id.toLowerCase().includes(query.trim().toLowerCase())),
  );

  function refresh(message: string) {
    showToast(message);
    setPicked([]);
    setReloadKey((value) => value + 1);
    void loadBundle(bundleId);
  }

  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      refresh(message);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setReloadKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  function confirmIdenticalAll() {
    const candidates = identical.data ?? [];
    if (candidates.length === 0) return;
    void run(async () => {
      // 서버 상한(1000)씩 차례로 - revision은 후보 목록에 실려 온다
      for (const batch of buildIdenticalBatches(candidates)) await confirmMatchesInBulk(bundleId, batch);
    }, t("match.identicalDone", { n: candidates.length }));
  }

  // 출처가 하나고 글자가 같으면 그대로, 둘 이상이면 합침 - 서버가 정한다. 글자가 다를 때만 사람이 말투·고쳐 씀을 고른다
  const sourcesAfter = [...new Set([...linked, ...picked])];
  const isExact = sourcesAfter.length === 1 && unitMap.get(sourcesAfter[0])?.text.trim() === selected?.item.text.trim();
  const needsChangeType = sourcesAfter.length === 1 && !isExact;

  function linkSources() {
    if (!target || picked.length === 0) return;
    const sources = sourcesAfter;
    void run(
      () =>
        saveGroup(bundleId, {
          action: "confirm",
          hold_reason: "",
          units: sources.map((id) => ({ unit_id: id, revision: unitMap.get(id)?.decision.revision ?? 1, disposition: "assigned", move_target_code: "", reason: "" })),
          targets: [{ key: "t", id: target.id, revision: target.revision, change_type: needsChangeType ? changeType : null, source_unit_ids: sources }],
          removed_target_ids: [],
        }),
      t("match.linked"),
    );
  }

  function confirmNew() {
    if (!target) return;
    void run(() => confirmMatchesInBulk(bundleId, { identical: [], new: [{ target_id: target.id, revision: target.revision }] }), t("match.newDone"));
  }

  function clearSources() {
    void run(async () => {
      for (const id of linked) {
        const unit = unitMap.get(id);
        if (unit) await clearDecision(bundleId, id, unit.decision.revision);
      }
    }, t("classify.cleared"));
  }

  if (outputs.data === null) {
    return outputs.error !== null ? (
      <p className="p-6 text-ink-2">{humanizeApiError(outputs.error, t)}</p>
    ) : (
      <div className="p-4">{showSkeleton && <span className="sk h-[480px] w-full" />}</div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)_392px]" data-testid="match">
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-line bg-surface">
        <div className="flex flex-wrap gap-0.5 border-b border-line p-2">
          {(["open", "done", "all"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-xs hover:bg-hover ${filter === item ? "bg-accent-tint text-ink" : "text-ink-2"}`}
              data-testid={`match-filter-${item}`}
              onClick={() => setFilter(item)}
            >
              {t(`match.filter.${item}`)}
              <span className="tabular-nums text-ink-3">{sentences.filter((entry) => item === "all" || (item === "open") === (entry.item.status !== "confirmed")).length}</span>
            </button>
          ))}
        </div>
        <ul className="min-h-0 overflow-y-auto" data-testid="match-list">
          {visible.map((entry) => (
            <li key={entry.item.target_id}>
              <button
                type="button"
                className="grid min-h-[58px] w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2 border-b border-line py-[var(--row-y)] pl-2.5 pr-2 text-left hover:bg-hover"
                style={entry === selected ? { background: "var(--sel-bg)", boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
                aria-current={entry === selected ? "true" : undefined}
                data-testid={`match-row-${entry.item.target_id}`}
                onClick={() => {
                  setSelectedId(entry.item.target_id);
                  setPicked([]);
                  setChangeType("rewritten");
                }}
              >
                <span className="row-span-2 pt-0.5">
                  <UnitStatusIcon status={toCoverStatus(entry.item.status)} />
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-ink-3">
                  <span className="lg">{entry.lang.toUpperCase()}</span>
                  {entry.docCode}
                </span>
                <span className="truncate text-[13px] leading-5">{entry.item.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid min-h-0 content-start gap-4 overflow-y-auto bg-bg p-[var(--pad)]">
        {(identical.data?.length ?? 0) > 0 && (
          <section className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-dashed border-line-2 bg-surface px-4 py-3" data-testid="match-identical">
            <span>
              <b className="font-semibold">{t("match.identicalTitle", { n: identical.data?.length ?? 0 })}</b>
              <span className="block text-ink-2">{t("match.identicalBody")}</span>
            </span>
            <button type="button" className="btn pri" data-testid="match-identical-confirm" disabled={!canEdit || busy} onClick={confirmIdenticalAll}>
              {t("match.identicalRun", { n: identical.data?.length ?? 0 })}
            </button>
          </section>
        )}
        {selected ? (
          <>
            <section className="sheet px-[30px] py-[18px]" data-testid="match-new">
              <p className="mb-1 text-xs text-ink-3" style={{ fontFamily: "var(--font-ui)" }}>
                <span className="font-mono">{selected.docCode}</span> · {selected.section}
              </p>
              <p lang={selected.lang} className="text-[15px] leading-[26px]" style={{ fontFamily: selected.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}>
                {selected.item.text}
              </p>
            </section>
            <section className="grid gap-2">
              <h2 className="text-xs font-semibold text-ink-3">{t("match.candidates")}</h2>
              <label className="flex h-8 items-center gap-2 rounded-md border border-line-2 bg-surface px-2">
                <Search size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
                <input className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" placeholder={t("match.search")} value={query} data-testid="match-search" onChange={(event) => setQuery(event.target.value)} />
              </label>
              <ul className="grid gap-1" data-testid="match-candidates">
                {candidates.slice(0, 60).map((row) => {
                  const isLinked = linked.includes(row.unit_id);
                  const isPicked = picked.includes(row.unit_id);
                  return (
                    <li key={row.unit_id}>
                      <label className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-2 rounded-md border px-2.5 py-2 ${isLinked ? "border-accent bg-accent-tint" : isPicked ? "border-dashed border-accent" : "border-line bg-surface hover:bg-hover"}`}>
                        <input
                          type="checkbox"
                          className="mt-1"
                          data-testid={`match-candidate-${row.unit_id}`}
                          checked={isLinked || isPicked}
                          disabled={!canEdit || isLinked}
                          onChange={(event) => setPicked((prev) => (event.target.checked ? [...prev, row.unit_id] : prev.filter((id) => id !== row.unit_id)))}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-[11px] text-ink-3">{row.display_id}</span>
                          <span className="block text-[13px] leading-5">{row.text}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
                {candidates.length === 0 && <li className="text-ink-3">{t("match.noCandidates")}</li>}
              </ul>
            </section>
          </>
        ) : (
          <p className="text-ink-3" data-testid="match-empty">
            {t("match.empty")}
          </p>
        )}
      </div>

      <aside className="grid min-h-0 content-start gap-4 overflow-y-auto border-l border-line bg-surface p-[var(--pad)]" data-testid="match-inspector">
        {selected && (
          <>
            <div className="flex h-7 items-center gap-2">
              <span className="lg">{selected.lang.toUpperCase()}</span>
              <span className="font-mono text-sm font-semibold">{selected.docCode}</span>
              <UnitStatusPill status={toCoverStatus(selected.item.status)} testId="match-status" />
            </div>
            <button type="button" className="btn pri h-[38px] w-full" data-testid="match-link" disabled={!canEdit || busy || picked.length === 0} onClick={linkSources}>
              <Link2 size={16} strokeWidth={1.5} aria-hidden />
              {picked.length > 0 ? t("match.link", { n: picked.length }) : t("match.linkNone")}
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn" data-testid="match-new-confirm" disabled={!canEdit || busy || linked.length > 0 || selected.item.status === "confirmed"} onClick={confirmNew}>
                {t("match.markNew")}
              </button>
              <button type="button" className="btn" data-testid="match-clear" disabled={!canEdit || busy || linked.length === 0} onClick={clearSources}>
                {t("classify.clear")}
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-2">
              {t("classify.changeType")}
              {needsChangeType ? (
                <select className="h-7 rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink" data-testid="match-change" value={changeType} disabled={!canEdit} onChange={(event) => setChangeType(event.target.value === "tone" ? "tone" : "rewritten")}>
                  <option value="tone">{t("change.tone")}</option>
                  <option value="rewritten">{t("change.rewritten")}</option>
                </select>
              ) : (
                <span className="text-[13px] text-ink" data-testid="match-change">
                  {sourcesAfter.length === 0 ? "–" : isExact ? t("change.as_is") : t("change.merged")}
                </span>
              )}
            </label>
            <section className="grid gap-2">
              <h2 className="text-xs font-semibold text-ink-3">{t("match.sources")}</h2>
              {linked.length === 0 ? (
                <p className="text-ink-3">{selected.item.status === "confirmed" ? t("match.isNew") : "–"}</p>
              ) : (
                <ul className="grid gap-1" data-testid="match-sources">
                  {linked.map((id) => (
                    <li key={id} className="rounded-md border border-line px-2 py-1.5 text-[13px]">
                      <span className="block font-mono text-[11px] text-ink-3">{unitMap.get(id)?.display_id}</span>
                      {unitMap.get(id)?.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="flex gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-ink-2" style={{ borderColor: "var(--st-ai-line)" }}>
              <Sparkles size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-st-ai" aria-hidden />
              {t("match.aiLater")}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
