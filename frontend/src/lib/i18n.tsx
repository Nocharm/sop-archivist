// 앱 전체 i18n — LangProvider + useI18n + t(key, vars). 기본 영어, 한국어 전환, localStorage 영속.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { MESSAGES, type Lang } from "@/lib/i18n-messages";

const STORAGE_KEY = "sopa.lang";
const DEFAULT_LANG: Lang = "en";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** 문구의 {변수}를 값으로 바꾼다. */
export function interpolateMessage(template: string, vars?: Record<string, string | number>): string {
  let str = template;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // 함수 치환 - 문자열 치환은 값의 $&·$'·$$를 패턴으로 읽는다
      str = str.replaceAll(`{${k}}`, () => String(v));
    }
  }
  return str;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // localStorage는 클라이언트 전용 — 마운트 후 복원해 초기 SSR 렌더(기본 언어)와 일치시킴
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLangState(saved); // intentional: one-time hydration restore from localStorage
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const t = (key: string, vars?: Record<string, string | number>) =>
    interpolateMessage(MESSAGES[lang][key] ?? key, vars);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LangProvider");
  }
  return ctx;
}
