// 결과물 B의 카드 한 장 - Old 문서 하나가 어느 새 문서로 몇 줄(짝 하나·짝 없는 판단 단위 하나) 가는지. 보낼 곳이 많으면 처음 8개만 보이고 "N개 더"로 이어 연다.
// 노드 이름(삭제·미배정 등)은 서버가 화면 UI 언어로 지어 보낸다.
"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/motion";
import type { FlowGraph } from "@/lib/api-sop";
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
}

export function OutputBCard({ node, nodes, edges }: OutputBCardProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const total = edges.reduce((acc, edge) => acc + edge.count, 0) || 1;
  const shown = isOpen ? edges : edges.slice(0, VISIBLE_TARGETS);
  const hidden = edges.length - VISIBLE_TARGETS;
  return (
    <section className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 rounded-lg border border-line bg-surface p-3" data-testid={`output-b-${node.id}`}>
      <div>
        <span className="font-mono text-[13px] font-semibold">{node.label}</span>
        <Truncate className="text-xs text-ink-3" text={node.title} />
        <span className="text-xs tabular-nums text-ink-2">{t("outputs.rows", { n: node.count })}</span>
      </div>
      <ul className="grid gap-1">
        {shown.map((edge) => {
          const targetNode = nodes.find((item) => item.id === edge.target);
          const code = targetNode?.label ?? edge.target;
          const short = truncateMiddle(code, CODE_HEAD, CODE_TAIL);
          return (
            <li key={edge.target} className="grid grid-cols-[16px_minmax(140px,40%)_minmax(0,1fr)_40px] items-center gap-2 text-[13px]">
              <ArrowRight size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
              {/* 가운데를 줄인 코드는 전체를 툴팁으로(키보드 포커스로도) 보인다 */}
              <Tooltip label={code} suppressed={short === code} align="start">
                <span className="min-w-0 font-mono text-xs" tabIndex={short === code ? undefined : 0}>
                  {short}
                </span>
              </Tooltip>
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
