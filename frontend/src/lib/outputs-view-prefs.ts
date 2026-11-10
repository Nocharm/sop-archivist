// Outputs 보기 설정 - 마지막으로 본 탭(A·B·C)과 결과물 언어를 브라우저에 기억한다. 저장소가 막혀 있으면 기본값으로 그린다.
import type { OutputLang } from "./api-sop";

export type OutputsTab = "a" | "b" | "c";

export interface OutputsView {
  tab: OutputsTab;
  lang: OutputLang;
}

const DEFAULTS: OutputsView = { tab: "c", lang: "ko" };
const KEYS: Record<keyof OutputsView, string> = { tab: "sopa.outputs.tab", lang: "sopa.outputs.lang" };

function readValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // 개인 창·막힌 사이트 데이터 - 기억 없이 기본값으로 그린다
    return null;
  }
}

export function readOutputsView(): OutputsView {
  const tab = readValue(KEYS.tab);
  const lang = readValue(KEYS.lang);
  return {
    tab: tab === "a" || tab === "b" || tab === "c" ? tab : DEFAULTS.tab,
    lang: lang === "ko" || lang === "en" ? lang : DEFAULTS.lang,
  };
}

export function writeOutputsView(patch: Partial<OutputsView>): void {
  try {
    for (const [name, value] of Object.entries(patch) as Array<[keyof OutputsView, string]>) window.localStorage.setItem(KEYS[name], value);
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}
