// 새 문서를 만드는 쪽(순서 화면 · 칸 배정 · 번호로 더하기 · 결과물 C · 칸 추천 등)을 보일지 - 쪼개기 먼저 설계 §5 H1.
// 코드는 지우지 않고 이 값 하나로 숨긴다. 개발에서만 브라우저 저장으로 켜서 숨긴 기능의 스모크를 계속 돌린다.
"use client";

import { useSyncExternalStore } from "react";

export const DRAFTING_KEY = "sopa.drafting";

/** 숨긴 기능을 켤지 - 운영 빌드는 늘 false, 개발은 브라우저 저장 sopa.drafting이 "1"일 때만 */
export function isDraftingOn(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return window.localStorage.getItem(DRAFTING_KEY) === "1";
  } catch {
    return false; // 저장소가 막힌 브라우저 - 숨긴 채로 둔다
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** 화면에서 읽는 값. 서버 렌더와 하이드레이션 중에는 null(모름) - 쓰는 곳은 `=== true`로 읽는다 */
export function useDraftingOn(): boolean | null {
  return useSyncExternalStore(subscribe, isDraftingOn, () => null);
}
