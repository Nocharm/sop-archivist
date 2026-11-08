// 불러오기 훅 - 다시 불러오다 실패해도 이전 데이터를 지우지 않고 오류만 알린다(화면이 통째로 오류 문구로 바뀌지 않게).
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useLoaded, type Loaded } from "./use-loaded";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box: { loaded: Loaded<string> | null } = { loaded: null };
let answers: Array<() => Promise<string>> = [];

function Harness() {
  const loaded = useLoaded(() => (answers.shift() ?? (() => Promise.resolve("?")))(), "k");
  useEffect(() => {
    box.loaded = loaded;
  });
  return null;
}

describe("useLoaded", () => {
  it("keeps the last data when a reload fails and reports the error", async () => {
    answers = [() => Promise.resolve("first"), () => Promise.reject(new Error("offline"))];
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    expect(box.loaded?.data).toBe("first");
    await act(async () => box.loaded?.reload());
    expect(box.loaded?.data).toBe("first");
    expect(box.loaded?.error).toBeInstanceOf(Error);
    act(() => root.unmount());
  });
});
