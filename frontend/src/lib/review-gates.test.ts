// 검토 요청 조건 카드 - Fail을 위, Pass를 아래로 나누고 각각 앞 몇 개만 보인 뒤 나머지 수를 센다.
import { describe, expect, it } from "vitest";

import { splitGates } from "./review-gates";

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
