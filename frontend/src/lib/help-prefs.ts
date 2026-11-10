// 도움말 패널(쪼개기 왼쪽 아래·Assign 오른쪽 아래)의 접힘·탭을 화면별로 이 브라우저에 기억한다. 저장이 막혀도 이번 탭에서는 바뀐 값으로 돈다.
"use client";

import { useSyncExternalStore } from "react";

export type HelpScreen = "split" | "assign";
export type HelpTab = "keys" | "marks";

export interface HelpPrefs {
  isOpen: boolean;
  tab: HelpTab;
}

// split 키는 패널이 쪼개기에만 있던 때의 이름 그대로 - 이미 접어 둔 사용자의 기억을 잇는다
// Assign는 인스펙터 아래 칸이라 처음엔 접어 둔다(펼치면 조작 칸이 눌린다). 쪼개기는 왼쪽 열 아래라 펼쳐 둔다
const DEFAULT_OPEN: Record<HelpScreen, boolean> = { split: true, assign: false };
const CHANGE_EVENT = "sopa:help";
const memory = new Map<string, string>();

function openKey(screen: HelpScreen): string {
  return `sopa.${screen}.helpOpen`;
}

function tabKey(screen: HelpScreen): string {
  return `sopa.${screen}.helpTab`;
}

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
    console.warn(`help pref not saved: ${key}`, err);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore는 같은 값이면 같은 참조를 바란다 - 글자 한 줄로 읽고 화면에서 푼다
function readSnapshot(screen: HelpScreen): string {
  const stored = readValue(openKey(screen));
  const isOpen = stored === null ? DEFAULT_OPEN[screen] : stored !== "0";
  return `${isOpen ? "1" : "0"}:${readValue(tabKey(screen)) === "marks" ? "marks" : "keys"}`;
}

export function setHelpOpen(screen: HelpScreen, isOpen: boolean): void {
  writeValue(openKey(screen), isOpen ? "1" : "0");
}

export function setHelpTab(screen: HelpScreen, tab: HelpTab): void {
  writeValue(tabKey(screen), tab);
}

/** 서버 그림과 첫 그림은 화면 기본값(단축키 탭) */
export function useHelpPrefs(screen: HelpScreen): HelpPrefs {
  const snapshot = useSyncExternalStore(subscribe, () => readSnapshot(screen), () => `${DEFAULT_OPEN[screen] ? "1" : "0"}:keys`);
  return { isOpen: snapshot.startsWith("1"), tab: snapshot.endsWith("marks") ? "marks" : "keys" };
}
