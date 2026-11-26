// 연습 과제 표(설계 §7) - 열둘 · 글쇠가 keymap과 같고(D19) · 설명서 자리가 있고 · 기록으로 판정하고(D9) · 펼칠 과제를 렌더 중에 고른다(D10).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ASSIGN_KEYS, formatAssignKey } from "../assign-keymap";
import { MESSAGES } from "../i18n-messages";
import { readManualSource } from "../manual-files";

import fixture from "./practice-fixture.json";
import type { PracticeLogEntry } from "./practice-server";
import { PRACTICE_TASKS, listAchieved, listTargetSelectors, pickNextTask, pickOpenTask, readCoachView, type PracticeTaskId } from "./practice-tasks";

/** U3의 글쇠 - 표의 첫 글쇠가 이것이어야 한다(↵ = Enter). 글쇠를 바꾸면 여기서 걸리고 과제 글은 formatAssignKey로 따라간다 */
const U3_KEYS: Record<PracticeTaskId, string[]> = {
  pick: ["J", "K"],
  link: [],
  confirm: ["↵"],
  hold: ["⇧H"],
  unassign: ["U"],
  merge: ["⇧J"],
  split: ["S"],
  pair: ["⇧P"],
  unwrap: ["⇧T"],
  toc: ["R"],
  undo: ["Ctrl+Z"],
  keyboard: ["?"],
};

/** 과제마다 그 과제를 이루는 기록 한 줄(가짜 서버 · 연습 틀이 실제로 적는 꼴) */
const SAMPLES: Record<PracticeTaskId, PracticeLogEntry> = {
  pick: { act: { key: "move_prev" } },
  link: { route: "groups/save", action: "confirm", undoOp: "link", unitIds: [13, 14], focusTargetId: 1 },
  confirm: { route: "groups/save", action: "confirm", undoOp: "link", unitIds: [15, 16] },
  hold: { route: "groups/save", action: "hold", undoOp: "hold", unitIds: [17, 18] },
  unassign: { route: "decisions/clear", unitIds: [15] },
  merge: { route: "edits", editType: "merge", unitIds: [20, 21] },
  split: { route: "edits", editType: "split", unitIds: [19] },
  pair: { route: "pairs", unitIds: [24, 25] },
  unwrap: { route: "edits", editType: "set_layout_table:unwrap", unitIds: [28] },
  toc: { route: "edits", editType: "set_noise_reason", unitIds: [5] },
  undo: { route: "decisions/undo", undoOp: "set_noise_reason", unitIds: [5] },
  keyboard: { act: { click: "keyboard-map" } },
};

const ALL_IDS = PRACTICE_TASKS.map((task) => task.id);

describe("the practice task table", () => {
  it("has twelve tasks with distinct ids and message pairs", () => {
    expect(ALL_IDS).toEqual(["pick", "link", "confirm", "hold", "unassign", "merge", "split", "pair", "unwrap", "toc", "undo", "keyboard"]);
    expect(new Set(ALL_IDS).size).toBe(12);
    for (const task of PRACTICE_TASKS) {
      for (const lang of ["en", "ko"] as const) {
        expect(MESSAGES[lang][task.titleKey], `${lang} ${task.titleKey}`).toBeTruthy();
        expect(MESSAGES[lang][task.bodyKey], `${lang} ${task.bodyKey}`).toBeTruthy();
      }
    }
  });

  it("draws the keys from the Assign keymap and they are the U3 keys (D19)", () => {
    const known = new Set(ASSIGN_KEYS.map((entry) => entry.id));
    for (const task of PRACTICE_TASKS) {
      for (const id of task.keys) expect(known.has(id), `${task.id}: ${id} is not in ASSIGN_KEYS`).toBe(true);
      expect(task.keys.map((id) => formatAssignKey(id).split(" · ")[0]), task.id).toEqual(U3_KEYS[task.id]);
    }
  });

  it("points every task at a place the manual has", async () => {
    const manual = await readManualSource();
    for (const task of PRACTICE_TASKS) expect(manual.includes(`{#${task.anchor}}`), `${task.id}: no {#${task.anchor}} in user-manual.md`).toBe(true);
  });

  it("names a chapter with an en and ko message for every task", () => {
    for (const task of PRACTICE_TASKS) {
      for (const lang of ["en", "ko"] as const) expect(MESSAGES[lang][`practice.chapter.${task.chapter}`], `${lang} practice.chapter.${task.chapter}`).toBeTruthy();
    }
  });
});

// 말풍선 대상(2026-11-27 시안 A) - 과제 글이 가리키는 연습 자료의 자리. 자료를 다시 뽑아 id가 바뀌면 여기서 걸린다
describe("the box each task lights up", () => {
  const oldUnits = fixture.views["900001"].units;
  const fix = "the practice fixture changed - point the task's target in practice-tasks.ts at the unit its body text names";

  it("lights the Old unit the task text names (pairs by their Korean side)", () => {
    const expected: Partial<Record<PracticeTaskId, string>> = {
      link: "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.",
      confirm: "추천 카드를 누르면 고르기만 하고, 이어서 Enter로 바로 확정합니다.",
      hold: "정할 수 없는 Unit은 사유를 적어 미룹니다.",
      merge: "나누기와 합치기는 확정과 같은 저장이라",
      split: "정할 수 없는 Unit은 보류합니다. 보류한 Unit은 On hold에 모입니다.",
      pair: "한/영 짝은 한 문장으로 합치고 다시 짝으로 풉니다.",
    };
    for (const [id, text] of Object.entries(expected)) {
      const target = PRACTICE_TASKS.find((task) => task.id === id)?.target;
      const unit = target && "unit" in target ? oldUnits.find((item) => item.id === target.unit) : undefined;
      expect(unit?.text, `${id}: ${fix}`).toBe(text);
    }
    const table = PRACTICE_TASKS.find((task) => task.id === "unwrap")?.target;
    expect(table && "unit" in table ? oldUnits.find((item) => item.id === table.unit)?.kind : null, `unwrap: ${fix}`).toBe("table");
  });

  it("lights the contents block by the first unit of the toc run", () => {
    const target = PRACTICE_TASKS.find((task) => task.id === "toc")?.target;
    const first = oldUnits.find((unit) => unit.noise_kind === "toc");
    expect(target, `toc: ${fix}`).toEqual({ noise: first?.id });
    expect(listTargetSelectors(target!, [])).toEqual([`[data-testid="assign-old"] [data-testid="assign-paper-noise-${first?.id}"]`]);
  });

  it("finds an Old unit by its box first, then its text, then its deleted line", () => {
    expect(listTargetSelectors({ unit: 15 }, [])).toEqual([
      '[data-testid="assign-old"] [data-testid="assign-paper-piece-15"]',
      '[data-testid="assign-old"] [data-testid="assign-paper-unit-15"]',
      '[data-testid="assign-old"] [data-testid="assign-paper-deleted-u15"]',
    ]);
    expect(listTargetSelectors({ testId: "assign-undo" }, [])).toEqual(['[data-testid="assign-undo"]']);
  });

  it("lights the line last linked or confirmed for Unassign, and nothing before there is one", () => {
    const target = PRACTICE_TASKS.find((task) => task.id === "unassign")!.target;
    expect(listTargetSelectors(target, [SAMPLES.pick, SAMPLES.hold])).toEqual([]);
    expect(listTargetSelectors(target, [SAMPLES.link, SAMPLES.confirm, SAMPLES.hold])[0]).toContain("assign-paper-piece-15");
  });
});

describe("skipping a task", () => {
  it("goes to the next task not done yet, wrapping round to the start", () => {
    expect(pickNextTask([], "pick")).toBe("link");
    expect(pickNextTask([SAMPLES.link, SAMPLES.confirm], "pick")).toBe("hold");
    expect(pickNextTask([SAMPLES.pick], "keyboard")).toBe("link");
  });

  it("has nowhere to go when the task shown is the only one left", () => {
    const allButToc = Object.values(SAMPLES).filter((entry) => entry !== SAMPLES.toc);
    expect(pickNextTask(allButToc, "toc")).toBeNull();
  });
});

describe("what the coach card shows", () => {
  it("shows the open task face up", () => {
    expect(readCoachView([], null, { id: "pick", since: 0 })).toEqual({ id: "pick", isDone: false });
  });

  it("flips the task it was showing once that task is done, then the next one face up once it has moved on", () => {
    const log = [SAMPLES.pick];
    expect(readCoachView(log, null, { id: "pick", since: 0 })).toEqual({ id: "pick", isDone: true });
    expect(readCoachView(log, null, { id: "link", since: 1 })).toEqual({ id: "link", isDone: false });
  });

  it("does not flip for another task done meanwhile - that one only fills its dot", () => {
    expect(readCoachView([SAMPLES.split], null, { id: "pick", since: 0 })).toEqual({ id: "pick", isDone: false });
  });

  it("flips a done task picked again only when it is done again after the pick", () => {
    const log = [SAMPLES.pick];
    const picked = { id: "pick" as const, since: 1 };
    expect(readCoachView(log, picked, picked)).toEqual({ id: "pick", isDone: false });
    expect(readCoachView([...log, SAMPLES.pick], picked, picked)).toEqual({ id: "pick", isDone: true });
  });

  it("flips the last task before the finish card", () => {
    const all = Object.values(SAMPLES);
    expect(readCoachView(all, null, { id: "keyboard", since: all.length - 1 })).toEqual({ id: "keyboard", isDone: true });
    expect(readCoachView(all, null, { id: null, since: all.length })).toEqual({ id: null, isDone: false });
  });
});

describe("judging tasks from the log", () => {
  it("finds exactly the one task each sample entry does", () => {
    for (const [id, entry] of Object.entries(SAMPLES)) expect([...listAchieved([entry])], id).toEqual([id]);
  });

  it("keeps a task done after an undo - the log only grows", () => {
    const log: PracticeLogEntry[] = [SAMPLES.hold, SAMPLES.undo];
    expect(listAchieved(log)).toEqual(new Set(["hold", "undo"]));
  });

  it("does not count the pair join of Shift+P as Merge, nor a press that missed Shift", () => {
    const pairJoin: PracticeLogEntry = { route: "edits", editType: "merge", unitIds: [24, 25], isPairJoin: true };
    expect(listAchieved([pairJoin, { route: "edits", editType: "unmerge", unitIds: [950001] }])).toEqual(new Set());
    expect(listAchieved([{ act: { key: "confirm" } }])).toEqual(new Set());
  });

  it("tells a link from a card confirm by the target the undo meta carries (D22)", () => {
    const link = SAMPLES.link;
    const card = SAMPLES.confirm;
    expect([...listAchieved([link])]).toEqual(["link"]);
    expect([...listAchieved([card])]).toEqual(["confirm"]);
    // 한 손짓이 둘을 함께 켜지 않는다 - 놓인 문장 잇기처럼 대상 없는 잇기 op도 확정으로 센다
    expect([...listAchieved([{ ...card, undoOp: "confirm" }])]).toEqual(["confirm"]);
  });
});

describe("the open task", () => {
  it("opens the first task when nothing is done or picked", () => {
    expect(pickOpenTask([], null)).toBe("pick");
  });

  it("opens the picked task until it is done, then the first open task", () => {
    const picked = { id: "hold" as const, since: 0 };
    expect(pickOpenTask([SAMPLES.pick], picked)).toBe("hold");
    expect(pickOpenTask([SAMPLES.pick, SAMPLES.hold], picked)).toBe("link");
  });

  it("re-opens a done task picked again until it is done again", () => {
    const log = [SAMPLES.pick];
    expect(pickOpenTask(log, { id: "pick", since: log.length })).toBe("pick");
    expect(pickOpenTask([...log, SAMPLES.pick], { id: "pick", since: log.length })).toBe("link");
  });

  it("moves to the next open task in order when a task is done, whatever order the person went in", () => {
    expect(pickOpenTask([SAMPLES.split, SAMPLES.pick], null)).toBe("link");
  });

  it("opens nothing when every task is done", () => {
    expect(pickOpenTask(Object.values(SAMPLES), null)).toBeNull();
    expect(pickOpenTask(Object.values(SAMPLES), { id: "toc", since: 99 })).toBe("toc");
  });
});

// D22: 잇기 · 카드 확정의 판정은 Assign의 두 보내기가 싣는 되돌리기 메타에 기댄다 - 그 줄이 바뀌면 판정을 다시 맞춘다
describe("the undo meta the link and confirm judgment leans on", () => {
  const source = readFileSync(join(process.cwd(), "src", "app", "bundles", "[id]", "assign", "use-assign-page.tsx"), "utf8");
  it("sendLink carries the linked New sentence and sendSave does not", () => {
    const fix = "Assign's undo meta for link (sendLink) or save (sendSave) changed - re-pin the link/confirm judgment in practice-tasks.ts and design D22";
    expect(source.includes("const focus = targetIds[0] === undefined ? { focus_unit_id: unitIds[0] } : { focus_unit_id: unitIds[0], focus_target_id: targetIds[0] };"), fix).toBe(true);
    expect(source.includes('buildUndo({ op: command.link === "unlink" ? "unlink" : "link", ...focus })'), fix).toBe(true);
    expect(source.includes("const saved = await saveGroup(bundleId, body, buildUndo({ op, focus_unit_id: unitIds[0] }));"), fix).toBe(true);
  });
});
