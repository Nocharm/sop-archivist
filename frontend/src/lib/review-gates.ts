// 검토 요청 조건을 카드로 나누는 규칙 - 막힌 것(Fail)을 위, 끝난 것(Pass)을 아래에 두고 각각 앞 몇 개만 보인다.
import type { StageKey } from "@/lib/stages";

export type GateKey = "documents" | "boundaries" | "units" | "targets" | "warnings" | "reasons" | "semantic" | "reviewer";

/** 막힌 조건을 푸는 화면 - Fail 카드를 누르면 여기로 간다. 검토자 조건은 화면이 아니라 멤버 창이라 null */
export const GATE_STAGE: Record<GateKey, StageKey | null> = {
  documents: "documents",
  boundaries: "split",
  units: "assign",
  targets: "assign",
  warnings: "split",
  reasons: "assign",
  semantic: "outputs",
  reviewer: null,
};

export interface GateSplit<T> {
  fail: T[];
  pass: T[];
  failHidden: number;
  passHidden: number;
}

export function splitGates<T extends { ok: boolean }>(gates: readonly T[], visible = 3): GateSplit<T> {
  const fail = gates.filter((gate) => !gate.ok);
  const pass = gates.filter((gate) => gate.ok);
  return {
    fail: fail.slice(0, visible),
    pass: pass.slice(0, visible),
    failHidden: Math.max(0, fail.length - visible),
    passHidden: Math.max(0, pass.length - visible),
  };
}
