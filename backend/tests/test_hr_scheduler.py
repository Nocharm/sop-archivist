"""내장 HR 스케줄러 — 루프가 run_full_sync를 호출하고 예외에 견디는지, 첫 회차를 마지막 기록에서 잇는지, lifespan이 켜고 끄는지."""

import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.clock import KST
from app.hr import scheduler
from app.hr import service as hr_service
from app.settings import settings


def test_sync_loop_calls_full_sync_and_survives_errors(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_interval_hours", 1)
    calls = {"n": 0}

    async def fake_full_sync(session):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")  # 1회차 실패 — 루프 생존 확인
        raise asyncio.CancelledError  # 2회차에서 루프 탈출

    monkeypatch.setattr(hr_service, "run_full_sync", fake_full_sync)

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(scheduler.asyncio, "sleep", fast_sleep)

    async def _run() -> None:
        try:
            await scheduler.run_hr_sync_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())
    assert calls["n"] == 2


def test_sync_loop_skips_a_round_that_overlaps_a_manual_sync(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "hr_sync_interval_hours", 1)
    calls = {"n": 0}

    async def fake_full_sync(session):
        calls["n"] += 1
        if calls["n"] == 1:
            raise hr_service.SyncTooSoon(120)  # 수동 실행 직후 겹침 — 다음 주기로 넘긴다
        raise asyncio.CancelledError

    monkeypatch.setattr(hr_service, "run_full_sync", fake_full_sync)

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(scheduler.asyncio, "sleep", fast_sleep)

    async def _run() -> None:
        try:
            await scheduler.run_hr_sync_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())
    assert calls["n"] == 2


def test_first_run_continues_from_the_last_recorded_run() -> None:
    """기동마다 한 주기를 새로 기다리면 배포가 잦을 때 자동 동기화가 돌지 않는다."""
    assert scheduler.HR_SYNC_STARTUP_GRACE_SECONDS == 300
    now = datetime(2026, 10, 20, 9, 0, tzinfo=KST)
    day = 24 * 3600
    assert scheduler.get_first_hr_sync_delay(None, now, day) == day  # 첫 설치 — 수동 절차 뒤 한 주기
    assert scheduler.get_first_hr_sync_delay(now - timedelta(hours=20), now, day) == 4 * 3600
    assert (
        scheduler.get_first_hr_sync_delay(now - timedelta(days=3), now, day)
        == scheduler.HR_SYNC_STARTUP_GRACE_SECONDS
    )
    # sqlite는 시간대 없는 KST 벽시계로 돌려준다
    assert scheduler.get_first_hr_sync_delay(datetime(2026, 10, 19, 21, 0), now, day) == 12 * 3600


def _run_lifespan_and_report_scheduler(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    """lifespan을 한 번 돌려 스케줄러 태스크가 떴는지·종료 때 취소됐는지 돌려준다."""
    state = {"started": False, "cancelled": False}

    async def fake_loop() -> None:
        state["started"] = True
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    monkeypatch.setattr(main_mod, "run_hr_sync_loop", fake_loop)
    with TestClient(main_mod.app):
        pass
    return state


def test_lifespan_starts_the_scheduler_and_cancels_it_on_shutdown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.test/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_interval_hours", 24)

    assert _run_lifespan_and_report_scheduler(monkeypatch) == {"started": True, "cancelled": True}


@pytest.mark.parametrize(
    ("url", "token", "interval"),
    [
        ("", "", 24),  # HR 웹훅 미설정
        ("http://hr.test/webhook", "", 24),  # 토큰 없음
        ("http://hr.test/webhook", "tok", 0),  # 주기 0 = 끔
    ],
)
def test_lifespan_leaves_the_scheduler_off_unless_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, url: str, token: str, interval: int
) -> None:
    monkeypatch.setattr(settings, "n8n_hr_url", url)
    monkeypatch.setattr(settings, "n8n_hr_token", token)
    monkeypatch.setattr(settings, "hr_sync_interval_hours", interval)

    assert _run_lifespan_and_report_scheduler(monkeypatch) == {"started": False, "cancelled": False}
