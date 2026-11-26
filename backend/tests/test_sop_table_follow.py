"""한글 표 따라 하기 1 — 영어 표의 짝 한글 표를 꼴 + 토큰 + 뜻으로 고르고(11-23 명세 D2-R1 · R2), 애매하면 사람이 정한 것을 저장한다(R3).

표는 합성이다 — S18의 한글 표 3 · 영어 표 5(같은 토큰) · 영어 표 6(같은 꼴, 토큰 없음)을 본뜬다.
"""

import math

import httpx2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop.constants import TABLE_FOLLOW_THRESHOLD
from app.sop.counterparts import TableFacts
from app.sop.editing import load_unwrapped_lines
from app.sop.models import AiSuggestion, SourceTable, UnitDecision
from app.sop.numbering import get_number, strip_number
from app.sop.table_follow import (
    FollowLine,
    FollowTable,
    build_follow_plan,
    count_follow_items,
    list_counterpart_candidates,
    match_rows,
    pick_counterpart,
    read_tokens,
    score_tables,
)
from tests.access_helpers import run_in_session
from tests.ai_fixtures import clean_embedding_cache  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.ai_helpers import build_embed_body, enable_embed, install_ai_transport, read_payload, vector_for
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, get_view, set_members, upload
from tests.test_sop_decision_undo import _dump, _ok, _redo, _undo, assert_same_state


def table(*rows: str, n_cols: int = 2) -> FollowTable:
    return FollowTable(n_rows=len(rows), n_cols=n_cols, rows=rows)


KO3 = table("1 장비를 준비한다.", "2 시료 10 mL를 채취한다.", "3 채취 뒤 4 °C에 둔다.", "4 (빈 칸)")
KO3_COPY = table("1 장비를 준비한다.", "2 시료 10 mL를 채취한다.", "3 채취 뒤 4 °C에 둔다.", "4 (빈 칸)")
EN5 = table("1 Take 10 mL of sample.", "2 Prepare the equipment.", "3 Keep at 4 °C after.", "4 (blank)")
EN6 = table("1 Training record", "2 Trainee signs the form.", "3 Trainer checks the record.", "4 (blank)")
KO_PLAIN = table("장비를 준비한다.", "기록을 남긴다.")
EN_PLAIN = table("Prepare the equipment.", "Keep the record.")


def pick(english: FollowTable, korean: dict[int, FollowTable]) -> tuple[str, int | None]:
    scores = {table_id: score_tables(source, english, None) for table_id, source in korean.items()}
    answer = pick_counterpart(scores, None, has_choice=False)
    return answer.status, answer.source_table_id


def vectors(cosine: float) -> dict[str, np.ndarray]:
    """KO_PLAIN 행 i와 EN_PLAIN 행 i의 코사인이 cosine, 다른 행끼리는 0인 가짜 벡터."""
    size = 2 * KO_PLAIN.n_rows
    out: dict[str, np.ndarray] = {}
    for index, (korean, english) in enumerate(zip(KO_PLAIN.rows, EN_PLAIN.rows, strict=True)):
        base = np.zeros(size, dtype=np.float32)
        base[2 * index] = 1.0
        near = np.zeros(size, dtype=np.float32)
        near[2 * index], near[2 * index + 1] = cosine, math.sqrt(1 - cosine * cosine)
        out[korean], out[english] = base, near
    return out


def test_same_shape_with_other_content_is_not_a_pair() -> None:
    assert pick(EN6, {3: KO3}) == ("none", None)  # AC1 — 꼴만으로 잇지 않는다


def test_shared_tokens_make_the_pair() -> None:
    assert pick(EN5, {3: KO3}) == ("matched", 3)  # S18: 10 mL · 4 °C


def test_tokens_ignore_number_cells_and_case() -> None:
    assert read_tokens(["1", "Take 10 mL of sample.", "Keep at 4 °C after."]) == {"10 ml": 1, "4 °c": 1}


def test_tokens_read_ph_document_numbers_abbreviations_and_dates() -> None:
    texts = ["pH 7.0으로 맞춘다.", "SOP-QC-0101을 따른다.", "HPLC로 잰다.", "2026.11.26에 적는다.", "37℃ · 10mL"]
    assert read_tokens(texts) == {"ph 7.0": 1, "sop-qc-0101": 1, "hplc": 1, "2026-11-26": 1, "37 °c": 1, "10 ml": 1}


def test_close_scores_ask_a_person() -> None:
    assert pick(EN5, {3: KO3, 4: KO3_COPY})[0] == "ambiguous"


def test_other_column_count_scores_zero() -> None:
    assert score_tables(table("시료 10 mL", n_cols=3), table("10 mL sample", n_cols=2), None) == 0


def test_embeddings_lift_a_tokenless_pair() -> None:
    assert score_tables(KO_PLAIN, EN_PLAIN, vectors(0.9)) >= TABLE_FOLLOW_THRESHOLD
    assert score_tables(KO_PLAIN, EN_PLAIN, None) < TABLE_FOLLOW_THRESHOLD


def test_far_meaning_keeps_a_tokenless_pair_apart() -> None:
    assert score_tables(KO_PLAIN, EN_PLAIN, vectors(0.3)) < TABLE_FOLLOW_THRESHOLD


def test_a_persons_choice_wins_both_ways() -> None:
    assert pick_counterpart({3: 0.1}, 3, has_choice=True).status == "matched"
    assert pick_counterpart({3: 0.9}, None, has_choice=True).status == "none"


def facts(table_id: int, index: int, lang: str, *, n_cols: int = 2, parent_id: int | None = None) -> TableFacts:
    return TableFacts(
        id=table_id, index=index, parent_id=parent_id, part="body", n_rows=4, n_cols=n_cols, is_layout=False,
        widths=None, first_row=(), is_band=False, lang=lang,
    )


TABLES = [facts(1, 0, "ko"), facts(2, 1, "ko", n_cols=3), facts(3, 2, "ko"), facts(5, 3, "en"), facts(6, 4, "en")]


def test_interleaved_offers_the_nearest_korean_table_of_the_same_form_above() -> None:
    assert [item.id for item in list_counterpart_candidates(TABLES[3], TABLES, interleaved=True)] == [3]
    assert [item.id for item in list_counterpart_candidates(TABLES[4], TABLES, interleaved=True)] == [3]
    assert list_counterpart_candidates(facts(9, 0, "en"), [facts(9, 0, "en"), facts(1, 1, "ko")], interleaved=True) == []


def test_separate_offers_every_korean_table_of_the_same_layer() -> None:
    inner = facts(7, 5, "ko", parent_id=1)
    candidates = list_counterpart_candidates(TABLES[3], [*TABLES, inner], interleaved=False)
    assert [item.id for item in candidates] == [1, 2, 3]


# --- 저장과 API(D2-R3) — 한/영 따로 합성 문서: 0 한글 작업 표 · 1 한글 교육 표 · 2 영어 작업 표(S18의 표 5) · 3 영어 교육 표(표 6) ---

OLD_NAME = "SYNTHETIC_SYN-FOLLOW-1_Separate_tables.docx"
WIDTHS = [1588, 8050]
KO_STEPS = [["1", "장비를 준비한다."], ["2", "시료 10 mL를 채취한다."], ["3", "채취 뒤 4 °C에 둔다."], ["4", "(빈 칸)"]]
KO_TRAINING = [["1", "교육 기록을 확인한다."], ["2", "교육생이 서명한다."], ["3", "강사가 기록을 점검한다."], ["4", "(빈 칸)"]]
EN_STEPS = [["1", "Take 10 mL of sample."], ["2", "Prepare the equipment."], ["3", "Keep at 4 °C after."], ["4", "(blank)"]]
EN_TRAINING = [["1", "Training record"], ["2", "Trainee signs the form."], ["3", "Trainer checks the record."], ["4", "(blank)"]]
KO_STEPS_TABLE, KO_TRAINING_TABLE, EN_STEPS_TABLE, EN_TRAINING_TABLE = range(4)


def _grid(rows: list[list[str]]) -> str:
    return make_grid_table(len(WIDTHS), "".join(make_row(row) for row in rows), WIDTHS)


BODY = (
    p("1. 시료 채취", "Heading1") + p("이 절은 시료 채취를 다룬다.") + _grid(KO_STEPS) + _grid(KO_TRAINING)
    + p("1. Sampling", "Heading1") + p("This section covers sampling.") + _grid(EN_STEPS) + _grid(EN_TRAINING)
)


def _setup(client: TestClient, *, side: str = "old", body: str = BODY, bundle_id: int | None = None) -> tuple[int, int, list[int]]:
    if bundle_id is None:
        bundle_id = create_bundle(client, is_synthetic=True)["id"]
    extra = {"doc_type": "sop"} if side == "new" else {}
    name = OLD_NAME if side == "old" else "SYNTHETIC_SYN-FOLLOW-2_New.docx"
    response = upload(client, bundle_id, build_docx(body), name, side=side, **extra)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    doc_id = response.json()["id"]
    return bundle_id, doc_id, [table["id"] for table in get_view(client, bundle_id, doc_id)["tables"]]


def _url(bundle_id: int, doc_id: int, table_id: int) -> str:
    return f"/api/bundles/{bundle_id}/documents/{doc_id}/tables/{table_id}/counterpart"


def _get(client: TestClient, bundle_id: int, doc_id: int, table_id: int, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    return client.get(_url(bundle_id, doc_id, table_id), headers=headers)


def _put(
    client: TestClient, bundle_id: int, doc_id: int, table_id: int, source: int | None, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    return client.put(_url(bundle_id, doc_id, table_id), json={"source_table_id": source}, headers=headers)


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


@pytest.mark.usefixtures("clean_sop")
def test_counterpart_get_returns_status_and_candidates(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client)

    steps = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])
    training = _get(client, bundle_id, doc_id, tables[EN_TRAINING_TABLE])

    assert steps.status_code == 200, steps.text
    assert steps.json() == {
        "table_no": 3, "status": "matched", "source_table_id": tables[KO_STEPS_TABLE], "decided": False,
        "candidates": [
            {"table_id": tables[KO_STEPS_TABLE], "table_no": 1, "score": 1.0},
            {"table_id": tables[KO_TRAINING_TABLE], "table_no": 2, "score": 0.3},
        ],
    }
    assert (training.json()["status"], training.json()["source_table_id"]) == ("none", None)  # AC1 — 같은 꼴이지만 토큰이 없다
    korean = _get(client, bundle_id, doc_id, tables[KO_STEPS_TABLE]).json()
    assert (korean["status"], korean["candidates"]) == ("none", [])  # 한글 표는 짝을 묻지 않는다


@pytest.mark.usefixtures("clean_sop")
def test_choosing_a_counterpart_is_stored_and_wins(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client)

    chosen = _put(client, bundle_id, doc_id, tables[EN_TRAINING_TABLE], tables[KO_TRAINING_TABLE])
    again = _put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], tables[KO_TRAINING_TABLE])

    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["status"], chosen.json()["source_table_id"], chosen.json()["decided"]) == (
        "matched", tables[KO_TRAINING_TABLE], True,
    )
    assert again.status_code == 200, again.text  # 점수가 낮은 표도 사람이 고르면 짝이다
    read = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE]).json()
    assert (read["status"], read["source_table_id"], read["decided"]) == ("matched", tables[KO_TRAINING_TABLE], True)
    changed = _put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], tables[KO_STEPS_TABLE]).json()
    assert changed["source_table_id"] == tables[KO_STEPS_TABLE]  # 다시 고르면 같은 행을 바꾼다
    events = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR)
    assert [event["action"] for event in events.json()].count("table.counterpart") == 3


@pytest.mark.usefixtures("clean_sop")
def test_choosing_none_is_stored(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client)

    response = _put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], None)

    assert response.status_code == 200, response.text
    read = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE]).json()
    assert (read["status"], read["source_table_id"], read["decided"]) == ("none", None, True)
    assert get_view(client, bundle_id, doc_id)["document"]["revision"] == 1  # 문서는 바뀌지 않는다


@pytest.mark.usefixtures("clean_sop")
def test_new_document_is_refused(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client, side="new")

    assert _code(_get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])) == (422, "invalid_side")
    assert _code(_put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], None)) == (422, "invalid_side")


@pytest.mark.usefixtures("clean_sop")
def test_other_documents_table_is_404(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client)
    other_body = p("2. 기록", "Heading1") + _grid(KO_TRAINING) + p("2. Records", "Heading1") + _grid(EN_TRAINING)
    _, _, others = _setup(client, body=other_body, bundle_id=bundle_id)

    assert _code(_get(client, bundle_id, doc_id, others[0])) == (404, "table_not_found")
    assert _code(_put(client, bundle_id, doc_id, others[0], None)) == (404, "table_not_found")
    assert _code(_put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], others[0])) == (404, "table_not_found")
    assert _code(_put(client, bundle_id, doc_id, tables[KO_STEPS_TABLE], None)) == (404, "table_not_found")  # 한글 표


@pytest.mark.usefixtures("clean_sop")
def test_reader_cannot_choose(client: TestClient) -> None:
    bundle_id, doc_id, tables = _setup(client)
    assert set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    assert _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], headers=REVIEWER).status_code == 200
    assert _code(_put(client, bundle_id, doc_id, tables[EN_STEPS_TABLE], None, headers=REVIEWER)) == (403, "role_required")


@pytest.mark.usefixtures("clean_sop", "clean_embedding_cache")
def test_embed_call_holds_no_session(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id, doc_id, tables = _setup(client)
    enable_embed(monkeypatch)
    seen: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(engine.pool.checkedout())
        inputs = read_payload(request)["input"]
        return httpx2.Response(200, json=build_embed_body([vector_for(text) for text in inputs]))

    install_ai_transport(monkeypatch, handler)

    response = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])

    assert response.status_code == 200, response.text
    assert seen == [0]
    assert response.json()["status"] == "matched"


@pytest.mark.usefixtures("clean_sop", "clean_embedding_cache")
def test_embedding_failure_falls_back_to_tokens(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id, doc_id, tables = _setup(client)
    tokens_only = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE]).json()  # 임베딩이 꺼진 기본 환경
    enable_embed(monkeypatch)
    install_ai_transport(monkeypatch, lambda request: httpx2.Response(400, json={"error": "bad model"}))

    response = _get(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])

    assert response.status_code == 200, response.text
    assert response.json() == tokens_only


# --- 행 짝과 계획(D2-R4 · R5, AC2 · AC3) — S18 그대로. 한글 줄 마지막은 확정 삭제 ---

KO = [("5.1", "장비를 준비한다."), ("5.2", "시료 10 mL를 채취한다."), ("5.2.1", "채취 뒤 4 °C에 둔다."), (None, "(빈 칸)")]
EN = [("1", "Take 10 mL of sample."), ("2", "Prepare the equipment."), ("3", "Keep at 4 °C after."), ("4", "(blank)")]
# 뜻이 같은 글끼리 한 방향 — S18의 1↔시료 · 2↔장비 · 3↔4 °C. 그 밖의 글은 저마다 다른 방향
MEANINGS = [
    ("장비를 준비한다.", "Prepare the equipment."),
    ("시료 10 mL를 채취한다.", "Take 10 mL of sample."),
    ("채취 뒤 4 °C에 둔다.", "Keep at 4 °C after."),
]


def follow_lines(
    rows: list[tuple[str | None, str]], *, start: int, deleted: tuple[int, ...] = (), pieces: dict[int, tuple[str, ...]] | None = None
) -> list[FollowLine]:
    """(번호, 글) → 덩이 차례의 줄. 단위 id는 start부터, deleted · pieces는 줄 자리(0부터)."""
    pieces = pieces or {}
    return [
        FollowLine(unit_id=start + index, number=number, text=text, pieces=pieces.get(index, ()), deleted=index in deleted)
        for index, (number, text) in enumerate(rows)
    ]


def build_vectors() -> dict[str, np.ndarray]:
    texts = [text for pair in MEANINGS for text in pair] + [text for _, text in (*KO, *EN)]
    out: dict[str, np.ndarray] = {}
    size = len(texts) + len(MEANINGS)
    for index, pair in enumerate(MEANINGS):
        for text in pair:
            out[text] = np.eye(size, dtype=np.float32)[index]
    for index, text in enumerate(texts):
        out.setdefault(text, np.eye(size, dtype=np.float32)[len(MEANINGS) + index])
    return out


KO_LINES = follow_lines(KO, start=101, deleted=(3,))
EN_LINES = follow_lines(EN, start=1)
VECTORS = build_vectors()


def test_s18_row_pairs() -> None:
    assert match_rows(KO_LINES, EN_LINES, VECTORS) == [(0, 1), (1, 0), (2, 2), (3, 3)]


def test_s18_plan() -> None:
    plan = build_follow_plan(KO_LINES, EN_LINES, match_rows(KO_LINES, EN_LINES, VECTORS))

    assert plan is not None
    assert [(i.unit_ids, i.order, i.number, i.indent, i.delete) for i in plan] == [
        ((1,), 2, "5.2", False, False), ((2,), 1, "5.1", False, False), ((3,), None, "5.2.1", True, False),
        ((4,), None, None, False, True),
    ]


def test_rows_are_matched_by_content_not_place() -> None:
    reversed_lines = follow_lines(list(reversed(EN)), start=1)  # AC2 — 같은 글을 거꾸로 놓은 표

    assert match_rows(KO_LINES, reversed_lines, VECTORS) == [(0, 2), (1, 3), (2, 1), (3, 0)]


def test_other_row_count_has_no_rule_plan() -> None:
    assert build_follow_plan(KO_LINES, EN_LINES[:3], match_rows(KO_LINES, EN_LINES[:3], VECTORS)) is None


def test_without_embeddings_an_untied_row_means_no_rule_plan() -> None:
    assert build_follow_plan(KO_LINES, EN_LINES, match_rows(KO_LINES, EN_LINES, None)) is None  # 장비 ↔ equipment는 토큰이 없다


def test_merged_korean_lines_suggest_a_merge() -> None:
    korean = follow_lines(
        [("5.1", "장비를 준비한다. 시료 10 mL를 채취한다."), ("5.2", "채취 뒤 4 °C에 둔다.")], start=201,
        pieces={0: ("장비를 준비한다.", "시료 10 mL를 채취한다.")},
    )
    english = follow_lines(EN[1::-1] + [EN[2]], start=11)  # Prepare · Take · Keep

    plan = build_follow_plan(korean, english, match_rows(korean, english, VECTORS))

    assert plan is not None
    assert plan[0].unit_ids == (11, 12)
    assert [(item.number, item.order) for item in plan] == [("5.1", None), ("5.2", None)]


def test_an_already_deleted_english_line_is_not_deleted_again() -> None:
    english = follow_lines(EN, start=1, deleted=(3,))

    plan = build_follow_plan(KO_LINES, english, match_rows(KO_LINES, english, VECTORS))

    assert plan is not None and plan[3].delete is False and count_follow_items(plan) == 3


# --- 한글 표처럼 하기 API와 편집 하나(D2-R5~R8, AC3 · S18) — 위 한/영 따로 합성 문서의 작업 표 둘을 벗기고 한글 표를 손본다 ---

UNDO = {"session": "s1"}


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict, *, confirm: bool = False, undo: dict | None = None) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body: dict = {"revision": revision, "op": op, "confirm": confirm}
    if undo is not None:
        body["undo"] = undo
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def _read_lines(table_id: int) -> list[tuple[int, str | None, str]]:
    """벗긴 표의 덩이 줄(덩이 차례) — (단위, 번호, 번호를 뺀 내용)."""

    async def _run(session: AsyncSession) -> list[tuple[int, str | None, str]]:
        extraction_id = await session.scalar(select(SourceTable.extraction_id).where(SourceTable.id == table_id))
        units = await load_unwrapped_lines(session, extraction_id, table_id) or []
        return [(unit.id, get_number(unit), strip_number(unit.text, unit)) for unit in units]

    return run_in_session(_run)


def _is_deleted(unit_id: int) -> bool:
    async def _run(session: AsyncSession) -> bool:
        decision = await session.scalar(select(UnitDecision).where(UnitDecision.unit_id == unit_id))
        return decision is not None and (decision.disposition, decision.status) == ("delete", "confirmed")

    return run_in_session(_run)


def _count_suggestions(bundle_id: int) -> int:
    return run_in_session(lambda session: session.scalar(select(func.count()).select_from(AiSuggestion).where(AiSuggestion.bundle_id == bundle_id)))


def _bulk(client: TestClient, bundle_id: int, unit_id: int, action: str = "delete", **extra: str) -> None:
    body = {"action": action, "units": [{"unit_id": unit_id, "revision": 1}], **extra}
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _setup_unwrapped(client: TestClient) -> tuple[int, int, list[int], list[int], list[int]]:
    """작업 표 둘을 벗긴 문서 — (묶음, 문서, 표들, 한글 줄들, 영어 줄들)."""
    bundle_id, doc_id, tables = _setup(client)
    for table_index in (KO_STEPS_TABLE, EN_STEPS_TABLE):
        response = _edit(client, bundle_id, doc_id, {"type": "set_layout_table", "table_id": tables[table_index], "is_layout": True})
        assert response.status_code == 200, response.text
    korean = [unit_id for unit_id, _, _ in _read_lines(tables[KO_STEPS_TABLE])]
    english = [unit_id for unit_id, _, _ in _read_lines(tables[EN_STEPS_TABLE])]
    assert len(korean) == len(english) == 4
    return bundle_id, doc_id, tables, korean, english


def _work_korean(client: TestClient, bundle_id: int, doc_id: int, korean: list[int]) -> None:
    """S18의 손본 한글 표 — 5.1 · 5.2 · 5.2.1, 빈 칸 줄은 확정 삭제."""
    for unit_id, number in zip(korean, ("5.1", "5.2", "5.2.1"), strict=False):
        response = _edit(client, bundle_id, doc_id, {"type": "set_number", "unit_id": unit_id, "number": number, "follow": False})
        assert response.status_code == 200, response.text
    _bulk(client, bundle_id, korean[3])


def _install_meanings(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """임베딩을 켜고 S18의 뜻이 같은 글끼리 같은 벡터를 준다 — 돌려받은 리스트에 부른 경로가 쌓인다(채팅 호출이 없는지 본다)."""
    enable_embed(monkeypatch)
    paths: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        paths.append(request.url.path)
        return httpx2.Response(200, json=build_embed_body([VECTORS[text].tolist() if text in VECTORS else vector_for(text, len(VECTORS["(blank)"])) for text in read_payload(request)["input"]]))

    install_ai_transport(monkeypatch, handler)
    return paths


def _get_follow(client: TestClient, bundle_id: int, doc_id: int, table_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/tables/{table_id}/follow", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _to_op(table_id: int, follow: dict, only: tuple[int, ...] | None = None) -> dict:
    """GET follow의 답 → 편집 — 화면의 buildFollowOp와 같은 꼴(칩이 있는 일, 순서는 다 맞출 때만)."""
    items = [item for item in follow["items"] if only is None or item["unit_ids"][0] in only]
    ops = []
    for item in items:
        if not (len(item["unit_ids"]) > 1 or item["number"] or item["indent_shift"] is not None or item["delete"]):
            continue
        op: dict = {"unit_ids": item["unit_ids"]}
        if item["delete"]:
            op["delete"] = True
        if item["number"] is not None:
            op["number"] = item["number"]
        if item["indent_shift"] is not None:
            op["indent_shift"] = item["indent_shift"]
        ops.append(op)
    order = None
    if only is None and any(item["order"] is not None for item in follow["items"]):
        places = sorted(range(len(follow["items"])), key=lambda index: (follow["items"][index]["order"] or index + 1) - 1)
        order = [follow["items"][index]["unit_ids"][0] for index in places]
    return {"type": "follow_table", "table_id": table_id, "items": ops, "order": order}


@pytest.mark.usefixtures("clean_sop", "clean_embedding_cache")
def test_s18_apply_and_one_undo(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle_id, doc_id, tables, korean, english = _setup_unwrapped(client)
    _work_korean(client, bundle_id, doc_id, korean)
    paths = _install_meanings(monkeypatch)
    follow = _get_follow(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])
    assert (follow["mode"], follow["count"], follow["source_table_id"]) == ("rule", 4, tables[KO_STEPS_TABLE])
    assert follow["lines"] == english  # 영어 표의 지금 덩이 차례 — 하나씩 보기의 순서가 합치지 않은 꼬리 줄까지 싣는다
    assert [(item["unit_ids"], item["order"], item["number"], item["indent"], item["delete"]) for item in follow["items"]] == [
        ([english[0]], 2, "5.2", False, False), ([english[1]], 1, "5.1", False, False),
        ([english[2]], None, "5.2.1", True, False), ([english[3]], None, None, False, True),
    ]
    before = _dump(bundle_id)

    applied = _ok(_edit(client, bundle_id, doc_id, _to_op(tables[EN_STEPS_TABLE], follow), undo=UNDO))

    assert applied["disposed_unit_ids"] == [english[3]]
    # 삭제 줄은 지우기만 한다(번호를 함께 고치지 않는다 — FollowItemIn의 삭제는 다른 일과 함께 받지 않는다)
    assert [line[1:] for line in _read_lines(tables[EN_STEPS_TABLE])] == [
        ("5.1", "Prepare the equipment."), ("5.2", "Take 10 mL of sample."), ("5.2.1", "Keep at 4 °C after."), ("4", "(blank)"),
    ]
    assert _is_deleted(english[3])
    assert _count_suggestions(bundle_id) == 0 and all(path.endswith("/embeddings") for path in paths)  # 규칙 제안은 AI가 아니다(D2-R7)
    _ok(_undo(client, bundle_id))
    assert_same_state(_dump(bundle_id), before)
    _ok(_redo(client, bundle_id))
    assert _is_deleted(english[3])
    assert [line[1] for line in _read_lines(tables[EN_STEPS_TABLE])] == ["5.1", "5.2", "5.2.1", "4"]


@pytest.mark.usefixtures("clean_sop", "clean_embedding_cache")
def test_without_embeddings_untied_rows_go_to_ai(client: TestClient) -> None:
    bundle_id, doc_id, tables, korean, _ = _setup_unwrapped(client)
    _work_korean(client, bundle_id, doc_id, korean)

    follow = _get_follow(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])

    assert (follow["mode"], follow["items"], follow["count"]) == ("ai", [], 0)  # 장비 ↔ equipment는 토큰이 없다(정한 것 7)


@pytest.mark.usefixtures("clean_sop")
def test_follow_is_none_until_the_korean_table_was_worked_on(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, _ = _setup_unwrapped(client)

    follow = _get_follow(client, bundle_id, doc_id, tables[EN_STEPS_TABLE])

    assert (follow["mode"], follow["source_table_id"], follow["count"]) == ("none", tables[KO_STEPS_TABLE], 0)
    assert _get_follow(client, bundle_id, doc_id, tables[EN_TRAINING_TABLE])["mode"] == "none"  # 벗기지 않은 표


@pytest.mark.usefixtures("clean_sop")
def test_a_decided_line_asks_once(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, english = _setup_unwrapped(client)
    _bulk(client, bundle_id, english[3], "move_external", move_target_code="SOP-OTHER")
    op = {"type": "follow_table", "table_id": tables[EN_STEPS_TABLE], "items": [{"unit_ids": [english[3]], "delete": True}]}

    asked = _edit(client, bundle_id, doc_id, op, undo=UNDO)
    confirmed = _edit(client, bundle_id, doc_id, op, confirm=True, undo=UNDO)

    assert _code(asked) == (409, "confirm_required")
    assert confirmed.status_code == 200, confirmed.text
    assert _is_deleted(english[3])


@pytest.mark.usefixtures("clean_sop")
def test_one_item_alone_is_one_step(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, english = _setup_unwrapped(client)
    before = _dump(bundle_id)
    op = {"type": "follow_table", "table_id": tables[EN_STEPS_TABLE], "items": [{"unit_ids": [english[3]], "delete": True}], "order": None}

    result = _ok(_edit(client, bundle_id, doc_id, op, undo=UNDO))

    assert result["created_unit_ids"] == [] and _is_deleted(english[3])  # 편집은 비고 판단만 — 스냅숏 단계 하나
    assert result["disposed_unit_ids"] == [english[3]]  # 화면이 판단을 다시 받고 되돌리기 단추를 켠다(revision은 그대로)
    again = _ok(_edit(client, bundle_id, doc_id, op, undo=UNDO))
    assert "disposed_unit_ids" not in again  # 이미 지운 줄 — 아무것도 하지 않아 단계도 없다
    _ok(_undo(client, bundle_id))
    assert_same_state(_dump(bundle_id), before)


@pytest.mark.usefixtures("clean_sop")
def test_follow_merges_lines_in_one_edit_and_one_undo(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, english = _setup_unwrapped(client)
    before = _dump(bundle_id)
    op = {
        "type": "follow_table", "table_id": tables[EN_STEPS_TABLE],
        "items": [{"unit_ids": [english[1], english[0]], "number": "5.1"}, {"unit_ids": [english[2]], "number": "5.2"}],
        "order": [english[1], english[2], english[3]],
    }

    result = _ok(_edit(client, bundle_id, doc_id, op, undo=UNDO))

    lines = _read_lines(tables[EN_STEPS_TABLE])
    assert [line[1] for line in lines] == ["5.1", "5.2", "4"]
    assert lines[0][0] == result["created_unit_ids"][0] and "Prepare the equipment." in lines[0][2]
    _ok(_undo(client, bundle_id))
    after = _dump(bundle_id)
    # 합친 줄의 빈 판단 행은 편집 기록의 몫이라 되돌려도 은퇴한 단위와 함께 남는다(decision_steps.record_unit_edit_step) — 그것만 빼고 같다
    for unit_id in result["created_unit_ids"]:
        assert after["unit_decisions"].pop(str(unit_id))["disposition"] == "unassigned"
    assert_same_state(after, before)
    assert [line[1] for line in _read_lines(tables[EN_STEPS_TABLE])] == ["1", "2", "3", "4"]


@pytest.mark.usefixtures("clean_sop")
def test_items_outside_the_table_are_refused(client: TestClient) -> None:
    bundle_id, doc_id, tables, korean, english = _setup_unwrapped(client)
    outside = {"type": "follow_table", "table_id": tables[EN_STEPS_TABLE], "items": [{"unit_ids": [korean[0]], "number": "5.1"}]}
    short_order = {**outside, "items": [{"unit_ids": [english[0]], "number": "5.1"}], "order": english[:3]}

    assert _code(_edit(client, bundle_id, doc_id, outside)) == (422, "unwrap_lines_mismatch")
    assert _code(_edit(client, bundle_id, doc_id, short_order)) == (422, "unwrap_lines_mismatch")


@pytest.mark.usefixtures("clean_sop")
def test_delete_with_merge_in_one_item_is_refused(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, english = _setup_unwrapped(client)
    op = {"type": "follow_table", "table_id": tables[EN_STEPS_TABLE], "items": [{"unit_ids": english[2:], "delete": True}]}

    assert _code(_edit(client, bundle_id, doc_id, op)) == (422, "invalid_follow_item")


def test_a_reorder_only_korean_table_plans_order_only() -> None:
    korean = follow_lines([KO[1], KO[0], KO[2]], start=301)  # 한글 표는 순서만 바꿨다(번호는 영어 표와 같다) — 칩은 순서뿐
    english = follow_lines([("5.1", EN[1][1]), ("5.2", EN[0][1]), ("5.2.1", EN[2][1])], start=21)

    plan = build_follow_plan(korean, english, match_rows(korean, english, VECTORS))

    assert plan is not None
    assert [(item.unit_ids, item.order, item.number) for item in plan] == [((21,), 2, None), ((22,), 1, None), ((23,), None, None)]


@pytest.mark.usefixtures("clean_sop")
def test_an_order_only_follow_reorders_in_one_edit(client: TestClient) -> None:
    bundle_id, doc_id, tables, _, english = _setup_unwrapped(client)
    before = _dump(bundle_id)
    op = {"type": "follow_table", "table_id": tables[EN_STEPS_TABLE], "items": [{"unit_ids": [english[0]]}], "order": [english[1], english[0], *english[2:]]}

    result = _ok(_edit(client, bundle_id, doc_id, op, undo=UNDO))

    assert "disposed_unit_ids" not in result  # 삭제가 없는 편집의 응답은 전과 같은 꼴
    assert [line[0] for line in _read_lines(tables[EN_STEPS_TABLE])] == [english[1], english[0], *english[2:]]
    _ok(_undo(client, bundle_id))
    assert_same_state(_dump(bundle_id), before)
