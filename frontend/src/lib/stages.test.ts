// 묶음 주소 읽기 - 단계 경로와 묶음 밖 주소를 가른다.
import { describe, expect, it } from "vitest";

import { getStageHref, parseBundlePath } from "./stages";

describe("parseBundlePath", () => {
  it("reads the overview and a stage", () => {
    expect(parseBundlePath("/bundles/12")).toEqual({ bundleId: 12, stage: "overview" });
    expect(parseBundlePath("/bundles/12/classify")).toEqual({ bundleId: 12, stage: "classify" });
    expect(parseBundlePath("/bundles/12/tobe/")).toEqual({ bundleId: 12, stage: "tobe" });
  });

  it("returns null outside a bundle and an unknown stage for a stray path", () => {
    expect(parseBundlePath("/")).toBeNull();
    expect(parseBundlePath("/admin")).toBeNull();
    expect(parseBundlePath("/bundles/x")).toBeNull();
    expect(parseBundlePath("/bundles/3/nope")).toEqual({ bundleId: 3, stage: null });
  });

  it("builds stage links", () => {
    expect(getStageHref(4, "overview")).toBe("/bundles/4");
    expect(getStageHref(4, "match")).toBe("/bundles/4/match");
  });
});
