// 연습 화면 요청 판정(설계 2026-11-26-practice-page D2 · D3) - api.ts가 fetch 앞에서 부르고 nav-buffer가 이동 앞에서 부른다.
// 모든 화면 덩이에 실리니 무거운 import를 두지 않는다(가짜 서버 · 자료는 api.ts가 동적 import로 따로 싣는다).

export const PRACTICE_PATH = "/practice";
/** 연습 Bundle id - 실제 id는 1부터 오르는 양수라 겹치지 않는다 */
export const PRACTICE_BUNDLE_ID = -1;
/** /practice에서도 실제 서버로 보내는 경로 - 신원과 상단 바 AI 작업 폴러, 둘 다 읽기만이고 SOP 자료가 아니다. 새는 길은 여기 적은 것만 */
export const REAL_ON_PRACTICE: readonly string[] = ["/me", "/ai/jobs/recent"];

const PRACTICE_BUNDLE_ROOT = `/bundles/${PRACTICE_BUNDLE_ID}`;

function stripQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return cut < 0 ? path : path.slice(0, cut);
}

/** 연습 Bundle 아래 경로(API 경로 · 앱 주소 둘 다 `/bundles/-1…` 꼴) */
export function isPracticeBundlePath(path: string): boolean {
  const bare = stripQuery(path);
  return bare === PRACTICE_BUNDLE_ROOT || bare.startsWith(`${PRACTICE_BUNDLE_ROOT}/`);
}

function isPracticePage(pathname: string | null): boolean {
  return pathname === PRACTICE_PATH || (pathname?.startsWith(`${PRACTICE_PATH}/`) ?? false);
}

const BUNDLE_PATH = /^\/bundles\/(-?\d+)(?:\/|$)/;

/**
 * 가짜 서버가 받을 요청인가 - ① Bundle 경로(`/bundles/<id>…`)는 id로만 정한다: -1이면 화면 주소와 상관없이 늘 가짜(떠난 뒤 명령 큐가
 * 마저 보내는 쓰기도), 실제 id면 /practice에서도 실제 서버(실제 Assign에서 바로 연습으로 와도 큐가 남은 판단을 잃지 않는다).
 * ② Bundle 밖 경로는 화면이 /practice일 때 REAL_ON_PRACTICE 밖 모두 가짜(앞으로 생길 경로를 기본으로 막는다).
 */
export function isPracticeRequest(path: string, pathname: string | null): boolean {
  const bare = stripQuery(path);
  const bundle = BUNDLE_PATH.exec(bare);
  if (bundle) return Number(bundle[1]) === PRACTICE_BUNDLE_ID;
  return isPracticePage(pathname) && !REAL_ON_PRACTICE.includes(bare);
}

/** 지금 화면 주소 - 서버 렌더에는 창이 없어 null */
export function readPathname(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname;
}
