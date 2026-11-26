// 우클릭 메뉴 항목이 닿는 칸(11-23 명세 C2-R3) - 항목에 올리면 바뀌는 칸은 진한 칠, 함께 닿는 칸(합칠 이웃 · 짝 · 캡션 받는 쪽)은 점선, 표 단위 항목은 표 둘레.
// 판정은 여기, 칠은 `<style>` 한 장(components/assign/reach-paint.tsx) - 용지를 다시 그리지 않는다.
import type { ViewUnit } from "./api-sop";
import type { AssignMenuItem } from "./assign-context-menu-model";
import type { MenuPlace } from "./menu-section-model";

/** 진한 칠 · 점선 · 표 둘레(아직 표면 표 단위, 벗긴 표면 그 줄 모두) - 단위 id */
export interface MenuReach {
  change: readonly number[];
  touch: readonly number[];
  around: readonly number[];
}

export interface MenuReachContext {
  target: ViewUnit;
  prev: ViewUnit | null;
  next: ViewUnit | null;
  /** 누른 줄의 단위들 - 표 밖에서 배정 취소 · 삭제가 닿는 칸 */
  rowUnitIds: readonly number[];
  /** 대상이 든 짝의 구성원(대상 포함) */
  pairIds: readonly number[];
  place: MenuPlace;
  /** 표 단위 항목이 닿는 둘레 - 아직 표면 표 단위 하나, 벗긴 표면 그 표의 줄 전체 */
  tableUnitIds: readonly number[];
}

const NONE: readonly number[] = [];

export function readMenuReach(item: Pick<AssignMenuItem, "action" | "holder">, ctx: MenuReachContext): MenuReach {
  const own = [ctx.target.id];
  const near = (unit: ViewUnit | null): readonly number[] => (unit === null ? NONE : [unit.id]);
  switch (item.action) {
    case "merge_prev":
    case "pair_prev":
    case "caption_attach_prev":
      return { change: own, touch: near(ctx.prev), around: NONE };
    case "merge_next":
    case "pair_next":
    case "caption_attach_next":
      return { change: own, touch: near(ctx.next), around: NONE };
    case "unpair":
      return { change: ctx.pairIds.length > 0 ? ctx.pairIds : own, touch: NONE, around: NONE };
    case "caption_of":
      return { change: own, touch: item.holder ? [item.holder.unitId] : NONE, around: NONE };
    case "caption_detach":
      return { change: own, touch: ctx.target.group_unit_id === null ? NONE : [ctx.target.group_unit_id], around: NONE };
    case "table_layout":
    case "table_rewrap":
    case "table_ai_order":
      return { change: NONE, touch: NONE, around: ctx.tableUnitIds };
    case "clear":
    case "delete":
      // 표 안에서는 줄이 곧 표다 - 표 둘레, 그 밖은 누른 줄
      if (ctx.place.kind === "table" || ctx.place.kind === "cell") return { change: NONE, touch: NONE, around: ctx.tableUnitIds };
      return { change: ctx.rowUnitIds.length > 0 ? ctx.rowUnitIds : own, touch: NONE, around: NONE };
    default:
      return { change: own, touch: NONE, around: NONE };
  }
}

/** 칠 규칙 - 그 칸(left · right)의 `[data-strip-unit]`만, 값은 토큰. 아무것도 안 닿으면 빈 글 */
export function buildReachCss(side: "old" | "new", reach: MenuReach): string {
  const select = (id: number) => `[data-pane="${side}"] [data-strip-unit="${id}"]`;
  const rule = (ids: readonly number[], body: string) => (ids.length === 0 ? "" : `${ids.map(select).join(", ")} { ${body} }`);
  const touch = reach.touch.filter((id) => !reach.change.includes(id));
  return [
    rule(reach.change, "outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-tint);"),
    rule(touch, "outline: 2px dashed var(--accent-line); outline-offset: -2px;"),
    rule(reach.around, "outline: 2px dashed var(--accent); outline-offset: -2px;"),
  ].filter((text) => text !== "").join("\n");
}
