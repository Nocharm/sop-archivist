"""한글 표 따라 하기 1 — 영어 표의 짝 한글 표를 꼴 + 토큰 + 뜻으로 고르고(11-23 명세 D2-R1 · R2), 애매하면 사람이 정한 것을 저장한다(R3).

표는 합성이다 — S18의 한글 표 3 · 영어 표 5(같은 토큰) · 영어 표 6(같은 꼴, 토큰 없음)을 본뜬다.
"""

import math

import httpx2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.db import engine
from app.sop.constants import TABLE_FOLLOW_THRESHOLD
from app.sop.counterparts import TableFacts
from app.sop.table_follow import FollowTable, list_counterpart_candidates, pick_counterpart, read_tokens, score_tables
from tests.ai_fixtures import clean_embedding_cache  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
from tests.ai_helpers import build_embed_body, enable_embed, install_ai_transport, read_payload, vector_for
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, get_view, set_members, upload


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
