// 연습 요청 판정(설계 D2 · D3) - 연습 Bundle은 늘 가짜, /practice에서는 허용 목록 둘만 실제, 운영 빌드에서도 같다.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PRACTICE_BUNDLE_ID, PRACTICE_PATH, REAL_ON_PRACTICE, isPracticeBundlePath, isPracticeRequest } from "./practice-route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPracticeRequest", () => {
  it("sends the practice bundle to the fake server from any page", () => {
    expect(PRACTICE_BUNDLE_ID).toBe(-1);
    for (const pathname of [PRACTICE_PATH, "/bundles/5/assign", "/", null]) {
      expect(isPracticeRequest("/bundles/-1/groups/save", pathname)).toBe(true);
    }
    expect(isPracticeRequest("/bundles/-1", "/")).toBe(true);
    expect(isPracticeRequest("/bundles/-1/units?limit=1000&offset=0", null)).toBe(true);
  });

  it("lets only the allow list through on /practice", () => {
    expect(REAL_ON_PRACTICE).toEqual(["/me", "/ai/jobs/recent"]);
    expect(isPracticeRequest("/me", PRACTICE_PATH)).toBe(false);
    expect(isPracticeRequest("/ai/jobs/recent", PRACTICE_PATH)).toBe(false);
    expect(isPracticeRequest("/sop/remarks/recent?limit=10", PRACTICE_PATH)).toBe(true);
    expect(isPracticeRequest("/bundles", PRACTICE_PATH)).toBe(true);
  });

  it("decides bundle paths by id alone, so a real bundle's queued writes reach the server from /practice", () => {
    // 실제 Assign에서 글쇠를 누르고 바로 연습으로 오면 큐가 남은 저장을 /practice에서 보낸다 - 가짜로 버리면 운영 판단이 사라진다
    expect(isPracticeRequest("/bundles/5/units", PRACTICE_PATH)).toBe(false);
    expect(isPracticeRequest("/bundles/5/groups/save", PRACTICE_PATH)).toBe(false);
    expect(isPracticeRequest("/bundles/0", PRACTICE_PATH)).toBe(false);
  });

  it("leaves real bundles alone elsewhere", () => {
    expect(isPracticeRequest("/bundles/5/units", "/bundles/5/assign")).toBe(false);
    expect(isPracticeRequest("/sop/remarks/recent", "/bundles/5/assign")).toBe(false);
    // -1로 시작하는 다른 id(-10)는 연습 Bundle이 아니다
    expect(isPracticeRequest("/bundles/-10/units", "/")).toBe(false);
    expect(isPracticeRequest("/me", "/practiced")).toBe(false);
  });

  it("answers the same in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isPracticeRequest("/bundles/-1/groups/save", "/")).toBe(true);
    expect(isPracticeRequest("/sop/remarks/recent", PRACTICE_PATH)).toBe(true);
    expect(isPracticeRequest("/me", PRACTICE_PATH)).toBe(false);
  });
});

describe("isPracticeBundlePath", () => {
  it("matches app addresses under the practice bundle", () => {
    expect(isPracticeBundlePath("/bundles/-1/documents")).toBe(true);
    expect(isPracticeBundlePath("/bundles/-1/assign?doc=900001")).toBe(true);
    expect(isPracticeBundlePath("/bundles/1/documents")).toBe(false);
    expect(isPracticeBundlePath("/practice")).toBe(false);
  });
});

describe("practice modules and the hidden-feature switch", () => {
  it("never import lib/drafting (practice is on in production, D17)", () => {
    const lib = resolve(__dirname);
    const practiceDir = join(lib, "practice");
    const files = [join(lib, "practice-route.ts"), ...readdirSync(practiceDir).filter((name) => /\.tsx?$/.test(name)).map((name) => join(practiceDir, name))];
    const offenders = files.filter((path) => /from\s+["'][^"']*drafting["']/.test(readFileSync(path, "utf8")));
    // Fix: practice must not read isDraftingOn/useDraftingOn - the Assign inside it reads the switch itself
    expect(offenders).toEqual([]);
  });

  it("keeps the practice screen files off lib/drafting too", () => {
    const src = resolve(__dirname, "..");
    const dirs = [join(src, "app", "practice"), join(src, "components", "practice")];
    const files = dirs.flatMap((dir) => readdirSync(dir).filter((name) => /\.tsx?$/.test(name)).map((name) => join(dir, name)));
    const offenders = files.filter((path) => /from\s+["'][^"']*drafting["']/.test(readFileSync(path, "utf8")));
    // Fix: the practice screen must not read isDraftingOn/useDraftingOn - only the Assign inside it does
    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
