"""To-Be 목록 — 읽기·통째 쓰기·코드 기준 합치기·검사 규칙, Excel 템플릿 왕복과 가져오기 검사."""

import struct
import zipfile
from datetime import datetime
from io import BytesIO

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop import tobe_excel
from app.sop.models import Bundle, Document, TargetDoc, TargetDocNaSlot
from app.sop.tobe import is_within_slot
from app.sop.tobe_excel import parse_tobe_workbook
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_view,
    put_tobe,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOC_SHEET = "새 문서"
STEP_SHEET = "WI 단계"
DOC_HEADER = ("문서 번호", "제목", "종류", "부모 SOP 번호", "장비 SOP 여부")
STEP_HEADER = ("WI 번호", "단계 번호", "단계 제목")


def _doc(
    code: str, doc_type: str = "sop", *, title: str = "", parent: str | None = None, equipment: bool = False,
    order: int = 0,
) -> dict:
    return {
        "code": code, "title": title, "doc_type": doc_type, "parent_code": parent,
        "is_equipment_sop": equipment, "order_index": order,
    }


def _na(code: str, slot_key: str, reason: str = "Not applicable here") -> dict:
    return {"code": code, "slot_key": slot_key, "reason": reason}


def _step(code: str, step_no: int, title: str = "") -> dict:
    return {"code": code, "step_no": step_no, "title": title}


def _get_tobe(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/tobe", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _sample_list() -> tuple[list[dict], list[dict], list[dict]]:
    """장비 SOP 1 + WI 2 + N/A 1 + 단계 2 — 가져오기 왕복에서도 같은 순서(0, 1, 2)로 돌아오는 목록."""
    docs = [
        _doc("SOP-NEW", title="New SOP", equipment=True, order=0),
        _doc("WI-01", "wi", title="First WI", parent="SOP-NEW", order=1),
        _doc("WI-02", "wi", title="Second WI", parent="SOP-NEW", order=2),
    ]
    na_slots = [_na("SOP-NEW", "procedures.troubleshooting", "No faults expected")]
    wi_steps = [_step("WI-01", 1, "Prepare"), _step("WI-01", 2)]
    return docs, na_slots, wi_steps


def _make_workbook(
    doc_rows: list[list] = (), step_rows: list[list] = (), *,
    doc_header: tuple = DOC_HEADER, step_header: tuple = STEP_HEADER, with_step_sheet: bool = True,
) -> Workbook:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = DOC_SHEET
    sheet.append(list(doc_header))
    for row in doc_rows:
        sheet.append(row)
    if with_step_sheet:
        steps = workbook.create_sheet(STEP_SHEET)
        steps.append(list(step_header))
        for row in step_rows:
            steps.append(row)
    return workbook


def _to_bytes(workbook: Workbook) -> bytes:
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _build_xlsx(doc_rows: list[list] = (), step_rows: list[list] = (), **kwargs: object) -> bytes:
    return _to_bytes(_make_workbook(doc_rows, step_rows, **kwargs))


def _post_import(
    client: TestClient, bundle_id: int, data: bytes, *, revision: int | None = None,
    headers: dict[str, str] = AUTHOR,
):
    if revision is None:
        revision = get_bundle(client, bundle_id, headers)["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/tobe/import",
        files={"file": ("tobe.xlsx", data, XLSX)},
        data={"revision": str(revision)},
        headers=headers,
    )


def _seed_match_doc(
    bundle_id: int, code: str, doc_type: str, *, parent_id: int | None = None, with_file: bool = False
) -> int:
    """입구 2(문서 업로드)가 만드는 match 문서를 DB에 직접 심는다 — 업로드 API는 뒤 태스크에서 생긴다."""

    async def _seed(session: AsyncSession) -> int:
        doc = TargetDoc(
            bundle_id=bundle_id, code=code, title=f"Uploaded {code}", doc_type=doc_type, entrance="match",
            parent_id=parent_id,
        )
        session.add(doc)
        await session.flush()
        if with_file:
            session.add(Document(
                bundle_id=bundle_id, side="new", file_name="synthetic.docx", file_format="docx", size_bytes=1,
                sha256="0" * 64, status="ready", target_doc_id=doc.id, uploaded_by="qa.member",
            ))
        await session.commit()
        return doc.id

    return run_in_session(_seed)


# ── 읽기·쓰기 ──────────────────────────────────────────────────────────────────


def test_put_and_get_tobe_roundtrip(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()

    response = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == 2
    assert [
        (d["code"], d["title"], d["doc_type"], d["parent_code"], d["entrance"], d["is_equipment_sop"],
         d["order_index"], d["document_id"])
        for d in saved["docs"]
    ] == [
        ("SOP-NEW", "New SOP", "sop", None, "assign", True, 0, None),
        ("WI-01", "First WI", "wi", "SOP-NEW", "assign", False, 1, None),
        ("WI-02", "Second WI", "wi", "SOP-NEW", "assign", False, 2, None),
    ]
    assert len({d["id"] for d in saved["docs"]}) == 3
    assert saved["na_slots"] == na_slots
    assert saved["wi_steps"] == wi_steps
    assert _get_tobe(client, bundle["id"]) == saved
    assert get_bundle(client, bundle["id"])["revision"] == 2


def test_new_bundle_has_an_empty_tobe_list(client: TestClient) -> None:
    bundle = create_bundle(client)

    assert _get_tobe(client, bundle["id"]) == {"revision": 1, "docs": [], "na_slots": [], "wi_steps": []}


def test_tobe_keeps_ids_when_merging_by_code(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    first = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps).json()
    ids = {d["code"]: d["id"] for d in first["docs"]}

    docs[0]["title"] = "Renamed SOP"
    docs.append(_doc("WI-03", "wi", parent="SOP-NEW", order=3))
    second = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)

    assert second.status_code == 200, second.text
    after = {d["code"]: d for d in second.json()["docs"]}
    assert {code: after[code]["id"] for code in ids} == ids
    assert after["SOP-NEW"]["title"] == "Renamed SOP"
    assert after["WI-03"]["id"] not in ids.values()
    assert second.json()["revision"] == 3


def test_put_removes_assign_docs_missing_from_the_list(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)

    # SOP와 그 아래 WI를 함께 뺀다 — 부모·자식을 한 번에 지워도 FK에 걸리지 않는다
    response = put_tobe(client, bundle["id"], [_doc("SOP-OTHER", title="Other")])

    assert response.status_code == 200, response.text
    body = response.json()
    assert [d["code"] for d in body["docs"]] == ["SOP-OTHER"]
    assert body["na_slots"] == [] and body["wi_steps"] == []


def test_put_replaces_na_slots_and_steps_of_listed_docs(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)

    response = put_tobe(
        client, bundle["id"], docs,
        na_slots=[_na("SOP-NEW", "purpose", "Covered elsewhere")],
        wi_steps=[_step("WI-01", 2, "Renamed"), _step("WI-02", 1)],
    )

    body = response.json()
    assert body["na_slots"] == [_na("SOP-NEW", "purpose", "Covered elsewhere")]
    assert body["wi_steps"] == [_step("WI-01", 2, "Renamed"), _step("WI-02", 1)]


def test_na_slot_keeps_who_marked_it_until_the_reason_changes(client: TestClient) -> None:
    bundle = create_bundle(client)
    set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "author")])
    docs = [_doc("SOP-A")]

    def read_marks() -> list[tuple[str, str, str]]:
        async def _read(session: AsyncSession) -> list[tuple[str, str, str]]:
            rows = await session.scalars(select(TargetDocNaSlot))
            return [(row.slot_key, row.reason, row.set_by) for row in rows]

        return run_in_session(_read)

    put_tobe(client, bundle["id"], docs, na_slots=[_na("SOP-A", "scope", "First")])
    put_tobe(client, bundle["id"], docs, na_slots=[_na("SOP-A", "scope", "First")], headers=REVIEWER)
    assert read_marks() == [("scope", "First", "qa.member")]  # 사유가 그대로면 처음 표시한 사람을 지킨다

    put_tobe(client, bundle["id"], docs, na_slots=[_na("SOP-A", "scope", "Second")], headers=REVIEWER)
    assert read_marks() == [("scope", "Second", "qa.lead")]


def test_changing_a_doc_type_drops_rows_that_no_longer_apply(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs = [_doc("DOC-1", title="Flips type"), _doc("WI-1", "wi", parent="DOC-1")]
    put_tobe(client, bundle["id"], docs, na_slots=[_na("DOC-1", "scope")])

    # SOP였던 DOC-1이 WI가 되면 N/A는 사라진다. 대신 새 SOP를 부모로 둔다
    flipped = [_doc("SOP-2"), _doc("DOC-1", "wi", parent="SOP-2"), _doc("WI-1", "wi", parent="SOP-2")]
    response = put_tobe(client, bundle["id"], flipped, wi_steps=[_step("DOC-1", 1, "Now a WI")])

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(d["code"], d["doc_type"]) for d in body["docs"]] == [("DOC-1", "wi"), ("WI-1", "wi"), ("SOP-2", "sop")]
    assert body["na_slots"] == []
    assert body["wi_steps"] == [_step("DOC-1", 1, "Now a WI")]


@pytest.mark.parametrize(
    ("expected_code", "docs", "na_slots", "wi_steps"),
    [
        pytest.param("duplicate_code", [_doc("A"), _doc("A")], [], [], id="duplicate_code"),
        pytest.param("invalid_doc_type", [_doc("A", "policy")], [], [], id="invalid_doc_type"),
        pytest.param("invalid_parent", [_doc("W", "wi")], [], [], id="wi_without_parent"),
        pytest.param("invalid_parent", [_doc("W", "wi", parent="NOPE")], [], [], id="wi_parent_not_in_list"),
        pytest.param(
            "invalid_parent", [_doc("W1", "wi", parent="W2"), _doc("W2", "wi", parent="W1")], [], [],
            id="wi_parent_is_a_wi",
        ),
        pytest.param("invalid_parent", [_doc("A"), _doc("B", parent="A")], [], [], id="sop_with_parent"),
        pytest.param(
            "equipment_flag_on_wi", [_doc("A"), _doc("W", "wi", parent="A", equipment=True)], [], [],
            id="equipment_flag_on_wi",
        ),
        pytest.param("unknown_slot", [_doc("A")], [_na("A", "procedures.nope")], [], id="unknown_slot"),
        pytest.param(
            "na_on_wi", [_doc("A"), _doc("W", "wi", parent="A")], [_na("W", "purpose")], [], id="na_on_wi"
        ),
        pytest.param("unknown_doc", [_doc("A")], [_na("GHOST", "purpose")], [], id="na_for_unknown_doc"),
        pytest.param(
            "duplicate_na_slot", [_doc("A")], [_na("A", "purpose"), _na("A", "purpose", "Again")], [],
            id="duplicate_na_slot",
        ),
        pytest.param("steps_on_sop", [_doc("A")], [], [_step("A", 1)], id="steps_on_sop"),
        pytest.param(
            "duplicate_step", [_doc("A"), _doc("W", "wi", parent="A")], [], [_step("W", 1), _step("W", 1, "Again")],
            id="duplicate_step",
        ),
        pytest.param("unknown_doc", [_doc("A")], [], [_step("GHOST", 1)], id="steps_for_unknown_doc"),
    ],
)
def test_tobe_rejects_bad_lists(client: TestClient, expected_code: str, docs, na_slots, wi_steps) -> None:
    bundle = create_bundle(client)

    response = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == expected_code
    # 거절된 요청은 아무것도 남기지 않는다
    assert _get_tobe(client, bundle["id"]) == {"revision": 1, "docs": [], "na_slots": [], "wi_steps": []}


@pytest.mark.parametrize(
    "body_patch",
    [
        {"docs": [{"code": "", "doc_type": "sop"}]},
        {"docs": [{"code": "x" * 101, "doc_type": "sop"}]},
        {"docs": [{"code": "A", "doc_type": "sop", "title": "t" * 501}]},
        {"docs": [{"code": "A", "doc_type": "sop", "order_index": -1}]},
        {"na_slots": [{"code": "A", "slot_key": "purpose", "reason": "   "}]},
        {"na_slots": [{"code": "A", "slot_key": "purpose", "reason": "r" * 2001}]},
        {"wi_steps": [{"code": "W", "step_no": 0}]},
        {"revision": 0},
        {"na_slots": None},
    ],
)
def test_tobe_rejects_malformed_input_with_the_default_422(client: TestClient, body_patch: dict) -> None:
    bundle = create_bundle(client)
    body = {"revision": 1, "docs": [], "na_slots": [], "wi_steps": []} | body_patch

    response = client.put(f"/api/bundles/{bundle['id']}/tobe", json=body, headers=AUTHOR)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)  # FastAPI 기본 검증 오류 모양


@pytest.mark.parametrize(
    ("slot_key", "slot", "expected"),
    [
        ("procedures", "procedures", True),
        ("procedures.procedure", "procedures", True),
        ("procedures.maintenance", "procedures", True),
        ("procedures.procedure", "procedures.procedure", True),
        ("purpose", "procedures", False),
        ("procedures", "procedures.procedure", False),  # 하위 칸의 N/A는 상위 칸을 덮지 않는다
        ("procedures_extra", "procedures", False),  # 접두 글자만 같은 다른 칸
        ("general_requirements.safety", "general_requirements.operation", False),
    ],
)
def test_na_on_a_slot_covers_its_sub_slots_only(slot_key: str, slot: str, expected: bool) -> None:
    assert is_within_slot(slot_key, slot) is expected


def test_tobe_rejects_changes_under_targets(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    docs = [_doc("SOP-A"), _doc("WI-A", "wi", parent="SOP-A"), _doc("SOP-B")]
    steps = [_step("WI-A", 1)]
    assert put_tobe(client, bundle["id"], docs, wi_steps=steps).status_code == 200
    ids = {doc["code"]: doc["id"] for doc in _get_tobe(client, bundle["id"])["docs"]}
    body = p("합성 첫 문장이다.") + p("합성 둘째 문장이다.") + p("합성 셋째 문장이다.")
    uploaded = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_OLD-1_Tobe.docx")
    assert uploaded.status_code == 201, uploaded.text
    view = get_view(client, bundle["id"], uploaded.json()["id"])
    assign_as_is(client, bundle["id"], find_unit(view, "합성 첫 문장이다."), ids["SOP-A"], slot_key="procedures.maintenance")
    assign_as_is(
        client, bundle["id"], find_unit(view, "합성 둘째 문장이다."), ids["WI-A"], wi_step=1, wi_part="instruction"
    )
    assign_as_is(client, bundle["id"], find_unit(view, "합성 셋째 문장이다."), ids["SOP-B"], slot_key="purpose")
    before = _get_tobe(client, bundle["id"])

    cases = [
        (put_tobe(client, bundle["id"], docs[:2], wi_steps=steps), {"code": "doc_has_targets", "codes": ["SOP-B"]}),
        (
            put_tobe(client, bundle["id"], docs, na_slots=[_na("SOP-A", "procedures.maintenance")], wi_steps=steps),
            {"code": "slot_has_targets", "slots": [{"doc_code": "SOP-A", "slot_key": "procedures.maintenance"}]},
        ),
        # 상위 칸 N/A는 하위 칸에 든 문장도 막는다
        (
            put_tobe(client, bundle["id"], docs, na_slots=[_na("SOP-A", "procedures")], wi_steps=steps),
            {"code": "slot_has_targets", "slots": [{"doc_code": "SOP-A", "slot_key": "procedures"}]},
        ),
        (put_tobe(client, bundle["id"], docs, wi_steps=[]), {"code": "step_has_targets", "steps": [{"doc_code": "WI-A", "step_no": 1}]}),
        (
            put_tobe(client, bundle["id"], [*docs[:2], _doc("SOP-B", "wi", parent="SOP-A")], wi_steps=steps),
            {"code": "doc_has_targets", "codes": ["SOP-B"]},
        ),
        (
            put_tobe(client, bundle["id"], [docs[0], _doc("WI-A"), docs[2]], wi_steps=[]),
            {"code": "doc_has_targets", "codes": ["WI-A"]},
        ),
    ]

    for response, detail in cases:
        assert response.status_code == 409, response.text
        assert response.json()["detail"] == detail
    assert _get_tobe(client, bundle["id"]) == before


# ── match 문서(입구 2) ─────────────────────────────────────────────────────────


def test_match_docs_are_listed_kept_and_usable_as_parents(client: TestClient) -> None:
    bundle = create_bundle(client)
    match_id = _seed_match_doc(bundle["id"], "UP-SOP", "sop", with_file=True)

    listed = _get_tobe(client, bundle["id"])["docs"]
    assert [(d["code"], d["entrance"], d["document_id"] is not None) for d in listed] == [("UP-SOP", "match", True)]

    # 목록에 싣지 않아도 지워지지 않고, 목록에 없는 match SOP를 WI의 부모로 쓸 수 있다
    response = put_tobe(client, bundle["id"], [_doc("WI-1", "wi", parent="UP-SOP")])

    assert response.status_code == 200, response.text
    docs = {d["code"]: d for d in response.json()["docs"]}
    assert docs["UP-SOP"]["id"] == match_id
    assert docs["UP-SOP"]["entrance"] == "match"
    assert docs["WI-1"]["parent_code"] == "UP-SOP"


def test_match_doc_type_and_entrance_cannot_change(client: TestClient) -> None:
    bundle = create_bundle(client)
    match_id = _seed_match_doc(bundle["id"], "UP-SOP", "sop", with_file=True)

    locked = put_tobe(client, bundle["id"], [_doc("UP-SOP", "wi", parent="SOP-X"), _doc("SOP-X")])
    assert locked.status_code == 409
    assert locked.json()["detail"] == {"code": "match_doc_locked", "codes": ["UP-SOP"]}

    # 같은 종류로 실어 보내면 제목은 고칠 수 있고 입구와 올린 파일 연결은 그대로다
    renamed = put_tobe(client, bundle["id"], [_doc("UP-SOP", title="Renamed upload")])
    assert renamed.status_code == 200, renamed.text
    (doc,) = renamed.json()["docs"]
    assert (doc["id"], doc["title"], doc["entrance"]) == (match_id, "Renamed upload", "match")
    assert doc["document_id"] is not None


def test_a_removed_parent_still_needed_by_a_kept_match_doc_is_rejected(client: TestClient) -> None:
    bundle = create_bundle(client)
    sop_id = put_tobe(client, bundle["id"], [_doc("SOP-A")]).json()["docs"][0]["id"]
    _seed_match_doc(bundle["id"], "UP-WI", "wi", parent_id=sop_id)

    response = put_tobe(client, bundle["id"], [])

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "invalid_parent", "doc_code": "UP-WI", "parent_code": "SOP-A"}
    assert {d["code"] for d in _get_tobe(client, bundle["id"])["docs"]} == {"SOP-A", "UP-WI"}


# ── 권한·상태·revision ─────────────────────────────────────────────────────────


def test_reviewer_cannot_write_tobe(client: TestClient) -> None:
    bundle = create_bundle(client)
    client.put(
        f"/api/bundles/{bundle['id']}/members",
        json={"revision": 1, "members": [
            {"login_id": "qa.member", "role": "author"}, {"login_id": "qa.lead", "role": "reviewer"}
        ]},
        headers=AUTHOR,
    )
    revision = get_bundle(client, bundle["id"])["revision"]

    put = client.put(
        f"/api/bundles/{bundle['id']}/tobe",
        json={"revision": revision, "docs": [], "na_slots": [], "wi_steps": []},
        headers=REVIEWER,
    )
    imported = _post_import(client, bundle["id"], _build_xlsx(), headers=REVIEWER)

    assert put.status_code == 403 and put.json()["detail"]["code"] == "role_required"
    assert imported.status_code == 403 and imported.json()["detail"]["code"] == "role_required"
    # 읽기와 템플릿은 멤버면 누구나
    assert _get_tobe(client, bundle["id"], REVIEWER)["revision"] == revision
    assert client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=REVIEWER).status_code == 200


def test_non_members_get_404_on_every_tobe_route(client: TestClient) -> None:
    bundle = create_bundle(client)
    base = f"/api/bundles/{bundle['id']}/tobe"

    responses = [
        client.get(base, headers=OUTSIDER),
        client.put(base, json={"revision": 1, "docs": [], "na_slots": [], "wi_steps": []}, headers=OUTSIDER),
        client.get(f"{base}/template.xlsx", headers=OUTSIDER),
        _post_import(client, bundle["id"], _build_xlsx(), revision=1, headers=OUTSIDER),
    ]

    assert [r.status_code for r in responses] == [404, 404, 404, 404]
    assert {r.json()["detail"]["code"] for r in responses} == {"bundle_not_found"}


def test_tobe_writes_need_the_current_revision(client: TestClient) -> None:
    bundle = create_bundle(client)
    base = f"/api/bundles/{bundle['id']}/tobe"

    put = client.put(base, json={"revision": 5, "docs": [], "na_slots": [], "wi_steps": []}, headers=AUTHOR)
    imported = _post_import(client, bundle["id"], _build_xlsx(), revision=5)

    for response in (put, imported):
        assert response.status_code == 409
        assert response.json()["detail"] == {
            "code": "revision_conflict",
            "conflicts": [{"entity": "bundle", "id": bundle["id"], "current_revision": 1}],
        }


def test_tobe_writes_are_refused_once_the_bundle_leaves_in_progress(client: TestClient) -> None:
    bundle = create_bundle(client)
    update_row(Bundle, bundle["id"], status="in_review")

    put = put_tobe(client, bundle["id"], [_doc("A")])
    imported = _post_import(client, bundle["id"], _build_xlsx())

    for response in (put, imported):
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "bundle_not_editable", "status": "in_review"}
    assert _get_tobe(client, bundle["id"])["docs"] == []


def test_tobe_writes_leave_an_activity_record_with_the_touched_doc_ids(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    saved = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps).json()
    _post_import(client, bundle["id"], _build_xlsx([["SOP-NEW", "From file", "SOP", None, "N"]]))

    events = client.get(f"/api/bundles/{bundle['id']}/events", headers=AUTHOR).json()

    by_action = {e["action"]: e for e in events}
    assert by_action["tobe.update"]["target_type"] == "target_doc"
    assert by_action["tobe.update"]["target_ids"] == sorted(d["id"] for d in saved["docs"])
    assert by_action["tobe.update"]["actor"] == "qa.member"
    assert by_action["tobe.import"]["target_type"] == "target_doc"
    # 파일은 SOP-NEW 하나만 싣고 나머지 assign 문서(WI 둘)는 지운다
    assert sorted(by_action["tobe.import"]["target_ids"]) == sorted(d["id"] for d in saved["docs"])


def test_a_tobe_write_that_changes_nothing_keeps_the_revision_and_records_nothing(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    saved = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps).json()
    template = client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=AUTHOR).content

    same_put = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps)
    same_import = _post_import(client, bundle["id"], template)

    for response in (same_put, same_import):
        assert response.status_code == 200, response.text
        assert response.json() == saved  # 목록도 revision(2)도 그대로
    events = client.get(f"/api/bundles/{bundle['id']}/events", headers=AUTHOR).json()
    assert [e["action"] for e in events if e["action"].startswith("tobe.")] == ["tobe.update"]
    # 무변경 저장 뒤에도 방금 읽은 revision으로 다음 저장이 된다
    assert put_tobe(client, bundle["id"], [*docs, _doc("SOP-2")], na_slots=na_slots, wi_steps=wi_steps).json()["revision"] == 3


# ── Excel 템플릿·가져오기 ──────────────────────────────────────────────────────


def test_template_roundtrip_imports_same_list(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    before = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps).json()

    template = client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=AUTHOR)

    assert template.status_code == 200
    assert template.headers["content-type"] == XLSX
    assert 'attachment; filename="tobe-template.xlsx"' in template.headers["content-disposition"]
    workbook = load_workbook(BytesIO(template.content), data_only=True)
    assert workbook.sheetnames == [DOC_SHEET, STEP_SHEET]
    assert [tuple(row) for row in workbook[DOC_SHEET].iter_rows(values_only=True)] == [
        DOC_HEADER,
        ("SOP-NEW", "New SOP", "SOP", None, "Y"),
        ("WI-01", "First WI", "WI", "SOP-NEW", "N"),
        ("WI-02", "Second WI", "WI", "SOP-NEW", "N"),
    ]
    assert [tuple(row) for row in workbook[STEP_SHEET].iter_rows(values_only=True)] == [
        STEP_HEADER, ("WI-01", 1, "Prepare"), ("WI-01", 2, None),
    ]

    imported = _post_import(client, bundle["id"], template.content)

    assert imported.status_code == 200, imported.text
    after = imported.json()
    assert after["revision"] == before["revision"]  # 바뀐 게 없으면 revision을 올리지 않는다
    assert (after["docs"], after["na_slots"], after["wi_steps"]) == (before["docs"], before["na_slots"], before["wi_steps"])


def test_empty_template_has_only_the_header_rows(client: TestClient) -> None:
    bundle = create_bundle(client)

    template = client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=AUTHOR)

    workbook = load_workbook(BytesIO(template.content), data_only=True)
    assert [tuple(row) for row in workbook[DOC_SHEET].iter_rows(values_only=True)] == [DOC_HEADER]
    assert [tuple(row) for row in workbook[STEP_SHEET].iter_rows(values_only=True)] == [STEP_HEADER]
    assert _post_import(client, bundle["id"], template.content).status_code == 200


def test_template_lists_only_assign_docs(client: TestClient) -> None:
    bundle = create_bundle(client)
    _seed_match_doc(bundle["id"], "UP-SOP", "sop", with_file=True)
    put_tobe(client, bundle["id"], [_doc("SOP-1")])

    template = client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=AUTHOR)

    workbook = load_workbook(BytesIO(template.content), data_only=True)
    assert [row[0] for row in workbook[DOC_SHEET].iter_rows(min_row=2, values_only=True)] == ["SOP-1"]


def test_import_merges_by_code_replaces_steps_and_leaves_na_alone(client: TestClient) -> None:
    bundle = create_bundle(client)
    docs, na_slots, wi_steps = _sample_list()
    wi_steps.append(_step("WI-02", 1, "Old step"))
    before = put_tobe(client, bundle["id"], docs, na_slots=na_slots, wi_steps=wi_steps).json()
    ids = {d["code"]: d["id"] for d in before["docs"]}

    data = _build_xlsx(
        [
            ["SOP-NEW", "Renamed in file", "sop", None, "예"],
            ["WI-01", "First WI", "WI", "SOP-NEW", None],
            ["WI-02", "Second WI", "wi", "SOP-NEW", "n"],
            ["WI-03", "Third WI", "WI", "SOP-NEW", "N"],
        ],
        [["WI-01", 2, "Only step"]],
    )
    response = _post_import(client, bundle["id"], data)

    assert response.status_code == 200, response.text
    after = response.json()
    assert {d["code"]: d["id"] for d in after["docs"] if d["code"] in ids} == ids
    assert [(d["code"], d["title"], d["is_equipment_sop"], d["order_index"]) for d in after["docs"]] == [
        ("SOP-NEW", "Renamed in file", True, 0),
        ("WI-01", "First WI", False, 1),
        ("WI-02", "Second WI", False, 2),
        ("WI-03", "Third WI", False, 3),
    ]
    assert after["na_slots"] == na_slots  # 가져오기는 N/A를 건드리지 않는다
    # 파일에 나온 WI는 파일의 단계로 바뀐다(WI-02는 단계 줄이 없어 비워진다)
    assert after["wi_steps"] == [_step("WI-01", 2, "Only step")]


def test_import_drops_na_slots_of_a_sop_that_the_file_turns_into_a_wi(client: TestClient) -> None:
    bundle = create_bundle(client)
    put_tobe(client, bundle["id"], [_doc("SOP-A"), _doc("SOP-B")], na_slots=[_na("SOP-B", "scope")])

    response = _post_import(client, bundle["id"], _build_xlsx([
        ["SOP-A", "", "SOP", None, None], ["SOP-B", "", "WI", "SOP-A", None],
    ]))

    assert response.status_code == 200, response.text
    assert response.json()["na_slots"] == []


def test_import_does_not_delete_match_docs_missing_from_the_file(client: TestClient) -> None:
    bundle = create_bundle(client)
    match_id = _seed_match_doc(bundle["id"], "UP-SOP", "sop", with_file=True)
    put_tobe(client, bundle["id"], [_doc("SOP-1")])

    response = _post_import(client, bundle["id"], _build_xlsx([["WI-1", "", "WI", "UP-SOP", None]]))

    assert response.status_code == 200, response.text
    docs = {d["code"]: d for d in response.json()["docs"]}
    assert set(docs) == {"UP-SOP", "WI-1"}  # SOP-1(assign)은 지워지고 UP-SOP(match)는 남는다
    assert docs["UP-SOP"]["id"] == match_id


def test_import_reads_values_not_formulas(client: TestClient) -> None:
    bundle = create_bundle(client)
    workbook = _make_workbook([["SOP-1", None, "SOP", None, None], ["SOP-2", None, "SOP", None, None]])
    sheet = workbook[DOC_SHEET]
    sheet["B2"] = '="X"&"Y"'  # 수식 — 저장된 값이 없다
    sheet["B3"].value = "=SUM(1)"
    sheet["B3"].data_type = "s"  # 문자열 셀 — 글자 그대로 읽는다

    response = _post_import(client, bundle["id"], _to_bytes(workbook))

    assert response.status_code == 200, response.text
    assert [(d["code"], d["title"]) for d in response.json()["docs"]] == [("SOP-1", ""), ("SOP-2", "=SUM(1)")]


def test_template_keeps_formula_looking_text_as_text(client: TestClient) -> None:
    bundle = create_bundle(client)
    put_tobe(client, bundle["id"], [_doc("SOP-1", title='=HYPERLINK("http://x","y")'), _doc("SOP-2", title="a\x0bb")])

    template = client.get(f"/api/bundles/{bundle['id']}/tobe/template.xlsx", headers=AUTHOR)

    assert template.status_code == 200
    cell = load_workbook(BytesIO(template.content))[DOC_SHEET]["B2"]
    assert cell.data_type == "s"  # 수식으로 저장되지 않는다
    imported = _post_import(client, bundle["id"], template.content)
    # 문자열 셀이라 글자 그대로 돌아오고, XML에 못 쓰는 제어 문자만 바뀐다
    assert [d["title"] for d in imported.json()["docs"]] == ['=HYPERLINK("http://x","y")', "a\N{REPLACEMENT CHARACTER}b"]


def test_import_turns_numeric_codes_into_text(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = _post_import(client, bundle["id"], _build_xlsx([
        [1001, "", "SOP", None, None], [1002.0, "", "SOP", None, None], [1003.5, "", "SOP", None, None],
    ]))

    assert [d["code"] for d in response.json()["docs"]] == ["1001", "1002", "1003.5"]


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        ("Y", True), ("y", True), ("예", True), ("TRUE", True), ("true", True), (True, True), (1, True), ("1", True),
        (" Y ", True), ("N", False), ("아니오", False), ("FALSE", False), (False, False), (0, False), ("0", False),
        ("", False), (None, False),
    ],
)
def test_import_reads_the_equipment_flag(client: TestClient, cell: object, expected: bool) -> None:
    bundle = create_bundle(client)

    response = _post_import(client, bundle["id"], _build_xlsx([["SOP-1", "", "SOP", None, cell]]))

    assert response.status_code == 200, response.text
    assert response.json()["docs"][0]["is_equipment_sop"] is expected


@pytest.mark.parametrize(
    ("doc_rows", "step_rows", "expected"),
    [
        pytest.param(
            [["SOP-1", "t", "Policy", None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "종류"}, id="bad_type",
        ),
        pytest.param(
            [["SOP-1", "t", "SOP", None, None], ["SOP-2", "t", None, None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 3, "column": "종류"}, id="blank_type",
        ),
        pytest.param(
            [["SOP-1", "t", "SOP", None, "maybe"]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "장비 SOP 여부"}, id="bad_flag",
        ),
        pytest.param(
            [["SOP-1", "t", "SOP", None, 2]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "장비 SOP 여부"}, id="bad_flag_number",
        ),
        pytest.param(
            [[None, "title only", "SOP", None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "문서 번호"}, id="missing_code",
        ),
        pytest.param(
            [["x" * 101, "", "SOP", None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "문서 번호"}, id="long_code",
        ),
        pytest.param(
            [["SOP-1", "t" * 501, "SOP", None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "제목"}, id="long_title",
        ),
        pytest.param(
            [["SOP-1", datetime(2026, 1, 1), "SOP", None, None]], [],
            {"code": "invalid_tobe_file", "sheet": DOC_SHEET, "row": 2, "column": "제목"}, id="date_cell",
        ),
        pytest.param(
            [], [["WI-1", 0, ""]],
            {"code": "invalid_tobe_file", "sheet": STEP_SHEET, "row": 2, "column": "단계 번호"}, id="step_zero",
        ),
        pytest.param(
            [], [["WI-1", 1, ""], ["WI-1", "x", ""]],
            {"code": "invalid_tobe_file", "sheet": STEP_SHEET, "row": 3, "column": "단계 번호"}, id="step_text",
        ),
        pytest.param(
            [], [["WI-1", 1.5, ""]],
            {"code": "invalid_tobe_file", "sheet": STEP_SHEET, "row": 2, "column": "단계 번호"}, id="step_fraction",
        ),
        pytest.param(
            [], [[None, 1, "t"]],
            {"code": "invalid_tobe_file", "sheet": STEP_SHEET, "row": 2, "column": "WI 번호"}, id="step_without_wi",
        ),
    ],
)
def test_import_rejects_bad_cells(client: TestClient, doc_rows: list, step_rows: list, expected: dict) -> None:
    bundle = create_bundle(client)

    response = _post_import(client, bundle["id"], _build_xlsx(doc_rows, step_rows))

    assert response.status_code == 422
    assert response.json()["detail"] == expected
    assert _get_tobe(client, bundle["id"])["revision"] == 1


def test_import_skips_blank_rows_and_reads_step_numbers_given_as_text(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = _post_import(client, bundle["id"], _build_xlsx(
        [["SOP-1", "", "SOP", None, None], [None, None, None, None, None], ["WI-1", "", "WI", "SOP-1", None]],
        [["WI-1", "2", "Second"], ["WI-1", 1.0, "First"]],
    ))

    body = response.json()
    assert [d["code"] for d in body["docs"]] == ["SOP-1", "WI-1"]
    assert body["wi_steps"] == [_step("WI-1", 1, "First"), _step("WI-1", 2, "Second")]


def test_import_applies_the_same_list_rules(client: TestClient) -> None:
    bundle = create_bundle(client)
    cases = {
        "duplicate_code": [["A", "", "SOP", None, None], ["A", "", "SOP", None, None]],
        "invalid_parent": [["W", "", "WI", None, None]],
        "equipment_flag_on_wi": [["A", "", "SOP", None, None], ["W", "", "WI", "A", "Y"]],
    }

    for expected_code, rows in cases.items():
        response = _post_import(client, bundle["id"], _build_xlsx(rows))
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == expected_code

    steps_on_sop = _post_import(client, bundle["id"], _build_xlsx([["A", "", "SOP", None, None]], [["A", 1, ""]]))
    assert steps_on_sop.json()["detail"]["code"] == "steps_on_sop"


def test_import_rejects_files_that_are_not_the_template(client: TestClient) -> None:
    bundle = create_bundle(client)
    wrong_doc_header = _build_xlsx(doc_header=("Code", "Title", "Type", "Parent", "Equipment"))
    wrong_step_header = _build_xlsx(step_header=("WI", "No", "Title"))
    missing_step_sheet = _build_xlsx(with_step_sheet=False)
    not_a_workbook = b"definitely not an xlsx file"
    not_xlsx_zip = BytesIO()
    with zipfile.ZipFile(not_xlsx_zip, "w") as archive:
        archive.writestr("hello.txt", "hi")
    # 시트 XML이 중간에서 끊긴 파일 — 시트는 읽는 도중에야 깨진 게 드러난다
    valid = _build_xlsx([[f"D-{i}", "", "SOP", None, None] for i in range(30)])
    broken_sheet = BytesIO()
    with zipfile.ZipFile(BytesIO(valid)) as source, zipfile.ZipFile(broken_sheet, "w") as target:
        for info in source.infolist():
            content = source.read(info.filename)
            target.writestr(info.filename, content[: len(content) // 2] if info.filename.endswith("sheet1.xml") else content)

    results = [
        _post_import(client, bundle["id"], wrong_doc_header).json()["detail"],
        _post_import(client, bundle["id"], wrong_step_header).json()["detail"],
        _post_import(client, bundle["id"], missing_step_sheet).json()["detail"],
        _post_import(client, bundle["id"], not_a_workbook).json()["detail"],
        _post_import(client, bundle["id"], not_xlsx_zip.getvalue()).json()["detail"],
        _post_import(client, bundle["id"], broken_sheet.getvalue()).json()["detail"],
    ]

    assert results == [
        {"code": "invalid_tobe_file", "sheet": DOC_SHEET},
        {"code": "invalid_tobe_file", "sheet": STEP_SHEET},
        {"code": "invalid_tobe_file", "sheet": STEP_SHEET},
        {"code": "invalid_tobe_file"},
        {"code": "invalid_tobe_file"},
        {"code": "invalid_tobe_file"},
    ]


def _patch_zip_entries(data: bytes, *, flag_bits: int = 0, method: int | None = None) -> bytes:
    """모든 항목의 일반 플래그·압축 방식을 바꾼다 — 디렉터리는 멀쩡해 열 때가 되어서야 못 읽는 파일을 만든다."""
    patched = bytearray(data)
    with zipfile.ZipFile(BytesIO(data)) as archive:
        infos = archive.infolist()
        directory_pos = archive.start_dir
    positions = [(info.header_offset, 6, 8) for info in infos]  # 로컬 머리: 플래그·압축 방식 위치
    for _ in infos:  # 중앙 디렉터리 항목은 이름·추가·주석 길이만큼 가변이라 차례로 건너뛴다
        positions.append((directory_pos, 8, 10))
        name_len, extra_len, comment_len = struct.unpack_from("<HHH", patched, directory_pos + 28)
        directory_pos += 46 + name_len + extra_len + comment_len
    for offset, flag_at, method_at in positions:
        patched[offset + flag_at] |= flag_bits
        if method is not None:
            struct.pack_into("<H", patched, offset + method_at, method)
    return bytes(patched)


def _flip_stream_byte(data: bytes, member_suffix: str, fraction: float) -> bytes:
    """항목의 압축 데이터 한가운데쯤 한 바이트를 뒤집는다 — 디렉터리는 그대로라 압축 해제·CRC 검사에서 걸린다."""
    corrupted = bytearray(data)
    with zipfile.ZipFile(BytesIO(data)) as archive:
        info = next(i for i in archive.infolist() if i.filename.endswith(member_suffix))
    name_len, extra_len = struct.unpack_from("<HH", data, info.header_offset + 26)
    corrupted[info.header_offset + 30 + name_len + extra_len + int(info.compress_size * fraction)] ^= 0xFF
    return bytes(corrupted)


def _store_without_compression(data: bytes) -> bytes:
    """같은 항목을 압축 없이 다시 담는다 — 한 바이트를 뒤집으면 압축 해제는 되지만 CRC가 어긋난다."""
    repacked = BytesIO()
    with zipfile.ZipFile(BytesIO(data)) as source, zipfile.ZipFile(repacked, "w", zipfile.ZIP_STORED) as target:
        for info in source.infolist():
            target.writestr(info.filename, source.read(info.filename))
    return repacked.getvalue()


@pytest.mark.parametrize(
    ("stored", "fraction"),
    [(False, 0.1), (False, 0.5), (False, 0.9), (True, 0.5)],
    ids=["deflate_start", "deflate_middle", "deflate_end", "stored_bad_crc"],
)
def test_import_rejects_a_workbook_whose_compressed_data_is_damaged(
    client: TestClient, stored: bool, fraction: float
) -> None:
    bundle = create_bundle(client)
    valid = _build_xlsx([[f"D-{i}", "t" * 40, "SOP", None, None] for i in range(60)])
    if stored:
        valid = _store_without_compression(valid)

    response = _post_import(client, bundle["id"], _flip_stream_byte(valid, "sheet1.xml", fraction))

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"code": "invalid_tobe_file"}


@pytest.mark.parametrize(
    "patch",
    [{"flag_bits": 0x1}, {"method": 9}],
    ids=["encrypted_members", "unsupported_compression"],
)
def test_import_rejects_a_workbook_zip_that_cannot_be_opened(client: TestClient, patch: dict) -> None:
    bundle = create_bundle(client)

    response = _post_import(client, bundle["id"], _patch_zip_entries(_build_xlsx(), **patch))

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"code": "invalid_tobe_file"}


def test_import_without_a_file_is_the_default_422(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = client.post(f"/api/bundles/{bundle['id']}/tobe/import", data={"revision": "1"}, headers=AUTHOR)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_import_rejects_oversized_files(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = create_bundle(client)
    monkeypatch.setattr(tobe_excel, "MAX_FILE_BYTES", 1024)

    too_big = _post_import(client, bundle["id"], _build_xlsx() + b"\0" * 2048)

    assert too_big.status_code == 422
    assert too_big.json()["detail"] == {"code": "tobe_file_too_large"}


def test_parse_limits_rows_and_uncompressed_size(monkeypatch: pytest.MonkeyPatch) -> None:
    at_limit = [[f"D-{i}", "", "SOP", None, None] for i in range(tobe_excel.MAX_TOBE_ROWS)]
    assert len(parse_tobe_workbook(_build_xlsx(at_limit)).docs) == tobe_excel.MAX_TOBE_ROWS

    with pytest.raises(HTTPException) as over_rows:
        parse_tobe_workbook(_build_xlsx([*at_limit, ["D-over", "", "SOP", None, None]]))
    assert over_rows.value.status_code == 422
    assert over_rows.value.detail == {"code": "tobe_file_too_large"}

    # 뒤쪽의 빈 줄은 행 수로 세지 않는다
    sparse = _make_workbook([["D-1", "", "SOP", None, None]])
    sparse[DOC_SHEET].cell(row=tobe_excel.MAX_TOBE_ROWS + 50, column=1).value = None
    assert len(parse_tobe_workbook(_to_bytes(sparse)).docs) == 1

    monkeypatch.setattr(tobe_excel, "MAX_UNCOMPRESSED_BYTES", 100)
    with pytest.raises(HTTPException) as over_size:
        parse_tobe_workbook(_build_xlsx([["D-1", "", "SOP", None, None]]))
    assert over_size.value.detail == {"code": "tobe_file_too_large"}
