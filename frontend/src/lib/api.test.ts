// api 단위 테스트 - apiFetch의 인증 헤더 선택·오류 detail 추출·204/네트워크 처리를 fetch 스텁으로 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiFetchBlobWithName, readDispositionFileName, setAuthToken } from "./api";

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchRejecting(reason: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  const headers = fetchMock.mock.calls[0]?.[1]?.headers;
  // apiFetch는 headers를 일반 객체로 보낸다
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    throw new Error("expected plain-object headers");
  }
  return headers;
}

beforeEach(() => {
  setAuthToken(null);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch auth headers", () => {
  it("sends bearer when token set", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    window.localStorage.setItem("sopa.devUser", "qa.lead"); // 토큰이 있으면 dev 헤더는 보내지 않는다
    setAuthToken("t");
    await apiFetch("/me");
    const headers = sentHeaders(fetchMock);
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers["X-Dev-User"]).toBeUndefined();
  });

  it("sends X-Dev-User without token", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    window.localStorage.setItem("sopa.devUser", "qa.lead");
    await apiFetch("/me");
    const headers = sentHeaders(fetchMock);
    expect(headers["X-Dev-User"]).toBe("qa.lead");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends no identity header when neither token nor dev user exists", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    await apiFetch("/me");
    const headers = sentHeaders(fetchMock);
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Dev-User"]).toBeUndefined();
  });
});

describe("apiFetch request", () => {
  it("prefixes /api and returns the parsed JSON body", async () => {
    const fetchMock = stubFetch(jsonResponse({ login_id: "qa.lead" }));
    const me = await apiFetch<{ login_id: string }>("/me");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me");
    expect(me.login_id).toBe("qa.lead");
  });

  it("sets a JSON content type only when a string body is sent", async () => {
    const withBody = stubFetch(jsonResponse({}));
    await apiFetch("/access/roles", { method: "POST", body: JSON.stringify({ name: "x" }) });
    expect(sentHeaders(withBody)["Content-Type"]).toBe("application/json");

    const withoutBody = stubFetch(jsonResponse({}));
    await apiFetch("/me");
    expect(sentHeaders(withoutBody)["Content-Type"]).toBeUndefined();
  });

  it("returns undefined for 204", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/access/roles/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("apiFetch errors", () => {
  it("throws ApiError with status and detail", async () => {
    stubFetch(jsonResponse({ detail: "missing permission: ai.admin" }, 403));
    const err = await apiFetch("/admin/ai/ping", { method: "POST" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).detail).toBe("missing permission: ai.admin");
  });

  it("keeps a rule rejection's code and context", async () => {
    stubFetch(jsonResponse({ detail: { code: "revision_conflict", conflicts: [{ id: 3 }] } }, 409));
    const err = await apiFetch("/bundles/1", { method: "PATCH" }).catch((e: unknown) => e);
    expect((err as ApiError).detail).toBe("revision_conflict");
    expect((err as ApiError).rule).toEqual({ code: "revision_conflict", conflicts: [{ id: 3 }] });
  });

  it("joins validation detail", async () => {
    stubFetch(jsonResponse({ detail: [{ msg: "a" }, { msg: "b" }] }, 422));
    const err = await apiFetch("/access/roles", { method: "POST" }).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).detail).toBe("a; b");
  });

  it("keeps the raw text as detail when the body is not JSON", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await apiFetch("/me").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).detail).toBe("<html>bad gateway</html>");
  });

  it("turns a network failure into ApiError with status 0", async () => {
    stubFetchRejecting(new TypeError("Failed to fetch"));
    const err = await apiFetch("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).detail).toBe("Failed to fetch");
  });

  it("lets an aborted request through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    stubFetchRejecting(abort);
    await expect(apiFetch("/me")).rejects.toBe(abort);
  });
});

describe("readDispositionFileName", () => {
  it("reads the UTF-8 file name from Content-Disposition", () => {
    expect(readDispositionFileName(`attachment; filename="BND-0004____20261113-0905.xlsx"; filename*=UTF-8''BND-0004_%EC%A0%9C%EB%AA%A9_20261113-0905.xlsx`)).toBe("BND-0004_제목_20261113-0905.xlsx");
    expect(readDispositionFileName(`attachment; filename="a.xlsx"`)).toBe("a.xlsx");
    expect(readDispositionFileName(null)).toBeNull();
  });
});

describe("apiFetchBlobWithName", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the blob with the name the server built", async () => {
    stubFetch(new Response("x", { headers: { "Content-Disposition": `attachment; filename="a.xlsx"` } }));
    const result = await apiFetchBlobWithName("/bundles/1/export.xlsx");
    expect(result.fileName).toBe("a.xlsx");
    expect(await result.blob.text()).toBe("x");
  });
});
