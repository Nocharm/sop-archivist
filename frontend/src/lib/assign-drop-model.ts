// Assign 화면에서 Old 조각을 New 문장으로 끄는 순수 모델 - 끌 수 있는 때, 표 한 장, 놓을 수 있는 곳, 놓았을 때 클릭과 같은 판단을 정한다.
// 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §6
import type { DragCard } from "./box-drag";
import type { Destination } from "./classify-model";

export interface OldDragGate {
  canEdit: boolean;
  mode: "old" | "unsourced";
  isPairPicking: boolean;
  isSolo: boolean;
}

/** Old 조각을 끌 수 있나 - 꺼지면 조각에 data-drag-box도 달지 않아 글자가 지금처럼 긁힌다 */
export function canDragOld(gate: OldDragGate): boolean {
  return gate.canEdit && gate.mode === "old" && !gate.isPairPicking && !gate.isSolo;
}

export interface DragUnit {
  display_id: string;
  text: string;
}

/** 표 한 장 - 줄 첫 Unit의 ID와 글, Unit이 둘 이상이면 countLabel(개수). 긴 문단이 한 줄로 남게 공백을 접는다 */
export function buildOldDragCard(units: readonly DragUnit[], countLabel: (count: number) => string): DragCard {
  if (units.length === 0) return { id: "", text: "", count: null };
  return {
    id: units[0].display_id,
    text: units[0].text.replace(/\s+/g, " ").trim(),
    count: units.length > 1 ? countLabel(units.length) : null,
  };
}

/** 포인터 밑에서 읽은 것 - isReadOnly는 New 칸의 data-read-only, hasPickButton은 줄 안에 button.new-hit이 있나 */
export interface NewHit {
  targetId: number;
  isReadOnly: boolean;
  hasPickButton: boolean;
}

export type AssignDrop = { kind: "link"; targetId: number } | { kind: "none" };

/** 이번 걸음에서 놓이는 곳은 이미 쓴 문서의 고를 수 있는 문장 줄뿐 */
export function findAssignDrop(hit: NewHit | null): AssignDrop {
  if (hit === null || hit.isReadOnly || !hit.hasPickButton) return { kind: "none" };
  return { kind: "link", targetId: hit.targetId };
}

/** pick은 그 문장을 고르고, menu_only는 고름을 두고 끊기 메뉴만 연다 */
export type DropLinkAction = "pick" | "menu_only";

/** 놓았을 때 할 일 - handleNewPick의 Old 줄 갈래(초안 없음 + 이미 그 문장에 확정해 이음)와 같은 판단 */
export function resolveDropLink(input: { draftDestination: Destination | null; savedDestination: Destination | null; targetId: number }): DropLinkAction {
  const { draftDestination, savedDestination, targetId } = input;
  if (draftDestination === null && savedDestination?.kind === "link" && savedDestination.targetIds.includes(targetId)) return "menu_only";
  return "pick";
}
