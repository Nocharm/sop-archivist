// 사람마다 브라우저에 두는 화면 설정 4개와 언어. 값은 <html> data 속성으로 내리고 CSS가 받는다(디자인 문서 7절).
// 서버 레이아웃도 읽는 순수 모듈이다. 읽고 쓰는 훅은 use-ui-pref.ts. 첫 페인트 전에 layout <head>의 부트 스크립트가 속성을 붙여, 저장값이 기본값과 다른 사람에게도 기본 배치가 먼저 보이지 않는다.
import type { Lang } from "@/lib/i18n-messages";

export const UI_PREFS = {
  shell: { key: "sopa.shell", attr: "data-shell", values: ["rail", "bar"], fallback: "rail" },
  classifyLayout: { key: "sopa.classifyLayout", attr: "data-layout", values: ["paper", "list"], fallback: "paper" },
  sourceFontKo: { key: "sopa.sourceFontKo", attr: "data-src-ko", values: ["pretendard", "malgun", "batang"], fallback: "pretendard" },
  sourceFontEn: {
    key: "sopa.sourceFontEn",
    attr: "data-src-en",
    values: ["arial", "pretendard", "times", "calibri"],
    fallback: "arial",
  },
} as const;

export type UiPrefName = keyof typeof UI_PREFS;
export type UiPrefValue<N extends UiPrefName> = (typeof UI_PREFS)[N]["values"][number];

export const LANG_KEY = "sopa.lang";
export const LANGS: readonly Lang[] = ["en", "ko"];
export const DEFAULT_LANG: Lang = "en";

/** 설정이 바뀌면 이 창 안에서 알리는 이벤트 이름(use-ui-pref.ts가 듣는다). */
export const UI_PREFS_CHANGE_EVENT = "sopa:ui-prefs";

/** SSR HTML에 그대로 찍는 기본 속성 - 부트 스크립트가 저장값으로 덮는다. */
export function getDefaultPrefAttrs(): Record<string, string> {
  return Object.fromEntries(Object.values(UI_PREFS).map((pref) => [pref.attr, pref.fallback]));
}

/** layout <head>에 인라인으로 넣는 부트 스크립트. 저장소 접근이 막힌 브라우저에서도 기본값으로 그린다. */
export function buildPrefsBootScript(): string {
  const prefs = Object.values(UI_PREFS).map(({ key, attr, values }) => ({ key, attr, values }));
  const config = JSON.stringify({ prefs, lang: { key: LANG_KEY, values: LANGS } });
  return `(function(){try{var c=${config},d=document.documentElement,s=window.localStorage;c.prefs.forEach(function(p){var v=s.getItem(p.key);if(p.values.indexOf(v)>=0)d.setAttribute(p.attr,v)});var l=s.getItem(c.lang.key);if(c.lang.values.indexOf(l)>=0)d.lang=l}catch(e){}})();`;
}
