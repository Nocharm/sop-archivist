"""처음부터 끝까지 — 합성 QC Centrifuge 자료로 두 입구를 거쳐 업로드부터 검토 완료까지 API로 몬다(스펙 §13).

모든 저장은 생성기가 쓴 기대 정답(SYNTHETIC_expected.json)만 보고 만든다 — 단위는 (문서 번호, 글자, 몇 번째)로 찾는다.
"""

import zipfile
from collections import defaultdict
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

import docx
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.settings import settings
from app.sop.constants import COVER_KINDS, SEMANTIC_CHECK_KEYS
from app.sop.coverage import find_coverage_problems
from scripts.synthetic_sop import FIXED_ZIP_TIME, SyntheticBundle, build_synthetic_bundle
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    create_bundle,
    get_bundle,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

SECOND_AUTHOR = {"X-Dev-User": "ops.member"}
REVIEWER_LOGIN = REVIEWER["X-Dev-User"]
TEXT_KINDS = ("sentence", "heading", "cell_sentence")  # kind 없는 답이 가리키는 글 단위
DEFAULT_LAYOUT = "ko_en_interleaved"
# 요청에 실을 수 있는 변경 종류 — 나눔·합침·신규는 서버가 구조로 정한다
REQUESTABLE_CHANGE_TYPES = ("as_is", "tone", "rewritten", "table_restructured")
MISSING_TEXT_WARNINGS = ("missing_text", "missing_text_truncated")
LANGS = ("ko", "en")
# 두 작성자의 결과물 비교에서 지우는 값 — 묶음마다 다른 DB id와 확정한 사람·시각
VOLATILE_KEYS = frozenset({"unit_id", "display_id", "confirmed_by", "confirmed_at", "target_id", "target_doc_id"})


@pytest.fixture
def synthetic(tmp_path: Path) -> SyntheticBundle:
    return build_synthetic_bundle(tmp_path / "synthetic")


# --- 묶음을 모는 쪽 ---


class _Driver:
    """합성 묶음 하나를 기대 정답대로 모는 API 클라이언트 — 묶음·문서·To-Be id와 문서별 원문 대조 데이터를 들고 있다."""

    def __init__(self, client: TestClient, synthetic: SyntheticBundle, headers: dict[str, str]) -> None:
        self.client, self.synthetic, self.headers = client, synthetic, headers
        self.expected = synthetic.expected
        self.bundle_id = 0
        self.uploads: dict[str, dict] = {}  # 문서 번호(파일 이름에서) → 업로드 응답
        self.tobe_ids: dict[str, int] = {}  # To-Be 문서 번호 → id
        self.views: dict[str, dict] = {}
        self._match_targets: dict[tuple[str, str], int] = {}

    # 요청 공용

    def _url(self, path: str) -> str:
        return f"/api/bundles/{self.bundle_id}{path}"

    def get(self, path: str, **params: str) -> dict | list:
        response = self.client.get(self._url(path), params=params, headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json()

    def post(self, path: str, body: dict, headers: dict[str, str] | None = None) -> dict:
        response = self.client.post(self._url(path), json=body, headers=headers or self.headers)
        assert response.status_code == 200, response.text
        return response.json()

    def bundle_revision(self) -> int:
        return get_bundle(self.client, self.bundle_id, self.headers)["revision"]

    # 1–3단계: 묶음·To-Be·업로드·언어 배치·편집

    def start(self) -> None:
        """묶음을 만들고 검토자를 더한 뒤 To-Be를 가져오고(N/A는 PUT) 파일을 올려 언어 배치와 편집을 적용한다."""
        login = self.headers["X-Dev-User"]
        self.bundle_id = create_bundle(
            self.client, title=self.expected["bundle_title"], headers=self.headers, is_synthetic=True
        )["id"]
        members = [(login, "author"), (REVIEWER_LOGIN, "reviewer")]
        response = set_members(self.client, self.bundle_id, members, self.headers)
        assert response.status_code == 200, response.text
        self._import_tobe()
        for document in self.synthetic.documents:
            response = upload(
                self.client, self.bundle_id, document.path.read_bytes(), document.path.name, side=document.side,
                doc_type=document.doc_type, parent_code=document.parent_code, headers=self.headers,
            )
            assert response.status_code == 201, response.text
            uploaded = response.json()
            self.uploads[uploaded["doc_code"]] = uploaded
            if document.layout != DEFAULT_LAYOUT:
                self._patch_layout(uploaded, document.layout)
        self.tobe_ids = {doc["code"]: doc["id"] for doc in self.get("/tobe")["docs"]}
        for edit in self.expected["edits"]:
            self._apply_edit(edit)
        self.refresh_views()

    def _import_tobe(self) -> None:
        file = (self.synthetic.tobe_file.name, self.synthetic.tobe_file.read_bytes())
        response = self.client.post(
            self._url("/tobe/import"), files={"file": file}, data={"revision": str(self.bundle_revision())},
            headers=self.headers,
        )
        assert response.status_code == 200, response.text
        tobe = response.json()
        # Excel 템플릿에는 N/A 칸이 없어 가져온 목록을 그대로 두고 N/A만 더해 PUT한다
        docs = [
            {key: doc[key] for key in ("code", "title", "doc_type", "parent_code", "is_equipment_sop", "order_index")}
            for doc in tobe["docs"]
        ]
        response = put_tobe(
            self.client, self.bundle_id, docs, na_slots=self.expected["tobe_na_slots"], wi_steps=tobe["wi_steps"],
            headers=self.headers,
        )
        assert response.status_code == 200, response.text

    def _patch_layout(self, uploaded: dict, layout: str) -> None:
        body = {"revision": uploaded["revision"], "language_layout": layout}
        response = self.client.patch(self._url(f"/documents/{uploaded['id']}"), json=body, headers=self.headers)
        assert response.status_code == 200, response.text
        assert response.json()["language_layout"] == layout

    def _apply_edit(self, edit: dict) -> None:
        view = get_view(self.client, self.bundle_id, self.uploads[edit["doc"]]["id"], self.headers)
        if edit["op"] == "split":
            unit = _find_unit(view, edit["unit_text"], edit.get("occurrence", 1), TEXT_KINDS)
            op = {"type": "split", "unit_id": unit["id"], "at": unit["text"].index(edit["at_text"])}
        else:
            table = next(table for table in view["tables"] if table["table_index"] == edit["table_index"])
            op = {"type": "set_layout_table", "table_id": table["id"], "is_layout": edit["is_layout"]}
        self.post(f"/documents/{view['document']['id']}/edits", {"revision": view["document"]["revision"], "op": op})

    def refresh_views(self) -> None:
        self.views = {
            code: get_view(self.client, self.bundle_id, uploaded["id"], self.headers)
            for code, uploaded in self.uploads.items()
        }

    # 단위·새 문장 찾기

    def find_answer_unit(self, answer: dict) -> dict:
        kinds = (answer["kind"],) if "kind" in answer else TEXT_KINDS
        return _find_unit(self.views[answer["doc"]], answer["text"], answer["occurrence"], kinds)

    def load_decision_revisions(self) -> dict[int, int]:
        """옛 단위 판단의 지금 revision — 묶음의 옛 활성 단위 전부를 한 번에 읽는다."""
        page = self.get("/units", limit="1000")
        assert page["total"] == len(page["items"])
        return {item["unit_id"]: item["decision"]["revision"] for item in page["items"]}

    def find_match_target(self, code: str, text: str) -> dict:
        """입구 2 새 문서의 새 문장(글자로 찾는다)과 그 지금 revision·자리."""
        if not self._match_targets:
            for lang in LANGS:
                for doc in self.get("/outputs/c", lang=lang)["docs"]:
                    if doc["entrance"] == "match":
                        for item in _iter_items(doc):
                            self._match_targets[(doc["code"], item["text"])] = item["target_id"]
        target_id = self._match_targets[(code, text)]
        group = self.get(f"/groups/by-target/{target_id}")
        return next(target for target in group["targets"] if target["id"] == target_id)

    # 4·6단계: 저장

    def save_answers(self, *, skip_omitted: bool) -> None:
        """입구 1 답을 group별로 저장하고, 입구 2는 같은 글자 후보·신규를 한 번에 확정한 뒤 나머지를 관계 묶음으로 맞춘다."""
        groups = self._group_answers(skip_omitted=skip_omitted)
        match_docs = {
            answer["doc"] for answer in self.expected["answers"]
            if any("section_path" in target for target in answer["targets"])
        }
        revisions = self.load_decision_revisions()
        for answers in groups.values():
            if not {answer["doc"] for answer in answers} & match_docs:
                self.save_group(answers, revisions)
        self.confirm_identical_and_new()
        revisions = self.load_decision_revisions()
        for answers in groups.values():
            if {answer["doc"] for answer in answers} & match_docs:
                self.save_group(answers, revisions)

    def save_omitted(self) -> None:
        (answers,) = self._group_answers(only_omitted=True).values()
        self.save_group(answers, self.load_decision_revisions())

    def _group_answers(self, *, skip_omitted: bool = False, only_omitted: bool = False) -> dict[str, list[dict]]:
        """group별 답(처음 나온 순서) — 같은 글자 후보로 확정되는 답은 빼고, 누락 답은 빼거나 그것만 고른다."""
        omitted = self.expected["omitted"]
        groups: dict[str, list[dict]] = defaultdict(list)
        for answer in self.expected["answers"]:
            is_omitted = all(answer[key] == omitted[key] for key in ("doc", "text", "occurrence"))
            if answer.get("identical") or (skip_omitted and is_omitted) or (only_omitted and not is_omitted):
                continue
            groups[answer["group"]].append(answer)
        return groups

    def save_group(self, answers: list[dict], revisions: dict[int, int]) -> None:
        units = [self.find_answer_unit(answer) for answer in answers]
        for answer, unit in zip(answers, units, strict=True):
            assert unit["lang"] == answer["lang"], (answer["doc"], answer["text"])
        if any(answer.get("bulk") for answer in answers):
            self._save_bulk(answers, units, revisions)
            return
        targets: dict[str, dict] = {}
        for answer, unit in zip(answers, units, strict=True):
            for spec in answer["targets"]:
                if spec["key"] not in targets:
                    targets[spec["key"]] = self._build_target(spec, answer)
                if "parent_key" not in spec:  # 같은 key의 새 문장은 합침 — 그 key를 가진 답들의 단위가 출처다
                    targets[spec["key"]]["source_unit_ids"].append(unit["id"])
        body = {
            "action": "confirm",
            "units": [
                {
                    "unit_id": unit["id"], "revision": revisions[unit["id"]], "disposition": answer["disposition"],
                    "reason": answer["reason"], "move_target_code": answer.get("move_target_code", ""),
                }
                for answer, unit in zip(answers, units, strict=True)
            ],
            "targets": list(targets.values()),
        }
        response = save_group(self.client, self.bundle_id, body, self.headers)
        assert response.status_code == 200, response.text
        saved = response.json()
        specs = [spec for answer in answers for spec in answer["targets"]]
        assert sorted(_describe_saved(target) for target in saved["targets"]) == sorted(
            {spec["key"]: self._describe_spec(spec) for spec in specs}.values()
        ), answers[0]["group"]
        assert {unit["decision"]["status"] for unit in saved["units"]} <= {"confirmed"}

    def _save_bulk(self, answers: list[dict], units: list[dict], revisions: dict[int, int]) -> None:
        ((action, reason, move_target_code),) = {
            (answer["disposition"], answer["reason"], answer.get("move_target_code", "")) for answer in answers
        }
        body = {
            "action": action, "reason": reason, "move_target_code": move_target_code,
            "units": [{"unit_id": unit["id"], "revision": revisions[unit["id"]]} for unit in units],
        }
        response = self.client.post(self._url("/decisions/bulk"), json=body, headers=self.headers)
        assert response.status_code == 200, response.text
        decisions = {(row["decision"]["disposition"], row["decision"]["status"]) for row in response.json()}
        assert decisions == {(action, "confirmed")}

    def _build_target(self, spec: dict, answer: dict) -> dict:
        change_type = spec["change_type"] if spec["change_type"] in REQUESTABLE_CHANGE_TYPES else None
        if "section_path" in spec:  # 입구 2 — 새 문서의 기존 새 문장에 출처만 붙인다(글자·자리는 새 문서 그대로)
            target = self.find_match_target(spec["code"], spec["text"])
            assert target["section_path"] == spec["section_path"]
            return {
                "key": spec["key"], "id": target["id"], "revision": target["revision"], "change_type": change_type,
                "source_unit_ids": [],
            }
        item = {
            "key": spec["key"], "target_doc_id": self.tobe_ids[spec["code"]], "kind": spec["kind"],
            "slot_key": spec.get("slot_key"), "wi_step": spec.get("wi_step"), "wi_part": spec.get("wi_part"),
            "change_type": change_type, "source_unit_ids": [],
        }
        if spec["kind"] == "sentence":
            item["text"] = spec["text"]
        if spec["kind"] == "table":
            item["grid"] = spec["grid"]
        if "parent_key" in spec:  # 칸 새 문장 — 출처는 표 답과 같은 문서의 칸 문장
            cell = _find_unit(self.views[answer["doc"]], spec["source_text"], 1, ("cell_sentence",))
            item.update(
                parent_key=spec["parent_key"], cell_row=spec["cell_row"], cell_col=spec["cell_col"],
                source_unit_ids=[cell["id"]],
            )
        return item

    def _describe_spec(self, spec: dict) -> tuple:
        return (self.tobe_ids[spec["code"]], spec["kind"], spec.get("text", ""), spec["change_type"])

    def confirm_identical_and_new(self) -> None:
        """같은 글자 1:1 후보가 기대 정답의 같은 글자 답과 꼭 맞는지 보고, 신규와 함께 한 번에 확정한다."""
        identical = {answer["text"]: answer for answer in self.expected["answers"] if answer.get("identical")}
        candidates = self.get("/match/identical-candidates")
        assert len(candidates) == self.expected["match"]["identical_count"] == len(identical)
        assert {candidate["text"] for candidate in candidates} == set(identical)
        revisions = self.load_decision_revisions()
        items = []
        for candidate in candidates:
            answer = identical[candidate["text"]]
            (spec,) = answer["targets"]
            target = self.find_match_target(spec["code"], spec["text"])
            assert (candidate["unit_id"], candidate["target_id"]) == (self.find_answer_unit(answer)["id"], target["id"])
            items.append({
                "unit_id": candidate["unit_id"], "unit_revision": revisions[candidate["unit_id"]],
                "target_id": target["id"], "target_revision": target["revision"],
            })
        new = []
        for spec in self.expected["match"]["new_texts"]:
            target = self.find_match_target(spec["doc"], spec["text"])
            new.append({"target_id": target["id"], "revision": target["revision"]})
        saved = self.post("/match/bulk-confirm", {"identical": items, "new": new})
        assert sorted(target["change_type"] for target in saved["targets"]) == sorted(
            ["as_is"] * len(items) + ["new"] * len(new)
        )

    # 5단계 이후

    def put_semantic_checks(self) -> None:
        body = {"revision": self.bundle_revision(), "checks": dict.fromkeys(SEMANTIC_CHECK_KEYS, True)}
        response = self.client.put(self._url("/semantic-checks"), json=body, headers=self.headers)
        assert response.status_code == 200, response.text

    def request_review(self) -> tuple[int, dict]:
        response = self.client.post(
            self._url("/review/request"), json={"revision": self.bundle_revision()}, headers=self.headers
        )
        return response.status_code, response.json()

    def load_outputs(self) -> dict[str, dict]:
        return {
            lang: {name: self.get(f"/outputs/{name}", lang=lang) for name in ("a", "b", "c")} for lang in LANGS
        }


def _find_unit(view: dict, text: str, occurrence: int, kinds: tuple[str, ...]) -> dict:
    """글자가 정확히 text인 그 종류 활성 단위 중 occurrence번째(1부터)."""
    matches = [unit for unit in view["units"] if unit["text"] == text and unit["kind"] in kinds]
    assert len(matches) >= occurrence, (view["document"]["doc_code"], text, kinds, len(matches))
    return matches[occurrence - 1]


def _iter_items(doc: dict) -> Iterator[dict]:
    """결과물 C 문서의 새 문장(칸 새 문장 포함) — 각 항목에 칸 위치 키를 붙여 낸다."""
    for section in doc["sections"]:
        stack = [(item, section["location_key"]) for item in section["items"]]
        while stack:
            item, location_key = stack.pop(0)
            yield {**item, "location_key": location_key}
            stack += [(child, location_key) for child in item["children"]]


def _describe_saved(target: dict) -> tuple:
    return (target["target_doc_id"], target["kind"], target["confirmed_text"], target["change_type"])


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
        for item in _iter_items(doc)
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
    run = _Driver(client, synthetic, AUTHOR)

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
        _find_unit(run.views[answer["doc"]], spec["source_text"], 1, ("cell_sentence",))["id"]
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
    omitted_unit = _find_unit(run.views[omitted["doc"]], omitted["text"], omitted["occurrence"], TEXT_KINDS)
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
        run = _Driver(client, synthetic, headers)
        run.start()
        run.save_answers(skip_omitted=False)
        loaded = run.load_outputs()
        for lang in LANGS:
            loaded[lang]["b"] = _normalize_flow(loaded[lang]["b"])
        outputs.append(_strip_volatile(loaded))

    first, second = outputs
    assert first == second
