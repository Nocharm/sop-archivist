// 참조 지도의 옆 칸 - 고른 것이 없으면 이 Bundle의 요약과 범례, 고르면 그 문서의 소유·Bundle·상태·바뀔 문서와 가리키는·가리켜지는 줄.
// 줄(맞은편 번호 · 상태 · 줄 수) 아래에 그 줄의 문장을 붙인다 - 문장은 그 줄이 든 Bundle의 구성원에게만 서버가 보낸다(map-lines).
"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { LinkSentences, SideLinesError, SideLinesFoot, type SideLinesState } from "@/components/map/map-lines";
import { BECOMES_EMPTY_KEY, EDGE_PILL } from "@/components/map/map-list";
import { BundleStatusPill } from "@/components/status";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import type { MapRelation, RefMap } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { attachLines, type LineSide } from "@/lib/map-lines-model";
import { describeNode, summarizeSelf, type EdgeLabel, type NodeLink } from "@/lib/map-model";

interface MapSideProps {
  data: RefMap;
  selectedId: string | null;
  /** 고른 문서의 줄 문장 */
  lines: SideLinesState;
  onPick(nodeId: string): void;
  onClear(): void;
}

type Owner = MapRelation | "none";

function OwnerMark({ owner }: { owner: Owner }) {
  const { t } = useI18n();
  return (
    <span className="map-owner" data-o={owner} data-testid="map-side-owner">
      {t(`map.owner.${owner}`)}
    </span>
  );
}

// 선 모양 - 지도와 같다: 실선 · 짧은 점선 · 긴 점선
const LEGEND: readonly { label: EdgeLabel; dash?: string }[] = [{ label: "confirmed" }, { label: "proposed", dash: "3 3" }, { label: "moved", dash: "9 3 2 3" }];

function Legend() {
  const { t } = useI18n();
  return (
    <section className="grid gap-2" data-testid="map-side-legend">
      <h2 className="map-side-h">{t("map.side.legend")}</h2>
      <ul className="map-legend">
        {LEGEND.map(({ label, dash }) => (
          <li key={label}>
            <svg width="32" height="8" aria-hidden>
              <line x1="1" y1="4" x2="31" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} />
            </svg>
            {t(`map.legend.${label}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface LinkListProps {
  links: NodeLink[];
  side: LineSide;
  testId: string;
  title: string;
  lines: SideLinesState;
  onPick(nodeId: string): void;
}

function LinkList({ links, side, testId, title, lines, onPick }: LinkListProps) {
  const { t } = useI18n();
  const { rows, more } = attachLines(links, lines.data, side);
  return (
    <section className="grid gap-1.5" data-testid={testId}>
      <h2 className="map-side-h">{title}</h2>
      {links.length > 0 && (
        <ul className="map-links" data-testid={`map-lines-${side}`}>
          {rows.map((row) => (
            <li key={`${row.link.nodeId}:${row.link.label}`}>
              <button type="button" className="map-link" data-testid={`map-side-link-${row.link.nodeId}-${row.link.label}`} onClick={() => onPick(row.link.nodeId)}>
                <span className="map-link-no">{row.link.number || t("map.node.noNumber")}</span>
                <span className={EDGE_PILL[row.link.label]}>{t(`map.edge.${row.link.label}`)}</span>
                <span className="map-link-n">{t("map.lines.count", { n: row.link.lines })}</span>
              </button>
              <LinkSentences row={row} side={side} />
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && <SideLinesFoot side={side} isLoading={lines.isLoading} more={more} />}
    </section>
  );
}

const sumLines = (links: NodeLink[]) => links.reduce((total, link) => total + link.lines, 0);

function SelfSummary({ data }: { data: RefMap }) {
  const { t } = useI18n();
  const summary = useMemo(() => summarizeSelf(data), [data]);
  const self = data.bundles.find((bundle) => bundle.relation === "self");
  return (
    <div className="map-side-inner" data-testid="map-side-summary">
      <div className="grid justify-items-start gap-1.5">
        <OwnerMark owner="self" />
        {self && <p className="map-side-title">{[self.code, self.title].filter(Boolean).join(" · ")}</p>}
      </div>
      <section className="grid gap-1">
        <h2 className="map-side-h">{t("map.sum.out")}</h2>
        <p>{t("map.sum.cites", { lines: summary.citesLines, docs: summary.citesDocs })}</p>
        {summary.toCheck > 0 && <p className="text-ink-2">{t("map.sum.toCheck", { n: summary.toCheck })}</p>}
        {summary.noOwner > 0 && <p className="text-ink-2">{t("map.sum.noOwner", { n: summary.noOwner })}</p>}
      </section>
      <section className="grid gap-1">
        <h2 className="map-side-h">{t("map.sum.in")}</h2>
        <p>{t("map.sum.citedBy", { lines: summary.citedByLines, bundles: summary.citedByBundles })}</p>
      </section>
      {!summary.hasEdges && (
        <section className="grid gap-1" data-testid="map-side-no-refs">
          <p className="font-semibold">{t("map.empty.noRefs")}</p>
          <p className="text-ink-2">{t("map.empty.noRefsBody")}</p>
        </section>
      )}
      <p className="text-[13px] text-ink-3">{t("map.sum.hint")}</p>
      <Legend />
    </div>
  );
}

export function MapSide({ data, selectedId, lines, onPick, onClear }: MapSideProps) {
  const { t } = useI18n();
  const tip = useDelegatedTip();
  const detail = useMemo(() => (selectedId === null ? null : describeNode(data, selectedId)), [data, selectedId]);
  if (!detail) return <SelfSummary data={data} />;

  const { node, bundle, relation, becomesState, tentative, cites, citedBy, assignHref } = detail;
  const emptyKey = BECOMES_EMPTY_KEY[becomesState];
  // 읽지 못했으면 문장·쉬머 대신 알림 한 줄 - 앞서 받은 문장을 그리지 않는다
  const shown: SideLinesState = lines.error === null ? lines : { ...lines, data: null, isLoading: false };
  return (
    <div className="map-side-inner" data-testid="map-side-node" {...tip.handlers}>
      {tip.node}
      <div className="grid justify-items-start gap-1.5">
        <OwnerMark owner={relation ?? "none"} />
        <p className="map-side-num" data-testid="map-side-number">
          {node.kind === "target" && <span className="tag mr-1.5 align-middle">{t("map.node.newTag")}</span>}
          {node.number || t("map.node.noNumber")}
        </p>
        {node.title && (
          <p className="map-side-title" data-testid="map-side-title">
            {node.title}
          </p>
        )}
      </div>
      <dl className="map-facts">
        {bundle && (
          <>
            <dt>{t("map.side.bundle")}</dt>
            {/* 구성원이 아닌 Bundle은 제목이 오지 않는다 - 코드만 적는다 */}
            <dd data-testid="map-side-bundle">{[bundle.code, bundle.title].filter(Boolean).join(" · ")}</dd>
            <dt>{t("map.side.status")}</dt>
            <dd>
              <BundleStatusPill status={bundle.status} testId="map-side-status" />
            </dd>
          </>
        )}
        {becomesState !== "none" && (
          <>
            <dt>{t("map.side.becomes")}</dt>
            <dd data-testid="map-side-becomes">
              {becomesState === "list" ? (
                <div className="grid gap-1">
                  <ul className="map-becomes" data-tentative={tentative ? "" : undefined}>
                    {node.becomes.map((item) => (
                      <li key={`${item.doc_type}:${item.code}:${item.title}`}>
                        <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 self-center" aria-hidden />
                        {item.code && <span className="font-mono text-[13px]">{item.code}</span>}
                        <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                        <span className="tag shrink-0">{item.doc_type.toUpperCase()}</span>
                      </li>
                    ))}
                  </ul>
                  {tentative && <p className="text-[12px] text-ink-3">{t("map.side.tentative")}</p>}
                </div>
              ) : (
                emptyKey && <span className="text-ink-2">{t(emptyKey)}</span>
              )}
            </dd>
          </>
        )}
      </dl>
      {lines.error !== null && (cites.length > 0 || citedBy.length > 0) && <SideLinesError onRetry={lines.onRetry} />}
      {node.kind === "old" && <LinkList links={cites} side="out" testId="map-side-cites" title={t("map.side.cites", { n: sumLines(cites) })} lines={shown} onPick={onPick} />}
      <LinkList links={citedBy} side="in" testId="map-side-cited-by" title={t("map.side.citedBy", { n: sumLines(citedBy) })} lines={shown} onPick={onPick} />
      {assignHref && (
        <Link href={assignHref} className="btn justify-self-start" data-testid="map-side-open-assign">
          {t("map.side.openAssign")}
        </Link>
      )}
      {relation === "summary" && (
        <p className="text-[13px] text-ink-2" data-testid="map-side-not-member">
          {t("map.side.notMember")}
        </p>
      )}
      <button type="button" className="btn ghost justify-self-start" data-testid="map-side-clear" onClick={onClear}>
        <X size={14} strokeWidth={1.5} aria-hidden />
        {t("map.side.clear")}
      </button>
    </div>
  );
}
