// Assign 보기 설정 - 문서별 확대(Old·New)와 두 문서 폭을 사람마다 브라우저에 기억한다. 저장소가 막혀 있으면 기본값으로 그린다.
import { clampSplit, clampZoom } from "./assign-model";

export interface AssignView {
  zoomOld: number;
  zoomNew: number;
  /** 왼쪽(Old) 문서 폭 비율 */
  split: number;
}

const DEFAULTS: AssignView = { zoomOld: 1, zoomNew: 1, split: 0.5 };
const KEYS: Record<keyof AssignView, string> = { zoomOld: "sopa.assign.zoomOld", zoomNew: "sopa.assign.zoomNew", split: "sopa.assign.split" };

function readNumber(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key) ?? "");
    return window.localStorage.getItem(key) !== null && Number.isFinite(value) ? value : null;
  } catch {
    // 개인 창·막힌 사이트 데이터 - 기억 없이 기본값으로 그린다
    return null;
  }
}

export function readAssignView(): AssignView {
  const zoomOld = readNumber(KEYS.zoomOld);
  const zoomNew = readNumber(KEYS.zoomNew);
  const split = readNumber(KEYS.split);
  return {
    zoomOld: zoomOld === null ? DEFAULTS.zoomOld : clampZoom(zoomOld),
    zoomNew: zoomNew === null ? DEFAULTS.zoomNew : clampZoom(zoomNew),
    split: split === null ? DEFAULTS.split : clampSplit(split),
  };
}

export function writeAssignView(patch: Partial<AssignView>): void {
  try {
    for (const [name, value] of Object.entries(patch) as Array<[keyof AssignView, number]>) window.localStorage.setItem(KEYS[name], String(value));
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}
