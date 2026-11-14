"""EQUIS 조회 서비스 테스트 — 조회 요청·결과 보관·상태 읽기(설계 §8). 웹훅은 `fetch_rows` 바꿔치기, 값은 합성이다."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.equis import service as equis_service
from app.equis.client import EquisUnavailable
from app.equis.rules import EquisRow, parse_row
from app.settings import settings
from app.sop.models import EquisLookup
from tests.access_helpers import run_in_session

pytestmark = pytest.mark.usefixtures("client", "clean_sop")

NUMBER = "SOP-ABC-00001"


def make_row(number: str = NUMBER, version: str = "14.0", status: str = "Effective", name: str = "Synthetic Name") -> EquisRow:
    row = parse_row({
        "DOC_DOCUMENT_NUMBER": number, "DOC_DOCUMENT_ID": "900001", "DOC_VERSION": version,
        "DOC_DOCUMENT_STATUS": status, "DOC_LIFECYCLE": "Draft to Effective Lifecycle", "DOC_DOCUMENT_NAME": name,
    })
    assert row is not None
    return row


@pytest.fixture
def equis_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "n8n_query_url", "http://n8n.test/webhook/dbv-query")
    monkeypatch.setattr(settings, "equis_edw_table", "edw.EQUIS_DOCUMENT")
    monkeypatch.setattr(settings, "equis_doc_url_base", "https://equis.test")


def patch_fetch(monkeypatch: pytest.MonkeyPatch, reply: list[EquisRow] | Exception) -> list[str]:
    asked: list[str] = []

    async def fake_fetch(number: str) -> list[EquisRow]:
        asked.append(number)
        if isinstance(reply, Exception):
            raise reply
        return [row for row in reply if row.number == number]

    monkeypatch.setattr(equis_service, "fetch_rows", fake_fetch)
    return asked


def request(codes: list[str], *, force: bool = False) -> list[str]:
    async def work(session: AsyncSession) -> list[str]:
        requested = await equis_service.request_lookups(session, codes, force=force)
        await session.commit()
        return requested

    return run_in_session(work)


def get_lookup(number: str = NUMBER) -> EquisLookup | None:
    return run_in_session(lambda session: session.get(EquisLookup, number))


def age_lookup(number: str, *, requested: timedelta | None = None, fetched: timedelta | None = None) -> None:
    """조회 시각을 과거로 민다 — 제한 시간과 갱신 간격을 기다리지 않고 시험한다."""

    async def work(session: AsyncSession) -> None:
        lookup = await session.get_one(EquisLookup, number)
        if requested is not None:
            lookup.requested_at = clock.now() - requested
        if fetched is not None:
            lookup.fetched_at = clock.now() - fetched
        await session.commit()

    run_in_session(work)


def test_needs_lookup_skips_blank_temporary_and_odd_codes() -> None:
    assert equis_service.needs_lookup(" sop-abc-00001 ")
    for code in ("", "   ", "NEW-41", "new-41", "문서-001", "SOP'; DROP"):
        assert not equis_service.needs_lookup(code)


def test_request_does_nothing_when_disabled() -> None:
    assert request([NUMBER]) == []
    assert get_lookup() is None


def test_same_number_is_requested_once(equis_on: None) -> None:
    assert request([NUMBER, " sop-abc-00001 ", "NEW-41", ""]) == [NUMBER]
    assert request([NUMBER]) == []  # 아직 조회 중이다
    lookup = get_lookup()
    assert lookup is not None and lookup.state == "pending"


def test_run_lookup_stores_facts(equis_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    asked = patch_fetch(monkeypatch, [make_row()])
    request([NUMBER])

    asyncio.run(equis_service.run_lookup(NUMBER))

    lookup = get_lookup()
    assert lookup is not None and lookup.state == "found" and lookup.fetched_at is not None
    facts = equis_service.read_facts(lookup)
    assert facts is not None and facts.name == "Synthetic Name"
    assert lookup.facts is not None and lookup.facts["trail"] == [NUMBER]
    assert asked == [NUMBER]


def test_run_lookup_records_not_found(equis_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    patch_fetch(monkeypatch, [])
    request([NUMBER])

    asyncio.run(equis_service.run_lookup(NUMBER))

    lookup = get_lookup()
    assert lookup is not None and lookup.state == "not_found"
    assert not equis_service.is_title_locked(lookup, clock.now())


def test_failed_refresh_keeps_earlier_facts_and_lock(equis_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    patch_fetch(monkeypatch, [make_row()])
    request([NUMBER])
    asyncio.run(equis_service.run_lookup(NUMBER))
    patch_fetch(monkeypatch, EquisUnavailable("EQUIS lookup failed: ReadTimeout"))
    assert request([NUMBER], force=True) == [NUMBER]

    asyncio.run(equis_service.run_lookup(NUMBER))

    lookup = get_lookup()
    assert lookup is not None and lookup.state == "unavailable"
    assert equis_service.read_facts(lookup) is not None
    assert equis_service.is_title_locked(lookup, clock.now())


def test_first_lookup_locks_the_title_until_it_times_out(equis_on: None) -> None:
    request([NUMBER])
    lookup = get_lookup()
    assert lookup is not None
    assert equis_service.read_state(lookup, clock.now()) == "pending"
    assert equis_service.is_title_locked(lookup, clock.now())

    # 서버가 재시작돼 답이 오지 않은 조회 — 화면에 영영 "조회 중"으로 남지 않는다
    age_lookup(NUMBER, requested=timedelta(seconds=equis_service.PENDING_TIMEOUT_SECONDS + 1))
    lookup = get_lookup()
    assert lookup is not None
    assert equis_service.read_state(lookup, clock.now()) == "unavailable"
    assert not equis_service.is_title_locked(lookup, clock.now())
    assert request([NUMBER]) == [NUMBER]  # 다시 물을 수 있다


def test_found_result_is_refreshed_after_a_day(equis_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    patch_fetch(monkeypatch, [make_row()])
    request([NUMBER])
    asyncio.run(equis_service.run_lookup(NUMBER))
    assert request([NUMBER]) == []

    age_lookup(NUMBER, requested=timedelta(hours=25), fetched=timedelta(hours=25))

    assert request([NUMBER]) == [NUMBER]


def test_unavailable_result_is_retried_sooner(equis_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    patch_fetch(monkeypatch, EquisUnavailable("EQUIS lookup failed: status=502"))
    request([NUMBER])
    asyncio.run(equis_service.run_lookup(NUMBER))
    assert request([NUMBER]) == []

    age_lookup(NUMBER, requested=timedelta(minutes=11), fetched=timedelta(minutes=11))

    assert request([NUMBER]) == [NUMBER]
