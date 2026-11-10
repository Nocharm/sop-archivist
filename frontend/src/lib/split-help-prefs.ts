// 쪼개기 화면 왼쪽 아래 도움말 패널의 접힘·탭을 이 브라우저에 기억한다. 저장이 막혀도 이번 탭에서는 바뀐 값으로 돈다.
"use client";

import { useSyncExternalStore } from "react";

export type SplitHelpTab = "keys" | "marks";

export interface SplitHelpPrefs {
  isOpen: boolean;
  tab: SplitHelpTab;
}

const OPEN_KEY = "sopa.split.helpOpen";
const TAB_KEY = "sopa.split.helpTab";
const CHANGE_EVENT = "sopa:split-help";
const memory = new Map<string, string>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readValue(key: string): string | null {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`split help pref not saved: ${key}`, err);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore는 같은 값이면 같은 참조를 바란다 - 글자 한 줄로 읽고 화면에서 푼다
function readSnapshot(): string {
  return `${readValue(OPEN_KEY) === "0" ? "0" : "1"}:${readValue(TAB_KEY) === "marks" ? "marks" : "keys"}`;
}

export function setSplitHelpOpen(isOpen: boolean): void {
  writeValue(OPEN_KEY, isOpen ? "1" : "0");
}

export function setSplitHelpTab(tab: SplitHelpTab): void {
  writeValue(TAB_KEY, tab);
}

/** 서버 그림과 첫 그림은 펼친 단축키 탭 */
export function useSplitHelpPrefs(): SplitHelpPrefs {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => "1:keys");
  return { isOpen: snapshot.startsWith("1"), tab: snapshot.endsWith("marks") ? "marks" : "keys" };
}
