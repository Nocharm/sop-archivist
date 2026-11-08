// 여러 단위 배정 지우기 - 앞 단위를 지우면 같은 관계 묶음의 나머지가 보류로 바뀌며 revision이 오른다. 낡은 revision으로 409가 나지 않아야 한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; body?: unknown }> = [];
const revisions = new Map<number, number>();

vi.mock("./api", () => ({
  apiFetchBlob: vi.fn(),
  apiFetch: vi.fn(async (path: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path.endsWith("/decisions/clear")) {
      if (revisions.get(body.unit_id) !== body.revision) throw new Error(`409 revision_conflict for ${body.unit_id}`);
      // 서버처럼 - 첫 단위는 미배정, 같은 묶음의 다른 단위는 보류로 돌리며 revision을 올린다
      const others = [...revisions.keys()].filter((id) => id !== body.unit_id);
      for (const id of others) revisions.set(id, (revisions.get(id) ?? 0) + 1);
      revisions.delete(body.unit_id);
      return { reset_unit_ids: [body.unit_id], deleted_target_ids: [], held_unit_ids: others, held_target_ids: [] };
    }
    const unitId = Number(path.split("/").at(-1));
    return { units: [{ unit_id: unitId, decision: { revision: revisions.get(unitId) } }], targets: [] };
  }),
}));

const { clearDecisions } = await import("./api-sop");

beforeEach(() => {
  calls.length = 0;
  revisions.clear();
});

describe("clearDecisions", () => {
  it("re-reads the revision of units the previous clear put on hold", async () => {
    revisions.set(1, 3).set(2, 5);
    await clearDecisions(9, [{ unit_id: 1, revision: 3 }, { unit_id: 2, revision: 5 }]);
    expect(revisions.size).toBe(0);
    expect(calls.map((call) => call.path)).toEqual(["/bundles/9/decisions/clear", "/bundles/9/groups/by-unit/2", "/bundles/9/decisions/clear"]);
  });
});
