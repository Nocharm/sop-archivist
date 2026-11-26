// 앱 안 이동 버퍼 - 연습 Bundle 주소(/bundles/-1/…)로는 가지 않고 알림만 띄운다(설계 2026-11-26-practice-page D13).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissToast, listToasts } from "@/components/ui/toast";

import { NAV_BUFFER_MS, bindNavRouter, getNavState, navigate } from "./nav-buffer";

let push: ReturnType<typeof vi.fn<(href: string) => void>>;
let unbind: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  push = vi.fn<(href: string) => void>();
  unbind = bindNavRouter(push, () => {});
});

afterEach(() => {
  unbind();
  for (const toast of listToasts()) dismissToast(toast.id);
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.documentElement.lang = "en";
});

describe("navigate", () => {
  it("goes to an ordinary address after the buffer", () => {
    navigate("/bundles/5/documents");
    vi.advanceTimersByTime(NAV_BUFFER_MS);
    expect(push).toHaveBeenCalledWith("/bundles/5/documents");
  });

  it("does not open the practice bundle's other stages and says so", () => {
    navigate("/bundles/-1/documents");
    vi.advanceTimersByTime(NAV_BUFFER_MS);
    expect(push).not.toHaveBeenCalled();
    expect(getNavState().phase).toBe("idle");
    expect(listToasts().map((toast) => [toast.text, toast.tone])).toEqual([["Not available in practice", "info"]]);
  });

  it("says it in the screen language", () => {
    document.documentElement.lang = "ko";
    navigate("/bundles/-1/tobe", { immediate: true });
    expect(push).not.toHaveBeenCalled();
    expect(listToasts()[0].text).toBe("연습에서는 안 됩니다");
  });
});
