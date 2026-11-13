"""칸 제목(Slot heading) — 옛 제목을 새 SOP 칸 제목에 잇는 저장·출처 더하기·떼어 내기와 결과물 A·C 표시 (제품 명세 §7.13 칸 제목)."""

from io import BytesIO
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence, TargetSource
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    AUTHOR,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)
from tests.test_sop_decision_undo import _ok, _redo, _undo
from tests.test_sop_decisions import _body, _reason, _unit_in
from tests.test_sop_outputs import _get_output, _list_top_target_ids, _put_order

pytestmark = pytest.mark.usefixtures("clean_sop")

KO_HEAD, EN_HEAD = "5. 절차", "5. Procedure"
OLD1_KO, OLD1_EN = "합성 장비를 켠다.", "Turn on the synthetic unit."
OLD2_KO, OLD2_EN = "합성 시료를 넣는다.", "Load the synthetic sample."
SLOT, LABEL = "procedures.procedure", "Procedures › Procedure"
TOBE_DOCS = [
    {"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None},
    {"code": "WI-01", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-NEW"},
]
NA_SLOTS = [{"code": "SOP-NEW", "slot_key": "scope", "reason": "Synthetic: covered elsewhere"}]
WI_STEPS = [{"code": "WI-01", "step_no": 1, "title": "Prepare"}]


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    old1: dict  # 옛 문서 OLD-1의 원문 대조 데이터
    old2: dict


def _upload_view(client: TestClient, bundle_id: int, body: str, name: str) -> dict:
    response = upload(client, bundle_id, build_docx(body), name)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return get_view(client, bundle_id, response.json()["id"])


def _setup(client: TestClient) -> Fixture:
    """To-Be(SOP 하나 — scope N/A, 그 아래 WI 하나)와 한/영 연달아 옛 문서 둘 — 저마다 같은 제목 짝과 문장 짝."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS, na_slots=NA_SLOTS, wi_steps=WI_STEPS)
    assert response.status_code == 200, response.text
    codes = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    heads = p(KO_HEAD, "Heading1") + p(EN_HEAD, "Heading1")
    old1 = _upload_view(client, bundle_id, heads + p(OLD1_KO) + p(OLD1_EN), "SYNTHETIC_OLD-1_SlotHeading.docx")
    old2 = _upload_view(client, bundle_id, heads + p(OLD2_KO) + p(OLD2_EN), "SYNTHETIC_OLD-2_SlotHeading.docx")
    for view in (old1, old2):
        ko, en = find_unit(view, KO_HEAD), find_unit(view, EN_HEAD)
        assert (ko["kind"], en["kind"]) == ("heading", "heading")
        assert ko["pair_id"] is not None and ko["pair_id"] == en["pair_id"]  # 제목 짝이 생기는 픽스처여야 한다
    return Fixture(bundle_id, codes["SOP-NEW"], codes["WI-01"], old1, old2)


def _heading(key: str, doc_id: int, unit: dict, **fields: object) -> dict:
    """화면이 보내는 칸 제목 새 문장 — 글·언어·변경 종류 없이 칸과 출처만(제품 명세 §7.13 칸 제목, 서버가 칸 이름을 채운다)."""
    return {
        "key": key, "kind": "slot_heading", "target_doc_id": doc_id, "slot_key": SLOT, "source_unit_ids": [unit["id"]],
        **fields,
    }


def _link_headings(client: TestClient, fx: Fixture, view: dict) -> dict:
    """옛 문서 하나의 제목 짝을 한글·영어 칸 제목에 각자 이어 확정한다."""
    ko, en = find_unit(view, KO_HEAD), find_unit(view, EN_HEAD)
    body = _body([_unit_in(ko), _unit_in(en)], [_heading("ko", fx.sop_id, ko), _heading("en", fx.sop_id, en)])
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()


def _load_slot_headings(target_doc_id: int) -> dict[tuple[str, str], dict]:
    """(칸 키, 언어) → 칸 제목 새 문장과 출처(seq 순). 같은 칸·언어에 둘이면 실패한다 — 칸·언어마다 하나다."""

    async def _load(session: AsyncSession) -> dict[tuple[str, str], dict]:
        rows = (
            await session.scalars(
                select(TargetSentence).where(
                    TargetSentence.target_doc_id == target_doc_id, TargetSentence.kind == "slot_heading"
                )
            )
        ).all()
        links = (
            await session.execute(
                select(TargetSource.target_id, TargetSource.unit_id)
                .where(TargetSource.target_id.in_([row.id for row in rows]))
                .order_by(TargetSource.seq)
            )
        ).all()
        found = {
            (row.slot_key, row.lang): {
                "id": row.id, "text": row.confirmed_text, "change_type": row.change_type, "status": row.status,
                "hold_reason": row.hold_reason, "revision": row.revision,
                "sources": [unit_id for target_id, unit_id in links if target_id == row.id],
            }
            for row in rows
        }
        assert len(found) == len(rows), rows
        return found

    return run_in_session(_load)


def _list_unit_rows(client: TestClient, bundle_id: int) -> dict[int, dict]:
    response = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return {row["unit_id"]: row for row in response.json()["items"]}


def _clear(client: TestClient, bundle_id: int, unit: dict) -> None:
    revision = _list_unit_rows(client, bundle_id)[unit["id"]]["decision"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/decisions/clear", json={"unit_id": unit["id"], "revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _shared_setup(client: TestClient) -> Fixture:
    """두 옛 문서의 같은 제목 짝이 한 쌍의 칸 제목(한글·영어)을 함께 쓰는 묶음."""
    fx = _setup(client)
    for view in (fx.old1, fx.old2):
        _link_headings(client, fx, view)
    return fx


# ── 저장 ──────────────────────────────────────────────────────────────────────


def test_heading_pair_goes_to_ko_and_en_slot_headings(client: TestClient) -> None:
    fx = _setup(client)
    before = get_bundle(client, fx.bundle_id)["progress"]["confirmed"]

    group = _link_headings(client, fx, fx.old1)

    targets = sorted(group["targets"], key=lambda target: target["lang"])
    assert [
        (target["kind"], target["lang"], target["slot_key"], target["confirmed_text"], target["change_type"], target["status"])
        for target in targets
    ] == [
        ("slot_heading", "en", SLOT, LABEL, "heading", "confirmed"),
        ("slot_heading", "ko", SLOT, LABEL, "heading", "confirmed"),
    ]
    # 제목 짝은 한 줄 — 배정된 판단 단위로 센다(제품 명세 §7.13 칸 제목)
    assert get_bundle(client, fx.bundle_id)["progress"]["confirmed"] == before + 1
    pair_id = find_unit(fx.old1, KO_HEAD)["pair_id"]
    assert group["pairs_confirmed"] == [pair_id]  # 한글·영어 칸 제목은 같은 새 문서 — 짝은 한 곳으로 간다


def test_same_heading_from_another_doc_adds_a_source(client: TestClient) -> None:
    fx = _setup(client)
    _link_headings(client, fx, fx.old1)
    first = _load_slot_headings(fx.sop_id)

    group = _link_headings(client, fx, fx.old2)

    after = _load_slot_headings(fx.sop_id)
    assert {key: row["id"] for key, row in after.items()} == {key: row["id"] for key, row in first.items()}
    for lang, head in (("ko", KO_HEAD), ("en", EN_HEAD)):
        row, was = after[(SLOT, lang)], first[(SLOT, lang)]
        assert row["sources"] == [find_unit(fx.old1, head)["id"], find_unit(fx.old2, head)["id"]]
        # 출처가 둘이어도 합침이 아니라 칸 제목이고, 기존 행의 글·상태는 그대로다
        assert (row["change_type"], row["text"], row["status"], row["revision"]) == (
            "heading", was["text"], was["status"], was["revision"],
        )
    # 묶음은 OLD-2 제목과 그 칸 제목뿐이다 — 칸 제목은 다른 문서의 같은 제목을 같은 묶음으로 잇지 않는다
    old2_ids = {find_unit(fx.old2, KO_HEAD)["id"], find_unit(fx.old2, EN_HEAD)["id"]}
    assert {unit["unit_id"] for unit in group["units"]} == old2_ids
    assert {target["id"] for target in group["targets"]} == {row["id"] for row in after.values()}
    assert all(set(target["source_unit_ids"]) <= old2_ids and target["group_id"] is None for target in group["targets"])


def test_slot_heading_rejected_for_na_slot_and_wi(client: TestClient) -> None:
    fx = _setup(client)
    ko = find_unit(fx.old1, KO_HEAD)

    na = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_heading("h", fx.sop_id, ko, slot_key="scope")]))
    wi_target = _heading("h", fx.wi_id, ko, slot_key=None, wi_step=1, wi_part="instruction")
    wi = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [wi_target]))

    assert _reason(na) == "na_slot"
    assert _reason(wi) == "slot_heading_not_allowed"


def test_slot_heading_takes_old_headings_of_one_language(client: TestClient) -> None:
    fx = _setup(client)
    ko, en = find_unit(fx.old1, KO_HEAD), find_unit(fx.old1, EN_HEAD)
    target = {**_heading("h", fx.sop_id, ko), "source_unit_ids": [ko["id"], en["id"]]}

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], [target]))

    assert _reason(response) == "slot_heading_mixed_langs"


def test_slot_heading_text_cannot_be_edited(client: TestClient) -> None:
    fx = _setup(client)
    ko = find_unit(fx.old1, KO_HEAD)

    locked = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_heading("h", fx.sop_id, ko, text="Other")]))
    same = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [_heading("h", fx.sop_id, ko, text=LABEL)]))

    assert _reason(locked) == "slot_heading_text_locked"
    assert same.status_code == 200, same.text  # 칸 이름 그대로 보내는 것은 고친 것이 아니다


# ── 결과물 ────────────────────────────────────────────────────────────────────


def test_slot_heading_is_not_numbered_and_shows_in_a_and_c(client: TestClient) -> None:
    fx = _shared_setup(client)
    assign_as_is(client, fx.bundle_id, find_unit(fx.old1, OLD1_KO), fx.sop_id, slot_key=SLOT)

    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    rows = _get_output(client, fx.bundle_id, "outputs/a")

    sections = {section["location_key"]: section for section in sop["sections"]}
    # 칸 제목은 칸 항목이 아니고 줄로 세지 않는다 — 칸의 첫 문장이 6.1.1
    assert [(item["text"], item["number"]) for item in sections[SLOT]["items"]] == [(OLD1_KO, "6.1.1")]
    assert sections[SLOT]["heading_note"] == "← OLD-1 §5, OLD-2 §5"
    assert {section["heading_note"] for key, section in sections.items() if key != SLOT} == {""}
    for view in (fx.old1, fx.old2):
        for head in (KO_HEAD, EN_HEAD):
            (row,) = [row for row in rows if row["unit_id"] == find_unit(view, head)["id"]]
            assert (row["dest_kind"], row["dest_location"], row["dest_number"], row["confirmed_text"], row["change_type"]) == (
                "sop", LABEL, "6.1", LABEL, "heading",
            )
            assert row["group_id"] is None  # 같은 칸 제목을 쓴다고 합침 묶음이 되지 않는다
    export = client.get(f"/api/bundles/{fx.bundle_id}/export.xlsx", params={"lang": "en"}, headers=AUTHOR)
    assert export.status_code == 200, export.text
    workbook = load_workbook(BytesIO(export.content))
    cells = {cell for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True) for cell in row}
    assert "Slot heading" in cells  # Excel A의 Change 칸은 변경 종류 heading의 표시 이름이다


def test_shared_slot_heading_remark_stays_out_of_old_groups(client: TestClient) -> None:
    """두 옛 문서가 함께 쓰는 칸 제목의 remark가 다른 옛 문서의 묶음 Remark로 새지 않는다."""
    fx = _setup(client)
    ko, en = find_unit(fx.old1, KO_HEAD), find_unit(fx.old1, EN_HEAD)
    body = _body(
        [_unit_in(ko), _unit_in(en)],
        [_heading("ko", fx.sop_id, ko, remark="Synthetic heading remark"), _heading("en", fx.sop_id, en)],
    )
    assert save_group(client, fx.bundle_id, body).status_code == 200
    _link_headings(client, fx, fx.old2)

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    for view in (fx.old1, fx.old2):
        for head in (KO_HEAD, EN_HEAD):
            (row,) = [row for row in rows if row["unit_id"] == find_unit(view, head)["id"]]
            assert "Synthetic heading remark" not in row["remark"]


def test_composed_doc_shows_slot_headings_on_the_section(client: TestClient) -> None:
    """Assign New 칸의 엮은 문서도 결과물 C처럼 칸 제목 출처를 칸 머리에 싣고 칸 항목·번호로 세지 않는다."""
    fx = _shared_setup(client)
    assign_as_is(client, fx.bundle_id, find_unit(fx.old1, OLD1_KO), fx.sop_id, slot_key=SLOT)

    doc = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}")

    sections = {section["location_key"]: section for section in doc["sections"]}
    assert sections[SLOT]["heading_note"] == "← OLD-1 §5, OLD-2 §5"
    assert [(item["text"], item["number"]) for item in sections[SLOT]["items"]] == [(OLD1_KO, "6.1.1")]  # 칸 제목은 항목이 아니다
    assert {section["heading_note"] for key, section in sections.items() if key != SLOT} == {""}


def test_reorder_ignores_slot_headings(client: TestClient) -> None:
    fx = _setup(client)
    _link_headings(client, fx, fx.old1)
    for text in (OLD1_KO, OLD1_EN):
        assign_as_is(client, fx.bundle_id, find_unit(fx.old1, text), fx.sop_id, slot_key=SLOT)
    items = [{"target_id": target_id} for target_id in reversed(_list_top_target_ids(client, fx.bundle_id, 0))]
    assert len(items) == 2  # 칸 제목은 C 항목이 아니다

    response = _put_order(client, fx.bundle_id, {
        "revision": get_bundle(client, fx.bundle_id)["revision"], "target_doc_id": fx.sop_id, "items": items,
    })
    heading_id = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]["id"]
    with_heading = _put_order(client, fx.bundle_id, {
        "revision": get_bundle(client, fx.bundle_id)["revision"], "target_doc_id": fx.sop_id,
        "items": [*items, {"target_id": heading_id}],
    })

    assert response.status_code == 200, response.text
    assert with_heading.status_code == 422, with_heading.text
    assert with_heading.json()["detail"]["unknown_target_ids"] == [heading_id]


# ── 함께 쓰는 칸 제목에서 떼어 내기 ────────────────────────────────────────────


def test_detaching_one_source_of_a_slot_heading_keeps_it(client: TestClient) -> None:
    """Review Focus 4 — 한 문서의 제목을 미배정으로 돌려도 칸 제목은 남은 출처로 그대로, 마지막 출처가 떠나면 없어진다."""
    fx = _shared_setup(client)
    before = _load_slot_headings(fx.sop_id)
    ko1, ko2 = find_unit(fx.old1, KO_HEAD), find_unit(fx.old2, KO_HEAD)

    _clear(client, fx.bundle_id, ko1)

    after = _load_slot_headings(fx.sop_id)
    ko, was = after[(SLOT, "ko")], before[(SLOT, "ko")]
    assert ko["sources"] == [ko2["id"]]
    assert (ko["id"], ko["status"], ko["hold_reason"], ko["revision"]) == (was["id"], was["status"], "", was["revision"])
    assert after[(SLOT, "en")] == before[(SLOT, "en")]
    assert _list_unit_rows(client, fx.bundle_id)[ko2["id"]]["status"] == "confirmed"  # 남은 출처는 보류가 되지 않는다

    _clear(client, fx.bundle_id, ko2)

    assert set(_load_slot_headings(fx.sop_id)) == {(SLOT, "en")}


def test_resaving_one_doc_keeps_the_other_docs_source(client: TestClient) -> None:
    """화면은 묶음의 칸 제목을 id와 함께 다시 보낸다 — 묶음에는 이 문서의 제목만 들고, 다른 문서의 출처는 그대로 남는다."""
    fx = _shared_setup(client)
    ko1, ko2 = find_unit(fx.old1, KO_HEAD), find_unit(fx.old2, KO_HEAD)
    group = get_group_by_unit(client, fx.bundle_id, ko1["id"])
    assert [unit["unit_id"] for unit in group["units"]] == [ko1["id"]]
    (row,) = group["targets"]
    assert (row["kind"], row["source_unit_ids"], row["group_id"]) == ("slot_heading", [ko1["id"]], None)
    body = _body(
        [_unit_in(ko1, revision=group["units"][0]["decision"]["revision"])],
        [_heading("h", fx.sop_id, ko1, id=row["id"], revision=row["revision"])],
        action="hold", hold_reason="Synthetic: check the heading",
    )

    response = save_group(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    ko = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    assert (ko["id"], ko["sources"], ko["status"]) == (row["id"], [ko1["id"], ko2["id"]], "on_hold")


def test_deleting_one_doc_heading_leaves_the_shared_slot_heading(client: TestClient) -> None:
    fx = _shared_setup(client)
    ko1, ko2 = find_unit(fx.old1, KO_HEAD), find_unit(fx.old2, KO_HEAD)
    group = get_group_by_unit(client, fx.bundle_id, ko1["id"])
    (row,) = group["targets"]
    unit = _unit_in(ko1, revision=group["units"][0]["decision"]["revision"], disposition="delete", reason="Synthetic: x")

    response = save_group(client, fx.bundle_id, _body([unit], [], removed_target_ids=[row["id"]]))

    assert response.status_code == 200, response.text
    ko = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    assert (ko["id"], ko["sources"], ko["status"], ko["revision"]) == (row["id"], [ko2["id"]], "confirmed", row["revision"])


# ── 함께 쓰는 칸 제목의 상태 — 출처 판단 중 가장 덜 끝난 것 ──────────────────────


def _readiness(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/review/readiness", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _resave_heading(client: TestClient, fx: Fixture, unit: dict, action: str, hold_reason: str = "") -> None:
    """그 단위의 묶음에 든 칸 제목을 id와 함께 다시 보내 확정하거나 보류한다 — 화면의 다시 저장과 같은 모양."""
    group = get_group_by_unit(client, fx.bundle_id, unit["id"])
    (row,) = group["targets"]
    body = _body(
        [_unit_in(unit, revision=group["units"][0]["decision"]["revision"])],
        [_heading("h", fx.sop_id, unit, id=row["id"], revision=row["revision"])],
        action=action, hold_reason=hold_reason,
    )
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text


def test_attaching_with_hold_holds_the_shared_slot_heading(client: TestClient) -> None:
    fx = _setup(client)
    _link_headings(client, fx, fx.old1)
    ko2, en2 = find_unit(fx.old2, KO_HEAD), find_unit(fx.old2, EN_HEAD)
    body = _body(
        [_unit_in(ko2), _unit_in(en2)], [_heading("ko", fx.sop_id, ko2), _heading("en", fx.sop_id, en2)],
        action="hold", hold_reason="Synthetic: B holds",
    )

    response = save_group(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    ko = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    assert (ko["status"], ko["hold_reason"]) == ("on_hold", "Synthetic: B holds")


def test_shared_slot_heading_follows_the_least_finished_source(client: TestClient) -> None:
    fx = _shared_setup(client)
    ko1, ko2 = find_unit(fx.old1, KO_HEAD), find_unit(fx.old2, KO_HEAD)

    _resave_heading(client, fx, ko1, "hold", "Synthetic: A holds")
    held = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    _resave_heading(client, fx, ko2, "confirm")  # 다른 문서가 다시 확정해도 A의 보류는 그대로다
    still = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    _resave_heading(client, fx, ko1, "confirm")
    confirmed = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]

    assert (held["status"], held["hold_reason"]) == ("on_hold", "Synthetic: A holds")
    assert (still["status"], still["hold_reason"]) == ("on_hold", "Synthetic: A holds")
    assert (confirmed["status"], confirmed["hold_reason"]) == ("confirmed", "")


def test_removing_the_holding_doc_confirms_the_shared_slot_heading(client: TestClient) -> None:
    fx = _shared_setup(client)
    ko1 = find_unit(fx.old1, KO_HEAD)
    _resave_heading(client, fx, ko1, "hold", "Synthetic: A holds")
    group = get_group_by_unit(client, fx.bundle_id, ko1["id"])
    (row,) = group["targets"]
    unit = _unit_in(ko1, revision=group["units"][0]["decision"]["revision"], disposition="delete", reason="Synthetic: x")

    response = save_group(client, fx.bundle_id, _body([unit], [], removed_target_ids=[row["id"]]))

    assert response.status_code == 200, response.text
    ko = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    assert (ko["status"], ko["hold_reason"]) == ("confirmed", "")
    # 어느 줄에도 보이지 않는 보류가 검토 요청을 막지 않는다
    assert all(not blocker["code"].startswith("targets_") for blocker in _readiness(client, fx.bundle_id)["blockers"])


def test_clearing_the_holding_doc_confirms_the_shared_slot_heading(client: TestClient) -> None:
    fx = _shared_setup(client)
    ko1 = find_unit(fx.old1, KO_HEAD)
    _resave_heading(client, fx, ko1, "hold", "Synthetic: A holds")

    _clear(client, fx.bundle_id, ko1)

    ko = _load_slot_headings(fx.sop_id)[(SLOT, "ko")]
    assert (ko["status"], ko["hold_reason"]) == ("confirmed", "")


def test_a_slot_with_only_a_slot_heading_is_still_an_empty_equipment_slot(client: TestClient) -> None:
    """장비 SOP의 빈 Procedures 하위 칸 알림 — 칸 제목은 칸 항목이 아니라 칸을 채우지 않는다(제품 명세 §7.13 칸 제목)."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    equipment = [{**TOBE_DOCS[0], "is_equipment_sop": True}]
    response = put_tobe(client, bundle_id, equipment)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    old1 = _upload_view(client, bundle_id, p(KO_HEAD, "Heading1") + p(OLD1_KO), "SYNTHETIC_OLD-1_SlotHeading.docx")
    ko = find_unit(old1, KO_HEAD)
    heading = _heading("h", sop_id, ko, slot_key="procedures.maintenance")
    assert save_group(client, bundle_id, _body([_unit_in(ko)], [heading])).status_code == 200

    notices = [notice for notice in _readiness(client, bundle_id)["notices"] if notice["code"] == "equipment_sop_empty_slots"]

    assert [notice["slot_keys"] for notice in notices] == [
        ["procedures.electronic_record_control", "procedures.troubleshooting", "procedures.maintenance"],
    ]


def test_moving_to_another_slot_heading_leaves_the_shared_one(client: TestClient) -> None:
    """함께 쓰는 칸 제목을 id와 함께 다른 칸으로 보내도 그 행을 옮기지 않는다 — 이 문서 출처만 떼어 새 칸의 칸 제목에 잇는다."""
    fx = _shared_setup(client)
    ko1, ko2 = find_unit(fx.old1, KO_HEAD), find_unit(fx.old2, KO_HEAD)
    group = get_group_by_unit(client, fx.bundle_id, ko1["id"])
    (row,) = group["targets"]
    moved = _heading("h", fx.sop_id, ko1, slot_key="purpose", id=row["id"], revision=row["revision"])

    response = save_group(
        client, fx.bundle_id, _body([_unit_in(ko1, revision=group["units"][0]["decision"]["revision"])], [moved])
    )

    assert response.status_code == 200, response.text
    heads = _load_slot_headings(fx.sop_id)
    assert (heads[(SLOT, "ko")]["id"], heads[(SLOT, "ko")]["sources"]) == (row["id"], [ko2["id"]])
    assert (heads[("purpose", "ko")]["sources"], heads[("purpose", "ko")]["text"]) == ([ko1["id"]], "Purpose")


# ── 되돌리기 — Assign 되돌리기가 칸 제목 저장도 거꾸로 한다 ──────────────────────


def _link_headings_recorded(client: TestClient, fx: Fixture, view: dict) -> None:
    """_link_headings와 같은 저장을 되돌리기 기록(세션 s1)에 남기며 한다."""
    ko, en = find_unit(view, KO_HEAD), find_unit(view, EN_HEAD)
    body = _body([_unit_in(ko), _unit_in(en)], [_heading("ko", fx.sop_id, ko), _heading("en", fx.sop_id, en)])
    response = save_group(client, fx.bundle_id, {**body, "undo": {"session": "s1"}})
    assert response.status_code == 200, response.text


def _read_heads(target_doc_id: int) -> dict[tuple[str, str], tuple[int, list[int], str]]:
    """되돌리기 왕복에서 비교하는 칸 제목 모양 — revision은 되쓰기마다 오르니 뺀다."""
    return {key: (row["id"], row["sources"], row["status"]) for key, row in _load_slot_headings(target_doc_id).items()}


def test_undo_and_redo_a_slot_heading_save(client: TestClient) -> None:
    fx = _setup(client)
    _link_headings_recorded(client, fx, fx.old1)
    linked = _read_heads(fx.sop_id)

    _ok(_undo(client, fx.bundle_id))

    assert _read_heads(fx.sop_id) == {}
    rows = _list_unit_rows(client, fx.bundle_id)
    assert {rows[find_unit(fx.old1, head)["id"]]["status"] for head in (KO_HEAD, EN_HEAD)} == {"unassigned"}

    _ok(_redo(client, fx.bundle_id))

    assert _read_heads(fx.sop_id) == linked  # 같은 id로 되살아난다


def test_undo_of_a_second_doc_leaves_the_shared_slot_heading_to_the_first(client: TestClient) -> None:
    fx = _setup(client)
    _link_headings(client, fx, fx.old1)
    first = _read_heads(fx.sop_id)
    _link_headings_recorded(client, fx, fx.old2)

    _ok(_undo(client, fx.bundle_id))

    assert _read_heads(fx.sop_id) == first  # 칸 제목은 남고 OLD-2 출처만 빠진다


def test_undo_refuses_to_drop_a_slot_heading_another_doc_now_uses(client: TestClient) -> None:
    """내 단계가 만든 칸 제목에 그 뒤 다른 문서가 출처로 붙었으면 지우지 않는다 — 지우면 그 문서의 잇기까지 사라진다."""
    fx = _setup(client)
    _link_headings_recorded(client, fx, fx.old1)
    _link_headings(client, fx, fx.old2)  # 기록 없는 저장 — 다른 사람·다른 창
    before = _read_heads(fx.sop_id)

    response = _undo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "undo_conflict"
    assert _read_heads(fx.sop_id) == before
