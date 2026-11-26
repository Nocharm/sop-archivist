// Assign 키보드 그림의 모델 - 글쇠 표(ASSIGN_KEYS)에서 키 한 칸마다 Shift 줄 · 보통 줄 · 종류를 뽑는다. 자판의 모양(칸 폭)만 여기 있고 글쇠 목록은 따로 적지 않는다.
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
  /** 칸 폭 - 4 = 키 하나(1u). 한 줄의 합은 모두 60(15u)이라 줄이 나란하다 */
  width: number;
  shift?: MapLabel;
  plain?: MapLabel;
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

/** 아무 키도 없는 빈 칸(화살표 묶음 앞) */
export const GAP_CODE = "Gap";
const U = 4;
const key = (code: string, cap: string, k: string, width = U, shiftKey?: string): Cap => ({ code, cap, key: k, width, shiftKey });
const letter = (char: string): Cap => key(`Key${char}`, char, char.toLowerCase());
const letters = (chars: string): Cap[] => [...chars].map(letter);
const digits = (chars: string): Cap[] => [...chars].map((char) => key(`Digit${char}`, char, char));
const plainCap = (code: string, cap: string, width: number): Cap => ({ code, cap, width });

const LAYOUT: readonly (readonly Cap[])[] = [
  [key("Backquote", "`", "`"), ...digits("1234567890"), plainCap("Minus", "-", U), plainCap("Equal", "=", U), key("Backspace", "⌫", "backspace", 2 * U)],
  [key("Tab", "Tab", "tab", 1.5 * U), ...letters("QWERTYUIOP"), plainCap("BracketLeft", "[", U), plainCap("BracketRight", "]", U), plainCap("Backslash", "\\", 1.5 * U)],
  [plainCap("CapsLock", "Caps", 1.75 * U), ...letters("ASDFGHJKL"), plainCap("Semicolon", ";", U), plainCap("Quote", "'", U), key("Enter", "↵", "enter", 2.25 * U)],
  [plainCap("ShiftLeft", "⇧", 2.25 * U), ...letters("ZXCVBNM"), plainCap("Comma", ",", U), plainCap("Period", ".", U), key("Slash", "/", "/", U, "?"), key("ArrowUp", "↑", "arrowup"), plainCap("ShiftRight", "⇧", 1.75 * U)],
  [plainCap("ControlLeft", "Ctrl", 1.5 * U), plainCap("AltLeft", "Alt", 1.5 * U), key("Space", "Space", " ", 6 * U), key("Escape", "Esc", "escape", 1.5 * U), plainCap(GAP_CODE, "", 1.5 * U), key("ArrowLeft", "←", "arrowleft"), key("ArrowDown", "↓", "arrowdown"), key("ArrowRight", "→", "arrowright")],
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
