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

/** 글쇠 처리에는 없고 도움말 · 설명서에만 있는 손짓 - {click} · {drag} · {wheel}은 화면 언어의 낱말로 바뀐다 */
export interface HelpOnlyKey {
  id: string;
  presses: readonly string[];
  labelKey: string;
  /** 새 문서를 켠 동안의 설명 */
  draftLabelKey?: string;
  /** 새 문서를 켠 동안만 보인다 */
  isDraftOnly?: boolean;
}

export const HELP_ONLY: readonly HelpOnlyKey[] = [
  { id: "pick_many", presses: ["Shift + {click}"], labelKey: "assign.help.keyShift" },
  { id: "add_new", presses: ["Ctrl + {click}"], labelKey: "assign.help.keyCtrl" },
  { id: "drag_link", presses: ["{drag}"], labelKey: "assign.help.keyDragLink", draftLabelKey: "assign.help.keyDrag" },
  { id: "drag_pair", presses: ["{drag}"], labelKey: "assign.help.keyDragPair" },
  { id: "select_text", presses: ["Alt + {drag}"], labelKey: "assign.help.keyAltDrag" },
  { id: "zoom", presses: ["Ctrl + {wheel}"], labelKey: "assign.help.keyZoom" },
  { id: "sheet", presses: ["{wheel}"], labelKey: "assign.help.keySheet" },
  { id: "context_menu", presses: ["⇧F10"], labelKey: "assign.help.keyContext" },
  { id: "link_menu", presses: ["↑", "↓", "←", "→"], labelKey: "assign.help.keyMenu" },
  { id: "edit", presses: ["E"], labelKey: "assign.legend.keyEdit", isDraftOnly: true },
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

/** 지금 자리 - 까닭(reasonKey)은 단추 · 우클릭 메뉴가 보이는 것과 같은 답이다 */
export interface AssignKeyContext {
  /** Old의 배정 줄을 골랐다 */
  hasRow: boolean;
  /** 줄이나 New 문서의 문장을 골랐다 */
  hasBox: boolean;
  /** 저절로 삭제된 줄을 골랐다 - 먼저 삭제 취소해야 한다 */
  isDeletedLine: boolean;
  canEdit: boolean;
  hasCut: boolean;
  hasPair: boolean;
  isText: boolean;
  langReasonKey: string | null;
  shapeMode: { reasonKey: string | null } | null;
  hasNumberCell: boolean;
  hasAi: boolean;
  /** 고른 줄이 든 벗긴 표 */
  unwrappedTableId: number | null;
  orderReasonKey: string | null;
  /** 고른 박스가 든(벗길 수 있는) 표 */
  tableId: number | null;
  tableReasonKey: string | null;
  /** 고른 박스의 모양이 바뀌는 중이다 */
  isLocked: boolean;
}

/** 그 글쇠를 지금 자리에서 누르면 - 하거나, 못 하는 까닭을 짧게 알린다(B2-R8) */
export function resolveAssignKey(entry: AssignKey, ctx: AssignKeyContext): { run: AssignKeyId } | { refuseKey: string } {
  const refuseKey = findRefusal(entry, ctx);
  return refuseKey === null ? { run: entry.id } : { refuseKey };
}

function why(reason: string): string {
  return `assign.key.why.${reason}`;
}

function findRefusal({ id, when }: AssignKey, ctx: AssignKeyContext): string | null {
  // 확정 단추의 막힘은 primary-model이, 나눌 선이 없을 때의 화살표는 브라우저가 맡는다
  if (when === "always" || id === "confirm" || id === "cut_left" || id === "cut_right") return null;
  if (when === "pair") return ctx.hasPair ? null : why("noPair");
  if (!ctx.canEdit) return "assign.ctx.why.readOnly";
  if (when === "cut") return ctx.hasCut ? null : "split.menu.why.noCut";
  // 삭제된 줄의 글쇠는 noise-keys가 먼저 받는다 - 여기까지 왔으면 삭제된 줄이 아니다
  if (id === "clear_block" || id === "remark_block") return why("notDeleted");
  if (when === "row") return ctx.hasRow ? null : why("noRow");
  if (ctx.isDeletedLine) return "assign.ctx.why.tocLine";
  if (!ctx.hasBox) return why("noRow");
  if (when === "ai") return ctx.hasAi ? null : why("noAi");
  // 들여쓰기는 저장 중인 값에서 이어 센다 - 이어 누른 Tab을 버리지 않는다
  if (when === "box") return ctx.hasNumberCell ? null : why("noNumber");
  if (ctx.isLocked) return why("busy");
  if (when === "text") return ctx.isText ? ctx.langReasonKey : why("notText");
  if (when === "shape") return ctx.shapeMode === null ? why("noShape") : ctx.shapeMode.reasonKey;
  if (when === "table") return ctx.tableId === null && ctx.unwrappedTableId === null ? why("notTable") : ctx.tableReasonKey;
  if (when === "unwrapped") return ctx.unwrappedTableId === null ? why("notUnwrapped") : ctx.orderReasonKey;
  return ctx.hasNumberCell ? null : why("noNumber");
}
