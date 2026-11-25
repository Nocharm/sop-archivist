import { describe, expect, it } from "vitest";

import { createCommandQueue, isBarrier, isIdle, listUnsettled, listWaitNumbers, mustDefer, shouldHalt, type CommandKind, type QueuedCommand } from "./command-queue";

const job = (id: string, kind: CommandKind, unitIds: number[], over: { isGlobal?: boolean } = {}): Omit<QueuedCommand<string>, "isDeferred"> => ({ id, kind, isGlobal: over.isGlobal ?? false, payload: id, unitIds });
const key = (id: string) => job(id, "key", []);

describe("command queue", () => {
  it("names the barriers", () => {
    for (const kind of ["join", "split", "unmerge", "unwrap", "rewrap", "pair", "unpair", "lang", "heading", "caption", "figure", "toc", "undo"] as const) expect(isBarrier({ kind, isGlobal: false })).toBe(true);
    for (const kind of ["save", "bulk", "ref", "order", "reorder", "key"] as const) expect(isBarrier({ kind, isGlobal: false })).toBe(false);
    expect(isBarrier({ kind: "bulk", isGlobal: true })).toBe(true); // 모두 받기 · 초기화
  });

  it("sends one at a time in the order pressed and numbers the waiting boxes", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [3]));
    q.push(job("b", "save", [4]));
    q.push(job("c", "save", [5]));
    expect(q.take()?.id).toBe("a");
    expect(q.take()).toBeNull();
    expect(listWaitNumbers(q.getState())).toEqual(new Map([[4, 1], [5, 2]]));
    q.settle("a");
    expect(q.take()?.id).toBe("b");
    q.settle("b");
    expect(q.take()?.id).toBe("c");
  });

  it("defers presses behind a barrier until its focus settles, not its response", () => {
    const q = createCommandQueue<string>();
    expect(q.push(job("m", "join", [3, 4])).isDeferred).toBe(false);
    expect(q.push(key("k1")).isDeferred).toBe(true);
    expect(q.push(job("d", "save", [9])).isDeferred).toBe(true);
    q.take();
    q.respond("m");
    expect(q.take()).toBeNull();
    q.settle("m");
    expect(q.take()).toMatchObject({ id: "k1", isDeferred: true });
  });

  it("puts a command made by a replayed key before the keys still waiting", () => {
    const q = createCommandQueue<string>();
    q.push(job("m", "join", [3, 4]));
    q.push(key("k1"));
    q.push(key("k2"));
    q.take();
    q.settle("m");
    q.take();
    q.settle("k1");
    q.pushNext(job("d", "save", [7]));
    expect(q.take()?.id).toBe("d");
    q.settle("d");
    expect(q.take()?.id).toBe("k2");
  });

  it("stops after a failure, retries in place, and drop gives back what was waiting", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [3]));
    q.push(job("b", "save", [4]));
    q.take();
    q.fail("a", "conflict");
    expect(q.getState().halted).toMatchObject({ command: { id: "a" }, reason: "conflict" });
    expect(q.take()).toBeNull();
    q.retry();
    expect(q.take()?.id).toBe("a");
    q.fail("a", "conflict");
    expect(q.drop().map((c) => c.id)).toEqual(["a", "b"]);
    expect(q.getState()).toEqual({ waiting: [], running: null, halted: null, asking: null });
  });

  it("waits while a dialog asks and resends the same command in place", () => {
    const q = createCommandQueue<string>();
    q.push(job("e", "join", [3]));
    q.push(key("k"));
    q.take();
    q.ask("e");
    expect(q.take()).toBeNull();
    q.resume("e", "confirmed");
    expect(q.take()).toMatchObject({ id: "e", payload: "confirmed" });
    q.settle("e");
    expect(q.take()?.id).toBe("k");
  });

  it("lets a save respond without waiting for anything else", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [3]));
    q.push(job("b", "save", [4]));
    q.take();
    q.respond("a");
    expect(q.take()?.id).toBe("b");
  });

  it("does not defer behind saves, and defers behind a barrier that only waits", () => {
    const q = createCommandQueue<string>();
    expect(q.push(job("a", "save", [3])).isDeferred).toBe(false);
    q.take();
    expect(q.push(job("b", "save", [4])).isDeferred).toBe(false);
    expect(q.push(job("m", "unwrap", [5])).isDeferred).toBe(false);
    expect(q.push(job("c", "save", [6])).isDeferred).toBe(true);
  });

  it("keeps deferring while anything deferred is still waiting or being replayed", () => {
    const q = createCommandQueue<string>();
    q.push(job("m", "join", [3]));
    q.push(key("k1"));
    q.push(key("k2"));
    q.take();
    q.settle("m");
    q.take(); // k1을 되살리는 중
    expect(mustDefer(q.getState())).toBe(true);
    q.settle("k1");
    expect(q.push(key("k3")).isDeferred).toBe(true);
    q.take();
    q.settle("k2");
    q.take();
    // 마지막 글쇠를 되살리는 동안 누른 것도 그 글쇠가 세울 고름 뒤다
    expect(mustDefer(q.getState())).toBe(true);
    q.settle("k3");
    expect(mustDefer(q.getState())).toBe(false);
  });

  it("defers what is pressed while a failed barrier stays halted, and keeps its place", () => {
    const q = createCommandQueue<string>();
    q.push(job("m", "join", [3]));
    q.take();
    q.fail("m", "500");
    expect(q.push(key("k")).isDeferred).toBe(true);
    q.retry();
    expect(q.take()?.id).toBe("m");
    q.settle("m");
    expect(q.take()?.id).toBe("k");
  });

  it("does not defer what is pressed while a failed save stays halted", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [3]));
    q.take();
    q.fail("a", "500");
    expect(q.push(job("b", "save", [4])).isDeferred).toBe(false);
    expect(q.take()).toBeNull();
  });

  it("ends a key whose dialog was answered after its command was put first", () => {
    const q = createCommandQueue<string>();
    q.push(job("m", "join", [3]));
    q.push(key("k1"));
    q.push(key("k2"));
    q.take();
    q.settle("m");
    q.take();
    q.ask("k1");
    expect(mustDefer(q.getState())).toBe(true);
    q.pushNext(job("h", "save", [7]));
    q.settle("k1");
    expect(q.take()?.id).toBe("h");
    q.settle("h");
    expect(q.take()?.id).toBe("k2");
  });

  it("drops what a dialog asked about together with everything waiting, and leaves what is running", () => {
    const q = createCommandQueue<string>();
    q.push(job("e", "join", [3]));
    q.push(key("k"));
    q.take();
    q.ask("e");
    expect(q.drop().map((c) => c.id)).toEqual(["e", "k"]);
    q.push(job("a", "save", [3]));
    q.push(job("b", "save", [4]));
    q.take();
    expect(q.drop().map((c) => c.id)).toEqual(["b"]);
    expect(q.getState().running?.id).toBe("a");
    expect(q.drop()).toEqual([]);
  });

  it("ignores news about a command that is not the one running", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [3]));
    q.push(job("b", "save", [4]));
    q.take();
    const before = q.getState();
    q.settle("b");
    q.fail("b", "late");
    q.respond("zzz");
    q.ask("b");
    q.resume("a", "x");
    q.retry();
    expect(q.getState()).toBe(before);
  });

  it("tells listeners once per change and stops after unsubscribe", () => {
    const q = createCommandQueue<string>();
    let calls = 0;
    const off = q.subscribe(() => (calls += 1));
    q.push(job("a", "save", [3]));
    q.take();
    q.settle("a");
    expect(calls).toBe(3);
    off();
    q.push(job("b", "save", [4]));
    expect(calls).toBe(3);
  });

  it("numbers a box by its first waiting command and a barrier by its first box", () => {
    const q = createCommandQueue<string>();
    q.push(job("a", "save", [1]));
    q.push(job("b", "save", [4, 5]));
    q.push(job("c", "save", [4]));
    q.push(job("t", "unwrap", [8, 9, 10]));
    q.take();
    expect(listWaitNumbers(q.getState())).toEqual(new Map([[4, 1], [5, 1], [8, 3]]));
  });

  it("lists everything unsettled in order and is idle only when empty", () => {
    const q = createCommandQueue<string>();
    expect(isIdle(q.getState())).toBe(true);
    q.push(job("a", "save", [1]));
    q.push(job("b", "save", [2]));
    q.take();
    expect(listUnsettled(q.getState()).map((c) => c.id)).toEqual(["a", "b"]);
    q.fail("a", "x");
    expect(listUnsettled(q.getState()).map((c) => c.id)).toEqual(["a", "b"]);
    expect(isIdle(q.getState())).toBe(false);
    q.drop();
    expect(isIdle(q.getState())).toBe(true);
  });
});

describe("shouldHalt", () => {
  const waiting = (count: number) => ({ waiting: Array.from({ length: count }, (_, n) => ({ ...job(`w${n}`, "save", [n]), isDeferred: false })) });
  it("stops whenever something waits behind", () => {
    expect(shouldHalt(job("m", "join", [3]), waiting(1), true)).toBe(true);
    expect(shouldHalt(job("m", "undo", []), waiting(2), true)).toBe(true);
  });
  it("stops on a decision even alone - the pick already left its box", () => {
    expect(shouldHalt(job("a", "save", [3]), waiting(0), true)).toBe(true);
    expect(shouldHalt(job("a", "bulk", [3]), waiting(0), true)).toBe(true);
  });
  it("stops on a failure worth resending, and only tells about a refused edit with nothing behind it", () => {
    expect(shouldHalt(job("m", "join", [3]), waiting(0), false)).toBe(true);
    expect(shouldHalt(job("m", "join", [3]), waiting(0), true)).toBe(false);
    expect(shouldHalt(job("m", "undo", []), waiting(0), true)).toBe(false);
  });
});

describe("a runner on top of the queue loses nothing (Review Focus 1)", () => {
  // 화면 흉내 - 글쇠 하나는 장벽 뒤면 쌓이고 아니면 그때의 고름으로 명령이 된다. j는 고름만, d는 지우고 다음, m은 합치기(장벽, 새 박스를 고른다)
  function makeRunner() {
    const q = createCommandQueue<string>();
    const log: string[] = [];
    let focus = 1;
    let seq = 0;
    let isReplaying = false;
    let nextBox = 100;
    function send(kind: CommandKind, payload: string, unitIds: number[]) {
      const command = { id: `c${(seq += 1)}`, kind, isGlobal: false, payload, unitIds };
      if (isReplaying) q.pushNext(command);
      else q.push(command);
    }
    function act(name: string) {
      if (name === "j") focus += 1;
      else if (name === "d") {
        send("save", `delete ${focus}`, [focus]);
        focus += 1;
      } else send("join", `join ${focus}`, [focus]);
    }
    function press(name: string) {
      if (mustDefer(q.getState())) send("key", name, []);
      else act(name);
    }
    /** 명령 하나를 보내고 끝낸다(글쇠면 되살린다) - 돌 것이 없으면 false */
    function step(): boolean {
      const command = q.take();
      if (command === null) return false;
      if (command.kind === "key") {
        isReplaying = true;
        act(command.payload);
        isReplaying = false;
        q.settle(command.id);
        return true;
      }
      log.push(command.payload);
      if (isBarrier(command)) {
        q.respond(command.id);
        focus = nextBox += 10;
      }
      q.settle(command.id);
      return true;
    }
    return { press, step, log, getFocus: () => focus };
  }

  it("Delete five times in a row deletes five different boxes in order", () => {
    const run = makeRunner();
    for (let n = 0; n < 5; n += 1) run.press("d");
    while (run.step());
    expect(run.log).toEqual(["delete 1", "delete 2", "delete 3", "delete 4", "delete 5"]);
  });

  it("Delete, j, Delete, j, Delete skips a box each time", () => {
    const run = makeRunner();
    for (const name of ["d", "j", "d", "j", "d"]) run.press(name);
    expect(run.getFocus()).toBe(6);
    while (run.step());
    expect(run.log).toEqual(["delete 1", "delete 3", "delete 5"]);
  });

  it("Delete right after a join deletes the joined box, and the keys after it follow from there", () => {
    const run = makeRunner();
    for (const name of ["m", "d", "j", "d"]) run.press(name);
    while (run.step());
    expect(run.log).toEqual(["join 1", "delete 110", "delete 112"]);
  });

  it("two joins in a row - the second one joins the result of the first", () => {
    const run = makeRunner();
    for (const name of ["m", "m", "d"]) run.press(name);
    while (run.step());
    expect(run.log).toEqual(["join 1", "join 110", "delete 120"]);
  });

  it("sends exactly the same log however the responses interleave with the presses", () => {
    const names = ["d", "d", "m", "j", "d", "m", "m", "d", "j", "j", "d", "d"];
    // 모두 누른 뒤 · 하나 누를 때마다 끝까지 · 두 번 누를 때마다 한 번
    const all = makeRunner();
    for (const name of names) all.press(name);
    while (all.step());
    const eager = makeRunner();
    for (const name of names) {
      eager.press(name);
      while (eager.step());
    }
    const mixed = makeRunner();
    names.forEach((name, index) => {
      mixed.press(name);
      if (index % 2 === 1) mixed.step();
    });
    while (mixed.step());
    expect(all.log).toEqual(eager.log);
    expect(mixed.log).toEqual(eager.log);
    expect(all.log.filter((entry) => entry.startsWith("delete"))).toHaveLength(names.filter((name) => name === "d").length);
  });
});
