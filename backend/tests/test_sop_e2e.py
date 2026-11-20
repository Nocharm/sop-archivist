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
from app.sop.renumber import find_number_tokens, read_caption_number
from scripts.sop_demo_driver import SyntheticDriver, find_unit_by_text, iter_c_items
from scripts.synthetic_sop import (
    FIXED_ZIP_TIME,
    SyntheticBundle,
    build_synthetic_bundle,
)
from tests.ai_fixtures import (
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    clean_embedding_cache,  # noqa: F401
    run_jobs,
)
from tests.fake_ai import SyntheticAnswers, install_fake_ai
from tests.sop_helpers import AUTHOR, BUNDLE_KINDS, REVIEWER, build_as_is_targets, save_group

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs", "clean_embedding_cache")

SECOND_AUTHOR = {"X-Dev-User": "ops.member"}
MISSING_TEXT_WARNINGS = ("missing_text", "missing_text_truncated")
# 두 작성자의 결과물 비교에서 지우는 값 — 묶음마다 다른 DB id(결과물 C 묶음 키는 단위·짝 id로 짓는다)와 확정한 사람·시각
VOLATILE_KEYS = frozenset(
    {"unit_id", "display_id", "confirmed_by", "confirmed_at", "target_id", "target_doc_id", "meaning_key"}
)


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


def _mask_numbers(text: str) -> str:
    """표·그림 번호 자리를 '#'로 — 결과물은 새 문서마다 다시 매긴 번호라(outputs.build_renumbering) 정답의 원문 번호와 글만 견준다."""
    head = read_caption_number(text)
    spans = {(token.start, token.end) for token in find_number_tokens(text)}
    if head is not None:
        spans.add((head.start, head.end))
    for start, end in sorted(spans, reverse=True):
        text = f"{text[:start]}#{text[end:]}"
    return text


def _list_expected_c_items(expected: dict) -> list[tuple]:
    """결과물 C에 나올 새 문장 — 같은 key는 하나, 두 언어와 중립 모두(한 벌), 입구 2 신규 포함. 표·그림 번호는 가린다."""
    specs = {spec["key"]: spec for answer in expected["answers"] for spec in answer["targets"]}
    items = [
        (spec["code"], _get_location_key(spec), spec["kind"], _mask_numbers(spec.get("text", "")), spec["change_type"])
        for spec in specs.values()
    ]
    items += [
        (spec["doc"], f"path:{spec['section_path']}", "sentence", _mask_numbers(spec["text"]), "new")
        for spec in expected["match"]["new_texts"]
    ]
    return sorted(items)


def _list_c_items(output_c: dict) -> list[tuple]:
    return sorted(
        (doc["code"], item["location_key"], item["kind"], _mask_numbers(item["text"]), item["change_type"])
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

    # 1–3. 묶음·검토자·To-Be → 옛 문서 6개·새 문서 2개 → 언어 배치·편집
    run.start()

    assert {code: uploaded["status"] for code, uploaded in run.uploads.items()} == dict.fromkeys(
        ("OLD-1", "OLD-2", "OLD-3", "OLD-4", "OLD-5", "WI-04", "OLD-6", "WI-05", "OLD-7"), "ready"
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
        for spec in answer["targets"] if "cell_row" in spec  # 캡션 새 문장(칸 좌표 없음)은 아래 캡션 단위가 맡는다
    ]
    # 표·그림에 묶인 캡션은 답이 없고 묶음 답의 처분을 따른다
    bundle_ids = {run.find_answer_unit(answer)["id"] for answer in expected["answers"] if answer.get("kind")}
    addressed += [
        unit["id"] for view in run.views.values() for unit in view["units"]
        if unit["kind"] == "caption" and unit["group_unit_id"] in bundle_ids
    ]
    old_cover = {
        unit["id"]: (code, unit["text"]) for code, view in run.views.items() if view["document"]["side"] == "old"
        for unit in view["units"] if unit["kind"] in COVER_KINDS
    }
    unmatched = set(old_cover) ^ set(addressed)
    assert sorted(addressed) == sorted(old_cover), [old_cover.get(unit_id, unit_id) for unit_id in unmatched]

    # 4. 답 저장(누락 하나는 남긴다) — 입구 2는 같은 글자 후보로 한 번에 확정한 뒤 나머지를 관계 묶음으로
    run.save_answers(skip_omitted=True)

    # 5. 의미 검토 4항목 표시 → 검토 요청은 미배정 한 줄로 거절
    run.put_semantic_checks()
    run.refresh_views()
    status_code, body = run.request_review()
    assert status_code == 422, body
    assert body["detail"] == {
        "code": "not_ready", "blockers": [{"code": "units_unassigned", "count": 1}],
    }

    # 6. 누락을 저장하면 검토 요청이 통과한다
    run.save_omitted()
    status_code, body = run.request_review()
    assert status_code == 200, body
    assert body["status"] == "in_review"

    # 7. 결과물 A·B·C·요약 — 한 벌, 줄 기준 숫자는 진행 숫자와 같은 줄에서 나온다
    summary = run.get("/summary")
    outputs = run.load_outputs()
    a_rows = outputs["a"]
    assert {row["status"] for row in a_rows} == {"confirmed"}
    assert summary["old_rows"] == run.get("")["progress"]["total"]
    assert (summary["no_destination"], summary["duplicate"]) == (0, 1)
    # A 옛 문서 묶음(번호) → 그 묶음의 줄이 보낸 새 문서
    old_groups: dict[int, set[str]] = {row["row_no"]: set() for row in a_rows if row["row_kind"] in ("unit", "table", "cell")}
    for row in a_rows:
        if row["row_no"] in old_groups and row["dest_kind"] in ("sop", "wi"):
            old_groups[row["row_no"]].add(row["dest_doc_code"])
    assert len(old_groups) == summary["old_rows"]
    # B 간선 합 = A 옛 묶음마다 보낸 새 문서 수(없으면 처분 노드 하나)
    assert sum(edge["count"] for edge in outputs["b"]["edges"]) == sum(max(1, len(docs)) for docs in old_groups.values())
    assert _list_c_items(outputs["c"]) == _list_expected_c_items(expected)
    # OLD-7의 그림 5·6은 SOP-CF의 첫·둘째 그림 — 캡션과 참조 문장이 다시 매긴 번호로 나온다
    c_texts = {item["text"] for doc in outputs["c"]["docs"] for item in iter_c_items(doc)}
    assert {"Fig.2 Lid lock", "See Figure 1 for the mounting position."} <= c_texts
    assert len(outputs["c"]["deleted"]) == summary["deleted"]
    assert {moved["move_target_code"] for moved in outputs["c"]["moved"]} == {"SOP-QC-99999"}

    # 8. Excel 한 벌 — 시트 4개, 수식 칸 없음, A 시트 데이터 줄 = A JSON 줄(이어짐 줄이 없는 자료)
    response = client.get(f"/api/bundles/{run.bundle_id}/export.xlsx", headers=AUTHOR)
    assert response.status_code == 200, response.text
    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == ["A Comparison", "B Flow", "C New documents", "Info", "Documents"]
    cells = [cell for sheet in workbook for row in sheet.iter_rows() for cell in row]
    assert [cell.coordinate for cell in cells if cell.data_type == "f"] == []
    sheet_a = workbook["A Comparison"]  # 1행 상태, 2행 머리, 3행부터 데이터
    data_rows = [row for row in sheet_a.iter_rows(min_row=3, values_only=True) if any(value is not None for value in row)]
    assert len(data_rows) == len(outputs["a"])

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
        loaded["b"] = _normalize_flow(loaded["b"])
        outputs.append(_strip_volatile(loaded))

    first, second = outputs
    assert first == second


def _build_classify_use(run: SyntheticDriver, content: dict, answers: dict[int, dict]) -> tuple[str, list[dict]]:
    """분류 제안의 처분과 그 자리에 둘 새 문장 — Assign의 Use가 초안에 채우는 것.

    글 단위는 제 언어의 고쳐 쓴 글마다 새 문장 하나, 표·그림은 원문 그대로의 묶음 새 문장과 딸린 캡션이다. 캡션 단위가 없는
    그림은 사람이 정답의 캡션 새 문장을 더한다(캡션 없는 묶음은 확정할 수 없다).
    """
    units = {unit["id"]: unit for view in run.views.values() for unit in view["units"]}
    location = {key: content[key] for key in ("slot_key", "wi_step", "wi_part")}
    place = {"target_doc_id": content["target_doc_id"], **location}
    targets = []
    for unit_id in content["unit_ids"] if content["disposition"] == "assigned" else ():
        unit = units[unit_id]
        if unit["kind"] in BUNDLE_KINDS:
            assert content["unit_ids"] == [unit_id], content  # 묶음 단위는 홀로 분류된다 — 새 문장 key "t"가 겹치지 않는다
            built, caption_ids = build_as_is_targets(run.client, run.bundle_id, unit, content["target_doc_id"], **location)
            captions = [
                {**place, "key": f"caption-{caption_id}", "parent_key": "t", "source_unit_ids": [caption_id]}
                for caption_id in caption_ids
            ] or [
                {**run._build_target(spec, answers[unit_id]), "parent_key": "t"}
                for spec in answers[unit_id]["targets"] if "parent_key" in spec and "cell_row" not in spec
            ]
            targets += [*built, *captions]
            continue
        targets += [
            {
                "key": f"{unit_id}-{index}", **place, "kind": "sentence", "text": text, "source_unit_ids": [unit_id],
            }
            for index, text in enumerate(content["rewrites"][unit["lang"]])
        ]
    return content["disposition"], targets


def _build_match_use(run: SyntheticDriver, content: dict, answers: dict[int, dict]) -> tuple[str, list[dict]]:
    """묶기 제안의 묶음 — 새 문서의 새 문장마다 제안의 출처 연결(links), 칸·캡션 새 문장은 부모 아래 그대로. 변경 종류는 서버가 정한다."""
    if content["shape"] == "delete_candidate":
        return "delete", []
    targets = []
    for target_id in content["target_ids"]:
        group = run.get(f"/groups/by-target/{target_id}")
        target = next(item for item in group["targets"] if item["id"] == target_id)
        item = {
            "key": str(target_id), "id": target_id, "revision": target["revision"], "kind": target["kind"],
            "source_unit_ids": [unit_id for linked_id, unit_id in content["links"] if linked_id == target_id],
        }
        if target["parent_target_id"] is not None:
            item["parent_key"] = str(target["parent_target_id"])
        targets.append(item)
    return "assigned", targets


def _use_suggestions(run: SyntheticDriver) -> int:
    """적용된 분류·묶기 제안을 사람이 받아(Use) 그대로 확정한다 — 제안마다 suggestion_id를 실은 관계 묶음 저장 한 번, 받은 수를 돌려준다.

    AI는 판단·새 문장을 쓰지 않으니 초안은 제안 내용에서 만들고, 사유만 사람이 정답대로 적는다(설계 2026-11-19-ai-suggest-only D2).
    """
    answers = {run.find_answer_unit(answer)["id"]: answer for answer in run.expected["answers"]}
    page = run.get("/ai/suggestions", result="applied", limit="1000")
    assert page["total"] == len(page["items"])
    for suggestion in page["items"]:
        content = suggestion["content"]
        assert suggestion["kind"] in ("classify", "match"), suggestion["kind"]
        build = _build_classify_use if suggestion["kind"] == "classify" else _build_match_use
        disposition, targets = build(run, content, answers)
        revisions = run.load_decision_revisions()
        body = {
            "action": "confirm",
            "units": [
                {
                    "unit_id": unit_id, "revision": revisions[unit_id], "disposition": disposition,
                    "reason": answers[unit_id]["reason"],
                }
                for unit_id in content["unit_ids"]
            ],
            "targets": targets,
            "suggestion_id": suggestion["id"],
        }
        response = save_group(run.client, run.bundle_id, body, run.headers)
        assert response.status_code == 200, response.text
    return len(page["items"])


def test_end_to_end_with_fake_ai(
    client: TestClient, synthetic: SyntheticBundle, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = SyntheticDriver(client, synthetic, AUTHOR)
    run.start()
    answers = SyntheticAnswers(synthetic.expected)
    install_fake_ai(monkeypatch, chat=answers.chat, embed=answers.embed)

    run.request_classification()
    run_jobs()

    assert run.get("/ai/status")["jobs"]["failed"] == 0
    assert run.get("/ai/suggestions", result="invalid")["total"] > 0  # 합침·중복 배정·표는 사람 경로로 간다
    confirmed = _use_suggestions(run)
    assert confirmed > 0
    run.settle_remaining()  # 보류를 지우고 정답대로 저장, 입구 2 포함
    run.put_semantic_checks()
    status_code, body = run.request_review()
    assert status_code == 200, body
    assert _list_c_items(run.get("/outputs/c")) == _list_expected_c_items(synthetic.expected)
    adoption = run.get("/ai/status")["adoption"]
    assert adoption["classify"]["as_is"] > 0 and adoption["classify"]["pending"] == 0
    assert adoption["match"]["as_is"] > 0 and adoption["match"]["pending"] == 0
    # 대기 0은 사람이 받은 제안에서 나온다 — 받은 수만큼 그대로 채택이다
    assert adoption["classify"]["as_is"] + adoption["match"]["as_is"] == confirmed


def test_ai_off_still_finishes_the_human_path(client: TestClient, synthetic: SyntheticBundle) -> None:
    assert settings.ai_enabled is False
    run = SyntheticDriver(client, synthetic, AUTHOR)
    run.start()
    document_id = run.uploads["OLD-1"]["id"]
    ai_requests = {
        "/ai/classify": {"document_id": document_id},
        "/ai/translate": {"direction": "ko_to_en", "document_id": document_id},
        "/ai/match": {},
        "/ai/split": {"document_id": document_id},
    }

    for path, request in ai_requests.items():
        response = client.post(f"/api/bundles/{run.bundle_id}{path}", json=request, headers=AUTHOR)
        assert (response.status_code, response.json()["detail"]["code"]) == (503, "ai_disabled"), path

    run.save_answers(skip_omitted=False)
    run.put_semantic_checks()
    status_code, body = run.request_review()
    assert status_code == 200, body
    assert body["status"] == "in_review"
    assert _list_c_items(run.get("/outputs/c")) == _list_expected_c_items(synthetic.expected)
