"""결과물 스냅숏의 일관성 — 읽는 도중 커밋된 업로드, 사라진 판단 행, 읽기 경로의 트랜잭션 끝내기, 묶음 행 공유 잠금."""

import itertools
from collections.abc import AsyncIterator, Callable
from types import ModuleType

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Select, delete, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, engine, get_session
from app.main import app
from app.routers import sop_outputs
from app.sop import review, snapshot
from app.sop.ingest import ingest_upload
from app.sop.models import Bundle, Document, TargetSentence, UnitDecision
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, put_tobe, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

FIRST = "합성 첫 문장을 확인한다."
SECOND = "합성 둘째 문장을 기록한다."


def _create_bundle_with_document(client: TestClient) -> tuple[int, int]:
    """옛 문서 OLD-1(문장 둘과 표 하나)을 올린 묶음 — (묶음 id, 문서 id)."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    data = build_docx(p(FIRST) + p(SECOND) + tbl([["합성 칸"]]))
    response = upload(client, bundle_id, data, "SYNTHETIC_OLD-1_Snapshot.docx")
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle_id, response.json()["id"]


def _get_doc_codes(client: TestClient, bundle_id: int) -> set[str]:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return {row["old_doc_code"] for row in response.json()}


# Postgres에서는 업로드가 로더의 공유 잠금을 기다리므로 로더 안에서 업로드를 기다리는 이 갈고리는 서로를 기다린다
@pytest.mark.skipif(engine.dialect.name != "sqlite", reason="the race exists only without the bundle row lock")
def test_snapshot_ignores_a_document_committed_while_it_loads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """문서 목록을 읽은 뒤 다른 세션이 업로드(블록·단위·판단)를 커밋해도 결과물·개요가 500이 되지 않고, 늦게 온 문서는
    이번 결과에 섞이지 않는다. Postgres는 묶음 행 공유 잠금이 업로드를 기다리게 하지만 sqlite는 잠금이 없어 실제로 끼어든다.
    """
    bundle_id, _ = _create_bundle_with_document(client)
    load_documents = snapshot._load_documents
    late_numbers = itertools.count(2)

    async def _load_then_commit_upload(session: AsyncSession, loaded_bundle_id: int) -> object:
        loaded = await load_documents(session, loaded_bundle_id)
        number = next(late_numbers)
        async with SessionLocal() as other:
            await ingest_upload(
                other, bundle=await other.get_one(Bundle, loaded_bundle_id), side="old",
                file_name=f"SYNTHETIC_OLD-{number}_Late.docx",
                data=build_docx(p(f"합성 늦은 문장 {number}번.") + tbl([[f"합성 늦은 칸 {number}"]])),
                actor="qa.member", doc_type=None, parent_code=None,
            )
        return loaded

    monkeypatch.setattr(snapshot, "_load_documents", _load_then_commit_upload)
    rows = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR)
    overview = client.get(f"/api/bundles/{bundle_id}", headers=AUTHOR)
    monkeypatch.undo()

    assert rows.status_code == 200, rows.text
    assert {row["old_doc_code"] for row in rows.json()} == {"OLD-1"}
    assert overview.status_code == 200, overview.text
    # 업로드는 실제로 커밋됐다 — 다음 조회에는 늦게 온 문서 둘이 함께 나온다
    assert _get_doc_codes(client, bundle_id) == {"OLD-1", "OLD-2", "OLD-3"}


@pytest.mark.parametrize(
    ("path", "module"),
    [("outputs/a?lang=ko", sop_outputs), ("review/readiness", review)],
    ids=["output_a", "readiness"],
)
def test_snapshot_of_a_bundle_deleted_before_it_loads_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str, module: ModuleType
) -> None:
    """묶음 삭제의 FOR UPDATE를 기다리던 읽기는 깨어나면 행이 없다 — 멤버 검사를 지난 뒤라도 500이 아니라 404다."""
    bundle_id, _ = _create_bundle_with_document(client)

    async def _delete_then_load(session: AsyncSession, loaded_bundle_id: int, **options: bool) -> snapshot.BundleSnapshot:
        async with SessionLocal() as other:
            await other.execute(delete(Bundle).where(Bundle.id == loaded_bundle_id))
            await other.commit()
        return await snapshot.load_bundle_snapshot(session, loaded_bundle_id, **options)

    monkeypatch.setattr(module, "load_bundle_snapshot", _delete_then_load)
    response = client.get(f"/api/bundles/{bundle_id}/{path}", headers=AUTHOR)

    assert (response.status_code, response.json()["detail"]) == (404, {"code": "bundle_not_found"})


def test_snapshot_reads_a_missing_cover_decision_as_unassigned(client: TestClient) -> None:
    """판단 행이 없는 옛 단위(잠금 없이 읽는 사이 문서가 지워지면 생긴다)는 미배정으로 읽는다 — 결과물·요약·조건·개요가 500이 되지 않게."""
    bundle_id, document_id = _create_bundle_with_document(client)
    unit_id = find_unit(get_view(client, bundle_id, document_id), FIRST)["id"]

    async def _delete_decision(session: AsyncSession) -> None:
        await session.execute(delete(UnitDecision).where(UnitDecision.unit_id == unit_id))
        await session.commit()

    run_in_session(_delete_decision)

    rows = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR)
    assert rows.status_code == 200, rows.text
    (row,) = [row for row in rows.json() if row["unit_id"] == unit_id]
    assert (row["status"], row["dest_kind"], row["remark"]) == ("unassigned", "", "")
    for path in ("summary", "review/readiness", "outputs/b?lang=ko", "outputs/c?lang=ko"):
        response = client.get(f"/api/bundles/{bundle_id}/{path}", headers=AUTHOR)
        assert response.status_code == 200, (path, response.text)
    overview = client.get(f"/api/bundles/{bundle_id}", headers=AUTHOR)
    assert overview.status_code == 200, overview.text


@pytest.mark.parametrize(
    ("path", "params", "module", "name"),
    [
        ("outputs/a", {"lang": "ko"}, sop_outputs, "build_output_a"),
        ("outputs/b", {"lang": "ko"}, sop_outputs, "build_output_b"),
        ("outputs/c", {"lang": "ko"}, sop_outputs, "build_output_c"),
        ("summary", {}, sop_outputs, "build_summary"),
        ("export.xlsx", {"lang": "ko"}, sop_outputs, "build_workbook"),
        ("review/readiness", {}, review, "evaluate_readiness"),
        ("", {}, review, "evaluate_readiness"),
    ],
    ids=["output_a", "output_b", "output_c", "summary", "export", "readiness", "overview"],
)
def test_read_paths_end_the_transaction_before_the_pure_build(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    params: dict[str, str],
    module: ModuleType,
    name: str,
) -> None:
    """읽기 경로는 스냅숏을 다 읽으면 트랜잭션을 끝낸다 — 묶음 행 공유 잠금을 쥔 채 스레드 계산을 돌면 그동안 쓰기가 기다린다."""
    bundle_id, _ = _create_bundle_with_document(client)
    sessions: list[AsyncSession] = []

    async def _get_recorded_session() -> AsyncIterator[AsyncSession]:
        async with SessionLocal() as session:
            sessions.append(session)
            yield session

    build: Callable[..., object] = getattr(module, name)
    in_transaction: list[bool] = []

    def _record_then_build(*args: object, **kwargs: object) -> object:
        in_transaction.append(sessions[-1].in_transaction())
        return build(*args, **kwargs)

    monkeypatch.setitem(app.dependency_overrides, get_session, _get_recorded_session)
    monkeypatch.setattr(module, name, _record_then_build)
    response = client.get(f"/api/bundles/{bundle_id}/{path}".rstrip("/"), params=params, headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert in_transaction and not any(in_transaction), in_transaction


def test_snapshot_takes_a_shared_lock_on_the_bundle_row(client: TestClient) -> None:
    """쓰기는 모두 묶음 행을 FOR UPDATE로 먼저 잠그므로 스냅숏은 같은 행에 FOR SHARE를 걸어 Postgres에서 한 시점을 읽는다.

    sqlite는 잠금 구문을 그리지 않으므로 실행된 질의를 Postgres 방언으로 다시 그려 본다.
    """
    bundle_id, _ = _create_bundle_with_document(client)
    statements: list[object] = []

    def _record(_conn: object, clause: object, *_args: object) -> None:
        statements.append(clause)

    event.listen(engine.sync_engine, "before_execute", _record)
    try:
        response = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR)
    finally:
        event.remove(engine.sync_engine, "before_execute", _record)

    assert response.status_code == 200, response.text
    rendered = [str(stmt.compile(dialect=postgresql.dialect())) for stmt in statements if isinstance(stmt, Select)]
    locks = [sql for sql in rendered if sql.endswith("FOR SHARE")]
    assert len(locks) == 1 and "FROM bundles" in locks[0], rendered
    # 첫 질의 뒤의 문서 목록 질의는 잠금이 걸린 뒤에 돈다
    assert rendered.index(locks[0]) < next(i for i, sql in enumerate(rendered) if f"FROM {Document.__tablename__}" in sql)


def test_snapshot_reads_layout_and_remark(client: TestClient) -> None:
    bundle_id, document_id = _create_bundle_with_document(client)
    revision = get_view(client, bundle_id, document_id)["document"]["revision"]
    response = client.patch(
        f"/api/bundles/{bundle_id}/documents/{document_id}",
        json={"revision": revision, "language_layout": "ko_en_separate"}, headers=AUTHOR,
    )
    assert response.status_code == 200, response.text
    sop_id = put_tobe(
        client, bundle_id, [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
    ).json()["docs"][0]["id"]

    async def _add_target(session: AsyncSession) -> None:
        session.add(TargetSentence(
            bundle_id=bundle_id, target_doc_id=sop_id, slot_key="purpose", lang="ko", kind="sentence",
            confirmed_text="합성 새 문장", origin="new_doc", change_type="new", status="confirmed", remark="Synthetic remark",
        ))
        await session.commit()

    run_in_session(_add_target)

    async def _load(include_text: bool, session: AsyncSession) -> snapshot.BundleSnapshot:
        return await snapshot.load_bundle_snapshot(session, bundle_id, include_text=include_text)

    full = run_in_session(lambda session: _load(True, session))
    assert full.documents[document_id].language_layout == "ko_en_separate"
    assert [target.remark for target in full.targets.values()] == ["Synthetic remark"]
    light = run_in_session(lambda session: _load(False, session))
    assert [target.remark for target in light.targets.values()] == [""]
