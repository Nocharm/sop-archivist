import { describe, expect, it } from "vitest";

import type { Recommendation } from "@/lib/assign-model";
import type { Destination } from "@/lib/classify-model";
import { describePrimary, planPrimary, type PrimaryInput } from "@/lib/primary-model";

const LINK: Destination = { kind: "link", targetIds: [4] };
const OTHER: Destination = { kind: "link", targetIds: [9] };
const DELETE: Destination = { kind: "delete" };

function rec(destination: Destination, source: Recommendation["source"] = "similar"): Recommendation {
  return { key: JSON.stringify(destination), destination, why: "", source };
}

const base: PrimaryInput = { canEdit: true, hasRow: true, destination: null, recommendations: [], blockKey: null, orderPreviewTableId: null };

describe("planPrimary", () => {
  it("prefers the AI order preview over everything else", () => {
    expect(planPrimary({ ...base, destination: LINK, recommendations: [rec(OTHER)], blockKey: "assign.ref.checkFirst", orderPreviewTableId: 7 })).toEqual({ kind: "apply_order", tableId: 7 });
  });

  it("confirms the picked destination when there is one", () => {
    expect(planPrimary({ ...base, destination: LINK, recommendations: [rec(OTHER, "ai")] })).toEqual({ kind: "confirm", from: "draft", destination: LINK, cardIndex: null, isAiAsIs: false, tone: "normal" });
  });

  it("confirms the first Suggested card when nothing is picked", () => {
    expect(planPrimary({ ...base, recommendations: [rec(LINK), rec(OTHER)] })).toEqual({ kind: "confirm", from: "card", destination: LINK, cardIndex: 0, isAiAsIs: false, tone: "normal" });
  });

  it("marks an AI first card as used as is", () => {
    expect(planPrimary({ ...base, recommendations: [rec(LINK, "ai"), rec(OTHER)] })).toMatchObject({ from: "card", isAiAsIs: true });
    expect(planPrimary({ ...base, recommendations: [rec(OTHER), rec(LINK, "ai")] })).toMatchObject({ from: "card", isAiAsIs: false });
  });

  it("is danger when the destination is delete", () => {
    expect(planPrimary({ ...base, destination: DELETE })).toMatchObject({ from: "draft", tone: "danger" });
    expect(planPrimary({ ...base, recommendations: [rec(DELETE, "ai")] })).toMatchObject({ from: "card", tone: "danger" });
  });

  it("is blocked with a reason when Suggested is empty", () => {
    expect(planPrimary(base)).toEqual({ kind: "blocked", reasonKey: "assign.primary.pickFirst" });
  });

  it("keeps the gate reason before the card", () => {
    expect(planPrimary({ ...base, recommendations: [rec(LINK)], blockKey: "assign.ref.checkFirst" })).toEqual({ kind: "blocked", reasonKey: "assign.ref.checkFirst" });
    expect(planPrimary({ ...base, destination: LINK, blockKey: "assign.caption.needed" })).toEqual({ kind: "blocked", reasonKey: "assign.caption.needed" });
    expect(planPrimary({ ...base, blockKey: "assign.ref.checkFirst" })).toEqual({ kind: "blocked", reasonKey: "assign.ref.checkFirst" });
  });

  it("is blocked for a read-only viewer or without a row", () => {
    expect(planPrimary({ ...base, canEdit: false, destination: LINK, orderPreviewTableId: 7 }).kind).toBe("blocked");
    expect(planPrimary({ ...base, hasRow: false, recommendations: [rec(LINK)], orderPreviewTableId: 7 }).kind).toBe("blocked");
  });
});

describe("describePrimary", () => {
  it("labels Confirm with the place, the AI suffix and Delete", () => {
    const card = planPrimary({ ...base, recommendations: [rec(LINK, "ai")] });
    expect(describePrimary(card, "§4.2")).toEqual({ labelKey: "assign.primary.confirmTo", values: { place: "§4.2" }, suffixKey: "assign.primary.aiAsIs", tone: "normal" });
    const picked = planPrimary({ ...base, destination: LINK });
    expect(describePrimary(picked, "§4.2")).toEqual({ labelKey: "assign.primary.confirmTo", values: { place: "§4.2" }, suffixKey: null, tone: "normal" });
    const removed = planPrimary({ ...base, recommendations: [rec(DELETE)] });
    expect(describePrimary(removed, "")).toEqual({ labelKey: "assign.primary.delete", values: {}, suffixKey: null, tone: "danger" });
  });

  it("says Apply AI order, and plain Confirm when blocked or the place has no name", () => {
    expect(describePrimary({ kind: "apply_order", tableId: 7 }, "§4.2")).toEqual({ labelKey: "assign.primary.applyOrder", values: {}, suffixKey: null, tone: "normal" });
    expect(describePrimary({ kind: "blocked", reasonKey: "assign.primary.pickFirst" }, "§4.2")).toEqual({ labelKey: "classify.confirm", values: {}, suffixKey: null, tone: "normal" });
    expect(describePrimary(planPrimary({ ...base, destination: LINK }), "").labelKey).toBe("classify.confirm");
  });
});

describe("planPrimary while Suggested is loading", () => {
  it("says it is still loading instead of asking to pick, and never hides a picked destination", () => {
    expect(planPrimary({ ...base, isSuggestedLoading: true })).toEqual({ kind: "blocked", reasonKey: "assign.primary.loading" });
    expect(planPrimary({ ...base, isSuggestedLoading: true, destination: LINK })).toMatchObject({ kind: "confirm", from: "draft" });
    expect(planPrimary({ ...base, isSuggestedLoading: true, recommendations: [rec(LINK, "ai")] })).toMatchObject({ kind: "confirm", from: "card" });
  });
});
