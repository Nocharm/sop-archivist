// 풀기 전환의 순수 계산 - 단계 차례와 되돌리기, 줄마다 늦춤과 그 상한, 화면 안 키만 움직이기, 가로·세로 거리, 표시의 움직임.
import { describe, expect, it } from "vitest";

import {
  buildMarkerKeyframes,
  computeAnchoredScrollTop,
  computeStaggerDelays,
  computeUnwrapShifts,
  getSpreadEnd,
  parseDurationMs,
  pickOnScreenKeys,
  pickScrollAnchor,
  planUnwrapPhases,
  type MotionBox,
  type UnwrapTimings,
} from "./unwrap-motion";

const TIMINGS: UnwrapTimings = { clear: 160, spread: 520, attach: 200, staggerStep: 28, staggerMax: 280 };

function box(left: number, top: number, height = 20): MotionBox {
  return { left, top, bottom: top + height };
}

describe("parseDurationMs", () => {
  it("reads milliseconds and seconds the way CSS writes them", () => {
    expect(parseDurationMs("160ms")).toBe(160);
    expect(parseDurationMs(" 520ms ")).toBe(520);
    expect(parseDurationMs(".52s")).toBe(520);
    expect(parseDurationMs("0ms")).toBe(0);
  });

  it("gives 0 for a missing token so nothing moves", () => {
    expect(parseDurationMs("")).toBe(0);
  });
});

describe("planUnwrapPhases", () => {
  it("clears the leaving marks first and attaches the arriving marks last", () => {
    expect(planUnwrapPhases(TIMINGS, false)).toEqual({
      before: { marker: "leave", duration: 160, easing: "exit" },
      after: { marker: "enter", duration: 200, easing: "pop" },
      direction: "normal",
    });
  });

  it("walks the same path backwards on reverse", () => {
    // 붙였던 것이 먼저 사라지고 걷었던 것이 마지막에 돌아온다 - 시간과 곡선은 그 표시의 것 그대로, 트는 방향만 거꾸로
    expect(planUnwrapPhases(TIMINGS, true)).toEqual({
      before: { marker: "enter", duration: 200, easing: "pop" },
      after: { marker: "leave", duration: 160, easing: "exit" },
      direction: "reverse",
    });
  });
});

describe("buildMarkerKeyframes", () => {
  it("ends a leaving mark hidden and starts an arriving mark hidden", () => {
    expect(buildMarkerKeyframes("leave", "")).toEqual([{ offset: 1, opacity: 0 }]);
    expect(buildMarkerKeyframes("enter", "")).toEqual([{ offset: 0, opacity: 0, transform: "scale(0.8)" }]);
  });

  it("moves only the frame and keeps the text for a frame mark", () => {
    const hidden = { borderColor: "transparent", backgroundColor: "transparent", boxShadow: "none" };
    expect(buildMarkerKeyframes("leave", "frame")).toEqual([{ offset: 1, ...hidden }]);
    expect(buildMarkerKeyframes("enter", "frame")).toEqual([{ offset: 0, ...hidden }]);
  });
});

describe("pickOnScreenKeys", () => {
  const view = { top: 0, bottom: 600 };

  it("keeps keys that start or end inside the view", () => {
    const first = { boxes: new Map([["in", box(0, 100)], ["leaves", box(0, 580)], ["arrives", box(0, 700)], ["far", box(0, 5000)]]), view };
    const last = { boxes: new Map([["in", box(0, 140)], ["leaves", box(0, 640)], ["arrives", box(0, 590)], ["far", box(0, 5060)]]), view };
    expect([...pickOnScreenKeys(first, last)]).toEqual(["in", "leaves", "arrives"]);
  });

  it("leaves out keys measured on one side only", () => {
    // 새로 생긴 줄이나 화면 밖 덩어리에 있어 재지 않은 줄
    const first = { boxes: new Map([["gone", box(0, 100)]]), view };
    const last = { boxes: new Map([["new", box(0, 100)]]), view };
    expect(pickOnScreenKeys(first, last).size).toBe(0);
  });

  it("judges each side by the view it was measured in", () => {
    // 바꾸는 사이에 화면이 굴렀다 - 끝 자리는 새 범위로 본다
    const first = { boxes: new Map([["a", box(0, 900)]]), view };
    const last = { boxes: new Map([["a", box(0, 950)]]), view: { top: 400, bottom: 1000 } };
    expect([...pickOnScreenKeys(first, last)]).toEqual(["a"]);
  });
});

describe("computeUnwrapShifts", () => {
  it("gives the distance back to the old place on both axes", () => {
    const first = new Map([["cell", box(200, 100)], ["down", box(0, 160)], ["still", box(0, 40)]]);
    const last = new Map([["cell", box(20, 140)], ["down", box(0, 220)], ["still", box(0, 40)]]);
    expect(computeUnwrapShifts(first, last, new Set(["cell", "down", "still"]))).toEqual(
      new Map([
        ["cell", { dx: 180, dy: -40 }],
        ["down", { dx: 0, dy: -60 }],
      ]),
    );
  });

  it("skips keys that were not picked", () => {
    const first = new Map([["a", box(0, 100)], ["far", box(0, 5000)]]);
    const last = new Map([["a", box(0, 130)], ["far", box(0, 5030)]]);
    expect([...computeUnwrapShifts(first, last, new Set(["a"])).keys()]).toEqual(["a"]);
  });
});

describe("computeStaggerDelays", () => {
  it("starts the top row first and each row below 28 ms later", () => {
    const tops = new Map([["c", 180], ["a", 100], ["b", 140]]);
    expect(computeStaggerDelays(tops, TIMINGS)).toEqual(new Map([["a", 0], ["b", 28], ["c", 56]]));
  });

  it("counts things on one line as one row", () => {
    // 번호 칸(102)과 글(100)은 한 줄이다
    const tops = new Map([["text", 100], ["number", 102], ["next", 130]]);
    expect(computeStaggerDelays(tops, TIMINGS)).toEqual(new Map([["text", 0], ["number", 0], ["next", 28]]));
  });

  it("stops adding delay at 280 ms", () => {
    const tops = new Map(Array.from({ length: 14 }, (_, row) => [`r${row}`, row * 30] as const));
    const delays = computeStaggerDelays(tops, TIMINGS);
    expect(delays.get("r10")).toBe(280);
    expect(delays.get("r11")).toBe(280);
    expect(delays.get("r13")).toBe(280);
  });

  it("mirrors the order on reverse so the bottom row leaves first", () => {
    const tops = new Map([["a", 100], ["b", 140], ["c", 180]]);
    expect(computeStaggerDelays(tops, TIMINGS, true)).toEqual(new Map([["a", 56], ["b", 28], ["c", 0]]));
  });

  it("mirrors a capped run inside the same 280 ms", () => {
    const tops = new Map(Array.from({ length: 14 }, (_, row) => [`r${row}`, row * 30] as const));
    const delays = computeStaggerDelays(tops, TIMINGS, true);
    expect(delays.get("r0")).toBe(280);
    expect(delays.get("r9")).toBe(28);
    expect(delays.get("r13")).toBe(0);
  });
});

describe("getSpreadEnd", () => {
  it("ends when the latest row lands", () => {
    expect(getSpreadEnd(new Map([["a", 0], ["b", 56]]), 520)).toBe(576);
  });

  it("is 0 when nothing moves so the marks attach at once", () => {
    expect(getSpreadEnd(new Map(), 520)).toBe(0);
  });
});

describe("pickScrollAnchor - 바꾸는 동안 지킬 자리(B3)", () => {
  const view = { top: 100, bottom: 700 };

  it("표 윗변이 칸에 보이면 표 머리를 기준으로", () => {
    const anchor = pickScrollAnchor(new Map([["t1", box(0, 300, 200)]]), new Map([["a", box(0, 120)]]), view);
    expect(anchor).toEqual({ attribute: "data-unwrap-scope", value: "t1", top: 300 });
  });

  it("표 머리가 칸 위로 지나갔으면 칸 윗변에 걸친 글 줄", () => {
    const lines = new Map([["above", box(0, 60)], ["cross", box(0, 90, 30)], ["below", box(0, 140)]]);
    expect(pickScrollAnchor(new Map([["t1", box(0, -400, 900)]]), lines, view)).toEqual({ attribute: "data-flip-key", value: "cross", top: 90 });
  });

  it("걸친 줄이 없으면 칸 안 맨 위 글 줄, 칸 밖 줄은 고르지 않는다", () => {
    const lines = new Map([["low", box(0, 400)], ["high", box(0, 150)], ["out", box(0, 800)]]);
    expect(pickScrollAnchor(new Map(), lines, view)).toEqual({ attribute: "data-flip-key", value: "high", top: 150 });
  });

  it("안쪽 띠 표는 바깥 표 머리가 안 보일 때 다음 차례", () => {
    const scopes = new Map([["t1", box(0, 50, 600)], ["t2", box(0, 200, 40)]]);
    expect(pickScrollAnchor(scopes, new Map(), view)?.value).toBe("t2");
  });

  it("칸에 아무것도 없으면 null - 스크롤을 건드리지 않는다", () => {
    expect(pickScrollAnchor(new Map(), new Map([["far", box(0, 2000)]]), view)).toBeNull();
  });
});

describe("computeAnchoredScrollTop - 기준 요소를 같은 높이로", () => {
  it("기준이 아래로 밀렸으면 그만큼 더 내리고, 올라왔으면 덜 내린다", () => {
    expect(computeAnchoredScrollTop(1000, 300, 420)).toBe(1120);
    expect(computeAnchoredScrollTop(1000, 300, 250)).toBe(950);
    expect(computeAnchoredScrollTop(1000, 300, 300)).toBe(1000);
  });
});
