import { describe, expect, it } from "vitest";

import { EDIT_LABELS, readEditLabelKey, readKeyLabelKey, trimReason } from "./command-label";
import { MESSAGES } from "./i18n-messages";

describe("command labels in the failure notice", () => {
  it("every edit has a name in both languages", () => {
    for (const key of [...EDIT_LABELS, "assign.step.hold", "assign.step.delete", "assign.step.link", "assign.step.confirm", "assign.step.pair", "assign.step.unpair", "assign.step.reset", "assign.queue.act.undo", "assign.queue.act.redo", "assign.queue.act.captionRef", "assign.queue.act.dismissSplit", "assign.queue.act.translation", "classify.clear"]) {
      expect(MESSAGES.en[key], key).toBeTruthy();
      expect(MESSAGES.ko[key], key).toBeTruthy();
    }
    expect(MESSAGES.en[readEditLabelKey({ type: "merge" })]).toBe("Merge");
  });
  it("fills the notice in both languages without a doubled period", () => {
    expect(trimReason("Someone changed this first. Reload the page. ")).toBe("Someone changed this first. Reload the page");
    expect(trimReason("이미 바뀌었습니다")).toBe("이미 바뀌었습니다");
    for (const lang of ["en", "ko"] as const) {
      for (const name of ["{action}", "{no}", "{reason}", "{n}"]) expect(MESSAGES[lang]["assign.queue.failed"]).toContain(name);
      for (const name of ["{action}", "{reason}", "{n}"]) expect(MESSAGES[lang]["assign.queue.failedAll"]).toContain(name);
      expect(MESSAGES[lang]["assign.queue.chip"]).toContain("{n}");
      expect(MESSAGES[lang]["assign.queue.chipNamed"]).toContain("{action}");
      for (const name of ["{action}", "{n}"]) expect(MESSAGES[lang]["assign.queue.chipMore"]).toContain(name);
      for (const name of ["{action}", "{n}"]) expect(MESSAGES[lang]["assign.queue.chipTimes"]).toContain(name);
    }
  });
});

describe("names of keys queued behind a barrier", () => {
  it("names a key by the command it sends and leaves moves unnamed", () => {
    expect(readKeyLabelKey({ key: "j", shift: true, ctrl: false })).toBe("assign.step.merge");
    expect(readKeyLabelKey({ key: "enter", shift: false, ctrl: false })).toBe("assign.step.confirm");
    expect(readKeyLabelKey({ key: "delete", shift: false, ctrl: false })).toBe("assign.step.delete");
    expect(readKeyLabelKey({ key: "z", shift: false, ctrl: true })).toBe("assign.queue.act.undo");
    expect(readKeyLabelKey({ key: "z", shift: true, ctrl: true })).toBe("assign.queue.act.redo");
    expect(readKeyLabelKey({ key: "j", shift: false, ctrl: false })).toBeNull();
    expect(readKeyLabelKey({ key: "q", shift: false, ctrl: false })).toBeNull();
  });
  it("every key name exists in both languages", () => {
    for (const press of [{ key: "s", shift: false }, { key: "s", shift: true }, { key: "h", shift: true }, { key: "u", shift: false }, { key: "u", shift: true }, { key: "l", shift: true }, { key: "t", shift: true }, { key: "`", shift: false }, { key: "k", shift: true }]) {
      const labelKey = readKeyLabelKey({ ...press, ctrl: false }) ?? "";
      expect(MESSAGES.en[labelKey], `${press.key} ${labelKey}`).toBeTruthy();
      expect(MESSAGES.ko[labelKey], `${press.key} ${labelKey}`).toBeTruthy();
    }
  });
});
