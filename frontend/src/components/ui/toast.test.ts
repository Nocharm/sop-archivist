// 토스트 쌓기 - 새 것이 위(앞)에 오고, 같은 문구는 앞의 것을 지우며, 넘치면 가장 오래된 것부터 빠진다.
import { describe, expect, it } from "vitest";

import { pushToast, type Toast } from "./toast";

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
