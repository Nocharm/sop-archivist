"""로컬 데모 시드 — 합성 SOP 묶음 네 개를 서로 다른 단계로, 그 뒤에 참조 지도용 묶음 둘을 앱 API에 만든다. 로컬 개발 전용, 운영 실행 금지.

단계: 1 쪼개기 직후(업로드·언어 배치·편집까지), 2 분류 절반(입구 1 답의 절반 저장), 3 검토 대기(전부 저장 후 검토 요청),
4 AI 제안(가짜 AI의 분류·입구 2 짝 제안까지, 확정하지 않는다 — 합성 응답이고 실제 모델이 아니다).
작성자 qa.member, 검토자 qa.lead. 앱 API를 TestClient로 그대로 불러(X-Dev-User) 화면이 쓰는 경로와 로직을 두 벌 두지 않는다.
지도용: 5 UV 분광광도계(qa.member 작성자·qa.lead 검토자 — 작성자에게 구성원 Bundle), 6 문서 관리(끝에 prod.member 혼자 —
작성자에게 남의 Bundle). 단계 Bundle 넷의 OLD-1이 5번 문서 번호를, 단계 2·3의 이동 줄이 6번 New 문서를 가리키고 5·6번이 OLD-1~3을 가리킨다.
이미 같은 제목 묶음이 있으면 그 묶음은 건너뛰어 여러 번 돌려도 같은 결과다. 끝에 묶음별 상태·진행 숫자만 찍고 원문 글자는 찍지 않는다.

개발 전용이다 — 합성 생성기가 개발 의존성 python-docx와 테스트 팩토리(tests.pdf_factory)를 쓰고, 합성 파일은 임시 디렉터리에
만들어 끝나면 지운다. AUTH_MODE가 dev가 아니거나 HR 직원이 든 postgres(운영 의심)면 아무것도 만들지 않고 종료 코드 1로 멈춘다.
대상 DB는 DATABASE_URL(기본 backend/dev.db sqlite)이다. DEV_ENFORCE_PERMISSIONS=true면 데모 권한에 bundle.create가 없어 묶음 만들기가
403으로 멈추니 기본값(false)으로 돌린다.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_sop_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_sop_demo
"""

import asyncio
import sys
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from app.settings import settings
from app.sop.ai.runner import run_jobs_until_idle
from scripts.reset_db import count_hr_rows, should_refuse_reset
from scripts.sop_demo_driver import SyntheticDriver
from scripts.synthetic_sop import MOVE_TARGET_CODE, SyntheticBundle, build_synthetic_bundle
from tests.docx_factory import build_docx, p
from tests.fake_ai import SyntheticAnswers, fake_ai_session
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_view,
    put_tobe,
    set_members,
    upload,
)

PROGRESS_KEYS = ("total", "confirmed", "ai_suggested", "on_hold", "unassigned", "single_language")  # 출력하는 진행 숫자


@dataclass(frozen=True)
class DemoStage:
    title: str
    drive: Callable[[SyntheticDriver], None]  # 업로드·편집(start)이 끝난 묶음을 이 단계까지 더 모는 일


def _stop_after_split(driver: SyntheticDriver) -> None:
    """start()가 끝낸 상태(업로드·언어 배치·쪼개기 편집) 그대로 둔다."""


def _classify_half(driver: SyntheticDriver) -> None:
    driver.save_entrance1_half()


def _await_review(driver: SyntheticDriver) -> None:
    driver.save_answers(skip_omitted=False)
    driver.put_semantic_checks()
    status_code, body = driver.request_review()
    assert status_code == 200, body


def _suggest_with_ai(driver: SyntheticDriver) -> None:
    """가짜 AI의 제안까지만 — 프런트 분류 화면용이라 확정하지 않는다. 작업은 요청과 같은 앱 루프에서 돌린다(DB 연결이 그 루프에 묶여 있다)."""
    answers = SyntheticAnswers(driver.expected)
    with fake_ai_session() as fake:
        fake.chat, fake.embed = answers.chat, answers.embed
        driver.request_classification()
        driver.client.portal.call(run_jobs_until_idle)
    status = driver.get("/ai/status")
    assert status["jobs"]["failed"] == 0, status


DEMO_STAGES = (
    DemoStage("SYNTHETIC 1 쪼개기 직후", _stop_after_split),
    DemoStage("SYNTHETIC 2 분류 절반", _classify_half),
    DemoStage("SYNTHETIC 3 검토 대기", _await_review),
    DemoStage("SYNTHETIC 4 AI 제안", _suggest_with_ai),
)


def find_seed_refusal(auth_mode: str, *, is_postgres: bool, hr_rows: int) -> str | None:
    """시드를 멈출 사유 — 로컬 우회 인증(dev)이 아니거나 HR 직원이 든 postgres(운영 의심)면 사유, 아니면 None."""
    if auth_mode != "dev":
        return f"AUTH_MODE is {auth_mode} - the demo seed signs in with X-Dev-User and only runs with AUTH_MODE=dev"
    if should_refuse_reset(is_postgres, hr_rows):
        return f"{hr_rows} HR employees in a postgres database - the demo seed is only for a local demo database"
    return None


def drive_stage(client: TestClient, synthetic: SyntheticBundle, stage: DemoStage) -> None:
    """묶음 하나를 만들어 그 단계까지 모는다. 중간에 실패하면 그 묶음을 지우고 다시 던진다."""
    driver = SyntheticDriver(client, synthetic, AUTHOR, title=stage.title)
    try:
        driver.start()
        stage.drive(driver)
    except Exception:
        # 제목만 남은 반쪽 묶음은 다음 실행이 "이미 있다"며 건너뛰어 데모가 영영 덜 만들어진 채 남는다
        if driver.bundle_id:
            driver.delete_bundle()
        raise


def _list_bundles(client: TestClient, headers: dict[str, str] = AUTHOR) -> list[dict]:
    response = client.get("/api/bundles", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- 참조 지도용 Bundle(5·6번) ---

MAP_UV_TITLE = "SYNTHETIC 5 UV 분광광도계"
MAP_DOC_TITLE = "SYNTHETIC 6 문서 관리"
# 5번 Old 문서(SOP-ABC-1016)의 줄 — 단계 Bundle의 문서 번호로 시작하는 참조 줄 둘(OLD-1은 그대로 두어 REF?, OLD-2는 확인)과 보낼 줄 둘
UV_REF_PROPOSED = "OLD-1 Operation of the QC centrifuge"
UV_REF_CONFIRMED = "OLD-2 Rotor cleaning"
UV_TO_SOP = "Warm up the lamp for thirty minutes before reading."
UV_TO_WI = "Check the lamp hours on the display."
# 6번 Old 문서(SOP-ABC-1020)의 줄 — OLD-1은 확인, OLD-3은 그대로
DOC_REF_CONFIRMED = "OLD-1 Operation of the QC centrifuge"
DOC_REF_PROPOSED = "OLD-3 Synthetic separate layout"
DOC_TO_SOP = "Keep the calibration certificate with the record."


def build_tobe_doc(code: str, title: str, doc_type: str = "sop", parent_code: str | None = None) -> dict:
    return {"code": code, "title": title, "doc_type": doc_type, "parent_code": parent_code}


def put_tobe_codes(
    client: TestClient, bundle_id: int, docs: list[dict], wi_steps: Iterable[dict] = ()
) -> dict[str, int]:
    """To-Be 목록을 통째로 쓰고 코드 → New 문서 id를 돌려준다."""
    response = put_tobe(client, bundle_id, docs, wi_steps=wi_steps)
    assert response.status_code == 200, response.text
    return {doc["code"]: doc["id"] for doc in response.json()["docs"]}


def upload_old_doc(client: TestClient, bundle_id: int, file_name: str, lines: Iterable[str]) -> dict:
    """줄마다 문단 하나인 합성 Old 문서를 올리고 문서 응답을 돌려준다 — 읽기까지 끝나야 줄을 다룰 수 있다."""
    response = upload(client, bundle_id, build_docx("".join(p(line) for line in lines)), file_name)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc["status"]
    return doc


def find_line(client: TestClient, bundle_id: int, doc_id: int, text: str) -> dict:
    return find_unit(get_view(client, bundle_id, doc_id), text)


def confirm_ref(client: TestClient, bundle_id: int, doc_id: int, text: str, number: str) -> None:
    """글이 text인 줄을 번호 number의 참조 줄로 확인한다 — Assign에서 사람이 번호를 고른 것과 같은 편집."""
    view = get_view(client, bundle_id, doc_id)
    op = {"type": "set_ref", "unit_id": find_unit(view, text)["id"], "number": number}
    body = {"revision": view["document"]["revision"], "confirm": False, "op": op}
    response = client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def delete_bundle(client: TestClient, bundle_id: int) -> None:
    """만들다 만 Bundle을 지운다 — 제목만 남으면 다음 실행이 "이미 있다"며 건너뛴다."""
    revision = get_bundle(client, bundle_id)["revision"]
    response = client.delete(f"/api/bundles/{bundle_id}", params={"revision": revision}, headers=AUTHOR)
    assert response.status_code == 204, response.text


def _build_uv_bundle(client: TestClient, bundle_id: int) -> None:
    response = set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])
    assert response.status_code == 200, response.text
    tobe = put_tobe_codes(
        client, bundle_id,
        [build_tobe_doc("SOP-UV", "SYNTHETIC UV spectrophotometer"),
         build_tobe_doc("WI-11", "SYNTHETIC UV lamp check", "wi", "SOP-UV")],
        wi_steps=[{"code": "WI-11", "step_no": 1, "title": "Check the lamp"}],
    )
    lines = (UV_REF_PROPOSED, UV_REF_CONFIRMED, UV_TO_SOP, UV_TO_WI)
    doc_id = upload_old_doc(client, bundle_id, "SYNTHETIC_SOP-ABC-1016_UV_spectrophotometer.docx", lines)["id"]
    confirm_ref(client, bundle_id, doc_id, UV_REF_CONFIRMED, "OLD-2")
    to_sop = find_line(client, bundle_id, doc_id, UV_TO_SOP)
    assign_as_is(client, bundle_id, to_sop, tobe["SOP-UV"], slot_key="procedures.procedure")
    to_wi = find_line(client, bundle_id, doc_id, UV_TO_WI)
    assign_as_is(client, bundle_id, to_wi, tobe["WI-11"], wi_step=1, wi_part="instruction")


def _build_doc_bundle(client: TestClient, bundle_id: int) -> None:
    tobe = put_tobe_codes(client, bundle_id, [build_tobe_doc(MOVE_TARGET_CODE, "SYNTHETIC equipment calibration")])
    lines = (DOC_REF_CONFIRMED, DOC_REF_PROPOSED, DOC_TO_SOP)
    doc_id = upload_old_doc(client, bundle_id, "SYNTHETIC_SOP-ABC-1020_Document_control.docx", lines)["id"]
    confirm_ref(client, bundle_id, doc_id, DOC_REF_CONFIRMED, "OLD-1")
    to_sop = find_line(client, bundle_id, doc_id, DOC_TO_SOP)
    assign_as_is(client, bundle_id, to_sop, tobe[MOVE_TARGET_CODE], slot_key="purpose")
    # 마지막에 작성자를 뺀다 — qa.member에게 남의 Bundle(summary)이 된다
    response = set_members(client, bundle_id, [("prod.member", "author")])
    assert response.status_code == 200, response.text


@dataclass(frozen=True)
class MapBundle:
    title: str
    lister: dict[str, str]  # 이 Bundle이 목록에 보이는 사람 — 있는지 볼 때 쓴다(6번은 끝에 작성자가 빠진다)
    build: Callable[[TestClient, int], None]  # 작성자가 만든 빈 Bundle을 채운다


MAP_BUNDLES = (
    MapBundle(MAP_UV_TITLE, AUTHOR, _build_uv_bundle),
    MapBundle(MAP_DOC_TITLE, OUTSIDER, _build_doc_bundle),
)


def seed_map_bundles(client: TestClient) -> dict[str, str]:
    """지도용 Bundle을 만들고 제목 → "created"|"skipped". 단계 Bundle 넷 뒤에 불러 id가 5·6이 되게 한다."""
    outcomes: dict[str, str] = {}
    for bundle in MAP_BUNDLES:
        if any(row["title"] == bundle.title for row in _list_bundles(client, bundle.lister)):
            outcomes[bundle.title] = "skipped"
            continue
        print(f"seeding  {bundle.title}", flush=True)
        bundle_id = create_bundle(client, title=bundle.title, is_synthetic=True)["id"]
        try:
            bundle.build(client, bundle_id)
        except Exception:
            delete_bundle(client, bundle_id)
            raise
        outcomes[bundle.title] = "created"
    return outcomes


def _print_summary(client: TestClient, outcomes: dict[str, str]) -> None:
    by_title = {bundle["title"]: bundle for bundle in _list_bundles(client)}
    for stage in DEMO_STAGES:
        bundle = by_title[stage.title]
        progress = "rows " + " ".join(f"{key}={bundle['progress'][key]}" for key in PROGRESS_KEYS)
        print(f"{stage.title}  {outcomes[stage.title]}  {bundle['status']}  {progress}")


def _seed_demo() -> None:
    # 로컬 .env가 AI를 켜 두어도 워커를 띄우지 않는다 — run_jobs_until_idle과 작업을 다투고, 가짜 전송이 풀린 뒤 남은 작업이 실제 주소로 나간다
    settings.ai_enabled = settings.embed_enabled = False
    # TestClient를 with로 열어 앱 lifespan(마이그레이션·지침·dev 디렉터리 시드)을 돌리고 요청을 한 이벤트 루프에서 처리한다
    with TestClient(app) as client:
        existing = {bundle["title"] for bundle in _list_bundles(client)}
        outcomes = {stage.title: "skipped" for stage in DEMO_STAGES if stage.title in existing}
        pending = [stage for stage in DEMO_STAGES if stage.title not in existing]
        if pending:  # 만들 묶음이 있을 때만 합성 파일을 만든다
            with tempfile.TemporaryDirectory(prefix="sop-demo-") as directory:
                synthetic = build_synthetic_bundle(Path(directory))
                for stage in pending:
                    print(f"seeding  {stage.title}", flush=True)
                    drive_stage(client, synthetic, stage)
                    outcomes[stage.title] = "created"
        map_outcomes = seed_map_bundles(client)
        _print_summary(client, outcomes)
        for title, outcome in map_outcomes.items():
            print(f"{title}  {outcome}")


async def main() -> int:
    try:
        auth_mode = settings.resolved_auth_mode()
        # dev가 아니면 DB를 열기 전에 멈춘다 — 접속 대상이 운영일 수 있다
        hr_rows = await count_hr_rows() if auth_mode == "dev" else 0
        refusal = find_seed_refusal(auth_mode, is_postgres=engine.dialect.name == "postgresql", hr_rows=hr_rows)
        if refusal:
            target = engine.url.render_as_string(hide_password=True)
            print(f"refusing to seed: {refusal} ({target})", file=sys.stderr)
            return 1
        # 가드가 연 풀 연결은 이 루프에 묶여 있다 — 앱이 자기 루프에서 새 연결을 열도록 먼저 닫는다
        await engine.dispose()
        await asyncio.to_thread(_seed_demo)
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
