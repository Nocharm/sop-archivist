"""To-Be 칸 후보(app.sop.ai.candidates) — 후보 만들기(N/A·WI 단계·match 제외), 임베딩 상위 K와 삭제, 임베딩 없음·실패 때의 글자 축소."""

import asyncio
from collections.abc import Sequence

import httpx2
import numpy as np
import pytest

from app.settings import settings
from app.sop.ai import embeddings
from app.sop.ai.candidates import DELETE_CANDIDATE, SLOT_GUIDE, Candidate, list_candidates, rank_candidates
from app.sop.ai.constants import AI_CALL_ATTEMPTS, CANDIDATE_TOP_K, MAX_TEXT_CANDIDATES
from app.sop.constants import SLOT_KEYS
from app.sop.snapshot import TargetDocInfo
from tests.ai_fixtures import clean_embedding_cache  # noqa: F401 -- 픽스처는 아래 usefixtures가 이름으로 찾는다
from tests.ai_helpers import enable_embed, install_ai_transport, install_embed_transport, vector_for

pytestmark = pytest.mark.usefixtures("clean_embedding_cache", "clean_ai_usage")

SOP_TITLE = "Synthetic SOP"
WI_TITLE = "Synthetic WI"
LOGIN_ID = "ops.member"


def _doc(
    doc_id: int,
    doc_type: str = "sop",
    *,
    title: str | None = None,
    parent_id: int | None = None,
    entrance: str = "assign",
    order_index: int | None = None,
    na_slots: dict[str, str] | None = None,
    steps: tuple[tuple[int, str], ...] = (),
) -> TargetDocInfo:
    """합성 새 문서 정보 — 제목·순서 열은 따로 주지 않으면 종류별 기본 제목과 id를 따른다."""
    return TargetDocInfo(
        id=doc_id,
        code=f"DOC-{doc_id}",
        title=title if title is not None else (SOP_TITLE if doc_type == "sop" else WI_TITLE),
        doc_type=doc_type,
        parent_id=parent_id,
        entrance=entrance,
        is_equipment_sop=False,
        order_index=doc_id if order_index is None else order_index,
        manual_order=False,
        na_slots=na_slots or {},
        steps=steps,
    )


def _slot_keys_of(candidates: Sequence[Candidate]) -> list[str | None]:
    return [candidate.slot_key for candidate in candidates]


def _rank(query: str, candidates: Sequence[Candidate]) -> tuple[list[Candidate], str]:
    return asyncio.run(rank_candidates(query, candidates, login_id=LOGIN_ID))


def _unit(text: str) -> np.ndarray:
    vector = np.asarray(vector_for(text))
    return vector / np.linalg.norm(vector)


def _fake_candidates(count: int) -> list[Candidate]:
    return [
        Candidate(f"c{index + 1}", 1, SLOT_KEYS[0], None, None, f"Synthetic doc {index + 1} / slot") for index in range(count)
    ]


@pytest.fixture(autouse=True)
def embed_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """기본은 임베딩 꺼짐 — 로컬 설정이 새도 같은 상태에서 시작하고, 켜는 시험만 enable_embed를 부른다."""
    monkeypatch.setattr(settings, "embed_enabled", False)


def test_slot_guide_covers_every_slot_key() -> None:
    assert set(SLOT_GUIDE) == set(SLOT_KEYS)


def test_candidates_list_every_sop_slot_with_a_label() -> None:
    candidates = list_candidates([_doc(1)])

    assert _slot_keys_of(candidates) == list(SLOT_KEYS)
    assert [candidate.key for candidate in candidates] == [f"c{index + 1}" for index in range(len(SLOT_KEYS))]
    assert all(candidate.target_doc_id == 1 and candidate.wi_step is None and candidate.wi_part is None for candidate in candidates)
    by_slot = {candidate.slot_key: candidate.label for candidate in candidates}
    assert by_slot["purpose"] == f"{SOP_TITLE} / Purpose: 절차가 필요한 이유, 관리 목적"
    assert by_slot["general_requirements.safety"] == f"{SOP_TITLE} / General Requirements > 안전(Safety)"  # 넣는 것이 비면 콜론이 없다


def test_candidates_skip_na_slots_and_their_children() -> None:
    sop = _doc(1, na_slots={"procedures": "합성 사유", "general_requirements.safety": "합성 사유"})

    slot_keys = _slot_keys_of(list_candidates([sop]))

    assert not any(key is not None and key.startswith("procedures") for key in slot_keys)  # 상위 칸 N/A는 하위 칸도 덮는다
    assert "general_requirements.safety" not in slot_keys
    assert "general_requirements" in slot_keys and "general_requirements.operation" in slot_keys  # 하위 칸 N/A는 상위를 덮지 않는다
    assert len(slot_keys) == len(SLOT_KEYS) - 5 - 1  # procedures와 하위 넷, 그리고 safety


def test_candidates_use_declared_wi_steps() -> None:
    sop = _doc(1, entrance="match")
    wi = _doc(2, "wi", parent_id=1, steps=((1, "전원 켜기"), (2, "시료 넣기")))

    candidates = list_candidates([sop, wi])

    assert [(c.wi_step, c.wi_part) for c in candidates] == [(1, "instruction"), (1, "why"), (2, "instruction"), (2, "why")]
    assert all(c.target_doc_id == 2 and c.slot_key is None for c in candidates)
    assert candidates[2].label == f"{WI_TITLE}({SOP_TITLE}) / 단계 2 시료 넣기 / Instruction"  # 부모 SOP는 match 문서여도 제목을 푼다
    assert candidates[3].label == f"{WI_TITLE}({SOP_TITLE}) / 단계 2 시료 넣기 / Why"


def test_wi_without_steps_offers_instruction_and_why() -> None:
    sop = _doc(1)
    wi = _doc(2, "wi", parent_id=1)

    candidates = [c for c in list_candidates([sop, wi]) if c.target_doc_id == 2]

    assert [(c.wi_step, c.wi_part) for c in candidates] == [(None, "instruction"), (None, "why")]
    assert [c.label for c in candidates] == [f"{WI_TITLE}({SOP_TITLE}) / Instruction", f"{WI_TITLE}({SOP_TITLE}) / Why"]


def test_wi_label_omits_a_parent_that_is_not_in_the_docs() -> None:
    wi = _doc(2, "wi", parent_id=99, steps=((1, ""),))

    labels = [candidate.label for candidate in list_candidates([wi])]

    assert labels == [f"{WI_TITLE} / 단계 1 / Instruction", f"{WI_TITLE} / 단계 1 / Why"]


def test_untitled_documents_are_labelled_by_their_code() -> None:
    # 제목은 비어 있을 수 있고(문서를 가르는 건 번호뿐) 빈 제목 둘이 같은 라벨을 만들면 LLM이 칸을 가릴 수 없다
    docs = [_doc(1, title=""), _doc(2, title=""), _doc(3, "wi", title="", parent_id=1)]

    candidates = list_candidates(docs)

    labels_of = {doc_id: [c.label for c in candidates if c.target_doc_id == doc_id] for doc_id in (1, 2, 3)}
    assert labels_of[1][0] == "DOC-1 / Purpose: 절차가 필요한 이유, 관리 목적"
    assert labels_of[2][0] == "DOC-2 / Purpose: 절차가 필요한 이유, 관리 목적"
    assert labels_of[3] == ["DOC-3(DOC-1) / Instruction", "DOC-3(DOC-1) / Why"]  # 부모 제목이 비어도 번호로 푼다
    labels = [candidate.label for candidate in candidates]
    assert len(set(labels)) == len(labels)  # 어느 두 후보도 라벨이 같지 않다


def test_match_documents_are_not_candidates() -> None:
    docs = [_doc(1, entrance="match"), _doc(2, "wi", entrance="match", parent_id=1), _doc(3)]

    candidates = list_candidates(docs)

    assert {candidate.target_doc_id for candidate in candidates} == {3}
    assert len(candidates) == len(SLOT_KEYS)


def test_candidate_keys_follow_document_order_not_input_order() -> None:
    first, second = _doc(1, order_index=2), _doc(2, "wi", order_index=1, parent_id=1)

    candidates = list_candidates(iter([first, second]))  # 한 번만 도는 반복자도 받는다

    assert [candidate.target_doc_id for candidate in candidates[:2]] == [2, 2]  # 순서 열이 앞선 WI가 먼저
    assert candidates[0].key == "c1" and candidates[-1].key == f"c{len(candidates)}"
    assert len({candidate.key for candidate in candidates}) == len(candidates)


def test_delete_candidate_has_no_destination() -> None:
    assert DELETE_CANDIDATE.key == "delete"
    assert (DELETE_CANDIDATE.target_doc_id, DELETE_CANDIDATE.slot_key, DELETE_CANDIDATE.wi_step, DELETE_CANDIDATE.wi_part) == (
        None,
        None,
        None,
        None,
    )


def test_rank_returns_top_three_plus_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_embed(monkeypatch)
    calls = install_embed_transport(monkeypatch)
    candidates = list_candidates([_doc(1)])
    query = "합성 장비의 전원을 켠다."

    ranked, retrieval = _rank(query, candidates)

    assert retrieval == "embedding"
    assert len(ranked) == CANDIDATE_TOP_K + 1 and ranked[-1] == DELETE_CANDIDATE
    # 기대 순서는 시험이 numpy로 따로 계산한다 — 점수가 높은 순, 같으면 목록 순
    scores = [float(_unit(query) @ _unit(candidate.label)) for candidate in candidates]
    expected = sorted(range(len(candidates)), key=lambda index: (-scores[index], index))[:CANDIDATE_TOP_K]
    assert ranked[:-1] == [candidates[index] for index in expected]
    assert len(calls) == 1 and set(calls[0]) == {query, *(c.label for c in candidates)}  # 질의와 칸을 한 번에 보낸다


def test_rank_breaks_embedding_ties_by_list_order(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_embed(monkeypatch)
    install_embed_transport(monkeypatch)
    candidates = _fake_candidates(5)
    twin = Candidate("c6", 1, SLOT_KEYS[1], None, None, candidates[3].label)  # 같은 글은 같은 벡터라 점수가 같다
    candidates.append(twin)

    ranked, retrieval = _rank(candidates[3].label, candidates)

    assert retrieval == "embedding"
    assert ranked[:2] == [candidates[3], twin]  # 점수 1.0이 둘이면 목록에서 앞선 쪽이 먼저


def test_rank_without_embeddings_returns_all_when_few() -> None:
    candidates = _fake_candidates(MAX_TEXT_CANDIDATES)

    ranked, retrieval = _rank("합성 질의", candidates)

    assert retrieval == "no_index"
    assert ranked == [*candidates, DELETE_CANDIDATE]  # 줄이지 않고 목록 순서 그대로


def test_rank_without_embeddings_narrows_by_text_when_many() -> None:
    # 앞의 후보는 글이 모두 같아 점수가 같고, 질의와 같은 글을 가진 후보 하나가 맨 뒤에 있다
    others = [Candidate(f"c{index + 1}", 1, SLOT_KEYS[0], None, None, "무관한 합성 라벨") for index in range(MAX_TEXT_CANDIDATES + 4)]
    target = Candidate("c25", 1, SLOT_KEYS[1], None, None, "합성 장비의 전원을 켜는 칸")
    candidates = [*others, target]

    ranked, retrieval = _rank(target.label, candidates)

    assert retrieval == "no_index"
    assert len(ranked) == MAX_TEXT_CANDIDATES + 1 and ranked[-1] == DELETE_CANDIDATE
    assert ranked[0] == target  # 가장 비슷한 후보가 먼저
    assert ranked[1:-1] == others[: MAX_TEXT_CANDIDATES - 1]  # 동점은 목록 순으로 앞쪽부터 채운다


def test_rank_falls_back_when_embedding_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_embed(monkeypatch)
    monkeypatch.setattr(embeddings, "AI_RETRY_DELAYS", (0.0,) * (AI_CALL_ATTEMPTS - 1))  # 재시도를 기다리지 않는다
    install_ai_transport(monkeypatch, lambda request: httpx2.Response(500))
    candidates = _fake_candidates(MAX_TEXT_CANDIDATES + 5)

    ranked, retrieval = _rank(candidates[-1].label, candidates)

    assert retrieval == "embedding_failed"  # 꺼짐(no_index)과 다른 상태다
    assert len(ranked) == MAX_TEXT_CANDIDATES + 1 and ranked[0] == candidates[-1] and ranked[-1] == DELETE_CANDIDATE


def test_rank_with_no_candidates_returns_only_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    enable_embed(monkeypatch)
    install_embed_transport(monkeypatch)

    assert _rank("합성 질의", []) == ([DELETE_CANDIDATE], "embedding")
