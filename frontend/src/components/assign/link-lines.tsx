// Assign 두 문서 사이 이음 - 마우스를 올린 조각의 맞은편을 강조하고, 양쪽 끝이 다 보이는 이음만 가운데 틈에 옅은 선으로 그린다.
// 강조 표시는 React 상태가 아니라 DOM 속성(data-link-hover)으로 단다 - Old 원문 조각이 수천 개일 때 올릴 때마다 용지 전체를 다시 그리지 않게.
// 선은 스크롤·크기 변경·확대·세로선 끌기마다 다시 재되 한 프레임에 한 번으로 묶는다.
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { findLinkPartners, pickDrawnLinks, type LinkPair } from "@/lib/assign-model";
import { getLinkDirection, type LinkAnchor } from "@/lib/link-direction-model";

/** 두 문서를 담은 틀(.assign-panes) 안에 둔다 - 틀이 선의 좌표 기준이자 마우스를 듣는 곳이다 */
interface LinkLinesProps {
  pairs: LinkPair[];
  /** 고른 줄의 Old 조각 */
  focusUnits: ReadonlySet<number>;
  /** 고른 New 문장 */
  focusTargets: ReadonlySet<number>;
}

interface Hover {
  side: "old" | "new";
  id: number;
}

interface DrawnLine {
  key: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strong: boolean;
  draft: boolean;
}

// 조각 첫 줄 가운데쯤에 선을 붙인다 - 긴 조각의 한가운데로 가면 어느 줄인지 흐려진다(px)
const FIRST_LINE_Y = 13;

/** Old 조각 하나의 종이 조각(표 칸은 칸 조각) */
export function findOldStrip(root: ParentNode, unitId: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-pane="old"] [data-unit="${unitId}"]`)?.closest<HTMLElement>(".strip, .cell-piece") ?? null;
}

export function findNewLine(root: ParentNode, targetId: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-pane="new"] .new-line[data-target="${targetId}"]`);
}

function readHover(target: EventTarget | null): Hover | null {
  if (!(target instanceof Element)) return null;
  const line = target.closest<HTMLElement>("[data-pane=\"new\"] .new-line[data-target]");
  if (line) return { side: "new", id: Number(line.dataset.target) };
  const strip = target.closest<HTMLElement>("[data-pane=\"old\"] .cell-piece, [data-pane=\"old\"] .strip");
  const unit = strip?.querySelector<HTMLElement>("[data-unit]");
  return unit ? { side: "old", id: Number(unit.dataset.unit) } : null;
}

function readAnchorY(rect: DOMRect): number {
  return rect.top + Math.min(rect.height / 2, FIRST_LINE_Y);
}

/** 연결 배지마다 이어진 New 문장이 오른쪽 칸 화면 안·위·아래·다른 문서 중 어디인지 data-dir로 단다 */
function updateBadgeDirections(root: HTMLElement, newBody: HTMLElement) {
  const currentDoc = Number(newBody.closest<HTMLElement>("[data-pane]")?.dataset.doc);
  const frame = newBody.getBoundingClientRect();
  const view = { docId: currentDoc, scrollTop: newBody.scrollTop, height: newBody.clientHeight };
  for (const badge of root.querySelectorAll<HTMLElement>("[data-pane=\"old\"] [data-link-badge]")) {
    const refs = (badge.dataset.targets ?? "").split(",").map((part) => part.split(":").map(Number));
    const here = refs.find(([docId]) => docId === currentDoc);
    let anchor: LinkAnchor | null = null;
    if (here) {
      const rect = findNewLine(root, here[1])?.getBoundingClientRect();
      if (rect) anchor = { docId: currentDoc, top: rect.top - frame.top + view.scrollTop, bottom: rect.bottom - frame.top + view.scrollTop };
    } else if (refs[0]) {
      anchor = { docId: refs[0][0], top: 0, bottom: 0 };
    }
    const dir = getLinkDirection(anchor, view);
    if (badge.dataset.dir !== dir) badge.dataset.dir = dir;
  }
}

export function LinkLines({ pairs, focusUnits, focusTargets }: LinkLinesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [lines, setLines] = useState<DrawnLine[]>([]);
  const frameRef = useRef(0);
  // 이음이 바뀔 때만 크기 관찰을 다시 건다 - 부모가 매 렌더 새 배열을 넘겨도
  const pairsKey = pairs.map((pair) => `${pair.unitId}:${pair.targetId}${pair.draft ? "d" : ""}`).join(",");

  const measure = useEffectEvent(() => {
    frameRef.current = 0;
    const root = svgRef.current?.parentElement;
    const oldBody = root?.querySelector<HTMLElement>("[data-pane=\"old\"] .pane-body");
    const newBody = root?.querySelector<HTMLElement>("[data-pane=\"new\"] .pane-body");
    const oldSheet = oldBody?.querySelector<HTMLElement>(".sheet");
    const newSheet = newBody?.querySelector<HTMLElement>(".sheet");
    if (!root || !oldBody || !newBody || !oldSheet || !newSheet) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const base = root.getBoundingClientRect();
    const oldFrame = oldBody.getBoundingClientRect();
    const newFrame = newBody.getBoundingClientRect();
    // 선은 두 종이 사이 틈에만 - 종이 위 글자를 가로지르지 않는다
    const x1 = oldSheet.getBoundingClientRect().right - base.left;
    const x2 = newSheet.getBoundingClientRect().left - base.left;
    updateBadgeDirections(root, newBody);
    const units = new Set(focusUnits);
    const targets = new Set(focusTargets);
    if (hover?.side === "old") units.add(hover.id);
    if (hover?.side === "new") targets.add(hover.id);
    const next: DrawnLine[] = [];
    for (const pair of pickDrawnLinks(pairs, units, targets)) {
      const oldEl = findOldStrip(root, pair.unitId);
      const newEl = findNewLine(root, pair.targetId);
      if (!oldEl || !newEl) continue;
      const ya = readAnchorY(oldEl.getBoundingClientRect());
      const yb = readAnchorY(newEl.getBoundingClientRect());
      // 양쪽 끝이 다 보일 때만 - 한쪽이 스크롤 밖이면 선이 문서 머리나 화면 밖으로 뻗는다
      if (ya < oldFrame.top || ya > oldFrame.bottom || yb < newFrame.top || yb > newFrame.bottom) continue;
      const y1 = ya - base.top;
      const y2 = yb - base.top;
      const mid = (x1 + x2) / 2;
      next.push({ key: `${pair.unitId}:${pair.targetId}`, d: `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, x1, y1, x2, y2, strong: pair.strong, draft: pair.draft });
    }
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const schedule = useEffectEvent(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(() => measure());
  });

  // 스크롤(두 문서 몸통 - scroll은 거품이 일지 않아 캡처로 듣는다)·창 크기·문서 크기(확대·세로선·글꼴)
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root) return;
    const onChange = () => schedule();
    const observer = new ResizeObserver(onChange);
    observer.observe(root);
    for (const el of root.querySelectorAll(".pane-body, .pane-body > *")) observer.observe(el);
    root.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [pairsKey]);

  // 화면이 다시 그려질 때마다(고른 줄·문서·확대가 바뀌었을 수 있다) 한 번 다시 잰다
  useEffect(() => schedule());

  // 마우스를 올린 조각 - 바뀔 때만 상태를 고친다
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root) return;
    const handleOver = (event: PointerEvent) => {
      const next = readHover(event.target);
      setHover((prev) => (prev?.side === next?.side && prev?.id === next?.id ? prev : next));
    };
    const handleLeave = () => setHover(null);
    root.addEventListener("pointerover", handleOver);
    root.addEventListener("pointerleave", handleLeave);
    return () => {
      root.removeEventListener("pointerover", handleOver);
      root.removeEventListener("pointerleave", handleLeave);
    };
  }, []);

  // 맞은편 강조 - 조각이 다시 그려지면 표시가 사라질 수 있어 화면이 다시 그려질 때마다 맞춘다
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root) return;
    const marked = new Set<HTMLElement>();
    if (hover) {
      for (const id of findLinkPartners(pairs, hover.side, hover.id)) {
        const el = hover.side === "old" ? findNewLine(root, id) : findOldStrip(root, id);
        if (el) marked.add(el);
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-link-hover]")) if (!marked.has(el)) delete el.dataset.linkHover;
    for (const el of marked) el.dataset.linkHover = "";
  });

  // 끝날 때 표시를 지운다 - New 문서를 닫아도 Old 조각에 강조가 남지 않게
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    return () => {
      for (const el of root?.querySelectorAll<HTMLElement>("[data-link-hover]") ?? []) delete el.dataset.linkHover;
    };
  }, []);

  return (
    <svg ref={svgRef} className="link-lines" aria-hidden data-testid="assign-link-lines">
      {lines.map((line) => (
        <g key={line.key} data-strong={line.strong ? "" : undefined} data-draft={line.draft ? "" : undefined}>
          <path d={line.d} />
          <circle cx={line.x1} cy={line.y1} r={2.5} />
          <circle cx={line.x2} cy={line.y2} r={2.5} />
        </g>
      ))}
    </svg>
  );
}
