// Pair view의 짝 선 - KO 조각의 오른쪽 끝에서 EN 조각의 왼쪽 끝으로, 두 끝이 모두 제 칸 화면 안일 때만 긋는다(link-lines.tsx와 같은 규칙·같은 길).
// 확정은 강조색 실선, 제안은 회색 점선(CSS가 data-status로 가른다). 고른 줄의 짝은 진하게.
// 스크롤·크기 변경·창 크기마다 다시 재되 한 프레임에 한 번으로 묶는다. 포인터 올림은 듣지 않는다(올림으로 다시 그리지 않는다 - G11).
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { buildLinkPath } from "@/lib/link-route-model";
import type { PairLang, PairLink } from "@/lib/pair-drop-model";

interface DrawnPairLine {
  key: string;
  d: string;
  status: PairLink["status"];
  strong: boolean;
}

// 조각 첫 글줄 가운데쯤에 선을 붙인다 - link-lines.tsx와 같은 값(px)
const FIRST_LINE_Y = 13;

/** 조각에서 선이 나가는 자리(client 좌표) - KO는 오른쪽 끝, EN은 왼쪽 끝, 높이는 첫 글줄(위에서 13px, 낮은 조각은 가운데) */
export function readPairAnchor(el: HTMLElement, side: PairLang): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: side === "ko" ? rect.right : rect.left, y: rect.top + Math.min(rect.height / 2, FIRST_LINE_Y) };
}

function findPairPiece(root: ParentNode, side: PairLang, unitId: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-pair-col="${side}"] .pair-piece[data-unit="${unitId}"]`);
}

/** 두 칸을 담은 틀(.assign-panes) 안에 둔다 - 틀이 선의 좌표 기준이다 */
export function PairLines({ links, focusIds }: { links: readonly PairLink[]; focusIds: ReadonlySet<number> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [lines, setLines] = useState<DrawnPairLine[]>([]);
  const frameRef = useRef(0);
  // 짝이 바뀔 때만 크기 관찰을 다시 건다 - 부모가 매 렌더 새 배열을 넘겨도
  const linksKey = links.map((link) => `${link.koId}:${link.enId}:${link.status}`).join(",");

  const measure = useEffectEvent(() => {
    frameRef.current = 0;
    const root = svgRef.current?.parentElement;
    const koBody = root?.querySelector<HTMLElement>('[data-pair-col="ko"] .pane-body');
    const enBody = root?.querySelector<HTMLElement>('[data-pair-col="en"] .pane-body');
    if (!root || !koBody || !enBody) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const base = root.getBoundingClientRect();
    const koFrame = koBody.getBoundingClientRect();
    const enFrame = enBody.getBoundingClientRect();
    const shift = (point: { x: number; y: number }) => ({ x: point.x - base.left, y: point.y - base.top });
    const next: DrawnPairLine[] = [];
    for (const link of links) {
      const koEl = findPairPiece(root, "ko", link.koId);
      const enEl = findPairPiece(root, "en", link.enId);
      if (!koEl || !enEl) continue;
      const start = readPairAnchor(koEl, "ko");
      const end = readPairAnchor(enEl, "en");
      // 두 끝이 모두 보일 때만 - 한쪽이 스크롤 밖이면 선이 칸 머리나 화면 밖으로 뻗는다
      if (start.y < koFrame.top || start.y > koFrame.bottom || end.y < enFrame.top || end.y > enFrame.bottom) continue;
      next.push({ key: `${link.koId}:${link.enId}`, d: buildLinkPath(shift(start), shift(end)), status: link.status, strong: focusIds.has(link.koId) || focusIds.has(link.enId) });
    }
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const schedule = useEffectEvent(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(() => measure());
  });

  // 스크롤(두 칸 몸통 - scroll은 거품이 일지 않아 캡처로 듣는다)·창 크기·목록 크기(확대·세로선·글꼴·조각이 화면에 들어와 제 높이를 얻을 때)
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root) return;
    const onChange = () => schedule();
    const observer = new ResizeObserver(onChange);
    observer.observe(root);
    for (const el of root.querySelectorAll("[data-pair-col] .pane-body, [data-pair-col] .pane-body > *")) observer.observe(el);
    root.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [linksKey]);

  // 화면이 다시 그려질 때마다(고른 줄·확대가 바뀌었을 수 있다) 한 번 다시 잰다
  useEffect(() => schedule());

  return (
    <svg ref={svgRef} className="link-lines pair-lines" aria-hidden data-testid="assign-pair-lines">
      {lines.map((line) => (
        <g key={line.key} data-pair-link={line.key} data-status={line.status} data-strong={line.strong ? "" : undefined}>
          <path d={line.d} />
        </g>
      ))}
    </svg>
  );
}
