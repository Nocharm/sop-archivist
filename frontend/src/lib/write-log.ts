// 이 화면이 쓴 뒤 아직 다시 읽지 않은 것 - 큐가 도는 동안 목록을 다시 받지 않으니, 다음 명령이 보낼 판단 revision과 받아 둔 관계 묶음이
// 아직 쓸 만한지를 여기서 안다(A1-R4). 다른 사람이 바꾼 것은 여기 없어 그대로 409로 잡힌다(doc-revision과 같은 생각).

interface SavedGroup {
  units: ReadonlyArray<{ unit_id: number; decision: { revision: number } }>;
  targets: ReadonlyArray<{ id: number }>;
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

  return {
    now: () => tick,
    noteSaved(saved) {
      tick += 1;
      noteRevisions(saved.units);
      for (const unit of saved.units) unitTicks.set(unit.unit_id, tick);
      for (const target of saved.targets) targetTicks.set(target.id, tick);
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
    pickRevision: (unitId, seen) => (unknown.has(unitId) ? null : Math.max(seen, revisions.get(unitId) ?? 0)),
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
