// 앱 전체 i18n — LangProvider + useI18n + t(key, vars). 기본 영어, 한국어 전환. 저장·복원은 ui-prefs가 맡는다.
"use client";

import { createContext, useContext, type ReactNode } from "react";

import { MESSAGES, type Lang } from "@/lib/i18n-messages";
import { setLangPref, useLangPref } from "@/lib/use-ui-pref";

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
  // 언어는 첫 페인트 전 부트 스크립트가 <html lang>에 붙인다 - 마운트 뒤 복원하면 첫 화면이 영어로 튄다
  const lang = useLangPref();
  const setLang = (next: Lang) => setLangPref(next);

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
