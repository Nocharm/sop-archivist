// 가운데 말줄임 - 짧으면 그대로, 길면 앞 head자 + "…" + 뒤 tail자(길이 head + tail + 1).
import { describe, expect, it } from "vitest";

import { truncateMiddle } from "./truncate-middle";

describe("truncateMiddle", () => {
  it("keeps short text as is", () => {
    expect(truncateMiddle("SOP-QA-001", 12, 10)).toBe("SOP-QA-001");
  });

  it("keeps text that is exactly head + tail + 1 long", () => {
    const text = "a".repeat(23);
    expect(truncateMiddle(text, 12, 10)).toBe(text);
  });

  it("cuts the middle of long text to head + ellipsis + tail", () => {
    const text = `${"H".repeat(12)}${"m".repeat(50)}${"T".repeat(10)}`;
    const out = truncateMiddle(text, 12, 10);
    expect(out).toBe(`${"H".repeat(12)}…${"T".repeat(10)}`);
    expect(out).toHaveLength(23);
  });

  it("counts characters, not UTF-16 units", () => {
    const text = "가".repeat(40);
    expect(truncateMiddle(text, 12, 10)).toBe(`${"가".repeat(12)}…${"가".repeat(10)}`);
  });
});
