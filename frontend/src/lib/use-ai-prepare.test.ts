// 배정 화면 첫 진입 - 고칠 수 있고 Old 문서가 정해지면 묶음마다 한 번 prepare를 부르고, 쌓인 것이 있을 때만 알리며, 실패는 말없이 넘긴다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiRequestOut } from "./api-manage";

const prepareAi = vi.fn<(bundleId: number, documentId?: number) => Promise<AiRequestOut>>();
vi.mock("./api-manage", () => ({ prepareAi: (bundleId: number, documentId?: number) => prepareAi(bundleId, documentId) }));
const pokeAiJobs = vi.fn<() => void>();
vi.mock("./ai-jobs-store", () => ({ pokeAiJobs: () => pokeAiJobs() }));

const { ApiError } = await import("./api");
const { useAiPrepare } = await import("./use-ai-prepare");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeOut(queued: number): AiRequestOut {
  return { queued, request_id: queued > 0 ? "r1" : null, skipped_total: 0, skipped: [], skipped_by_reason: {} };
}

interface HarnessProps {
  bundleId: number;
  enabled: boolean;
  documentId: number | null;
  onQueued: (queued: number) => void;
}

function Harness({ bundleId, enabled, documentId, onQueued }: HarnessProps) {
  // 화면처럼 렌더마다 새 콜백을 넘긴다 - 콜백이 바뀌어도 다시 부르지 않아야 한다
  useAiPrepare(bundleId, { enabled, documentId, onQueued: (n) => onQueued(n) });
  return null;
}

let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

async function render(props: HarnessProps) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
}

beforeEach(() => {
  prepareAi.mockReset();
  pokeAiJobs.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  warn.mockRestore();
});

describe("useAiPrepare", () => {
  it("calls prepare once per bundle when enabled and a document is open", async () => {
    prepareAi.mockResolvedValue(makeOut(0));
    const onQueued = vi.fn();

    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    await render({ bundleId: 1, enabled: true, documentId: 6, onQueued });
    await render({ bundleId: 2, enabled: true, documentId: 7, onQueued });

    // 다시 그려도, 문서가 바뀌어도 그 묶음에서는 한 번 - 다른 묶음은 따로 한 번
    expect(prepareAi.mock.calls).toEqual([
      [1, 5],
      [2, 7],
    ]);
  });

  it("does not call while disabled or before a document is known", async () => {
    prepareAi.mockResolvedValue(makeOut(0));
    const onQueued = vi.fn();

    await render({ bundleId: 1, enabled: false, documentId: 5, onQueued });
    await render({ bundleId: 1, enabled: true, documentId: null, onQueued });
    expect(prepareAi).not.toHaveBeenCalled();

    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    expect(prepareAi.mock.calls).toEqual([[1, 5]]);
  });

  it("reports only when something was queued", async () => {
    prepareAi.mockResolvedValueOnce(makeOut(0)).mockResolvedValueOnce(makeOut(3));
    const onQueued = vi.fn();

    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    expect(onQueued).not.toHaveBeenCalled();

    await render({ bundleId: 2, enabled: true, documentId: 7, onQueued });
    expect(onQueued.mock.calls).toEqual([[3]]);
  });

  it.each([403, 409, 503])("stays silent on %i", async (status) => {
    prepareAi.mockRejectedValue(new ApiError(status, "refused"));
    const onQueued = vi.fn();

    // 거절은 처리되지 않은 오류로 새어 나가지 않는다(새면 vitest가 실행을 실패로 친다)
    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });

    expect(prepareAi).toHaveBeenCalledTimes(1);
    expect(onQueued).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(pokeAiJobs).not.toHaveBeenCalled();
  });

  it("leaves a console trace for an unexpected failure without telling the person", async () => {
    prepareAi.mockRejectedValue(new ApiError(500, "server bug"));
    const onQueued = vi.fn();

    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onQueued).not.toHaveBeenCalled();
  });

  it("wakes the jobs poller after every successful prepare, even when only a plan was queued", async () => {
    prepareAi.mockResolvedValueOnce(makeOut(0)).mockResolvedValueOnce(makeOut(2));
    const onQueued = vi.fn();

    await render({ bundleId: 1, enabled: true, documentId: 5, onQueued });
    expect(pokeAiJobs).toHaveBeenCalledTimes(1);
    expect(onQueued).not.toHaveBeenCalled(); // onQueued는 그대로 queued > 0일 때만

    await render({ bundleId: 2, enabled: true, documentId: 7, onQueued });
    expect(pokeAiJobs).toHaveBeenCalledTimes(2);
    expect(onQueued.mock.calls).toEqual([[2]]);
  });
});
