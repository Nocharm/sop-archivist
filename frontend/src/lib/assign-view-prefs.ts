// Assign 보기 설정 - 문서별 확대(Old·New)·두 문서 폭·연결선 켜기·한 단 보기·New 쪽 AI 제안 거르기 · Space 미리보기를 연 횟수를 사람마다 브라우저에 기억한다. 저장소가 막혀 있으면 기본값으로 그린다.
import { clampSplit, clampZoom } from "./assign-model";

export interface AssignView {
  zoomOld: number;
  zoomNew: number;
  /** 왼쪽(Old) 문서 폭 비율 */
  split: number;
  /** 두 문서 사이 연결선을 그린다 */
  lines: boolean;
  /** 한 단 보기 - Old 문서 하나만 넓게 본다(New 칸과 연결선을 접는다) */
  single: boolean;
  /** New 칸에 고른 줄의 AI 제안만 남긴다 - 처음에는 꺼져 있다 */
  newAiOnly: boolean;
}

const DEFAULTS: AssignView = { zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false };
const KEYS: Record<keyof AssignView, string> = { zoomOld: "sopa.assign.zoomOld", zoomNew: "sopa.assign.zoomNew", split: "sopa.assign.split", lines: "sopa.assign.lines", single: "sopa.assign.single", newAiOnly: "sopa.assign.newAiOnly" };

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
  const single = readNumber(KEYS.single);
  const newAiOnly = readNumber(KEYS.newAiOnly);
  return {
    zoomOld: zoomOld === null ? DEFAULTS.zoomOld : clampZoom(zoomOld),
    zoomNew: zoomNew === null ? DEFAULTS.zoomNew : clampZoom(zoomNew),
    split: split === null ? DEFAULTS.split : clampSplit(split),
    lines: lines === null ? DEFAULTS.lines : lines !== 0,
    single: single === null ? DEFAULTS.single : single !== 0,
    newAiOnly: newAiOnly === null ? DEFAULTS.newAiOnly : newAiOnly !== 0,
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

const SPACE_OPENS_KEY = "sopa.assign.spacePreviewOpens";

/** Space 미리보기를 연 횟수 - 닫혀 있을 때의 작은 안내를 처음 몇 번만 보이는 데 쓴다 */
export function readSpacePreviewOpens(): number {
  return Math.max(readNumber(SPACE_OPENS_KEY) ?? 0, 0);
}

export function writeSpacePreviewOpens(count: number): void {
  try {
    window.localStorage.setItem(SPACE_OPENS_KEY, String(count));
  } catch {
    // 기억하지 못하면 다음에도 안내가 보일 뿐이다
  }
}
