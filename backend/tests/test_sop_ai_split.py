"""AI 복합 문장 나누기 제안 — 조각에서 나눌 위치 계산, 요청 대상 고르기, 상태를 바꾸지 않는 제안 쓰기, 나누기 편집과의 연결, 무효·낡음, 채택 기록 (설계 §6.8, §7.5, §7.11, 규칙 R03)."""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiUsageEvent
from app.settings import settings
from app.sop.ai import llm
from app.sop.ai.constants import MAX_SPLIT_PARTS, MIN_SPLIT_CHARS
from app.sop.ai.guidelines import SEEDS_DIR
from app.sop.ai.split import SplitReply, find_split_offsets
from app.sop.models import AiJob, AiSuggestion, Bundle, BundleEvent, GuidelineVersion, TargetSentence, Unit, UnitDecision
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_KO_1,
    AiBundle,
    attach_suggestion,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    edit_document,
    find_ids,
    make_ai_bundle,
    read_decision,
    read_rows,
    run_jobs,
    upload_second_document,
)
from tests.docx_factory import p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, assign_as_is, find_unit, get_view

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

# 합성 복합 문장 — 문장 끝 표시가 가운데 없어 규칙 쪼개기가 한 단위로 둔다
PART_1 = "합성 밸브의 상태를 확인하고"
PART_2 = "확인 결과를 합성 기록지에 기록한 뒤 필요한 경우"
PART_3 = "합성 담당자에게 결과를 보고한다."
COMPOUND = f"{PART_1} {PART_2} {PART_3}"
OTHER_PART_1 = "합성 시료의 온도를 측정하고"
OTHER_PART_2 = "측정값을 합성 일지에 적은 뒤 합성 책임자에게 전달하고 필요한 경우 합성 관리자에게도 보고한다."
OTHER_COMPOUND = f"{OTHER_PART_1} {OTHER_PART_2}"
assert min(len(COMPOUND), len(OTHER_COMPOUND)) >= MIN_SPLIT_CHARS  # 문서 범위 요청이 too_short로 거르지 않는 길이
EXACT_FLOOR = "합성" * (MIN_SPLIT_CHARS // 2)
BELOW_FLOOR = EXACT_FLOOR[:-1]
# 규칙 쪼개기가 문장 끝 뒤 빈 글자 없이 붙은 두 문장을 한 단위로 두는 모양 — 나눌 자리 사이에 빈 글자가 없다
TIGHT_FIRST, TIGHT_SECOND = "합성 장비를 켠다.", "합성 시료를 넣는다."
TIGHT = TIGHT_FIRST + TIGHT_SECOND
# 한 문단의 두 문장과 다음 문단의 한 문장 — 셋을 합치면 범위가 두 블록에 걸쳐 단위 글자에 줄바꿈 이음이 생긴다
CROSS_1, CROSS_2, CROSS_3 = "합성 첫째 문장이다.", "합성 둘째 문장이다.", "합성 셋째 문장이다."
CROSS_TEXT = f"{CROSS_1} {CROSS_2}\n{CROSS_3}"
HEADING = "1. 목적"
HEADING_BLOCK = p(HEADING, "Heading1")
DATA_TABLE = tbl([["합성 항목", "합성 값"], ["합성 압력", "10 bar"]])
MARKER = "RAW-REPLY-MARKER"
ADOPTION_KEYS = {"applied", "as_is", "edited", "rejected", "pending", "adoption_rate"}


def use_parts(ai: FakeAi, *parts: str, reason: str = "합성 이유.", rule_ids: tuple[str, ...] = ("R03",)) -> None:
    body = json.dumps({"parts": list(parts), "reason": reason, "rule_ids": list(rule_ids)}, ensure_ascii=False)
    ai.chat = lambda data: body


def use_compound_parts(ai: FakeAi) -> None:
    use_parts(ai, PART_1, f"{PART_2} {PART_3}")


def request_split(
    client: TestClient, bundle_id: int, *, headers: dict[str, str] = AUTHOR, **scope: object
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/ai/split", json=scope, headers=headers)


def adopt(
    client: TestClient, bundle_id: int, suggestion_id: int, adoption: object, *, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    return client.post(
        f"/api/bundles/{bundle_id}/ai/suggestions/{suggestion_id}/adoption", json={"adoption": adoption}, headers=headers
    )


def make_split_bundle(client: TestClient, *blocks: str) -> tuple[AiBundle, dict]:
    """To-Be가 있는 묶음에 옛 문서 하나를 더 올린다 — blocks는 DOCX 본문 조각이고, 돌려주는 view가 그 문서의 것이다."""
    bundle = make_ai_bundle(client)
    return bundle, upload_second_document(client, bundle.id, "".join(blocks))


def make_merged_cross_block_unit(client: TestClient) -> tuple[AiBundle, int, dict]:
    """두 블록에 걸친 단위 하나 — 문서 id와 단위를 돌려준다."""
    bundle, view = make_split_bundle(client, p(f"{CROSS_1} {CROSS_2}"), p(CROSS_3))
    document_id = view["document"]["id"]
    ids = [find_unit(view, text)["id"] for text in (CROSS_1, CROSS_2, CROSS_3)]
    edit_document(client, bundle.id, document_id, {"type": "merge", "unit_ids": ids})
    merged = find_unit(get_view(client, bundle.id, document_id), CROSS_TEXT)
    assert len(merged["spans"]) == 2
    return bundle, document_id, merged


def read_split_suggestions() -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if row.kind == "split"]


def read_single_suggestion() -> AiSuggestion:
    (suggestion,) = read_split_suggestions()
    return suggestion


def queue_one(client: TestClient, bundle_id: int, unit_id: int) -> None:
    response = request_split(client, bundle_id, unit_ids=[unit_id])
    assert response.status_code == 200, response.text
    assert (response.json()["queued"], response.json()["skipped_total"]) == (1, 0), response.text


def apply_offsets(client: TestClient, bundle: AiBundle, document_id: int, unit_id: int, offsets: list[int]) -> None:
    """제안된 위치를 뒤쪽부터 나누기 편집으로 적용한다 — 왼쪽 조각이 새 단위가 되므로 다음 위치는 그 조각에 건다."""
    for at in reversed(offsets):
        revision = get_view(client, bundle.id, document_id)["document"]["revision"]
        response = client.post(
            f"/api/bundles/{bundle.id}/documents/{document_id}/edits",
            json={"revision": revision, "confirm": False, "op": {"type": "split", "unit_id": unit_id, "at": at}},
            headers=AUTHOR,
        )
        assert response.status_code == 200, response.text
        unit_id = response.json()["created_unit_ids"][0]


def read_texts(client: TestClient, bundle_id: int, document_id: int) -> set[str]:
    return {unit["text"] for unit in get_view(client, bundle_id, document_id)["units"]}


def set_bundle_status(bundle_id: int, status: str) -> None:
    async def _set(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle_id).values(status=status))
        await session.commit()

    run_in_session(_set)


@pytest.fixture
def no_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    async def skip_sleep(delay: float) -> None:
        return None

    monkeypatch.setattr(llm, "sleep", skip_sleep)


# --- 나눌 위치 (순수) ---


def test_offsets_follow_parts_in_order() -> None:
    assert find_split_offsets("A를 한다. B를 한다.", ["A를 한다.", "B를 한다."]) == [7]
    assert find_split_offsets(COMPOUND, [PART_1, PART_2, PART_3]) == [len(PART_1) + 1, len(PART_1) + len(PART_2) + 2]
    assert find_split_offsets(TIGHT, [TIGHT_FIRST, TIGHT_SECOND]) == [len(TIGHT_FIRST)]  # 사이가 비어 있어도 된다


@pytest.mark.parametrize("parts", [["A를 한다.", "C를 한다."], ["B를 한다.", "A를 한다."]])
def test_changed_or_reordered_parts_are_refused(parts: list[str]) -> None:
    assert find_split_offsets("A를 한다. B를 한다.", parts) is None


def test_a_repeated_part_is_matched_in_order() -> None:
    assert find_split_offsets("A. A.", ["A.", "A."]) == [3]
    assert find_split_offsets("A. B. A.", ["A.", "A."]) is None  # 사이에 다른 글이 있다


def test_gap_must_be_whitespace_only() -> None:
    text = "A를 한다.\n\n  B를 한다."
    assert find_split_offsets(text, ["A를 한다.", "B를 한다."]) == [text.index("B")]
    invisible = "A를 한다.\u200b B를 한다."
    assert find_split_offsets(invisible, ["A를 한다.", "B를 한다."]) == [invisible.index("B")]  # 안 보이는 글자도 빈 글자다
    assert find_split_offsets("A를 한다. 그리고 B를 한다.", ["A를 한다.", "B를 한다."]) is None
    assert find_split_offsets("먼저 A를 한다. B를 한다.", ["A를 한다.", "B를 한다."]) is None  # 첫 조각 앞
    assert find_split_offsets("A를 한다. B를 한다. 끝.", ["A를 한다.", "B를 한다."]) is None  # 끝 조각 뒤
    assert find_split_offsets("  A를 한다. B를 한다.\n", ["A를 한다.", "B를 한다."]) == [9]  # 바깥 빈 글자는 괜찮다


def test_one_part_that_is_the_whole_sentence_means_no_cut() -> None:
    assert find_split_offsets("A를 한다.", ["A를 한다."]) == []
    assert find_split_offsets("A를 한다.", ["A를"]) is None  # 일부만 담은 조각은 문장을 다 덮지 못한다


@pytest.mark.parametrize("parts", [[], [""], ["A를 한다.", "   "], ["A를 한다.", "\u200b"]])
def test_empty_or_blank_parts_are_refused(parts: list[str]) -> None:
    assert find_split_offsets("A를 한다. B를 한다.", parts) is None


# --- 요청 ---


def test_document_scope_skips_short_and_decided_units(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(
        client,
        HEADING_BLOCK, p(COMPOUND), p(OTHER_COMPOUND), p(BELOW_FLOOR), p(EXACT_FLOOR), DATA_TABLE,
    )
    ids = {text: find_unit(view, text)["id"] for text in (COMPOUND, OTHER_COMPOUND, BELOW_FLOOR, EXACT_FLOOR)}
    assign_as_is(client, bundle.id, find_unit(view, OTHER_COMPOUND), bundle.sop_id, slot_key="purpose")

    response = request_split(client, bundle.id, document_id=view["document"]["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["queued"] == 2  # 정확히 문턱 길이인 문장도 받는다
    # 제목·표·묶인 칸은 후보가 아니라 알리지 않는다 — 건너뜀 목록은 사람이 볼 사유만 싣는다
    assert body["skipped_total"] == 2
    assert {(item["unit_id"], item["reason"]) for item in body["skipped"]} == {
        (ids[BELOW_FLOOR], "too_short"), (ids[OTHER_COMPOUND], "not_unassigned"),
    }
    jobs = read_rows(AiJob)
    assert [job.unit_ids for job in jobs] == [[ids[COMPOUND]], [ids[EXACT_FLOOR]]]
    assert {(job.kind, job.document_id) for job in jobs} == {("split", view["document"]["id"])}


def test_document_scope_skips_units_that_are_not_unassigned(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND), p(OTHER_COMPOUND))
    held, suggested = find_unit(view, COMPOUND), find_unit(view, OTHER_COMPOUND)
    assign_as_is(client, bundle.id, held, bundle.sop_id, hold_reason="합성 보류", slot_key="purpose")
    attach_suggestion(bundle.id, suggested["id"], "classify")  # 다른 종류 AI 제안 위에도 쓰지 않는다

    body = request_split(client, bundle.id, document_id=view["document"]["id"]).json()

    assert body["queued"] == 0
    assert {(item["unit_id"], item["reason"]) for item in body["skipped"]} == {
        (held["id"], "not_unassigned"), (suggested["id"], "not_unassigned"),
    }


def test_explicit_units_ignore_the_length_floor(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(BELOW_FLOOR))
    unit = find_unit(view, BELOW_FLOOR)

    response = request_split(client, bundle.id, unit_ids=[unit["id"]])

    assert response.json() == {"queued": 1, "skipped_total": 0, "skipped": []}
    (job,) = read_rows(AiJob)
    assert (job.kind, job.unit_ids, job.document_id) == ("split", [unit["id"]], view["document"]["id"])


def test_explicit_units_report_why_they_are_skipped(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND), p(OTHER_COMPOUND), DATA_TABLE)
    queued, decided, cell = find_unit(view, COMPOUND), find_unit(view, OTHER_COMPOUND), find_unit(view, "합성 압력")
    assign_as_is(client, bundle.id, decided, bundle.sop_id, slot_key="purpose")
    queue_one(client, bundle.id, queued["id"])

    body = request_split(client, bundle.id, unit_ids=[queued["id"], decided["id"], cell["id"]]).json()

    assert body["queued"] == 0
    assert {(item["unit_id"], item["reason"]) for item in body["skipped"]} == {
        (queued["id"], "already_queued"), (decided["id"], "not_unassigned"), (cell["id"], "bound_cell"),
    }
    assert len(read_rows(AiJob)) == 1


def test_explicit_units_of_a_kind_that_cannot_split_are_skipped_one_by_one(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, HEADING_BLOCK, p(COMPOUND), DATA_TABLE)
    heading, sentence = find_unit(view, HEADING), find_unit(view, COMPOUND)
    table = next(unit for unit in view["units"] if unit["kind"] == "table")

    response = request_split(client, bundle.id, unit_ids=[sentence["id"], heading["id"], table["id"]])

    assert response.status_code == 200, response.text  # 한 단위 때문에 요청 전체를 거절하지 않는다
    body = response.json()
    assert body["queued"] == 1
    assert {(item["unit_id"], item["reason"]) for item in body["skipped"]} == {
        (heading["id"], "not_splittable"), (table["id"], "not_splittable"),
    }
    assert [job.unit_ids for job in read_rows(AiJob)] == [[sentence["id"]]]


def test_document_scope_skips_units_with_an_open_split_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND), p(OTHER_COMPOUND))
    document_id = view["document"]["id"]
    suggested, other = find_unit(view, COMPOUND), find_unit(view, OTHER_COMPOUND)
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, suggested["id"])
    run_jobs()

    body = request_split(client, bundle.id, document_id=document_id).json()

    assert body["queued"] == 1
    assert body["skipped"] == [{"unit_id": suggested["id"], "reason": "already_suggested"}]
    assert [job.unit_ids for job in read_rows(AiJob)][-1] == [other["id"]]
    again = request_split(client, bundle.id, unit_ids=[suggested["id"]])  # 단위를 고르면 다시 물을 수 있다
    assert again.json()["queued"] == 1 and again.json()["skipped_total"] == 0


@pytest.mark.parametrize("closed", ["invalid", "adopted"])
def test_a_closed_split_suggestion_does_not_block_document_scope(
    client: TestClient, fake_ai: FakeAi, closed: str
) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    if closed == "invalid":
        fake_ai.chat = lambda data: "not json"
    else:
        use_compound_parts(fake_ai)
    queue_one(client, bundle.id, unit["id"])
    run_jobs()
    if closed == "adopted":
        assert adopt(client, bundle.id, read_single_suggestion().id, "rejected").status_code == 200

    body = request_split(client, bundle.id, document_id=view["document"]["id"]).json()

    assert (body["queued"], body["skipped_total"]) == (1, 0)


def test_request_takes_the_cell_sentences_of_a_layout_table(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, tbl([[COMPOUND, "합성 값"]]))
    document_id = view["document"]["id"]
    edit_document(
        client, bundle.id, document_id, {"type": "set_layout_table", "table_id": view["tables"][0]["id"], "is_layout": True}
    )
    cell = find_unit(get_view(client, bundle.id, document_id), COMPOUND)
    assert (cell["kind"], cell["group_unit_id"]) == ("cell_sentence", None)

    body = request_split(client, bundle.id, document_id=document_id).json()

    assert body["queued"] == 1 and [job.unit_ids for job in read_rows(AiJob)] == [[cell["id"]]]


def test_request_needs_scope_and_ai_enabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))

    disabled = request_split(client, bundle.id, document_id=view["document"]["id"])
    assert (disabled.status_code, disabled.json()["detail"]["code"]) == (503, "ai_disabled")

    monkeypatch.setattr(settings, "ai_enabled", True)
    for scope in ({}, {"unit_ids": []}):
        missing = request_split(client, bundle.id, **scope)
        assert (missing.status_code, missing.json()["detail"]["code"]) == (422, "scope_required")


def test_request_refuses_units_and_documents_outside_the_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, _ = make_split_bundle(client, p(COMPOUND))
    _, other_view = make_split_bundle(client, p(OTHER_COMPOUND))
    foreign = find_unit(other_view, OTHER_COMPOUND)["id"]

    by_unit = request_split(client, bundle.id, unit_ids=[foreign])
    by_document = request_split(client, bundle.id, document_id=other_view["document"]["id"])

    assert (by_unit.status_code, by_unit.json()["detail"]) == (
        404, {"code": "unit_not_found", "unit_ids": [foreign], "missing_total": 1},
    )
    assert (by_document.status_code, by_document.json()["detail"]["code"]) == (404, "document_not_found")
    assert read_rows(AiJob) == []


def test_request_needs_an_author_and_an_editable_bundle(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    document_id = view["document"]["id"]

    assert request_split(client, bundle.id, document_id=document_id, headers=REVIEWER).status_code == 403

    set_bundle_status(bundle.id, "in_review")
    refused = request_split(client, bundle.id, document_id=document_id)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")


# --- 제안 쓰기 ---


def test_suggestion_changes_no_state(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, unit["id"])
    before = read_decision(unit["id"])
    assert (before.status, before.disposition, before.revision) == ("unassigned", "unassigned", 1)

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["done"]
    suggestion = read_single_suggestion()
    assert suggestion.result == "applied"
    assert suggestion.document_id == view["document"]["id"]
    assert suggestion.content == {
        "unit_id": unit["id"], "offsets": [len(PART_1) + 1], "reason": "합성 이유.", "rule_ids": ["R03"],
    }
    assert suggestion.warnings == [] and suggestion.adoption is None
    assert set(suggestion.guideline_versions) == {"rules", "prompt.split"}
    assert suggestion.model == "glm-test"
    decision = read_decision(unit["id"])
    assert (decision.status, decision.disposition, decision.revision) == ("unassigned", "unassigned", 1)
    assert (decision.suggestion_id, decision.hold_reason) == (None, "")
    assert read_rows(TargetSentence) == []
    after = get_view(client, bundle.id, view["document"]["id"])
    assert after["document"]["revision"] == view["document"]["revision"]
    assert find_unit(after, COMPOUND)["id"] == unit["id"]


def test_three_parts_give_two_offsets_in_order(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    use_parts(fake_ai, PART_1, PART_2, PART_3)
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    assert read_single_suggestion().content["offsets"] == [len(PART_1) + 1, len(PART_1) + len(PART_2) + 2]


def test_offset_is_usable_by_the_split_edit(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND), p(TIGHT))
    document_id = view["document"]["id"]
    compound, tight = find_unit(view, COMPOUND), find_unit(view, TIGHT)
    fake_ai.chat = lambda data: json.dumps(
        {
            "parts": [PART_1, PART_2, PART_3] if data["text"] == COMPOUND else [TIGHT_FIRST, TIGHT_SECOND],
            "reason": "합성 이유.", "rule_ids": [],
        },
        ensure_ascii=False,
    )
    assert request_split(client, bundle.id, unit_ids=[compound["id"], tight["id"]]).json()["queued"] == 2

    run_jobs()

    offsets = {row.content["unit_id"]: row.content["offsets"] for row in read_split_suggestions()}
    assert len(offsets[compound["id"]]) == 2 and len(offsets[tight["id"]]) == 1
    apply_offsets(client, bundle, document_id, compound["id"], offsets[compound["id"]])
    apply_offsets(client, bundle, document_id, tight["id"], offsets[tight["id"]])
    texts = read_texts(client, bundle.id, document_id)
    assert {PART_1, PART_2, PART_3, TIGHT_FIRST, TIGHT_SECOND} <= texts
    assert COMPOUND not in texts and TIGHT not in texts


def test_offsets_work_for_a_unit_whose_spans_cross_blocks(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, document_id, merged = make_merged_cross_block_unit(client)
    use_parts(fake_ai, CROSS_1, f"{CROSS_2}\n{CROSS_3}")  # 둘째 조각 안에 줄바꿈 이음이 들어간다
    queue_one(client, bundle.id, merged["id"])

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "applied" and suggestion.content["offsets"] == [len(CROSS_1) + 1]
    apply_offsets(client, bundle, document_id, merged["id"], suggestion.content["offsets"])
    assert {CROSS_1, f"{CROSS_2}\n{CROSS_3}"} <= read_texts(client, bundle.id, document_id)


def test_a_cut_at_the_block_boundary_is_usable(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, document_id, merged = make_merged_cross_block_unit(client)
    use_parts(fake_ai, CROSS_1, CROSS_2, CROSS_3)
    queue_one(client, bundle.id, merged["id"])

    run_jobs()

    offsets = read_single_suggestion().content["offsets"]
    assert offsets == [len(CROSS_1) + 1, len(CROSS_1) + len(CROSS_2) + 2]  # 둘째 위치는 둘째 블록의 첫 글자다
    apply_offsets(client, bundle, document_id, merged["id"], offsets)
    assert {CROSS_1, CROSS_2, CROSS_3} <= read_texts(client, bundle.id, document_id)


def test_a_part_that_turns_the_line_break_into_a_space_is_invalid(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, document_id, merged = make_merged_cross_block_unit(client)
    use_parts(fake_ai, CROSS_1, f"{CROSS_2} {CROSS_3}")
    queue_one(client, bundle.id, merged["id"])

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "invalid" and suggestion.content["offsets"] == []
    assert [warning["kind"] for warning in suggestion.warnings] == ["parts_mismatch"]


def test_single_part_writes_no_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_parts(fake_ai, COMPOUND, reason="한 가지 행동이라 나누지 않는다.", rule_ids=())
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["done"]
    assert read_split_suggestions() == []
    assert read_decision(unit["id"]).status == "unassigned"


def test_unknown_rule_id_is_dropped_with_warning(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    use_parts(fake_ai, PART_1, f"{PART_2} {PART_3}", rule_ids=("R03", "R99"))
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "applied" and suggestion.content["rule_ids"] == ["R03"]
    assert suggestion.warnings == [{"kind": "unknown_rule_id", "source": "R99", "target": ""}]


def test_nul_in_the_reason_is_stored_as_replacement(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    use_parts(fake_ai, PART_1, f"{PART_2} {PART_3}", reason="합성\x00이유")
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    assert read_single_suggestion().content["reason"] == "합성�이유"


def test_payload_carries_the_sentence_and_its_context(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, HEADING_BLOCK, p(AI_KO_1), p(COMPOUND), p(OTHER_COMPOUND))
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    (data,) = fake_ai.requests
    assert set(data) == {"task", "text", "context"}
    assert (data["task"], data["text"]) == ("split", COMPOUND)
    assert data["context"] == {"section": "1", "before": [HEADING, AI_KO_1], "after": [OTHER_COMPOUND]}  # 절 이름은 번호다
    raw = json.dumps(fake_ai.requests, ensure_ascii=False)
    assert "qa.member" not in raw and "품질담당" not in raw


def test_seed_example_parses_as_split_reply() -> None:
    seed = (SEEDS_DIR / "prompt.split.md").read_text(encoding="utf-8")

    example = re.findall(r"```json\n(.*?)\n```", seed, flags=re.DOTALL)[-1]

    assert llm.parse_reply(example, SplitReply) is not None


def test_seed_names_the_payload_and_reply_fields(client: TestClient, fake_ai: FakeAi) -> None:
    seed = (SEEDS_DIR / "prompt.split.md").read_text(encoding="utf-8")
    sent = seed.split("The data object has these fields:")[1].split("## How to answer")[0]
    replied = seed.split("## How to answer")[1].split("## How to decide")[0]
    bundle, view = make_split_bundle(client, p(COMPOUND))
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    (data,) = fake_ai.requests
    assert set(re.findall(r"^- `(\w+)`:", sent, flags=re.MULTILINE)) == set(data) - {"task"}
    assert set(re.findall(r"^- `(\w+)`:", replied, flags=re.MULTILINE)) == set(SplitReply.model_fields)
    assert set(re.findall(r"^  - `(\w+)`:", sent, flags=re.MULTILINE)) == set(data["context"])


def test_reasoning_and_feature_are_recorded(client: TestClient, fake_ai: FakeAi, clean_ai_usage: None) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    assert fake_ai.bodies[0]["chat_template_kwargs"]["reasoning_effort"] == "low"
    (event,) = read_rows(AiUsageEvent)
    assert (event.feature, event.login_id, event.ok) == ("sop.split", "qa.member", True)


# --- 무효 응답·호출 실패 ---


def _dump(**reply: object) -> str:
    return json.dumps(reply, ensure_ascii=False)


# (응답, 경고 종류) — 응답 글에는 MARKER를 심어 두고 어디에도 남지 않는지 본다
INVALID_REPLIES = [
    ("not json " + MARKER, "invalid_format"),
    (_dump(parts=MARKER, reason=MARKER, rule_ids=[]), "invalid_format"),
    (_dump(parts=[PART_1], reason=MARKER), "invalid_format"),  # 칸이 빠졌다
    (_dump(parts=["합"] * (MAX_SPLIT_PARTS + 1), reason=MARKER, rule_ids=[]), "invalid_format"),
    (_dump(parts=[], reason=MARKER, rule_ids=[]), "parts_mismatch"),
    (_dump(parts=[PART_1, "  "], reason=MARKER, rule_ids=[]), "parts_mismatch"),
    (_dump(parts=[MARKER, "다른 글"], reason=MARKER, rule_ids=[]), "parts_mismatch"),
    (_dump(parts=[f"{PART_2} {PART_3}", PART_1], reason=MARKER, rule_ids=[]), "parts_mismatch"),  # 순서가 바뀌었다
    (_dump(parts=[PART_1, PART_3], reason=MARKER, rule_ids=[]), "parts_mismatch"),  # 가운데가 빠졌다
    (_dump(parts=[PART_1, f"{PART_2} {PART_3}!"], reason=MARKER, rule_ids=[]), "parts_mismatch"),  # 글자가 더해졌다
]


@pytest.mark.parametrize(("reply", "kind"), INVALID_REPLIES)
def test_invalid_reply_is_recorded_without_hold(client: TestClient, fake_ai: FakeAi, reply: str, kind: str) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    fake_ai.chat = lambda data: reply
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["done"]
    suggestion = read_single_suggestion()
    assert suggestion.result == "invalid"
    assert suggestion.content == {"unit_id": unit["id"], "offsets": [], "reason": "", "rule_ids": []}
    assert suggestion.warnings == [{"kind": kind, "source": "", "target": ""}]
    assert MARKER not in json.dumps([suggestion.content, suggestion.warnings], ensure_ascii=False)
    decision = read_decision(unit["id"])  # 분류와 달리 보류하지 않는다 — 상태를 바꾸는 제안이 아니다
    assert (decision.status, decision.hold_reason, decision.revision, decision.suggestion_id) == (
        "unassigned", "", 1, None,
    )


def test_connection_failure_leaves_the_unit_untouched(client: TestClient, fake_ai: FakeAi, no_retry_wait: None) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)

    def refuse(data: dict) -> str:
        raise httpx2.ConnectError("refused")

    fake_ai.chat = refuse
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("failed", "connection")
    assert read_split_suggestions() == []
    assert read_decision(unit["id"]).status == "unassigned"


@pytest.mark.usefixtures("restore_guidelines")
def test_missing_active_guideline_fails_the_job_as_config(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    async def _deactivate(session: AsyncSession) -> None:
        await session.execute(
            update(GuidelineVersion).where(GuidelineVersion.key == "prompt.split").values(is_active=False)
        )
        await session.commit()

    run_in_session(_deactivate)

    run_jobs()

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("failed", "config")
    assert fake_ai.requests == []


# --- 낡음 ---


def test_stale_when_unit_retired_during_call(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)
    fake_ai.on_chat = lambda data: edit_document(
        client, bundle.id, view["document"]["id"], {"type": "split", "unit_id": unit["id"], "at": 5}
    )
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    suggestion = read_single_suggestion()
    assert (suggestion.result, suggestion.adoption) == ("stale", None)
    assert read_rows(TargetSentence) == []
    assert {row.status for row in read_rows(UnitDecision)} == {"unassigned"}


def test_decision_made_during_the_call_is_stale(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)
    fake_ai.on_chat = lambda data: assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key="purpose")
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert read_single_suggestion().result == "stale"
    assert read_decision(unit["id"]).status == "confirmed"


def test_decided_before_start_is_stale_without_a_call(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    queue_one(client, bundle.id, unit["id"])
    assign_as_is(client, bundle.id, unit, bundle.sop_id, slot_key="purpose")

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert fake_ai.requests == [] and read_split_suggestions() == []


def test_language_change_during_the_call_keeps_the_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    # 나눌 위치는 글자에만 기대어 언어가 바뀌어도 그대로 쓸 수 있다
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)
    fake_ai.on_chat = lambda data: edit_document(
        client, bundle.id, view["document"]["id"], {"type": "set_language", "unit_ids": [unit["id"]], "lang": "en"}
    )
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["done"]
    assert read_single_suggestion().result == "applied"


def test_text_changed_during_the_call_is_stale(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)

    def change_the_text(data: dict) -> None:
        async def _change(session: AsyncSession) -> None:
            await session.execute(update(Unit).where(Unit.id == unit["id"]).values(text=OTHER_COMPOUND))
            await session.commit()

        # 이 훅은 실행기의 이벤트 루프 안에서 돌아 asyncio.run을 못 쓴다 — 다른 스레드에서 끝날 때까지 기다린다
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(run_in_session, _change).result()

    fake_ai.on_chat = change_the_text
    queue_one(client, bundle.id, unit["id"])

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert read_single_suggestion().result == "stale"


# --- 채택 기록 ---


def make_applied_suggestion(client: TestClient, fake_ai: FakeAi) -> tuple[AiBundle, dict, dict, AiSuggestion]:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    unit = find_unit(view, COMPOUND)
    use_compound_parts(fake_ai)
    queue_one(client, bundle.id, unit["id"])
    run_jobs()
    return bundle, view, unit, read_single_suggestion()


def read_split_adoption(client: TestClient, bundle_id: int) -> dict:
    return client.get(f"/api/bundles/{bundle_id}/ai/status", headers=AUTHOR).json()["adoption"]["split"]


def test_split_suggestion_is_pending_until_a_person_decides(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)

    pending = read_split_adoption(client, bundle.id)
    assert set(pending) == ADOPTION_KEYS
    assert pending == {"applied": 1, "as_is": 0, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": None}

    apply_offsets(client, bundle, view["document"]["id"], unit["id"], suggestion.content["offsets"])
    assert read_split_adoption(client, bundle.id)["pending"] == 1  # 나눈 단위는 은퇴해도 채택 기록을 기다린다

    assert adopt(client, bundle.id, suggestion.id, "as_is").status_code == 200
    assert read_split_adoption(client, bundle.id) == {
        "applied": 1, "as_is": 1, "edited": 0, "rejected": 0, "pending": 0, "adoption_rate": 1.0,
    }


def test_invalid_suggestions_are_not_counted_as_applied(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND))
    fake_ai.chat = lambda data: "not json"
    queue_one(client, bundle.id, find_unit(view, COMPOUND)["id"])

    run_jobs()

    assert read_single_suggestion().result == "invalid"
    adoption = client.get(f"/api/bundles/{bundle.id}/ai/status", headers=AUTHOR).json()["adoption"]
    assert "split" not in adoption  # 적용된 제안이 없는 종류는 집계에서 빠진다


@pytest.mark.parametrize("adoption", ["as_is", "edited", "rejected"])
def test_adoption_endpoint_records_the_decision(client: TestClient, fake_ai: FakeAi, adoption: str) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)

    response = adopt(client, bundle.id, suggestion.id, adoption)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["kind"], body["result"], body["adoption"], body["adopted_by"]) == (
        suggestion.id, "split", "applied", adoption, "qa.member",
    )
    assert body["adopted_at"] is not None and body["content"] == suggestion.content
    assert read_single_suggestion().adoption == adoption
    assert read_decision(unit["id"]).status == "unassigned"  # 채택 기록은 판단을 건드리지 않는다


def test_adoption_endpoint_is_split_only(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, split = make_applied_suggestion(client, fake_ai)
    other = find_ids(client, bundle, AI_KO_1)[0]
    classify_id = attach_suggestion(bundle.id, other, "classify")

    response = adopt(client, bundle.id, classify_id, "as_is")

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "not_manual_adoption")
    assert next(row for row in read_rows(AiSuggestion) if row.id == classify_id).adoption is None


def test_adoption_endpoint_refuses_a_second_decision(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)
    assert adopt(client, bundle.id, suggestion.id, "edited").status_code == 200

    again = adopt(client, bundle.id, suggestion.id, "rejected")

    assert (again.status_code, again.json()["detail"]["code"]) == (409, "not_manual_adoption")
    assert read_single_suggestion().adoption == "edited"


@pytest.mark.parametrize("result", ["stale", "invalid"])
def test_adoption_endpoint_needs_an_applied_suggestion(client: TestClient, fake_ai: FakeAi, result: str) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)

    async def _set_result(session: AsyncSession) -> None:
        await session.execute(update(AiSuggestion).where(AiSuggestion.id == suggestion.id).values(result=result))
        await session.commit()

    run_in_session(_set_result)

    response = adopt(client, bundle.id, suggestion.id, "as_is")

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "not_manual_adoption")
    assert read_single_suggestion().adoption is None


def test_adoption_endpoint_rules_on_who_and_what(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)
    other_bundle, _ = make_split_bundle(client, p(OTHER_COMPOUND))

    assert adopt(client, bundle.id, suggestion.id, "as_is", headers=REVIEWER).status_code == 403
    assert adopt(client, bundle.id, suggestion.id, "maybe").status_code == 422
    assert client.post(
        f"/api/bundles/{bundle.id}/ai/suggestions/{suggestion.id}/adoption", json={}, headers=AUTHOR
    ).status_code == 422
    wrong_bundle = adopt(client, other_bundle.id, suggestion.id, "as_is")
    assert (wrong_bundle.status_code, wrong_bundle.json()["detail"]["code"]) == (404, "suggestion_not_found")
    assert adopt(client, bundle.id, 999999, "as_is").json()["detail"]["code"] == "suggestion_not_found"
    assert read_single_suggestion().adoption is None

    set_bundle_status(bundle.id, "in_review")
    refused = adopt(client, bundle.id, suggestion.id, "as_is")
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bundle_not_editable")
    assert read_single_suggestion().adoption is None


def test_adoption_endpoint_works_with_ai_disabled(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)
    monkeypatch.setattr(settings, "ai_enabled", False)  # 요청이 아니라 기록이라 AI가 꺼져 있어도 된다

    assert adopt(client, bundle.id, suggestion.id, "as_is").status_code == 200


def test_adoption_endpoint_writes_no_bundle_event(client: TestClient, fake_ai: FakeAi) -> None:
    # 누가·언제는 제안 행(adopted_by·adopted_at)이 이미 담고, 작업 기록의 AI 동작은 요청·취소·다시 시도뿐이다
    bundle, view, unit, suggestion = make_applied_suggestion(client, fake_ai)
    events_before = [event.action for event in read_rows(BundleEvent)]

    assert adopt(client, bundle.id, suggestion.id, "edited").status_code == 200

    assert [event.action for event in read_rows(BundleEvent)] == events_before
    assert "ai.adopt" not in events_before


# --- 새 답이 오면 이전 제안 내리기 ---


def read_results() -> list[tuple[str, str | None]]:
    return [(row.result, row.adoption) for row in read_split_suggestions()]


def ask_again(client: TestClient, bundle_id: int, unit_id: int) -> None:
    queue_one(client, bundle_id, unit_id)
    run_jobs()


def test_a_new_cut_retires_the_older_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, first = make_applied_suggestion(client, fake_ai)

    ask_again(client, bundle.id, unit["id"])

    assert read_results() == [("stale", None), ("applied", None)]
    assert read_split_adoption(client, bundle.id) == {
        "applied": 1, "as_is": 0, "edited": 0, "rejected": 0, "pending": 1, "adoption_rate": None,
    }
    assert adopt(client, bundle.id, first.id, "as_is").status_code == 409  # 내려간 제안은 채택을 받지 않는다


def test_a_new_answer_leaves_the_suggestions_of_other_units(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view = make_split_bundle(client, p(COMPOUND), p(OTHER_COMPOUND))
    document_id = view["document"]["id"]
    compound, other = find_unit(view, COMPOUND), find_unit(view, OTHER_COMPOUND)
    fake_ai.chat = lambda data: json.dumps(
        {
            "parts": [PART_1, f"{PART_2} {PART_3}"] if data["text"] == COMPOUND else [OTHER_PART_1, OTHER_PART_2],
            "reason": "합성 이유.", "rule_ids": [],
        },
        ensure_ascii=False,
    )
    assert request_split(client, bundle.id, document_id=document_id).json()["queued"] == 2
    run_jobs()
    assert read_results() == [("applied", None), ("applied", None)]

    ask_again(client, bundle.id, compound["id"])

    assert [(row.content["unit_id"], row.result) for row in read_split_suggestions()] == [
        (compound["id"], "stale"), (other["id"], "applied"), (compound["id"], "applied"),
    ]


def test_an_adopted_older_suggestion_stays_applied(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, first = make_applied_suggestion(client, fake_ai)
    assert adopt(client, bundle.id, first.id, "edited").status_code == 200

    ask_again(client, bundle.id, unit["id"])

    assert read_results() == [("applied", "edited"), ("applied", None)]
    assert read_split_adoption(client, bundle.id) == {
        "applied": 2, "as_is": 0, "edited": 1, "rejected": 0, "pending": 1, "adoption_rate": 0.0,
    }


def test_a_no_cut_answer_retires_the_older_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, first = make_applied_suggestion(client, fake_ai)
    use_parts(fake_ai, COMPOUND, reason="한 가지 행동이라 나누지 않는다.", rule_ids=())

    ask_again(client, bundle.id, unit["id"])

    assert read_results() == [("stale", None)]  # 새 제안은 쓰지 않아도 가장 새 답이 "나누지 말라"다
    assert "split" not in client.get(f"/api/bundles/{bundle.id}/ai/status", headers=AUTHOR).json()["adoption"]


def test_an_invalid_rerun_keeps_the_older_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, first = make_applied_suggestion(client, fake_ai)
    fake_ai.chat = lambda data: "not json"

    ask_again(client, bundle.id, unit["id"])

    assert read_results() == [("applied", None), ("invalid", None)]
    assert read_split_adoption(client, bundle.id)["pending"] == 1


def test_a_stale_rerun_keeps_the_older_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    bundle, view, unit, first = make_applied_suggestion(client, fake_ai)
    fake_ai.on_chat = lambda data: edit_document(
        client, bundle.id, view["document"]["id"], {"type": "split", "unit_id": unit["id"], "at": 5}
    )

    ask_again(client, bundle.id, unit["id"])

    assert read_results() == [("applied", None), ("stale", None)]
