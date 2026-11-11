import { describe, expect, it } from "vitest";

import { getLinkDirection } from "./link-direction-model";

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
