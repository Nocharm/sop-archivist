"""그룹 저장이 걸린 시간을 구조화 로그로 남기되 원문·이름·로그인 ID는 싣지 않는다 (설계 split-first 6-1, A2-R2)."""

import pytest
from fastapi.testclient import TestClient

from tests.sop_helpers import AUTHOR, save_group
from tests.test_sop_decision_undo import STORAGE, Fixture, _setup

pytestmark = pytest.mark.usefixtures("clean_sop")

LOGGER = "app.routers.sop_decisions"


def _save(client: TestClient, fx: Fixture, *, with_undo: bool) -> None:
    target = {
        "key": "t", "target_doc_id": fx.sop_id, "source_unit_ids": [fx.unit["id"]],
        "slot_key": "responsibilities", "text": STORAGE, "change_type": "as_is",
    }
    body = {"action": "confirm", "units": [{"unit_id": fx.unit["id"], "revision": 1, "disposition": "assigned"}],
            "targets": [target]}
    if with_undo:
        body["undo"] = {"session": "timing-session", "op": "confirm"}
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text


def _find_timed(caplog: pytest.LogCaptureFixture):
    (record,) = [r for r in caplog.records if r.message == "group save timed"]
    return record


def test_save_logs_timing_without_text(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    fx = _setup(client)
    with caplog.at_level("INFO", logger=LOGGER):
        _save(client, fx, with_undo=True)
    record = _find_timed(caplog)
    assert 0 < record.dump_ms <= record.total_ms
    assert 0 < record.run_ms <= record.total_ms
    assert (record.unit_count, record.target_count) == (1, 1)
    assert record.bundle_id == fx.bundle_id
    assert not any(secret in str(record.__dict__) for secret in (STORAGE, AUTHOR["X-Dev-User"]))


def test_save_without_undo_meta_takes_no_dump(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    fx = _setup(client)
    with caplog.at_level("INFO", logger=LOGGER):
        _save(client, fx, with_undo=False)
    record = _find_timed(caplog)
    assert record.dump_ms == 0
    assert 0 < record.run_ms <= record.total_ms
