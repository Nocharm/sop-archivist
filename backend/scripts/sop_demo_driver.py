"""합성 묶음 하나를 기대 정답대로 API로 모는 드라이버 — E2E 테스트와 로컬 데모 시드가 같이 써서 로직을 두 벌 두지 않는다.

모든 저장은 생성기가 쓴 기대 정답(SYNTHETIC_expected.json)만 보고 만든다 — 단위는 (문서 번호, 글자, 몇 번째)로 찾는다.
개발 전용이다 — 테스트 헬퍼(tests.sop_helpers)를 쓰고 요청이 틀리면 assert로 멈춘다. 운영 이미지에서는 부르지 않는다.
"""

from collections import defaultdict
from collections.abc import Iterator

from fastapi.testclient import TestClient

from app.sop.constants import SEMANTIC_CHECK_KEYS
from scripts.synthetic_sop import SyntheticBundle
from tests.sop_helpers import (
    REVIEWER,
    create_bundle,
    get_bundle,
    get_view,
    put_tobe,
    save_group,
    set_doc_version,
    set_members,
    upload,
)

REVIEWER_LOGIN = REVIEWER["X-Dev-User"]
TEXT_KINDS = ("sentence", "heading", "cell_sentence")  # kind 없는 답이 가리키는 글 단위
DEFAULT_LAYOUT = "ko_en_interleaved"
# 요청에 실을 수 있는 변경 종류 — 나눔·합침·신규는 서버가 구조로 정한다
REQUESTABLE_CHANGE_TYPES = ("as_is", "tone", "rewritten", "table_restructured")
LANGS = ("ko", "en")


class SyntheticDriver:
    """합성 묶음 하나를 기대 정답대로 모는 API 클라이언트 — 묶음·문서·To-Be id와 문서별 원문 대조 데이터를 들고 있다."""

    def __init__(
        self, client: TestClient, synthetic: SyntheticBundle, headers: dict[str, str], *, title: str | None = None
    ) -> None:
        self.client, self.synthetic, self.headers = client, synthetic, headers
        self.expected = synthetic.expected
        self.title = title or self.expected["bundle_title"]
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
        self.bundle_id = create_bundle(self.client, title=self.title, headers=self.headers, is_synthetic=True)["id"]
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
            if document.layout != DEFAULT_LAYOUT:
                self._patch_layout(uploaded, document.layout)
                uploaded = self._get_document(uploaded["id"])
            if document.side == "old" and not uploaded["doc_version"]:  # 검토 요청 조건 — 파일 이름에 버전이 없으면 1.0
                uploaded = set_doc_version(self.client, self.bundle_id, uploaded, headers=self.headers)
            self.uploads[uploaded["doc_code"]] = uploaded
        self.tobe_ids = {doc["code"]: doc["id"] for doc in self.get("/tobe")["docs"]}
        for edit in self.expected["edits"]:
            self._apply_edit(edit)
        self.refresh_views()

    def confirm_boundaries(self) -> None:
        """올린 문서 모두에서 남은 단위의 경계를 한 번에 확인한다 — 검토 요청 조건이라 쪼개기 편집이 끝난 뒤에 부른다."""
        for uploaded in self.uploads.values():
            response = self.client.post(
                self._url(f"/documents/{uploaded['id']}/units/boundary/all"), headers=self.headers
            )
            assert response.status_code == 200, response.text
        self.refresh_views()

    def delete_bundle(self) -> None:
        """묶음을 지운다 — 만들다 만 묶음이 제목만 남아 다음 실행을 막지 않게 데모 시드가 정리할 때 쓴다."""
        response = self.client.delete(
            self._url(""), params={"revision": self.bundle_revision()}, headers=self.headers
        )
        assert response.status_code == 204, response.text

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

    def _get_document(self, doc_id: int) -> dict:
        return next(doc for doc in self.get("/documents") if doc["id"] == doc_id)

    def _patch_layout(self, uploaded: dict, layout: str) -> None:
        body = {"revision": uploaded["revision"], "language_layout": layout}
        response = self.client.patch(self._url(f"/documents/{uploaded['id']}"), json=body, headers=self.headers)
        assert response.status_code == 200, response.text
        assert response.json()["language_layout"] == layout

    def _apply_edit(self, edit: dict) -> None:
        view = get_view(self.client, self.bundle_id, self.uploads[edit["doc"]]["id"], self.headers)
        if edit["op"] == "split":
            unit = find_unit_by_text(view, edit["unit_text"], edit.get("occurrence", 1), TEXT_KINDS)
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
        return find_unit_by_text(self.views[answer["doc"]], answer["text"], answer["occurrence"], kinds)

    def load_decision_revisions(self) -> dict[int, int]:
        """옛 단위 판단의 지금 revision — 묶음의 옛 활성 단위 전부를 한 번에 읽는다."""
        page = self.get("/units", limit="1000")
        assert page["total"] == len(page["items"])
        return {item["unit_id"]: item["decision"]["revision"] for item in page["items"]}

    def find_match_target(self, code: str, text: str) -> dict:
        """입구 2 새 문서의 새 문장(글자로 찾는다)과 그 지금 revision·자리."""
        if not self._match_targets:
            for doc in self.get("/outputs/c")["docs"]:
                if doc["entrance"] == "match":
                    for item in iter_c_items(doc):
                        self._match_targets[(doc["code"], item["text"])] = item["target_id"]
        target_id = self._match_targets[(code, text)]
        group = self.get(f"/groups/by-target/{target_id}")
        return next(target for target in group["targets"] if target["id"] == target_id)

    # 4·6단계: 저장

    def save_answers(self, *, skip_omitted: bool) -> None:
        self._save_groups(self._group_answers(skip_omitted=skip_omitted))

    def _save_groups(self, groups: dict[str, list[dict]]) -> None:
        """입구 1 답을 group별로 저장하고, 입구 2는 같은 글자 후보·신규를 한 번에 확정한 뒤 나머지를 관계 묶음으로 맞춘다."""
        match_docs = self._find_match_docs()
        revisions = self.load_decision_revisions()
        for answers in groups.values():
            if not {answer["doc"] for answer in answers} & match_docs:
                self.save_group(answers, revisions)
        self.confirm_identical_and_new()
        revisions = self.load_decision_revisions()
        for answers in groups.values():
            if {answer["doc"] for answer in answers} & match_docs:
                self.save_group(answers, revisions)

    def save_entrance1_half(self) -> None:
        """입구 1 답을 앞에서부터 절반 넘게 쌓일 때까지 group 단위로 저장한다 — 입구 2 문서의 답은 건드리지 않는다."""
        match_docs = self._find_match_docs()
        groups = [
            answers for answers in self._group_answers().values()
            if not {answer["doc"] for answer in answers} & match_docs
        ]
        revisions = self.load_decision_revisions()
        total = sum(len(answers) for answers in groups)
        saved = 0
        for answers in groups:
            if saved * 2 >= total:
                break
            self.save_group(answers, revisions)
            saved += len(answers)

    def save_omitted(self) -> None:
        (answers,) = self._group_answers(only_omitted=True).values()
        self.save_group(answers, self.load_decision_revisions())

    def _find_match_docs(self) -> set[str]:
        """입구 2 새 문서에 새 문장을 보내는 답이 있는 옛 문서 번호."""
        return {
            answer["doc"] for answer in self.expected["answers"]
            if any("section_path" in target for target in answer["targets"])
        }

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
            cell = find_unit_by_text(self.views[answer["doc"]], spec["source_text"], 1, ("cell_sentence",))
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
            if target["status"] != "confirmed":  # AI 신규 제안을 사람이 이미 받았으면 끝난 줄이다
                new.append({"target_id": target["id"], "revision": target["revision"]})
        saved = self.post("/match/bulk-confirm", {"identical": items, "new": new})
        assert sorted(target["change_type"] for target in saved["targets"]) == sorted(
            ["as_is"] * len(items) + ["new"] * len(new)
        )

    # 4단계의 AI 경로: 요청 → 사람이 제안을 받는다 → 남은 답을 저장한다

    def request_classification(self) -> None:
        """구조 제목을 일괄 삭제한 뒤 입구 1 문서마다 분류를, 이어서 입구 2 짝 계획을 요청한다.

        일괄 처분은 AI 제안 단위를 받지 않아(409 ai_suggested_units) AI 앞에 끝낸다. 작업은 쌓인 순서로 돌아 계획은 분류가 남긴 미배정만 본다.
        """
        revisions = self.load_decision_revisions()
        for answers in self._group_answers().values():
            if any(answer.get("bulk") for answer in answers):
                self.save_group(answers, revisions)
        match_docs = self._find_match_docs()
        for code, view in self.views.items():
            if view["document"]["side"] == "old" and code not in match_docs:
                self.post("/ai/classify", {"document_id": view["document"]["id"]})
        self.post("/ai/match", {})

    def confirm_suggestions(self) -> int:
        """적용된 AI 제안을 사람이 그대로 받는다 — 제안마다 관계 묶음 저장 한 번이고, 받은 제안 수를 돌려준다."""
        answers = {self.find_answer_unit(answer)["id"]: answer for answer in self.expected["answers"]}
        page = self.get("/ai/suggestions", result="applied", limit="1000")
        assert page["total"] == len(page["items"])
        for suggestion in page["items"]:
            self._accept_suggestion(suggestion["content"], answers)
        return page["total"]

    def _accept_suggestion(self, content: dict, answers: dict[int, dict]) -> None:
        """제안의 묶음을 그대로 확정한다 — 글·변경 종류를 비워 보내면 서버가 제안대로 정하고, 구조 종류는 보내지 않는다. 사유만 사람이 적는다.

        신규 제안은 단위가 없어 새 문장으로 묶음을 읽는다. 짝은 언어마다 묶음이 따로라 한 저장에 모은다. 표는 가짜 AI가 무효로 답해 여기 오지 않는다.
        """
        paths = [f"/groups/by-unit/{unit_id}" for unit_id in content["unit_ids"]] or [
            f"/groups/by-target/{target_id}" for target_id in content["target_ids"]
        ]
        groups = [self.get(path) for path in paths]
        units = {unit["unit_id"]: unit for group in groups for unit in group["units"]}
        targets = {target["id"]: target for group in groups for target in group["targets"]}
        body = {
            "action": "confirm",
            "units": [
                {
                    "unit_id": unit_id, "revision": unit["decision"]["revision"], "disposition": unit["decision"]["disposition"],
                    "reason": answers[unit_id]["reason"],
                }
                for unit_id, unit in units.items()
            ],
            "targets": [
                {
                    "key": str(target_id), "id": target_id, "revision": target["revision"], "kind": target["kind"],
                    "slot_key": target["slot_key"], "wi_step": target["wi_step"], "wi_part": target["wi_part"],
                    "source_unit_ids": target["source_unit_ids"],
                }
                for target_id, target in targets.items()
            ],
        }
        response = save_group(self.client, self.bundle_id, body, self.headers)
        assert response.status_code == 200, response.text

    def settle_remaining(self) -> None:
        """AI가 끝내지 못한 답을 정답대로 저장한다 — 보류는 확정이 지우고, 입구 2 같은 글자 후보와 남은 신규도 여기서 확정한다."""
        statuses = {item["unit_id"]: item["status"] for item in self.get("/units", limit="1000")["items"]}
        self._save_groups({
            group: answers for group, answers in self._group_answers().items()
            if any(statuses[self.find_answer_unit(answer)["id"]] != "confirmed" for answer in answers)
        })

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

    def load_outputs(self) -> dict[str, dict | list]:
        """결과물 A·B·C 한 벌(`"a"`·`"b"`·`"c"`) — 라벨은 기본 언어(en)."""
        return {name: self.get(f"/outputs/{name}") for name in ("a", "b", "c")}


def find_unit_by_text(view: dict, text: str, occurrence: int, kinds: tuple[str, ...]) -> dict:
    """글자가 정확히 text인 그 종류 활성 단위 중 occurrence번째(1부터)."""
    matches = [unit for unit in view["units"] if unit["text"] == text and unit["kind"] in kinds]
    assert len(matches) >= occurrence, (view["document"]["doc_code"], text, kinds, len(matches))
    return matches[occurrence - 1]


def iter_c_items(doc: dict) -> Iterator[dict]:
    """결과물 C 문서의 새 문장(칸 새 문장 포함) — 각 항목에 칸 위치 키를 붙여 낸다."""
    for section in doc["sections"]:
        stack = [(item, section["location_key"]) for item in section["items"]]
        while stack:
            item, location_key = stack.pop(0)
            yield {**item, "location_key": location_key}
            stack += [(child, location_key) for child in item["children"]]


def _describe_saved(target: dict) -> tuple:
    return (target["target_doc_id"], target["kind"], target["confirmed_text"], target["change_type"])
