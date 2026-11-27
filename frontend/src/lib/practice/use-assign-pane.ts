// 연습 틀이 읽는 Assign의 지금 보기(한 단 · 양 단) - Assign 부품을 고치지 않고 용지 칸의 data-single(page.tsx .assign-panes)을 지켜본다.
// Assign은 V 말고도 저절로 보기를 바꾼다(잇기 상대 기다리기 · New 문장으로 가기는 양 단으로 편다) - 그래서 손짓이 아니라 그려진 칸을 읽는다.
"use client";

import { useSyncExternalStore } from "react";

import type { PaneView } from "./practice-server";

const PANES_SELECTOR = ".practice-main .assign-panes";

/** 용지 칸이 아직 없거나(읽는 중) Pair view면 null - 말풍선은 그동안 보기를 따지지 않는다 */
export function readAssignPane(): PaneView | null {
  const panes = document.querySelector(PANES_SELECTOR);
  if (panes === null || panes.hasAttribute("data-pair-view")) return null;
  return panes.hasAttribute("data-single") ? "one" : "two";
}

function readServerPane(): PaneView | null {
  return null;
}

/** 칸이 새로 그려지거나(childList) 보기 표시가 바뀔 때 다시 읽는다 - 값이 같으면 React가 다시 그리지 않는다 */
function subscribeAssignPane(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-single", "data-pair-view"] });
  return () => observer.disconnect();
}

export function useAssignPane(): PaneView | null {
  return useSyncExternalStore(subscribeAssignPane, readAssignPane, readServerPane);
}
