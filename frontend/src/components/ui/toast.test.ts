// 토스트 쌓기 - 새 것이 위(앞)에 오고, 같은 문구는 앞의 것을 지우며, 넘치면 가장 오래된 것부터 빠진다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissToast, getToastMs, holdToast, listToasts, pushToast, releaseToast, runToastAction, showToast, type Toast } from "./toast";

function makeToast(id: string, text = id): Toast {
  return { id, tone: "ok", text, leaving: false };
}

describe("pushToast", () => {
  it("puts the newest toast on top", () => {
    expect(pushToast([makeToast("a"), makeToast("b")], makeToast("c")).map((toast) => toast.id)).toEqual(["c", "a", "b"]);
  });

  it("replaces a toast with the same text", () => {
    expect(pushToast([makeToast("a", "Saved"), makeToast("b")], makeToast("c", "Saved")).map((toast) => toast.id)).toEqual(["c", "b"]);
  });

  it("drops the oldest past the limit", () => {
    const list = ["d", "c", "b", "a"].map((id) => makeToast(id));
    expect(pushToast(list, makeToast("e")).map((toast) => toast.id)).toEqual(["e", "d", "c", "b"]);
  });
});

describe("toast actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const toast of listToasts()) dismissToast(toast.id);
    vi.runAllTimers();
  });
  afterEach(() => vi.useRealTimers());
  const top = () => listToasts()[0];
  const action = { label: "Undo", run: () => undefined };

  it("keeps a plain toast as it was - three seconds, no action", () => {
    showToast("Saved");
    expect(listToasts()).toMatchObject([{ text: "Saved", tone: "ok", leaving: false }]);
    expect(top().action).toBeUndefined();
    vi.advanceTimersByTime(2999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
    vi.advanceTimersByTime(480);
    expect(listToasts()).toEqual([]);
  });

  it("gives an action toast ten seconds whatever its tone, and a set duration wins", () => {
    expect([getToastMs("ok"), getToastMs("error"), getToastMs("info")]).toEqual([3000, 7000, 6000]);
    expect([getToastMs("ok", { action }), getToastMs("error", { action }), getToastMs("ok", { action, durationMs: 1500 })]).toEqual([10000, 10000, 1500]);
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    vi.advanceTimersByTime(9999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
  });

  it("runs the action once and closes the toast", () => {
    const run = vi.fn();
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action: { label: "Undo", run } });
    const { id } = top();
    runToastAction(id);
    runToastAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(top().leaving).toBe(true);
    vi.advanceTimersByTime(480);
    expect(listToasts()).toEqual([]);
  });

  it("stays while held and leaves three seconds after release", () => {
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    const { id } = top();
    holdToast(id);
    vi.advanceTimersByTime(60000);
    expect(top().leaving).toBe(false);
    releaseToast(id);
    vi.advanceTimersByTime(2999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
  });

  it("stacks action toasts with different texts, and a replaced one can no longer run", () => {
    const first = vi.fn();
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action: { label: "Undo", run: first } });
    const firstId = top().id;
    showToast("Paired OLD-3-005 + OLD-3-012", "ok", { action });
    expect(listToasts().map((toast) => toast.text)).toEqual(["Paired OLD-3-005 + OLD-3-012", "Paired OLD-3-004 + OLD-3-011"]);
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });   // 같은 글 - 앞의 것을 지운다(지금 규칙)
    expect(listToasts()).toHaveLength(2);
    runToastAction(firstId);
    expect(first).not.toHaveBeenCalled();
  });

  it("stays while focus is inside even after the pointer leaves, and leaves three seconds after focus goes", () => {
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    const { id } = top();
    holdToast(id, "focus");
    holdToast(id, "pointer");
    releaseToast(id, "pointer");
    vi.advanceTimersByTime(60000);
    expect(top().leaving).toBe(false);
    releaseToast(id, "focus");
    vi.advanceTimersByTime(2999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
  });

  it("stays while the pointer is on it even after focus leaves", () => {
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    const { id } = top();
    holdToast(id, "pointer");
    holdToast(id, "focus");
    releaseToast(id, "focus");
    vi.advanceTimersByTime(60000);
    expect(top().leaving).toBe(false);
    releaseToast(id, "pointer");
    vi.advanceTimersByTime(3000);
    expect(top().leaving).toBe(true);
  });
});
