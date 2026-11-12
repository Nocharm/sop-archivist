"""검토 흐름 — 검토 요청 조건(막는 이유·알림)·의미 검토 확인·요청/거두기/완료/되돌리기/다시 열기·다음 행동."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import partial
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop.constants import SEMANTIC_CHECK_KEYS
from app.sop.models import Bundle, ExtractionWarning, TargetSentence, UnitDecision
from app.sop.review import evaluate_readiness
from app.sop.snapshot import BundleSnapshot, load_bundle_snapshot
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    confirm_boundaries,
    create_bundle,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)
from tests.test_sop_progress import _expected_rows

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-REVIEW.docx"
KO_1 = "합성 장비를 켠다."
KO_2 = "합성 시료를 넣는다."
EN_1 = "Load the synthetic sample."
SOP_DOC = {"code": "SOP-REV", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}
WI_DOC = {"code": "WI-REV", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-REV"}
EQUIPMENT_DOC = {**SOP_DOC, "code": "SOP-EQ", "is_equipment_sop": True}
ALL_CHECKED = dict.fromkeys(SEMANTIC_CHECK_KEYS, True)
ALL_UNCHECKED = dict.fromkeys(SEMANTIC_CHECK_KEYS, False)
HOLD_REASON = "Synthetic: needs a closer look"
RETURN_REASON = "Synthetic: numbers need another pass"
REOPEN_REASON = "Synthetic: scope changed after the review"
AUTHOR_ONLY = [("qa.member", "author")]
WITH_REVIEWER = [("qa.member", "author"), ("qa.lead", "reviewer")]
MAX_READINESS_STATEMENTS = 30


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    docs: dict[str, int]  # To-Be 문서 번호 → id
    extraction_id: int
    view: dict


def _post(client: TestClient, bundle_id: int, path: str, headers: dict[str, str], **fields: object) -> httpx2.Response:
    """현재 revision을 읽어 검토 흐름 요청을 보낸다 — 거절 응답도 그대로 돌려줘 테스트가 코드를 단언한다."""
    revision = get_bundle(client, bundle_id, headers)["revision"]
    return client.post(f"/api/bundles/{bundle_id}/review/{path}", json={"revision": revision, **fields}, headers=headers)


def _request(client: TestClient, bundle_id: int) -> httpx2.Response:
    return _post(client, bundle_id, "request", AUTHOR)


def _put_checks(client: TestClient, bundle_id: int, **overrides: bool) -> httpx2.Response:
    revision = get_bundle(client, bundle_id)["revision"]
    body = {"revision": revision, "checks": {**ALL_CHECKED, **overrides}}
    return client.put(f"/api/bundles/{bundle_id}/semantic-checks", json=body, headers=AUTHOR)


def _get_readiness(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/review/readiness", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _list_events(client: TestClient, bundle_id: int) -> list[dict]:
    """작업 기록 — 가장 새 것이 앞."""
    response = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _setup(client: TestClient, *, docs: list[dict] | None = None, na_slots: list[dict] | None = None) -> Fixture:
    """멤버(작성자·검토자)와 To-Be, 옛 문서(한국어 둘·영어 하나)를 갖추고 경계도 모두 확인했지만 판단은 하나도 안 한 묶음."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    tobe = docs or [SOP_DOC]
    response = put_tobe(client, bundle_id, tobe, na_slots=na_slots or [])
    assert response.status_code == 200, response.text
    ids = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    uploaded = upload(client, bundle_id, build_docx(p(KO_1) + p(KO_2) + p(EN_1)), OLD_NAME)
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    doc = uploaded.json()
    assert confirm_boundaries(client, bundle_id, doc["id"]) == 3
    return Fixture(bundle_id, ids[tobe[0]["code"]], ids, doc["extraction"]["id"], get_view(client, bundle_id, doc["id"]))


def _confirm(client: TestClient, fx: Fixture, text: str, slot_key: str = "purpose") -> None:
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, text), fx.sop_id, slot_key=slot_key)


def _make_ready(client: TestClient, **kwargs: object) -> Fixture:
    """모든 단위를 확정하고 의미 검토 4항목을 표시해 검토 요청이 통과하는 묶음."""
    fx = _setup(client, **kwargs)
    for text in (KO_1, KO_2, EN_1):
        _confirm(client, fx, text)
    assert _put_checks(client, fx.bundle_id).status_code == 200
    return fx


def _unit_id(fx: Fixture, text: str) -> int:
    return find_unit(fx.view, text)["id"]


def _add_warning(fx: Fixture, kind: str = "missing_text", *, needs_ack: bool = True) -> int:
    async def _add(session: AsyncSession) -> int:
        warning = ExtractionWarning(
            extraction_id=fx.extraction_id, kind=kind, detail={"snippet": "Synthetic"}, needs_ack=needs_ack
        )
        session.add(warning)
        await session.commit()
        return warning.id

    return run_in_session(_add)


@contextmanager
def _count_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)


# --- 검토 요청 조건 ---


def test_request_review_blocked_by_one_unassigned_unit(client: TestClient) -> None:
    fx = _setup(client)
    _confirm(client, fx, KO_1)
    _confirm(client, fx, EN_1)
    assert _put_checks(client, fx.bundle_id).status_code == 200

    blocked = _request(client, fx.bundle_id)

    expected = [{"code": "units_unassigned", "count": 1}]
    assert blocked.status_code == 422
    assert blocked.json()["detail"] == {"code": "not_ready", "blockers": expected}
    assert get_bundle(client, fx.bundle_id)["status"] == "in_progress"
    readiness = _get_readiness(client, fx.bundle_id)
    assert (readiness["ready"], readiness["blockers"], readiness["next_action"]) == (False, expected, "decide_units")

    _confirm(client, fx, KO_2)
    revision = get_bundle(client, fx.bundle_id)["revision"]
    done = _request(client, fx.bundle_id)

    assert done.status_code == 200, done.text
    assert (done.json()["status"], done.json()["revision"]) == ("in_review", revision + 1)
    assert _list_events(client, fx.bundle_id)[0]["action"] == "review.request"


def _hold_one_unit(client: TestClient, fx: Fixture) -> list[dict]:
    update_row(UnitDecision, _unit_id(fx, KO_2), status="on_hold", hold_reason=HOLD_REASON)
    return [{"code": "units_on_hold", "count": 1}]


def _add_unacked_warning(client: TestClient, fx: Fixture) -> list[dict]:
    _add_warning(fx)
    return [{"code": "unacked_missing_text", "count": 1}]


def _uncheck_numbers(client: TestClient, fx: Fixture) -> list[dict]:
    assert _put_checks(client, fx.bundle_id, numbers=False).status_code == 200
    return [{"code": "semantic_checks_incomplete", "missing": ["numbers"]}]


def _drop_reviewer(client: TestClient, fx: Fixture) -> list[dict]:
    assert set_members(client, fx.bundle_id, AUTHOR_ONLY).status_code == 200
    return [{"code": "no_reviewer"}]


def _set_boundary(client: TestClient, fx: Fixture, unit_ids: list[int], confirmed: bool) -> None:
    url = f"/api/bundles/{fx.bundle_id}/documents/{fx.view['document']['id']}/units/boundary"
    response = client.post(url, json={"unit_ids": unit_ids, "confirmed": confirmed}, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _uncheck_one_boundary(client: TestClient, fx: Fixture) -> list[dict]:
    _set_boundary(client, fx, [_unit_id(fx, KO_2)], False)
    return [{"code": "unchecked_boundaries", "count": 1, "document_ids": [fx.view["document"]["id"]]}]


def _upload_rejected(client: TestClient, fx: Fixture) -> list[dict]:
    rejected = upload(client, fx.bundle_id, b"Synthetic notes", "SYNTHETIC notes.txt")
    assert rejected.status_code == 201 and rejected.json()["status"] == "rejected", rejected.text
    return [{"code": "unresolved_documents", "document_ids": [rejected.json()["id"]]}]


@pytest.mark.parametrize(
    "spoil",
    [_hold_one_unit, _add_unacked_warning, _uncheck_one_boundary, _uncheck_numbers, _drop_reviewer, _upload_rejected],
    ids=["on_hold", "unacked_missing_text", "unchecked_boundary", "semantic_check", "no_reviewer", "rejected_document"],
)
def test_blockers_cover_each_condition(client: TestClient, spoil: Callable[[TestClient, Fixture], list[dict]]) -> None:
    fx = _make_ready(client)
    assert _get_readiness(client, fx.bundle_id)["blockers"] == []

    expected = spoil(client, fx)

    readiness = _get_readiness(client, fx.bundle_id)
    blocked = _request(client, fx.bundle_id)
    assert (readiness["ready"], readiness["blockers"]) == (False, expected)
    assert blocked.status_code == 422
    assert blocked.json()["detail"] == {"code": "not_ready", "blockers": expected}
    assert get_bundle(client, fx.bundle_id)["status"] == "in_progress"


def test_blockers_come_from_stored_state(client: TestClient) -> None:
    """AI 제안 단위와 새 문장의 상태는 계획 1 API로 만들 수 없어 DB에 직접 써서 확인한다 — 새 문장마다 한 번 센다."""
    fx = _make_ready(client)
    target_id = {
        text: get_group_by_unit(client, fx.bundle_id, _unit_id(fx, text))["targets"][0]["id"] for text in (KO_1, EN_1)
    }
    update_row(UnitDecision, _unit_id(fx, KO_1), status="ai_suggested")
    update_row(TargetSentence, target_id[EN_1], status="on_hold", hold_reason=HOLD_REASON)
    update_row(TargetSentence, target_id[KO_1], status="unassigned")

    blockers = _get_readiness(client, fx.bundle_id)["blockers"]

    assert blockers == [
        {"code": "units_ai_suggested", "count": 1},
        {"code": "targets_unassigned", "count": 1},
        {"code": "targets_on_hold", "count": 1},
    ]


def _pair_ko_1_with_en_1(client: TestClient, fx: Fixture) -> dict:
    """KO_1·EN_1을 사람이 한 짝으로 맺고 짝이 반영된 문서 대조 데이터를 돌려준다."""
    doc_id = fx.view["document"]["id"]
    body = {"revision": fx.view["document"]["revision"], "unit_ids": [_unit_id(fx, KO_1), _unit_id(fx, EN_1)]}
    response = client.post(f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/pairs", json=body, headers=AUTHOR)
    assert response.status_code in (200, 201), response.text
    view = get_view(client, fx.bundle_id, doc_id)
    assert len(view["pairs"]) == 1
    return view


def test_unit_blockers_count_rows_not_units(client: TestClient) -> None:
    """짝의 두 문장이 모두 미배정이면 막는 줄은 하나다."""
    fx = _setup(client)
    view = _pair_ko_1_with_en_1(client, fx)

    blockers = _get_readiness(client, fx.bundle_id)["blockers"]

    units = next(item for item in blockers if item["code"] == "units_unassigned")
    assert units == {"code": "units_unassigned", "count": _expected_rows(view)} and units["count"] == 2


def test_progress_and_readiness_count_the_same_rows(client: TestClient) -> None:
    """SQL 집계(진행 숫자)와 스냅숏 집계(검토 조건)가 같은 줄을 센다 — 짝의 상태는 가장 덜 끝난 구성 단위."""
    fx = _setup(client)
    _pair_ko_1_with_en_1(client, fx)
    _confirm(client, fx, KO_1)  # 짝의 EN_1이 미배정이라 짝 줄은 미배정으로 남는다
    update_row(UnitDecision, _unit_id(fx, KO_2), status="on_hold", hold_reason=HOLD_REASON)

    progress = get_bundle(client, fx.bundle_id)["progress"]
    blockers = {item["code"]: item.get("count") for item in _get_readiness(client, fx.bundle_id)["blockers"]}

    assert (progress["unassigned"], progress["on_hold"], progress["total"]) == (1, 1, 2)
    assert (blockers["units_unassigned"], blockers["units_on_hold"]) == (progress["unassigned"], progress["on_hold"])


def test_reason_blockers(client: TestClient) -> None:
    """사유 없는 삭제와 사유 없는 중복 배정 — 저장 경로는 사유를 강제하므로 사유를 DB에서 비워 확인한다."""
    fx = _setup(client, docs=[SOP_DOC, WI_DOC])
    ko_2, en_1 = find_unit(fx.view, KO_2), find_unit(fx.view, EN_1)
    _confirm(client, fx, KO_1)
    deleted = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/bulk",
        json={"action": "delete", "reason": "Synthetic: obsolete", "units": [{"unit_id": ko_2["id"], "revision": 1}]},
        headers=AUTHOR,
    )
    assert deleted.status_code == 200, deleted.text
    duplicated = save_group(
        client,
        fx.bundle_id,
        {
            "action": "confirm",
            "units": [
                {"unit_id": en_1["id"], "revision": 1, "disposition": "assigned", "reason": "Synthetic: needed in both"}
            ],
            "targets": [
                {"key": "s", "target_doc_id": fx.sop_id, "slot_key": "purpose", "source_unit_ids": [en_1["id"]]},
                {"key": "w", "target_doc_id": fx.docs["WI-REV"], "wi_part": "why", "source_unit_ids": [en_1["id"]]},
            ],
        },
    )
    assert duplicated.status_code == 200, duplicated.text
    assert _put_checks(client, fx.bundle_id).status_code == 200
    assert _get_readiness(client, fx.bundle_id)["blockers"] == []

    update_row(UnitDecision, ko_2["id"], reason="")
    update_row(UnitDecision, en_1["id"], reason="")

    assert _get_readiness(client, fx.bundle_id)["blockers"] == [
        {"code": "duplicate_without_reason", "count": 1, "unit_ids": [en_1["id"]]},
        {"code": "missing_reason", "count": 1, "unit_ids": [ko_2["id"]]},
    ]


def test_table_restructured_needs_a_reason(client: TestClient) -> None:
    """표 구성 변경은 표 단위 판단에 사유가 있어야 한다 — 저장 경로가 강제하는 사유를 DB에서 비워 확인한다."""
    fx = _setup(client)
    table_doc = upload(client, fx.bundle_id, build_docx(tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])), "SYNTHETIC_TABLE.docx")
    assert table_doc.status_code == 201, table_doc.text
    table = next(u for u in get_view(client, fx.bundle_id, table_doc.json()["id"])["units"] if u["kind"] == "table")
    assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="purpose")
    table_target = next(t for t in get_group_by_unit(client, fx.bundle_id, table["id"])["targets"] if t["kind"] == "table")

    update_row(TargetSentence, table_target["id"], change_type="table_restructured")

    assert {"code": "missing_reason", "count": 1, "unit_ids": [table["id"]]} in _get_readiness(client, fx.bundle_id)[
        "blockers"
    ]
    update_row(UnitDecision, table["id"], reason="Synthetic: columns merged")
    assert "missing_reason" not in {b["code"] for b in _get_readiness(client, fx.bundle_id)["blockers"]}


def test_boundaries_count_only_text_units_of_every_document(client: TestClient) -> None:
    """경계 확인은 글자 범위가 있는 단위(문장·제목·그림·칸 문장)만 센다 — 표·행 묶음 단위는 칸 문장이 대신한다."""
    fx = _make_ready(client)
    table_doc = upload(client, fx.bundle_id, build_docx(tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])), "SYNTHETIC_TABLE.docx")
    assert table_doc.status_code == 201, table_doc.text
    doc_id = table_doc.json()["id"]
    units = get_view(client, fx.bundle_id, doc_id)["units"]
    cells = [unit["id"] for unit in units if unit["kind"] == "cell_sentence"]
    assert len(cells) == 4 and len(units) > len(cells)

    blocked = _get_readiness(client, fx.bundle_id)
    _set_boundary(client, fx, [_unit_id(fx, KO_1)], False)
    both = _get_readiness(client, fx.bundle_id)
    url = f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/units/boundary"
    assert client.post(url, json={"unit_ids": cells, "confirmed": True}, headers=AUTHOR).status_code == 200
    _set_boundary(client, fx, [_unit_id(fx, KO_1)], True)
    cleared = _get_readiness(client, fx.bundle_id)

    assert {"code": "unchecked_boundaries", "count": 4, "document_ids": [doc_id]} in blocked["blockers"]
    assert {"code": "unchecked_boundaries", "count": 5, "document_ids": sorted([fx.view["document"]["id"], doc_id])} in both[
        "blockers"
    ]
    assert "unchecked_boundaries" not in {blocker["code"] for blocker in cleared["blockers"]}


def test_edited_units_need_their_boundaries_checked_again(client: TestClient) -> None:
    fx = _setup(client)
    doc_id = fx.view["document"]["id"]
    unit = find_unit(fx.view, KO_2)
    edit = {"revision": fx.view["document"]["revision"], "op": {"type": "split", "unit_id": unit["id"], "at": 3}}

    split = client.post(f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/edits", json=edit, headers=AUTHOR)

    assert split.status_code == 200, split.text
    assert {"code": "unchecked_boundaries", "count": 2, "document_ids": [doc_id]} in _get_readiness(client, fx.bundle_id)[
        "blockers"
    ]
    assert get_bundle(client, fx.bundle_id)["next_action"] == "check_boundaries"


def test_acking_the_warning_clears_the_blocker(client: TestClient) -> None:
    fx = _make_ready(client)
    warning_id = _add_warning(fx)
    _add_warning(fx, "missing_text_truncated", needs_ack=False)  # 확인이 필요 없는 경고는 막지 않는다
    assert _get_readiness(client, fx.bundle_id)["blockers"] == [{"code": "unacked_missing_text", "count": 1}]

    acked = client.post(
        f"/api/bundles/{fx.bundle_id}/warnings/{warning_id}/ack", json={"note": "Synthetic check"}, headers=AUTHOR
    )

    assert acked.status_code == 200, acked.text
    readiness = _get_readiness(client, fx.bundle_id)
    assert (readiness["ready"], readiness["blockers"], readiness["next_action"]) == (True, [], "request_review")


def test_empty_bundle_blockers_are_listed_in_order(client: TestClient) -> None:
    bundle_id = create_bundle(client)["id"]

    readiness = _get_readiness(client, bundle_id)

    assert readiness["blockers"] == [
        {"code": "semantic_checks_incomplete", "missing": list(SEMANTIC_CHECK_KEYS)},
        {"code": "no_reviewer"},
        {"code": "no_documents"},
    ]
    assert (readiness["ready"], readiness["notices"], readiness["next_action"]) == (False, [], "upload_documents")


# --- 알림 ---


def test_equipment_notice_does_not_block(client: TestClient) -> None:
    na_slots = [{"code": "SOP-EQ", "slot_key": "procedures.maintenance", "reason": "Synthetic: not applicable"}]
    fx = _make_ready(client, docs=[EQUIPMENT_DOC], na_slots=na_slots)

    readiness = _get_readiness(client, fx.bundle_id)
    requested = _request(client, fx.bundle_id)

    expected = [
        {
            "code": "equipment_sop_empty_slots", "doc_code": "SOP-EQ",
            "slot_keys": ["procedures.electronic_record_control", "procedures.troubleshooting"],
        }
    ]
    assert (readiness["ready"], readiness["blockers"], readiness["notices"]) == (True, [], expected)
    assert requested.status_code == 200, requested.text
    assert requested.json()["status"] == "in_review"


def test_equipment_notice_skips_filled_and_not_applicable_slots(client: TestClient) -> None:
    filled = _setup(client, docs=[EQUIPMENT_DOC])
    _confirm(client, filled, KO_1, slot_key="procedures.troubleshooting")
    parent_na = [{"code": "SOP-EQ", "slot_key": "procedures", "reason": "Synthetic: no procedures"}]
    covered = _setup(client, docs=[EQUIPMENT_DOC], na_slots=parent_na)
    plain = _setup(client)

    assert _get_readiness(client, filled.bundle_id)["notices"] == [
        {
            "code": "equipment_sop_empty_slots", "doc_code": "SOP-EQ",
            "slot_keys": ["procedures.electronic_record_control", "procedures.maintenance"],
        }
    ]
    assert _get_readiness(client, covered.bundle_id)["notices"] == []  # 상위 칸 N/A가 하위 칸을 덮는다
    assert _get_readiness(client, plain.bundle_id)["notices"] == []  # 장비 SOP가 아니면 알리지 않는다


def test_sentence_warnings_notice_counts_sentences(client: TestClient) -> None:
    fx = _make_ready(client)
    ids = [get_group_by_unit(client, fx.bundle_id, _unit_id(fx, text))["targets"][0]["id"] for text in (KO_1, KO_2)]
    update_row(TargetSentence, ids[0], warnings=[{"kind": "number_mismatch", "source": "5", "target": "6"}] * 2)
    update_row(TargetSentence, ids[1], warnings=[{"kind": "negation_mismatch", "source": "no", "target": "yes"}])

    readiness = _get_readiness(client, fx.bundle_id)

    assert readiness["notices"] == [{"code": "sentence_warnings", "count": 2}]
    assert (readiness["ready"], readiness["blockers"]) == (True, [])


# --- 의미 검토 확인 ---


def test_semantic_checks_are_saved_by_the_author_while_in_progress(client: TestClient) -> None:
    fx = _setup(client)
    revision = get_bundle(client, fx.bundle_id)["revision"]

    saved = _put_checks(client, fx.bundle_id, conditions=False, figures=False)

    expected = {"numbers": True, "conditions": False, "tables": True, "figures": False}
    assert saved.status_code == 200, saved.text
    assert (saved.json()["semantic_checks"], saved.json()["revision"]) == (expected, revision + 1)
    assert get_bundle(client, fx.bundle_id)["semantic_checks"] == expected
    recorded = _list_events(client, fx.bundle_id)[0]
    assert (recorded["action"], recorded["actor"], recorded["target_ids"]) == (
        "semantic_checks", "qa.member", ["numbers", "tables"],
    )

    same = _put_checks(client, fx.bundle_id, conditions=False, figures=False)  # 바뀐 것이 없으면 revision도 기록도 그대로

    assert same.status_code == 200
    assert same.json()["revision"] == revision + 1
    assert _list_events(client, fx.bundle_id)[0]["id"] == recorded["id"]


def test_semantic_checks_refuse_other_roles_stale_revision_and_bad_bodies(client: TestClient) -> None:
    fx = _setup(client)
    revision = get_bundle(client, fx.bundle_id)["revision"]
    url = f"/api/bundles/{fx.bundle_id}/semantic-checks"

    as_reviewer = client.put(url, json={"revision": revision, "checks": ALL_CHECKED}, headers=REVIEWER)
    stale = client.put(url, json={"revision": revision - 1, "checks": ALL_CHECKED}, headers=AUTHOR)
    missing_key = client.put(
        url, json={"revision": revision, "checks": {"numbers": True, "conditions": True}}, headers=AUTHOR
    )
    extra_key = client.put(url, json={"revision": revision, "checks": {**ALL_CHECKED, "layout": True}}, headers=AUTHOR)
    not_bool = client.put(url, json={"revision": revision, "checks": {**ALL_CHECKED, "numbers": "yes"}}, headers=AUTHOR)

    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")
    assert (stale.status_code, stale.json()["detail"]["code"]) == (409, "revision_conflict")
    assert (missing_key.status_code, extra_key.status_code, not_bool.status_code) == (422, 422, 422)
    assert get_bundle(client, fx.bundle_id)["semantic_checks"] == {}

    update_row(Bundle, fx.bundle_id, status="in_review")
    locked = client.put(url, json={"revision": revision, "checks": ALL_CHECKED}, headers=AUTHOR)
    assert (locked.status_code, locked.json()["detail"]) == (409, {"code": "bundle_not_editable", "status": "in_review"})


# --- 전이 ---


def test_content_locked_in_review(client: TestClient) -> None:
    fx = _make_ready(client)
    assert _request(client, fx.bundle_id).status_code == 200
    unit = find_unit(fx.view, KO_1)
    group = get_group_by_unit(client, fx.bundle_id, unit["id"])
    body = {
        "action": "confirm",
        "units": [
            {"unit_id": unit["id"], "revision": group["units"][0]["decision"]["revision"], "disposition": "assigned"}
        ],
        "targets": [{"key": "t", "target_doc_id": fx.sop_id, "slot_key": "scope", "source_unit_ids": [unit["id"]]}],
    }

    saved = save_group(client, fx.bundle_id, body)
    uploaded = upload(client, fx.bundle_id, build_docx(p("합성 다른 문장이다.")), "SYNTHETIC_OTHER.docx")
    tobe = put_tobe(client, fx.bundle_id, [SOP_DOC])

    for response in (saved, uploaded, tobe):
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "bundle_not_editable", "status": "in_review"}
    base = f"/api/bundles/{fx.bundle_id}"
    assert client.get(f"{base}/outputs/a", params={"lang": "ko"}, headers=AUTHOR).status_code == 200
    assert client.get(f"{base}/export.xlsx", params={"lang": "ko"}, headers=REVIEWER).status_code == 200
    assert client.get(f"{base}/summary", headers=REVIEWER).status_code == 200


def test_reviewer_completes_or_returns(client: TestClient) -> None:
    completed_fx, returned_fx = _make_ready(client), _make_ready(client)
    for fx in (completed_fx, returned_fx):
        assert _request(client, fx.bundle_id).status_code == 200

    revision = get_bundle(client, completed_fx.bundle_id)["revision"]
    completed = _post(client, completed_fx.bundle_id, "complete", REVIEWER)

    assert completed.status_code == 200, completed.text
    assert (completed.json()["status"], completed.json()["revision"]) == ("done", revision + 1)
    assert completed.json()["next_action"] == "done"
    latest = _list_events(client, completed_fx.bundle_id)[0]
    assert (latest["action"], latest["actor"], latest["reason"]) == ("review.complete", "qa.lead", "")

    revision = get_bundle(client, returned_fx.bundle_id)["revision"]
    returned = _post(client, returned_fx.bundle_id, "return", REVIEWER, reason=f"  {RETURN_REASON}  ")

    assert returned.status_code == 200, returned.text
    assert (returned.json()["status"], returned.json()["revision"]) == ("in_progress", revision + 1)
    assert returned.json()["semantic_checks"] == ALL_UNCHECKED  # 내용이 바뀔 수 있어 의미 검토를 다시 확인한다
    latest = _list_events(client, returned_fx.bundle_id)[0]
    assert (latest["action"], latest["actor"], latest["reason"]) == ("review.return", "qa.lead", RETURN_REASON)
    assert _get_readiness(client, returned_fx.bundle_id)["blockers"] == [
        {"code": "semantic_checks_incomplete", "missing": list(SEMANTIC_CHECK_KEYS)}
    ]
    assert _put_checks(client, returned_fx.bundle_id).status_code == 200  # 작업 중이라 다시 고칠 수 있다


def test_author_reopens_done_bundle_with_reason(client: TestClient) -> None:
    fx = _make_ready(client)
    assert _request(client, fx.bundle_id).status_code == 200
    assert _post(client, fx.bundle_id, "complete", REVIEWER).status_code == 200
    revision = get_bundle(client, fx.bundle_id)["revision"]

    reopened = _post(client, fx.bundle_id, "reopen", AUTHOR, reason=REOPEN_REASON)

    assert reopened.status_code == 200, reopened.text
    assert (reopened.json()["status"], reopened.json()["revision"]) == ("in_progress", revision + 1)
    assert reopened.json()["semantic_checks"] == ALL_UNCHECKED
    latest = _list_events(client, fx.bundle_id)[0]
    assert (latest["action"], latest["actor"], latest["reason"]) == ("review.reopen", "qa.member", REOPEN_REASON)
    assert _put_checks(client, fx.bundle_id).status_code == 200  # 다시 열리면 고칠 수 있다


def test_author_withdraws_review_request(client: TestClient) -> None:
    fx = _make_ready(client)
    assert _request(client, fx.bundle_id).status_code == 200
    revision = get_bundle(client, fx.bundle_id)["revision"]

    withdrawn = _post(client, fx.bundle_id, "withdraw", AUTHOR)

    assert withdrawn.status_code == 200, withdrawn.text
    assert (withdrawn.json()["status"], withdrawn.json()["revision"]) == ("in_progress", revision + 1)
    assert withdrawn.json()["semantic_checks"] == ALL_UNCHECKED  # 고친 뒤 다시 요청하므로 의미 검토도 다시 확인한다
    assert withdrawn.json()["next_action"] == "semantic_checks"
    latest = _list_events(client, fx.bundle_id)[0]
    assert (latest["action"], latest["actor"], latest["reason"]) == ("review.withdraw", "qa.member", "")
    assert _put_checks(client, fx.bundle_id).status_code == 200  # 작업 중이라 다시 고칠 수 있다
    assert _request(client, fx.bundle_id).status_code == 200  # 고친 뒤 다시 요청할 수 있다


def test_reviewer_cannot_withdraw_review_request(client: TestClient) -> None:
    fx = _make_ready(client)
    assert _request(client, fx.bundle_id).status_code == 200

    as_reviewer = _post(client, fx.bundle_id, "withdraw", REVIEWER)

    assert (as_reviewer.status_code, as_reviewer.json()["detail"]) == (403, {"code": "role_required", "roles": ["author"]})
    assert get_bundle(client, fx.bundle_id)["status"] == "in_review"
    for headers in (OUTSIDER, ADMIN):  # 멤버가 아니면 sysadmin도 같은 404
        body = {"revision": get_bundle(client, fx.bundle_id)["revision"]}
        response = client.post(f"/api/bundles/{fx.bundle_id}/review/withdraw", json=body, headers=headers)
        assert (response.status_code, response.json()["detail"]) == (404, {"code": "bundle_not_found"})


def test_author_cannot_complete_review(client: TestClient) -> None:
    fx = _make_ready(client)
    assert _request(client, fx.bundle_id).status_code == 200

    as_author = [
        _post(client, fx.bundle_id, "complete", AUTHOR),
        _post(client, fx.bundle_id, "return", AUTHOR, reason=RETURN_REASON),
    ]
    assert [(r.status_code, r.json()["detail"]) for r in as_author] == [
        (403, {"code": "role_required", "roles": ["reviewer"]})
    ] * 2
    assert get_bundle(client, fx.bundle_id)["status"] == "in_review"

    assert _post(client, fx.bundle_id, "complete", REVIEWER).status_code == 200
    as_reviewer = _post(client, fx.bundle_id, "reopen", REVIEWER, reason=REOPEN_REASON)
    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")


def test_request_and_readiness_follow_membership(client: TestClient) -> None:
    fx = _make_ready(client)
    base = f"/api/bundles/{fx.bundle_id}"
    body = {"revision": get_bundle(client, fx.bundle_id)["revision"]}

    as_reviewer = client.post(f"{base}/review/request", json=body, headers=REVIEWER)
    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")
    assert _get_readiness(client, fx.bundle_id, REVIEWER)["ready"] is True  # 읽기는 멤버면 누구나
    for headers in (OUTSIDER, ADMIN):  # 멤버가 아니면 sysadmin도 같은 404
        response = client.get(f"{base}/review/readiness", headers=headers)
        assert (response.status_code, response.json()["detail"]) == (404, {"code": "bundle_not_found"})
        assert client.post(f"{base}/review/request", json=body, headers=headers).status_code == 404


@pytest.mark.parametrize(
    ("status", "path", "headers", "fields"),
    [
        ("in_progress", "complete", REVIEWER, {}),
        ("in_progress", "return", REVIEWER, {"reason": RETURN_REASON}),
        ("in_progress", "reopen", AUTHOR, {"reason": REOPEN_REASON}),
        ("in_progress", "withdraw", AUTHOR, {}),
        ("in_review", "request", AUTHOR, {}),
        ("in_review", "reopen", AUTHOR, {"reason": REOPEN_REASON}),
        ("done", "request", AUTHOR, {}),
        ("done", "complete", REVIEWER, {}),
        ("done", "return", REVIEWER, {"reason": RETURN_REASON}),
        ("done", "withdraw", AUTHOR, {}),
    ],
)
def test_transitions_refuse_the_wrong_state(
    client: TestClient, status: str, path: str, headers: dict[str, str], fields: dict[str, str]
) -> None:
    bundle_id = create_bundle(client)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    update_row(Bundle, bundle_id, status=status)
    revision = get_bundle(client, bundle_id)["revision"]

    response = _post(client, bundle_id, path, headers, **fields)

    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "invalid_transition", "status": status}
    after = get_bundle(client, bundle_id)
    assert (after["status"], after["revision"]) == (status, revision)


@pytest.mark.parametrize(
    ("status", "path", "headers", "fields"),
    [
        ("in_progress", "request", AUTHOR, {}),
        ("in_review", "complete", REVIEWER, {}),
        ("in_review", "return", REVIEWER, {"reason": RETURN_REASON}),
        ("in_review", "withdraw", AUTHOR, {}),
        ("done", "reopen", AUTHOR, {"reason": REOPEN_REASON}),
    ],
)
def test_transitions_refuse_a_stale_revision(
    client: TestClient, status: str, path: str, headers: dict[str, str], fields: dict[str, str]
) -> None:
    bundle_id = create_bundle(client)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    update_row(Bundle, bundle_id, status=status)
    revision = get_bundle(client, bundle_id)["revision"]

    response = client.post(
        f"/api/bundles/{bundle_id}/review/{path}", json={"revision": revision - 1, **fields}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"] == [{"entity": "bundle", "id": bundle_id, "current_revision": revision}]
    assert get_bundle(client, bundle_id)["status"] == status


@pytest.mark.parametrize(
    ("status", "path", "headers"),
    [("in_review", "return", REVIEWER), ("done", "reopen", AUTHOR)],
)
@pytest.mark.parametrize("fields", [{}, {"reason": ""}, {"reason": "   "}, {"reason": "x" * 2001}])
def test_return_and_reopen_need_a_reason(
    client: TestClient, status: str, path: str, headers: dict[str, str], fields: dict[str, str]
) -> None:
    bundle_id = create_bundle(client)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    update_row(Bundle, bundle_id, status=status)

    response = _post(client, bundle_id, path, headers, **fields)

    assert response.status_code == 422
    assert get_bundle(client, bundle_id)["status"] == status


# --- 다음 행동 ---


def test_next_action_sequence(client: TestClient) -> None:
    bundle_id = create_bundle(client)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    assert get_bundle(client, bundle_id)["next_action"] == "upload_documents"

    uploaded = upload(client, bundle_id, build_docx(p(KO_1) + p(EN_1)), OLD_NAME)
    assert uploaded.status_code == 201, uploaded.text
    assert get_bundle(client, bundle_id)["next_action"] == "check_boundaries"
    assert confirm_boundaries(client, bundle_id, uploaded.json()["id"]) == 2
    assert get_bundle(client, bundle_id)["next_action"] == "fill_tobe"

    tobe = put_tobe(client, bundle_id, [SOP_DOC])
    assert tobe.status_code == 200, tobe.text
    assert get_bundle(client, bundle_id)["next_action"] == "decide_units"

    view = get_view(client, bundle_id, uploaded.json()["id"])
    for text in (KO_1, EN_1):
        assign_as_is(client, bundle_id, find_unit(view, text), tobe.json()["docs"][0]["id"], slot_key="purpose")
    assert get_bundle(client, bundle_id)["next_action"] == "semantic_checks"
    assert _put_checks(client, bundle_id).json()["next_action"] == "request_review"

    requested = _request(client, bundle_id)
    assert requested.json()["next_action"] == "await_review"
    assert _get_readiness(client, bundle_id)["next_action"] == "await_review"
    assert _post(client, bundle_id, "complete", REVIEWER).json()["next_action"] == "done"


def test_next_action_follows_the_first_unmet_condition(client: TestClient) -> None:
    fx = _make_ready(client)
    assert get_bundle(client, fx.bundle_id)["next_action"] == "request_review"

    assert set_members(client, fx.bundle_id, AUTHOR_ONLY).status_code == 200
    assert get_bundle(client, fx.bundle_id)["next_action"] == "add_reviewer"
    assert _put_checks(client, fx.bundle_id, numbers=False).status_code == 200
    assert get_bundle(client, fx.bundle_id)["next_action"] == "semantic_checks"
    update_row(UnitDecision, _unit_id(fx, KO_2), disposition="delete", reason="")
    assert get_bundle(client, fx.bundle_id)["next_action"] == "fill_reasons"
    _add_warning(fx)
    assert get_bundle(client, fx.bundle_id)["next_action"] == "ack_warnings"
    update_row(UnitDecision, _unit_id(fx, EN_1), status="on_hold", hold_reason=HOLD_REASON)
    assert get_bundle(client, fx.bundle_id)["next_action"] == "decide_units"
    _set_boundary(client, fx, [_unit_id(fx, KO_1)], False)
    assert get_bundle(client, fx.bundle_id)["next_action"] == "check_boundaries"
    rejected = upload(client, fx.bundle_id, b"Synthetic notes", "SYNTHETIC notes.txt")
    assert rejected.json()["status"] == "rejected"
    assert get_bundle(client, fx.bundle_id)["next_action"] == "resolve_documents"
    assert _get_readiness(client, fx.bundle_id)["next_action"] == "resolve_documents"


def test_a_rejected_only_bundle_asks_to_resolve_documents(client: TestClient) -> None:
    bundle_id = create_bundle(client)["id"]
    rejected = upload(client, bundle_id, b"Synthetic notes", "SYNTHETIC notes.txt")
    assert rejected.json()["status"] == "rejected"

    readiness = _get_readiness(client, bundle_id)

    assert {"code": "no_documents"} in readiness["blockers"]
    assert {"code": "unresolved_documents", "document_ids": [rejected.json()["id"]]} in readiness["blockers"]
    assert readiness["next_action"] == "resolve_documents"


def test_readiness_uses_bounded_queries(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, WITH_REVIEWER).status_code == 200
    uploaded = upload(client, bundle_id, build_docx("".join(p(f"합성 문장 {n}번을 확인한다.") for n in range(1000))), OLD_NAME)
    assert uploaded.status_code == 201, uploaded.text

    with _count_queries() as statements:
        response = client.get(f"/api/bundles/{bundle_id}/review/readiness", headers=AUTHOR)

    assert response.status_code == 200
    assert {"code": "units_unassigned", "count": 1000} in response.json()["blockers"]
    assert 0 < len(statements) <= MAX_READINESS_STATEMENTS, len(statements)


async def _load_snapshot(session: AsyncSession, bundle_id: int, *, include_text: bool) -> tuple[BundleSnapshot, str]:
    """스냅숏과 그것을 읽는 동안 나간 SQL 전부(한 글)."""
    with _count_queries() as statements:
        snap = await load_bundle_snapshot(session, bundle_id, include_text=include_text)
    return snap, "\n".join(statements)


def test_readiness_does_not_read_document_text(client: TestClient) -> None:
    fx = _make_ready(client)
    _hold_one_unit(client, fx)  # 막는 이유가 하나 있는 상태에서 두 스냅숏이 같은 판정을 내는지 본다

    full, full_sql = run_in_session(partial(_load_snapshot, bundle_id=fx.bundle_id, include_text=True))
    bare, bare_sql = run_in_session(partial(_load_snapshot, bundle_id=fx.bundle_id, include_text=False))

    assert any(unit.text for unit in full.units.values())
    assert any(target.confirmed_text for target in full.targets.values())
    assert full.units and full.targets and len(bare.units) == len(full.units) and len(bare.targets) == len(full.targets)
    assert all(unit.text == "" for unit in bare.units.values())
    assert all(target.confirmed_text == "" and target.ai_text == "" for target in bare.targets.values())
    for column in ("units.text", "target_sentences.confirmed_text", "target_sentences.ai_text"):
        assert column in full_sql
        assert column not in bare_sql  # 글자 열은 DB에서 아예 읽지 않는다
    options = {"semantic_checks": ALL_CHECKED, "unacked_missing_text": 0, "unchecked_boundaries": {}, "reviewer_count": 1}
    expected = [{"code": "units_on_hold", "count": 1}]
    assert evaluate_readiness(full, **options).blockers == expected
    assert evaluate_readiness(bare, **options) == evaluate_readiness(full, **options)
    with _count_queries() as statements:  # 엔드포인트와 개요도 글자 없는 스냅숏을 쓴다
        assert _get_readiness(client, fx.bundle_id)["blockers"] == expected
        assert get_bundle(client, fx.bundle_id)["next_action"] == "decide_units"
    sql = "\n".join(statements)
    assert "FROM units" in sql
    assert "units.text" not in sql and "target_sentences.confirmed_text" not in sql


def test_creating_a_bundle_skips_the_readiness_computation(client: TestClient) -> None:
    with _count_queries() as statements:
        response = client.post("/api/bundles", json={"title": "Fresh"}, headers=AUTHOR)

    assert response.status_code == 201, response.text
    assert response.json()["next_action"] == "upload_documents"
    # 스냅숏만 읽는 표 — target_sentences는 진행 숫자(한 언어 글 세기)도 하위 질의로 보므로 기준에서 뺀다
    snapshot_tables = ("FROM source_blocks", "FROM target_docs")
    assert not [statement for statement in statements if any(table in statement for table in snapshot_tables)]
