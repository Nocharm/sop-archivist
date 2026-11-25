// Assign의 모든 쓰기가 지나는 문 - 순수 큐(lib/command-queue)를 화면에 잇는다. 이펙트가 없다: 화면의 줄 없는 이펙트가 커밋마다 mount · pump를 부른다.
// 장벽과 되살린 글쇠는 새 고름이 그려진 커밋(settleWait)에서 끝난다 - 그 커밋의 화면 값으로 다음 글쇠를 푼다(명세 2026-11-23-assign-feedback-2 A1).
"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import type { AiSuggestion, DocumentView, EditOp, Group, UndoMeta, ViewUnit } from "@/lib/api-sop";
import { isSamePicks, NO_PLACE, type Pending, type PendingPlace, type Picks, type SidePick } from "@/lib/assign-focus-model";
import { opensTextBox } from "@/lib/assign-press-model";
import type { Destination } from "@/lib/classify-model";
import { createCommandQueue, isBarrier, isIdle, listUnsettled, mustDefer, shouldHalt, type QueuedCommand, type QueueState } from "@/lib/command-queue";
import { enqueueDocWrite } from "@/lib/doc-write-queue";
import { genId } from "@/lib/id";

import type { EditToast, PageDraft } from "./use-assign-page";

/** 묶음 하나를 바꾸지 않고 장벽 뒤에서 되살릴 것 - 누른 글쇠 · 판단 단추 · 고름 */
export type ReplayCommand =
  | { kind: "key"; key: string; shift: boolean; ctrl: boolean }
  | { kind: "press"; act: "confirm" | "hold" | "delete" | "clear" | "link"; reason?: string }
  | { kind: "pick"; pick: SidePick };

export type SeenRevisions = ReadonlyMap<number, number>;

/** 보내는 일 - 판단은 누른 순간의 줄 · Unit · 초안을 잡는다 */
export type WriteCommand =
  | {
      kind: "save";
      action: "confirm" | "hold";
      docId: number;
      rowKey: string;
      unitIds: readonly number[];
      boxId: number;
      /** 고른 곳 - null이면 저장된 곳(나갈 때 줄의 묶음에서 읽는다) */
      destination: Destination | null;
      draft: PageDraft;
      /** 이 명령이 바꾸기 전의 초안 - 버리면 되돌린다. 바꾸지 않았으면 draft와 같은 것, 없었으면 null */
      before: PageDraft | null;
      reason: string;
      /** 누른 때 화면에 있던 판단 revision - 그 사이 다른 사람이 바꿨으면 서버가 거절한다(이 화면이 쓴 것은 write-log가 잇는다) */
      seen: SeenRevisions;
      /** 누른 때 받아 둔 줄의 묶음 - 그 뒤 쓴 것이 없을 때만 그대로 쓴다 */
      groups: readonly Group[] | null;
      /** 참조 · 캡션 · Remark 전제를 누를 때 다 보았나 - 아니면 나갈 때 묶음을 받아 본다 */
      isChecked: boolean;
      /** 삭제 단추 · 글쇠(그린 초안 대신 고른 삭제) */
      isPick: boolean;
      /** 남는 쪽 짝을 푸는 저장 - 결과 박스가 응답 뒤에 정해지는 장벽이다 */
      isSplit: boolean;
      nextKey: string | null;
      placedNote: string | null;
    }
  /** 단추 줄의 잇기 · 끊기 · 끌어 놓기 · 칸 칩 × - 누른 때의 줄과 문장을 잡는다. result는 저장 뒤 그 줄의 이음(비면 배정 취소), 묶음은 보낼 때 새로 읽는다 */
  | {
      kind: "link";
      docId: number;
      rowKey: string;
      unitIds: readonly number[];
      boxId: number;
      targetIds: readonly number[];
      result: readonly number[];
      link: "link" | "replace" | "add" | "unlink";
      remark: string | null;
      seen: SeenRevisions;
      /** 한 언어만 이어 짝이 풀리는 저장 - 결과 박스가 응답 뒤에 정해지는 장벽이다 */
      isSplit: boolean;
      nextKey: string | null;
    }
  | { kind: "clear"; docId: number; rowKey: string; unitIds: readonly number[]; boxId: number; seen: SeenRevisions; draft: PageDraft | null; newDocId: number | null; toggleKey: string }
  | { kind: "bulk"; rows: ReadonlyArray<{ rowKey: string; unitIds: readonly number[] }>; seen: SeenRevisions; reason: string; skipped: number }
  | { kind: "figure"; unitId: number; unitIds: readonly number[]; seen: SeenRevisions; reason: string }
  | {
      kind: "edit";
      docId: number;
      view: DocumentView;
      op: EditOp;
      unitIds: readonly number[];
      okText: EditToast;
      followId: number | null;
      confirm: boolean;
      thenLang: "ko" | "en" | null;
      place: PendingPlace;
      afterOk?: () => Promise<void>;
    }
  | { kind: "to_pair"; docId: number; view: DocumentView; unit: ViewUnit; confirm: boolean }
  | { kind: "ai_split"; docId: number; view: DocumentView; unit: ViewUnit; suggestion: AiSuggestion; confirm: boolean }
  | {
      kind: "pair";
      docId: number;
      view: DocumentView;
      unitIds: readonly number[];
      followId: number;
      place: PendingPlace;
      pairKind: "pair" | "unpair";
      okText: string;
      write: (revision: number, undo: UndoMeta) => Promise<{ document_revision: number }>;
    }
  | { kind: "step"; direction: "undo" | "redo" }
  // 같은 글자 · 모두 받기 · 초기화 · 신규 표시 · 출처 잇기 · 칸 떼기 · 표 참조 · 나누기 제안 버리기 · 남은 번역 · 끌어 맺은 짝 - label은 실패 알림의 이름(메시지 키)
  | { kind: "global"; label: string; pending: Omit<Pending, "id">; run: (ctx: SendContext) => Promise<void> };

export type AssignCommand = WriteCommand | ReplayCommand;

export type CommandQueueState = QueueState<AssignCommand>;

/** 되묻고 다시 보낼 수 있는 편집 */
export type ConfirmableCommand = Extract<WriteCommand, { confirm: boolean }>;

export interface SendContext {
  id: string;
  /** 다시 시도로 보낸다 - 멈춘 뒤 다시 읽어 사람이 보고 있는 화면의 값으로 */
  isRetry: boolean;
  /** 응답이 왔다 - 장벽은 이 뒤 새 보기의 고름이 설 때까지 다음을 내보내지 않는다(되돌리기만 바로 잇는다 - isSolo면 New 문서 보기라 그것도 기다린다) */
  respond: (isSolo?: boolean) => void;
  /** 아직 이 명령의 차례인가 - 되돌리기가 먼저 나갔으면 아니다. 그때 온 보기는 놓지 않는다(되돌릴 모습이라 고름이 사라진 박스로 떨어진다) */
  isCurrent: () => boolean;
  /** New 문서 보기를 다시 받는 장벽 - 그 보기가 놓일 때까지 기다린다 */
  waitSolo: () => void;
  /** 새 보기를 받지 못했다 - 뒤에 쌓인 글쇠는 무엇을 가리키는지 모르니 버리고 알린다 */
  loseViews: () => void;
}

/** 서버에 보내기 전에 화면이 막은 까닭 - 알림에 그대로 보인다 */
export class CommandRefusal extends Error {}

/** 화면이 주는 것 - 그 렌더의 값이다 */
export interface CommandEnv {
  pick(next: SidePick): void;
  /** 두 쪽의 고름 - 멈춘 때의 것을 들어 두었다가 다시 시도가 되돌린다 */
  readPicks(): Picks;
  restore(picks: Picks): void;
  /** 지금 화면에 보이는 판단 revision */
  readSeen(unitIds: readonly number[]): SeenRevisions;
  /** 처리 중이 시작한다 - 누른 때, 다시 시도, 되묻기의 답. 끝(end)은 성공 · 실패 · 되묻기 · 버림 모두 */
  start(pending: Pending, command: WriteCommand): void;
  end(id: string): void;
  dropFollows(): void;
  /** New 문서 보기를 받는 중인가 */
  isSoloLoading: boolean;
  /** 보내기 - "asking"이면 창이 되묻는다 */
  send(command: WriteCommand, ctx: SendContext): Promise<"done" | "asking">;
  /** 지금 고른 것이 있나(줄 · 목차 · New 문장) */
  hasTarget(): boolean;
  /** 글쇠 · 단추를 그 렌더의 값으로 다시 누른다 - 할 것이 없었으면 false */
  replay(command: Exclude<ReplayCommand, { kind: "pick" }>): boolean;
  /** 되살린 글쇠 하나가 할 것이 없었다 */
  notifyLost(): void;
  /** 화면을 떠난 뒤 실패해 나가지 못한 것 */
  notifyUnsent(reason: string, count: number): void;
  /** 실패를 사람 말로 - isRefusal은 서버가 업무 규칙으로 거절한 것 */
  readFailure(err: unknown, command: WriteCommand): { reason: string; isRefusal: boolean };
  notifyRefusal(reason: string): void;
  notifyDropped(count: number): void;
  /** 버린 명령 - 이 명령이 바꾼 초안을 되돌린다 */
  onDrop(command: WriteCommand): void;
  /** 모아 둔 다시 읽기를 한 번에 */
  flushReload(): void;
}

function isReplay(command: AssignCommand): command is ReplayCommand {
  return command.kind === "key" || command.kind === "press" || command.kind === "pick";
}

/** 처리 중 표시 · 잠금 - 판단은 저장, 나머지는 편집 종류대로 */
export type DescribePending = (command: WriteCommand) => Omit<Pending, "id">;

export function useCommandQueue(env: CommandEnv, describePending: DescribePending) {
  const [queue] = useState(() => createCommandQueue<AssignCommand>());
  const state = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
  // 이 커밋에 새 고름이 그려졌으면 끝내도 되는 명령 - setState라 앞서 놓은 보기 · 고름과 같은 커밋에 온다
  const [settleWait, setSettleWait] = useState<{ id: string; isSolo: boolean } | null>(null);
  const live = useRef({
    isMounted: true,
    /** 되살리는 중인 글쇠 - 그동안 만든 명령은 남은 글쇠 앞에 선다 */
    replayId: null as string | null,
    /** 이번 되살림이 남은 글쇠 앞에 이미 세운 명령 수 */
    replayMade: 0,
    /** 되살린 글쇠가 창을 열었다 */
    isAskOpened: false,
    /** 응답은 왔고 새 보기를 기다리는 장벽 - canOvertake면 되돌리기가 그 보기를 기다리지 않는다 */
    respondedId: null as string | null,
    canOvertake: false,
    /** 새 고름이 그려지면 끝낼 명령 - 화면을 떠나 그 커밋이 없으면 바로 끝낸다 */
    settleId: null as string | null,
    /** 장벽을 보낼 때 고른 것이 있었나 - 끝났을 때 없으면 쌓인 글쇠가 갈 곳이 없다 */
    hadTarget: false,
    retriedIds: new Set<string>(),
    /** 멈춘 때의 고름 - 다시 시도는 여기서 잇는다 */
    haltPicks: null as Picks | null,
  });

  function settleLater(id: string, isSolo: boolean) {
    if (queue.getState().running?.id !== id) return;
    live.current.settleId = id;
    if (live.current.isMounted) setSettleWait({ id, isSolo });
    else queue.settle(id);
  }

  function endAll(commands: readonly QueuedCommand<AssignCommand>[]) {
    for (const command of commands) {
      env.end(command.id);
      if (!isReplay(command.payload)) env.onDrop(command.payload);
    }
  }

  /** 멈춘 것과 대기 전부를 버린다 - 몇 개였는지 알린다(minCount보다 적으면 말없이, 되묻기 취소는 그것 하나뿐이면 사람이 방금 한 일이다) */
  function dropAll(minCount: number) {
    const dropped = queue.drop();
    endAll(dropped);
    if (dropped.length >= minCount) env.notifyDropped(dropped.length);
  }

  function replay<R>(id: string, run: () => R): R {
    live.current.replayId = id;
    live.current.replayMade = 0;
    live.current.isAskOpened = false;
    try {
      return run();
    } finally {
      live.current.replayId = null;
    }
  }

  /** 화면을 떠났다 - 멈춘 것은 알리고, 누른 판단은 마저 보내고, 글쇠는 가리킬 고름이 없어 버리고 알린다 */
  function leave() {
    if (live.current.isMounted) return;
    const { halted, asking, running, waiting } = queue.getState();
    if (halted !== null) {
      const dropped = queue.drop();
      endAll(dropped);
      env.notifyUnsent(halted.reason, dropped.length);
      return;
    }
    if (asking !== null) dropAll(1);
    else {
      const keys = waiting.filter((command) => command.kind === "key").length;
      if (keys > 0) env.notifyDropped(keys);
    }
    // 새 고름이 그려질 커밋이 이제 없다
    if (running !== null && running.id === live.current.settleId) queue.settle(running.id);
    pump();
  }

  async function send(command: QueuedCommand<AssignCommand>, payload: WriteCommand) {
    const { id } = command;
    let isSolo = false;
    let isViewLost = false;
    live.current.respondedId = null;
    live.current.hadTarget = env.hasTarget();
    // 기다리는 사이 앞 편집이 건 따라가기 - 은퇴할 Unit을 고르지 않게 보낼 때 다시 버린다
    if (command.isGlobal) env.dropFollows();
    const ctx: SendContext = {
      id,
      isRetry: live.current.retriedIds.has(id),
      respond: (isSolo = false) => {
        // 장벽이 아니면 보내기가 끝날 때 끝난다 - 응답 뒤에 이어 보내는 것(언어 되돌리기)이 다음 명령과 섞이지 않게
        if (isBarrier(command)) {
          live.current.respondedId = id;
          live.current.canOvertake = !isSolo;
          queue.respond(id);
          pumpStep();
        }
      },
      isCurrent: () => queue.getState().running?.id === id,
      waitSolo: () => {
        isSolo = true;
      },
      loseViews: () => {
        isViewLost = true;
      },
    };
    try {
      // 문서 쓰기는 이 화면을 떠났다 돌아온 사이의 앞 쓰기도 기다린다(doc-write-queue는 화면과 무관한 줄)
      const docId = "docId" in payload ? payload.docId : payload.kind === "global" ? payload.pending.docId : null;
      const lane = payload.kind === "save" || payload.kind === "clear" || payload.kind === "link" ? null : docId;
      const outcome = await enqueueDocWrite(lane, () => env.send(payload, ctx));
      env.end(id);
      if (outcome === "asking") queue.ask(id);
      else {
        // 되돌리기가 먼저 나갔으면 이 보기는 쓰지 않는다 - 뒤의 글쇠는 그 되돌리기가 세울 고름을 기다린다
        if (isViewLost && ctx.isCurrent() && queue.getState().waiting.some((item) => item.isDeferred)) dropAll(1);
        if (isBarrier(command)) settleLater(id, isSolo);
        else queue.settle(id);
      }
    } catch (err) {
      env.end(id);
      const { reason, isRefusal } = env.readFailure(err, payload);
      if (shouldHalt(command, queue.getState(), isRefusal)) {
        live.current.haltPicks = env.readPicks();
        queue.fail(id, reason);
        // 떠난 화면에는 다시 시도를 물을 자리가 없다
        if (!live.current.isMounted) leave();
      } else {
        env.notifyRefusal(reason);
        settleLater(id, false);
      }
    }
    if (!live.current.isMounted) pump();
  }

  /** 되돌리기는 대상이 없어 앞 장벽의 새 보기를 기다리지 않는다 - 응답이 왔으면 바로 잇는다(그 보기는 놓지 않는다, ctx.isCurrent). New 문서 보기는 거둘 수 없어 기다린다 */
  function pumpStep() {
    const { running, waiting } = queue.getState();
    if (running !== null && running.id === live.current.respondedId && live.current.canOvertake && waiting[0]?.payload.kind === "step") queue.settle(running.id);
  }

  /** 다음 명령을 내보낸다 - 화면이 커밋마다 부른다(그 커밋의 env로) */
  function pump() {
    const { running: current, waiting: behind } = queue.getState();
    if (settleWait !== null && current?.id === settleWait.id && !(settleWait.isSolo && env.isSoloLoading)) {
      // 장벽이 끝나자 고른 것이 사라졌다 - 쌓인 글쇠를 엉뚱한 박스(목록 처음)에 떨어뜨리지 않고 버리고 알린다
      if (isBarrier(current) && live.current.hadTarget && !env.hasTarget() && behind.some((item) => item.kind === "key")) dropAll(1);
      queue.settle(settleWait.id);
    }
    pumpStep();
    const command = queue.take();
    if (command === null) {
      const now = queue.getState();
      if (isIdle(now) || now.halted !== null) env.flushReload();
      return;
    }
    const payload = command.payload;
    if (!isReplay(payload)) {
      // 장벽 뒤에 눌렀거나(그 장벽이 올렸을 수 있다) 다시 시도면(멈춘 뒤 다시 읽었다) 누른 때 본 revision은 낡았다 - 나가는 이때 화면의 것을 찍는다.
      // 보내려고 받은 값을 쓰지 않는다 - 그 사이 남이 바꾼 것이 409로 잡히게
      const isOld = command.isDeferred || live.current.retriedIds.has(command.id);
      void send(command, isOld && "seen" in payload ? { ...payload, seen: env.readSeen(command.unitIds) } : payload);
      return;
    }
    // 화면을 떠났으면 글쇠가 가리킬 고름이 없다
    if (!live.current.isMounted) {
      queue.settle(command.id);
      pump();
      return;
    }
    if (payload.kind === "pick") env.pick(payload.pick);
    else {
      const isDone = replay(command.id, () => env.replay(payload));
      if (!isDone) env.notifyLost();
      if (live.current.isAskOpened) {
        queue.ask(command.id);
        return;
      }
    }
    settleLater(command.id, false);
  }

  function enqueue(payload: AssignCommand): void {
    const id = genId();
    const isFirst = live.current.replayId !== null;
    const wasIdle = isIdle(queue.getState());
    const put = (command: Omit<QueuedCommand<AssignCommand>, "isDeferred">) => {
      if (isFirst) queue.pushNext(command, live.current.replayMade++);
      else queue.push(command);
    };
    if (isReplay(payload)) put({ id, kind: "key", isGlobal: false, payload, unitIds: [] });
    else {
      const pending = describePending(payload);
      // 짝을 푸는 저장은 처리 중 표시로는 저장이고 줄에서는 장벽이다
      const kind = (payload.kind === "save" || payload.kind === "link") && payload.isSplit ? "unpair" : pending.kind;
      env.start({ ...pending, id }, payload);
      put({ id, kind, isGlobal: pending.isGlobal, payload, unitIds: pending.unitIds });
    }
    // 비어 있던 줄이면 누른 그 자리에서 보낸다 - 커밋을 한 번 더 기다리지도, 그리지도 않게. 떠난 화면은 커밋이 없다
    if (wasIdle || !live.current.isMounted) pump();
  }

  return {
    state,
    enqueue,
    pump,
    /** 커밋마다 - 떠난 뒤에도(알림의 되돌리기) 큐는 스스로 돈다 */
    mount: () => {
      live.current.isMounted = true;
      return () => {
        live.current.isMounted = false;
        // 커밋마다 걷혔다 다시 선다 - 이어 서지 않았으면 떠난 것이다
        queueMicrotask(leave);
      };
    },
    /** 지금 누르면 대상을 미루나 - 되살리는 중이면 아니다 */
    isDeferring: () => live.current.replayId === null && mustDefer(queue.getState()),
    /** 쌓인 글쇠 뒤의 고름도 차례를 기다리나 - 멈춘 동안은 둘러볼 수 있게 바로 고른다(다시 시도가 멈춘 때의 고름에서 잇는다) */
    isPickQueued: () => live.current.replayId === null && queue.getState().halted === null && queue.getState().waiting.some((command) => command.kind === "key"),
    /** 글쇠를 더 쌓아도 되나 - 글 칸을 여는 글쇠(고쳐 쓰기 E · 번호 칸 ⇧N · Remark R)가 쌓여 있으면 그 뒤에 친 것은 열릴 글 칸의 글자다 */
    canQueueKey: () => !listUnsettled(queue.getState()).some(({ payload }) => payload.kind === "key" && !payload.ctrl && opensTextBox(payload)),
    /** 아직 끝나지 않은 명령 - 누르는 순간의 값(그려진 값이 아니라) */
    listUnsettled: () => listUnsettled(queue.getState()),
    /** 아직 되돌리기 기록에 없는 명령 - 응답이 온 장벽(새 보기만 기다린다)은 뺀다 */
    listUnrecorded: () => listUnsettled(queue.getState()).filter((command) => !(command.id === queue.getState().running?.id && command.id === live.current.respondedId)),
    /** 모아 둔 다시 읽기를 지금 해도 되나 */
    canReload: () => isIdle(queue.getState()) || queue.getState().halted !== null,
    isRunning: () => queue.getState().running !== null,
    /** 되살린 글쇠가 창을 열 때 - 그 글쇠의 id(되살리는 중이 아니면 null). 답할 때까지 뒤의 글쇠가 기다린다 */
    openAsk: (): string | null => {
      live.current.isAskOpened = live.current.replayId !== null;
      return live.current.replayId;
    },
    /** 연 창의 답 - run이 만든 명령이 남은 글쇠 앞에 선다 */
    answerAsk: (id: string | null, run: () => void) => {
      if (id === null) {
        run();
        return;
      }
      replay(id, run);
      queue.settle(id);
    },
    /** 되묻는 편집의 답 - 같은 명령을 그 자리에서 다시 보낸다 */
    resume: (id: string, payload: WriteCommand) => {
      env.start({ ...describePending(payload), id }, payload);
      queue.resume(id, payload);
    },
    /** 되묻기 · 창 취소 - 물은 것과 대기 전부를 버린다 */
    cancelAsk: (id: string | null) => {
      if (id !== null && queue.getState().asking?.id === id) dropAll(2);
    },
    retry: () => {
      const { halted, waiting } = queue.getState();
      if (halted === null) return;
      const { command } = halted;
      const held = live.current.haltPicks;
      // 쌓인 글쇠는 멈춘 때의 고름에서 이어진다 - 그 사이 둘러본 박스에 떨어지지 않게
      if (held !== null && waiting.some((item) => item.isDeferred) && !isSamePicks(held, env.readPicks())) env.restore(held);
      if (!isReplay(command.payload)) env.start({ ...describePending(command.payload), id: command.id }, command.payload);
      live.current.retriedIds.add(command.id);
      queue.retry();
    },
    discard: () => dropAll(1),
    /** 나가기 전 - 아직 끝나지 않은 저장이 실은 초안은 버려지지 않는다(멈춘 것은 나가지 못한다) */
    listSavingRows: () => (queue.getState().halted !== null ? [] : listUnsettled(queue.getState()).flatMap(({ payload }) => (payload.kind === "save" || payload.kind === "link" ? [payload.rowKey] : []))),
  };
}

/** 같은 줄에 같은 판단을 또 눌렀나 - 그 줄에 마지막으로 선 것이 같은 초안 · 사유의 같은 저장이고 아직 끝나지 않았으면 되돌리기 단계만 하나 더 는다 */
export function isRepeatedSave(unsettled: ReadonlyArray<{ payload: AssignCommand }>, next: Extract<WriteCommand, { kind: "save" }>): boolean {
  const last = unsettled.map(({ payload }) => payload).filter((payload) => (payload.kind === "save" || payload.kind === "clear" ? payload.rowKey === next.rowKey : payload.kind === "bulk" && payload.rows.some((item) => item.rowKey === next.rowKey))).at(-1);
  return last?.kind === "save" && last.action === next.action && last.reason === next.reason && last.isPick === next.isPick && (next.isPick || last.draft === next.draft);
}

/** 자리 없는 처리 중 표시(판단 저장) */
export function buildDecisionPending(kind: "save" | "bulk", docId: number | null, unitIds: readonly number[]): Omit<Pending, "id"> {
  return { kind, docId, unitIds, place: NO_PLACE, isGlobal: false };
}
