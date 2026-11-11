// Assign 보기 설정 - 문서별 확대(Old·New)·두 문서 폭·연결선 켜기를 사람마다 브라우저에 기억한다. 저장소가 막혀 있으면 기본값으로 그린다.
import { clampSplit, clampZoom } from "./assign-model";

export interface AssignView {
  zoomOld: number;
  zoomNew: number;
  /** 왼쪽(Old) 문서 폭 비율 */
  split: number;
  /** 두 문서 사이 연결선을 그린다 */
  lines: boolean;
}

const DEFAULTS: AssignView = { zoomOld: 1, zoomNew: 1, split: 0.5, lines: true };
const KEYS: Record<keyof AssignView, string> = { zoomOld: "sopa.assign.zoomOld", zoomNew: "sopa.assign.zoomNew", split: "sopa.assign.split", lines: "sopa.assign.lines" };

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
  const lines = readNumber(KEYS.lines);
  return {
    zoomOld: zoomOld === null ? DEFAULTS.zoomOld : clampZoom(zoomOld),
    zoomNew: zoomNew === null ? DEFAULTS.zoomNew : clampZoom(zoomNew),
    split: split === null ? DEFAULTS.split : clampSplit(split),
    lines: lines === null ? DEFAULTS.lines : lines !== 0,
  };
}

export function writeAssignView(patch: Partial<AssignView>): void {
  try {
    // 켜기·끄기는 1·0으로 적어 숫자 읽기 하나로 읽는다
    for (const [name, value] of Object.entries(patch) as Array<[keyof AssignView, number | boolean]>) window.localStorage.setItem(KEYS[name], String(Number(value)));
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}
