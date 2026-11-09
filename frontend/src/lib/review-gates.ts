// 검토 요청 조건을 카드로 나누는 규칙 - 막힌 것(Fail)을 위, 끝난 것(Pass)을 아래에 두고 각각 앞 몇 개만 보인다.

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
