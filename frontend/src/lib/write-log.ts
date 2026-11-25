// 이 화면이 쓴 뒤 아직 다시 읽지 않은 것 - 큐가 도는 동안 목록을 다시 받지 않으니, 다음 명령이 보낼 판단 revision과 받아 둔 관계 묶음이
// 아직 쓸 만한지를 여기서 안다(A1-R4). 다른 사람이 바꾼 것은 여기 없어 그대로 409로 잡힌다(doc-revision과 같은 생각).

interface SavedGroup {
  units: ReadonlyArray<{ unit_id: number; decision: { revision: number } }>;
  targets: ReadonlyArray<{ id: number; revision: number }>;
}

export interface WriteLog {
  /** 지금까지 쓴 횟수 - 받기를 시작할 때 적어 두었다가 mark에 준다 */
  now(): number;
  /** 저장 응답 - 새 revision을 적고, 실린 Unit · 새 문장이 든 묶음을 낡은 것으로 친다 */
  noteSaved(saved: SavedGroup): void;
  /** revision을 알려 주는 응답(한 번에 삭제) - 어느 묶음이 바뀌었는지는 모른다 */
  noteDecisions(decisions: ReadonlyArray<{ unit_id: number; decision: { revision: number } }>): void;
  /** 판단이 바뀌었으나 응답에 revision이 없다(배정 취소) - 보낼 때 묶음에서 읽는다 */
  noteUnknown(unitIds: readonly number[]): void;
  /** 무엇이 바뀌었는지 모르는 쓰기(편집 · 되돌리기 · 묶음 전체 일) */
  noteAll(): void;
  /** 보낼 판단 revision - 화면이 든 값과 응답으로 안 값 중 큰 것. null이면 모른다(묶음에서 읽는다) */
  pickRevision(unitId: number, seen: number): number | null;
  /**
   * 낙관 잠금에 실을 revision - 사람이 본 것(seen)과 이 화면이 쓴 것이 이긴다. 보내려고 방금 받은 묶음의 것(loaded)을 실으면 그 사이 남이 바꾼 것을
   * 보지도 않고 덮으니, 화면에 없던 단위와 이 화면이 방금 비워 revision을 모르는 단위에만 쓴다
   */
  resolveRevision(unitId: number, seen: ReadonlyMap<number, number>, loaded: number): number;
  /**
   * 새로 받은 묶음의 새 문장을, 누른 때 보고 있던 묶음(seen)의 revision으로 잠근다 - 이 화면이 그 뒤 쓴 것은 그 응답의 것.
   * 무엇이 바뀌었는지 모르는 쓰기가 그 사이 있었거나 보지 못한 문장이면 받은 그대로다
   */
  lockTargets<T extends { id: number; revision: number }>(loaded: readonly T[], seen: readonly SavedGroup[]): T[];
  /** 받은 묶음이 언제 부른 것인지 */
  mark(group: SavedGroup, at: number): void;
  /** 그 묶음을 부른 뒤 거기 든 것을 쓴 적이 없나 - 부른 때를 모르면 거짓 */
  isFresh(group: SavedGroup): boolean;
  /** 줄을 다시 받았다 - at 뒤에 쓴 것이 없으면 모르던 revision도 이제 화면 값이 맞다 */
  settle(at: number): void;
}

export function createWriteLog(): WriteLog {
  let tick = 0;
  let epoch = 0;
  const revisions = new Map<number, number>();
  const unknown = new Set<number>();
  const unitTicks = new Map<number, number>();
  const targetTicks = new Map<number, number>();
  const targetRevisions = new Map<number, number>();
  const marks = new WeakMap<SavedGroup, number>();

  function noteRevisions(decisions: ReadonlyArray<{ unit_id: number; decision: { revision: number } }>): void {
    for (const { unit_id, decision } of decisions) {
      unknown.delete(unit_id);
      if (decision.revision > (revisions.get(unit_id) ?? 0)) revisions.set(unit_id, decision.revision);
    }
  }
  function noteAll(): void {
    tick += 1;
    epoch = tick;
  }

  function pickRevision(unitId: number, seen: number): number | null {
    return unknown.has(unitId) ? null : Math.max(seen, revisions.get(unitId) ?? 0);
  }

  return {
    now: () => tick,
    noteSaved(saved) {
      tick += 1;
      noteRevisions(saved.units);
      for (const unit of saved.units) unitTicks.set(unit.unit_id, tick);
      for (const target of saved.targets) {
        targetTicks.set(target.id, tick);
        targetRevisions.set(target.id, Math.max(target.revision, targetRevisions.get(target.id) ?? 0));
      }
    },
    noteDecisions(decisions) {
      noteAll();
      noteRevisions(decisions);
    },
    noteUnknown(unitIds) {
      noteAll();
      for (const id of unitIds) unknown.add(id);
    },
    noteAll,
    pickRevision,
    resolveRevision: (unitId, seen, loaded) => pickRevision(unitId, seen.get(unitId) ?? loaded) ?? loaded,
    lockTargets(loaded, seen) {
      const seenRevisions = new Map(seen.filter((group) => (marks.get(group) ?? -1) >= epoch).flatMap((group) => group.targets.map((target) => [target.id, target.revision] as const)));
      return loaded.map((target) => {
        const revision = seenRevisions.get(target.id);
        return revision === undefined ? target : { ...target, revision: Math.max(revision, targetRevisions.get(target.id) ?? 0) };
      });
    },
    mark(group, at) {
      marks.set(group, at);
    },
    isFresh(group) {
      const at = marks.get(group);
      if (at === undefined || at < epoch) return false;
      return group.units.every((unit) => (unitTicks.get(unit.unit_id) ?? 0) <= at) && group.targets.every((target) => (targetTicks.get(target.id) ?? 0) <= at);
    },
    settle(at) {
      if (at === tick) unknown.clear();
    },
  };
}
