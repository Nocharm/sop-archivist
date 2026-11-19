"""새 문서 목록 AI 읽기 — 계획 파일·글에서 뽑은 글로 AI가 목록을 제안하고(목록에는 쓰지 않는다), 글에 없는 번호는 버린다."""

import io
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.tobe_list_job import ProposedDocIn, TobeListReply, judge_reply
from app.sop.ai.tobe_list_text import MAX_LIST_CHARS, MAX_LIST_FILE_BYTES, read_list_file, read_list_text
from app.sop.models import AiJob, AiSuggestion
from tests.access_helpers import run_in_session
from tests.ai_fixtures import clean_ai_jobs, run_jobs  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.docx_factory import build_docx, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, put_tobe

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

PLAN_TEXT = "Synthetic plan\nSOP-QC-0100 | Synthetic centrifuge use\nWI-QC-0101 | Synthetic operation | under SOP-QC-0100\nOLD-9 is replaced"


def _build_xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _doc(code: str, **fields: object) -> ProposedDocIn:
    return ProposedDocIn(code=code, **fields)


# ── 글 뽑기 ──────────────────────────────────────────────────────────────────


def test_reads_spreadsheet_rows_one_per_line() -> None:
    data = _build_xlsx([["No.", "Title", None], ["SOP-QC-0100", "Synthetic use", 3], [None, None, None], ["WI-QC-0101", "Synthetic run"]])

    read = read_list_file("SYNTHETIC plan.XLSX", data)

    assert read.text == "No. | Title\nSOP-QC-0100 | Synthetic use | 3\nWI-QC-0101 | Synthetic run"
    assert read.truncated is False


def test_reads_word_paragraphs_and_table_rows() -> None:
    data = build_docx(p("Synthetic plan for 2027") + tbl([["SOP-QC-0100", "Synthetic use"], ["WI-QC-0101", "Synthetic run"]]))

    read = read_list_file("SYNTHETIC plan.docx", data)

    assert read.text == "Synthetic plan for 2027\nSOP-QC-0100 | Synthetic use\nWI-QC-0101 | Synthetic run"


def test_reads_plain_text_in_utf8_or_cp949() -> None:
    assert read_list_file("plan.txt", "합성 계획\n\nSOP-QC-0100  합성 제목".encode()).text == "합성 계획\nSOP-QC-0100 합성 제목"
    assert read_list_file("plan.csv", "SOP-QC-0100,합성 제목".encode("cp949")).text == "SOP-QC-0100,합성 제목"
    assert read_list_text("  WI-QC-0101\t단계  \n").text == "WI-QC-0101 단계"


def test_long_text_is_cut_at_a_line_and_says_so() -> None:
    line = "SOP-QC-0100 " + "x" * 987
    read = read_list_text("\n".join([line] * 40))

    assert read.truncated is True
    assert len(read.text) <= MAX_LIST_CHARS
    assert set(read.text.split("\n")) == {line}  # 줄 중간에서 자르지 않는다


@pytest.mark.parametrize(
    ("file_name", "data", "code"),
    [
        ("plan.pdf", b"%PDF-1.4", "list_file_format"),
        ("plan.xlsx", b"not a zip", "list_file_unreadable"),
        ("plan.docx", b"not a zip", "list_file_unreadable"),
        ("plan.txt", b"x" * (MAX_LIST_FILE_BYTES + 1), "list_file_too_large"),
        ("plan.txt", b"  \n \n", "list_text_empty"),
    ],
    ids=["format", "bad_xlsx", "bad_docx", "too_large", "empty"],
)
def test_unusable_list_files_are_refused_with_a_reason(file_name: str, data: bytes, code: str) -> None:
    with pytest.raises(HTTPException) as caught:
        read_list_file(file_name, data)

    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == code


# ── 응답 거르기 ──────────────────────────────────────────────────────────────


def test_a_number_the_text_does_not_hold_is_dropped() -> None:
    reply = TobeListReply(docs=[_doc("SOP-QC-0100", doc_type="sop"), _doc("SOP-QC-9999", doc_type="sop"), _doc("wi-qc-0101", doc_type="wi")])

    verdict = judge_reply(reply, PLAN_TEXT, frozenset(), "fake")

    # 글에 있는 번호만 — 대소문자와 공백은 가리지 않고, 적힌 그대로 둔다
    assert [doc.code for doc in verdict.docs] == ["SOP-QC-0100", "wi-qc-0101"]


def test_type_parent_and_steps_are_kept_only_when_they_make_sense() -> None:
    reply = TobeListReply(
        docs=[
            _doc("SOP-QC-0100", title="  Synthetic use ", doc_type="SOP", parent_code="SOP-OLD", is_equipment_sop=True, steps=["no"]),
            _doc("WI-QC-0101", doc_type="wi", parent_code="SOP-QC-0100", is_equipment_sop=True, steps=[" Prepare ", "", "Run"]),
            _doc("OLD-9", doc_type="form", parent_code="SOP-QC-0100"),
            _doc("WI-QC-0101", doc_type="wi"),
        ]
    )
    text = PLAN_TEXT + "\nWI-QC-0102 under SOP-LISTED and SOP-GONE"
    reply.docs.append(_doc("WI-QC-0102", doc_type="wi", parent_code="SOP-LISTED"))
    reply.docs.append(_doc("SOP-GONE", doc_type="wi", parent_code="SOP-NOWHERE"))

    verdict = judge_reply(reply, text, frozenset({"SOP-LISTED"}), "fake")

    assert [doc.model_dump() for doc in verdict.docs] == [
        {"code": "SOP-QC-0100", "title": "Synthetic use", "doc_type": "sop", "parent_code": None, "is_equipment_sop": True, "steps": []},
        {"code": "WI-QC-0101", "title": "", "doc_type": "wi", "parent_code": "SOP-QC-0100", "is_equipment_sop": False, "steps": ["Prepare", "Run"]},
        # 종류를 모르면 비운다 — 사람이 고른다
        {"code": "OLD-9", "title": "", "doc_type": None, "parent_code": None, "is_equipment_sop": False, "steps": []},
        # 상위 SOP는 지금 목록의 SOP여도 된다
        {"code": "WI-QC-0102", "title": "", "doc_type": "wi", "parent_code": "SOP-LISTED", "is_equipment_sop": False, "steps": []},
        {"code": "SOP-GONE", "title": "", "doc_type": "wi", "parent_code": None, "is_equipment_sop": False, "steps": []},
    ]


def test_an_unreadable_reply_is_invalid_with_no_rows() -> None:
    verdict = judge_reply(None, PLAN_TEXT, frozenset(), "fake")

    assert (verdict.invalid, verdict.docs) == (True, ())


# ── 요청 → 제안 → 닫기 ───────────────────────────────────────────────────────


def _load_rows() -> tuple[list[AiJob], list[AiSuggestion]]:
    async def _load(session: AsyncSession) -> tuple[list[AiJob], list[AiSuggestion]]:
        jobs = list(await session.scalars(select(AiJob).where(AiJob.kind == "tobe_list").order_by(AiJob.id)))
        suggestions = list(await session.scalars(select(AiSuggestion).where(AiSuggestion.kind == "tobe_list").order_by(AiSuggestion.id)))
        return jobs, suggestions

    return run_in_session(_load)


def _setup(client: TestClient) -> tuple[int, str]:
    bundle = create_bundle(client, is_synthetic=True)
    listed = put_tobe(client, bundle["id"], [{"code": "SOP-QC-0100", "doc_type": "sop", "title": "Synthetic listed"}])
    assert listed.status_code == 200, listed.text
    return bundle["id"], f"/api/bundles/{bundle['id']}/tobe"


def test_reading_a_list_proposes_rows_without_touching_the_list(client: TestClient, fake_ai: FakeAi) -> None:
    bundle_id, base = _setup(client)
    fake_ai.chat = lambda data: json.dumps(
        {"docs": [
            {"code": "SOP-QC-0100", "title": "Synthetic centrifuge use", "doc_type": "sop"},
            {"code": "WI-QC-0101", "title": "Synthetic operation", "doc_type": "wi", "parent_code": "SOP-QC-0100", "steps": ["Prepare"]},
            {"code": "WI-QC-0777", "doc_type": "wi"},
        ]}
    )
    before = client.get(base, headers=AUTHOR).json()["docs"]

    queued = client.post(f"{base}/read", data={"text": PLAN_TEXT}, headers=AUTHOR)
    waiting = client.get(f"{base}/read", headers=AUTHOR)
    run_jobs()
    proposal = client.get(f"{base}/read", headers=AUTHOR)

    assert queued.status_code == 202, queued.text
    assert (queued.json()["queued"], queued.json()["truncated"]) == (1, False)
    assert waiting.json() is None
    # AI에는 뽑은 글과 지금 목록이 간다
    assert fake_ai.requests[-1] == {"task": "tobe_list", "text": PLAN_TEXT, "listed": [{"code": "SOP-QC-0100", "doc_type": "sop"}]}
    body = proposal.json()
    assert [doc["code"] for doc in body["docs"]] == ["SOP-QC-0100", "WI-QC-0101"]  # 글에 없는 WI-QC-0777은 버렸다
    assert body["docs"][1] == {
        "code": "WI-QC-0101", "title": "Synthetic operation", "doc_type": "wi", "parent_code": "SOP-QC-0100",
        "is_equipment_sop": False, "steps": ["Prepare"],
    }
    assert (body["listed_codes"], body["truncated"], body["invalid"]) == (["SOP-QC-0100"], False, False)
    # 목록은 그대로다 — AI는 제안만 한다
    assert client.get(base, headers=AUTHOR).json()["docs"] == before
    jobs, suggestions = _load_rows()
    assert [(job.status, job.payload) for job in jobs] == [("done", {})]  # 읽은 글은 작업에 남기지 않는다
    assert [(suggestion.result, suggestion.adoption) for suggestion in suggestions] == [("applied", None)]


def test_closing_the_preview_records_what_the_person_did(client: TestClient, fake_ai: FakeAi) -> None:
    bundle_id, base = _setup(client)
    fake_ai.chat = lambda data: json.dumps({"docs": [{"code": "WI-QC-0101", "doc_type": "wi"}]})
    client.post(f"{base}/read", data={"text": PLAN_TEXT}, headers=AUTHOR)
    run_jobs()
    suggestion_id = client.get(f"{base}/read", headers=AUTHOR).json()["suggestion_id"]

    as_reviewer = client.post(f"{base}/read/{suggestion_id}/close", json={"adoption": "rejected"}, headers=REVIEWER)
    closed = client.post(f"{base}/read/{suggestion_id}/close", json={"adoption": "edited"}, headers=AUTHOR)
    again = client.post(f"{base}/read/{suggestion_id}/close", json={"adoption": "rejected"}, headers=AUTHOR)

    assert as_reviewer.status_code in (403, 404)
    assert closed.status_code == 204, closed.text
    assert (again.status_code, again.json()["detail"]["code"]) == (409, "not_manual_adoption")
    assert client.get(f"{base}/read", headers=AUTHOR).json() is None
    _, suggestions = _load_rows()
    assert [(suggestion.adoption, suggestion.adopted_by is not None) for suggestion in suggestions] == [("edited", True)]


def test_a_newer_reading_replaces_the_older_proposal(client: TestClient, fake_ai: FakeAi) -> None:
    bundle_id, base = _setup(client)
    fake_ai.chat = lambda data: json.dumps({"docs": [{"code": "WI-QC-0101", "doc_type": "wi"}]})
    client.post(f"{base}/read", data={"text": PLAN_TEXT}, headers=AUTHOR)
    run_jobs()
    fake_ai.chat = lambda data: "this is not JSON"
    file = {"file": ("SYNTHETIC plan.txt", PLAN_TEXT.encode("utf-8"), "text/plain")}
    client.post(f"{base}/read", files=file, headers=AUTHOR)
    run_jobs()

    latest = client.get(f"{base}/read", headers=AUTHOR).json()

    # 읽지 못한 응답도 보인다 — 사람이 알고 닫게
    assert (latest["invalid"], latest["docs"]) == (True, [])
    _, suggestions = _load_rows()
    assert [suggestion.result for suggestion in suggestions] == ["stale", "invalid"]


def test_reading_is_refused_when_ai_is_off_or_nothing_was_sent(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id, base = _setup(client)

    nothing = client.post(f"{base}/read", headers=AUTHOR)
    blank = client.post(f"{base}/read", data={"text": "  \n "}, headers=AUTHOR)
    wrong = client.post(f"{base}/read", files={"file": ("plan.pdf", b"%PDF-1.4", "application/pdf")}, headers=AUTHOR)
    monkeypatch.setattr("app.settings.settings.ai_enabled", False)
    off = client.post(f"{base}/read", data={"text": PLAN_TEXT}, headers=AUTHOR)

    assert [(r.status_code, r.json()["detail"]["code"]) for r in (nothing, blank, wrong, off)] == [
        (422, "list_text_empty"), (422, "list_text_empty"), (422, "list_file_format"), (503, "ai_disabled"),
    ]
    assert _load_rows() == ([], [])
