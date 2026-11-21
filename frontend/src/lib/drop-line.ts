// 끄는 동안 놓을 자리에 긋는 선 하나 - 왼쪽 끝에 점이 달린 얇은 선(.c-dropline). 끌기 엔진(lib/box-drag.ts)이 끌기 root에 붙이고 자리만 고친다(React 상태를 바꾸지 않는다).
// Assign 보내기 · 템플릿 틈 · Order가 같은 선을 쓴다. 설계: 2026-11-20-assign-mockup1 D7 (docs/architecture/decisions.md)

/** client 좌표 - top은 선의 위 끝, left·width는 선이 덮을 줄 */
export interface DropLineAt {
  left: number;
  top: number;
  width: number;
}

export interface DropLine {
  show(at: DropLineAt): void;
  hide(): void;
  remove(): void;
}

/** .c-dropline 높이(2px)의 반 - 줄 상자의 변 y에서 이만큼 빼면 선의 가운데가 그 변에 온다 */
export const DROP_LINE_HALF_PX = 1;

/** root는 position이 있는 틀이어야 한다 - 선은 root 기준 absolute로 놓여 root 안 스크롤과 함께 움직인다 */
export function createDropLine(root: HTMLElement): DropLine {
  const line = document.createElement("div");
  line.className = "c-dropline";
  line.dataset.testid = "drop-line";
  line.hidden = true;
  root.append(line);

  return {
    show(at) {
      const base = root.getBoundingClientRect();
      line.style.top = `${at.top - base.top}px`;
      line.style.left = `${at.left - base.left}px`;
      line.style.width = `${Math.max(0, at.width)}px`;
      line.hidden = false;
    },
    hide() {
      line.hidden = true;
    },
    remove() {
      line.remove();
    },
  };
}
