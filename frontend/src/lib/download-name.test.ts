// 내려받기 파일 이름 규칙 단위 테스트 - KST 시각·빈 조각 제거·문자 정리
import { describe, expect, it } from "vitest";

import { buildDownloadName, formatDownloadStamp, sanitizeFileNamePart } from "./download-name";

describe("download names", () => {
  it("stamps in KST, not UTC", () => {
    // 2026-10-15T23:30Z = 10-16 08:30 KST
    expect(formatDownloadStamp(new Date("2026-10-15T23:30:00Z"))).toBe("20261016-0830");
  });

  it("joins parts with underscores and drops empty ones", () => {
    const now = new Date("2026-10-16T01:05:00Z");
    expect(buildDownloadName(["구매 요청 처리", "", "v3"], "csv", now)).toBe("구매-요청-처리_v3_20261016-1005.csv");
  });

  it("starts with sop-archivist when every part is empty", () => {
    const now = new Date("2026-10-16T01:05:00Z");
    expect(buildDownloadName([null, ""], "csv", now)).toBe("sop-archivist_20261016-1005.csv");
  });

  it("keeps any letters and replaces unsafe characters", () => {
    expect(sanitizeFileNamePart("①단계/검토: 最終 (안)")).toBe("①단계-검토-最終-안");
    expect(sanitizeFileNamePart("  ..이름?*  ")).toBe("이름");
  });
});
