// 버전 위아래 단추 - 소수점 아래가 0이면 앞자리(1.0 → 2.0), 아니면 뒷자리(2.9 → 2.10). 입력은 숫자와 점 하나만.
import { describe, expect, it } from "vitest";

import { sanitizeVersion, stepVersion } from "./version-step";

describe("stepVersion", () => {
  it("moves the major number while the minor is zero", () => {
    expect(stepVersion("1.0", 1)).toBe("2.0");
    expect(stepVersion("2.0", -1)).toBe("1.0");
  });

  it("never goes below 1.0", () => {
    expect(stepVersion("1.0", -1)).toBe("1.0");
  });

  it("moves the minor number when it is not zero", () => {
    expect(stepVersion("2.9", 1)).toBe("2.10");
    expect(stepVersion("2.10", -1)).toBe("2.9");
    expect(stepVersion("2.1", -1)).toBe("2.0");
  });

  it("starts from 1.0 when empty or unreadable", () => {
    expect(stepVersion("", 1)).toBe("1.0");
    expect(stepVersion("draft", 1)).toBe("1.0");
  });

  it("treats a bare major as .0", () => {
    expect(stepVersion("3", 1)).toBe("4.0");
  });
});

describe("sanitizeVersion", () => {
  it("keeps digits and one dot", () => {
    expect(sanitizeVersion("v3.1a")).toBe("3.1");
    expect(sanitizeVersion("1..2")).toBe("1.2");
    expect(sanitizeVersion("1.2.3")).toBe("1.23");
    expect(sanitizeVersion("")).toBe("");
  });
});
