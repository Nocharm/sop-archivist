// 검토 요청 조건 카드 - Fail을 위, Pass를 아래로 나누고 각각 앞 몇 개만 보인 뒤 나머지 수를 센다.
import { describe, expect, it } from "vitest";

import { GATE_STAGE, groupNotices, splitGates } from "./review-gates";
import { NEXT_ACTION_STAGE } from "./stages";

const gate = (key: string, ok: boolean) => ({ key, ok });

describe("splitGates", () => {
  it("puts failing gates first and counts the hidden rest", () => {
    const gates = [gate("a", false), gate("b", true), gate("c", false), gate("d", false), gate("e", true), gate("f", false), gate("g", false)];

    const split = splitGates(gates, 3);

    expect(split.fail.map((item) => item.key)).toEqual(["a", "c", "d"]);
    expect(split.failHidden).toBe(2);
    expect(split.pass.map((item) => item.key)).toEqual(["b", "e"]);
    expect(split.passHidden).toBe(0);
  });

  it("shows everything when asked", () => {
    const gates = [gate("a", false), gate("b", false), gate("c", false), gate("d", false)];

    expect(splitGates(gates, Infinity).fail).toHaveLength(4);
  });
});

describe("GATE_STAGE", () => {
  it("opens the same screen as the next action for the same blocker", () => {
    expect(GATE_STAGE.documents).toBe(NEXT_ACTION_STAGE.upload_documents);
    expect(GATE_STAGE.boundaries).toBe(NEXT_ACTION_STAGE.check_boundaries);
    expect(GATE_STAGE.boundaries).toBe("split");
    expect(GATE_STAGE.units).toBe(NEXT_ACTION_STAGE.decide_units);
    expect(GATE_STAGE.warnings).toBe(NEXT_ACTION_STAGE.ack_warnings);
    expect(GATE_STAGE.reasons).toBe(NEXT_ACTION_STAGE.fill_reasons);
    expect(GATE_STAGE.semantic).toBe(NEXT_ACTION_STAGE.semantic_checks);
  });

  it("leaves the reviewer blocker to the members window", () => {
    expect(GATE_STAGE.reviewer).toBeNull();
  });
});

describe("groupNotices", () => {
  const slot = (doc: string) => ({ code: "equipment_sop_empty_slots", doc_code: doc });

  it("returns an empty list for no notices", () => {
    expect(groupNotices([])).toEqual([]);
  });

  it("keeps a single equipment notice as it is", () => {
    const only = slot("OLD-1");

    expect(groupNotices([only, { code: "unacked_missing_text", count: 2 }])).toEqual([only, { code: "unacked_missing_text", count: 2 }]);
  });

  it("folds three equipment notices into one group carrying the three doc codes", () => {
    const grouped = groupNotices([slot("A"), { code: "unacked_missing_text", count: 2 }, slot("B"), slot("C")]);

    expect(grouped).toEqual([{ code: "equipment_sop_empty_slots", docs: ["A", "B", "C"] }, { code: "unacked_missing_text", count: 2 }]);
  });
});
