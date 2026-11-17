"""scripts.seed_sop_worst의 참조 지도용 묶음 계획(M1~M8) — 앱을 부르지 않고 계획만 본다(시드 전체는 수 분이라 손으로 돌린다)."""

from collections import Counter

from app.sop.refs import find_leading_number, is_document_number
from app.sop.tobe import is_temp_match_code
from scripts.seed_sop_worst import (
    MAP_FREE_MOVE,
    MAP_HUB,
    MAP_LONG_CODE,
    MAP_MISSING,
    MAP_TEMP_CODE,
    build_map_doc_codes,
    build_map_plan,
)


def test_map_plan_has_eight_bundles_of_thirteen_documents() -> None:
    plan = build_map_plan()

    assert [spec.title.split(" map")[0] for spec in plan] == [f"SYNTHETIC M{n}" for n in range(1, 9)]
    assert [len(spec.docs) for spec in plan] == [13] * 8
    assert [spec.members for spec in plan] == (
        [(("qa.member", "author"), ("qa.lead", "reviewer"))] + [()] * 4 + [(("prod.member", "author"),)] * 3
    )
    # 문서마다 줄 3개 이상 — 극단 문서(40줄·여섯 후속)만 8줄을 넘는다
    assert all(len(doc.lines) >= 3 for spec in plan for doc in spec.docs)


def test_map_plan_numbers_that_draw_edges_are_number_shaped() -> None:
    plan = build_map_plan()
    lines = [line for spec in plan for doc in spec.docs for line in doc.lines]

    # 지도는 문서 번호 꼴만 Bundle을 건너 맞춘다 — 선을 그어야 할 번호는 모두 그 꼴이어야 한다
    codes = [code for code in build_map_doc_codes().values() if code]
    refs = [line.ref for line in lines if line.ref]
    moves = [line.move_to for line in lines if line.move_to and line.move_to != MAP_FREE_MOVE]
    targets = [code for spec in plan for code, _ in spec.tobe if code != MAP_TEMP_CODE]
    assert all(is_document_number(number) for number in codes + refs + moves + targets + list(MAP_MISSING))
    # 확인할 번호는 그 줄 맨 앞의 번호다(set_ref는 글에 있는 번호만 받는다)
    assert all(find_leading_number(line.text) == line.ref for line in lines if line.ref)
    # 일부러 선이 서지 않는 값 — 번호 꼴이 아닌 이동 코드와 임시 번호
    assert not is_document_number(MAP_FREE_MOVE) and is_temp_match_code(MAP_TEMP_CODE)
    assert len(MAP_LONG_CODE) == 100


def test_map_plan_holds_the_extremes() -> None:
    plan = build_map_plan()
    m1 = plan[0]
    docs = [doc for spec in plan for doc in spec.docs]

    hub_sources = [doc for spec in plan[1:] for doc in spec.docs if any(line.ref == MAP_HUB for line in doc.lines)]
    assert len(hub_sources) == 30  # 확인한 참조로 — 구성원이 아닌 묶음(M6~M8)의 줄도 지도에 선다
    fan = [find_leading_number(line.text) for line in m1.docs[1].lines if find_leading_number(line.text)]
    assert len(fan) == len(set(fan)) == 40 and set(MAP_MISSING) <= set(fan)
    all_codes = set(build_map_doc_codes().values())
    assert not set(MAP_MISSING) & all_codes
    # MAP-101은 M1과 M2에 하나씩, 번호 없는 문서·100자 번호·빈 제목·공백 없는 200자 제목은 M1에
    assert Counter(build_map_doc_codes().values())[MAP_HUB] == 2
    assert "without_a_number" in m1.docs[9].file_name and m1.docs[12].doc_code == MAP_LONG_CODE
    assert m1.docs[10].title == "" and len(m1.docs[11].title or "") == 200 and " " not in (m1.docs[11].title or "")
    assert [line.assign_to for line in m1.docs[3].lines if line.assign_to] == [MAP_TEMP_CODE]
    assert len({line.assign_to for line in m1.docs[4].lines if line.assign_to}) == 6
    assert any(len(line.text) >= 1790 and line.ref for line in m1.docs[2].lines)
    assert any(line.move_to == MAP_FREE_MOVE for line in m1.docs[5].lines)
    # 넷에 하나는 다른 묶음 New 문서로 이동(확정) — 모두 합쳐 Bundle을 건너는 줄이 170개를 넘는다
    moved = [doc for doc in docs if any(line.move_to and line.move_to != MAP_FREE_MOVE for line in doc.lines)]
    assert len(moved) == 26
    crossing = sum(1 for doc in docs for line in doc.lines if line.move_to or find_leading_number(line.text))
    assert crossing >= 170
