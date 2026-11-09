"""한/영 따로 짝 제안 — 상호 최고 판정(순수), 요청 관문, 제안 짝 쓰기, 이미 짝인 단위, 배치 바꿈, 채택 기록, 호출 중 끼어든 편집, 임베딩만 쓰는 작업 (설계 §6.5, §7.11)."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, NamedTuple

import httpx2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop.ai import embeddings
from app.sop.ai.constants import AI_CALL_ATTEMPTS, PAIR_THRESHOLD
from app.sop.ai.matching import MatchItem
from app.sop.ai.pairing import propose_language_pairs
from app.sop.models import AiJob, AiSuggestion, Bundle, Unit, UnitPair, UnitPairMember
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_MEMBERS,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    edit_document,
    read_rows,
    request_pair,
    run_jobs,
    use_vectors,
)
from tests.ai_helpers import enable_embed
from tests.docx_factory import build_docx, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, find_unit, get_view, set_members, upload

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "clean_embedding_cache")

SEPARATE = "ko_en_separate"
PAIR_FILE = "SYNTHETIC_OLD-PAIR.docx"
KO = ["합성 장비의 전원을 켠다.", "합성 시료를 장비에 넣는다.", "합성 결과를 기록한다."]
EN = ["Turn on the synthetic instrument.", "Load the synthetic sample into the instrument.", "Record the synthetic result."]
AXES = {**{text: index for index, text in enumerate(KO)}, **{text: index for index, text in enumerate(EN)}}  # 짝끼리 같은 축
EXTRA_EN = "An extra synthetic sentence."  # 짝이 없는 영어 문장 — 짝 없이 남는다
HEADER_KO, HEADER_EN = "합성 문서의 머리말이다.", "This is the synthetic header."
FOOTER_EN = "This is the synthetic footer."
ADOPTION_KEYS = {"applied", "as_is", "edited", "rejected", "pending", "adoption_rate"}
CONTENT_KEYS = {"pair_id", "ko_unit_id", "en_unit_id"}


class PairBundle(NamedTuple):
    id: int
    document_id: int


def upload_document(
    client: TestClient, bundle_id: int, body: str, file_name: str = PAIR_FILE, layout: str = SEPARATE, **docx: Any
) -> PairBundle:
    """문서 하나를 올려 배치를 고른다 — 업로드가 탐지한 배치가 원하는 배치와 다르면 바꾼다(연달아 배치면 코드 짝이 생기고, 바꾸면 걷힌다). docx는 머리말·꼬리말 같은 build_docx 인자다."""
    uploaded = upload(client, bundle_id, build_docx(body, **docx), file_name)
    assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
    document = PairBundle(bundle_id, uploaded.json()["id"])
    if uploaded.json()["language_layout"] != layout:
        set_layout(client, document, layout)
    return document


def make_separate_bundle(
    client: TestClient,
    ko: list[str] | None = None,
    en: list[str] | None = None,
    layout: str = SEPARATE,
    table: list[list[str]] | None = None,
    **docx: Any,
) -> PairBundle:
    """한글 문장이 먼저, 영어 문장이 그 뒤에 따로 나오는 문서 하나(table이 있으면 끝에 표 하나)를 가진 묶음."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, AI_MEMBERS).status_code == 200
    body = "".join(p(text) for text in [*(KO if ko is None else ko), *(EN if en is None else en)])
    return upload_document(client, bundle_id, body + ("" if table is None else tbl(table)), layout=layout, **docx)


def set_layout(client: TestClient, bundle: PairBundle, layout: str) -> None:
    response = client.patch(
        f"/api/bundles/{bundle.id}/documents/{bundle.document_id}",
        json={"revision": get_revision(client, bundle), "language_layout": layout}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text


def get_revision(client: TestClient, bundle: PairBundle) -> int:
    return get_view(client, bundle.id, bundle.document_id)["document"]["revision"]


def get_unit_ids(client: TestClient, bundle: PairBundle, *texts: str) -> list[int]:
    view = get_view(client, bundle.id, bundle.document_id)
    return [find_unit(view, text)["id"] for text in texts]


def list_view_pairs(client: TestClient, bundle: PairBundle) -> list[dict]:
    return get_view(client, bundle.id, bundle.document_id)["pairs"]


def suggest_pairs(client: TestClient, bundle: PairBundle) -> None:
    response = request_pair(client, bundle.id, bundle.document_id)
    assert response.status_code == 200 and response.json()["queued"] == 1, response.text
    run_jobs()


def create_pair_by_hand(client: TestClient, bundle: PairBundle, unit_ids: list[int]) -> dict:
    response = client.post(
        f"/api/bundles/{bundle.id}/documents/{bundle.document_id}/pairs",
        json={"revision": get_revision(client, bundle), "unit_ids": unit_ids}, headers=AUTHOR,
    )
    assert response.status_code == 201, response.text
    return response.json()["pair"]


def confirm_pair_by_hand(client: TestClient, bundle: PairBundle, pair_id: int) -> httpx2.Response:
    return client.post(
        f"/api/bundles/{bundle.id}/documents/{bundle.document_id}/pairs/{pair_id}/confirm",
        json={"revision": get_revision(client, bundle)}, headers=AUTHOR,
    )


def delete_pair_by_hand(client: TestClient, bundle: PairBundle, pair_id: int) -> httpx2.Response:
    return client.delete(
        f"/api/bundles/{bundle.id}/documents/{bundle.document_id}/pairs/{pair_id}",
        params={"revision": get_revision(client, bundle)}, headers=AUTHOR,
    )


def read_pair_stats(client: TestClient, bundle: PairBundle) -> dict:
    stats = client.get(f"/api/bundles/{bundle.id}/ai/status", headers=AUTHOR).json()["adoption"]["pair"]
    assert set(stats) == ADOPTION_KEYS
    return stats


def read_pair_suggestions() -> dict[int, AiSuggestion]:
    """짝 id → 그 짝을 만든 제안."""
    return {row.content["pair_id"]: row for row in read_rows(AiSuggestion) if row.kind == "pair"}


def read_codes(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def change_once_during_embedding(ai: FakeAi, change: Callable[[], None]) -> None:
    """첫 임베딩 호출 안에서 한 번만 끼어든다 — 작업이 읽은 뒤이고 적용하기 전이다. 가짜 AI 훅은 실행기의 이벤트 루프 안에서 돌아 다른 스레드에서 기다린다."""
    embed = ai.embed
    done: list[bool] = []

    def embed_and_change(text: str) -> list[float]:
        if not done:
            done.append(True)
            with ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(change).result()
        return embed(text)

    ai.embed = embed_and_change


def item(item_id: int, lang: str, text: str = "") -> MatchItem:
    return MatchItem(id=item_id, lang=lang, kind="sentence", text=text)


# --- 상호 최고 판정(순수) ---


def test_mutual_best_pairs_only() -> None:
    kos = [item(1, "ko"), item(2, "ko"), item(3, "ko")]
    ens = [item(10, "en"), item(20, "en"), item(30, "en")]
    scores = np.array([
        [0.90, 0.20, 0.10],  # 1의 최고는 10이지만 10의 최고는 2다
        [0.95, 0.30, 0.10],
        [0.10, 0.20, 0.80],  # 3과 30은 서로 최고
    ])

    assert propose_language_pairs(kos, ens, scores, 0.7) == [(2, 10), (3, 30)]


def test_pairs_are_one_to_one() -> None:
    kos = [item(1, "ko"), item(2, "ko")]
    ens = [item(10, "en")]
    scores = np.array([[0.9], [0.8]])

    assert propose_language_pairs(kos, ens, scores, 0.7) == [(1, 10)]


def test_scores_below_the_threshold_make_no_pair_and_the_threshold_itself_does() -> None:
    kos, ens = [item(1, "ko"), item(2, "ko")], [item(10, "en"), item(20, "en")]
    scores = np.array([[0.7, 0.1], [0.1, 0.69]])

    assert propose_language_pairs(kos, ens, scores, 0.7) == [(1, 10)]


def test_ties_go_to_the_lowest_id_whatever_the_input_order() -> None:
    kos, ens = [item(2, "ko"), item(1, "ko")], [item(20, "en"), item(10, "en")]
    scores = np.full((2, 2), 0.9)

    assert propose_language_pairs(kos, ens, scores, 0.7) == [(1, 10)]


def test_result_does_not_depend_on_the_input_order() -> None:
    kos = [item(1, "ko"), item(2, "ko"), item(3, "ko")]
    ens = [item(10, "en"), item(20, "en"), item(30, "en")]
    scores = np.array([[0.9, 0.2, 0.1], [0.95, 0.3, 0.1], [0.1, 0.2, 0.8]])
    expected = propose_language_pairs(kos, ens, scores, 0.7)

    shuffled = propose_language_pairs(
        [kos[2], kos[0], kos[1]], [ens[1], ens[2], ens[0]], scores[np.ix_([2, 0, 1], [1, 2, 0])], 0.7
    )

    assert shuffled == expected


def test_an_empty_side_makes_no_pair() -> None:
    assert propose_language_pairs([], [item(10, "en")], np.zeros((0, 1)), 0.7) == []
    assert propose_language_pairs([item(1, "ko")], [], np.zeros((1, 0)), 0.7) == []


# --- 요청 ---


def test_pair_request_needs_embeddings(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM이 켜져 있어도 임베딩이 꺼져 있으면 쌓지 않는다 — 사람이 손으로 잇는다."""
    bundle = make_separate_bundle(client)
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_enabled", False)

    response = request_pair(client, bundle.id, bundle.document_id)

    assert read_codes(response) == (409, "embedding_disabled")
    assert read_rows(AiJob) == []


@pytest.mark.parametrize("layout", ["ko_en_interleaved", "en_only", "ko_only"])
def test_pair_request_needs_separate_layout(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch, layout: str
) -> None:
    bundle = make_separate_bundle(client, layout=layout)
    enable_embed(monkeypatch)

    response = request_pair(client, bundle.id, bundle.document_id)

    assert read_codes(response) == (409, "not_separate_layout")
    assert read_rows(AiJob) == []


def test_pair_request_queues_one_job_for_the_document(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    enable_embed(monkeypatch)

    response = request_pair(client, bundle.id, bundle.document_id)

    assert response.json() == {"queued": 1, "skipped_total": 0, "skipped": []}
    (job,) = read_rows(AiJob)
    assert (job.kind, job.status, job.document_id, job.unit_ids, job.target_ids, job.payload) == (
        "pair", "queued", bundle.document_id, [], [], {},
    )
    assert job.requested_by == AUTHOR["X-Dev-User"]


def test_active_pair_job_reports_already_queued(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    other = upload_document(client, bundle.id, p("합성 다른 문서의 문장이다.") + p("A sentence of another synthetic document."), "SYNTHETIC_OLD-PAIR-2.docx")
    enable_embed(monkeypatch)
    assert request_pair(client, bundle.id, bundle.document_id).json()["queued"] == 1

    again = request_pair(client, bundle.id, bundle.document_id).json()
    other_document = request_pair(client, other.id, other.document_id).json()

    assert again == {"queued": 0, "skipped_total": 1, "skipped": [{"unit_id": 0, "reason": "already_queued"}]}
    assert other_document["queued"] == 1  # 문서마다 하나다
    assert len(read_rows(AiJob)) == 2


def test_pair_request_needs_an_author_an_editable_bundle_and_this_bundles_document(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    other = make_separate_bundle(client)
    enable_embed(monkeypatch)

    assert request_pair(client, bundle.id, bundle.document_id, headers=REVIEWER).status_code == 403
    assert read_codes(request_pair(client, bundle.id, 999_999)) == (404, "document_not_found")
    assert read_codes(request_pair(client, bundle.id, other.document_id)) == (404, "document_not_found")
    assert client.post(f"/api/bundles/{bundle.id}/ai/pair", json={}, headers=AUTHOR).status_code == 422

    async def _set_in_review(session: AsyncSession) -> None:
        await session.execute(update(Bundle).where(Bundle.id == bundle.id).values(status="in_review"))
        await session.commit()

    run_in_session(_set_in_review)
    assert read_codes(request_pair(client, bundle.id, bundle.document_id)) == (409, "bundle_not_editable")
    assert read_rows(AiJob) == []


# --- 제안 짝 쓰기 ---


def test_suggested_pairs_are_written_with_source_ai(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    assert list_view_pairs(client, bundle) == []  # 따로 배치로 바꾸면 연달아 코드 짝이 걷힌다

    suggest_pairs(client, bundle)

    ko_ids, en_ids = get_unit_ids(client, bundle, *KO), get_unit_ids(client, bundle, *EN)
    pairs = list_view_pairs(client, bundle)
    assert [(pair["status"], pair["source"], pair["unit_ids"]) for pair in pairs] == [
        ("suggested", "ai", [ko, en]) for ko, en in zip(ko_ids, en_ids, strict=True)
    ]
    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("done", "")
    suggestions = read_pair_suggestions()
    assert set(suggestions) == {pair["id"] for pair in pairs}
    for pair, ko, en in zip(pairs, ko_ids, en_ids, strict=True):
        suggestion = suggestions[pair["id"]]
        assert suggestion.content == {"pair_id": pair["id"], "ko_unit_id": ko, "en_unit_id": en}
        assert (suggestion.job_id, suggestion.kind, suggestion.document_id) == (job.id, "pair", bundle.document_id)
        assert (suggestion.result, suggestion.adoption, suggestion.warnings, suggestion.model) == ("applied", None, [], "")
        assert suggestion.input_refs["extraction_id"] > 0
    assert {row.suggestion_id for row in read_rows(UnitPair)} == {suggestion.id for suggestion in suggestions.values()}


def test_ai_pairs_show_in_the_unit_lists(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """화면이 읽는 두 목록 — 문서 보기와 단위 목록 — 에 AI 제안 짝의 id가 실린다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)

    suggest_pairs(client, bundle)

    pair_of = {unit_id: pair["id"] for pair in list_view_pairs(client, bundle) for unit_id in pair["unit_ids"]}
    assert len(pair_of) == 6
    view_units = get_view(client, bundle.id, bundle.document_id)["units"]
    assert {unit["id"]: unit["pair_id"] for unit in view_units} == pair_of
    listed = client.get(
        f"/api/bundles/{bundle.id}/units", params={"document_id": bundle.document_id, "limit": 1000}, headers=AUTHOR
    )
    assert listed.status_code == 200, listed.text
    assert {unit["unit_id"]: unit["pair_id"] for unit in listed.json()["items"]} == pair_of


def test_scores_are_not_stored_or_shown(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)

    suggest_pairs(client, bundle)

    body = client.get(f"/api/bundles/{bundle.id}/ai/suggestions", params={"kind": "pair"}, headers=AUTHOR).json()
    assert body["total"] == 3
    assert all(set(entry["content"]) == CONTENT_KEYS for entry in body["items"])
    assert "score" not in str(body)
    (job,) = read_rows(AiJob)
    assert (job.payload, job.input_snapshot) == ({}, {})


def test_the_embedding_threshold_decides_which_pairs_are_suggested(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """코사인 0.6은 PAIR_THRESHOLD 아래이고 0.8은 위다."""
    assert 0.6 < PAIR_THRESHOLD < 0.8
    bundle = make_separate_bundle(client, KO[:2], EN[:2])
    enable_embed(monkeypatch)
    vectors = {  # 서로 직교하는 축이라 짝끼리의 점수만 남는다
        KO[0]: [1.0, 0.0, 0.0], EN[0]: [0.6, 0.8, 0.0], KO[1]: [0.0, 0.0, 1.0], EN[1]: [0.0, 0.6, 0.8],
    }
    fake_ai.embed = lambda text: vectors[text]

    suggest_pairs(client, bundle)

    (pair,) = list_view_pairs(client, bundle)
    assert pair["unit_ids"] == get_unit_ids(client, bundle, KO[1], EN[1])


def test_units_already_paired_are_left_alone(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """이미 짝인 단위는 후보가 아니다 — 후보에 두면 짝이 있는 영어 문장이 다른 한글 문장의 최고가 되어 그 짝을 막는다."""
    bundle = make_separate_bundle(client, KO[:2], EN[:2])
    enable_embed(monkeypatch)
    vectors = {KO[0]: [1.0, 0.0], EN[0]: [1.0, 0.0], KO[1]: [0.9, 0.436], EN[1]: [0.6, 0.8]}  # KO[1]은 EN[0]이 EN[1]보다 가깝다
    fake_ai.embed = lambda text: vectors[text]
    ko_0, ko_1, en_0, en_1 = get_unit_ids(client, bundle, KO[0], KO[1], EN[0], EN[1])
    by_hand = create_pair_by_hand(client, bundle, [ko_0, en_0])

    suggest_pairs(client, bundle)

    human, suggested = list_view_pairs(client, bundle)
    assert (human["id"], human["status"], human["source"], human["unit_ids"]) == (by_hand["id"], "confirmed", "human", [ko_0, en_0])
    assert (suggested["status"], suggested["source"], suggested["unit_ids"]) == ("suggested", "ai", [ko_1, en_1])
    assert [row.suggestion_id for row in read_rows(UnitPair) if row.id == human["id"]] == [None]


def test_table_cell_sentences_are_not_candidates(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """표·행에 묶인 칸 문장은 표의 판단을 따른다 — 코드 짝처럼 뺀다."""
    bundle = make_separate_bundle(client, KO[:1], EN[:1], table=[[KO[1], EN[1]]])
    use_vectors(monkeypatch, fake_ai, AXES)
    view = get_view(client, bundle.id, bundle.document_id)
    cells = [find_unit(view, text) for text in (KO[1], EN[1])]
    assert [cell["kind"] for cell in cells] == ["cell_sentence", "cell_sentence"] and cells[0]["group_unit_id"] is not None

    suggest_pairs(client, bundle)

    (pair,) = list_view_pairs(client, bundle)
    assert pair["unit_ids"] == get_unit_ids(client, bundle, KO[0], EN[0])


def test_pairs_stay_within_one_part(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """본문 문장은 꼬리말 문장과 짝지어지지 않는다 — 부분이 다르면 가장 가까워도 후보가 아니고, 같은 부분의 짝을 가리지도 않는다."""
    bundle = make_separate_bundle(
        client, KO[:1], EN[:1], headers=[p(HEADER_KO) + p(HEADER_EN)], footers=[p(FOOTER_EN)]
    )
    enable_embed(monkeypatch)
    vectors = {  # 본문 한글 KO[0]은 본문 영어 EN[0](0.8)보다 꼬리말 영어(0.9)에 더 가깝다
        KO[0]: [1.0, 0.0, 0.0, 0.0], EN[0]: [0.8, 0.6, 0.0, 0.0], FOOTER_EN: [0.9, 0.0, 0.436, 0.0],
        HEADER_KO: [0.0, 0.0, 0.0, 1.0], HEADER_EN: [0.0, 0.0, 0.0, 1.0],
    }
    fake_ai.embed = lambda text: vectors[text]

    suggest_pairs(client, bundle)

    ko_0, en_0, header_ko, header_en, footer = get_unit_ids(client, bundle, KO[0], EN[0], HEADER_KO, HEADER_EN, FOOTER_EN)
    assert sorted(pair["unit_ids"] for pair in list_view_pairs(client, bundle)) == sorted([[ko_0, en_0], [header_ko, header_en]])
    assert footer not in {row.unit_id for row in read_rows(UnitPairMember)}


def test_pairs_cross_table_boundaries(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """한글 표의 칸과 영어 표의 칸이 짝인 배치가 있어 표 경계는 넘는다(부분만 지킨다)."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert set_members(client, bundle_id, AI_MEMBERS).status_code == 200
    body = tbl([[KO[0]]]) + p(KO[1]) + tbl([[EN[0]]]) + p(EN[1])
    bundle = upload_document(client, bundle_id, body, layout="ko_en_interleaved")
    for table in get_view(client, bundle.id, bundle.document_id)["tables"]:
        edit_document(client, bundle.id, bundle.document_id, {"type": "set_layout_table", "table_id": table["id"], "is_layout": True})
    set_layout(client, bundle, SEPARATE)
    use_vectors(monkeypatch, fake_ai, AXES)

    suggest_pairs(client, bundle)

    ko_cell, ko_1, en_cell, en_1 = get_unit_ids(client, bundle, KO[0], KO[1], EN[0], EN[1])
    assert sorted(pair["unit_ids"] for pair in list_view_pairs(client, bundle)) == sorted([[ko_cell, en_cell], [ko_1, en_1]])


def test_rerun_leaves_existing_pairs_alone(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    suggest_pairs(client, bundle)
    first = list_view_pairs(client, bundle)

    suggest_pairs(client, bundle)

    assert list_view_pairs(client, bundle) == first
    assert len(read_pair_suggestions()) == 3
    assert [row.status for row in read_rows(AiJob)] == ["done", "done"]


def test_layout_change_keeps_ai_pairs(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """배치를 바꿔도 refresh_code_pairs는 코드 짝만 지운다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    suggest_pairs(client, bundle)
    before = list_view_pairs(client, bundle)

    set_layout(client, bundle, "ko_en_interleaved")

    assert list_view_pairs(client, bundle) == before
    assert {pair["source"] for pair in before} == {"ai"}
    set_layout(client, bundle, "ko_only")
    assert list_view_pairs(client, bundle) == before


def test_blank_text_units_are_left_out(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """글자가 없는 단위는 임베딩에 보내지 않고 짝도 짓지 않는다 — 빈 글을 보내면 서버가 거절해 문서 전체가 임베딩을 잃을 수 있다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    sent: list[str] = []
    embed = fake_ai.embed
    fake_ai.embed = lambda text: (sent.append(text), embed(text))[1]
    blank, other = get_unit_ids(client, bundle, KO[0], EN[0])

    async def _blank_out(session: AsyncSession) -> None:
        await session.execute(update(Unit).where(Unit.id == blank).values(text=""))
        await session.commit()

    run_in_session(_blank_out)

    suggest_pairs(client, bundle)

    assert "" not in sent and KO[0] not in sent
    members = {row.unit_id for row in read_rows(UnitPairMember)}
    assert blank not in members and other not in members  # 빈 단위의 짝이 될 뻔한 영어 문장도 남는다
    assert len(read_rows(UnitPair)) == 2


# --- 채택 ---


def test_confirm_records_as_is_and_delete_records_rejected(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    suggest_pairs(client, bundle)
    first, second, third = list_view_pairs(client, bundle)
    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 0, "edited": 0, "rejected": 0, "pending": 3, "adoption_rate": None,
    }

    confirmed = confirm_pair_by_hand(client, bundle, first["id"])

    assert confirmed.status_code == 200, confirmed.text
    assert (confirmed.json()["pair"]["status"], confirmed.json()["pair"]["source"]) == ("confirmed", "ai")
    accepted = read_pair_suggestions()[first["id"]]
    assert (accepted.adoption, accepted.adopted_by, accepted.result) == ("as_is", AUTHOR["X-Dev-User"], "applied")
    assert accepted.adopted_at is not None
    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 1, "edited": 0, "rejected": 0, "pending": 2, "adoption_rate": 1.0,
    }

    deleted = delete_pair_by_hand(client, bundle, second["id"])

    assert deleted.status_code == 200, deleted.text
    rejected = read_pair_suggestions()[second["id"]]  # 짝 행이 지워져도 제안과 채택은 남는다
    assert (rejected.adoption, rejected.adopted_by, rejected.result) == ("rejected", AUTHOR["X-Dev-User"], "applied")
    assert second["id"] not in {row.id for row in read_rows(UnitPair)}
    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 1, "edited": 0, "rejected": 1, "pending": 1, "adoption_rate": 0.5,
    }

    # 처음 정한 판정이 남는다 — 확정한 짝을 풀어도, 확정을 다시 눌러도 바뀌지 않는다
    assert delete_pair_by_hand(client, bundle, first["id"]).status_code == 200
    assert read_pair_suggestions()[first["id"]].adoption == "as_is"
    assert confirm_pair_by_hand(client, bundle, third["id"]).status_code == 200
    assert confirm_pair_by_hand(client, bundle, third["id"]).status_code == 200
    assert read_pair_stats(client, bundle)["as_is"] == 2


def test_hand_made_and_code_pairs_record_no_adoption(client: TestClient) -> None:
    """제안이 없는 짝(사람이 만든 것, 코드가 제안한 것)을 확정하거나 풀어도 채택 기록은 생기지 않는다."""
    bundle = make_separate_bundle(client, layout="ko_en_interleaved")
    (code_pair,) = list_view_pairs(client, bundle)
    assert code_pair["source"] == "code"
    assert confirm_pair_by_hand(client, bundle, code_pair["id"]).status_code == 200
    assert delete_pair_by_hand(client, bundle, code_pair["id"]).status_code == 200
    ko_0, en_0 = get_unit_ids(client, bundle, KO[0], EN[0])
    by_hand = create_pair_by_hand(client, bundle, [ko_0, en_0])
    assert delete_pair_by_hand(client, bundle, by_hand["id"]).status_code == 200

    assert read_rows(AiSuggestion) == []


def test_replacing_an_ai_pair_by_hand_records_rejected_and_the_same_set_records_as_is(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """사람이 만든 짝이 AI 제안 짝을 바꾸면 채택이 남는다 — 같은 단위 집합이면 그대로, 다르면 버림이다."""
    bundle = make_separate_bundle(client, en=[*EN, EXTRA_EN])
    use_vectors(monkeypatch, fake_ai, {**AXES, EXTRA_EN: 6})
    suggest_pairs(client, bundle)
    first, second, third = list_view_pairs(client, bundle)
    ko_0, en_0, extra = get_unit_ids(client, bundle, KO[0], EN[0], EXTRA_EN)
    assert first["unit_ids"] == [ko_0, en_0] and extra not in {unit for pair in (first, second, third) for unit in pair["unit_ids"]}

    widened = create_pair_by_hand(client, bundle, [ko_0, en_0, extra])  # 첫 제안 짝의 한 단위를 포함하되 집합이 다르다

    assert widened["unit_ids"] == [ko_0, en_0, extra]
    changed = read_pair_suggestions()[first["id"]]
    assert (changed.adoption, changed.adopted_by, changed.result) == ("rejected", AUTHOR["X-Dev-User"], "applied")
    assert first["id"] not in {row.id for row in read_rows(UnitPair)}
    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 0, "edited": 0, "rejected": 1, "pending": 2, "adoption_rate": 0.0,
    }

    again = create_pair_by_hand(client, bundle, second["unit_ids"])  # 같은 집합으로 다시 만든다

    assert (again["status"], again["source"], again["unit_ids"]) == ("confirmed", "human", second["unit_ids"])
    kept = read_pair_suggestions()[second["id"]]
    assert (kept.adoption, kept.adopted_by) == ("as_is", AUTHOR["X-Dev-User"])
    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 1, "edited": 0, "rejected": 1, "pending": 1, "adoption_rate": 0.5,
    }


def test_replacing_a_pair_records_one_decision_per_replaced_ai_pair(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """한 번에 AI 제안 짝 둘을 바꾸면 둘 다 버림이다 — 이미 채택된 제안은 그대로다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    suggest_pairs(client, bundle)
    first, second, third = list_view_pairs(client, bundle)
    assert confirm_pair_by_hand(client, bundle, third["id"]).status_code == 200
    (ko_0, en_0), (ko_1, en_1) = first["unit_ids"], second["unit_ids"]

    created = create_pair_by_hand(client, bundle, [ko_0, en_1])  # 두 제안 짝에서 한 단위씩

    assert created["unit_ids"] == [ko_0, en_1]
    suggestions = read_pair_suggestions()
    assert [suggestions[pair["id"]].adoption for pair in (first, second, third)] == ["rejected", "rejected", "as_is"]
    assert {row.unit_id for row in read_rows(UnitPairMember)}.isdisjoint({ko_1, en_0})  # 짝 상대를 잃은 단위는 짝 없이 남는다


def test_a_pair_that_lost_its_unit_is_not_pending_and_keeps_no_adoption(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """단위가 은퇴해 짝이 사라지면 그 제안은 아무도 정할 수 없다 — 영영 줄지 않는 대기로 세지 않는다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    suggest_pairs(client, bundle)
    (ko_0,) = get_unit_ids(client, bundle, KO[0])
    edit_document(client, bundle.id, bundle.document_id, {"type": "split", "unit_id": ko_0, "at": 5})

    assert read_pair_stats(client, bundle) == {
        "applied": 3, "as_is": 0, "edited": 0, "rejected": 0, "pending": 2, "adoption_rate": None,
    }
    assert [row.adoption for row in read_rows(AiSuggestion)] == [None, None, None]


# --- 호출 중 끼어든 편집 ---


def test_pair_edited_during_call_is_skipped(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    """사람이 호출 중에 한 단위를 다른 짝으로 묶으면, 그 단위가 든 제안은 둘 다 건너뛰고 나머지는 그대로 쓴다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    ko_0, ko_1, ko_2, en_0, en_1, en_2 = get_unit_ids(client, bundle, KO[0], KO[1], KO[2], EN[0], EN[1], EN[2])
    change_once_during_embedding(fake_ai, lambda: create_pair_by_hand(client, bundle, [ko_0, en_1]))

    suggest_pairs(client, bundle)

    by_hand, suggested = list_view_pairs(client, bundle)
    assert (by_hand["status"], by_hand["source"], by_hand["unit_ids"]) == ("confirmed", "human", [ko_0, en_1])
    assert (suggested["source"], suggested["unit_ids"]) == ("ai", [ko_2, en_2])
    assert {row.unit_id for row in read_rows(UnitPairMember)}.isdisjoint({ko_1, en_0})  # 짝 상대를 잃은 단위는 짝 없이 남는다
    (job,) = read_rows(AiJob)
    assert job.status == "done"
    assert len(read_pair_suggestions()) == 1


def test_retired_unit_during_call_is_skipped(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    (ko_0,) = get_unit_ids(client, bundle, KO[0])
    change_once_during_embedding(
        fake_ai, lambda: edit_document(client, bundle.id, bundle.document_id, {"type": "split", "unit_id": ko_0, "at": 5})
    )

    suggest_pairs(client, bundle)

    pairs = list_view_pairs(client, bundle)
    assert [pair["unit_ids"] for pair in pairs] == [
        get_unit_ids(client, bundle, KO[1], EN[1]), get_unit_ids(client, bundle, KO[2], EN[2]),
    ]
    assert len(read_pair_suggestions()) == 2


def test_language_change_during_call_skips_the_pair(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """언어 고치기는 단위 id를 그대로 두므로 글·언어까지 다시 본다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    (ko_0,) = get_unit_ids(client, bundle, KO[0])
    change_once_during_embedding(
        fake_ai,
        lambda: edit_document(
            client, bundle.id, bundle.document_id, {"type": "set_language", "unit_ids": [ko_0], "lang": "en"}
        ),
    )

    suggest_pairs(client, bundle)

    assert [pair["unit_ids"] for pair in list_view_pairs(client, bundle)] == [
        get_unit_ids(client, bundle, KO[1], EN[1]), get_unit_ids(client, bundle, KO[2], EN[2]),
    ]


def test_document_deleted_during_call_makes_the_job_stale(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)

    def delete_document() -> None:
        response = client.delete(
            f"/api/bundles/{bundle.id}/documents/{bundle.document_id}",
            params={"revision": get_revision(client, bundle)}, headers=AUTHOR,
        )
        assert response.status_code == 204, response.text

    change_once_during_embedding(fake_ai, delete_document)

    suggest_pairs(client, bundle)

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("stale", "")
    assert read_rows(AiSuggestion) == [] and read_rows(UnitPair) == []


def test_layout_change_during_call_makes_the_job_stale(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    change_once_during_embedding(fake_ai, lambda: set_layout(client, bundle, "ko_en_interleaved"))

    suggest_pairs(client, bundle)

    (job,) = read_rows(AiJob)
    assert job.status == "stale"
    assert read_pair_suggestions() == {}
    assert {pair["source"] for pair in list_view_pairs(client, bundle)} == {"code"}


# --- 임베딩만 쓰는 작업 ---


def test_pair_job_works_with_ai_off_when_embeddings_on(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """LLM 없이 임베딩만 쓴다 — 채팅이 꺼져 있어도, 지침·프롬프트 없이도 짝을 낸다."""
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    monkeypatch.setattr(settings, "ai_enabled", False)
    fake_ai.chat = lambda data: pytest.fail("a pair job must not call the LLM")

    response = request_pair(client, bundle.id, bundle.document_id)
    run_jobs()

    assert response.json()["queued"] == 1
    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("done", "")
    assert len(list_view_pairs(client, bundle)) == 3
    assert fake_ai.requests == [] and fake_ai.bodies == []


def test_embedding_failure_fails_the_job_as_connection(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    enable_embed(monkeypatch)
    monkeypatch.setattr(embeddings, "AI_RETRY_DELAYS", (0.0,) * (AI_CALL_ATTEMPTS - 1))  # 재시도를 기다리지 않는다

    def fail(text: str) -> list[float]:
        raise httpx2.ConnectError("embedding server is down")

    fake_ai.embed = fail

    suggest_pairs(client, bundle)

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("failed", "connection")
    assert list_view_pairs(client, bundle) == []
    assert read_rows(AiSuggestion) == []
    status = client.get(f"/api/bundles/{bundle.id}/ai/status", headers=AUTHOR).json()
    assert status["failed_errors"] == {"connection": 1}


def test_failed_pair_job_is_retried_through_the_generic_retry(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    monkeypatch.setattr(embeddings, "AI_RETRY_DELAYS", (0.0,) * (AI_CALL_ATTEMPTS - 1))
    working = fake_ai.embed

    def fail(text: str) -> list[float]:
        raise httpx2.ConnectError("embedding server is down")

    fake_ai.embed = fail
    suggest_pairs(client, bundle)
    assert [job.status for job in read_rows(AiJob)] == ["failed"]
    fake_ai.embed = working

    retried = client.post(f"/api/bundles/{bundle.id}/ai/retry", json={"kind": "pair"}, headers=AUTHOR)
    run_jobs()

    assert retried.json() == {"queued": 1}
    assert [(job.status, job.error) for job in read_rows(AiJob)] == [("done", "")]
    assert len(list_view_pairs(client, bundle)) == 3


def test_embeddings_turned_off_after_the_request_fail_the_job_as_config(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = make_separate_bundle(client)
    use_vectors(monkeypatch, fake_ai, AXES)
    assert request_pair(client, bundle.id, bundle.document_id).json()["queued"] == 1
    monkeypatch.setattr(settings, "embed_enabled", False)

    run_jobs()

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("failed", "config")


def test_a_document_with_nothing_to_pair_ends_done_without_calling_embeddings(
    client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch
) -> None:
    """한쪽 언어뿐이면 짝지을 것이 없다 — 임베딩 호출 없이 끝난다."""
    bundle = make_separate_bundle(client, KO, [])
    enable_embed(monkeypatch)
    fake_ai.embed = lambda text: pytest.fail("nothing to pair, nothing to embed")

    suggest_pairs(client, bundle)

    (job,) = read_rows(AiJob)
    assert (job.status, job.error) == ("done", "")
    assert read_rows(AiSuggestion) == []
