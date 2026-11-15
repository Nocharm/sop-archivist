// 결과물 B의 카드 한 장 - Old 문서 하나가 어느 새 문서로 몇 줄(짝 하나·짝 없는 판단 단위 하나) 가는지. 보낼 곳이 많으면 처음 8개만 보이고 "N개 더"로 이어 연다.
// 노드 이름(삭제·미배정 등)은 서버가 화면 UI 언어로 지어 보낸다.
// EQUIS가 켜져 있으면 옛 문서 이름 아래와 새 문서 번호 옆에 그 번호의 EQUIS 표시가 붙는다(읽기 전용 - 눌러서 정보만 본다).
"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { EquisStatus } from "@/components/equis/equis-status";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/motion";
import type { EquisInfo, FlowGraph } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { truncateMiddle } from "@/lib/truncate-middle";

const VISIBLE_TARGETS = 8;
const CODE_HEAD = 12;
const CODE_TAIL = 10;

type FlowNode = FlowGraph["nodes"][number];

interface OutputBCardProps {
  node: FlowNode;
  nodes: FlowNode[];
  edges: FlowGraph["edges"];
  /** 노드 id → 그 문서 번호의 EQUIS 표시 - 없는 노드(삭제·미배정, EQUIS 꺼짐)는 아무것도 그리지 않는다 */
  equis: ReadonlyMap<string, EquisInfo>;
}

export function OutputBCard({ node, nodes, edges, equis }: OutputBCardProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const total = edges.reduce((acc, edge) => acc + edge.count, 0) || 1;
  const shown = isOpen ? edges : edges.slice(0, VISIBLE_TARGETS);
  const hidden = edges.length - VISIBLE_TARGETS;
  const nodeEquis = equis.get(node.id);
  return (
    <section className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 rounded-lg border border-line bg-surface p-3" data-testid={`output-b-${node.id}`}>
      <div>
        <span className="font-mono text-[13px] font-semibold">{node.label}</span>
        <Truncate className="text-xs text-ink-3" text={node.title} />
        <span className="text-xs tabular-nums text-ink-2">{t("outputs.rows", { n: node.count })}</span>
        {nodeEquis && (
          <div className="mt-1 flex min-w-0">
            <EquisStatus equis={nodeEquis} testId={`output-b-${node.id}-equis`} canEdit={false} />
          </div>
        )}
      </div>
      <ul className="grid gap-1">
        {shown.map((edge) => {
          const targetNode = nodes.find((item) => item.id === edge.target);
          const code = targetNode?.label ?? edge.target;
          const short = truncateMiddle(code, CODE_HEAD, CODE_TAIL);
          const targetEquis = equis.get(edge.target);
          return (
            <li key={edge.target} className="grid grid-cols-[16px_minmax(140px,40%)_minmax(0,1fr)_40px] items-center gap-2 text-[13px]">
              <ArrowRight size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
              {/* 가운데를 줄인 코드는 전체를 툴팁으로(키보드 포커스로도) 보인다 */}
              <span className="flex min-w-0 items-center gap-1.5">
                <Tooltip label={code} suppressed={short === code} align="start">
                  <span className="min-w-0 font-mono text-xs" tabIndex={short === code ? undefined : 0}>
                    {short}
                  </span>
                </Tooltip>
                {/* 같은 새 문서가 카드마다 나오므로 아이콘만 - 글은 툴팁, 누르면 정보 */}
                {targetEquis && <EquisStatus equis={targetEquis} testId={`output-b-${node.id}-${edge.target}-equis`} compact canEdit={false} />}
              </span>
              <span className="track">
                <i style={{ width: `${(edge.count / total) * 100}%`, background: targetNode?.kind === "delete" ? "var(--danger-fill)" : targetNode?.kind === "unassigned" ? "var(--st-none-fill)" : undefined }} />
              </span>
              <span className="text-right tabular-nums text-ink-2">{edge.count}</span>
            </li>
          );
        })}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              className="text-xs text-accent underline-offset-2 hover:underline"
              aria-expanded={isOpen}
              data-testid={`output-b-${node.id}-more`}
              onClick={() => setIsOpen((prev) => !prev)}
            >
              {isOpen ? t("common.showLess") : t("outputs.moreTargets", { n: hidden })}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
