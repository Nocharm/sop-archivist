"""처음부터 끝까지 — 합성 QC Centrifuge 자료로 두 입구를 거쳐 업로드부터 검토 완료까지 API로 몬다(스펙 §13).

모든 저장은 생성기가 쓴 기대 정답(SYNTHETIC_expected.json)만 보고 만든다 — 모는 쪽은 로컬 데모 시드와 같은
scripts.sop_demo_driver다.
"""

import zipfile
from io import BytesIO
from pathlib import Path

import docx
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.settings import settings
from app.sop.constants import COVER_KINDS
from app.sop.coverage import find_coverage_problems
from scripts.sop_demo_driver import LANGS, TEXT_KINDS, SyntheticDriver, find_unit_by_text, iter_c_items
from scripts.synthetic_sop import FIXED_ZIP_TIME, SyntheticBundle, build_synthetic_bundle
from tests.sop_helpers import AUTHOR, REVIEWER, save_group

pytestmark = pytest.mark.usefixtures("clean_sop")

SECOND_AUTHOR = {"X-Dev-User": "ops.member"}
MISSING_TEXT_WARNINGS = ("missing_text", "missing_text_truncated")
# 두 작성자의 결과물 비교에서 지우는 값 — 묶음마다 다른 DB id와 확정한 사람·시각
VOLATILE_KEYS = frozenset({"unit_id", "display_id", "confirmed_by", "confirmed_at", "target_id", "target_doc_id"})


@pytest.fixture
def synthetic(tmp_path: Path) -> SyntheticBundle:
    return build_synthetic_bundle(tmp_path / "synthetic")


def _get_location_key(spec: dict) -> str:
    """결과물 C의 칸 위치 키 — SOP 칸 키 | step:<n>:<부분> | path:<절 경로>."""
    if "section_path" in spec:
        return f"path:{spec['section_path']}"
    if "slot_key" in spec:
        return spec["slot_key"]
    return f"step:{spec['wi_step']}:{spec['wi_part']}"


def _list_expected_c_items(expected: dict, lang: str) -> list[tuple]:
    """결과물 C에 나올 새 문장 — 같은 key는 하나, 그 언어와 중립만, 입구 2 신규 포함."""
    specs = {spec["key"]: spec for answer in expected["answers"] for spec in answer["targets"]}
    items = [
        (spec["code"], _get_location_key(spec), spec["kind"], spec.get("text", ""), spec["change_type"])
        for spec in specs.values()
        if spec["lang"] in (lang, "neutral")
    ]
    items += [
        (spec["doc"], f"path:{spec['section_path']}", "sentence", spec["text"], "new")
        for spec in expected["match"]["new_texts"]
        if spec["lang"] == lang
    ]
    return sorted(items)


def _list_c_items(output_c: dict) -> list[tuple]:
    return sorted(
        (doc["code"], item["location_key"], item["kind"], item["text"], item["change_type"])
        for doc in output_c["docs"]
        for item in iter_c_items(doc)
    )


def _strip_volatile(value: object) -> object:
    if isinstance(value, dict):
        return {key: _strip_volatile(item) for key, item in value.items() if key not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [_strip_volatile(item) for item in value]
    return value


def _normalize_flow(flow: dict) -> dict:
    """흐름도 노드 id(old:<문서 id>·target:<새 문서 id>)를 표시 이름으로 바꾼다 — 묶음마다 다른 DB id를 지운다."""
    labels = {node["id"]: node["label"] for node in flow["nodes"]}
    return {
        "nodes": [{**node, "id": labels[node["id"]]} for node in flow["nodes"]],
        "edges": [
            {**edge, "source": labels[edge["source"]], "target": labels[edge["target"]]} for edge in flow["edges"]
        ],
    }


# --- 테스트 ---


def test_synthetic_files_are_marked(synthetic: SyntheticBundle) -> None:
    files = sorted(synthetic.directory.iterdir())

    assert {path.name for path in files} == {
        *(document.path.name for document in synthetic.documents), synthetic.tobe_file.name, "SYNTHETIC_expected.json",
    }
    assert all(path.name.startswith("SYNTHETIC_") for path in files)
    for path in files:
        if path.suffix == ".docx":
            properties = docx.Document(str(path)).core_properties
            assert "SYNTHETIC" in properties.title and "SYNTHETIC" in properties.subject, path.name


def test_synthetic_bundle_is_byte_identical(synthetic: SyntheticBundle, tmp_path: Path) -> None:
    again = build_synthetic_bundle(tmp_path / "again")

    for path in synthetic.directory.iterdir():
        assert (again.directory / path.name).read_bytes() == path.read_bytes(), path.name
    with zipfile.ZipFile(synthetic.tobe_file) as archive:  # 저장 라이브러리가 적은 지금 시각이 남지 않는다
        assert {info.date_time for info in archive.infolist()} == {FIXED_ZIP_TIME}


def test_end_to_end_both_entrances(client: TestClient, synthetic: SyntheticBundle) -> None:
    assert settings.ai_enabled is False
    expected = synthetic.expected
    run = SyntheticDriver(client, synthetic, AUTHOR)

    # 1–3. 묶음·검토자·To-Be → 옛 문서 5개·새 문서 1개 → 언어 배치·편집
    run.start()

    assert {code: uploaded["status"] for code, uploaded in run.uploads.items()} == dict.fromkeys(
        ("OLD-1", "OLD-2", "OLD-3", "OLD-4", "OLD-5", "WI-04"), "ready"
    )
    warnings = [warning["kind"] for uploaded in run.uploads.values() for warning in uploaded["extraction"]["warnings"]]
    assert not set(warnings) & set(MISSING_TEXT_WARNINGS)
    for code, view in run.views.items():
        blocks = {block["id"]: block["text"] for block in view["blocks"]}
        spans = [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
        assert find_coverage_problems(blocks, spans) == [], code
    assert {code: view["document"]["language_layout"] for code, view in run.views.items()} == {
        document.path.name.split("_")[1]: document.layout for document in synthetic.documents
    }
    # 기대 정답이 옛 커버 단위를 빠짐없이 한 번씩 가리킨다(칸 문장은 표 답의 칸 새 문장이 가리킨다)
    addressed = [run.find_answer_unit(answer)["id"] for answer in expected["answers"] if answer.get("kind") != "table"]
    addressed += [
        find_unit_by_text(run.views[answer["doc"]], spec["source_text"], 1, ("cell_sentence",))["id"]
        for answer in expected["answers"] if answer.get("kind") == "table"
        for spec in answer["targets"] if "parent_key" in spec
    ]
    old_cover = {
        unit["id"]: (code, unit["text"]) for code, view in run.views.items() if view["document"]["side"] == "old"
        for unit in view["units"] if unit["kind"] in COVER_KINDS
    }
    unmatched = set(old_cover) ^ set(addressed)
    assert sorted(addressed) == sorted(old_cover), [old_cover.get(unit_id, unit_id) for unit_id in unmatched]

    # 4. 답 저장(누락 하나는 남긴다) — 입구 2는 같은 글자 후보로 한 번에 확정한 뒤 나머지를 관계 묶음으로
    run.save_answers(skip_omitted=True)

    # 5. 의미 검토 4항목 표시 → 검토 요청은 그 언어의 미배정 1건으로 거절
    run.put_semantic_checks()
    run.refresh_views()
    omitted = expected["omitted"]
    omitted_unit = find_unit_by_text(run.views[omitted["doc"]], omitted["text"], omitted["occurrence"], TEXT_KINDS)
    status_code, body = run.request_review()
    assert status_code == 422, body
    assert body["detail"] == {
        "code": "not_ready", "blockers": [{"code": "units_unassigned", "lang": omitted_unit["lang"], "count": 1}],
    }

    # 6. 누락을 저장하면 검토 요청이 통과한다
    run.save_omitted()
    status_code, body = run.request_review()
    assert status_code == 200, body
    assert body["status"] == "in_review"

    # 7. 결과물 A·B·C·요약(두 언어)
    summary = run.get("/summary")
    outputs = run.load_outputs()
    for lang in LANGS:
        assert {key: summary[lang][key] for key in expected["summary"][lang]} == expected["summary"][lang], lang
        assert summary[lang]["unassigned"] == 0 and summary[lang]["duplicate"] == 1
        assert sum(edge["count"] for edge in outputs[lang]["b"]["edges"]) == expected["flow_edge_total"][lang]
        assert {row["status"] for row in outputs[lang]["a"]} == {"confirmed"}
        assert _list_c_items(outputs[lang]["c"]) == _list_expected_c_items(expected, lang), lang
        assert len(outputs[lang]["c"]["deleted"]) == expected["summary"][lang]["deleted"]
        assert {moved["move_target_code"] for moved in outputs[lang]["c"]["moved"]} == {"SOP-QC-99999"}

    # 8. Excel 두 언어 — 시트 4개, 수식 칸 없음, A 시트 데이터 줄 = A JSON 줄
    for lang in LANGS:
        response = client.get(f"/api/bundles/{run.bundle_id}/export.xlsx", params={"lang": lang}, headers=AUTHOR)
        assert response.status_code == 200, response.text
        workbook = load_workbook(BytesIO(response.content))
        assert len(workbook.sheetnames) == 4
        cells = [cell for sheet in workbook for row in sheet.iter_rows() for cell in row]
        assert [cell.coordinate for cell in cells if cell.data_type == "f"] == []
        sheet_a = workbook[workbook.sheetnames[0]]  # 1행 상태, 2행 머리, 3행부터 데이터
        data_rows = [
            row for row in sheet_a.iter_rows(min_row=3, values_only=True) if any(value is not None for value in row)
        ]
        assert len(data_rows) == len(outputs[lang]["a"]), lang

    # 9. 검토자 완료 → 완료 뒤 저장은 409
    completed = run.post("/review/complete", {"revision": run.bundle_revision()}, headers=REVIEWER)
    assert completed["status"] == "done"
    unit = run.find_answer_unit(expected["answers"][0])
    response = save_group(client, run.bundle_id, {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "delete", "reason": "x"}],
        "targets": [],
    })
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "bundle_not_editable"

    # 10. 모든 옛 커버 단위의 상태는 정확히 하나, 확정이다
    run.refresh_views()
    statuses = {
        unit["id"]: unit["status"] for view in run.views.values() if view["document"]["side"] == "old"
        for unit in view["units"] if unit["kind"] in COVER_KINDS
    }
    assert len(statuses) == len(old_cover)
    assert set(statuses.values()) == {"confirmed"}
    listed = run.get("/units", limit="1000")["items"]
    assert {item["unit_id"]: item["status"] for item in listed if item["kind"] in COVER_KINDS} == statuses


def test_two_authors_get_identical_output_format(client: TestClient, synthetic: SyntheticBundle) -> None:
    outputs = []
    for headers in (AUTHOR, SECOND_AUTHOR):
        run = SyntheticDriver(client, synthetic, headers)
        run.start()
        run.save_answers(skip_omitted=False)
        loaded = run.load_outputs()
        for lang in LANGS:
            loaded[lang]["b"] = _normalize_flow(loaded[lang]["b"])
        outputs.append(_strip_volatile(loaded))

    first, second = outputs
    assert first == second
