// Assign 두 문서 사이 이음 - 마우스를 올린 조각의 맞은편을 강조하고, 양쪽 끝이 다 보이는 이음만 옅은 선으로 그린다(Old 조각 오른쪽 테두리 배지 높이 → New 줄 앞머리의 KO/EN 표시 왼쪽, 길은 link-route-model).
// 강조 표시는 React 상태가 아니라 DOM 속성(data-link-hover)으로 단다 - Old 원문 조각이 수천 개일 때 올릴 때마다 용지 전체를 다시 그리지 않게.
// 선은 스크롤·크기 변경·확대·세로선 끌기마다 다시 재되 한 프레임에 한 번으로 묶는다.
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { findLinkPartners, pickDrawnLinks, type LinkPair } from "@/lib/assign-model";
import { getLinkDirection, type LinkDirection } from "@/lib/link-direction-model";
import { buildLinkPath } from "@/lib/link-route-model";

/** 두 문서를 담은 틀(.assign-panes) 안에 둔다 - 틀이 선의 좌표 기준이자 마우스를 듣는 곳이다 */
interface LinkLinesProps {
  pairs: LinkPair[];
  /** 고른 줄의 Old 조각 */
  focusUnits: ReadonlySet<number>;
  /** 고른 New 문장 */
  focusTargets: ReadonlySet<number>;
  /** 끄면 선만 그리지 않는다 - 배지 방향·맞은편 강조는 그대로 */
  visible: boolean;
}

interface Hover {
  side: "old" | "new";
  id: number;
}

interface DrawnLine {
  key: string;
  d: string;
  strong: boolean;
  draft: boolean;
  ai: boolean;
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

/** 연결 배지마다 이어진 New 문장이 오른쪽 칸 화면 안·위·아래·다른 문서 중 어디인지 data-dir로 단다 - 열린 문서의 문장이 하나라도 보이면 보임 */
function updateBadgeDirections(root: HTMLElement, newBody: HTMLElement) {
  const currentDoc = Number(newBody.closest<HTMLElement>("[data-pane]")?.dataset.doc);
  const frame = newBody.getBoundingClientRect();
  const view = { docId: currentDoc, scrollTop: newBody.scrollTop, height: newBody.clientHeight };
  for (const badge of root.querySelectorAll<HTMLElement>("[data-pane=\"old\"] [data-link-badge]")) {
    const refs = (badge.dataset.targets ?? "").split(",").map((part) => part.split(":").map(Number));
    const here = refs.filter(([docId]) => docId === currentDoc);
    let dir: LinkDirection = refs[0] ? getLinkDirection({ docId: refs[0][0], top: 0, bottom: 0 }, view) : "none";
    if (here.length > 0) {
      const dirs = here.flatMap(([, targetId]) => {
        const rect = findNewLine(root, targetId)?.getBoundingClientRect();
        return rect ? [getLinkDirection({ docId: currentDoc, top: rect.top - frame.top + view.scrollTop, bottom: rect.bottom - frame.top + view.scrollTop }, view)] : [];
      });
      dir = dirs.includes("visible") ? "visible" : (dirs[0] ?? "none");
    }
    if (badge.dataset.dir !== dir) badge.dataset.dir = dir;
  }
}

/** New 출처 칩마다 그 Old 조각이 왼쪽 칸 화면 안·위·아래 중 어디인지 data-dir로 단다 - 칩 오른쪽 갈매기. 조각이 그려져 있지 않으면(다른 Old 문서) none */
function updateChipDirections(root: HTMLElement, oldBody: HTMLElement) {
  const frame = oldBody.getBoundingClientRect();
  for (const chip of root.querySelectorAll<HTMLElement>("[data-pane=\"new\"] [data-src-unit]")) {
    const rect = findOldStrip(root, Number(chip.dataset.srcUnit))?.getBoundingClientRect();
    const dir: LinkDirection = !rect ? "none" : rect.bottom < frame.top ? "above" : rect.top > frame.bottom ? "below" : "visible";
    if (chip.dataset.dir !== dir) chip.dataset.dir = dir;
  }
}

/** New 줄에서 그 Old 조각의 출처 칩 - 접혀 있으면 "+N" 칩 */
function findSourceChip(newLine: HTMLElement, unitId: number): HTMLElement | null {
  const chip = newLine.querySelector<HTMLElement>(`[data-src-unit="${unitId}"]`);
  if (chip) return chip;
  const more = newLine.querySelector<HTMLElement>("[data-src-more]");
  return more && (more.dataset.srcMore ?? "").split(",").map(Number).includes(unitId) ? more : null;
}

export function LinkLines({ pairs, focusUnits, focusTargets, visible }: LinkLinesProps) {
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
    if (!root || !oldBody || !newBody) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    updateBadgeDirections(root, newBody);
    updateChipDirections(root, oldBody);
    if (!visible) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const base = root.getBoundingClientRect();
    const oldFrame = oldBody.getBoundingClientRect();
    const newFrame = newBody.getBoundingClientRect();
    const units = new Set(focusUnits);
    const targets = new Set(focusTargets);
    if (hover?.side === "old") units.add(hover.id);
    if (hover?.side === "new") targets.add(hover.id);
    const next: DrawnLine[] = [];
    for (const pair of pickDrawnLinks(pairs, units, targets)) {
      const oldEl = findOldStrip(root, pair.unitId);
      const newEl = findNewLine(root, pair.targetId);
      const rowEl = newEl?.closest<HTMLElement>(".strip-row");
      if (!oldEl || !newEl || !rowEl) continue;
      // 두 끝 모두 상자 바깥 테두리 - 선이 배지·칩을 찌르지 않고 그 높이에서 상자에 닿는다
      // 시작 - Old 조각 오른쪽 끝, 연결 배지(조각 오른쪽 아래) 높이. 배지가 없으면(고르는 중인 이음) 첫 줄 높이
      const badge = oldEl.querySelector<HTMLElement>("[data-link-badge]");
      const oldRect = oldEl.getBoundingClientRect();
      const badgeRect = badge?.getBoundingClientRect();
      const start = { x: oldRect.right, y: badgeRect ? badgeRect.top + badgeRect.height / 2 : readAnchorY(oldRect) };
      // 끝 - New 줄 앞머리 맨 왼쪽의 언어 표시(KO/EN) 왼쪽 가운데. 앞머리는 줄 왼쪽 끝에서 시작해 표시의 x가 깊이와 상관없이 같으니 선이 한 줄로 모인다.
      // 언어 표시가 없는 중립 문장은 상자 왼쪽 테두리, 출처 칩 높이(칩이 없으면 첫 줄 높이)
      const tokenRect = rowEl.querySelector(".strip-lead-lang > .lang-token")?.getBoundingClientRect();
      const chipRect = findSourceChip(newEl, pair.unitId)?.getBoundingClientRect();
      const end = tokenRect
        ? { x: tokenRect.left, y: tokenRect.top + tokenRect.height / 2 }
        : { x: newEl.getBoundingClientRect().left, y: chipRect ? chipRect.top + chipRect.height / 2 : readAnchorY(newEl.getBoundingClientRect()) };
      // 양쪽 끝이 다 보일 때만 - 한쪽이 스크롤 밖이면 선이 문서 머리나 화면 밖으로 뻗는다
      if (start.y < oldFrame.top || start.y > oldFrame.bottom || end.y < newFrame.top || end.y > newFrame.bottom) continue;
      const shift = (point: { x: number; y: number }) => ({ x: point.x - base.left, y: point.y - base.top });
      next.push({ key: `${pair.unitId}:${pair.targetId}`, d: buildLinkPath(shift(start), shift(end)), strong: pair.strong, draft: pair.draft, ai: pair.ai });
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
    // 진해진 선의 두 끝 표시(Old 연결 배지·New 출처 칩)도 올린 모양으로 - 어느 칩이 어느 배지와 이어졌는지 함께 읽힌다
    const hot = new Set<HTMLElement>();
    if (hover) {
      for (const id of findLinkPartners(pairs, hover.side, hover.id)) {
        const unitId = hover.side === "old" ? hover.id : id;
        const targetId = hover.side === "old" ? id : hover.id;
        const oldEl = findOldStrip(root, unitId);
        const newEl = findNewLine(root, targetId);
        const el = hover.side === "old" ? newEl : oldEl;
        if (el) marked.add(el);
        const badge = oldEl?.querySelector<HTMLElement>("[data-link-badge]");
        const chip = newEl ? findSourceChip(newEl, unitId) : null;
        if (badge) hot.add(badge);
        if (chip) hot.add(chip);
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-link-hover]")) if (!marked.has(el)) delete el.dataset.linkHover;
    for (const el of marked) el.dataset.linkHover = "";
    for (const el of root.querySelectorAll<HTMLElement>("[data-link-hot]")) if (!hot.has(el)) delete el.dataset.linkHot;
    for (const el of hot) el.dataset.linkHot = "";
  });

  // 끝날 때 표시를 지운다 - New 문서를 닫아도 Old 조각에 강조가 남지 않게
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    return () => {
      for (const el of root?.querySelectorAll<HTMLElement>("[data-link-hover]") ?? []) delete el.dataset.linkHover;
      for (const el of root?.querySelectorAll<HTMLElement>("[data-link-hot]") ?? []) delete el.dataset.linkHot;
    };
  }, []);

  return (
    <svg ref={svgRef} className="link-lines" aria-hidden data-testid="assign-link-lines">
      {lines.map((line) => (
        <g key={line.key} data-strong={line.strong ? "" : undefined} data-draft={line.draft ? "" : undefined} data-ai={line.ai ? "" : undefined}>
          <path d={line.d} />
        </g>
      ))}
    </svg>
  );
}
