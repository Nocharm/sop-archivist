// 원본 보기의 쪽 나누기 셈과 따라가기 판정 - DOM 없이 잰 값만 받는다(옮기기는 components/assign/original-render.ts).
// 설계 2026-11-27-original-view(docs/architecture/decisions.md) §5.3·§5.4 (D7·D8)

import type { PlaceMark } from "./original-place-model";

/** 아래 여백을 이만큼(px) 넘는 것은 넘침으로 보지 않는다 - 스파이크에서 문단 아래 여백이 4px 넘쳐 쪽이 하나 더 생겼다 */
export const PAGE_SLACK_PX = 6;

/** 거리가 화면 높이의 이 배수 안이면 부드럽게 굴린다(D8 "한 화면 남짓"), 넘으면 흐렸다 밝힌다 */
const SMOOTH_SCREENS = 1.5;

const CSS_PX: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** 그리개가 인라인으로 적은 길이(대개 pt)를 px로 - 못 읽으면 NaN */
export function readCssLength(value: string): number {
  const match = /^(-?[\d.]+)([a-z]*)$/.exec(value.trim());
  if (match === null) return Number.NaN;
  return Number(match[1]) * (CSS_PX[match[2] || "px"] ?? Number.NaN);
}

/** 본문 아이 하나의 흐름 위치(px). 떠 있는 요소(floating)는 흐름을 차지하지 않아 셈에서 뺀다 */
export type FlowBox = { top: number; bottom: number; floating: boolean };

type Span = { index: number; top: number; bottom: number };

/**
 * 이어진 덩어리들을 장에 나눠 담을 때 새 장을 시작할 번호들. 첫 장의 자리는 firstRoom, 다음 장부터 usable.
 * 장에 혼자인데도 넘치는 덩어리는 그 장에 두고 다음 덩어리부터 새 장(그 장만 길다).
 * 첫 장에 들어갈 덩어리가 하나도 없으면 0을 낸다(통째로 다음 장으로).
 */
function planBreaks(spans: readonly Span[], firstRoom: number, usable: number, start: number, after: (span: Span) => number | null): number[] {
  const breaks: number[] = [];
  let room = firstRoom;
  let pageStart: number | null = start;
  let alone = false; // 이 장의 첫 덩어리인가 - 첫 장은 위에 다른 것이 있을 수 있어 아니다
  for (const span of spans) {
    if (pageStart === null) {
      pageStart = span.top;
      alone = true;
    }
    if (span.bottom - pageStart <= room + PAGE_SLACK_PX) {
      alone = false;
      continue;
    }
    if (!alone) {
      breaks.push(span.index);
      pageStart = span.top;
      room = usable;
      if (span.bottom - pageStart <= room + PAGE_SLACK_PX) continue;
    }
    // 장 하나보다 큰 덩어리 - 혼자 두고 다음부터 새 장
    const next = after(span);
    if (next === null) break;
    breaks.push(next);
    pageStart = null;
    room = usable;
  }
  return breaks;
}

/** 새 장을 시작할 본문 아이 번호들(오름차순) - 장 첫 아이의 top을 0으로 다시 잰다 */
export function planPageBreaks(boxes: readonly FlowBox[], usable: number): number[] {
  const spans = boxes.flatMap((box, index) => (box.floating ? [] : [{ index, top: box.top, bottom: box.bottom }]));
  if (spans.length === 0) return [];
  return planBreaks(spans, usable, usable, spans[0].top, (span) => (span.index + 1 < boxes.length ? span.index + 1 : null)).filter(
    (index) => index > 0,
  );
}

/** 표 줄을 나눌 줄 번호들 - rowBottoms는 표 위에서 잰 각 줄의 아래, 첫 장은 firstRoom만큼 남았다 */
export function planRowBreaks(rowBottoms: readonly number[], firstRoom: number, usable: number): number[] {
  const spans = rowBottoms.map((bottom, index) => ({ index, top: index === 0 ? 0 : rowBottoms[index - 1], bottom }));
  return planBreaks(spans, firstRoom, usable, 0, (span) => (span.index + 1 < rowBottoms.length ? span.index + 1 : null));
}

export type FollowMotion = "none" | "smooth" | "fade" | "instant";

/** 고른 문단으로 갈 움직임(D8) - 화면 안이면 칠만, 한 화면 남짓이면 부드럽게, 멀면 흐렸다 밝힘, 반복 중·움직임 줄이기는 바로 */
export function readFollowMotion(input: {
  scrollTop: number;
  viewHeight: number;
  targetTop: number;
  targetBottom: number;
  repeating: boolean;
  reduced: boolean;
}): FollowMotion {
  const { scrollTop, viewHeight, targetTop, targetBottom } = input;
  if (input.repeating || input.reduced) return "instant";
  if (targetTop >= scrollTop && targetBottom <= scrollTop + viewHeight) return "none";
  const distance = Math.abs((targetTop + targetBottom) / 2 - (scrollTop + viewHeight / 2));
  return distance <= SMOOTH_SCREENS * viewHeight ? "smooth" : "fade";
}

/** 따라갈 Unit과 그 표지들 - 그린 문서가 지금 문서가 아니면 null(낡은 그리기를 쓰지 않는다), 고른 것 중 표지가 있는 첫 Unit */
export function pickFollowTarget(input: {
  renderedDocId: number | null;
  docId: number;
  pickedUnitIds: readonly number[];
  marks: ReadonlyMap<number, readonly PlaceMark[]>;
}): { unitId: number; marks: readonly PlaceMark[] } | null {
  if (input.renderedDocId !== input.docId) return null;
  for (const unitId of input.pickedUnitIds) {
    const marks = input.marks.get(unitId);
    if (marks !== undefined && marks.length > 0) return { unitId, marks };
  }
  return null;
}
