import { describe, expect, it } from "vitest";

import { createWriteLog } from "./write-log";

const group = (unitIds: number[], targetIds: number[] = [], revision = 1) => ({ units: unitIds.map((unit_id) => ({ unit_id, decision: { revision } })), targets: targetIds.map((id) => ({ id, revision })) });

describe("decision revisions between reloads (A1-R4)", () => {
  it("sends the revision the last response gave, or the screen's when it is newer", () => {
    const log = createWriteLog();
    expect(log.pickRevision(3, 1)).toBe(1);
    log.noteSaved(group([3], [], 4));
    expect(log.pickRevision(3, 1)).toBe(4);
    expect(log.pickRevision(3, 9)).toBe(9);
    expect(log.pickRevision(5, 2)).toBe(2);
  });
  it("does not go back when an older response lands late", () => {
    const log = createWriteLog();
    log.noteSaved(group([3], [], 4));
    log.noteDecisions([{ unit_id: 3, decision: { revision: 3 } }]);
    expect(log.pickRevision(3, 1)).toBe(4);
  });
  it("does not know the revision after a clear until the next response or reload", () => {
    const log = createWriteLog();
    log.noteUnknown([3, 4]);
    expect(log.pickRevision(3, 7)).toBeNull();
    log.noteSaved(group([3], [], 9));
    expect(log.pickRevision(3, 7)).toBe(9);
    const at = log.now();
    log.settle(at);
    expect(log.pickRevision(4, 8)).toBe(8);
  });
  it("keeps not knowing when something was written while the rows were being read", () => {
    const log = createWriteLog();
    const at = log.now();
    log.noteUnknown([4]);
    log.settle(at);
    expect(log.pickRevision(4, 8)).toBeNull();
  });
});

describe("the revision a save locks on", () => {
  const seen = new Map([[3, 2]]);
  it("is the one seen on screen, not the one just read - someone else's change stays a conflict", () => {
    expect(createWriteLog().resolveRevision(3, seen, 5)).toBe(2);
  });
  it("follows this screen's own writes", () => {
    const log = createWriteLog();
    log.noteSaved(group([3], [], 4));
    expect(log.resolveRevision(3, seen, 4)).toBe(4);
    // 이 화면이 4를 쓴 뒤 남이 5로 - 그래도 4를 실어 거절되게
    expect(log.resolveRevision(3, seen, 5)).toBe(4);
  });
  it("takes the read one only for a unit the screen never had or one this screen just cleared", () => {
    const log = createWriteLog();
    expect(log.resolveRevision(9, seen, 5)).toBe(5);
    log.noteUnknown([3]);
    expect(log.resolveRevision(3, seen, 5)).toBe(5);
  });
});

describe("the New sentences of a group read again at send", () => {
  it("lock on the revision seen at press, or this screen's own later write", () => {
    const log = createWriteLog();
    const pressed = group([3], [30, 31], 1);
    log.mark(pressed, log.now());
    log.noteSaved(group([8], [31], 4));
    // 30은 그 사이 남이 5로, 31은 이 화면이 4로 썼고 그 뒤 남이 6으로, 40은 보지 못했다
    expect(log.lockTargets([{ id: 30, revision: 5 }, { id: 31, revision: 6 }, { id: 40, revision: 9 }], [pressed])).toEqual([{ id: 30, revision: 1 }, { id: 31, revision: 4 }, { id: 40, revision: 9 }]);
  });
  it("take what was read after a write this screen cannot follow (an edit, an Undo)", () => {
    const log = createWriteLog();
    const pressed = group([3], [30], 1);
    log.mark(pressed, log.now());
    log.noteAll();
    expect(log.lockTargets([{ id: 30, revision: 5 }], [pressed])).toEqual([{ id: 30, revision: 5 }]);
  });
});

describe("is a loaded relation group still usable", () => {
  it("trusts a group nothing in it was written after", () => {
    const log = createWriteLog();
    const mine = group([3], [30]);
    expect(log.isFresh(mine)).toBe(false); // 언제 부른 것인지 모른다
    log.mark(mine, log.now());
    log.noteSaved(group([8], [80]));
    expect(log.isFresh(mine)).toBe(true);
  });
  it("does not trust it once its unit or its New sentence was saved from another row", () => {
    const log = createWriteLog();
    const mine = group([3], [30]);
    const other = group([4], [40]);
    log.mark(mine, log.now());
    log.mark(other, log.now());
    log.noteSaved(group([8], [30]));
    expect(log.isFresh(mine)).toBe(false);
    log.noteSaved(group([4]));
    expect(log.isFresh(other)).toBe(false);
  });
  it("does not trust a group asked for while that save was on its way", () => {
    const log = createWriteLog();
    const mine = group([3], [30]);
    const at = log.now();
    log.noteSaved(group([8], [30])); // 부른 뒤 응답이 왔다
    log.mark(mine, at);
    expect(log.isFresh(mine)).toBe(false);
  });
  it("trusts nothing loaded before an edit, a clear or a bulk delete", () => {
    for (const write of [(log: ReturnType<typeof createWriteLog>) => log.noteAll(), (log: ReturnType<typeof createWriteLog>) => log.noteUnknown([9]), (log: ReturnType<typeof createWriteLog>) => log.noteDecisions([])]) {
      const log = createWriteLog();
      const mine = group([3]);
      log.mark(mine, log.now());
      write(log);
      expect(log.isFresh(mine)).toBe(false);
      const again = group([3]);
      log.mark(again, log.now());
      expect(log.isFresh(again)).toBe(true);
    }
  });
});
