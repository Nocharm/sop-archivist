"""목차 줄 — 잡음 표시(units.noise_kind = "toc")를 붙이는 규칙, 목차 아님(편집 clear_noise)과 되돌리기, 남은 수·결과물 A·시트 미리보기."""

from types import SimpleNamespace
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.extract.docx_reader import SIGNAL_TOC, TOC_FIELD, TOC_LEADER, TOC_SDT, TOC_STYLE
from app.sop.models import TargetSentence
from app.sop.noise import MIN_LEADER_PAGE_LINES, NOISE_TOC, TOC_LEADER_REASON, TOC_SIGNAL, TOC_STRUCTURE_REASONS, find_toc_block_ids
from app.sop.segment import BlockView, build_unit_drafts, build_unit_text
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_style, p
from tests.sop_helpers import AUTHOR, create_bundle, get_bundle, get_view, put_tobe, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-TOC_Contents.docx"
NEW_NAME = "SYNTHETIC_SOP-TOC_Contents.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
STYLES = make_style("TOC1", "toc 1") + make_style("Heading1", "heading 1", outline=0)
KO_TOC = ["1. 목적 ........ 3", "2. 범위 ........ 3", "3. 책임 ........ 4", "7. 절차 ........ 5"]
EN_TOC = ["1. Purpose ........ 3", "2. Scope ........ 3", "3. Responsibility ........ 4"]
# 목차 바로 뒤의 점 끌기 보통 줄 — 점 끌기 때문에 목차 덩어리에 함께 잡힌다(MD 1 F6 데모)
AFTER = "관련 서식 : 합성 기록지 ........ 별첨"
HEADING = "목적"
BODY = "필터 차압이 0.8 bar를 넘으면 교체한다."
TOC_TEXTS = [*KO_TOC, *EN_TOC, AFTER]


class Fixture(NamedTuple):
    bundle_id: int
    doc_id: int
    view: dict


def _toc_body() -> str:
    return "".join(p(text, "TOC1") for text in [*KO_TOC, *EN_TOC]) + p(AFTER) + p(HEADING, "Heading1") + p(BODY)


def _setup(client: TestClient) -> Fixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert put_tobe(client, bundle_id, TOBE_DOCS).status_code == 200
    response = upload(client, bundle_id, build_docx(_toc_body(), styles=STYLES), OLD_NAME)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc
    return Fixture(bundle_id, doc["id"], get_view(client, bundle_id, doc["id"]))


def _toc_units(view: dict) -> list[dict]:
    return [unit for unit in view["units"] if unit["noise_kind"] == NOISE_TOC]


def _unit(view: dict, text: str) -> dict:
    (found,) = [unit for unit in view["units"] if unit["text"] == text]
    return found


def _edit(client: TestClient, fx: Fixture, op: dict) -> httpx2.Response:
    revision = get_view(client, fx.bundle_id, fx.doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", json={"revision": revision, "op": op}, headers=AUTHOR
    )


def _step(client: TestClient, fx: Fixture, action: str) -> httpx2.Response:
    revision = get_view(client, fx.bundle_id, fx.doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )


def _clear(client: TestClient, fx: Fixture, *unit_ids: int) -> httpx2.Response:
    return _edit(client, fx, {"type": "clear_noise", "unit_ids": list(unit_ids)})


def _total(client: TestClient, fx: Fixture) -> int:
    return get_bundle(client, fx.bundle_id)["progress"]["total"]


def _get(client: TestClient, fx: Fixture, path: str, lang: str = "en") -> object:
    response = client.get(f"/api/bundles/{fx.bundle_id}/{path}?lang={lang}", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


# --- 판정 규칙(순수) ---


def _block(block_id: int, reasons: list[str] | None, text: str = "합성 줄", kind: str = "paragraph") -> SimpleNamespace:
    signals = {TOC_SIGNAL: reasons} if reasons else None
    return SimpleNamespace(id=block_id, kind=kind, part="body", text=text, signals=signals)


def test_noise_rule_reads_the_extractor_toc_values() -> None:
    # 추출기 값을 옮겨 적었다 — 한쪽만 바뀌면 목차가 조용히 사라진다
    assert TOC_SIGNAL == SIGNAL_TOC
    assert TOC_STRUCTURE_REASONS == {TOC_STYLE, TOC_FIELD, TOC_SDT}
    assert TOC_LEADER_REASON == TOC_LEADER


def test_a_structural_toc_line_marks_its_whole_run_including_leader_neighbours() -> None:
    blocks = [
        _block(1, None, "머리 문장"), _block(2, ["style"]), _block(3, ["style", "leader"]), _block(4, ["leader"], "서식 ... 별첨"),
        _block(5, None, "본문"), _block(6, ["leader"], "다른 줄 .... 9"),
    ]

    assert find_toc_block_ids(blocks) == {2, 3, 4}


def test_a_leader_only_run_needs_enough_page_number_lines() -> None:
    typed = [_block(n, ["leader"], f"{n}. 절 ........ {n + 2}") for n in range(1, MIN_LEADER_PAGE_LINES + 1)]
    short = [_block(10 + n, ["leader"], f"{n}. 절 ........ {n}") for n in range(1, MIN_LEADER_PAGE_LINES)]

    assert find_toc_block_ids(typed) == {block.id for block in typed}
    # 하나 모자라면 앱은 하지 않는다(확실할 때만)
    assert find_toc_block_ids(short) == set()


def test_a_table_cell_or_old_extraction_never_marks() -> None:
    cell = _block(1, ["style"], kind="table_cell")
    old = SimpleNamespace(id=2, kind="paragraph", part="body", text="1. 목적 ...... 3", signals=None)

    assert find_toc_block_ids([cell, old]) == set()


def test_a_toc_block_becomes_one_marked_sentence_draft() -> None:
    text = "1. 목적 ........ 3"
    blocks = [
        BlockView(1, 0, "paragraph", "body", text, None, (), None, None, {TOC_SIGNAL: ["style", "leader"]}),
        BlockView(2, 1, "paragraph", "body", "본문이다. 둘째 문장이다.", None, (), None, None),
    ]

    drafts = build_unit_drafts(blocks, [], "ko_only", split_lines=True)

    assert [(draft.kind, build_unit_text(draft.spans, {1: text, 2: blocks[1].text}), draft.noise_kind) for draft in drafts] == [
        ("sentence", text, NOISE_TOC),
        ("sentence", "본문이다.", None),
        ("sentence", "둘째 문장이다.", None),
    ]


# --- 올리기 · 남은 수 ---


def test_toc_lines_are_marked_one_unit_per_line_and_leave_the_rows(client: TestClient) -> None:
    fx = _setup(client)

    toc = _toc_units(fx.view)

    assert [unit["text"] for unit in toc] == TOC_TEXTS
    assert {unit["kind"] for unit in toc} == {"sentence"}
    assert [unit["lang"] for unit in toc] == ["ko"] * 4 + ["en"] * 3 + ["ko"]
    assert all(unit["pair_id"] is None for unit in toc)
    # 목차 줄은 번호 칸이 없다 — 줄 앞 번호도 목차 글이고 번호 고치기를 받지 않는다
    assert all(unit["number"] is None for unit in toc)
    refused = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", headers=AUTHOR,
        json={"revision": fx.view["document"]["revision"], "op": {"type": "set_number", "unit_id": toc[0]["id"], "number": "1"}},
    )
    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "invalid_unit_kind")
    # 남은 수(진행 숫자)는 목차 줄을 세지 않는다 — 제목과 본문 문장 두 줄
    assert _total(client, fx) == len(fx.view["units"]) - len(TOC_TEXTS) == 2


# --- 목차 아님 · 되돌리기 ---


def test_not_toc_on_one_line_returns_only_that_line_and_undo_puts_it_back(client: TestClient) -> None:
    fx = _setup(client)
    after = _unit(fx.view, AFTER)

    response = _clear(client, fx, after["id"])

    assert response.status_code == 200, response.text
    assert response.json()["created_unit_ids"] == response.json()["retired_unit_ids"] == []
    view = get_view(client, fx.bundle_id, fx.doc_id)
    assert _unit(view, AFTER)["noise_kind"] is None
    assert len(_toc_units(view)) == len(TOC_TEXTS) - 1
    assert _total(client, fx) == 3  # 30 → 31처럼 남은 수에 다시 든다

    assert _step(client, fx, "undo").json()["op"] == "clear_noise"
    assert _unit(get_view(client, fx.bundle_id, fx.doc_id), AFTER)["noise_kind"] == NOISE_TOC
    assert _total(client, fx) == 2

    assert _step(client, fx, "redo").status_code == 200
    assert _unit(get_view(client, fx.bundle_id, fx.doc_id), AFTER)["noise_kind"] is None


def test_all_not_toc_clears_the_block_in_one_edit(client: TestClient) -> None:
    fx = _setup(client)
    ids = [unit["id"] for unit in _toc_units(fx.view)]
    body = _unit(fx.view, BODY)

    # 블록 전체에 표시 없는 줄이 섞여 와도 그 줄은 그대로다
    assert _clear(client, fx, *ids, body["id"]).status_code == 200

    assert _toc_units(get_view(client, fx.bundle_id, fx.doc_id)) == []
    assert _total(client, fx) == 2 + len(ids)
    assert _step(client, fx, "undo").status_code == 200
    assert len(_toc_units(get_view(client, fx.bundle_id, fx.doc_id))) == len(ids)


def test_clearing_nothing_writes_no_edit(client: TestClient) -> None:
    fx = _setup(client)
    revision = fx.view["document"]["revision"]

    assert _clear(client, fx, _unit(fx.view, BODY)["id"]).json()["document_revision"] == revision


def test_undo_does_not_mark_a_line_that_was_decided_in_between(client: TestClient) -> None:
    fx = _setup(client)
    after = _unit(fx.view, AFTER)
    assert _clear(client, fx, after["id"]).status_code == 200
    bulk = {"action": "delete", "reason": "합성", "units": [{"unit_id": after["id"], "revision": 1}]}
    assert client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=bulk, headers=AUTHOR).status_code == 200

    response = _step(client, fx, "undo")

    assert (response.status_code, response.json()["detail"]["code"]) == (409, "unit_has_decision")


def test_toc_lines_cannot_be_decided(client: TestClient) -> None:
    fx = _setup(client)
    line = _toc_units(fx.view)[0]
    bulk = {"action": "delete", "reason": "합성", "units": [{"unit_id": line["id"], "revision": 1}]}

    response = client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=bulk, headers=AUTHOR)

    assert (response.status_code, response.json()["detail"]["code"]) == (422, "noise_unit")


# --- 결과물 ---


def test_output_a_keeps_each_toc_line_as_an_automatic_deleted_row(client: TestClient) -> None:
    fx = _setup(client)
    assert _clear(client, fx, _unit(fx.view, AFTER)["id"]).status_code == 200

    rows = _get(client, fx, "outputs/a", "ko")
    en_rows = _get(client, fx, "outputs/a", "en")

    toc = [row for row in rows if row["noise_kind"] == NOISE_TOC]
    assert [row["source_text"] for row in toc] == [*KO_TOC, *EN_TOC]
    assert [row["location"]["place"] for row in toc[:2]] == ["목차 · 한글 · 1행", "목차 · 한글 · 2행"]
    assert toc[-1]["location"]["place"] == "목차 · 영어 · 3행"
    assert [row["location"]["place"] for row in en_rows if row["noise_kind"]][-1] == "Contents · English · line 3"
    assert {(row["dest_kind"], row["change_type"], row["status"], row["confirmed_by"]) for row in toc} == {
        ("delete", "deleted", "deleted", None)
    }
    assert {row["remark"] for row in toc} == {"목차 · 새 문서 목차는 앱이 만든다 (저절로)"}
    # 줄마다 한 묶음, 원문 순 — 목차 줄이 먼저고 "목차 아님"으로 돌린 줄은 보통 줄로 그 뒤
    assert [row["row_no"] for row in rows] == list(range(1, len(rows) + 1))
    returned = next(row for row in rows if row["source_text"] == AFTER)
    assert (returned["noise_kind"], returned["status"], returned["dest_kind"]) == (None, "unassigned", "")
    assert rows.index(returned) == len(toc)


def test_summary_and_flow_count_toc_lines_as_automatic_deletes(client: TestClient) -> None:
    fx = _setup(client)

    summary = _get(client, fx, "summary")
    graph = _get(client, fx, "outputs/b")

    assert summary["toc_deleted"] == len(TOC_TEXTS)
    assert summary["old_rows"] == len(TOC_TEXTS) + 2
    assert (summary["assigned"], summary["no_destination"], summary["deleted"]) == (len(TOC_TEXTS), 2, 0)
    delete = next(node for node in graph["nodes"] if node["id"] == "delete")
    assert delete["count"] == summary["deleted"] + summary["toc_deleted"]


def test_export_preview_marks_toc_rows_and_the_workbook_counts_them(client: TestClient) -> None:
    fx = _setup(client)

    preview = _get(client, fx, "export/preview")

    a_sheet, b_sheet = preview["sheets"][0], preview["sheets"][1]
    toc_rows = [row for row in a_sheet["rows"] if row["toc"]]
    assert len(toc_rows) == len(TOC_TEXTS)
    status_index = a_sheet["column_keys"].index("status")
    assert {(row["cells"][status_index]["text"], row["cells"][status_index]["tone"]) for row in toc_rows} == {
        ("Deleted", "del")
    }
    assert ["Contents · auto-deleted", str(len(TOC_TEXTS))] in [
        [cell["text"] for cell in row["cells"][:2]] for row in b_sheet["rows"]
    ]


# --- 입구 2 ---


def test_a_written_new_document_makes_no_sentences_from_its_toc_lines(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(
        client, bundle_id, build_docx(_toc_body(), styles=STYLES), NEW_NAME, side="new", doc_type="sop"
    )
    assert response.status_code == 201, response.text
    view = get_view(client, bundle_id, response.json()["id"])
    toc_ids = {unit["id"] for unit in _toc_units(view)}
    assert len(toc_ids) == len(TOC_TEXTS)

    async def _load(session: AsyncSession) -> set[int]:
        rows = await session.scalars(select(TargetSentence.new_unit_id).where(TargetSentence.new_unit_id.is_not(None)))
        return set(rows)

    written = run_in_session(_load)
    assert written and not written & toc_ids
    assert _unit(view, BODY)["id"] in written


def test_toc_lines_cannot_be_split_merged_carved_or_have_their_boundary_moved(client: TestClient) -> None:
    # 사용자 결정(2026-11-19) — 목차 줄을 고치려면 먼저 목차 아님으로 보통 줄로 돌린다
    fx = _setup(client)
    first, second, body = _unit(fx.view, KO_TOC[0]), _unit(fx.view, KO_TOC[1]), _unit(fx.view, HEADING)
    ops = [
        {"type": "split", "unit_id": first["id"], "at": 3},
        {"type": "merge", "unit_ids": [first["id"], second["id"]]},
        {"type": "merge", "unit_ids": [_unit(fx.view, AFTER)["id"], body["id"]]},
        {"type": "carve", "block_id": first["spans"][0][0], "start": 0, "end": 5},
        {"type": "move_boundary", "left_unit_id": first["id"], "right_unit_id": second["id"], "at": 3},
    ]

    for op in ops:
        response = _edit(client, fx, op)
        assert (response.status_code, response.json()["detail"]["code"]) == (422, "toc_line_locked"), (op, response.text)
    assert len(_toc_units(get_view(client, fx.bundle_id, fx.doc_id))) == len(TOC_TEXTS)

    cleared = _edit(client, fx, {"type": "clear_noise", "unit_ids": [first["id"]]})
    assert cleared.status_code == 200, cleared.text
    assert _edit(client, fx, {"type": "split", "unit_id": first["id"], "at": 3}).status_code == 200
