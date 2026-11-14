import { describe, expect, it } from "vitest";

import { placeLinkMenu } from "./link-menu-place";

const MENU = { width: 180, height: 70 };
const VIEW = { width: 1000, height: 700 };
const row = (top: number, bottom: number, left = 100) => ({ top, bottom, left });

describe("placeLinkMenu", () => {
  it("줄 상자 아래(bottom + 간격)에 놓고 가로는 누른 x를 따른다", () => {
    expect(placeLinkMenu(row(200, 260), 300, MENU, VIEW)).toEqual({ top: 270, left: 284 });
  });

  it("아래가 모자라면 줄 상자 위로 뒤집는다(top - 간격 - 메뉴 높이)", () => {
    expect(placeLinkMenu(row(600, 660), 300, MENU, VIEW)).toEqual({ top: 520, left: 284 });
  });

  it("좌우 끝은 가장자리 간격만큼 안으로 맞춘다", () => {
    expect(placeLinkMenu(row(200, 260), 4, MENU, VIEW).left).toBe(8);
    expect(placeLinkMenu(row(200, 260), 990, MENU, VIEW).left).toBe(1000 - 180 - 8);
  });

  it("누른 x가 없으면 줄 왼쪽에서 들여 놓는다", () => {
    expect(placeLinkMenu(row(200, 260), null, MENU, VIEW).left).toBe(124);
  });

  it("줄이 화면보다 높아 위·아래 모두 안 맞으면 누른 y 근처에 놓고 화면 안으로 맞춘다", () => {
    const view = { width: 1000, height: 900 };
    const menu = { width: 180, height: 110 };
    expect(placeLinkMenu(row(-200, 1000), 300, menu, view, 400).top).toBe(410);
    expect(placeLinkMenu(row(-200, 1000), 300, menu, view, 890).top).toBe(782);
    expect(placeLinkMenu(row(-200, 1000), 300, menu, view, -50).top).toBe(8);
  });

  it("누른 y가 없어도 메뉴는 화면 밖으로 나가지 않는다", () => {
    const view = { width: 1000, height: 900 };
    const menu = { width: 180, height: 110 };
    for (const r of [row(-200, 1000), row(40, 1300), row(-900, -100)]) {
      const { top } = placeLinkMenu(r, null, menu, view);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + menu.height).toBeLessThanOrEqual(view.height - 8);
    }
  });
});
