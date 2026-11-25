"""제목 ↔ 문장(F8b · 설계 2d) — 조항형 옛 SOP의 "제목 N수준" 조항을 문장으로 바꾸기, 조항마다 한/영 1:1 짝, 번호 물려받기,
편집 set_heading과 그 되돌리기·다시 하기."""

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import Extraction
from app.sop.numbering import NUMBER_PAIR, ClauseLine, find_inherited_numbers
from app.sop.segment import BlockView, build_unit_drafts, is_heading_like, suggest_interleaved_pairs
from app.sop.units import verify_document_coverage
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_style, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_SYN-HEADING-1_Clauses.docx"
# 회사 조항형 옛 SOP 꼴 — 영어 조항("제목 N수준") 다음 한글 번역("한글 제목 N수준")이 번갈아 온다(사례 2의 구조만, 글은 합성)
STYLES = "".join(
    make_style(style_id, name, outline=outline)
    for style_id, name, outline in (
        ("En2", "제목 2수준", 1), ("Ko2", "한글 제목 2수준", 1), ("En3", "제목 3수준", 2), ("Ko3", "한글 제목 3수준", 2),
    )
)
TITLE_EN, TITLE_KO = "5.2 Pre-cleaning", "5.2 사전 세척"
CLOSE_EN, CONFIRM_EN = "5.2.1 Close all drain valves.", "Confirm that the line pressure is released."
CLOSE_KO, CONFIRM_KO = "모든 배수 밸브를 닫는다.", "배관 압력이 빠졌는지 확인한다."
# 문장 하나지만 라벨 뒤 글이 길고 마침표로 끝난다 — 한글 번역은 짧아 혼자서는 제목답지만 앞 조항을 따라 바뀐다
FILL_EN = "5.2.2 Fill the tank with purified water and record the start time of the rinse cycle."
FILL_KO = "탱크에 정제수를 채우고 헹굼 시작 시각을 기록한다."
# 짝 없는 한글 조항 — 제 번호가 있다
LONE_KO, LONE_KO_TAIL = "5.2.3 배수 뒤 탱크 안을 눈으로 확인한다.", "이상이 있으면 보고한다."
BODY = (
    p(TITLE_EN, "En2") + p(TITLE_KO, "Ko2")
    + p(f"{CLOSE_EN} {CONFIRM_EN}", "En3") + p(f"{CLOSE_KO} {CONFIRM_KO}", "Ko3")
    + p(FILL_EN, "En3") + p(FILL_KO, "Ko3")
    + p(f"{LONE_KO} {LONE_KO_TAIL}", "Ko3")
)


def _setup(client: TestClient) -> tuple[int, int]:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(BODY, styles=STYLES), OLD_NAME)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    assert response.json()["language_layout"] == "ko_en_interleaved"
    return bundle_id, response.json()["id"]


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json={"revision": revision, "op": op}, headers=AUTHOR
    )


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _shape(view: dict) -> list[tuple[str, str, bool, str | None]]:
    """활성 단위의 (종류, 글, 바꾼 표시, 번호 칸 값) — 원문 순서."""
    return [
        (unit["kind"], unit["text"], unit["from_heading"], unit["number"]["value"] if unit["number"] else None)
        for unit in view["units"]
    ]


def _pairs(view: dict) -> set[frozenset[str]]:
    texts = {unit["id"]: unit["text"] for unit in view["units"]}
    return {frozenset(texts[unit_id] for unit_id in pair["unit_ids"]) for pair in view["pairs"]}


def _check_coverage(doc_id: int) -> None:
    async def _run(session: AsyncSession) -> None:
        await verify_document_coverage(session, doc_id)

    run_in_session(_run)


SHIFTED = [
    ("heading", TITLE_EN, False, "5.2"),
    ("heading", TITLE_KO, False, "5.2"),
    ("sentence", CLOSE_EN, True, "5.2.1"),
    ("sentence", CONFIRM_EN, True, None),
    ("sentence", CLOSE_KO, True, "5.2.1"),  # 번호 없는 번역의 첫 문장이 앞 영어 조항의 번호를 물려받는다
    ("sentence", CONFIRM_KO, True, None),
    ("sentence", FILL_EN, True, "5.2.2"),
    ("sentence", FILL_KO, True, "5.2.2"),
    ("sentence", LONE_KO, True, "5.2.3"),
    ("sentence", LONE_KO_TAIL, True, None),
]
SHIFTED_PAIRS = {
    frozenset({TITLE_EN, TITLE_KO}), frozenset({CLOSE_EN, CLOSE_KO}), frozenset({CONFIRM_EN, CONFIRM_KO}),
    frozenset({FILL_EN, FILL_KO}),
}


# --- 순수 규칙 ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("5.2 Pre-cleaning", True),
        ("1. Purpose", True),
        ("Chapter 1. Filter setup", True),
        ("Note.", True),
        ("5.2.1 Close all drain valves. Confirm that the line pressure is released.", False),  # 문장 끝 둘
        ("모든 배수 밸브를 닫는다. 배관 압력이 빠졌는지 확인한다.", False),
        (FILL_EN, False),  # 라벨 뒤 글이 60자를 넘고 마침표로 끝난다
        ("5.2.2 Fill the tank with purified water and record the start time of the rinse cycle", True),  # 마침표 없음
        (FILL_KO, True),  # 짧은 한 문장
    ],
)
def test_is_heading_like(text: str, expected: bool) -> None:
    assert is_heading_like(text) is expected


def _block(block_id: int, text: str, heading_level: int | None = 3) -> BlockView:
    return BlockView(block_id, block_id, "paragraph", "body", text, heading_level, (), None, None)


def test_drafts_shift_only_when_asked() -> None:
    """옛 문서만 바꾼다(shift_headings) — 끄면 지금처럼 블록 전체가 제목 하나다."""
    blocks = [_block(1, f"{CLOSE_EN} {CONFIRM_EN}"), _block(2, f"{CLOSE_KO} {CONFIRM_KO}"), _block(3, TITLE_EN)]

    shifted = build_unit_drafts(blocks, [], "ko_en_interleaved")
    kept = build_unit_drafts(blocks, [], "ko_en_interleaved", shift_headings=False)

    assert [(draft.kind, draft.from_heading) for draft in shifted] == [("sentence", True)] * 4 + [("heading", False)]
    assert [draft.kind for draft in kept] == ["heading"] * 3


def test_clause_runs_pair_sentence_by_sentence() -> None:
    """바꾼 조항은 조항마다 덩어리이고 문장 수가 같으면 1:1이다 — 짝 없는 한글 조항은 옆 조항 짝을 밀지 않는다."""
    units = [
        (1, "en", CLOSE_EN), (2, "en", CONFIRM_EN), (3, "ko", CLOSE_KO), (4, "ko", CONFIRM_KO),
        (5, "en", FILL_EN), (6, "ko", FILL_KO), (7, "ko", LONE_KO), (8, "ko", LONE_KO_TAIL),
    ]
    clauses = {1: 10, 2: 10, 3: 11, 4: 11, 5: 12, 6: 13, 7: 14, 8: 14}

    assert suggest_interleaved_pairs(units, "en_ko", clauses) == [([3], [1]), ([4], [2]), ([6], [5])]
    # 바꾼 표시가 없으면 지금처럼 덩어리 짝(2:2)이다
    assert suggest_interleaved_pairs(units[:4], "en_ko") == [([3, 4], [1, 2])]


def test_inherited_numbers_follow_the_previous_clause() -> None:
    lines = [
        ClauseLine(1, "en", "sentence", True, "5.2.1"), ClauseLine(1, "en", "sentence", True, None),
        ClauseLine(2, "ko", "sentence", True, None), ClauseLine(2, "ko", "sentence", True, None),
        ClauseLine(3, "ko", "sentence", True, "5.2.3"),  # 제 번호가 있다
        ClauseLine(4, "ko", "sentence", True, None),  # 앞 조항이 같은 언어 — 물려받지 않는다
        ClauseLine(6, "en", "sentence", True, None),  # 바로 앞 블록(5)이 없다
    ]

    assert find_inherited_numbers(lines) == {2: "5.2.1"}


# --- 올리기와 편집 ---


def test_upload_turns_clauses_into_sentence_pairs(client: TestClient) -> None:
    """제목답지 않은 조항은 문장 단위가 되고 조항마다 1:1 짝, 번역은 번호를 물려받는다. 진짜 제목은 그대로, 커버리지도 그대로."""
    bundle_id, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)

    assert _shape(view) == SHIFTED
    assert _pairs(view) == SHIFTED_PAIRS
    assert find_unit(view, CLOSE_KO)["number"]["source"] == NUMBER_PAIR
    # 물려받은 번호는 글자를 가리지 않는다 — 내용은 한글 글 전체다
    assert find_unit(view, CLOSE_KO)["number"]["content_start"] == 0
    assert find_unit(view, CLOSE_EN)["number"]["content_start"] == len("5.2.1 ")
    # 번호 없는 번역 조항은 제 글 전체가 아니라 앞 조항의 번호를 절 이름으로 잇는다(설계 2d)
    labels = [block["section_label"] for block in view["blocks"]]
    assert labels == ["5.2", "5.2", "5.2.1", "5.2.1", "5.2.2", "5.2.2", "5.2.3"]
    _check_coverage(doc_id)


def test_back_to_heading_is_one_edit_and_undoes(client: TestClient) -> None:
    """짝 줄 하나의 "제목으로 되돌리기"는 두 조항 줄을 통째로 제목으로 — 짝이 제목끼리 다시 서고, Ctrl+Z 한 번에 문장 짝으로 돌아온다."""
    bundle_id, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    row = [find_unit(view, CLOSE_EN)["id"], find_unit(view, CLOSE_KO)["id"]]
    before_ids = [unit["id"] for unit in view["units"]]

    response = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": row, "heading": True})
    assert response.status_code == 200, response.text
    back = get_view(client, bundle_id, doc_id)
    heading_en, heading_ko = f"{CLOSE_EN} {CONFIRM_EN}", f"{CLOSE_KO} {CONFIRM_KO}"
    assert _shape(back)[2:4] == [("heading", heading_en, False, "5.2.1"), ("heading", heading_ko, False, None)]
    assert len(response.json()["retired_unit_ids"]) == 4
    assert _pairs(back) == SHIFTED_PAIRS - {frozenset({CLOSE_EN, CLOSE_KO}), frozenset({CONFIRM_EN, CONFIRM_KO})} | {
        frozenset({heading_en, heading_ko})
    }
    _check_coverage(doc_id)

    _step(client, bundle_id, doc_id, "undo")
    undone = get_view(client, bundle_id, doc_id)
    assert _shape(undone) == SHIFTED
    assert [unit["id"] for unit in undone["units"]] == before_ids  # 되돌리기는 원래 ID로 되살린다
    assert _pairs(undone) == SHIFTED_PAIRS

    _step(client, bundle_id, doc_id, "redo")
    assert _shape(get_view(client, bundle_id, doc_id))[2:4] == _shape(back)[2:4]
    _check_coverage(doc_id)


def test_heading_to_sentence_and_back(client: TestClient) -> None:
    """진짜 제목도 사람이 문장으로 바꿀 수 있고(바꾼 표시가 붙는다) 제목으로 되돌리면 처음 모양이다. 맞지 않는 종류는 거절한다."""
    bundle_id, doc_id = _setup(client)
    view = get_view(client, bundle_id, doc_id)
    titles = [find_unit(view, TITLE_EN)["id"], find_unit(view, TITLE_KO)["id"]]

    refused = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": titles, "heading": True})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "heading_shift_kind")

    response = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": titles, "heading": False})
    assert response.status_code == 200, response.text
    shifted = get_view(client, bundle_id, doc_id)
    assert _shape(shifted)[:2] == [("sentence", TITLE_EN, True, "5.2"), ("sentence", TITLE_KO, True, "5.2")]
    assert frozenset({TITLE_EN, TITLE_KO}) in _pairs(shifted)

    sentence_id = find_unit(shifted, TITLE_EN)["id"]
    response = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": [sentence_id], "heading": True})
    assert response.status_code == 200, response.text
    assert _shape(get_view(client, bundle_id, doc_id))[0] == ("heading", TITLE_EN, False, "5.2")
    _check_coverage(doc_id)


MIXED = (
    "5.3 배출 밸브를 모두 닫는다. 닫힌 것을 확인한다. Close all drain valves. Confirm that they are closed."
)
MIXED_SENTENCES = {
    1: [
        ("5.3 배출 밸브를 모두 닫는다.", "ko"), ("닫힌 것을 확인한다.", "ko"), ("Close all drain valves.", "ko"),
        ("Confirm that they are closed.", "ko"),
    ],
    2: [
        ("5.3 배출 밸브를 모두 닫는다. 닫힌 것을 확인한다.", "ko"),
        ("Close all drain valves. Confirm that they are closed.", "en"),
    ],
}


def _set_split_rule(doc_id: int, rule: int) -> None:
    async def _run(session: AsyncSession) -> None:
        await session.execute(update(Extraction).where(Extraction.document_id == doc_id).values(split_rule=rule))
        await session.commit()

    run_in_session(_run)


@pytest.mark.parametrize("rule", [1, 2])
def test_heading_to_sentence_keeps_the_documents_rule(client: TestClient, rule: int) -> None:
    # 이미 올린 문서(규칙 1)는 편집으로 박스를 다시 만들어도 규칙 1 그대로다 — 언어도 전처럼 제목의 것을 잇는다
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(p(MIXED, "En2"), styles=STYLES), OLD_NAME)
    doc_id = response.json()["id"]
    _set_split_rule(doc_id, rule)
    sentences = [unit["id"] for unit in get_view(client, bundle_id, doc_id)["units"]]
    joined = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": sentences, "heading": True})
    assert joined.status_code == 200, joined.text
    heading = find_unit(get_view(client, bundle_id, doc_id), MIXED)

    response = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": [heading["id"]], "heading": False})

    assert response.status_code == 200, response.text
    view = get_view(client, bundle_id, doc_id)
    assert [(unit["text"], unit["lang"]) for unit in view["units"]] == MIXED_SENTENCES[rule]
    assert all(unit["from_heading"] for unit in view["units"])
    _check_coverage(doc_id)
    _step(client, bundle_id, doc_id, "undo")
    assert [(unit["kind"], unit["text"]) for unit in get_view(client, bundle_id, doc_id)["units"]] == [("heading", MIXED)]
    _step(client, bundle_id, doc_id, "redo")
    again = [unit["id"] for unit in get_view(client, bundle_id, doc_id)["units"]]
    back = _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": again[:1], "heading": True})
    assert back.status_code == 200, back.text
    assert [(unit["kind"], unit["text"]) for unit in get_view(client, bundle_id, doc_id)["units"]] == [("heading", MIXED)]
