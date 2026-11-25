// 큐를 화면에 잇는 층 - 장벽과 되살린 글쇠가 새 고름이 그려진 커밋에서 끝나는지, 실패 · 되묻기 · 화면 떠남에서 아무것도 사라지지 않는지를
// 화면 흉내(고름 · 보기 · 서버 응답을 손으로 놓는다)로 본다. 진짜 화면은 스모크가 본다.
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NO_PLACE, type Focus, type Pending, type PendingKind } from "@/lib/assign-focus-model";
import { useAssignFocus } from "@/lib/use-assign-focus";

import { buildDecisionPending, isRepeatedSave, useCommandQueue, type AssignCommand, type SendContext, type WriteCommand } from "./use-command-queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unit = (unitId: number): Focus => ({ kind: "unit", docId: 1, unitId });

interface Wait {
  resolve: () => void;
  reject: (err: Error) => void;
}

/** 화면 흉내 하나 - log는 보낸 차례, response · view는 붙들어 둔 응답과 새 보기 */
function createScreen() {
  const log: string[] = [];
  const responses: Wait[] = [];
  const views: Wait[] = [];
  const dropped: number[] = [];
  const refusals: string[] = [];
  let reloads = 0;
  let isReloadAsked = false;
  let isRefused = false;
  let isConfirmAsked = false;
  let nextUnit = 100;
  // 화면이 보고 있는 판단 revision과 서버의 것 - 다시 읽어야 같아진다
  let screenRevision = 1;
  let serverRevision = 1;
  let isRemarkOpen: string | null = null;
  // 서버에 살아 있는 Unit - 합치기는 누른 박스를 은퇴시키고 새 박스를 만들며, 되돌리기는 그 반대다. 보기는 응답한 때의 것을 실어 온다
  let alive = new Set(Array.from({ length: 400 }, (_, n) => n));
  const steps: Array<{ retired: number; made: number }> = [];
  let isUndoFocusGone = false;
  const unsent: Array<{ reason: string; n: number }> = [];
  const motions: string[] = [];
  let lost = 0;
  const screen = {
    log, dropped, refusals, unsent, motions,
    lost: () => lost,
    /** 되돌리기 응답이 갈 자리를 알려 주지 않는다 */
    forgetUndoFocus: () => {
      isUndoFocusGone = true;
    },
    press: (() => undefined) as (name: string) => void,
    click: (() => undefined) as (unitId: number) => void,
    commands: null as unknown as ReturnType<typeof useCommandQueue>,
    focus: unit(1) as Focus,
    pending: [] as readonly Pending[],
    reloads: () => reloads,
    changeElsewhere: () => {
      serverRevision += 1;
    },
    reread: () => {
      screenRevision = serverRevision;
    },
    enqueueBulk: (unitIds: number[]) => act(async () => screen.commands.enqueue({ kind: "bulk", rows: unitIds.map((id) => ({ rowKey: `u${id}`, unitIds: [id] })), seen: new Map(unitIds.map((id) => [id, screenRevision])), reason: "", skipped: 0 })),
    remark: () => isRemarkOpen,
    closeRemark: () => {
      isRemarkOpen = null;
    },
    refuseNext: () => {
      isRefused = true;
    },
    askNext: () => {
      isConfirmAsked = true;
    },
    /** 붙들어 둔 서버 응답 하나를 놓는다(실패면 오류로) */
    respond: async (err?: Error) => act(async () => {
      const wait = responses.shift();
      if (err) wait?.reject(err);
      else wait?.resolve();
    }),
    /** 붙들어 둔 새 보기 하나를 놓는다 */
    place: async () => act(async () => views.shift()?.resolve()),
    /** 새 보기를 받지 못했다 */
    loseView: async () => act(async () => views.shift()?.reject(new Error("offline"))),
    held: () => [responses.length, views.length],
  };
  const hold = (list: Wait[]) => new Promise<void>((resolve, reject) => list.push({ resolve, reject }));

  function Screen() {
    const focusCtl = useAssignFocus();
    const [placed, setPlaced] = useState({ n: 0, revision: 1, unitIds: alive });
    const placeView = (unitIds: Set<number>) => setPlaced((prev) => ({ n: prev.n + 1, revision: prev.revision + 1, unitIds }));
    const [seen, setSeen] = useState(0);
    const focus = focusCtl.focus;
    if (placed.n !== seen) {
      setSeen(placed.n);
      focusCtl.load({ type: "loaded", docs: [{ docId: 1, revision: placed.revision, unitIds: placed.unitIds }], liftUnit: (id) => (placed.unitIds.has(id) ? id : null) });
    }
    const focusedId = focus.kind === "unit" ? focus.unitId : null;

    function run(command: WriteCommand, ctx: SendContext): Promise<void> {
      if (command.kind === "global") return command.run(ctx);
      if (command.kind === "bulk") {
        // 서버의 낙관 잠금 - 실은 revision이 지금 것과 다르면 409
        const sent = command.rows.flatMap((item) => item.unitIds.map((id) => command.seen.get(id)));
        log.push(`bulk ${sent.join(",")}`);
        return hold(responses).then(() => {
          if (sent.some((revision) => revision !== serverRevision)) throw new Error("409");
          serverRevision += 1;
        });
      }
      if (command.kind !== "step") throw new Error(`unexpected ${command.kind}`);
      log.push(command.direction);
      return hold(responses).then(async () => {
        const step = steps.pop();
        if (step) alive = new Set([...alive].filter((id) => id !== step.made).concat(step.retired));
        const view = alive;
        if (step && !isUndoFocusGone) focusCtl.succeed(ctx.id, { docId: null, revision: null, pickUnitId: step.retired });
        ctx.respond();
        await hold(views);
        if (ctx.isCurrent()) placeView(view);
      });
    }
    const commands = useCommandQueue(
      {
        pick: focusCtl.pick,
        readFocus: () => screen.focus,
        readSeen: (unitIds) => new Map(unitIds.map((id) => [id, screenRevision])),
        start: (pending, command) => {
          focusCtl.start(pending);
          motions.push(`start ${command.kind === "global" ? command.label : command.kind}`);
        },
        end: (id) => {
          focusCtl.end(id);
          motions.push("end");
        },
        dropFollows: focusCtl.dropFollows,
        isSoloLoading: false,
        send: async (command, ctx) => {
          if (isConfirmAsked) {
            isConfirmAsked = false;
            return "asking";
          }
          await run(command, ctx);
          return "done";
        },
        hasTarget: () => screen.focus.kind !== "none",
        replay: (press) => press.kind === "key" && pressKey(press.key),
        notifyLost: () => {
          lost += 1;
        },
        notifyUnsent: (reason, n) => unsent.push({ reason, n }),
        readFailure: (err) => ({ reason: String((err as Error).message), isRefusal: isRefused }),
        notifyRefusal: (reason) => refusals.push(reason),
        notifyDropped: (n) => dropped.push(n),
        onDrop: () => undefined,
        flushReload: () => {
          if (!isReloadAsked) return;
          isReloadAsked = false;
          reloads += 1;
        },
      },
      (command) => (command.kind === "global" ? command.pending : command.kind === "step" ? { kind: "undo", docId: null, unitIds: [], place: NO_PLACE, isGlobal: true } : buildDecisionPending(command.kind === "bulk" ? "bulk" : "save", 1, command.kind === "bulk" ? command.rows.flatMap((item) => item.unitIds) : [])),
    );

    function enqueue(kind: PendingKind, name: string, unitIds: number[], send: (ctx: SendContext) => Promise<void>, isGlobal = false) {
      commands.enqueue({ kind: "global", label: name, pending: { kind, docId: isGlobal ? null : 1, unitIds, place: NO_PLACE, isGlobal }, run: send });
    }
    function pressKey(name: string): boolean {
      if (name === "v") return false;
      // 고른 것이 없으면 j는 목록 처음으로 간다 - 그 뒤의 d가 엉뚱한 박스에 떨어진다
      if (focusedId === null && name === "j") focusCtl.pick(unit(0));
      if (focusedId === null) return name === "j";
      if (name === "j") focusCtl.pick(unit(focusedId + 1));
      else if (name === "d") {
        enqueue("save", `delete ${focusedId}`, [focusedId], async (ctx) => {
          log.push(`delete ${focusedId}${ctx.isRetry ? " again" : ""}`);
          await hold(responses);
          isReloadAsked = true;
        });
        focusCtl.pick(unit(focusedId + 1));
      } else if (name === "m") {
        enqueue("join", `join ${focusedId}`, [focusedId], async (ctx) => {
          log.push(`join ${focusedId}${ctx.isRetry ? " again" : ""}`);
          await hold(responses);
          const made = (nextUnit += 100);
          steps.push({ retired: focusedId, made });
          alive = new Set([...alive].filter((id) => id !== focusedId).concat(made));
          const view = alive;
          focusCtl.succeed(ctx.id, { docId: 1, revision: null, pickUnitId: made });
          ctx.respond();
          isReloadAsked = true;
          // 되돌리기가 먼저 나갔으면 이 보기는 놓지 않는다(화면의 placeReload와 같다)
          await hold(views).then(() => (ctx.isCurrent() ? placeView(view) : undefined), () => ctx.loseViews());
        });
      } else if (name === "t") {
        // 들여쓰기처럼 한 글쇠가 저장 둘을 세운다 - 누른 줄, 이어진 줄들
        for (const part of ["clicked", "rest"]) {
          enqueue("ref", `${part} ${focusedId}`, [focusedId], async () => {
            log.push(`${part} ${focusedId}`);
            await hold(responses);
          });
        }
      } else if (name === "h") isRemarkOpen = commands.openAsk() ?? "live";
      return true;
    }
    screen.press = (name) => {
      if (name === "undo") commands.enqueue({ kind: "step", direction: "undo" });
      else if (commands.isDeferring()) {
        if (commands.canQueueKey()) commands.enqueue({ kind: "key", key: name, shift: false, ctrl: false });
      }
      else pressKey(name);
    };
    screen.click = (unitId) => {
      if (commands.isPickQueued()) commands.enqueue({ kind: "pick", focus: unit(unitId) });
      else focusCtl.pick(unit(unitId));
    };
    useEffect(() => {
      screen.commands = commands;
      screen.focus = focusCtl.focus;
      screen.pending = focusCtl.pending;
      const leave = commands.mount();
      commands.pump();
      return leave;
    });
    return createElement("button", { "data-testid": "start", onClick: () => focusCtl.pick(unit(1)) });
  }
  return { screen, Screen };
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function open() {
  const made = createScreen();
  await act(async () => root.render(createElement(made.Screen)));
  await act(async () => made.screen.click(1));
  return made.screen;
}
const press = (screen: Awaited<ReturnType<typeof open>>, name: string) => act(async () => screen.press(name));
const click = (screen: Awaited<ReturnType<typeof open>>, unitId: number) => act(async () => screen.click(unitId));
const drain = async (screen: Awaited<ReturnType<typeof open>>) => {
  for (let n = 0; n < 40 && (screen.held()[0] > 0 || screen.held()[1] > 0); n += 1) {
    if (screen.held()[0] > 0) await screen.respond();
    else await screen.place();
  }
};

describe("presses while a save is slow (A1-AC1)", () => {
  it("moves at once, sends one at a time, and reads again once when the queue empties", async () => {
    const screen = await open();
    for (const name of ["d", "j", "d", "j", "d"]) await press(screen, name);
    expect(screen.focus).toEqual(unit(6));
    expect(screen.log).toEqual(["delete 1"]);
    expect(screen.pending.map((item) => item.unitIds)).toEqual([[1], [3], [5]]);
    expect(screen.reloads()).toBe(0);
    await screen.respond();
    expect(screen.log).toEqual(["delete 1", "delete 3"]);
    expect(screen.reloads()).toBe(0);
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "delete 3", "delete 5"]);
    expect(screen.pending).toEqual([]);
    expect(screen.reloads()).toBe(1);
  });
});

describe("a barrier (A1-R3, AC2)", () => {
  it("replays the keys on the box the new view picks, in order", async () => {
    const screen = await open();
    for (const name of ["m", "d", "j", "d"]) await press(screen, name);
    expect(screen.focus).toEqual(unit(1));
    await screen.respond();
    expect(screen.log).toEqual(["join 1"]); // 응답만으로는 풀지 않는다
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 200", "delete 202"]);
    expect(screen.focus).toEqual(unit(203));
  });
  it("two joins in a row join the result of the first", async () => {
    const screen = await open();
    for (const name of ["m", "m", "d"]) await press(screen, name);
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "join 200", "delete 300"]);
  });
  it("a click made while keys wait keeps its place in the line", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "d");
    await click(screen, 50);
    await press(screen, "d");
    expect(screen.focus).toEqual(unit(1));
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 200", "delete 50"]);
  });
  it("a click before any key is picked at once and the keys go there", async () => {
    const screen = await open();
    await press(screen, "m");
    await click(screen, 50);
    expect(screen.focus).toEqual(unit(50));
    await press(screen, "d");
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 50"]);
  });
  it("a save before the barrier does not hold the pick, and its keys wait for the barrier", async () => {
    const screen = await open();
    for (const name of ["d", "m", "d"]) await press(screen, name);
    expect(screen.focus).toEqual(unit(2));
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "join 2", "delete 200"]);
  });
  it("drops the waiting keys when the new view cannot be read, and says so", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "d");
    await press(screen, "d");
    await screen.respond();
    await screen.loseView();
    await drain(screen);
    expect(screen.log).toEqual(["join 1"]);
    expect(screen.dropped).toEqual([2]);
    expect(screen.commands.state).toEqual({ waiting: [], running: null, halted: null, asking: null });
  });
  it("Undo before the join's view - the late view is not placed, the undone box is picked and the next key lands on it", async () => {
    const screen = await open();
    await press(screen, "m");
    await screen.respond();
    await press(screen, "undo");
    await press(screen, "d");
    await screen.place(); // 합치기의 늦은 보기 - 1이 은퇴해 있다
    expect(screen.focus).toEqual(unit(1));
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "undo", "delete 1"]);
    expect([screen.lost(), screen.dropped]).toEqual([0, []]);
  });
  it("two Undos in a row go back two steps and the next key lands on the first box", async () => {
    const screen = await open();
    await press(screen, "m");
    await drain(screen);
    await press(screen, "m");
    await drain(screen);
    expect(screen.focus).toEqual(unit(300));
    await press(screen, "undo");
    await press(screen, "undo");
    await press(screen, "d");
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "join 200", "undo", "undo", "delete 1"]);
  });
  it("keys are dropped with a notice, not sent elsewhere, when the box they would land on is gone", async () => {
    const screen = await open();
    await press(screen, "m");
    await drain(screen);
    screen.forgetUndoFocus();
    await press(screen, "undo");
    for (const name of ["j", "d"]) await press(screen, name);
    await drain(screen);
    expect(screen.focus.kind).toBe("none");
    expect(screen.log).toEqual(["join 1", "undo"]);
    expect(screen.dropped).toEqual([2]);
  });
  it("a single key that finds nothing to act on says so", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "v"); // 되살렸을 때 할 일이 없는 글쇠
    await press(screen, "d");
    await drain(screen);
    expect(screen.lost()).toBe(1);
    expect(screen.log).toEqual(["join 1", "delete 200"]);
  });
  it("a view lost by a join that Undo already overtook does not drop the keys behind that Undo", async () => {
    const screen = await open();
    await press(screen, "m");
    await screen.respond();
    await press(screen, "undo");
    await press(screen, "d");
    await screen.loseView();
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "undo", "delete 1"]);
    expect(screen.dropped).toEqual([]);
  });
  it("no key waits behind a waiting e - what is typed next belongs to the text box it opens", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "e");
    await press(screen, "d");
    await press(screen, "h");
    await drain(screen);
    expect(screen.log).toEqual(["join 1"]);
    expect(screen.commands.state).toEqual({ waiting: [], running: null, halted: null, asking: null });
    await press(screen, "d");
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 200"]);
  });
  it("no key waits behind a waiting r - what is typed next belongs to the Remark window it opens", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "r");
    await press(screen, "d");
    await drain(screen);
    expect(screen.log).toEqual(["join 1"]);
  });
  it("two saves of one replayed key go out in the order the key made them, before the next key", async () => {
    const screen = await open();
    for (const name of ["m", "t", "t", "d"]) await press(screen, name);
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "clicked 200", "rest 200", "clicked 200", "rest 200", "delete 200"]);
  });
  it("Undo does not wait for the view before it, and that view's follow is dropped", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "undo");
    expect(screen.log).toEqual(["join 1"]);
    await screen.respond();
    expect(screen.log).toEqual(["join 1", "undo"]);
    await press(screen, "d"); // 되돌리기 뒤의 글쇠 - 쌓인다
    await screen.place(); // 앞 편집의 늦은 보기
    expect(screen.focus).toEqual(unit(1));
    expect(screen.log).toEqual(["join 1", "undo"]);
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "undo", "delete 1"]);
    expect(screen.commands.state.running).toBeNull();
  });
  it("Undo pressed while only the view is missing goes out at once", async () => {
    const screen = await open();
    await press(screen, "m");
    await screen.respond();
    await press(screen, "undo");
    expect(screen.log).toEqual(["join 1", "undo"]);
    await drain(screen);
    expect(screen.commands.state.running).toBeNull();
  });
  it("Undo right after Delete waits for that save (T5 step 5)", async () => {
    const screen = await open();
    await press(screen, "d");
    await press(screen, "undo");
    expect(screen.log).toEqual(["delete 1"]);
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "undo"]);
  });
});

describe("a failure (A1-R7, AC3)", () => {
  it("stops what is behind it, retries in place, then runs the rest", async () => {
    const screen = await open();
    for (const name of ["d", "d", "d"]) await press(screen, name);
    await screen.respond();
    await screen.respond(new Error("500"));
    expect(screen.log).toEqual(["delete 1", "delete 2"]);
    expect(screen.commands.state.halted).toMatchObject({ reason: "500" });
    expect(screen.pending.map((item) => item.unitIds)).toEqual([[3]]); // 실패한 박스의 표시는 걷혔다
    await act(async () => screen.commands.retry());
    expect(screen.pending.map((item) => item.unitIds)).toEqual([[3], [2]]);
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "delete 2", "delete 2 again", "delete 3"]);
    expect(screen.commands.state).toEqual({ waiting: [], running: null, halted: null, asking: null });
  });
  it("starts the command's motion at the press and again on retry, and ends it when it fails or is dropped", async () => {
    const screen = await open();
    await press(screen, "m");
    expect(screen.motions).toEqual(["start join 1"]); // 응답 전이다
    await screen.respond(new Error("500"));
    expect(screen.motions).toEqual(["start join 1", "end"]);
    await act(async () => screen.commands.retry());
    expect(screen.motions.slice(2)).toEqual(["start join 1"]);
    await screen.respond(new Error("500"));
    await act(async () => screen.commands.discard());
    expect(screen.motions.slice(3)).toEqual(["end", "end"]);
  });
  it("discard empties the line and tells how many", async () => {
    const screen = await open();
    for (const name of ["d", "d", "d"]) await press(screen, name);
    await screen.respond(new Error("500"));
    await act(async () => screen.commands.discard());
    expect(screen.dropped).toEqual([3]);
    expect(screen.pending).toEqual([]);
    expect(screen.log).toEqual(["delete 1"]);
  });
  it("goes on after a refused join with nothing behind it, and stops when something waits", async () => {
    const screen = await open();
    screen.refuseNext();
    await press(screen, "m");
    await screen.respond(new Error("not allowed"));
    expect(screen.refusals).toEqual(["not allowed"]);
    expect(screen.commands.state.halted).toBeNull();
    await press(screen, "m");
    await press(screen, "d");
    await screen.respond(new Error("not allowed"));
    expect(screen.commands.state.halted).toMatchObject({ reason: "not allowed" });
    expect(screen.log).toEqual(["join 1", "join 1"]);
  });
  it("a retried barrier goes on from where it stopped even if another box was looked at", async () => {
    const screen = await open();
    await press(screen, "m");
    await press(screen, "d");
    await screen.respond(new Error("500"));
    await click(screen, 70); // 멈춘 동안은 바로 고른다
    expect(screen.focus).toEqual(unit(70));
    await act(async () => screen.commands.retry());
    expect(screen.focus).toEqual(unit(1));
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "join 1 again", "delete 200"]);
  });
});

describe("the optimistic lock", () => {
  it("someone else's change while the command waits is refused and stops the line, not overwritten", async () => {
    const screen = await open();
    await press(screen, "d");
    await screen.enqueueBulk([9]);
    screen.changeElsewhere();
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "bulk 1"]);
    expect(screen.commands.state.halted).toMatchObject({ reason: "409" });
  });
  it("a deferred command carries the revision on screen when it goes out, not the one before the barrier", async () => {
    const screen = await open();
    await press(screen, "m");
    await screen.enqueueBulk([9]);
    await screen.respond();
    // 합치기가 올린 revision을 장벽의 다시 받기가 화면에 놓았다
    screen.changeElsewhere();
    screen.reread();
    await screen.place();
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "bulk 2"]);
    expect(screen.commands.state.halted).toBeNull();
  });
  it("a deferred command is refused too when someone changes the row after the screen was read", async () => {
    const screen = await open();
    await press(screen, "m");
    await screen.enqueueBulk([9]);
    await screen.respond();
    await screen.place();
    screen.changeElsewhere();
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "bulk 1"]);
    expect(screen.commands.state.halted).toMatchObject({ reason: "409" });
  });
  it("Retry locks on what the screen shows now - refused again until it was read, then goes through", async () => {
    const screen = await open();
    await screen.enqueueBulk([9]);
    screen.changeElsewhere();
    await drain(screen);
    await act(async () => screen.commands.retry());
    await drain(screen);
    expect(screen.commands.state.halted).toMatchObject({ reason: "409" });
    screen.reread();
    await act(async () => screen.commands.retry());
    await drain(screen);
    expect(screen.log).toEqual(["bulk 1", "bulk 1", "bulk 2"]);
    expect(screen.commands.state).toEqual({ waiting: [], running: null, halted: null, asking: null });
  });
});

describe("a dialog", () => {
  it("holds the keys until it is answered, then puts its command first", async () => {
    const screen = await open();
    for (const name of ["m", "h", "d"]) await press(screen, name);
    await screen.respond();
    await screen.place();
    const askId = screen.remark();
    expect(askId).not.toBeNull();
    expect(screen.commands.state.asking?.id).toBe(askId);
    expect(screen.log).toEqual(["join 1"]);
    await act(async () => screen.commands.answerAsk(askId, () => screen.press("d")));
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 200", "delete 201"]);
  });
  it("cancelled, it drops what waited behind it", async () => {
    const screen = await open();
    for (const name of ["m", "h", "d", "d"]) await press(screen, name);
    await screen.respond();
    await screen.place();
    await act(async () => screen.commands.cancelAsk(screen.remark()));
    await drain(screen);
    expect(screen.log).toEqual(["join 1"]);
    expect(screen.dropped).toEqual([3]);
  });
  it("asked about by the server, the same command is sent again in its place", async () => {
    const screen = await open();
    screen.askNext();
    await press(screen, "m");
    const asking = screen.commands.state.asking;
    expect(asking).not.toBeNull();
    expect(screen.pending).toEqual([]);
    await press(screen, "d");
    if (asking !== null) await act(async () => screen.commands.resume(asking.id, asking.payload as WriteCommand));
    await drain(screen);
    expect(screen.log).toEqual(["join 1", "delete 200"]);
  });
});

describe("leaving the screen", () => {
  it("still sends what was enqueued afterwards (the toast's Undo)", async () => {
    const screen = await open();
    await act(async () => root.unmount());
    const sent: string[] = [];
    await act(async () => screen.commands.enqueue({ kind: "global", label: "x", pending: { kind: "bulk", docId: null, unitIds: [], place: NO_PLACE, isGlobal: true }, run: async () => void sent.push("after") }));
    expect(sent).toEqual(["after"]);
    root = createRoot(host);
  });
  it("stops and says how many did not go out when a save fails after leaving", async () => {
    const screen = await open();
    for (const name of ["d", "d", "d"]) await press(screen, name);
    await act(async () => root.unmount());
    await screen.respond();
    await screen.respond(new Error("500"));
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "delete 2"]);
    expect(screen.unsent).toEqual([{ reason: "500", n: 2 }]);
    root = createRoot(host);
  });
  it("says what stayed halted when the screen is left", async () => {
    const screen = await open();
    for (const name of ["d", "d"]) await press(screen, name);
    await screen.respond(new Error("500"));
    expect(screen.unsent).toEqual([]);
    await act(async () => root.unmount());
    expect(screen.unsent).toEqual([{ reason: "500", n: 2 }]);
    root = createRoot(host);
  });
  it("sends what waited behind a barrier's view, and tells about the keys it drops", async () => {
    const screen = await open();
    await press(screen, "d");
    await press(screen, "m");
    await press(screen, "j");
    await screen.respond();
    await act(async () => root.unmount());
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "join 2"]);
    expect(screen.dropped).toEqual([1]);
    root = createRoot(host);
  });
  it("drains the saves already pressed", async () => {
    const screen = await open();
    for (const name of ["d", "d"]) await press(screen, name);
    await act(async () => root.unmount());
    await drain(screen);
    expect(screen.log).toEqual(["delete 1", "delete 2"]);
    root = createRoot(host);
  });
});

describe("isRepeatedSave", () => {
  const draft = { destination: null, texts: {}, reason: null, editing: false } as unknown as Extract<WriteCommand, { kind: "save" }>["draft"];
  const save = (over: Partial<Extract<WriteCommand, { kind: "save" }>> = {}) => ({ kind: "save", action: "confirm", rowKey: "u1", draft, reason: "", isPick: false, ...over }) as AssignCommand & { kind: "save" };
  const queued = (...payloads: AssignCommand[]) => payloads.map((payload) => ({ payload }));
  it("is a second press of the same decision on the same draft while the first is not done", () => {
    expect(isRepeatedSave(queued(save()), save())).toBe(true);
    expect(isRepeatedSave(queued(save(), save({ rowKey: "u2" })), save())).toBe(true);
  });
  it("is not another row, another action, a changed draft or reason", () => {
    expect(isRepeatedSave([], save())).toBe(false);
    expect(isRepeatedSave(queued(save({ rowKey: "u2" })), save())).toBe(false);
    expect(isRepeatedSave(queued(save({ action: "hold" })), save())).toBe(false);
    expect(isRepeatedSave(queued(save({ draft: { ...draft } })), save())).toBe(false);
    expect(isRepeatedSave(queued(save({ reason: "x" })), save())).toBe(false);
  });
  it("is not when something else was pressed on that row in between", () => {
    expect(isRepeatedSave(queued(save(), { kind: "clear", rowKey: "u1" } as AssignCommand), save())).toBe(false);
  });
  it("counts a second Delete on the same row as repeated", () => {
    expect(isRepeatedSave(queued(save({ isPick: true })), save({ isPick: true, draft: { ...draft } }))).toBe(true);
    expect(isRepeatedSave(queued(save({ isPick: false })), save({ isPick: true }))).toBe(false);
  });
});
