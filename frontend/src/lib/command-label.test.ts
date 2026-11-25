import { describe, expect, it } from "vitest";

import { EDIT_LABELS, readEditLabelKey, trimReason } from "./command-label";
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
    }
  });
});
