import { describe, expect, it } from "vitest";

import { getPageWidth } from "./page-width";

describe("getPageWidth", () => {
  it.each([
    ["/", "wide"],
    ["/bundles/1", "default"],
    ["/bundles/1/documents", "wide"],
    // 옛 쪼개기 주소는 배정 화면으로 넘어간다 - 단계가 아니라 기본 폭
    ["/bundles/1/split", "default"],
    ["/bundles/1/history", "wide"],
    ["/bundles/1/assign", "desk"],
    ["/bundles/1/outputs", "default"],
    ["/bundles/1/review", "default"],
    ["/account", "default"],
    ["/manual", "default"],
    ["/admin", "wide"],
    ["/no-such-page", "default"],
  ])("%s -> %s", (pathname, expected) => {
    expect(getPageWidth(pathname)).toBe(expected);
  });
});
