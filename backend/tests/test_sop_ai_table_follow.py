"""AI 한글 표처럼 하기 제안 — 요청 검증, 응답 검사, 두 표 기준 낡음, follow_table 편집과의 연결, 채택 기록, 마이그레이션 CHECK (D2-R9 · R10, AC4 · AC5).

한/영 따로 합성 문서(test_sop_table_follow)의 작업 표 둘을 벗기고 한글 표를 손본다 — 임베딩이 꺼져 있어 줄 맞춤이 규칙으로 안 풀리는 AI 길이다.
"""

import json
import pathlib
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import run_migrations
from app.sop.ai.table_follow_job import TABLE_FOLLOW_KIND
from app.sop.models import AiJob, AiSuggestion, Unit
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AI_MEMBERS,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    read_rows,
    run_jobs,
)
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, set_members
from tests.test_sop_table_follow import (
    EN_STEPS_TABLE,
    KO_STEPS_TABLE,
    UNDO,
    _code,
    _edit,
    _get_follow,
    _read_lines,
    _setup,
    _setup_unwrapped,
    _to_op,
    _work_korean,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

MARKER = "RAW-REPLY-MARKER"


class Follow:
    """벗긴 한/영 표 둘이 든 묶음 — 한글 표를 손본 뒤의 영어 줄(덩이 차례)과 한글 줄."""

    def __init__(self, client: TestClient, *, work: bool = True) -> None:
        self.client = client
        self.bundle_id, self.document_id, self.tables, self.korean, self.english = _setup_unwrapped(client)
        self.table_id = self.tables[EN_STEPS_TABLE]
        assert set_members(client, self.bundle_id, AI_MEMBERS).status_code == 200
        if work:
            _work_korean(client, self.bundle_id, self.document_id, self.korean)

    def request(self, table_id: int | None = None, *, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
        body = {"document_id": self.document_id, "table_id": self.table_id if table_id is None else table_id}
        return self.client.post(f"/api/bundles/{self.bundle_id}/ai/table_follow", json=body, headers=headers)

    def adopt(self, suggestion_id: int, adoption: str) -> httpx2.Response:
        return self.client.post(
            f"/api/bundles/{self.bundle_id}/ai/suggestions/{suggestion_id}/adoption", json={"adoption": adoption}, headers=AUTHOR
        )

    def stats(self) -> dict:
        return self.client.get(f"/api/bundles/{self.bundle_id}/ai/status", headers=AUTHOR).json()["adoption"][TABLE_FOLLOW_KIND]


def build_actions(english: list[int]) -> list[dict]:
    """S18의 답 — 순서 둘을 바꾸고 번호 · 들여쓰기를 따르고 빈 칸 줄은 지운다."""
    return [
        {"id": english[0], "order": 2, "number": "5.2"},
        {"id": english[1], "order": 1, "number": "5.1"},
        {"id": english[2], "order": 3, "number": "5.2.1", "indent_shift": 1},
        {"id": english[3], "order": 4, "delete": True},
    ]


def use_actions(ai: FakeAi, actions: list[dict] | Callable[[dict], list[dict]], reason: str = "합성 이유.") -> None:
    """응답을 정한다 — 줄 목록을 받는 함수를 주면 요청에 실린 영어 줄 id로 만든다."""

    def chat(data: dict) -> str:
        made = actions([line["id"] for line in data["lines"]]) if callable(actions) else actions
        return json.dumps({"actions": made, "reason": reason}, ensure_ascii=False)

    ai.chat = chat


def read_suggestions() -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if row.kind == TABLE_FOLLOW_KIND]


def read_single_suggestion() -> AiSuggestion:
    (suggestion,) = read_suggestions()
    return suggestion


def run_in_thread(write: Callable[[AsyncSession], Awaitable[None]]) -> None:
    """훅은 실행기의 이벤트 루프 안에서 돌아 run_in_session을 바로 못 부른다 — 다른 스레드에서 돌린다."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(run_in_session, write).result()


def write_units(unit_ids: list[int], **changes: object) -> None:
    """단위의 열을 바꾼다 — 호출 동안 끼어든 편집을 DB로 흉내 낸다."""

    async def _write(session: AsyncSession) -> None:
        await session.execute(update(Unit).where(Unit.id.in_(unit_ids)).values(**changes))
        await session.commit()

    run_in_thread(_write)


# --- 요청 ---


def test_request_queues_one_job_for_the_table(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)

    response = follow.request()

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["queued"], body["skipped_total"], body["skipped"], body["skipped_by_reason"]) == (1, 0, [], {})
    (job,) = read_rows(AiJob)
    assert (job.kind, job.document_id, job.payload, job.status) == (
        TABLE_FOLLOW_KIND, follow.document_id, {"table_id": follow.table_id}, "queued"
    )


def test_a_rule_plan_queues_no_job(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client, work=False)  # 한글 표를 손대지 않아 제안이 없다(mode none)

    response = follow.request()

    assert _code(response) == (422, "follow_not_needed")
    assert response.json()["detail"]["table_id"] == follow.table_id
    assert read_rows(AiJob) == []


def test_a_new_document_is_refused(client: TestClient, fake_ai: FakeAi) -> None:
    bundle_id, document_id, tables = _setup(client, side="new")

    response = client.post(
        f"/api/bundles/{bundle_id}/ai/table_follow", json={"document_id": document_id, "table_id": tables[0]}, headers=AUTHOR
    )

    assert _code(response) == (422, "invalid_side")
    assert read_rows(AiJob) == []


def test_unknown_document_or_table_is_not_found(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)

    missing_table = follow.request(follow.table_id + 10_000)
    missing_document = client.post(
        f"/api/bundles/{follow.bundle_id}/ai/table_follow",
        json={"document_id": follow.document_id + 10_000, "table_id": follow.table_id}, headers=AUTHOR,
    )

    assert _code(missing_table) == (404, "table_not_found")
    assert _code(missing_document) == (404, "document_not_found")


def test_requesting_again_while_a_job_is_active_queues_nothing(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    assert follow.request().json()["queued"] == 1

    again = follow.request()

    assert again.status_code == 200
    assert (again.json()["queued"], again.json()["request_id"]) == (0, None)
    assert len(read_rows(AiJob)) == 1


def test_request_needs_ai_and_an_author(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    follow = Follow(client)

    assert follow.request(headers=REVIEWER).status_code == 403
    monkeypatch.setattr("app.routers.sop_ai.settings.ai_enabled", False)
    off = follow.request()

    assert off.status_code == 503
    assert off.json()["detail"]["code"] == "ai_disabled"
    assert read_rows(AiJob) == []


# --- 제안 ---


def test_payload_has_no_names(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    follow.request()

    run_jobs()

    (data,) = fake_ai.requests
    assert data["task"] == TABLE_FOLLOW_KIND
    assert [(line["text"], line["disposition"], line["order"], line["number"]) for line in data["source"]] == [
        ("장비를 준비한다.", "keep", 1, "5.1"), ("시료 10 mL를 채취한다.", "keep", 2, "5.2"),
        ("채취 뒤 4 °C에 둔다.", "keep", 3, "5.2.1"), ("(빈 칸)", "delete", 4, "4"),
    ]
    assert all(set(line) == {"text", "disposition", "order", "indent_shift", "number", "merged_texts"} for line in data["source"])
    assert [line["id"] for line in data["lines"]] == follow.english
    assert all(set(line) == {"id", "text", "indent_shift", "number"} for line in data["lines"])
    payload_text = json.dumps(fake_ai.bodies, ensure_ascii=False)
    assert AUTHOR["X-Dev-User"] not in payload_text and REVIEWER["X-Dev-User"] not in payload_text


def test_happy_path_writes_an_applied_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    english = follow.english
    use_actions(fake_ai, build_actions(english))
    follow.request()

    run_jobs()

    (job,) = read_rows(AiJob)
    assert job.status == "done"
    suggestion = read_single_suggestion()
    assert (suggestion.result, suggestion.adoption, suggestion.document_id) == ("applied", None, follow.document_id)
    assert set(suggestion.guideline_versions) == {"prompt.table_follow"}
    content = suggestion.content
    assert (content["table_id"], content["source_table_id"], content["lines"], content["reason"]) == (
        follow.table_id, follow.tables[KO_STEPS_TABLE], english, "합성 이유.",
    )
    # 규칙 제안(GET follow)과 같은 꼴의 일 — 덩이 차례, 순서는 맞춘 뒤 자리
    assert [(item["unit_ids"], item["order"], item["number"], item["indent"], item["indent_shift"], item["delete"]) for item in content["items"]] == [
        ([english[0]], 2, "5.2", False, None, False), ([english[1]], 1, "5.1", False, None, False),
        ([english[2]], None, "5.2.1", True, 1, False), ([english[3]], None, None, False, None, True),
    ]


def test_suggestion_is_applied_by_the_follow_edit_and_adopted_by_hand(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    english = follow.english
    use_actions(fake_ai, build_actions(english))
    follow.request()
    run_jobs()
    suggestion = read_single_suggestion()

    edited = _edit(client, follow.bundle_id, follow.document_id, _to_op(follow.table_id, suggestion.content), undo=UNDO)
    first = follow.adopt(suggestion.id, "as_is")
    second = follow.adopt(suggestion.id, "rejected")

    assert edited.status_code == 200, edited.text
    assert [line[1] for line in _read_lines(follow.table_id)] == ["5.1", "5.2", "5.2.1", "4"]
    assert [line[0] for line in _read_lines(follow.table_id)] == [english[1], english[0], english[2], english[3]]
    assert (first.status_code, first.json()["adoption"], first.json()["adopted_by"]) == (200, "as_is", AUTHOR["X-Dev-User"])
    assert (second.status_code, second.json()["detail"]["code"]) == (409, "not_manual_adoption")


def test_adoption_stats_count_it_as_manual(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    follow.request()
    run_jobs()
    suggestion = read_single_suggestion()
    assert follow.stats()["pending"] == 1  # 이어진 행이 없어도 채택이 비어 있는 동안 사람이 정할 몫이다

    assert follow.adopt(suggestion.id, "rejected").status_code == 200

    after = follow.stats()
    assert (after["applied"], after["rejected"], after["pending"]) == (1, 1, 0)


def test_a_merge_reply_becomes_one_merged_item(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    english = follow.english
    use_actions(fake_ai, [
        {"id": english[0], "order": 2, "number": "5.1"},  # 남는 줄의 번호를 읽는다
        {"id": english[1], "order": 1, "merge_with": english[0], "number": "9.9"},
        {"id": english[2], "order": 3, "number": "5.2"},
        {"id": english[3], "order": 4},
    ])
    follow.request()

    run_jobs()

    content = read_single_suggestion().content
    assert [(item["unit_ids"], item["order"], item["number"]) for item in content["items"]] == [
        ([english[0], english[1]], None, "5.1"), ([english[2]], None, "5.2"), ([english[3]], None, None),
    ]


@pytest.mark.parametrize(
    "bad", ["missing", "repeat", "foreign", "not-permutation", "loop", "merge-self", "long-number", "delete-merge"],
)
def test_bad_replies_are_invalid_and_keep_no_text(client: TestClient, fake_ai: FakeAi, bad: str) -> None:
    follow = Follow(client)
    ids = follow.english
    good = [{"id": unit_id, "order": index + 1} for index, unit_id in enumerate(ids)]
    actions = {
        "missing": good[:-1],
        "repeat": [*good[:-1], {**good[0], "order": 4}],
        "foreign": [*good[:-1], {"id": max(ids) + 10_000, "order": 4}],
        "not-permutation": [{**action, "order": 1} for action in good],
        "loop": [{**good[0], "merge_with": ids[1]}, {**good[1], "merge_with": ids[0]}, *good[2:]],
        "merge-self": [{**good[0], "merge_with": ids[0]}, *good[1:]],
        "long-number": [{**good[0], "number": "5" * 41}, *good[1:]],
        "delete-merge": [{**good[0], "delete": True, "merge_with": ids[1]}, *good[1:]],
    }[bad]
    use_actions(fake_ai, actions, reason=MARKER)
    follow.request()

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "invalid"
    assert (suggestion.content["items"], suggestion.content["lines"], suggestion.content["reason"]) == ([], [], "")
    assert MARKER not in json.dumps([suggestion.content, suggestion.warnings, suggestion.input_refs], ensure_ascii=False)
    assert [job.status for job in read_rows(AiJob)] == ["done"]


def test_a_reply_in_the_wrong_shape_is_invalid(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    fake_ai.chat = lambda data: f"not json {MARKER}"
    follow.request()

    run_jobs()

    suggestion = read_single_suggestion()
    assert (suggestion.result, [warning["kind"] for warning in suggestion.warnings]) == ("invalid", ["invalid_format"])
    assert MARKER not in json.dumps([suggestion.content, suggestion.warnings], ensure_ascii=False)


# --- 낡음 ---


def test_lines_changed_during_the_call_make_it_stale(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    fake_ai.on_chat = lambda data: write_units(follow.english, text="합성 바뀐 글")
    follow.request()

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert read_single_suggestion().result == "stale"


def test_korean_table_changed_during_the_call_makes_it_stale(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    fake_ai.on_chat = lambda data: write_units(follow.korean[:1], indent_shift=2)
    follow.request()

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert read_single_suggestion().result == "stale"


def test_a_reorder_of_the_english_lines_during_the_call_keeps_it(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))

    def reorder(data: dict) -> None:
        async def _write(session: AsyncSession) -> None:
            for index, unit_id in enumerate(follow.english[::-1]):
                await session.execute(update(Unit).where(Unit.id == unit_id).values(unwrap_seq=index))
            await session.commit()

        run_in_thread(_write)

    fake_ai.on_chat = reorder
    follow.request()

    run_jobs()

    assert read_single_suggestion().result == "applied"


def test_a_new_answer_retires_the_older_open_suggestion_of_the_same_table(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    follow.request()
    run_jobs()
    follow.request()

    run_jobs()

    older, newer = sorted(read_suggestions(), key=lambda row: row.id)
    assert (older.result, newer.result) == ("stale", "applied")


# --- 목록 · 마이그레이션 ---


def test_applied_suggestions_are_listed_by_kind_and_document(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    use_actions(fake_ai, build_actions(follow.english))
    follow.request()
    run_jobs()

    response = client.get(
        f"/api/bundles/{follow.bundle_id}/ai/suggestions",
        params={"kind": TABLE_FOLLOW_KIND, "result": "applied", "document_id": follow.document_id}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    (item,) = response.json()["items"]
    assert (item["kind"], item["adoption"], item["content"]["table_id"]) == (TABLE_FOLLOW_KIND, None, follow.table_id)


def test_the_rule_answer_of_get_follow_is_unchanged_by_the_ai_path(client: TestClient, fake_ai: FakeAi) -> None:
    follow = Follow(client)
    follow.request()
    run_jobs()

    answer = _get_follow(client, follow.bundle_id, follow.document_id, follow.table_id)

    assert (answer["mode"], answer["items"]) == ("ai", [])  # 제안이 쌓여도 GET은 저장을 읽지 않는다(D2-R7)


def test_migrated_jobs_table_accepts_the_new_kind(tmp_path: pathlib.Path) -> None:
    # compare_metadata가 CHECK 차이를 못 잡아 마이그레이션된 DB의 표 정의를 직접 읽는다
    db_path = tmp_path / "table_follow.db"
    run_migrations(f"sqlite+aiosqlite:///{db_path}")
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            definition = conn.execute(text("SELECT sql FROM sqlite_master WHERE name = 'ai_jobs'")).scalar_one()
    finally:
        engine.dispose()

    assert "'table_follow'" in definition and "'unwrap_order'" in definition and "ck_ai_jobs_kind" in definition
