// Assign 글쇠 목록 하나 - 키 처리 · 도움말 · 단추의 글쇠 표시 · 설명서 대조 시험이 함께 읽는다(명세 2026-11-23-assign-feedback-2 B2).
// 이동은 글자 하나, 바꾸는 일은 Shift. 글쇠를 더하면 이 표에 줄만 더한다.

export type AssignKeyId =
  | "move_next" | "move_prev" | "confirm" | "escape" | "delete" | "clear" | "clear_block" | "remark" | "remark_block"
  | "split" | "cut_left" | "cut_right" | "view" | "preview" | "go_pair"
  | "hold" | "lang" | "shape_mode" | "number" | "use_ai" | "ask_order" | "table" | "indent" | "outdent"
  | "part_prev" | "part_next" | "undo" | "redo" | "help";

/** 그 글쇠가 바라는 것 - 어긋나면 resolveAssignKey가 까닭을 준다 */
export type AssignKeyWhen = "always" | "row" | "cut" | "pair" | "text" | "shape" | "number" | "ai" | "unwrapped" | "table" | "box";

export interface AssignKey {
  id: AssignKeyId;
  /** event.key 소문자 - Ctrl(⌘) 조합은 "ctrl+" 앞머리. 같은 일의 글쇠는 같은 id로 줄을 나눈다 */
  key: string;
  shift: boolean;
  when: AssignKeyWhen;
  labelKey: string;
}

export const ASSIGN_KEYS: readonly AssignKey[] = [
  { id: "move_next", key: "j", shift: false, when: "always", labelKey: "assign.key.moveNext" },
  { id: "move_next", key: "arrowdown", shift: false, when: "always", labelKey: "assign.key.moveNext" },
  { id: "move_prev", key: "k", shift: false, when: "always", labelKey: "assign.key.movePrev" },
  { id: "move_prev", key: "arrowup", shift: false, when: "always", labelKey: "assign.key.movePrev" },
  { id: "go_pair", key: "g", shift: false, when: "pair", labelKey: "assign.key.goPair" },
  { id: "confirm", key: "enter", shift: false, when: "row", labelKey: "assign.key.confirm" },
  { id: "delete", key: "delete", shift: false, when: "row", labelKey: "assign.key.delete" },
  { id: "delete", key: "backspace", shift: false, when: "row", labelKey: "assign.key.delete" },
  { id: "clear", key: "u", shift: false, when: "row", labelKey: "assign.key.clear" },
  { id: "clear_block", key: "u", shift: true, when: "row", labelKey: "assign.key.clearBlock" },
  { id: "remark", key: "r", shift: false, when: "row", labelKey: "assign.key.remark" },
  { id: "remark_block", key: "r", shift: true, when: "row", labelKey: "assign.key.remarkBlock" },
  { id: "hold", key: "h", shift: true, when: "row", labelKey: "assign.key.hold" },
  { id: "use_ai", key: "a", shift: true, when: "ai", labelKey: "assign.key.useAi" },
  { id: "split", key: "s", shift: false, when: "cut", labelKey: "assign.key.split" },
  { id: "cut_left", key: "arrowleft", shift: false, when: "cut", labelKey: "assign.key.cutLeft" },
  { id: "cut_right", key: "arrowright", shift: false, when: "cut", labelKey: "assign.key.cutRight" },
  { id: "lang", key: "l", shift: true, when: "text", labelKey: "assign.key.lang" },
  { id: "shape_mode", key: "p", shift: true, when: "shape", labelKey: "assign.key.shapeMode" },
  { id: "number", key: "n", shift: true, when: "number", labelKey: "assign.key.number" },
  { id: "indent", key: "tab", shift: false, when: "box", labelKey: "assign.key.indent" },
  { id: "outdent", key: "tab", shift: true, when: "box", labelKey: "assign.key.outdent" },
  { id: "table", key: "t", shift: true, when: "table", labelKey: "assign.key.table" },
  { id: "ask_order", key: "o", shift: true, when: "unwrapped", labelKey: "assign.key.askOrder" },
  { id: "view", key: "v", shift: false, when: "always", labelKey: "assign.key.view" },
  { id: "preview", key: " ", shift: false, when: "always", labelKey: "assign.key.preview" },
  { id: "part_prev", key: "ctrl+arrowleft", shift: false, when: "always", labelKey: "assign.key.partPrev" },
  { id: "part_next", key: "ctrl+arrowright", shift: false, when: "always", labelKey: "assign.key.partNext" },
  { id: "undo", key: "ctrl+z", shift: false, when: "always", labelKey: "assign.key.undo" },
  { id: "redo", key: "ctrl+z", shift: true, when: "always", labelKey: "assign.key.redo" },
  { id: "escape", key: "escape", shift: false, when: "always", labelKey: "assign.key.escape" },
  { id: "help", key: "?", shift: true, when: "always", labelKey: "assign.key.help" },
];

/** run = 그 글쇠, hint = Shift를 빠뜨렸다(아무것도 하지 않고 "⇧H: Hold"만 알린다 - B2-R3) */
export type KeyHit = { kind: "run"; entry: AssignKey } | { kind: "hint"; entry: AssignKey };

export function findAssignKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">): KeyHit | null {
  if (event.altKey) return null;
  const isCtrl = event.ctrlKey || event.metaKey;
  const key = `${isCtrl ? "ctrl+" : ""}${event.key.toLowerCase()}`;
  const same = ASSIGN_KEYS.filter((entry) => entry.key === key);
  // 물음표는 글자가 곧 Shift다 - Shift 없이 찍히는 자판에서도 같다
  const entry = same.find((item) => item.shift === event.shiftKey || key === "?");
  if (entry) return { kind: "run", entry };
  const missed = event.shiftKey || isCtrl ? undefined : same.find((item) => item.shift);
  return missed ? { kind: "hint", entry: missed } : null;
}

const KEY_NAMES: Record<string, string> = {
  arrowdown: "↓", arrowup: "↑", arrowleft: "←", arrowright: "→",
  enter: "↵", escape: "Esc", delete: "Del", backspace: "⌫", tab: "Tab", " ": "Space",
};

/** 표의 한 줄을 글쇠 글로 - "⇧H" · "Ctrl+⇧Z" */
export function formatKeyPress({ key, shift }: Pick<AssignKey, "key" | "shift">): string {
  const isCtrl = key.startsWith("ctrl+");
  const name = isCtrl ? key.slice("ctrl+".length) : key;
  // 물음표에는 ⇧를 적지 않는다 - 글자가 이미 말한다
  return `${isCtrl ? "Ctrl+" : ""}${shift && name !== "?" ? "⇧" : ""}${KEY_NAMES[name] ?? name.toUpperCase()}`;
}

/** 그 일의 글쇠 전부 - "⇧H" · "Del · ⌫" · "Ctrl+→" */
export function formatAssignKey(id: AssignKeyId): string {
  return ASSIGN_KEYS.filter((entry) => entry.id === id).map(formatKeyPress).join(" · ");
}
