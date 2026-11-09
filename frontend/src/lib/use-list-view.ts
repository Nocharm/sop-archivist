// 목록 보기(표·카드)를 목록마다 이 브라우저에 기억한다. 사람마다의 편의 설정이라 서버에 두지 않고, 저장이 막혀도 이번 탭에서는 바뀐 값으로 돈다.
"use client";

import { useSyncExternalStore } from "react";

export type ListView = "table" | "cards";

const KEY_PREFIX = "sopa.listView.";
const CHANGE_EVENT = "sopa:list-view";
// 저장이 막힌 브라우저에서도 이번 탭 안에서는 고른 보기를 유지한다
const memory = new Map<string, ListView>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readListView(listKey: string): ListView {
  const remembered = memory.get(listKey);
  if (remembered) return remembered;
  try {
    return window.localStorage.getItem(KEY_PREFIX + listKey) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

export function setListView(listKey: string, view: ListView): void {
  memory.set(listKey, view);
  try {
    window.localStorage.setItem(KEY_PREFIX + listKey, view);
  } catch (err) {
    console.warn(`list view not saved: ${listKey}`, err);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 서버 렌더와 하이드레이션 중에는 표, 그 뒤 저장값을 따른다 */
export function useListView(listKey: string): ListView {
  return useSyncExternalStore(
    subscribe,
    () => readListView(listKey),
    () => "table",
  );
}
