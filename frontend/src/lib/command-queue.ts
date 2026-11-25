// Assign 명령 큐 - 쓰기를 누른 차례대로 하나씩 보내는 순수 모델(React 없음). 결과 박스가 응답 뒤에 정해지는 명령은 장벽이라 그 뒤에 누른 것은 대상을
// 잡지 않고 쌓아 두었다가 장벽이 세운 고름으로 푼다. 실패하면 멈추고 다시 시도 · 버리기를 기다린다(명세 2026-11-23-assign-feedback-2 A1, 설계 2026-11-25-split-first §6-1).

import type { PendingKind } from "./assign-focus-model";

/** key - 장벽 뒤에 누른 글쇠 · 고름 · 판단 단추(누른 때의 대상이 없다) */
export type CommandKind = PendingKind | "key";

export interface QueuedCommand<T> {
  id: string;
  kind: CommandKind;
  /** 묶음 전체가 바뀌는 일(모두 받기 · 초기화 · 되돌리기) */
  isGlobal: boolean;
  payload: T;
  unitIds: readonly number[];
  /** 장벽 뒤에 눌렀다 - 대상을 나갈 때(take 뒤) 그때의 고름으로 푼다 */
  isDeferred: boolean;
}

export interface QueueState<T> {
  waiting: readonly QueuedCommand<T>[];
  running: QueuedCommand<T> | null;
  /** 실패해 멈춘 명령 - 다시 시도나 버리기까지 아무것도 나가지 않는다 */
  halted: { command: QueuedCommand<T>; reason: string } | null;
  /** 창이 되묻는 명령 - 답할 때까지 아무것도 나가지 않는다 */
  asking: QueuedCommand<T> | null;
}

type NewCommand<T> = Omit<QueuedCommand<T>, "isDeferred">;

export interface CommandQueue<T> {
  getState(): QueueState<T>;
  subscribe(listener: () => void): () => void;
  /** 줄 끝에 세운다 - isDeferred면 부른 쪽은 고름을 옮기지 않는다 */
  push(command: NewCommand<T>): { isDeferred: boolean };
  /** 되살린 글쇠가 만든 명령 - 남은 글쇠 앞에 세운다 */
  pushNext(command: NewCommand<T>): void;
  /** 다음 명령을 꺼내 달린다 - 이미 달리거나 멈췄거나 되묻는 중이면 null */
  take(): QueuedCommand<T> | null;
  /** 응답이 왔다 - 장벽이 아니면 settle과 같고, 장벽이면 새 보기의 고름이 선 뒤의 settle까지 달린다 */
  respond(id: string): void;
  settle(id: string): void;
  fail(id: string, reason: string): void;
  /** 멈춘 명령을 그 자리에서 다시 보낸다 */
  retry(): void;
  ask(id: string): void;
  /** 되묻기의 답을 실어 그 자리에서 다시 보낸다 */
  resume(id: string, payload: T): void;
  /** 버리기 - 멈춘(되묻던) 것과 대기 전부를 걷어 돌려준다(달리는 것은 그대로) */
  drop(): readonly QueuedCommand<T>[];
}

// 응답 뒤에야 결과 박스가 정해지는 일 - 참조(번호) · 순서 · 판단은 박스가 그대로라 장벽이 아니다
const BARRIER_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>(["join", "split", "unmerge", "unwrap", "rewrap", "pair", "unpair", "lang", "heading", "caption", "figure", "toc", "undo"]);

export function isBarrier(command: Pick<QueuedCommand<unknown>, "kind" | "isGlobal">): boolean {
  return command.isGlobal || BARRIER_KINDS.has(command.kind);
}

/** 지금 누르면 대상을 미루나 - 앞에 장벽이 있거나(달리는 것 · 멈춘 것 포함) 미룬 것이 있거나 되묻는 중이면 */
export function mustDefer<T>(state: QueueState<T>): boolean {
  if (state.asking !== null) return true;
  // 되살리는 글쇠도 그 뒤의 고름을 정한다
  if (state.running !== null && (state.running.kind === "key" || isBarrier(state.running))) return true;
  if (state.halted !== null && isBarrier(state.halted.command)) return true;
  return state.waiting.some((command) => command.isDeferred || isBarrier(command));
}

/** 아무것도 달리거나 기다리지 않는다 - 모아 둔 다시 읽기를 할 때 */
export function isIdle<T>(state: QueueState<T>): boolean {
  return state.running === null && state.halted === null && state.asking === null && state.waiting.length === 0;
}

/** 아직 끝나지 않은 명령 전부 - 나간 차례, 나갈 차례대로 */
export function listUnsettled<T>(state: QueueState<T>): QueuedCommand<T>[] {
  return [state.running, state.halted?.command ?? null, state.asking, ...state.waiting].filter((command): command is QueuedCommand<T> => command !== null);
}

/** 박스 → "대기 n"(첫째 대기 = 1). 같은 박스가 여럿이면 앞 번호, 장벽은 첫 박스에만(표 하나의 칸마다 붙지 않게) */
export function listWaitNumbers<T>(state: Pick<QueueState<T>, "waiting">): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>();
  state.waiting.forEach((command, index) => {
    for (const unitId of isBarrier(command) ? command.unitIds.slice(0, 1) : command.unitIds) if (!numbers.has(unitId)) numbers.set(unitId, index + 1);
  });
  return numbers;
}

/**
 * 실패하면 멈추나 - 뒤에 기다리는 것이 있거나, 고름이 이미 떠난 판단이거나, 다시 보내면 될 실패(서버 오류 · 끊김)면.
 * 기다리는 것이 없는 편집 · 되돌리기를 서버가 거절했으면(isRefusal) 알림만 하고 지나간다 - 멈출 것이 없고 그대로 다시 보내도 같은 답이다
 */
export function shouldHalt<T>(command: Pick<QueuedCommand<T>, "kind">, state: Pick<QueueState<T>, "waiting">, isRefusal: boolean): boolean {
  return !isRefusal || state.waiting.length > 0 || command.kind === "save" || command.kind === "bulk";
}

export function createCommandQueue<T>(): CommandQueue<T> {
  let state: QueueState<T> = { waiting: [], running: null, halted: null, asking: null };
  const listeners = new Set<() => void>();

  function update(patch: Partial<QueueState<T>>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function settle(id: string): void {
    if (state.running?.id === id) update({ running: null });
    // 창을 열어 답을 받은 글쇠 - 그 글쇠가 만든 명령이 이미 앞에 섰다
    else if (state.asking?.id === id) update({ asking: null });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(command) {
      const isDeferred = mustDefer(state);
      update({ waiting: [...state.waiting, { ...command, isDeferred }] });
      return { isDeferred };
    },
    pushNext(command) {
      update({ waiting: [{ ...command, isDeferred: false }, ...state.waiting] });
    },
    take() {
      if (state.running !== null || state.halted !== null || state.asking !== null || state.waiting.length === 0) return null;
      const [command, ...waiting] = state.waiting;
      update({ running: command, waiting });
      return command;
    },
    respond(id) {
      if (state.running?.id === id && !isBarrier(state.running)) settle(id);
    },
    settle,
    fail(id, reason) {
      if (state.running?.id === id) update({ running: null, halted: { command: state.running, reason } });
    },
    retry() {
      if (state.halted !== null) update({ halted: null, waiting: [state.halted.command, ...state.waiting] });
    },
    ask(id) {
      if (state.running?.id === id) update({ running: null, asking: state.running });
    },
    resume(id, payload) {
      if (state.asking?.id === id) update({ asking: null, waiting: [{ ...state.asking, payload }, ...state.waiting] });
    },
    drop() {
      const dropped = [state.halted?.command ?? null, state.asking, ...state.waiting].filter((command): command is QueuedCommand<T> => command !== null);
      if (dropped.length > 0) update({ waiting: [], halted: null, asking: null });
      return dropped;
    },
  };
}
