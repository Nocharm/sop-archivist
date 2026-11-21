// 풀기 전환(걷기 → 펼치기 → 붙이기)의 순수 계산 - 단계 차례, 줄마다 늦춤, 화면 안 키, 옮길 거리, 표시의 움직임.
// DOM 재기와 animate는 components/ui/motion.tsx useUnwrapMotion. 명세: 2026-11-18-1-unwrap-standardize.md F10

import { computeFlipOffsets } from "@/lib/flip";

/** 감싼 요소 안에서 잰 상자(px) */
export interface MotionBox {
  left: number;
  top: number;
  bottom: number;
}

/** 세로 범위(px) - 상자와 같은 좌표 */
export interface MotionView {
  top: number;
  bottom: number;
}

/** 한 번 잰 것 - 키마다 상자와 그때 창에 보이던 범위 */
export interface MotionSnapshot {
  boxes: ReadonlyMap<string, MotionBox>;
  view: MotionView;
}

/** tokens.css에서 읽은 시간(ms) - clear --dur-base, spread --dur-spread, attach --dur-attach, 늦춤 --stagger-step · --stagger-max */
export interface UnwrapTimings {
  clear: number;
  spread: number;
  attach: number;
  staggerStep: number;
  staggerMax: number;
}

/** 표시의 종류 - leave는 바꾸면 사라지는 것(표 선 · 음영 · TABLE 표시), enter는 바꾸면 생기는 것(왼쪽 세로선 · "다시 표로" · 캡션 칩) */
export type UnwrapMarker = "leave" | "enter";

export interface MarkerPhase {
  marker: UnwrapMarker;
  duration: number;
  /** 곡선 토큰 - exit는 --ease-exit, pop은 --ease-pop */
  easing: "exit" | "pop";
}

export interface UnwrapPlan {
  /** 바꾸기 전에 옛 화면에서 사라지는 표시 */
  before: MarkerPhase;
  /** 펼치기가 끝난 뒤 새 화면에서 나타나는 표시 */
  after: MarkerPhase;
  /** 표시 움직임을 트는 방향 - 되돌리기는 같은 움직임을 거꾸로 */
  direction: "normal" | "reverse";
}

// 위쪽 차이가 이 안이면 같은 줄로 센다(px) - 번호 칸과 글처럼 한 줄 안에서 몇 px 어긋나는 것. 가장 낮은 줄 높이(--lh-micro 16px)의 반
const SAME_ROW_PX = 8;
// 붙이기에서 표시가 튀어나오기 시작하는 크기 - 확정한 데모의 값
const POP_FROM_SCALE = 0.8;

/** CSS 시간 값("160ms" · ".52s")을 ms로 - 읽지 못하면 0(움직이지 않고 바로) */
export function parseDurationMs(value: string): number {
  const text = value.trim();
  const amount = Number.parseFloat(text);
  if (Number.isNaN(amount)) return 0;
  if (text.endsWith("ms")) return amount;
  return text.endsWith("s") ? amount * 1000 : amount;
}

/**
 * 단계 차례 - 앞으로는 걷기(leave가 사라짐) → 펼치기 → 붙이기(enter가 나타남).
 * 되돌리기는 같은 길을 거꾸로 - 붙였던 것(enter)이 먼저 사라지고, 펼친 뒤 걷었던 것(leave)이 돌아온다. 시간과 곡선은 그 표시의 것 그대로
 */
export function planUnwrapPhases(timings: UnwrapTimings, reverse: boolean): UnwrapPlan {
  const clear: MarkerPhase = { marker: "leave", duration: timings.clear, easing: "exit" };
  const attach: MarkerPhase = { marker: "enter", duration: timings.attach, easing: "pop" };
  return reverse ? { before: attach, after: clear, direction: "reverse" } : { before: clear, after: attach, direction: "normal" };
}

/**
 * 표시 하나의 움직임(element.animate의 keyframes) - 한쪽 끝만 적고 다른 쪽은 그 요소의 제 모습이다. leave는 끝이 숨은 모양, enter는 처음이 숨은 모양.
 * kind가 "frame"이면 글은 두고 틀(테두리 · 바탕 · 그림자)만 움직인다 - 표 선과 음영, 왼쪽 세로선. 그 밖에는 요소째로(enter는 작게 시작해 튀어나온다)
 */
export function buildMarkerKeyframes(marker: UnwrapMarker, kind: string): Keyframe[] {
  const offset = marker === "leave" ? 1 : 0;
  if (kind === "frame") return [{ offset, borderColor: "transparent", backgroundColor: "transparent", boxShadow: "none" }];
  if (marker === "leave") return [{ offset, opacity: 0 }];
  return [{ offset, opacity: 0, transform: `scale(${POP_FROM_SCALE})` }];
}

/** 상자가 보이는 범위에 걸치는가 */
export function isOnScreen(box: MotionBox, view: MotionView): boolean {
  return box.bottom >= view.top && box.top <= view.bottom;
}

/** 움직일 키 - 바꾸기 전과 뒤에 다 쟀고, 처음 자리나 끝 자리가 화면에 걸친 것. 둘 다 화면 밖이면 움직이지 않고 바로 제자리다(긴 문서) */
export function pickOnScreenKeys(first: MotionSnapshot, last: MotionSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const [key, box] of first.boxes) {
    const end = last.boxes.get(key);
    if (end && (isOnScreen(box, first.view) || isOnScreen(end, last.view))) keys.add(key);
  }
  return keys;
}

/** 키마다 거꾸로 옮길 거리(처음 − 끝, px) - 가로와 세로를 flip.ts로 따로 내어 합친다. 움직이지 않은 키는 빠진다 */
export function computeUnwrapShifts(first: ReadonlyMap<string, MotionBox>, last: ReadonlyMap<string, MotionBox>, keys: ReadonlySet<string>): Map<string, { dx: number; dy: number }> {
  const pickSide = (boxes: ReadonlyMap<string, MotionBox>, side: "left" | "top") => new Map([...boxes].filter(([key]) => keys.has(key)).map(([key, box]) => [key, box[side]]));
  const dxs = computeFlipOffsets(pickSide(first, "left"), pickSide(last, "left"));
  const dys = computeFlipOffsets(pickSide(first, "top"), pickSide(last, "top"));
  const shifts = new Map<string, { dx: number; dy: number }>();
  for (const key of keys) {
    const dx = dxs.get(key);
    const dy = dys.get(key);
    if (dx !== undefined || dy !== undefined) shifts.set(key, { dx: dx ?? 0, dy: dy ?? 0 });
  }
  return shifts;
}

/**
 * 줄마다 늦춤(ms) - 위 줄부터 staggerStep씩 늦게 떠나고 staggerMax에서 멈춘다. tops는 펼친 쪽 화면에서 잰 위쪽 자리(앞으로는 끝 자리, 되돌리기는 처음 자리).
 * reverse면 같은 길을 거꾸로라 아래 줄이 먼저 떠나고 맨 위 줄이 가장 늦다
 */
export function computeStaggerDelays(tops: ReadonlyMap<string, number>, timings: Pick<UnwrapTimings, "staggerStep" | "staggerMax">, reverse = false): Map<string, number> {
  const delays = new Map<string, number>();
  let row = -1;
  let rowTop = Number.NEGATIVE_INFINITY;
  for (const [key, top] of [...tops].sort((a, b) => a[1] - b[1])) {
    if (top - rowTop > SAME_ROW_PX) {
      row += 1;
      rowTop = top;
    }
    delays.set(key, Math.min(row * timings.staggerStep, timings.staggerMax));
  }
  if (!reverse) return delays;
  const latest = Math.min(row * timings.staggerStep, timings.staggerMax);
  return new Map([...delays].map(([key, delay]) => [key, latest - delay]));
}

/** 펼치기가 끝나는 때(ms, 펼치기를 시작한 때부터) - 가장 늦게 떠난 줄이 닿을 때. 움직이는 것이 없으면 0이라 붙이기가 바로 시작한다 */
export function getSpreadEnd(delays: ReadonlyMap<string, number>, spread: number): number {
  return delays.size === 0 ? 0 : Math.max(...delays.values()) + spread;
}

/** 보던 자리의 기준 - 바꾸기 전과 뒤에 같은 요소를 찾는 표시(어느 data 속성의 어느 값)와 바꾸기 전 윗변(px) */
export interface ScrollAnchor {
  attribute: "data-unwrap-scope" | "data-flip-key";
  value: string;
  top: number;
}

/**
 * 바꾸는 동안 지킬 자리(B3) - 바꾸는 곳(scope, 차례대로 - 표 다음 안쪽 띠 표)의 윗변이 칸에 보이면 그것(표 머리),
 * 아니면 칸 윗변에 걸친 글 줄, 그것도 없으면 칸 안 맨 위 글 줄. 칸에 아무것도 없으면 null(스크롤을 건드리지 않는다)
 */
export function pickScrollAnchor(scopes: ReadonlyMap<string, MotionBox>, lines: ReadonlyMap<string, MotionBox>, view: MotionView): ScrollAnchor | null {
  for (const [value, box] of scopes) {
    if (box.top >= view.top && box.top <= view.bottom) return { attribute: "data-unwrap-scope", value, top: box.top };
  }
  let best: ScrollAnchor | null = null;
  for (const [value, box] of lines) {
    if (box.top <= view.top && box.bottom > view.top) return { attribute: "data-flip-key", value, top: box.top };
    if (box.top > view.top && box.top <= view.bottom && (best === null || box.top < best.top)) best = { attribute: "data-flip-key", value, top: box.top };
  }
  return best;
}

/** 기준 요소가 바꾸기 전 윗변(before)에 돌아오는 scrollTop - 바꾼 뒤 after로 밀렸으면 그만큼 더 내린다 */
export function computeAnchoredScrollTop(scrollTop: number, before: number, after: number): number {
  return scrollTop + (after - before);
}
