// 우클릭 메뉴 항목이 닿는 칸을 칠하는 `<style>` 한 장 - 메뉴가 닫히면 React가 함께 떼므로 정리 이펙트가 없고 용지는 다시 그려지지 않는다(lib/menu-reach-model).
import { buildReachCss, type MenuReach } from "@/lib/menu-reach-model";

export function ReachPaint({ side, reach }: { side: "old" | "new"; reach: MenuReach | null }) {
  const css = reach === null ? "" : buildReachCss(side, reach);
  return css === "" ? null : <style data-testid="assign-ctx-reach">{css}</style>;
}
