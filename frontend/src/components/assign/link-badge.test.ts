import { describe, expect, it } from "vitest";

import type { WrittenSentence } from "@/lib/api-sop";

import { pickBadgeTarget } from "./link-badge";

const item = (target_id: number, target_doc_id: number) => ({ target_id, target_doc_id }) as WrittenSentence;

describe("pickBadgeTarget", () => {
  it("prefers a sentence in the open New document", () => {
    expect(pickBadgeTarget([item(1, 10), item(2, 20)], 20)?.target_id).toBe(2);
  });

  it("falls back to the first sentence", () => {
    expect(pickBadgeTarget([item(1, 10), item(2, 20)], 30)?.target_id).toBe(1);
  });

  it("returns null without targets", () => {
    expect(pickBadgeTarget([], 10)).toBeNull();
  });
});
