// 설명서 조각의 읽음 표시를 이 브라우저에 기억한다(조각 id → 읽었을 때의 지문). 사람마다의 편의라 서버에 두지 않고, 저장이 막혀도 이번 탭에서는 유지한다.
"use client";

import { useSyncExternalStore } from "react";

import type { ReadMarks } from "./manual";

const KEY = "sopa.manual.read";
const CHANGE_EVENT = "sopa:manual-read";
const EMPTY: ReadMarks = {};

// 이 탭에서 바꾼 값 - 저장이 막힌 브라우저에서도 표시가 유지된다. 다른 탭이 바꾸면 비우고 다시 읽는다
let memory: ReadMarks | null = null;
// useSyncExternalStore는 같은 값에 같은 객체를 돌려줘야 한다 - 저장 글자가 같으면 풀어 둔 객체를 다시 쓴다
let cachedRaw: string | null = null;
let cachedMarks: ReadMarks = EMPTY;

/** 저장 글자를 표시로 푼다 - 모양이 다르면(손으로 고친 값 등) 버리고 빈 표시로 본다 */
export function parseManualMarks(raw: string | null): ReadMarks {
  if (!raw) return EMPTY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY;
  const marks: Record<string, string> = {};
  for (const [id, hash] of Object.entries(value)) {
    if (typeof hash === "string") marks[id] = hash;
  }
  return marks;
}

export function readManualMarks(): ReadMarks {
  if (memory) return memory;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMarks = parseManualMarks(raw);
  }
  return cachedMarks;
}

/** 조각 하나를 읽음으로 적거나(지문) 지운다(null) */
export function setManualMark(sectionId: string, hash: string | null): void {
  const next: Record<string, string> = { ...readManualMarks() };
  if (hash === null) delete next[sectionId];
  else next[sectionId] = hash;
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("manual read mark not saved", err);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== KEY) return;
    memory = null;
    onChange();
  }
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/** 서버 렌더와 하이드레이션 중에는 빈 표시(전부 Unread), 그 뒤 저장값을 따른다 */
export function useManualMarks(): ReadMarks {
  return useSyncExternalStore(subscribe, readManualMarks, () => EMPTY);
}
