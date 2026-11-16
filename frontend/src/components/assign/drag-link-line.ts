// Assign에서 Old 조각을 끄는 동안 따라오는 초안 이음 선 - React 없이 두 문서 틀(.assign-panes)에 SVG 하나를 붙이고 끌 때마다 길만 고친다(끄는 동안 React 상태를 바꾸지 않는다).
// 모양은 지금 이음 선(.link-lines)의 고른 줄 초안(진한 점선)을 그대로 받는다. 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §6
import { buildLinkPath } from "@/lib/link-route-model";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Point {
  x: number;
  y: number;
}

export interface DragLinkLine {
  /** 좌표는 client 좌표 - start가 null이면(출발 조각이 Old 칸 화면 밖) 선을 감춘다 */
  update(start: Point | null, end: Point): void;
  remove(): void;
}

export function createDragLinkLine(root: HTMLElement): DragLinkLine {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "link-lines");
  svg.setAttribute("data-drag-line", "");
  svg.setAttribute("aria-hidden", "true");
  const group = document.createElementNS(SVG_NS, "g");
  // 고른 줄의 저장 전 이음과 같은 표시(LinkLines의 data-strong + data-draft) - 옅은 선이면 끄는 동안 눈이 따라가지 못한다
  group.setAttribute("data-draft", "");
  group.setAttribute("data-strong", "");
  const path = document.createElementNS(SVG_NS, "path");
  group.append(path);
  svg.append(group);
  root.append(svg);

  return {
    update(start, end) {
      if (start === null) {
        path.removeAttribute("d");
        return;
      }
      // 틀 기준으로 옮긴다 - LinkLines의 shift와 같다
      const base = root.getBoundingClientRect();
      const shift = (point: Point) => ({ x: point.x - base.left, y: point.y - base.top });
      path.setAttribute("d", buildLinkPath(shift(start), shift(end)));
    },
    remove() {
      svg.remove();
    },
  };
}
