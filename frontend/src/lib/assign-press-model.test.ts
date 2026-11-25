import { describe, expect, it } from "vitest";

import { isQueuedKey, isRepeatIgnored } from "./assign-press-model";

describe("held-down keys", () => {
  it("only moves repeat - a decision key held down acts once", () => {
    for (const key of ["delete", "backspace", "enter", "h", "u", "a", "e", "s", "z"]) expect(isRepeatIgnored(key, false), key).toBe(true);
    for (const key of ["j", "k", "arrowup", "arrowdown"]) expect(isRepeatIgnored(key, true), key).toBe(false);
    for (const key of ["arrowleft", "arrowright"]) expect(isRepeatIgnored(key, false), key).toBe(false);
  });
});

describe("keys kept behind a barrier", () => {
  it("are the moves and everything that needs a box", () => {
    for (const key of ["delete", "enter", "h", "u", "e", "a", "s", "arrowleft"]) expect(isQueuedKey(key, false), key).toBe(true);
    expect(isQueuedKey("j", true)).toBe(true);
    for (const key of ["v", "escape", "x", "?"]) expect(isQueuedKey(key, false), key).toBe(false);
  });
});
