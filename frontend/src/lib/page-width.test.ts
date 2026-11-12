import { describe, expect, it } from "vitest";

import { getPageWidth } from "./page-width";

describe("getPageWidth", () => {
  it.each([
    ["/", "wide"],
    ["/bundles/1", "default"],
    ["/bundles/1/documents", "wide"],
    ["/bundles/1/split", "wide"],
    ["/bundles/1/tobe", "wide"],
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
