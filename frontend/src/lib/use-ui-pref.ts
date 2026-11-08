// 화면 설정·언어를 읽고 쓰는 클라이언트 훅. 값은 <html> 속성이 기준이고 localStorage는 다음 방문의 부트 스크립트용이다.
"use client";

import { useSyncExternalStore } from "react";

import type { Lang } from "@/lib/i18n-messages";
import { DEFAULT_LANG, LANG_KEY, UI_PREFS, UI_PREFS_CHANGE_EVENT, type UiPrefName, type UiPrefValue } from "@/lib/ui-prefs";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(UI_PREFS_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(UI_PREFS_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readAttr<N extends UiPrefName>(name: N): UiPrefValue<N> {
  const pref = UI_PREFS[name];
  const value = document.documentElement.getAttribute(pref.attr);
  return (pref.values as readonly string[]).includes(value ?? "") ? (value as UiPrefValue<N>) : pref.fallback;
}

/** 설정 값을 읽는다. 서버 렌더와 하이드레이션 중에는 기본값이고, 그 뒤 <html> 속성을 따른다. */
export function useUiPref<N extends UiPrefName>(name: N): UiPrefValue<N> {
  return useSyncExternalStore(
    subscribe,
    () => readAttr(name),
    () => UI_PREFS[name].fallback,
  );
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // 사생활 보호 모드 등 저장이 막힌 브라우저 - 이번 탭에서만 바뀐 값으로 동작한다
    console.warn(`ui pref not saved: ${key}`, err);
  }
}

export function setUiPref<N extends UiPrefName>(name: N, value: UiPrefValue<N>): void {
  const pref = UI_PREFS[name];
  document.documentElement.setAttribute(pref.attr, value);
  writeStorage(pref.key, value);
  window.dispatchEvent(new Event(UI_PREFS_CHANGE_EVENT));
}

function readLang(): Lang {
  return document.documentElement.lang === "ko" ? "ko" : "en";
}

export function useLangPref(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => DEFAULT_LANG);
}

export function setLangPref(lang: Lang): void {
  document.documentElement.lang = lang;
  writeStorage(LANG_KEY, lang);
  window.dispatchEvent(new Event(UI_PREFS_CHANGE_EVENT));
}
