// Assign Old 용지 필터 접기의 순수 모델 - 맞음은 제 모양, 곁은 한 줄 판, 먼 구간은 묶음 한 줄로 접는 계획을 만든다.

/** 접기 계산의 한 칸 - 짝 두 줄은 unitIds 둘인 한 item */
export interface FoldItem {
  key: string;
  unitIds: number[];
  section: string;
}

/** 펼침 상태 - runs는 펼친 묶음(묶음 첫 item key), peeks는 제 모양으로 엿본 item key */
export interface FoldOpen {
  runs: ReadonlySet<string>;
  peeks: ReadonlySet<string>;
}

export type FoldEntry =
  | { kind: "full"; key: string }
  | { kind: "peek"; key: string }
  | { kind: "line"; key: string; runKey: string | null }
  | { kind: "run"; runKey: string; count: number; from: string; to: string }
  /** memberKeys - 접기 손잡이가 엿보기를 함께 지울 묶음 안 item key들 */
  | { kind: "runHead"; runKey: string; memberKeys: string[] };

export const EMPTY_FOLD_OPEN: FoldOpen = { runs: new Set<string>(), peeks: new Set<string>() };

/** 맞음 여부는 matchIds만 본다(필터 스냅숏) - 상태가 바뀌어도 접힘이 흔들리지 않게 */
export function buildFoldPlan(
  items: readonly FoldItem[],
  matchIds: ReadonlySet<number>,
  open: FoldOpen,
  forceOpenIds: ReadonlySet<number> = new Set<number>(),
): FoldEntry[] {
  const count = items.length;
  const isMatch = items.map((item) => item.unitIds.some((id) => matchIds.has(id)));
  if (!isMatch.includes(true)) return [];
  const isForced = (item: FoldItem): boolean => item.unitIds.some((id) => forceOpenIds.has(id));

  const plan: FoldEntry[] = [];
  const pushSmall = (item: FoldItem, runKey: string | null): void => {
    plan.push(isForced(item) || open.peeks.has(item.key) ? { kind: "peek", key: item.key } : { kind: "line", key: item.key, runKey });
  };

  /** 강제 없는 묶음 - 한 개면 line, 펼쳤으면 runHead + line들, 아니면 묶음 한 줄 */
  const pushRun = (run: readonly FoldItem[]): void => {
    const runKey = run[0].key;
    if (run.length === 1) {
      pushSmall(run[0], null);
    } else if (open.runs.has(runKey)) {
      plan.push({ kind: "runHead", runKey, memberKeys: run.map((member) => member.key) });
      for (const member of run) pushSmall(member, runKey);
    } else {
      const sections = run.map((member) => member.section).filter((section) => section !== "");
      plan.push({
        kind: "run",
        runKey,
        count: run.reduce((sum, member) => sum + (member.unitIds.length || 1), 0),
        from: sections[0] ?? "",
        to: sections[sections.length - 1] ?? "",
      });
    }
  };

  let i = 0;
  while (i < count) {
    const item = items[i];
    if (isMatch[i]) {
      plan.push({ kind: "full", key: item.key });
      i += 1;
    } else if (isMatch[i - 1] || isMatch[i + 1]) {
      pushSmall(item, null);
      i += 1;
    } else {
      // 곁도 맞음도 아닌 이어진 구간 [i, end)
      let end = i + 1;
      while (end < count && !isMatch[end] && !isMatch[end - 1] && !isMatch[end + 1]) end += 1;
      const run = items.slice(i, end);
      if (open.runs.has(item.key) || !run.some(isForced)) {
        pushRun(run);
      } else {
        // 접힌 묶음 안의 고른 조각만 엿보기로 꺼내고 앞뒤는 제 묶음으로 - 접기를 눌러도 고른 조각 둘레가 다시 접히고, 큰 묶음을 통째로 펼치지 않는다
        let start = 0;
        run.forEach((member, at) => {
          if (!isForced(member)) return;
          if (at > start) pushRun(run.slice(start, at));
          plan.push({ kind: "peek", key: member.key });
          start = at + 1;
        });
        if (start < run.length) pushRun(run.slice(start));
      }
      i = end;
    }
  }
  return plan;
}
