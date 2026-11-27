// 커밋마다 읽는 기록(CHANGELOG.md·PROGRESS.md)이 쌓여 세션이 무거워지지 않게 크기 상한을 본다 - 정리 절차는 docs/deploy/release.md "문서 정리".
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 바이트 상한. 한국어는 글자당 3바이트라 약 1.3만 글자다. 정식 업데이트 한 묶음(줄마다 기록 그대로)이 약 1.5만 바이트라 최근 릴리스 + 다음 묶음이 들어간다
const LIMITS: Record<string, { bytes: number; archive: string }> = {
  "CHANGELOG.md": { bytes: 40_000, archive: "docs/history/CHANGELOG-archive.md" },
  "PROGRESS.md": { bytes: 40_000, archive: "docs/history/PROGRESS-archive.md" },
};

describe("repo history docs", () => {
  it.each(Object.entries(LIMITS))("%s stays under its size limit", (file, { bytes, archive }) => {
    const size = readFileSync(join(process.cwd(), "..", file)).byteLength;

    expect(
      size,
      `${file} is ${size} bytes (limit ${bytes}). In a docs-only commit, move entries older than the latest release to the top of ${archive}; if still over, merge entries of the same work into one summary (docs/deploy/release.md "문서 정리")`,
    ).toBeLessThanOrEqual(bytes);
  });
});
