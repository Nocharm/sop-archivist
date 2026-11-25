import { describe, expect, it } from "vitest";

import { getLinkDirection, readFarSide, readHiddenTabSide } from "./link-direction-model";

const view = { docId: 1, scrollTop: 100, height: 400 };

describe("getLinkDirection", () => {
  it("returns none without an anchor", () => {
    expect(getLinkDirection(null, view)).toBe("none");
  });

  it("returns otherDoc when the anchor is in another New document", () => {
    expect(getLinkDirection({ docId: 2, top: 150, bottom: 170 }, view)).toBe("otherDoc");
  });

  it("returns visible inside the frame", () => {
    expect(getLinkDirection({ docId: 1, top: 150, bottom: 170 }, view)).toBe("visible");
  });

  it("returns above when entirely over the top edge", () => {
    expect(getLinkDirection({ docId: 1, top: 20, bottom: 99 }, view)).toBe("above");
  });

  it("returns below when entirely under the bottom edge", () => {
    expect(getLinkDirection({ docId: 1, top: 501, bottom: 520 }, view)).toBe("below");
  });

  it("treats touching an edge as visible", () => {
    expect(getLinkDirection({ docId: 1, top: 80, bottom: 100 }, view)).toBe("visible");
    expect(getLinkDirection({ docId: 1, top: 500, bottom: 530 }, view)).toBe("visible");
  });
});

describe("readHiddenTabSide", () => {
  it("points to the other tab of the New paper", () => {
    // 각주 · 미주는 꼬리말 탭 - 본문 · 머리말을 보는 동안은 아래, 꼬리말 · 그림을 보는 동안 본문은 위
    expect(["body", "header", "footer", "figures"].map(readHiddenTabSide)).toEqual(["below", "below", "above", "above"]);
    expect(readHiddenTabSide(undefined)).toBeNull();
  });
});

describe("readFarSide", () => {
  const frame = { top: 0, bottom: 600 };

  it("answers from a chunk off screen", () => {
    expect(readFarSide({ top: -900, bottom: -100 }, frame)).toBe("above");
    expect(readFarSide({ top: 700, bottom: 900 }, frame)).toBe("below");
  });

  it("measures the box when the chunk touches the frame or is missing", () => {
    expect(readFarSide({ top: -900, bottom: 10 }, frame)).toBeNull();
    expect(readFarSide({ top: -900, bottom: 0 }, frame)).toBeNull();
    expect(readFarSide(null, frame)).toBeNull();
  });
});
