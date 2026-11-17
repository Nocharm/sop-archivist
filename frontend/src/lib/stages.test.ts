// 묶음 주소 읽기 - 단계 경로와 묶음 밖 주소를 가른다.
import { describe, expect, it } from "vitest";

import { getEditOriginalHref, getNewDocumentsHref, getNextActionHref, getStageHref, isStageLocked, NEXT_ACTION_STAGE, parseBundlePath, STAGES } from "./stages";

describe("parseBundlePath", () => {
  it("reads the overview and a stage", () => {
    expect(parseBundlePath("/bundles/12")).toEqual({ bundleId: 12, stage: "overview" });
    expect(parseBundlePath("/bundles/12/assign")).toEqual({ bundleId: 12, stage: "assign" });
    expect(parseBundlePath("/bundles/12/documents/")).toEqual({ bundleId: 12, stage: "documents" });
  });

  it("no longer treats the old To-Be address as a stage", () => {
    // 그 주소는 Documents의 New 문서 목록으로 넘어간다
    expect(parseBundlePath("/bundles/12/tobe")).toEqual({ bundleId: 12, stage: null });
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
  });

  it("sends filling the new-document list to its place on Documents", () => {
    expect(NEXT_ACTION_STAGE.fill_tobe).toBe("documents");
    expect(getNextActionHref(4, "fill_tobe")).toBe("/bundles/4/documents#new-documents");
    expect(getNewDocumentsHref(4)).toBe("/bundles/4/documents#new-documents");
    expect(getNextActionHref(4, "decide_units")).toBe("/bundles/4/assign");
    expect(getNextActionHref(4, "request_review")).toBeNull();
  });

  it("sends the meaning checks to Outputs, where the checkboxes are", () => {
    expect(NEXT_ACTION_STAGE.semantic_checks).toBe("outputs");
  });

  it("sends missing-text warnings to Assign, where they are checked", () => {
    expect(NEXT_ACTION_STAGE.ack_warnings).toBe("assign");
    expect(getNextActionHref(4, "ack_warnings")).toBe("/bundles/4/assign");
  });

  it("sends waiting for review to Outputs, where the review bar is", () => {
    expect(NEXT_ACTION_STAGE.await_review).toBe("outputs");
    // 옛 검토 주소는 단계가 아니다 - 결과 화면으로 넘어간다
    expect(parseBundlePath("/bundles/12/review")).toEqual({ bundleId: 12, stage: null });
  });
});

describe("isStageLocked", () => {
  it("locks the document-dependent stages while there are no documents", () => {
    for (const key of ["assign", "order", "outputs"] as const) {
      expect(isStageLocked(key, 0)).toBe(true);
    }
  });

  it("keeps overview, documents and history open", () => {
    for (const key of ["overview", "documents", "history"] as const) {
      expect(isStageLocked(key, 0)).toBe(false);
    }
  });

  it("unlocks everything once a document exists", () => {
    expect(isStageLocked("assign", 1)).toBe(false);
  });

  it("reads the history page path", () => {
    expect(parseBundlePath("/bundles/3/history")).toEqual({ bundleId: 3, stage: "history" });
  });

  it("keeps Map open without documents", () => {
    expect(isStageLocked("map", 0)).toBe(false);
  });
});

describe("STAGES", () => {
  it("numbers four rail steps: Documents, Assign, Order, Outputs", () => {
    expect(STAGES.filter((stage) => stage.step !== undefined).map((stage) => [stage.step, stage.key])).toEqual([
      [1, "documents"], [2, "assign"], [3, "order"], [4, "outputs"],
    ]);
  });

  it("has no Split stage - the old address is not a stage and editing an original opens inside Assign", () => {
    expect(STAGES.some((stage) => stage.path === "/split")).toBe(false);
    expect(parseBundlePath("/bundles/3/split")).toEqual({ bundleId: 3, stage: null });
    expect(getEditOriginalHref(3, 12)).toBe("/bundles/3/assign?edit=12");
  });

  it("puts Map right before History, without a step number", () => {
    expect(STAGES.map((s) => s.key)).toEqual(["overview", "documents", "assign", "order", "outputs", "map", "history"]);
    expect(STAGES.find((s) => s.key === "map")).toEqual({ key: "map", path: "/map", ready: true });
    expect(parseBundlePath("/bundles/3/map")).toEqual({ bundleId: 3, stage: "map" });
    expect(getStageHref(4, "map")).toBe("/bundles/4/map");
  });

  it("reads the Order page path", () => {
    expect(parseBundlePath("/bundles/3/order")).toEqual({ bundleId: 3, stage: "order" });
    expect(getStageHref(3, "order")).toBe("/bundles/3/order");
  });
});
