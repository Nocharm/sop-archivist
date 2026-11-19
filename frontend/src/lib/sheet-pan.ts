// 시트 보기의 옮기기 - 스크롤바 없이 본문 표를 transform으로 민다(끌기 · 휠 · 글쇠). 셈은 lib/sheet-view-model.ts, 여기는 DOM만 다룬다.
// 포인터가 움직일 때마다 React를 다시 그리지 않으려고 transform · 위치 막대를 직접 쓴다 - 화면(sheet-view.tsx)은 이 값들을 props로 쓰지 않는다.

import { applyDrag, applyKey, centreRow, clampOffset, getMoveRange, getRailMark, getRailThumb, isDragMove, readWheelMove, type SheetExtent, type SheetOffset } from "@/lib/sheet-view-model";

export interface SheetPanParts {
  /** 포인터 · 휠 · 글쇠를 받는 틀(overflow: hidden) */
  frame: HTMLElement;
  /** 고정 행 표 - 가로로만 따라 옮긴다. 고정 행이 없으면 null */
  head: HTMLElement | null;
  /** 본문이 보이는 틀 */
  clip: HTMLElement;
  /** 본문 표 */
  body: HTMLElement;
  rail: HTMLElement;
  thumb: HTMLElement;
  mark: HTMLElement;
}

export interface SheetPan {
  /** 크기 · 고른 줄이 바뀐 뒤 - 범위 안으로 되돌리고 위치 막대를 다시 그린다 */
  refresh: () => void;
  /** 고른 줄을 세로 가운데에 둔다 */
  centrePicked: () => void;
  detach: () => void;
}

const PICKED_SELECTOR = 'tr[data-mark="picked"]';

interface Press {
  pointerId: number;
  start: SheetOffset;
  origin: SheetOffset;
  moved: boolean;
}

export function attachSheetPan({ frame, head, clip, body, rail, thumb, mark }: SheetPanParts): SheetPan {
  let offset: SheetOffset = { x: 0, y: 0 };
  let press: Press | null = null;
  // 끌고 난 뒤의 click은 누르기가 아니다 - 목차 줄이 끌기 끝에 펼쳐지지 않게 한 번 삼킨다
  let swallowClick = false;

  function readExtent(): SheetExtent {
    return { viewWidth: clip.clientWidth, viewHeight: clip.clientHeight, contentWidth: body.offsetWidth, contentHeight: body.offsetHeight };
  }

  function place(extent: SheetExtent): void {
    body.style.transform = `translate(${-offset.x}px, ${-offset.y}px)`;
    if (head) head.style.transform = `translateX(${-offset.x}px)`;
    const box = getRailThumb(offset.y, extent);
    if (box) {
      thumb.style.top = `${box.top}%`;
      thumb.style.height = `${box.height}%`;
    }
  }

  function moveTo(next: SheetOffset): void {
    const extent = readExtent();
    offset = clampOffset(next, extent);
    place(extent);
  }

  function refresh(): void {
    const extent = readExtent();
    const range = getMoveRange(extent);
    offset = clampOffset(offset, extent);
    frame.toggleAttribute("data-movable", range.x > 0 || range.y > 0);
    rail.hidden = range.y === 0;
    const picked = body.querySelector<HTMLElement>(PICKED_SELECTOR);
    mark.hidden = picked === null;
    if (picked) mark.style.top = `${getRailMark(picked.offsetTop, picked.offsetHeight, extent.contentHeight)}%`;
    place(extent);
  }

  function centrePicked(): void {
    const picked = body.querySelector<HTMLElement>(PICKED_SELECTOR);
    if (picked) offset = { x: offset.x, y: centreRow(picked.offsetTop, picked.offsetHeight, readExtent()) };
    refresh();
  }

  function endPress(): void {
    if (press?.moved) {
      frame.removeAttribute("data-grabbing");
      if (frame.hasPointerCapture(press.pointerId)) frame.releasePointerCapture(press.pointerId);
    }
    press = null;
  }

  function handlePointerDown(event: PointerEvent): void {
    swallowClick = false;
    if (event.button !== 0 || press?.moved) return; // 끄는 중의 둘째 손가락은 받지 않는다
    press = null;
    // Alt를 누른 채 끌면 옮기지 않고 글자를 고른다(Order 화면과 같은 관례) - 다음 보통 누르기까지 고를 수 있는 채로 둔다
    if (event.altKey) {
      frame.setAttribute("data-select", "");
      return;
    }
    if (frame.hasAttribute("data-select")) {
      frame.removeAttribute("data-select");
      const selection = window.getSelection();
      if (selection?.anchorNode && frame.contains(selection.anchorNode)) selection.removeAllRanges();
    }
    press = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: offset, moved: false };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    // 문턱 전에는 포인터를 잡지 않아 틀 밖에서 뗀 것을 모른다 - 단추가 떨어진 채 돌아온 포인터로 끌기를 시작하지 않는다
    if (event.buttons === 0) {
      endPress();
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (!press.moved) {
      if (!isDragMove(point.x - press.start.x, point.y - press.start.y)) return;
      // 문턱을 넘은 뒤에만 포인터를 잡는다 - 누르자마자 잡으면 그냥 누르기의 click이 줄이 아니라 틀로 간다
      press.moved = true;
      frame.setPointerCapture(press.pointerId);
      frame.setAttribute("data-grabbing", "");
    }
    const extent = readExtent();
    offset = applyDrag(press.origin, press.start, point, extent);
    place(extent);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    swallowClick = press.moved;
    endPress();
  }

  function handleClick(event: MouseEvent): void {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function handleWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) return; // 브라우저 확대는 그대로 둔다
    const extent = readExtent();
    const range = getMoveRange(extent);
    if (range.x === 0 && range.y === 0) return;
    event.preventDefault(); // 끝에 닿아도 뒤의 화면이 대신 구르지 않게
    const move = readWheelMove(event, extent.viewHeight);
    offset = clampOffset({ x: offset.x + move.x, y: offset.y + move.y }, extent);
    place(extent);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const extent = readExtent();
    const next = applyKey(event.key, offset, extent);
    if (next === null) return;
    event.preventDefault();
    offset = next;
    place(extent);
  }

  // overflow: hidden인 틀도 포커스 이동 · 찾기로는 구른다 - 구른 만큼을 옮긴 거리로 바꾸고 스크롤은 0으로 되돌린다(머리와 본문이 어긋나지 않게)
  function handleScroll(event: Event): void {
    const el = event.currentTarget;
    if (!(el instanceof HTMLElement) || (el.scrollLeft === 0 && el.scrollTop === 0)) return;
    const moved = { x: offset.x + el.scrollLeft, y: offset.y + el.scrollTop };
    el.scrollLeft = 0;
    el.scrollTop = 0;
    moveTo(moved);
  }

  const blockDrag = (event: Event) => event.preventDefault(); // 그림 시트의 그림이 끌려 나오지 않게

  frame.addEventListener("pointerdown", handlePointerDown);
  frame.addEventListener("pointermove", handlePointerMove);
  frame.addEventListener("pointerup", handlePointerUp);
  frame.addEventListener("pointercancel", endPress);
  frame.addEventListener("click", handleClick, true);
  frame.addEventListener("wheel", handleWheel, { passive: false }); // React의 onWheel은 passive라 preventDefault가 듣지 않는다
  frame.addEventListener("keydown", handleKeyDown);
  frame.addEventListener("dragstart", blockDrag);
  frame.addEventListener("scroll", handleScroll);
  clip.addEventListener("scroll", handleScroll);
  // 폭이 바뀌면 줄바꿈으로 본문 높이가 바뀌고, 그림이 늦게 뜨거나 목차 줄을 펼쳐도 바뀐다
  const observer = new ResizeObserver(refresh);
  observer.observe(clip);
  observer.observe(body);
  refresh();

  return {
    refresh,
    centrePicked,
    detach: () => {
      observer.disconnect();
      endPress();
      frame.removeEventListener("pointerdown", handlePointerDown);
      frame.removeEventListener("pointermove", handlePointerMove);
      frame.removeEventListener("pointerup", handlePointerUp);
      frame.removeEventListener("pointercancel", endPress);
      frame.removeEventListener("click", handleClick, true);
      frame.removeEventListener("wheel", handleWheel);
      frame.removeEventListener("keydown", handleKeyDown);
      frame.removeEventListener("dragstart", blockDrag);
      frame.removeEventListener("scroll", handleScroll);
      clip.removeEventListener("scroll", handleScroll);
    },
  };
}
