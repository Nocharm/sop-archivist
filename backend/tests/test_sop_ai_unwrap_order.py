"""AI 벗긴 표 순서 제안 — 요청 검증, 순열 검사, 덩이 기준 낡음, 순서 바꾸기 편집과의 연결, 채택 기록, 마이그레이션 CHECK (B11)."""

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
from app.sop.ai.unwrap_order_job import UNWRAP_ORDER_KIND
from app.sop.models import AiJob, AiSuggestion, BundleEvent, Unit
from tests.access_helpers import run_in_session
from tests.ai_fixtures import (
    AiBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    edit_document,
    make_ai_bundle,
    read_rows,
    request_classify,
    run_jobs,
    upload_second_document,
)
from tests.docx_factory import build_docx, make_grid_table, make_row
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, REVIEWER, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

LABEL_TABLE = make_grid_table(2, make_row(["항목", "값"]) + make_row(["압력", "10 bar"]) + make_row(["온도", "20도"]))
DATA_TABLE = make_grid_table(2, make_row(["합성 항목", "합성 값"]) + make_row(["합성 압력", "10 bar"]))
SINGLE_TABLE = make_grid_table(1, make_row(["합성 단독 칸"]))
MARKER = "RAW-REPLY-MARKER"
NEW_FILE = "SYNTHETIC_NEW-ORDER_Table.docx"


def request_order(
    client: TestClient, bundle_id: int, document_id: int, table_id: int, *, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    body = {"document_id": document_id, "table_id": table_id}
    return client.post(f"/api/bundles/{bundle_id}/ai/unwrap_order", json=body, headers=headers)


def adopt(client: TestClient, bundle_id: int, suggestion_id: int, adoption: str) -> httpx2.Response:
    return client.post(
        f"/api/bundles/{bundle_id}/ai/suggestions/{suggestion_id}/adoption", json={"adoption": adoption}, headers=AUTHOR
    )


def read_lines(client: TestClient, bundle_id: int, document_id: int, table_id: int) -> list[dict]:
    """덩이의 줄 — 원문 순서다. 줄 순서를 직접 다룬 시험은 unwrap_seq를 함께 본다."""
    view = get_view(client, bundle_id, document_id)
    return [
        unit for unit in view["units"]
        if unit["table_id"] == table_id and unit["kind"] == "cell_sentence" and unit["group_unit_id"] is None
    ]


class Block:
    """벗긴 표 덩이 하나가 든 묶음 — 문서·표 id와 원문 순서의 줄 id."""

    def __init__(
        self, client: TestClient, body: str, table_index: int = 0, *, unwrap: bool = True, side: str = "old"
    ) -> None:
        self.client = client
        self.bundle: AiBundle = make_ai_bundle(client)
        if side == "new":
            uploaded = upload(client, self.bundle.id, build_docx(body), NEW_FILE, side="new", doc_type="sop")
            assert uploaded.status_code == 201 and uploaded.json()["status"] == "ready", uploaded.text
            view = get_view(client, self.bundle.id, uploaded.json()["id"])
        else:
            view = upload_second_document(client, self.bundle.id, body)
        self.document_id = view["document"]["id"]
        self.table_id = view["tables"][table_index]["id"]
        if unwrap:
            edit_document(
                client, self.bundle.id, self.document_id,
                {"type": "set_layout_table", "table_id": self.table_id, "is_layout": True},
            )

    def read_lines(self) -> list[dict]:
        return read_lines(self.client, self.bundle.id, self.document_id, self.table_id)

    def request(self, **kwargs: object) -> httpx2.Response:
        return request_order(self.client, self.bundle.id, self.document_id, self.table_id, **kwargs)  # type: ignore[arg-type]


def use_order(ai: FakeAi, order: list[int] | None = None) -> None:
    """응답을 정한다 — order를 안 주면 요청에 실린 줄 id를 거꾸로 돌려준다."""

    def chat(data: dict) -> str:
        ids = order if order is not None else [line["id"] for line in data["lines"]][::-1]
        return json.dumps({"order": ids, "reason": "합성 이유."}, ensure_ascii=False)

    ai.chat = chat


def read_suggestions() -> list[AiSuggestion]:
    return [row for row in read_rows(AiSuggestion) if row.kind == UNWRAP_ORDER_KIND]


def read_single_suggestion() -> AiSuggestion:
    (suggestion,) = read_suggestions()
    return suggestion


def write_units(**changes: object) -> None:
    """모든 단위의 열을 바꾼다 — 호출 동안 끼어든 편집을 DB로 흉내 낸다."""

    async def _write(session: AsyncSession) -> None:
        await session.execute(update(Unit).values(**changes))
        await session.commit()

    run_in_thread(_write)


def run_in_thread(write: Callable[[AsyncSession], Awaitable[None]]) -> None:
    """훅은 실행기의 이벤트 루프 안에서 돌아 run_in_session을 바로 못 부른다 — 다른 스레드에서 돌린다."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(run_in_session, write).result()


# --- 요청 ---


def test_request_queues_one_job_for_the_table(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)

    response = block.request()

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["queued"], body["skipped_total"], body["skipped"], body["skipped_by_reason"]) == (1, 0, [], {})
    (job,) = read_rows(AiJob)
    assert (job.kind, job.document_id, job.payload, job.status) == (
        UNWRAP_ORDER_KIND, block.document_id, {"table_id": block.table_id}, "queued"
    )
    events = [event for event in read_rows(BundleEvent) if event.action == "ai.request"]
    assert [(event.target_ids, event.reason) for event in events] == [([job.id], UNWRAP_ORDER_KIND)]


def test_a_table_that_is_not_unwrapped_is_refused(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, DATA_TABLE, unwrap=False)

    response = block.request()

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "unwrap_not_unwrapped", "table_id": block.table_id}
    assert read_rows(AiJob) == []


def test_a_block_with_fewer_than_two_lines_is_refused(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, SINGLE_TABLE)
    assert len(block.read_lines()) == 1

    response = block.request()

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "unwrap_too_few_lines", "table_id": block.table_id}


def test_unknown_document_or_table_is_not_found(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)

    missing_table = request_order(client, block.bundle.id, block.document_id, block.table_id + 10_000)
    missing_document = request_order(client, block.bundle.id, block.document_id + 10_000, block.table_id)

    assert missing_table.status_code == 404
    assert missing_document.status_code == 404


def test_requesting_again_while_a_job_is_active_queues_nothing(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    assert block.request().json()["queued"] == 1

    again = block.request()

    assert again.status_code == 200
    assert (again.json()["queued"], again.json()["request_id"]) == (0, None)
    assert len(read_rows(AiJob)) == 1


def test_request_needs_ai_and_an_author(client: TestClient, fake_ai: FakeAi, monkeypatch: pytest.MonkeyPatch) -> None:
    block = Block(client, LABEL_TABLE)

    assert block.request(headers=REVIEWER).status_code == 403
    monkeypatch.setattr("app.routers.sop_ai.settings.ai_enabled", False)
    off = block.request()

    assert off.status_code == 503
    assert off.json()["detail"]["code"] == "ai_disabled"
    assert read_rows(AiJob) == []


# --- 제안 ---


def test_happy_path_writes_an_applied_suggestion_and_the_payload_has_no_names(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    lines = block.read_lines()
    use_order(fake_ai)
    block.request()

    run_jobs()

    (job,) = read_rows(AiJob)
    assert job.status == "done"
    suggestion = read_single_suggestion()
    assert suggestion.result == "applied" and suggestion.adoption is None
    assert suggestion.document_id == block.document_id
    assert suggestion.content == {
        "table_id": block.table_id, "unit_ids": [line["id"] for line in lines][::-1], "reason": "합성 이유.",
    }
    assert set(suggestion.guideline_versions) == {"prompt.unwrap_order"}
    # 요청 글: 표 Markdown과 줄(id·글·칸 위치)뿐이다
    (data,) = fake_ai.requests
    assert data["task"] == UNWRAP_ORDER_KIND and "| 항목 | 값 |" in data["table"]
    assert {line["id"]: line["text"] for line in data["lines"]} == {line["id"]: line["text"] for line in lines}
    assert all(set(line) == {"id", "text", "row", "col"} for line in data["lines"])
    payload_text = json.dumps(fake_ai.bodies, ensure_ascii=False)
    assert AUTHOR["X-Dev-User"] not in payload_text and REVIEWER["X-Dev-User"] not in payload_text


# --- New 문서 (쪼개기 먼저 설계 §8 4-3: 벗긴 New 표에도 순서 제안) ---


def test_order_request_accepts_a_new_document_table(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE, side="new")
    lines = block.read_lines()
    use_order(fake_ai)

    response = block.request()
    run_jobs()

    assert response.status_code == 200, response.text
    assert response.json()["queued"] == 1
    suggestion = read_single_suggestion()
    assert (suggestion.result, suggestion.document_id) == ("applied", block.document_id)
    assert suggestion.content["unit_ids"] == [line["id"] for line in lines][::-1]


def test_new_table_order_payload_has_no_names(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE, side="new")
    use_order(fake_ai)
    block.request()

    run_jobs()

    (data,) = fake_ai.requests
    assert all(set(line) == {"id", "text", "row", "col"} for line in data["lines"])
    payload_text = json.dumps(fake_ai.bodies, ensure_ascii=False)
    assert AUTHOR["X-Dev-User"] not in payload_text and REVIEWER["X-Dev-User"] not in payload_text


def test_classify_still_refuses_a_new_document(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE, side="new")

    response = request_classify(client, block.bundle.id, document_id=block.document_id)

    assert (response.status_code, response.json()["detail"]["code"]) == (404, "document_not_found")


def test_suggested_order_is_accepted_by_the_reorder_edit(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    run_jobs()
    content = read_single_suggestion().content

    edit_document(
        client, block.bundle.id, block.document_id,
        {"type": "reorder_unwrapped", "table_id": content["table_id"], "unit_ids": content["unit_ids"]},
    )

    ordered = sorted(block.read_lines(), key=lambda line: line["unwrap_seq"])
    assert [line["id"] for line in ordered] == content["unit_ids"]


@pytest.mark.parametrize(
    "bad_order", ["short", "repeat", "foreign"], ids=["a line missing", "a line repeated", "an id outside the block"]
)
def test_a_reply_that_is_not_a_permutation_is_invalid_and_keeps_no_reply_text(
    client: TestClient, fake_ai: FakeAi, bad_order: str
) -> None:
    block = Block(client, LABEL_TABLE)
    ids = [line["id"] for line in block.read_lines()]
    order = {"short": ids[:-1], "repeat": [*ids[:-1], ids[0]], "foreign": [*ids[:-1], max(ids) + 10_000]}[bad_order]
    fake_ai.chat = lambda data: json.dumps({"order": order, "reason": MARKER})
    block.request()

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "invalid"
    assert suggestion.content == {"table_id": block.table_id, "unit_ids": [], "reason": ""}
    assert MARKER not in json.dumps([suggestion.content, suggestion.warnings, suggestion.input_refs], ensure_ascii=False)
    assert [warning["kind"] for warning in suggestion.warnings] == ["order_mismatch"]
    assert [job.status for job in read_rows(AiJob)] == ["done"]


def test_a_reply_in_the_wrong_shape_is_invalid(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    fake_ai.chat = lambda data: f"not json {MARKER}"
    block.request()

    run_jobs()

    suggestion = read_single_suggestion()
    assert (suggestion.result, [warning["kind"] for warning in suggestion.warnings]) == ("invalid", ["invalid_format"])
    assert MARKER not in json.dumps([suggestion.content, suggestion.warnings], ensure_ascii=False)


# --- 낡음 ---


def test_a_line_text_changed_during_the_call_makes_the_suggestion_stale(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    fake_ai.on_chat = lambda data: write_units(text="합성 바뀐 글")
    block.request()

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]
    assert read_single_suggestion().result == "stale"


def test_a_line_set_changed_during_the_call_makes_the_suggestion_stale(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    fake_ai.on_chat = lambda data: write_units(status="retired")
    block.request()

    run_jobs()

    assert read_single_suggestion().result == "stale"


def test_a_table_wrapped_again_during_the_call_makes_the_suggestion_stale(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    edit_document(
        client, block.bundle.id, block.document_id,
        {"type": "set_layout_table", "table_id": block.table_id, "is_layout": False}, confirm=True,
    )

    run_jobs()

    assert [job.status for job in read_rows(AiJob)] == ["stale"]  # 줄이 사라져 load가 덩이를 못 읽는다
    assert read_suggestions() == []


def test_a_reorder_by_the_user_during_the_call_keeps_the_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    ids = [line["id"] for line in block.read_lines()]
    use_order(fake_ai)

    def reorder(data: dict) -> None:
        async def _write(session: AsyncSession) -> None:
            for index, unit_id in enumerate(ids[::-1]):
                await session.execute(update(Unit).where(Unit.id == unit_id).values(unwrap_seq=index))
            await session.commit()

        run_in_thread(_write)

    fake_ai.on_chat = reorder
    block.request()

    run_jobs()

    suggestion = read_single_suggestion()
    assert suggestion.result == "applied"
    assert sorted(suggestion.content["unit_ids"]) == sorted(ids)


def test_a_new_answer_retires_the_older_open_suggestion_of_the_same_table(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    ids = [line["id"] for line in block.read_lines()]
    use_order(fake_ai, ids[::-1])
    block.request()
    run_jobs()
    use_order(fake_ai, ids)
    block.request()

    run_jobs()

    older, newer = sorted(read_suggestions(), key=lambda row: row.id)
    assert (older.result, newer.result) == ("stale", "applied")
    assert newer.content["unit_ids"] == ids


def test_an_adopted_suggestion_is_not_retired_by_a_new_answer(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    run_jobs()
    older = read_single_suggestion()
    assert adopt(client, block.bundle.id, older.id, "as_is").status_code == 200
    block.request()

    run_jobs()

    assert sorted(row.result for row in read_suggestions()) == ["applied", "applied"]


# --- 채택 ---


def test_adoption_is_accepted_once_for_an_order_suggestion(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    run_jobs()
    suggestion = read_single_suggestion()

    first = adopt(client, block.bundle.id, suggestion.id, "as_is")
    second = adopt(client, block.bundle.id, suggestion.id, "rejected")

    assert first.status_code == 200, first.text
    assert (first.json()["adoption"], first.json()["adopted_by"]) == ("as_is", AUTHOR["X-Dev-User"])
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "not_manual_adoption"


def test_a_rejected_order_suggestion_is_counted_in_the_stats(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    run_jobs()
    suggestion = read_single_suggestion()
    before = client.get(f"/api/bundles/{block.bundle.id}/ai/status", headers=AUTHOR).json()["adoption"][UNWRAP_ORDER_KIND]
    assert before["pending"] == 1

    assert adopt(client, block.bundle.id, suggestion.id, "rejected").status_code == 200

    after = client.get(f"/api/bundles/{block.bundle.id}/ai/status", headers=AUTHOR).json()["adoption"][UNWRAP_ORDER_KIND]
    assert (after["applied"], after["rejected"], after["pending"]) == (1, 1, 0)


def test_applied_suggestions_are_listed_by_kind_and_document(client: TestClient, fake_ai: FakeAi) -> None:
    block = Block(client, LABEL_TABLE)
    use_order(fake_ai)
    block.request()
    run_jobs()

    response = client.get(
        f"/api/bundles/{block.bundle.id}/ai/suggestions",
        params={"kind": UNWRAP_ORDER_KIND, "result": "applied", "document_id": block.document_id}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    (item,) = response.json()["items"]
    assert (item["kind"], item["adoption"], item["content"]["table_id"]) == (UNWRAP_ORDER_KIND, None, block.table_id)


# --- 마이그레이션 ---


def test_migrated_jobs_table_accepts_the_new_kind(tmp_path: pathlib.Path) -> None:
    # compare_metadata가 CHECK 차이를 못 잡아 마이그레이션된 DB의 표 정의를 직접 읽는다
    db_path = tmp_path / "unwrap_order.db"
    run_migrations(f"sqlite+aiosqlite:///{db_path}")
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            definition = conn.execute(text("SELECT sql FROM sqlite_master WHERE name = 'ai_jobs'")).scalar_one()
    finally:
        engine.dispose()

    assert "'unwrap_order'" in definition and "ck_ai_jobs_kind" in definition
