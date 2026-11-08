// 묶음 캐시 - 화면에 들어올 때마다 다시 불러오고, 나중에 시작한 요청(또는 저장 응답)이 먼저 시작한 요청을 이긴다.
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bundle } from "./api-sop";

const getBundle = vi.fn<(id: number) => Promise<Bundle>>();
vi.mock("./api-sop", () => ({ getBundle: (id: number) => getBundle(id) }));

const { clearBundleStore, loadBundle, putBundle, useBundle } = await import("./bundle-store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeBundle(id: number, status: Bundle["status"], revision: number): Bundle {
  return { id, status, revision } as Bundle;
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const screen: { bundle: Bundle | null } = { bundle: null };

function Screen({ bundleId }: { bundleId: number }) {
  const { bundle } = useBundle(bundleId);
  useEffect(() => {
    screen.bundle = bundle;
  }, [bundle]);
  return null;
}

async function mountScreen(bundleId: number) {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Screen, { bundleId })));
  return root;
}

beforeEach(() => {
  getBundle.mockReset();
  screen.bundle = null;
});

describe("bundle store", () => {
  it("loads again on every screen entry, so a returned bundle is not stuck in review", async () => {
    getBundle.mockResolvedValueOnce(makeBundle(11, "in_review", 3));
    const first = await mountScreen(11);
    expect(screen.bundle?.status).toBe("in_review");
    act(() => first.unmount());

    getBundle.mockResolvedValueOnce(makeBundle(11, "in_progress", 4));
    const second = await mountScreen(11);
    expect(getBundle).toHaveBeenCalledTimes(2);
    expect(screen.bundle).toMatchObject({ status: "in_progress", revision: 4 });
    act(() => second.unmount());
  });

  it("lets a load started after a change win over an older one still in flight", async () => {
    const older = defer<Bundle>();
    const newer = defer<Bundle>();
    getBundle.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const root = await mountScreen(12);
    const after = loadBundle(12);
    await act(async () => {
      newer.resolve(makeBundle(12, "in_progress", 9));
      await after;
      older.resolve(makeBundle(12, "in_progress", 8));
      await older.promise;
    });
    expect(getBundle).toHaveBeenCalledTimes(2);
    expect(screen.bundle?.revision).toBe(9);
    act(() => root.unmount());
  });

  it("keeps a saved bundle over an older load that finishes later", async () => {
    const older = defer<Bundle>();
    getBundle.mockReturnValueOnce(older.promise);
    const root = await mountScreen(13);
    await act(async () => {
      putBundle(makeBundle(13, "in_review", 6));
      older.resolve(makeBundle(13, "in_progress", 5));
      await older.promise;
    });
    expect(screen.bundle).toMatchObject({ status: "in_review", revision: 6 });
    act(() => root.unmount());
  });

  it("forgets every bundle on sign-out or user switch, including a load still in flight", async () => {
    const older = defer<Bundle>();
    getBundle.mockReturnValueOnce(older.promise);
    const root = await mountScreen(14);
    await act(async () => {
      clearBundleStore();
      older.resolve(makeBundle(14, "in_progress", 1));
      await older.promise;
    });
    expect(screen.bundle).toBeNull();
    act(() => root.unmount());
  });
});
