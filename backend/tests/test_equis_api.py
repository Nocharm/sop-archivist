"""EQUIS 조회 API 테스트 — 문서·To-Be 응답의 표시, 제목 따라가기와 잠금, 다시 조회(설계 §8·§10).

웹훅은 `service.fetch_rows` 바꿔치기로 흉내 낸다. 조회는 응답 뒤에 도는데, TestClient는 그 일이 끝난 뒤 돌아온다.
번호·이름은 모두 합성이다.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.equis import service as equis_service
from app.equis.client import EquisUnavailable
from app.equis.rules import EquisRow, parse_row
from app.settings import settings
from app.sop.models import Bundle, BundleEvent, EquisLookup
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, put_tobe, set_members, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

NUMBER = "SOP-ABC-00001"
NAME = "Operation and Maintenance of UV spectrophotometer"
FILE_NAME = "SOP-ABC-00001_v14_UV operation.docx"


def make_row(
    number: str = NUMBER, version: str = "14.0", status: str = "Effective", *, doc_id: str = "900001",
    name: str = NAME, legacy: str = "", **extra: object,
) -> EquisRow:
    row = parse_row({
        "DOC_DOCUMENT_NUMBER": number, "DOC_DOCUMENT_ID": doc_id, "DOC_VERSION": version,
        "DOC_DOCUMENT_STATUS": status, "DOC_LIFECYCLE": "Draft to Effective Lifecycle",
        "DOC_DOCUMENT_NAME": name, "DOC_LEGACY_DOCUMENT_ID": legacy, **extra,
    })
    assert row is not None
    return row


class FakeEquis:
    """가짜 웹훅 — 번호가 같은 줄과 Legacy에 번호가 든 줄을 돌려주고, 물은 번호를 적어 둔다."""

    def __init__(self) -> None:
        self.rows: list[EquisRow] = []
        self.error: Exception | None = None
        self.asked: list[str] = []

    async def fetch_rows(self, number: str) -> list[EquisRow]:
        self.asked.append(number)
        if self.error is not None:
            raise self.error
        return [row for row in self.rows if row.number == number or number in row.legacy_numbers]


@pytest.fixture
def equis(monkeypatch: pytest.MonkeyPatch) -> FakeEquis:
    fake = FakeEquis()
    monkeypatch.setattr(settings, "n8n_query_url", "http://n8n.test/webhook/dbv-query")
    monkeypatch.setattr(settings, "equis_edw_table", "edw.EQUIS_DOCUMENT")
    monkeypatch.setattr(settings, "equis_doc_url_base", "https://equis.test/")
    monkeypatch.setattr(equis_service, "fetch_rows", fake.fetch_rows)
    return fake


def upload_old(client: TestClient, bundle_id: int, file_name: str = FILE_NAME, text: str = "본문 한 문장입니다.") -> dict:
    response = upload(client, bundle_id, build_docx(p(text)), file_name)
    assert response.status_code == 201, response.text
    return response.json()


def list_documents(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/documents", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def patch_document(client: TestClient, bundle_id: int, doc: dict, **fields: str):
    return client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}", json={"revision": doc["revision"], **fields}, headers=AUTHOR
    )


def refresh(client: TestClient, bundle_id: int, number: str, headers: dict[str, str] = AUTHOR):
    return client.post(f"/api/bundles/{bundle_id}/equis/refresh", json={"document_number": number}, headers=headers)


def age_lookup(number: str, delta: timedelta) -> None:
    async def work(session: AsyncSession) -> None:
        lookup = await session.get_one(EquisLookup, number)
        lookup.requested_at = clock.now() - delta
        lookup.fetched_at = clock.now() - delta
        await session.commit()

    run_in_session(work)


def set_bundle_status(bundle_id: int, status: str) -> None:
    async def work(session: AsyncSession) -> None:
        bundle = await session.get_one(Bundle, bundle_id)
        bundle.status = status
        await session.commit()

    run_in_session(work)


# --- 꺼진 서버 ---


def test_disabled_feature_leaves_responses_untouched(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = upload_old(client, bundle["id"])

    assert doc["equis"] is None and doc["doc_code"] == NUMBER
    assert list_documents(client, bundle["id"])[0]["equis"] is None
    assert run_in_session(lambda session: session.get(EquisLookup, NUMBER)) is None
    assert patch_document(client, bundle["id"], doc, title="Any title").status_code == 200


# --- 문서 ---


def test_upload_looks_up_after_the_response_and_follows_the_name(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row(version="13.0", status="Superseded"), make_row()]
    bundle = create_bundle(client)

    uploaded = upload_old(client, bundle["id"])

    # 업로드 응답은 조회를 기다리지 않는다
    assert uploaded["equis"]["state"] == "pending" and uploaded["equis"]["refreshing"] is True
    doc = list_documents(client, bundle["id"])[0]
    assert doc["title"] == NAME
    shown = doc["equis"]
    assert (shown["state"], shown["verdict"], shown["reasons"], shown["refreshing"]) == ("found", "ok", [], False)
    assert shown["current"] == {"version": "14.0", "status": "Effective", "effective_date": "", "retired_date": ""}
    assert shown["doc_url"] == "https://equis.test/ui/#doc_info/900001"
    assert shown["title_locked"] is True and shown["name"] == NAME


def test_title_change_is_recorded_as_a_system_event(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)

    upload_old(client, bundle["id"])

    events = run_in_session(lambda session: session.scalars(
        select(BundleEvent).where(BundleEvent.bundle_id == bundle["id"], BundleEvent.actor == equis_service.SYSTEM_ACTOR)
    ))
    assert [event.action for event in events] == ["document.update"]


def test_webhook_failure_never_blocks_the_upload(client: TestClient, equis: FakeEquis) -> None:
    equis.error = EquisUnavailable("EQUIS lookup failed: ReadTimeout")
    bundle = create_bundle(client)

    uploaded = upload_old(client, bundle["id"])

    doc = list_documents(client, bundle["id"])[0]
    assert uploaded["status"] == "ready"
    assert doc["equis"]["state"] == "unavailable" and doc["equis"]["title_locked"] is False
    assert patch_document(client, bundle["id"], doc, title="Hand-written title").status_code == 200


def test_unknown_number_is_not_in_equis_and_keeps_the_title_editable(client: TestClient, equis: FakeEquis) -> None:
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])

    doc = list_documents(client, bundle["id"])[0]

    assert doc["equis"]["state"] == "not_found" and doc["equis"]["verdict"] is None
    assert patch_document(client, bundle["id"], doc, title="Hand-written title").status_code == 200


def test_locked_title_cannot_be_edited_until_the_number_leaves_equis(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    doc = list_documents(client, bundle["id"])[0]

    rejected = patch_document(client, bundle["id"], doc, title="My own title")
    moved = patch_document(client, bundle["id"], doc, doc_code="SOP-ABC-09999")

    assert rejected.status_code == 409 and rejected.json()["detail"]["code"] == "title_locked"
    assert moved.status_code == 200
    doc = list_documents(client, bundle["id"])[0]
    assert doc["equis"]["state"] == "not_found" and doc["title"] == NAME  # 마지막 EQUIS 이름이 남고 이제 고칠 수 있다
    assert patch_document(client, bundle["id"], doc, title="My own title").status_code == 200


def test_version_edit_rejudges_without_asking_again(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row(version="13.0", status="Superseded"), make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    doc = list_documents(client, bundle["id"])[0]
    asked_before = len(equis.asked)

    changed = patch_document(client, bundle["id"], doc, doc_version="13.0")

    assert changed.status_code == 200
    assert changed.json()["equis"]["reasons"] == ["version_mismatch"]
    assert len(equis.asked) == asked_before


def test_same_number_in_two_bundles_is_asked_once(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    first = create_bundle(client, title="First")
    second = create_bundle(client, title="Second")
    upload_old(client, first["id"])
    asked_before = len(equis.asked)

    uploaded = upload_old(client, second["id"], text="다른 본문 문장입니다.")

    assert len(equis.asked) == asked_before
    assert uploaded["title"] == NAME and uploaded["equis"]["state"] == "found"  # 받아 둔 이름을 바로 쓴다


def test_old_number_points_at_the_current_document(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row(legacy="SOP-ABC-1016")]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"], file_name="SOP-ABC-1016_v14_UV operation.docx")

    shown = list_documents(client, bundle["id"])[0]["equis"]

    assert shown["verdict"] == "attention" and shown["reasons"][0] == "old_number"
    assert shown["number"] == NUMBER and shown["trail"] == ["SOP-ABC-1016", NUMBER]


def test_stale_result_is_refreshed_when_the_list_is_read(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    equis.rows = [make_row(name="Renamed in EQUIS")]
    age_lookup(NUMBER, timedelta(hours=25))

    stale = list_documents(client, bundle["id"])[0]
    fresh = list_documents(client, bundle["id"])[0]

    assert stale["title"] == NAME and stale["equis"]["refreshing"] is True  # 있던 값을 먼저 보여 준다
    assert fresh["title"] == "Renamed in EQUIS" and fresh["equis"]["refreshing"] is False


def test_title_of_a_bundle_in_review_is_left_alone(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    equis.rows = [make_row(name="Renamed in EQUIS")]
    set_bundle_status(bundle["id"], "in_review")
    age_lookup(NUMBER, timedelta(hours=25))

    list_documents(client, bundle["id"])
    doc = list_documents(client, bundle["id"])[0]

    assert doc["equis"]["name"] == "Renamed in EQUIS" and doc["title"] == NAME


# --- To-Be ---


def test_tobe_rows_show_equis_and_follow_the_name(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [
        make_row(),
        make_row("SOP-ABC-00052", "3.0", "Obsolete", doc_id="900052", name="Operation of Vacuum System",
                 DOC_OBSOLETE_DATE_KST="2018-11-21T00:00:00.000Z"),
    ]
    bundle = create_bundle(client)
    docs = [
        {"code": NUMBER, "title": "My draft title", "doc_type": "sop", "parent_code": None, "is_equipment_sop": False, "order_index": 0},
        {"code": "SOP-ABC-00052", "title": "", "doc_type": "sop", "parent_code": None, "is_equipment_sop": False, "order_index": 1},
        {"code": "WI-NEW-01", "title": "Brand new", "doc_type": "wi", "parent_code": NUMBER, "is_equipment_sop": False, "order_index": 2},
    ]

    assert put_tobe(client, bundle["id"], docs).status_code == 200
    rows = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()["docs"]

    by_code = {row["code"]: row for row in rows}
    assert by_code[NUMBER]["title"] == NAME and by_code[NUMBER]["equis"]["verdict"] == "in_equis"
    assert by_code["SOP-ABC-00052"]["equis"]["reasons"] == ["retired"]
    assert by_code["WI-NEW-01"]["equis"]["state"] == "not_found" and by_code["WI-NEW-01"]["title"] == "Brand new"


def test_tobe_save_with_a_stale_title_is_accepted_and_reset(client: TestClient, equis: FakeEquis) -> None:
    # 화면 초안에 옛 제목이 남아 있어도 저장을 거절하지 않는다 — EQUIS 이름으로 돌아갈 뿐이다
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    doc = {"code": NUMBER, "title": "First title", "doc_type": "sop", "parent_code": None, "is_equipment_sop": False, "order_index": 0}
    put_tobe(client, bundle["id"], [doc])

    saved = put_tobe(client, bundle["id"], [{**doc, "title": "Typed over the lock"}])

    assert saved.status_code == 200
    assert saved.json()["docs"][0]["title"] == NAME and saved.json()["docs"][0]["equis"]["title_locked"] is True


# --- 다시 조회 ---


def test_refresh_only_takes_numbers_of_this_bundle(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    other = create_bundle(client, title="Other")
    upload_old(client, bundle["id"])

    foreign = refresh(client, other["id"], NUMBER)
    unknown = refresh(client, bundle["id"], "SOP-ABC-07777")

    assert foreign.status_code == 404 and foreign.json()["detail"]["code"] == "equis_number_not_in_bundle"
    assert unknown.status_code == 404


def test_refresh_is_debounced_then_asks_again(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    asked_before = len(equis.asked)

    right_away = refresh(client, bundle["id"], NUMBER)
    age_lookup(NUMBER, timedelta(seconds=equis_service.REFRESH_DEBOUNCE_SECONDS + 1))
    later = refresh(client, bundle["id"], " sop-abc-00001 ")

    assert right_away.json() == {"requested": False}
    assert later.json() == {"requested": True} and len(equis.asked) == asked_before + 1


def test_refresh_is_for_authors_of_an_editable_bundle(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row()]
    bundle = create_bundle(client)
    upload_old(client, bundle["id"])
    assert set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    by_reviewer = refresh(client, bundle["id"], NUMBER, headers=REVIEWER)
    set_bundle_status(bundle["id"], "in_review")
    while_in_review = refresh(client, bundle["id"], NUMBER)

    assert by_reviewer.status_code == 403 and by_reviewer.json()["detail"]["code"] == "role_required"
    assert while_in_review.status_code == 409 and while_in_review.json()["detail"]["code"] == "bundle_not_editable"


# --- Excel 문서 목록 시트 ---


def _read_documents_sheet(client: TestClient, bundle_id: int) -> list[list[str]]:
    response = client.get(f"/api/bundles/{bundle_id}/export/preview", headers=AUTHOR)
    assert response.status_code == 200, response.text
    sheet = next(sheet for sheet in response.json()["sheets"] if sheet["name"] == "Documents")
    return [[cell["text"] for cell in row["cells"]] for row in sheet["rows"]]


def test_excel_lists_documents_with_their_equis_values(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [
        make_row(
            version="14.0", status="Effective", DOC_OWNING_DEPARTMENT="Purification",
            DOC_EFFECTIVE_DATE_KST="2025-09-17T00:00:00.000Z",
        )
    ]
    bundle = create_bundle(client, is_synthetic=True)
    assert put_tobe(client, bundle["id"], [{"code": "SOP-NEW-1", "title": "Synthetic", "doc_type": "sop", "parent_code": None}]).status_code == 200
    upload_old(client, bundle["id"])

    status, header, old, new = _read_documents_sheet(client, bundle["id"])

    assert status[0] == "Status: In progress"
    assert header == [
        "Side", "Doc no.", "Title", "Uploaded ver.", "EQUIS", "Current no.", "Current ver.", "Effective date",
        "Owning dept.", "EQUIS link",
    ]
    # 옛 문서 — 올린 판이 지금 판과 같다
    assert old == [
        "Old", NUMBER, NAME, "14", "Current", NUMBER, "14.0 Effective", "2025-09-17", "Purification",
        "https://equis.test/ui/#doc_info/900001",
    ]
    # 새 문서 — EQUIS에 없는 번호
    assert new == ["New", "SOP-NEW-1", "Synthetic", "", "Not in EQUIS", "", "", "", "", ""]


def test_excel_says_what_to_check_for_an_old_number(client: TestClient, equis: FakeEquis) -> None:
    equis.rows = [make_row(legacy="SOP-ABC-1016")]
    bundle = create_bundle(client, is_synthetic=True)
    upload_old(client, bundle["id"], "SOP-ABC-1016_v14_UV operation.docx")

    rows = _read_documents_sheet(client, bundle["id"])

    assert rows[2][:6] == ["Old", "SOP-ABC-1016", NAME, "14", "Check: Old number", NUMBER]


def test_excel_documents_sheet_has_blank_equis_columns_when_the_feature_is_off(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    upload_old(client, bundle["id"])

    rows = _read_documents_sheet(client, bundle["id"])

    # 제목은 파일 이름에서 온 값 그대로다(EQUIS 이름으로 바뀌지 않는다)
    assert rows[2][:4] == ["Old", NUMBER, "UV operation", "14"] and rows[2][4:] == [""] * 6
