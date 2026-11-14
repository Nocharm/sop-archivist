// Assign 그 자리 메뉴의 자리 계산 - 세로는 누른 좌표가 아니라 줄 상자 기준이라 메뉴가 잇고 있는 줄의 글을 덮지 않는다.

export const MENU_EDGE = 8; // 화면 가장자리와 띄울 최소 간격(px)
export const MENU_GAP = 10; // 줄 상자와 메뉴 사이(px)
const NAV_INDENT = 24; // 이동해 온 조각에서 메뉴를 들여 놓는 폭(px) - 조각 앞 KO/EN 태그를 가리지 않게
const CLICK_LEAD = 16; // 누른 x보다 메뉴를 왼쪽으로 당기는 폭(px)

interface RowBox {
  top: number;
  bottom: number;
  left: number;
}

/** 줄 아래에 놓고, 아래가 모자라면 줄 위로 뒤집는다. 위·아래 모두 안 맞는 아주 높은 줄은 누른 y(없으면 줄 위쪽) 근처에 놓고 화면 안으로 맞춘다. 가로는 누른 x(없으면 줄 왼쪽 + 들여쓰기)를 화면 안으로 맞춘다 */
export function placeLinkMenu(
  row: RowBox,
  clickX: number | null,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  clickY: number | null = null,
): { top: number; left: number } {
  const x = clickX !== null ? clickX - CLICK_LEAD : row.left + NAV_INDENT;
  const left = Math.min(Math.max(x, MENU_EDGE), viewport.width - menu.width - MENU_EDGE);
  let top = row.bottom + MENU_GAP;
  if (top + menu.height > viewport.height - MENU_EDGE) {
    top = row.top - MENU_GAP - menu.height;
    if (top < MENU_EDGE) {
      const maxTop = viewport.height - MENU_EDGE - menu.height;
      top = Math.min(Math.max((clickY ?? row.top) + MENU_GAP, MENU_EDGE), maxTop);
    }
  }
  return { top: Math.min(Math.max(top, MENU_EDGE), Math.max(MENU_EDGE, viewport.height - MENU_EDGE - menu.height)), left };
}
