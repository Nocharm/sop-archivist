// 상자를 스크롤 칸 안에 보이게 하는 순수 계산 - scrollIntoView({ block: "nearest" })와 같은 규칙이되, 미끄러지는 중(useFlip의 translateY)인 상자도 제자리로 잰다.
// scrollIntoView는 옮겨 그린 상자(옛 자리)를 보고 스크롤해 버린다 - 끌어 옮긴 줄이 새 자리 대신 옛 자리로 화면을 끌고 갔다.

export interface VerticalBox {
  top: number;
  bottom: number;
}

/** 지금 보이는 상자(getBoundingClientRect)에서 미끄러짐(translateY px)을 되돌린 제자리 */
export function readUntransformedBox(box: VerticalBox, shiftY: number): VerticalBox {
  return { top: box.top - shiftY, bottom: box.bottom - shiftY };
}

/** 상자가 칸(view) 안이면 null, 위로 나갔거나 칸보다 크면 위 끝에, 아래로 나갔으면 아래 끝에 맞춘 scrollTop. 좌표는 모두 창 기준 */
export function getRevealScrollTop(view: VerticalBox, box: VerticalBox, scrollTop: number): number | null {
  if (box.top >= view.top && box.bottom <= view.bottom) return null;
  if (box.top < view.top || box.bottom - box.top > view.bottom - view.top) return scrollTop + (box.top - view.top);
  return scrollTop + (box.bottom - view.bottom);
}
