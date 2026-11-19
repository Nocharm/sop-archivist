// Assign에서 Old 조각을 끄는 동안 New · from Assign 문서의 놓을 자리(두 문장 사이)에 긋는 선 - React 없이 두 문서 틀(.assign-panes)에 선 하나를 붙이고 자리만 고친다(끄는 동안 React 상태를 바꾸지 않는다).
// 모양은 Order의 놓을 자리 선(.c-dropline)을 그대로 받는다. 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §6

export interface DropGapLine {
  /** 좌표는 client 좌표 - top은 선이 지날 세로 자리(줄 상자의 변), left·width는 그 줄의 문장 상자 */
  show(at: { left: number; top: number; width: number }): void;
  hide(): void;
  remove(): void;
}

// .c-dropline의 높이(2px)의 반 - 선의 가운데가 줄 상자의 변에 오게 한다
const LINE_HALF_PX = 1;

export function createDropGapLine(root: HTMLElement): DropGapLine {
  const line = document.createElement("div");
  line.className = "c-dropline";
  line.dataset.testid = "assign-drop-gap";
  line.hidden = true;
  root.append(line);

  return {
    show(at) {
      // 틀 기준으로 옮긴다 - 틀은 스크롤하지 않고 그 안의 칸(.pane-body)이 스크롤한다
      const base = root.getBoundingClientRect();
      line.style.top = `${at.top - base.top - LINE_HALF_PX}px`;
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
