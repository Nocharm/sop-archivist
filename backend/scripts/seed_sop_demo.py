"""로컬 데모 시드 — 합성 SOP 묶음 네 개를 서로 다른 단계로 앱 API에 만든다. 로컬 개발 전용, 운영 실행 금지.

단계: 1 쪼개기 직후(업로드·언어 배치·편집까지), 2 분류 절반(입구 1 답의 절반 저장), 3 검토 대기(전부 저장 후 검토 요청),
4 AI 제안(가짜 AI의 분류·입구 2 짝 제안까지, 확정하지 않는다 — 합성 응답이고 실제 모델이 아니다).
작성자 qa.member, 검토자 qa.lead. 앱 API를 TestClient로 그대로 불러(X-Dev-User) 화면이 쓰는 경로와 로직을 두 벌 두지 않는다.
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
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from app.settings import settings
from app.sop.ai.runner import run_jobs_until_idle
from scripts.reset_db import count_hr_rows, should_refuse_reset
from scripts.sop_demo_driver import LANGS, SyntheticDriver
from scripts.synthetic_sop import SyntheticBundle, build_synthetic_bundle
from tests.fake_ai import SyntheticAnswers, fake_ai_session
from tests.sop_helpers import AUTHOR

PROGRESS_KEYS = ("total", "confirmed", "ai_suggested", "on_hold", "unassigned")  # 출력하는 진행 숫자


@dataclass(frozen=True)
class DemoStage:
    title: str
    drive: Callable[[SyntheticDriver], None]  # 업로드·편집(start)이 끝난 묶음을 이 단계까지 더 모는 일


def _stop_after_split(driver: SyntheticDriver) -> None:
    """start()가 끝낸 상태(업로드·언어 배치·쪼개기 편집) 그대로 둔다 — 경계 확인도 하지 않은 채다."""


def _classify_half(driver: SyntheticDriver) -> None:
    driver.confirm_boundaries()
    driver.save_entrance1_half()


def _await_review(driver: SyntheticDriver) -> None:
    driver.confirm_boundaries()
    driver.save_answers(skip_omitted=False)
    driver.put_semantic_checks()
    status_code, body = driver.request_review()
    assert status_code == 200, body


def _suggest_with_ai(driver: SyntheticDriver) -> None:
    """가짜 AI의 제안까지만 — 프런트 분류 화면용이라 확정하지 않는다. 작업은 요청과 같은 앱 루프에서 돌린다(DB 연결이 그 루프에 묶여 있다)."""
    driver.confirm_boundaries()
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


def _list_bundles(client: TestClient) -> list[dict]:
    response = client.get("/api/bundles", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _print_summary(client: TestClient, outcomes: dict[str, str]) -> None:
    by_title = {bundle["title"]: bundle for bundle in _list_bundles(client)}
    for stage in DEMO_STAGES:
        bundle = by_title[stage.title]
        progress = "  ".join(
            f"{lang} " + " ".join(f"{key}={bundle['progress'][lang][key]}" for key in PROGRESS_KEYS) for lang in LANGS
        )
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
        _print_summary(client, outcomes)


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
