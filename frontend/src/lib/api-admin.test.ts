// 관리 API 헬퍼 단위 테스트 - 각 함수가 맞는 메서드·경로·본문으로 fetch를 부르는지, 검색어·로그인 ID가 주소에 안전하게 실리는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addGrant,
  createRole,
  deleteRole,
  getAiUsage,
  getEffective,
  getHrSyncPreview,
  listAudit,
  listBatchRuns,
  listDepartments,
  listGrants,
  listHrSyncRuns,
  listRoles,
  pingAi,
  removeGrant,
  runHrSync,
  searchDirectory,
  setAuthToken,
  updateRole,
} from "./api";

function stubFetch(status = 200, body: unknown = []) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// 마지막 호출의 [주소, 메서드, 본문]
function getLastCall(fetchMock: ReturnType<typeof stubFetch>): [string, string, unknown] {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  return [String(url), init?.method ?? "GET", body];
}

beforeEach(() => {
  setAuthToken(null);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("access helpers", () => {
  it("lists roles", async () => {
    const fetchMock = stubFetch();
    await listRoles();
    expect(getLastCall(fetchMock)).toEqual(["/api/access/roles", "GET", undefined]);
  });

  it("creates and updates a role with the whole form body", async () => {
    const body = { name: "Smoke Role", description: "", permissions: ["system.view"] };
    const created = stubFetch(201, {});
    await createRole(body);
    expect(getLastCall(created)).toEqual(["/api/access/roles", "POST", body]);

    const updated = stubFetch(200, {});
    await updateRole(7, body);
    expect(getLastCall(updated)).toEqual(["/api/access/roles/7", "PUT", body]);
  });

  it("deletes a role", async () => {
    const fetchMock = stubFetch(204);
    await deleteRole(7);
    expect(getLastCall(fetchMock)).toEqual(["/api/access/roles/7", "DELETE", undefined]);
  });

  it("lists, adds and removes grants", async () => {
    const listed = stubFetch();
    await listGrants();
    expect(getLastCall(listed)).toEqual(["/api/access/grants", "GET", undefined]);

    const body = { subject_type: "dept" as const, subject_id: "DIV-QA", permission: "ai.admin" };
    const added = stubFetch(201, {});
    await addGrant(body);
    expect(getLastCall(added)).toEqual(["/api/access/grants", "POST", body]);

    const removed = stubFetch(204);
    await removeGrant(4);
    expect(getLastCall(removed)).toEqual(["/api/access/grants/4", "DELETE", undefined]);
  });

  it("passes the audit limit only when given", async () => {
    const withoutLimit = stubFetch();
    await listAudit();
    expect(getLastCall(withoutLimit)[0]).toBe("/api/access/audit");

    const withLimit = stubFetch();
    await listAudit(50);
    expect(getLastCall(withLimit)[0]).toBe("/api/access/audit?limit=50");
  });

  it("encodes the login id of an effective lookup", async () => {
    const fetchMock = stubFetch(200, {});
    await getEffective("a/b c");
    expect(getLastCall(fetchMock)[0]).toBe("/api/access/effective/a%2Fb%20c");
  });
});

describe("directory helpers", () => {
  it("searches with an encoded query and the server's 50 cap", async () => {
    const fetchMock = stubFetch();
    await searchDirectory("김 & lee");
    expect(getLastCall(fetchMock)[0]).toBe(`/api/directory?q=${encodeURIComponent("김 & lee")}&limit=50`);
  });

  it("lists departments", async () => {
    const fetchMock = stubFetch();
    await listDepartments();
    expect(getLastCall(fetchMock)).toEqual(["/api/departments", "GET", undefined]);
  });
});

describe("ops helpers", () => {
  it("runs, previews and lists HR sync", async () => {
    const run = stubFetch(200, {});
    await runHrSync();
    expect(getLastCall(run)).toEqual(["/api/admin/hr-sync", "POST", undefined]);

    const preview = stubFetch(200, {});
    await getHrSyncPreview();
    expect(getLastCall(preview)).toEqual(["/api/admin/hr-sync/preview", "GET", undefined]);

    const runs = stubFetch();
    await listHrSyncRuns();
    expect(getLastCall(runs)).toEqual(["/api/admin/hr-sync/runs", "GET", undefined]);
  });

  it("lists batch runs", async () => {
    const fetchMock = stubFetch();
    await listBatchRuns();
    expect(getLastCall(fetchMock)[0]).toBe("/api/admin/batch-runs");
  });

  it("pings the AI and reads usage with an optional day range", async () => {
    const ping = stubFetch(200, {});
    await pingAi();
    expect(getLastCall(ping)).toEqual(["/api/admin/ai/ping", "POST", undefined]);

    const defaultDays = stubFetch();
    await getAiUsage();
    expect(getLastCall(defaultDays)[0]).toBe("/api/admin/ai/usage");

    const sevenDays = stubFetch();
    await getAiUsage(7);
    expect(getLastCall(sevenDays)[0]).toBe("/api/admin/ai/usage?days=7");
  });
});
