// Assign 키보드 그림의 모델 - 글쇠 표(ASSIGN_KEYS)에서 키 한 칸마다 보통 줄 · Shift 줄 · 종류를 뽑는다. 자판의 모양(칸 폭)만 여기 있고 글쇠 목록은 따로 적지 않는다.
import { ASSIGN_KEYS, formatKeyPress, getAssignKeyKind, type AssignKey, type AssignKeyId, type AssignKeyKind } from "@/lib/assign-keymap";

/** 한 줄의 뜻 - labelKey는 `assign.kbd.<id>`(짧은 글) */
export interface MapLabel {
  id: AssignKeyId;
  labelKey: string;
  kind: AssignKeyKind;
}

export interface MapKey {
  /** KeyboardEvent.code - testid `assign-keyboard-map-key-<code>` */
  code: string;
  /** 자판에 찍힌 글 */
  cap: string;
  /** 칸 폭 - 4 = 키 하나(1u). 모든 줄의 합이 ROW_COLS라 줄이 나란하다 */
  width: number;
  plain?: MapLabel;
  shift?: MapLabel;
  /** Ctrl 키 - 함께 누르는 글쇠("← → Z ⇧Z"), 표에서 뽑는다 */
  combo?: string;
  /** 색 - 보통 줄의 종류, 없으면 Shift 줄의 종류. 쓰지 않는 키는 null */
  kind: AssignKeyKind | null;
}

/** 자판 한 칸의 틀 - key는 표의 key 글자(event.key 소문자), shiftKey는 Shift를 누르면 표에서 이 글자가 되는 키(/ → ?) */
interface Cap {
  code: string;
  cap: string;
  key?: string;
  shiftKey?: string;
  width: number;
}

/** 아무 키도 없는 빈 칸 - 모양을 맞추는 자리 */
export const GAP_CODE = "Gap";
/** 한 줄의 칸 수 - 본판 15u(60) + 사이 2 + 화살표 묶음 3u(12) */
export const ROW_COLS = 74;
const U = 4;
const key = (code: string, cap: string, k: string, width = U, shiftKey?: string): Cap => ({ code, cap, key: k, width, shiftKey });
const letters = (chars: string): Cap[] => [...chars].map((char) => key(`Key${char}`, char, char.toLowerCase()));
const digits = (chars: string): Cap[] => [...chars].map((char) => key(`Digit${char}`, char, char));
const plainCap = (code: string, cap: string, width: number): Cap => ({ code, cap, width });
const gap = (width: number): Cap => plainCap(GAP_CODE, "", width);

const LAYOUT: readonly (readonly Cap[])[] = [
  [key("Escape", "Esc", "escape"), gap(ROW_COLS - U)],
  [key("Backquote", "`", "`"), ...digits("1234567890"), plainCap("Minus", "-", U), plainCap("Equal", "=", U), key("Backspace", "⌫", "backspace", 2 * U), gap(14)],
  [key("Tab", "Tab", "tab", 1.5 * U), ...letters("QWERTYUIOP"), plainCap("BracketLeft", "[", U), plainCap("BracketRight", "]", U), plainCap("Backslash", "\\", 1.5 * U), gap(14)],
  [plainCap("CapsLock", "Caps", 1.75 * U), ...letters("ASDFGHJKL"), plainCap("Semicolon", ";", U), plainCap("Quote", "'", U), key("Enter", "↵", "enter", 2.25 * U), gap(14)],
  [plainCap("ShiftLeft", "⇧", 2.25 * U), ...letters("ZXCVBNM"), plainCap("Comma", ",", U), plainCap("Period", ".", U), key("Slash", "/", "/", U, "?"), plainCap("ShiftRight", "⇧", 2.75 * U), gap(6), key("ArrowUp", "↑", "arrowup"), gap(4)],
  [
    plainCap("ControlLeft", "Ctrl", 9),
    plainCap("MetaLeft", "Win", 6),
    plainCap("AltLeft", "Alt", 6),
    key("Space", "Space", " ", 24),
    plainCap("AltRight", "Alt", 6),
    plainCap("ControlRight", "Ctrl", 9),
    gap(2),
    key("ArrowLeft", "←", "arrowleft"),
    key("ArrowDown", "↓", "arrowdown"),
    key("ArrowRight", "→", "arrowright"),
  ],
];

function toLabel(entry: AssignKey | undefined): MapLabel | undefined {
  return entry && { id: entry.id, labelKey: `assign.kbd.${entry.id}`, kind: getAssignKeyKind(entry.id) };
}

/** Ctrl 조합의 글쇠 - "Ctrl+" 앞머리를 뗀 "← → Z ⇧Z" */
function readCtrlCombo(): string {
  return ASSIGN_KEYS.filter((entry) => entry.key.startsWith("ctrl+"))
    .map((entry) => formatKeyPress(entry).slice("Ctrl+".length))
    .join(" ");
}

export function buildKeyboardMap(): MapKey[][] {
  const combo = readCtrlCombo();
  return LAYOUT.map((row) =>
    row.map(({ code, cap, key: name, shiftKey, width }) => {
      // 물음표 키(/)는 Shift 줄에만 있다 - 표에 "?"로 적힌 글쇠
      const find = (isShift: boolean) =>
        name === undefined ? undefined : ASSIGN_KEYS.find((entry) => (shiftKey ? isShift && entry.key === shiftKey : entry.key === name && entry.shift === isShift));
      const plain = toLabel(find(false));
      const shift = toLabel(find(true));
      const isCtrl = code === "ControlLeft";
      return { code, cap, width, plain, shift, combo: isCtrl ? combo : undefined, kind: isCtrl ? "free" : (plain ?? shift)?.kind ?? null };
    }),
  );
}

/** 눌린 물리 키(KeyboardEvent.code) → 그림의 키 - Backquote(한글 입력의 ₩)도 같다. 그림에 없는 키(F1, 숫자패드 …)는 undefined */
export function findMapKey(code: string): MapKey | undefined {
  return KEY_BY_CODE.get(code);
}

/** Shift를 누른 동안 ⇧ 줄을 보이는 키인가 */
export function isShiftCode(code: string): boolean {
  return code === "ShiftLeft" || code === "ShiftRight";
}

/** 누르는 순간 반짝일 키인가 - 지금 층(Shift 여부)의 줄이 있거나 Ctrl(조합이 있다) */
export function shouldFlashKey(key: MapKey, isShift: boolean): boolean {
  return key.combo !== undefined || (isShift ? key.shift : key.plain) !== undefined;
}

const KEY_BY_CODE = new Map(buildKeyboardMap().flat().filter((item) => item.code !== GAP_CODE).map((item) => [item.code, item]));
