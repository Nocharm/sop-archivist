"""EQUIS 조회 클라이언트 테스트 — 웹훅은 `_post` 바꿔치기로 흉내 낸다(HTTP 없음). 값은 모두 합성이다(설계 §5·§10)."""

import asyncio

import httpx2
import pytest

from app.equis import client as equis_client
from app.equis.client import EquisUnavailable, fetch_rows, is_sendable_number
from app.settings import settings

WHERE_QUERY = "SELECT TOP 500 * FROM [edw].[EQUIS_DOCUMENT] WHERE [DOC_DOCUMENT_NUMBER] = N'SOP-ABC-00001'"


def make_raw(number: str = "SOP-ABC-00001", version: str = "14.0", **extra: object) -> dict[str, object]:
    raw: dict[str, object] = {
        "DOC_DOCUMENT_NUMBER": number, "DOC_DOCUMENT_ID": "900001", "DOC_VERSION": version,
        "DOC_DOCUMENT_STATUS": "Effective", "DOC_LIFECYCLE": "Draft to Effective Lifecycle",
        "DOC_DOCUMENT_NAME": "Operation and Maintenance of UV spectrophotometer",
    }
    raw.update(extra)
    return raw


@pytest.fixture(autouse=True)
def equis_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "n8n_query_url", "http://n8n.test/webhook/dbv-query")
    monkeypatch.setattr(settings, "equis_edw_table", "edw.EQUIS_DOCUMENT")
    monkeypatch.setattr(settings, "equis_doc_url_base", "https://equis.test")


def patch_post(monkeypatch: pytest.MonkeyPatch, replies: list[object]) -> list[dict]:
    """`_post`를 차례로 답하는 가짜로 바꾼다 — 예외 객체는 던지고 나머지는 돌려준다. 받은 본문 목록을 돌려준다."""
    sent: list[dict] = []
    queue = list(replies)

    async def fake_post(payload: dict) -> object:
        sent.append(payload)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(equis_client, "_post", fake_post)
    return sent


def test_sendable_number_accepts_document_numbers_only() -> None:
    assert is_sendable_number("SOP-ABC-00001")
    assert is_sendable_number("FRM-ABC-2047-02")
    for bad in ("", "A", "SOP'; DROP TABLE X--", "SOP-ABC-00001;", "문서-001", "sop-abc-00001", "-SOP", "X" * 101):
        assert not is_sendable_number(bad)


def test_fetch_rows_asks_by_number_then_by_legacy(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = patch_post(monkeypatch, [{"query": WHERE_QUERY, "rows": [make_raw()]}, {"query": WHERE_QUERY, "rows": []}])

    rows = asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert [row.version_text for row in rows] == ["14.0"]
    assert [body["filters"] for body in sent] == [
        [{"column": "DOC_DOCUMENT_NUMBER", "op": "eq", "value": "SOP-ABC-00001"}],
        [{"column": "DOC_LEGACY_DOCUMENT_ID", "op": "contains", "value": "SOP-ABC-00001"}],
    ]
    assert all(
        (body["kind"], body["schema"], body["table"], body["limit"]) == ("table_preview", "edw", "EQUIS_DOCUMENT", 500)
        for body in sent
    )


def test_fetch_rows_accepts_every_response_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    # 새 W2는 {query, rows}, 반쯤 배포된 W2는 한 겹 배열, 옛 W2는 행 배열. 0건은 빈 객체 하나로 온다
    patch_post(monkeypatch, [[{"query": WHERE_QUERY, "rows": [make_raw(version="13.0")]}], [make_raw(version="14.0"), {}]])

    rows = asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert sorted(row.version_text for row in rows) == ["13.0", "14.0"]


def test_fetch_rows_merges_duplicates_and_skips_bad_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    same = make_raw()
    patch_post(monkeypatch, [{"query": WHERE_QUERY, "rows": [same, {"DOC_DOCUMENT_NUMBER": "no version"}]},
                             {"query": WHERE_QUERY, "rows": [same]}])

    rows = asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert len(rows) == 1


def test_fetch_rows_never_returns_person_names(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = make_raw(DOC_OWNER="Synthetic Owner", DOC_AUTHOR="합성 작성자", DOC_CREATED_BY="Synthetic Creator",
                   DOC_LAST_MODIFIED_BY="Synthetic Editor")
    patch_post(monkeypatch, [{"query": WHERE_QUERY, "rows": [raw]}, {"query": WHERE_QUERY, "rows": []}])

    rows = asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert not any(name in repr(rows) for name in ("Synthetic Owner", "합성 작성자", "Synthetic Creator", "Synthetic Editor"))


def test_unsendable_number_is_not_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = patch_post(monkeypatch, [])

    assert asyncio.run(fetch_rows("SOP'; DROP TABLE X--")) == []
    assert sent == []


def test_fetch_rows_retries_once_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = patch_post(monkeypatch, [httpx2.ReadTimeout("slow"), {"query": WHERE_QUERY, "rows": [make_raw()]},
                                    {"query": WHERE_QUERY, "rows": []}])

    rows = asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert len(rows) == 1 and len(sent) == 3


def test_fetch_rows_raises_unavailable_without_the_address(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_post(monkeypatch, [httpx2.ReadTimeout("slow"), httpx2.ConnectError("refused http://n8n.test/webhook/dbv-query")])

    with pytest.raises(EquisUnavailable) as caught:
        asyncio.run(fetch_rows("SOP-ABC-00001"))

    assert "n8n.test" not in str(caught.value)


def test_status_envelope_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_post(monkeypatch, [{"message": "Error in workflow"}, {"message": "Error in workflow"}])

    with pytest.raises(EquisUnavailable):
        asyncio.run(fetch_rows("SOP-ABC-00001"))


def test_query_without_where_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    # 조건을 모르는 옛 W2는 표의 앞 500줄을 그대로 준다 — 그 줄로 "없음"을 판정하면 안 된다
    unfiltered = {"query": "SELECT TOP 500 * FROM [edw].[EQUIS_DOCUMENT]", "rows": [make_raw(number="SOP-ZZZ-00009")]}
    patch_post(monkeypatch, [unfiltered, unfiltered])

    with pytest.raises(EquisUnavailable):
        asyncio.run(fetch_rows("SOP-ABC-00001"))


def test_equis_enabled_needs_all_three_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    assert settings.equis_enabled
    monkeypatch.setattr(settings, "equis_doc_url_base", "")
    assert not settings.equis_enabled
