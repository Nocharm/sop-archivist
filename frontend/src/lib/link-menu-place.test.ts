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
});
