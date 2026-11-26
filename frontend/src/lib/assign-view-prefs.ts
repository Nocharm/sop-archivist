// Assign 보기 설정 - 문서별 확대(Old·New)·두 문서 폭·연결선 켜기·한 단 보기·New 쪽 AI 제안 거르기 · New 칸 템플릿 보기 · 뗀 오른쪽 칸(자리 · 접힘) · Space 미리보기를 연 횟수를 사람마다 브라우저에 기억한다. 저장소가 막혀 있으면 기본값으로 그린다.
import { clampSplit, clampZoom } from "./assign-model";
import { clampSheetHeight, SHEET_HEIGHT_DEFAULT } from "./space-preview-model";

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
  /** 아직 안 쓴 New 문서를 회사 템플릿 모양으로 본다(기본 | 템플릿) - 처음에는 기본 보기 */
  newTemplate: boolean;
  /** 오른쪽 칸을 떼었다 - 창이 좁을 때만 뜬다(side-float-model) */
  sideFloat: boolean;
  /** 뗀 판의 왼쪽 위 자리(px) - 끌어 옮긴 적이 없으면 null(오른쪽 아래) */
  sideX: number | null;
  sideY: number | null;
  /** 뗀 판을 머리 한 줄로 접었다 */
  sideFolded: boolean;
}

const DEFAULTS: AssignView = { zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false, newTemplate: false, sideFloat: false, sideX: null, sideY: null, sideFolded: false };
const KEYS: Record<keyof AssignView, string> = { zoomOld: "sopa.assign.zoomOld", zoomNew: "sopa.assign.zoomNew", split: "sopa.assign.split", lines: "sopa.assign.lines", single: "sopa.assign.single", newAiOnly: "sopa.assign.newAiOnly", newTemplate: "sopa.assign.newTemplate", sideFloat: "sopa.assign.sideFloat", sideX: "sopa.assign.sideX", sideY: "sopa.assign.sideY", sideFolded: "sopa.assign.sideFolded" };

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
  const newTemplate = readNumber(KEYS.newTemplate);
  const sideFloat = readNumber(KEYS.sideFloat);
  const sideFolded = readNumber(KEYS.sideFolded);
  return {
    zoomOld: zoomOld === null ? DEFAULTS.zoomOld : clampZoom(zoomOld),
    zoomNew: zoomNew === null ? DEFAULTS.zoomNew : clampZoom(zoomNew),
    split: split === null ? DEFAULTS.split : clampSplit(split),
    lines: lines === null ? DEFAULTS.lines : lines !== 0,
    single: single === null ? DEFAULTS.single : single !== 0,
    newAiOnly: newAiOnly === null ? DEFAULTS.newAiOnly : newAiOnly !== 0,
    newTemplate: newTemplate === null ? DEFAULTS.newTemplate : newTemplate !== 0,
    sideFloat: sideFloat === null ? DEFAULTS.sideFloat : sideFloat !== 0,
    // 자리는 읽은 값 그대로 - 그릴 때마다 지금 창 안으로 가둔다(clampFloat)
    sideX: readNumber(KEYS.sideX),
    sideY: readNumber(KEYS.sideY),
    sideFolded: sideFolded === null ? DEFAULTS.sideFolded : sideFolded !== 0,
  };
}

export function writeAssignView(patch: Partial<AssignView>): void {
  try {
    // 켜기·끄기는 1·0으로 적어 숫자 읽기 하나로 읽는다. 없는 값(null)은 적지 않는다
    for (const [name, value] of Object.entries(patch) as Array<[keyof AssignView, number | boolean | null]>) if (value !== null) window.localStorage.setItem(KEYS[name], String(Number(value)));
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

const SPACE_HEIGHT_KEY = "sopa.assign.spaceHeight";

/** Space 미리보기 시트 높이 비율 - 끌어 바꾼 값을 기억한다. 없거나 이상하면 기본값, 한계 밖이면 한계로 */
export function readSpaceSheetHeight(): number {
  const stored = readNumber(SPACE_HEIGHT_KEY);
  return stored === null ? SHEET_HEIGHT_DEFAULT : clampSheetHeight(stored);
}

export function writeSpaceSheetHeight(ratio: number): void {
  try {
    window.localStorage.setItem(SPACE_HEIGHT_KEY, String(ratio));
  } catch {
    // 기억하지 못하면 다음에 기본 높이로 열릴 뿐이다
  }
}
