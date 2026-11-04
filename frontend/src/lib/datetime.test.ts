// datetime 단위 테스트 - KST 고정 표기와 상대 시간 구간을 확인한다.
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatKst, formatKstShort, relativeAgo } from "./datetime";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatKst", () => {
  it("converts to Asia/Seoul regardless of the offset in the input", () => {
    expect(formatKst("2026-11-04T15:30:00Z")).toBe("2026-11-05 00:30");
    expect(formatKst("2026-11-05T00:30:00+09:00")).toBe("2026-11-05 00:30");
    expect(formatKstShort("2026-11-04T15:30:00Z")).toBe("11-05 00:30");
  });

  it("returns an empty string for empty input", () => {
    expect(formatKst(null)).toBe("");
    expect(formatKstShort(undefined)).toBe("");
  });
});

describe("relativeAgo", () => {
  it("buckets into now, minutes, hours and days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    expect(relativeAgo("2026-11-04T11:59:40Z")).toEqual({ n: 0, unit: "now" });
    expect(relativeAgo("2026-11-04T11:45:00Z")).toEqual({ n: 15, unit: "min" });
    expect(relativeAgo("2026-11-04T09:00:00Z")).toEqual({ n: 3, unit: "hour" });
    expect(relativeAgo("2026-11-01T12:00:00Z")).toEqual({ n: 3, unit: "day" });
    expect(relativeAgo("not a date")).toBeNull();
    expect(relativeAgo(null)).toBeNull();
  });
});
