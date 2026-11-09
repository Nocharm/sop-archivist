// 묶음 주소 읽기 - 단계 경로와 묶음 밖 주소를 가른다.
import { describe, expect, it } from "vitest";

import { getStageHref, isStageLocked, NEXT_ACTION_STAGE, parseBundlePath, STAGES } from "./stages";

describe("parseBundlePath", () => {
  it("reads the overview and a stage", () => {
    expect(parseBundlePath("/bundles/12")).toEqual({ bundleId: 12, stage: "overview" });
    expect(parseBundlePath("/bundles/12/assign")).toEqual({ bundleId: 12, stage: "assign" });
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
    expect(getStageHref(4, "assign")).toBe("/bundles/4/assign");
  });
});

describe("NEXT_ACTION_STAGE", () => {
  it("sends unit decisions and reasons to Assign", () => {
    expect(NEXT_ACTION_STAGE.decide_units).toBe("assign");
    expect(NEXT_ACTION_STAGE.fill_reasons).toBe("assign");
    expect(NEXT_ACTION_STAGE.fill_tobe).toBe("tobe");
  });
});

describe("isStageLocked", () => {
  it("locks the document-dependent stages while there are no documents", () => {
    for (const key of ["split", "assign", "outputs", "review"] as const) {
      expect(isStageLocked(key, 0)).toBe(true);
    }
  });

  it("keeps overview, documents, To-Be and history open", () => {
    for (const key of ["overview", "documents", "tobe", "history"] as const) {
      expect(isStageLocked(key, 0)).toBe(false);
    }
  });

  it("unlocks everything once a document exists", () => {
    expect(isStageLocked("split", 1)).toBe(false);
  });

  it("reads the history page path", () => {
    expect(parseBundlePath("/bundles/3/history")).toEqual({ bundleId: 3, stage: "history" });
  });
});

describe("STAGES", () => {
  it("has one step-3 stage, Assign", () => {
    expect(STAGES.filter((stage) => stage.step === 3).map((stage) => stage.key)).toEqual(["assign"]);
  });
});
