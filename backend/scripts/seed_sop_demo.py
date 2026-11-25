"""로컬 데모 시드 — 합성 SOP 묶음 네 개를 서로 다른 단계로, 그 뒤에 참조 지도용 묶음 둘과 문단 박스 · 목차 묶음 · 표 안 표 묶음 · 한/영 따로 표 묶음 하나씩을 앱 API에 만든다. 로컬 개발 전용, 운영 실행 금지.

단계: 1 쪼개기 직후(업로드·언어 배치·편집까지 — 이 묶음만 Reference 절 확정 전의 추출기 5로 올려 REF? 제안이 남는다, 요청서 14), 2 분류 절반(입구 1 답의 절반 저장), 3 검토 대기(전부 저장 후 검토 요청),
4 AI 제안(가짜 AI의 분류·입구 2 짝 제안까지, 확정하지 않는다 — 합성 응답이고 실제 모델이 아니다).
작성자 qa.member, 검토자 qa.lead. 앱 API를 TestClient로 그대로 불러(X-Dev-User) 화면이 쓰는 경로와 로직을 두 벌 두지 않는다.
지도용: 5 UV 분광광도계(qa.member 작성자·qa.lead 검토자 — 작성자에게 구성원 Bundle), 6 문서 관리(끝에 prod.member 혼자 —
작성자에게 남의 Bundle). 지도의 REF? 선을 남기려고 둘 다 옛 추출기 5로 올린다. 단계 Bundle 넷의 OLD-1이 5번 문서 번호를, 단계 2·3의 이동 줄이 6번 New 문서를 가리키고 5·6번이 OLD-1~3을 가리킨다.
목차: 7 목차(qa.member 작성자 — 목차 스타일 줄 7과 점 끌기 보통 줄 1, 본문에 띠 표 하나가 든 Old 문서 하나, 배정 없음.
Assign 목차 블록·띠 표 제목 줄 스모크용).
표 안 표: 8 표 안 표(qa.member 작성자 — 첫 행 칸에 띠 표, 칸 안 두 문단 사이에 값 표, 다른 칸에 권한 표가 든 작업 표 하나, 배정 없음.
Assign 표 안 표 스모크용, MD 1 F2).
한/영 따로 표: 9 한/영 따로 표(qa.member 작성자 — 한글 절반 표 둘 다음 영어 절반 표 둘, 값 표는 행 수가 다름, 배정 없음.
Assign 대응 표 짝 스모크용).
문단 박스: 10 문단 박스(qa.member 작성자 — 한 문단에 한글 문장 둘 뒤 영어 문장 둘이 든 Old 문서 하나와, 표지 · 결재 표 · Summary of Changes ·
1장 · 2장 · 개정 이력이 든 Old 문서 하나, 배정 없음. Assign 문단 박스 · 본문 앞부분 스모크용, 쪼개기 규칙 2. 목록 맨 위 묶음이 그대로이도록 7번보다 먼저 만든다).
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
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from app.settings import settings
from app.sop import ingest
from app.sop.ai.runner import run_jobs_until_idle
from scripts.reset_db import count_hr_rows, should_refuse_reset
from scripts.sop_demo_driver import SyntheticDriver
from scripts.synthetic_sop import MOVE_TARGET_CODE, SyntheticBundle, build_synthetic_bundle
from tests.docx_factory import build_docx, make_band_table, make_grid_table, make_row, make_style, p
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

PROGRESS_KEYS = ("total", "confirmed", "on_hold", "unassigned", "single_language")  # 출력하는 진행 숫자


@dataclass(frozen=True)
class DemoStage:
    title: str
    drive: Callable[[SyntheticDriver], None]  # 업로드·편집(start)이 끝난 묶음을 이 단계까지 더 모는 일
    # 이 묶음의 문서를 적을 추출기 판 — 옛 판이면 그 판의 쪼개기 규칙을 따른다(None은 지금 판)
    extractor_version: str | None = None


@contextmanager
def _use_extractor_version(version: str) -> Iterator[None]:
    """올리는 문서를 옛 추출기 판으로 적는다 — 운영에 남은 옛 문서(REF? 제안)를 화면 스모크가 보게."""
    saved = ingest.EXTRACTOR_VERSION
    ingest.EXTRACTOR_VERSION = version
    try:
        yield
    finally:
        ingest.EXTRACTOR_VERSION = saved


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
    """가짜 AI의 제안까지만 — 프런트 분류 화면용이라 받지 않는다(판단은 미배정, 제안 행만 쌓인다). 작업은 요청과 같은 앱 루프에서 돌린다(DB 연결이 그 루프에 묶여 있다)."""
    answers = SyntheticAnswers(driver.expected)
    with fake_ai_session() as fake:
        fake.chat, fake.embed = answers.chat, answers.embed
        driver.request_classification()
        driver.client.portal.call(run_jobs_until_idle)
    status = driver.get("/ai/status")
    assert status["jobs"]["failed"] == 0, status


DEMO_STAGES = (
    # Reference 절 확정 전(추출기 5)에 올린 문서 — OLD-1의 참조 줄이 REF?로 제안되어 Assign의 확인 · REF 필 확정 스모크가 쓴다
    DemoStage("SYNTHETIC 1 쪼개기 직후", _stop_after_split, extractor_version="5"),
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
        with _use_extractor_version(stage.extractor_version) if stage.extractor_version else nullcontext():
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
    # 지도에 REF? 선을 남기려고 옛 추출기로 올린다 — 지금 추출기는 Reference 절 밖의 줄을 제안하지 않는다(요청서 12)
    with _use_extractor_version("5"):
        doc_id = upload_old_doc(client, bundle_id, "SYNTHETIC_SOP-ABC-1016_UV_spectrophotometer.docx", lines)["id"]
    confirm_ref(client, bundle_id, doc_id, UV_REF_CONFIRMED, "OLD-2")
    to_sop = find_line(client, bundle_id, doc_id, UV_TO_SOP)
    assign_as_is(client, bundle_id, to_sop, tobe["SOP-UV"], slot_key="procedures.p1")
    to_wi = find_line(client, bundle_id, doc_id, UV_TO_WI)
    assign_as_is(client, bundle_id, to_wi, tobe["WI-11"], wi_step=1, wi_part="instruction")


def _build_doc_bundle(client: TestClient, bundle_id: int) -> None:
    tobe = put_tobe_codes(client, bundle_id, [build_tobe_doc(MOVE_TARGET_CODE, "SYNTHETIC equipment calibration")])
    lines = (DOC_REF_CONFIRMED, DOC_REF_PROPOSED, DOC_TO_SOP)
    with _use_extractor_version("5"):  # REF? 선 — _build_uv_bundle과 같다
        doc_id = upload_old_doc(client, bundle_id, "SYNTHETIC_SOP-ABC-1020_Document_control.docx", lines)["id"]
    confirm_ref(client, bundle_id, doc_id, DOC_REF_CONFIRMED, "OLD-1")
    to_sop = find_line(client, bundle_id, doc_id, DOC_TO_SOP)
    assign_as_is(client, bundle_id, to_sop, tobe[MOVE_TARGET_CODE], slot_key="purpose")
    # 마지막에 작성자를 뺀다 — qa.member에게 남의 Bundle(summary)이 된다
    response = set_members(client, bundle_id, [("prod.member", "author")])
    assert response.status_code == 200, response.text


# --- 문단 박스 Bundle(10번) — Assign 문단 박스 스모크용(쪼개기 규칙 2) ---

PARAGRAPH_TITLE = "SYNTHETIC 10 문단 박스"
PARAGRAPH_KO, PARAGRAPH_EN = "탱크를 비운다. 밸브를 닫는다.", "Drain the tank completely. Close the outlet valve."
# 저절로 삭제되는 본문 앞부분(1장 앞)과 개정 이력 — 1장 · 2장의 제목과 문장 넷만 배정 줄이다
FRONT_LINES = ("합성 표준 절차서", "Summary of Changes")
FRONT_TABLE = (("문서 번호", "SOP-ABC-1060"), ("제목", "합성 탱크 세척"))
FRONT_BODY = ("탱크 세척 방법을 정한다.", "합성 공정에 적용한다.")
FRONT_HISTORY = ("개정 이력", "처음 만들었다.")


def _build_paragraph_bundle(client: TestClient, bundle_id: int) -> None:
    response = set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])
    assert response.status_code == 200, response.text
    put_tobe_codes(client, bundle_id, [build_tobe_doc("SOP-TNK", "SYNTHETIC Tank draining")])
    body = p("5. 절차", "Heading1") + p("5. Procedure", "Heading1") + p(f"{PARAGRAPH_KO} {PARAGRAPH_EN}")
    response = upload(client, bundle_id, build_docx(body), "SYNTHETIC_SOP-ABC-1050_Paragraphs.docx")
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()["status"]
    front = (
        p(FRONT_LINES[0]) + make_grid_table(2, "".join(make_row(list(row)) for row in FRONT_TABLE)) + p(FRONT_LINES[1], "Heading1")
        + p("1. 목적", "Heading1") + p(FRONT_BODY[0]) + p("2. 범위", "Heading1") + p(FRONT_BODY[1])
        + p(f"9. {FRONT_HISTORY[0]}", "Heading1") + p(FRONT_HISTORY[1])
    )
    response = upload(client, bundle_id, build_docx(front), "SYNTHETIC_SOP-ABC-1060_Front_matter.docx")
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()["status"]


# --- 목차 Bundle(7번) — Assign 목차 블록·결과물 A 목차 줄 스모크용(MD 1 F6) ---

TOC_TITLE = "SYNTHETIC 7 목차"
# 한글 목차 4줄 · 영어 목차 3줄(목차 스타일, 점 끌기 + 쪽 번호)과 목차 바로 뒤 점 끌기 보통 줄 — 이 줄도 목차로 함께 잡힌다
TOC_KO = ("1. 목적 ........ 3", "2. 범위 ........ 3", "3. 책임 ........ 4", "7. 절차 ........ 5")
TOC_EN = ("1. Purpose ........ 3", "2. Scope ........ 3", "3. Responsibility ........ 4")
TOC_AFTER = "관련 서식 : F-601 합성 기록지 ........ 별첨"
TOC_BODY = ("이 절차는 합성 정제수 시스템의 필터 관리를 정한다.", "필터 차압이 0.8 bar를 넘으면 교체한다.")
TOC_BAND = ("7.4", "필터 교체 (Filter change)")  # 본문의 띠 표(F4) — 올리자마자 번호 칸에 7.4를 품은 제목 줄 하나가 된다


def _build_toc_bundle(client: TestClient, bundle_id: int) -> None:
    response = set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])
    assert response.status_code == 200, response.text
    put_tobe_codes(client, bundle_id, [build_tobe_doc("SOP-PW", "SYNTHETIC Purified water filters")])
    body = (
        "".join(p(line, "TOC1") for line in (*TOC_KO, *TOC_EN)) + p(TOC_AFTER)
        + p("목적 (Purpose)", "Heading1") + p(TOC_BODY[0]) + make_band_table(*TOC_BAND) + p(TOC_BODY[1])
    )
    styles = make_style("TOC1", "toc 1") + make_style("Heading1", "heading 1", outline=0)
    response = upload(client, bundle_id, build_docx(body, styles=styles), "SYNTHETIC_SOP-ABC-1030_Contents.docx")
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()["status"]


# --- 표 안 표 Bundle(8번) — Assign 표 안 표 스모크용(MD 1 F2) ---

NESTED_TITLE = "SYNTHETIC 8 표 안 표"
NESTED_BAND = ("7.1", "일상 점검 (Daily check)")
NESTED_CHECK = ("전원 표시등이 켜졌는지 본다.", "차압계 값을 기록한다.")
NESTED_ADMIN = "설정 값을 바꾸고 기록을 승인한다."
# 작업 표(2열 2.8 / 14.2 cm, 명세 §7 사례 1) — 표 순번: 작업 표 0, 띠 표 1, 값 표 2(점검 항목 칸의 두 문단 사이), 권한 표 3
NESTED_BODY = p("이 절차는 합성 공조기 점검을 정한다.") + make_grid_table(2, (
    make_row([make_band_table(*NESTED_BAND) + p("")], spans=[2])
    + make_row([
        "점검 항목",
        p(NESTED_CHECK[0])
        + make_grid_table(3, make_row(["공장", "1공장", "2공장"]) + make_row(["차압", "120 Pa", "150 Pa"]))
        + p(NESTED_CHECK[1]),
    ])
    + make_row([
        "권한 표",
        make_grid_table(2, (
            make_row(["권한 레벨", "할 수 있는 일"], header=True) + make_row(["관리자", NESTED_ADMIN])
            + make_row(["작업자", "점검 결과를 입력한다."])
        )) + p(""),
    ])
), widths=[1588, 8050])


def _build_nested_bundle(client: TestClient, bundle_id: int) -> None:
    response = set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])
    assert response.status_code == 200, response.text
    put_tobe_codes(client, bundle_id, [build_tobe_doc("SOP-AHU", "SYNTHETIC Air handling unit check")])
    response = upload(client, bundle_id, build_docx(NESTED_BODY), "SYNTHETIC_SOP-ABC-1040_Nested_tables.docx")
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()["status"]


# --- 한/영 따로 표 Bundle(9번) — Assign 대응 표 짝 스모크용(MD 1 F8a) ---

PAIR_TABLES_TITLE = "SYNTHETIC 9 한/영 따로 표"
# 작업 표(2열 2.8 / 14.2 cm, 3행)는 두 절반이 같은 꼴 · 같은 행 수, 값 표(3열)는 영어 쪽이 한 행 더 많다
PAIR_WORK_WIDTHS, PAIR_VALUE_WIDTHS = (1588, 8050), (2000, 2000, 2000)
PAIR_KO_WORK = (("단계", "작업 내용"), ("준비", "세척액 농도를 확인한다."), ("점검", "펌프 압력을 기록한다."))
PAIR_EN_WORK = (("Step", "Task"), ("Preparation", "Check the detergent concentration."), ("Check", "Record the pump pressure."))
PAIR_KO_VALUE = (("항목", "기준", "단위"), ("농도", "5", "%"))
PAIR_EN_VALUE = (("Item", "Limit", "Unit"), ("Concentration", "5", "%"), ("Temperature", "40", "°C"))


def _build_pair_table(rows: Iterable[Iterable[str]], widths: tuple[int, ...]) -> str:
    return make_grid_table(len(widths), "".join(make_row(list(row)) for row in rows), widths)


def _build_pair_tables_bundle(client: TestClient, bundle_id: int) -> None:
    response = set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])
    assert response.status_code == 200, response.text
    put_tobe_codes(client, bundle_id, [build_tobe_doc("SOP-WSH", "SYNTHETIC Washer preparation")])
    body = (
        p("1. 세척 준비", "Heading1") + p("이 절은 합성 세척기의 준비를 다룬다.")
        + _build_pair_table(PAIR_KO_WORK, PAIR_WORK_WIDTHS) + _build_pair_table(PAIR_KO_VALUE, PAIR_VALUE_WIDTHS)
        + p("1. Cleaning preparation", "Heading1") + p("This section covers the preparation of the synthetic washer.")
        + _build_pair_table(PAIR_EN_WORK, PAIR_WORK_WIDTHS) + _build_pair_table(PAIR_EN_VALUE, PAIR_VALUE_WIDTHS)
    )
    response = upload(client, bundle_id, build_docx(body), "SYNTHETIC_SYN-PAIR-1_Washer.docx")
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()["status"]


@dataclass(frozen=True)
class MapBundle:
    title: str
    lister: dict[str, str]  # 이 Bundle이 목록에 보이는 사람 — 있는지 볼 때 쓴다(6번은 끝에 작성자가 빠진다)
    build: Callable[[TestClient, int], None]  # 작성자가 만든 빈 Bundle을 채운다


MAP_BUNDLES = (
    MapBundle(MAP_UV_TITLE, AUTHOR, _build_uv_bundle),
    MapBundle(MAP_DOC_TITLE, OUTSIDER, _build_doc_bundle),
    MapBundle(PARAGRAPH_TITLE, AUTHOR, _build_paragraph_bundle),
    MapBundle(TOC_TITLE, AUTHOR, _build_toc_bundle),
    MapBundle(NESTED_TITLE, AUTHOR, _build_nested_bundle),
    MapBundle(PAIR_TABLES_TITLE, AUTHOR, _build_pair_tables_bundle),
)


def seed_map_bundles(client: TestClient) -> dict[str, str]:
    """지도용·문단 박스·목차·표 안 표·한/영 따로 표 Bundle을 만들고 제목 → "created"|"skipped". 단계 Bundle 넷 뒤에 불러 id가 5-10이 되게 한다."""
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
