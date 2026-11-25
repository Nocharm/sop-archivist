// Outputs 보기 설정 - 마지막으로 본 탭(A·B·C)과 Order의 기본 | 템플릿 보기를 브라우저에 기억한다. 결과물은 한 벌이라 판(언어)은 기억하지 않는다. 저장소가 막혀 있으면 기본값으로 그린다.
export type OutputsTab = "a" | "b" | "c";

export interface OutputsView {
  tab: OutputsTab;
}

const DEFAULTS: OutputsView = { tab: "c" };
const KEYS: Record<keyof OutputsView, string> = { tab: "sopa.outputs.tab" };

const TABS: readonly OutputsTab[] = ["a", "b", "c"];

/** 보이는 탭 - 새 문서를 만드는 쪽을 숨긴 동안 C · New documents는 없다 */
export function listOutputsTabs(drafting: boolean): readonly OutputsTab[] {
  return drafting ? TABS : TABS.filter((tab) => tab !== "c");
}

/** 지금 그릴 탭 - 기억한 탭이 숨긴 C면 B(흐름). 기억한 값은 그대로 둔다 */
export function resolveOutputsTab(tab: OutputsTab, drafting: boolean): OutputsTab {
  return listOutputsTabs(drafting).includes(tab) ? tab : "b";
}

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
  return { tab: tab === "a" || tab === "b" || tab === "c" ? tab : DEFAULTS.tab };
}

export function writeOutputsView(patch: Partial<OutputsView>): void {
  try {
    for (const [name, value] of Object.entries(patch) as Array<[keyof OutputsView, string]>) window.localStorage.setItem(KEYS[name], value);
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}

const ORDER_TEMPLATE_KEY = "sopa.order.template";

/** Order 문서 머리의 기본 | 템플릿 - 처음에는 기본 보기. 템플릿은 보기만 하는 화면이라 켜 둔 채 다시 열어도 편집이 막힐 뿐 자료는 그대로다 */
export function readOrderTemplate(): boolean {
  return readValue(ORDER_TEMPLATE_KEY) === "1";
}

export function writeOrderTemplate(on: boolean): void {
  try {
    window.localStorage.setItem(ORDER_TEMPLATE_KEY, on ? "1" : "0");
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}
