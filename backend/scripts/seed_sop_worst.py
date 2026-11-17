"""로컬 극단 자료 시드 — 화면이 무너지는 자리를 찾는 배치 감사용 합성 자료를 앱 API로 만든다. 로컬 전용, 운영 실행 금지.

reset_db → seed_sop_demo 위에 얹는다(데모 묶음 1~4는 "mid" 자료로 그대로 둔다). 만드는 것:
W1 극단 묶음(제목 146자·설명 900자·멤버 5명·372 Unit 문서·넓은/긴 표·파일 이름 246/255자·6쪽 PDF·거절 파일 4개·To-Be 58개·긴 사유·검토 흐름 한 바퀴),
W2 검토 대기(제목 200자)·W3 되돌아옴·W4 완료·W5 다시 열림·W6 검토 직전, W7 문서 없는 묶음, 극단 제목의 가벼운 묶음 36개(11개는 이상한 제목, 25개는 `SYNTHETIC light NN`),
참조 지도용으로 서로 가리키는 묶음 8개(`SYNTHETIC M1 map` … `M8`, Old 문서 104개 — M1은 qa.member·qa.lead, M2~M5는 qa.member,
M6~M8은 prod.member 혼자), 관리 화면용 역할 10개·부여·지침 버전. 모든 글은 합성이다.

같은 자료가 이미 있으면 건너뛴다(묶음은 제목 — 같은 제목이 기대 개수만큼 있으면, 역할은 이름, 지침은 메모). 끝 줄 `worst seed done: N bundles`의 N은
이번 시드가 맡은 묶음 수(W1~W7 7개 + light 36개 + 지도용 M1~M8 8개 = 51, 만든 것+건너뛴 것)이고, 데모 6개 가운데 qa.member에게 보이는 5개를
더하면 qa.member의 목록에는 데모 5 + W·light 43 + M1~M5 5 = 53개가 보인다(M6~M8과 데모 6번은 구성원이 아니라 보이지 않는다). 실패가 하나라도 있으면 종료 코드 1.
합성 답안은 큰 문서 업로드보다 먼저 넣는다 — 합성 드라이버는 Unit이 1,000개를 넘는 묶음에서 assert로 죽는다.
DEV_ENFORCE_PERMISSIONS는 켜지 않는다(bundle.create가 없어 403). AUTH_MODE=dev가 아니거나 HR 직원이 든 postgres면 멈춘다.

실행 (backend/ 에서, 별도 sqlite 파일 권장: DATABASE_URL=sqlite+aiosqlite:///<경로>/worst.db):
    bash:       .venv/bin/python -m scripts.seed_sop_worst
    PowerShell: .venv\\Scripts\\python -m scripts.seed_sop_worst
"""

import asyncio
import io
import json
import os
import sys
import tempfile
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from app.settings import settings
from app.sop.ai.runner import run_jobs_until_idle
from scripts.reset_db import count_hr_rows
from scripts.seed_sop_demo import (
    build_tobe_doc,
    confirm_ref,
    delete_bundle,
    find_line,
    find_seed_refusal,
    put_tobe_codes,
    upload_old_doc,
)
from scripts.sop_demo_driver import SyntheticDriver
from scripts.synthetic_sop import SyntheticBundle, build_synthetic_bundle
from tests.fake_ai import SyntheticAnswers, fake_ai_session
from tests.pdf_factory import build_text_pdf
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    get_bundle,
    get_group_by_unit,
    get_view,
    save_group,
    set_doc_version,
    set_members,
    upload,
)

KO_WORDS = "합성문서검증절차기록장비세척점검승인교육일탈변경관리시험원료자재보관출하온도습도압력시간"
LONG_KO_NOSPACE = "합성극단값공백없는아주긴한국어제목검증용" * 20
LONG_URL = "SYNTHETIC-https://synthetic.example.invalid/very/long/path/without/any/space/" + "segment-abcdefghij/" * 10
MEMBERS = [("qa.member", "author"), ("qa.lead", "reviewer"), ("dev.admin", "author"), ("prod.member", "reviewer"), ("ops.member", "author")]
W1_PREFIX = "SYNTHETIC W1 worst"
STAGE_BUNDLES = (  # (제목, 단계) — 제목 접두가 감사의 열쇠다
    ("SYNTHETIC W2 in-review 검토 대기 — 되돌린 뒤 다시 요청 (returned then resubmitted) " + "긴제목" * 30, "resubmitted"),
    ("SYNTHETIC W3 returned 검토에서 되돌아옴", "returned"),
    ("SYNTHETIC W4 done 검토 완료", "done"),
    ("SYNTHETIC W5 reopened 완료 뒤 다시 열림", "reopened"),
    ("SYNTHETIC W6 ready 검토 요청 직전", "ready"),
)
EMPTY_TITLE = "SYNTHETIC W7 empty 빈 묶음 (no documents, no To-Be)"
LIGHT_TITLES = [
    LONG_KO_NOSPACE[:195], LONG_URL[:200], "가", "", "A", " ", "SYNTHETIC " + "word " * 38,
    "SYNTHETIC <b>bold</b> & \"quotes\" 'single' <script>alert(1)</script>", "SYNTHETIC 🙂 emoji 🧪 제목 ‮RTL override",
    "SYNTHETIC\ttab and  double  spaces", "SYNTHETIC 한글 English 日本語 中文 العربية mixed scripts",
] + [f"SYNTHETIC light {i:02d} 가벼운 묶음" for i in range(25)]
ROLE_NAMES = [
    "SYNTHETIC Role With A Very Long Name For Layout Review " + "Long " * 8, "합성역할공백없는아주긴이름" * 7, "S",
    "SYNTHETIC bundle creator", "SYNTHETIC all permissions", "SYNTHETIC no permissions",
    "SYNTHETIC https://synthetic.example.invalid/role/with/url/like/name",
    "SYNTHETIC 감사 전용 역할 (audit only)", "SYNTHETIC 지침 관리", "SYNTHETIC 운영 보조 역할 second line of support",
]
GRANT_SUBJECTS = [("user", u) for u in ("prod.member", "ops.member", "qa.lead")] + [
    ("dept", d) for d in ("DIV-PROD", "TEAM-PROD1", "DIV-IT", "TEAM-IT1", "CORP")
] + [("user", "synthetic.missing.user"), ("dept", "SYNTHETIC-MISSING-DEPT")]


def ko_sentence(i: int, n: int = 6) -> str:
    words = [KO_WORDS[(i * 3 + k * 5) % (len(KO_WORDS) - 2):][:2] + KO_WORDS[(i + k) % (len(KO_WORDS) - 3):][:3] for k in range(n)]
    return f"합성 문장 {i}번은 " + " ".join(words) + " 항목을 확인하고 기록한다."


def en_sentence(i: int) -> str:
    return f"Synthetic sentence {i} states that the operator shall verify item {i * 7 % 97} and record the result in the synthetic log."


def long_text(chars: int, lang: str = "ko") -> str:
    """쉼표로만 이어 마침표가 하나뿐인 `chars`자 문단 — 한 문장짜리 극단 Unit을 만든다."""
    out: list[str] = []
    i = 0
    while sum(len(s) + 1 for s in out) < chars:
        out.append(ko_sentence(i, 8)[:-1].replace("기록한다", "기록하며") + "," if lang == "ko" else en_sentence(i)[:-1] + ",")
        i += 1
    return (" ".join(out))[: chars - 1].rstrip(", ") + ("다." if lang == "ko" else ".")


def _new_docx(title: str):  # python-docx는 dev 의존성이라 함수 안에서 가져온다
    from docx import Document

    document = Document()
    document.core_properties.title = "SYNTHETIC " + title
    document.core_properties.subject = "SYNTHETIC"
    return document


def _save_docx(document) -> bytes:  # noqa: ANN001 - python-docx 문서 타입은 가져오기를 미룬다
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def build_big(code: str, sentences: int, with_extremes: bool) -> bytes:
    """절 번호가 6단까지 내려가는 큰 문서. with_extremes면 1,800자 한 문장·공백 없는 330자 토큰 같은 극단 문단을 끝에 붙인다."""
    doc = _new_docx(code)
    doc.add_paragraph(f"Document No. {code}  Version 12.3")
    doc.add_heading(f"1. 합성 대형 문서 {code} / Synthetic big document", level=1)
    nest = ["1.1", "1.2", "1.2.3", "1.2.3.4", "1.2.3.4.5", "1.2.3.4.5.6"]
    i = 0
    for s in range(sentences // 10):
        level = min(s % 7 + 1, 6)
        number = nest[level - 1] if s < 12 else f"{s // 6 + 2}.{s % 6 + 1}"
        doc.add_heading(f"{number} 합성 절 제목 {s} Synthetic section heading {s}", level=level)
        for _ in range(5):
            doc.add_paragraph(ko_sentence(i) + " " + en_sentence(i))
            i += 1
    if with_extremes:
        doc.add_heading("9.9.9.9.9.9 극단 문단 Extreme paragraphs", level=6)
        doc.add_paragraph(long_text(1800, "ko"))
        doc.add_paragraph(long_text(1700, "en"))
        doc.add_paragraph("공백없는토큰" + "가나다라마바사아자차카타파하" * 22 + "끝.")
        doc.add_paragraph("NOSPACE_" + "abcdefghijklmnopqrstuvwxyz0123456789" * 9 + ".")
        doc.add_paragraph("혼합 Mixed 문장은 한국어와 English를 섞어 쓰며 pH 7.4±0.2, 25℃/60%RH, ≥99.5% 같은 값을 담는다.")
    return _save_docx(doc)


def build_tables(code: str) -> bytes:
    """14열×6행 넓은 표와 120행×3열 긴 표(셀 400자 포함)."""
    doc = _new_docx(code)
    doc.add_heading("1. 넓은 표와 긴 표 Wide and long tables", level=1)
    doc.add_paragraph("아래 넓은 표는 열이 열네 개인 합성 표이다.")
    wide = doc.add_table(rows=6, cols=14)
    for r in range(6):
        for c in range(14):
            wide.cell(r, c).text = f"열{c + 1} 머리 Column {c + 1}" if r == 0 else f"합성 값 {r}-{c} synthetic value {r * 14 + c}"
    doc.add_paragraph("아래 긴 표는 행이 백이십 개인 합성 표이다.")
    tall = doc.add_table(rows=120, cols=3)
    for r in range(120):
        tall.cell(r, 0).text = f"{r + 1}"
        tall.cell(r, 1).text = f"합성 점검 항목 {r + 1}을 확인한다."
        tall.cell(r, 2).text = f"Synthetic check item {r + 1} is verified." if r % 9 else long_text(400, "en")
    doc.add_paragraph("표 뒤의 마지막 합성 문장이다.")
    return _save_docx(doc)


def build_small(code: str, n: int = 8, lang: str = "both") -> bytes:
    doc = _new_docx(code)
    doc.add_heading(f"1. 합성 소형 문서 {code}", level=1)
    for i in range(n):
        doc.add_paragraph((ko_sentence(i + len(code)) if lang != "en" else "") + (" " + en_sentence(i + len(code)) if lang != "ko" else ""))
    return _save_docx(doc)


# ---------- 참조 지도용 묶음(M1~M8) — 앱 API를 부르지 않는 계획 ----------

MAP_BUNDLE_COUNT = 8
MAP_DOCS_PER_BUNDLE = 13
MAP_HUB = "MAP-101"  # 다른 묶음의 문서 MAP_HUB_SOURCES개가 확인한 참조로 가리키는 번호 — M2에도 같은 번호의 문서가 있다
MAP_HUB_SOURCES = 30
MAP_FAN_OUT = 40  # M1의 MAP-102가 서로 다른 번호를 가리키는 줄 수
MAP_LONG_CODE = "MAP" + "-ABCDEFGH" * 10 + "-123456"  # 100자 — 문서 번호 칸의 상한
MAP_MISSING = tuple(f"MAP-{900 + i}" for i in range(1, 6))  # 어느 묶음에도 없는 번호
MAP_TEMP_CODE = "NEW-900001"  # 임시 번호 New 문서 — 번호로 찾아지지 않는다
MAP_FREE_MOVE = "see the other team"  # 번호 꼴이 아닌 이동 코드 — 지도에 선이 서지 않는다
MAP_NOSPACE_TITLE = ("SYNTHETIC" + "NoSpaceMapTitle" * 14)[:200]
MAP_VIEWED_MEMBERS = (("qa.member", "author"), ("qa.lead", "reviewer"))
MAP_SUMMARY_MEMBERS = (("prod.member", "author"),)


@dataclass(frozen=True)
class MapLineSpec:
    text: str
    ref: str = ""  # set_ref로 확인할 번호 — 빈 칸이면 그대로 둔다(번호로 시작하면 REF?)
    move_to: str = ""  # 다른 문서로 보내기(확정)의 대상 코드
    assign_to: str = ""  # 원문 그대로 보낼 New 문서 코드


@dataclass(frozen=True)
class MapDocSpec:
    file_name: str
    lines: tuple[MapLineSpec, ...]
    doc_code: str = ""  # 올린 뒤 PATCH로 바꿀 번호(빈 칸이면 파일 이름의 번호 그대로)
    title: str | None = None  # 올린 뒤 PATCH로 바꿀 제목


@dataclass(frozen=True)
class MapBundleSpec:
    n: int
    title: str
    tobe: tuple[tuple[str, str], ...]  # (코드, 제목) — 모두 SOP
    docs: tuple[MapDocSpec, ...]
    members: tuple[tuple[str, str], ...]  # 끝에 갈아 끼울 구성원 — 빈 것이면 만든 qa.member 혼자로 둔다


def build_map_prefix(n: int) -> str:
    return f"SYNTHETIC M{n} map"


def build_map_doc_codes() -> dict[tuple[int, int], str]:
    """(묶음 n, 문서 j) → 지도에 서는 문서 번호. M1의 10번은 번호 없는 문서, 13번은 100자 번호, M2의 13번은 M1과 같은 MAP-101."""
    codes = {(n, j): f"MAP-{n}{j:02d}" for n in range(1, MAP_BUNDLE_COUNT + 1) for j in range(1, MAP_DOCS_PER_BUNDLE + 1)}
    codes[(1, 10)] = ""
    codes[(1, 13)] = MAP_LONG_CODE
    codes[(2, 13)] = MAP_HUB
    return codes


def _pick_code(codes: dict[tuple[int, int], str], n: int, j: int) -> str:
    """묶음 n의 j번부터 처음 만나는 번호 있는 문서의 번호."""
    for step in range(MAP_DOCS_PER_BUNDLE):
        code = codes[(n, (j - 1 + step) % MAP_DOCS_PER_BUNDLE + 1)]
        if code:
            return code
    raise ValueError(f"bundle M{n} has no numbered document")


def _build_map_doc(codes: dict[tuple[int, int], str], hub_sources: set[tuple[int, int]], n: int, j: int) -> MapDocSpec:
    """문서 하나 — 다른 묶음의 번호로 시작하는 줄 둘(앞 줄은 확인, 뒷 줄은 그대로), 보낼 줄 하나, 네 문서에 하나는 다른 묶음 New 문서로 이동.

    지도는 구성원이 아닌 묶음의 REF?를 보이지 않는다 — 그래서 남에게 보여야 할 선(MAP-101로 모이는 30개·100자 번호·이동)은 늘 확인한
    줄이고, 그대로 둔 줄은 앞 묶음(prev)을 가리켜 구성원이 같은 묶음끼리(M2→M1 … M5→M4, M7→M6, M8→M7) REF?로 보인다.
    """
    tag = f"M{n}-{j:02d}"
    next_n, prev_n = n % MAP_BUNDLE_COUNT + 1, (n - 2) % MAP_BUNDLE_COUNT + 1
    confirmed = MAP_HUB if (n, j) in hub_sources else _pick_code(codes, next_n, j)
    proposed = _pick_code(codes, prev_n, j % MAP_DOCS_PER_BUNDLE + 1)
    lines = [
        MapLineSpec(f"{confirmed} Synthetic reference {tag}", ref=confirmed),
        MapLineSpec(f"{proposed} Synthetic citation {tag}"),
    ]
    filler = f"Synthetic map step {tag} records the reading in the log."
    lines.append(MapLineSpec(filler, assign_to=f"SOP-M{n}-01" if n == 1 or j == 1 else ""))
    if ((n - 1) * MAP_DOCS_PER_BUNDLE + j - 1) % 4 == 0:
        lines.append(MapLineSpec(f"Synthetic map line {tag} belongs to another team.", move_to=f"SOP-M{next_n}-01"))
    upload_code, doc_code, title = codes[(n, j)], "", None
    if n == 1:
        upload_code, doc_code, title, lines = _apply_m1_extremes(codes, j, lines)
    name = f"SYNTHETIC_{upload_code}_map_document_{tag}.docx" if upload_code else "SYNTHETIC_map_document_without_a_number.docx"
    return MapDocSpec(name, tuple(lines), doc_code, title)


def _apply_m1_extremes(
    codes: dict[tuple[int, int], str], j: int, lines: list[MapLineSpec]
) -> tuple[str, str, str | None, list[MapLineSpec]]:
    """M1에 모은 극단 값 — (파일 이름의 번호, PATCH할 번호, PATCH할 제목, 줄)."""
    upload_code, doc_code, title = codes[(1, j)], "", None
    if j == 2:  # 줄 40개가 서로 다른 번호 40개를 — 다른 묶음 문서 35개와 어느 묶음에도 없는 번호 다섯
        others = [codes[(n, k)] for n in (2, 3, 4) for k in range(1, MAP_DOCS_PER_BUNDLE + 1) if codes[(n, k)] != MAP_HUB]
        numbers = others[: MAP_FAN_OUT - len(MAP_MISSING)] + list(MAP_MISSING)
        fan = [MapLineSpec(f"{number} Synthetic fan-out line {i:02d}", ref=number if i == 0 else "") for i, number in enumerate(numbers)]
        lines = fan + lines[2:]
    elif j == 3:  # 1,800자 참조 줄(확인)
        lines = [*lines, MapLineSpec("MAP-201 " + long_text(1790, "en"), ref="MAP-201")]
    elif j == 4:  # 후속 문서가 임시 번호 New 문서뿐
        lines = [*lines[:2], MapLineSpec(lines[2].text, assign_to=MAP_TEMP_CODE), *lines[3:]]
    elif j == 5:  # 후속 문서 여섯
        parts = [MapLineSpec(f"Synthetic map step M1-05 part {i} records the reading.", assign_to=f"SOP-M1-{i:02d}") for i in range(1, 7)]
        lines = [*lines[:2], *parts, *lines[3:]]
    elif j == 6:  # 번호 꼴이 아닌 이동 코드
        lines = [*lines, MapLineSpec("Synthetic map line M1-06 goes to a team without a number.", move_to=MAP_FREE_MOVE)]
    elif j == 11:
        title = ""
    elif j == 12:
        title = MAP_NOSPACE_TITLE
    elif j == 13:  # 파일 이름으로는 100자 번호를 받지 않으니 올린 뒤 바꾼다
        upload_code, doc_code = "MAP-113", MAP_LONG_CODE
    return upload_code, doc_code, title, lines


def build_map_plan() -> list[MapBundleSpec]:
    """M1~M8 — 묶음마다 Old 문서 13개, 모두 104개. 선은 Bundle을 건너는 확인한 참조·확인한 이동이 대부분이다."""
    codes = build_map_doc_codes()
    hub_order = [
        (n, j) for j in range(1, MAP_DOCS_PER_BUNDLE + 1) for n in range(2, MAP_BUNDLE_COUNT + 1) if codes[(n, j)] != MAP_HUB
    ]
    hub_sources = set(hub_order[:MAP_HUB_SOURCES])
    plan = []
    for n in range(1, MAP_BUNDLE_COUNT + 1):
        role, members = ("viewed", MAP_VIEWED_MEMBERS) if n == 1 else ("member", ()) if n <= 5 else ("summary", MAP_SUMMARY_MEMBERS)
        tobe = [(f"SOP-M{n}-01", f"SYNTHETIC M{n} map SOP")]
        if n == 1:
            tobe += [(f"SOP-M1-{i:02d}", f"SYNTHETIC M1 map SOP {i}") for i in range(2, 7)] + [(MAP_TEMP_CODE, "SYNTHETIC temp successor")]
        docs = tuple(_build_map_doc(codes, hub_sources, n, j) for j in range(1, MAP_DOCS_PER_BUNDLE + 1))
        plan.append(MapBundleSpec(n, f"{build_map_prefix(n)} {role} 참조 지도", tuple(tobe), docs, members))
    return plan


class WorstSeeder:
    """한 TestClient 위에서 극단 자료를 만든다. 만들다 막힌 곳은 fail()로 모아 끝에 종료 코드로 알린다."""

    def __init__(self, client: TestClient, synthetic: SyntheticBundle) -> None:
        self.client = client
        self.synthetic = synthetic
        self.failures: list[str] = []
        self.created = 0
        self.skipped = 0
        self.long_reason = (
            "합성 검토 의견: " + long_text(900, "ko") + " " + long_text(700, "en") + " 공백없는검토의견토큰" + "가나다라" * 60
        )[:1990]

    def fail(self, message: str) -> None:
        print("FAILED: " + message, flush=True)
        self.failures.append(message)

    def list_bundle_titles(self) -> Counter:
        response = self.client.get("/api/bundles", headers=AUTHOR)
        assert response.status_code == 200, response.text
        return Counter(bundle["title"] for bundle in response.json())

    def get_revision(self, bundle_id: int) -> int:
        return get_bundle(self.client, bundle_id, AUTHOR)["revision"]

    def review(self, bundle_id: int, action: str, headers: dict, reason: str | None = None) -> None:
        body: dict = {"revision": get_bundle(self.client, bundle_id, headers)["revision"]}
        if reason is not None:
            body["reason"] = reason
        response = self.client.post(f"/api/bundles/{bundle_id}/review/{action}", json=body, headers=headers)
        if response.status_code != 200:
            self.fail(f"review {action} on bundle {bundle_id}: {response.status_code} {response.text[:600]}")

    def put_checks(self, bundle_id: int) -> None:
        from app.sop.constants import SEMANTIC_CHECK_KEYS

        body = {"revision": self.get_revision(bundle_id), "checks": dict.fromkeys(SEMANTIC_CHECK_KEYS, True)}
        response = self.client.put(f"/api/bundles/{bundle_id}/semantic-checks", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    def set_members(self, bundle_id: int) -> None:
        body = {"revision": self.get_revision(bundle_id), "members": [{"login_id": m, "role": role} for m, role in MEMBERS]}
        response = self.client.put(f"/api/bundles/{bundle_id}/members", json=body, headers=AUTHOR)
        if response.status_code != 200:
            self.fail(f"members x5 on bundle {bundle_id}: {response.status_code} {response.text[:150]}")

    # ---------- W1 ----------

    def build_w1_tobe(self, driver: SyntheticDriver, bundle_id: int) -> tuple[list[str], list[str]]:
        """To-Be에 SOP 30개·WI 22개를 더한다 — 코드 100자·제목 480자/공백 없는 435자/빈 것·WI 단계 0~40개·긴 N/A 사유."""
        tobe = driver.get("/tobe")
        docs = [{k: doc[k] for k in ("code", "title", "doc_type", "parent_code", "is_equipment_sop", "order_index")} for doc in tobe["docs"]]
        steps, nas, base = list(tobe["wi_steps"]), list(tobe["na_slots"]), len(docs)
        sop_codes: list[str] = []
        wi_codes: list[str] = []
        for i in range(30):
            code = f"SYN-SOP-{i + 1:04d}" if i % 5 else ("SYN-QA-PROD-VALIDATION-EQUIPMENT-CLEANING-" + "LONGCODE-" * 5 + f"{i:04d}")[:100]
            title = [f"합성 SOP 제목 {i}", long_text(480, "ko"), "SyntheticTitleWithoutAnySpace" * 15, "", f"Synthetic SOP {i} — cleaning, verification and release of synthetic equipment"][i % 5][:500]
            docs.append({"code": code, "title": title, "doc_type": "sop", "parent_code": None, "is_equipment_sop": i % 4 == 0, "order_index": base + i})
            sop_codes.append(code)
            if i % 6 == 1:
                nas.append({"code": code, "slot_key": "definitions", "reason": self.long_reason})
                nas.append({"code": code, "slot_key": "document_relationships.appendices", "reason": "합성 사유: 해당 없음"})
        for i in range(22):
            code = f"SYN-WI-{i + 1:04d}" if i % 4 else ("SYN-WI-" + "VERYLONGWORKINSTRUCTIONCODE-" * 3 + f"{i:04d}")[:100]
            title = [f"합성 WI 제목 {i}", long_text(450, "en"), "합성공백없는WI제목" * 40, ""][i % 4][:500]
            docs.append({"code": code, "title": title, "doc_type": "wi", "parent_code": sop_codes[i % 7], "is_equipment_sop": False, "order_index": base + 30 + i})
            wi_codes.append(code)
            for s in range([0, 3, 40, 12, 1][i % 5]):
                steps.append({"code": code, "step_no": s + 1, "title": [f"합성 단계 {s + 1}", long_text(300, "ko"), "", f"Synthetic step {s + 1}: verify and record"][s % 4][:500]})
        body = {"revision": self.get_revision(bundle_id), "docs": docs, "na_slots": nas, "wi_steps": steps}
        response = self.client.put(f"/api/bundles/{bundle_id}/tobe", json=body, headers=AUTHOR)
        if response.status_code != 200:
            self.fail(f"tobe put {response.status_code} {response.text[:800]}")
        return sop_codes, wi_codes

    def list_locations(self, driver: SyntheticDriver, sop_codes: list[str], wi_codes: list[str]) -> list[tuple[int, dict]]:
        """새 문장을 보낼 수 있는 To-Be 칸 목록 — (To-Be 문서 id, 칸/단계 좌표)."""
        tobe = driver.get("/tobe")
        driver.tobe_ids = {doc["code"]: doc["id"] for doc in tobe["docs"]}
        na_set = {(n["code"], n["slot_key"]) for n in tobe["na_slots"]}
        locations: list[tuple[int, dict]] = []
        for code in sop_codes:
            for slot in ("purpose", "scope", "definitions", "responsibilities", "general_requirements.safety", "procedures.procedure"):
                if (code, slot) not in na_set:
                    locations.append((driver.tobe_ids[code], {"slot_key": slot}))
        for step in tobe["wi_steps"]:
            if step["code"] in wi_codes and step["step_no"] <= 5:
                locations.append((driver.tobe_ids[step["code"]], {"wi_step": step["step_no"], "wi_part": "instruction" if step["step_no"] % 2 else "why"}))
        return locations

    def upload_extra(self, bundle_id: int, name: str, data: bytes) -> dict | None:
        response = upload(self.client, bundle_id, data, name, side="old", headers=AUTHOR)
        print(f"upload {name[:60]} -> {response.status_code}", flush=True)
        if response.status_code != 201:
            return None
        body = response.json()
        if body["status"] == "ready" and not body["doc_version"]:  # 검토 요청 조건 — 읽은 옛 문서는 버전이 있어야 한다
            body = set_doc_version(self.client, bundle_id, body)
        return body

    def upload_w1_documents(self, bundle_id: int) -> dict[str, dict]:
        extras: dict[str, dict] = {}

        def add(key: str, name: str, data: bytes) -> None:
            body = self.upload_extra(bundle_id, name, data)
            if body is None:
                self.fail(f"upload {key} was rejected")
            else:
                extras[key] = body

        add("big1", "SYNTHETIC_OLD-90_BIG_합성_대형_문서_Big_Document v12.3.docx", build_big("OLD-90", 330, True))
        add("big2", "SYNTHETIC_OLD-91_BIG_second_big_document_for_unassigned_units.docx", build_big("OLD-91", 260, False))
        add("tables", "SYNTHETIC_OLD-92_wide_and_long_tables_넓은표_긴표.docx", build_tables("OLD-92"))
        ko_name = "SYNTHETIC_OLD-93_" + "공백없는아주긴한국어파일이름" * 16
        add("koname", ko_name[:250] + ".docx", build_small("OLD-93"))
        en_name = "SYNTHETIC_OLD-94_" + "VeryLongEnglishFileNameWithoutAnySpaces_" * 6
        add("enname", en_name[:250] + ".docx", build_small("OLD-94", lang="en"))
        add("spaces", "SYNTHETIC_OLD-95 file name with many spaces and (brackets) [v2.0] rev 3 - final - FINAL2 - 최종 - 진짜최종.docx", build_small("OLD-95"))
        pages = [[f"Synthetic PDF page {p + 1} line {ln + 1} states that the synthetic operator verifies item {p * 30 + ln}." for ln in range(28)] for p in range(6)]
        add("pdf", "SYNTHETIC_OLD-96_synthetic_text_pdf_six_pages.pdf", build_text_pdf(pages))
        add("tiny", "SYNTHETIC_A.docx", build_small("A", 2))
        for i in range(6):
            add(f"small{i}", f"SYNTHETIC_OLD-{97 + i}_합성 소형 문서 {i} small synthetic document {i}.docx", build_small(f"OLD-{97 + i}", 6 + i * 3, ["both", "ko", "en"][i % 3]))
        return extras

    def upload_rejected_files(self, bundle_id: int) -> None:
        """깨진·빈·지원 안 하는 파일과 이름이 너무 긴 파일 — 검토 요청 뒤에 올린다(해결 안 된 문서는 검토 요청을 막는다)."""
        self.upload_extra(bundle_id, "SYNTHETIC_corrupt_깨진_문서_broken_document.docx", os.urandom(4096))
        self.upload_extra(bundle_id, "SYNTHETIC_zero_bytes.docx", b"")
        self.upload_extra(bundle_id, "SYNTHETIC_not_a_pdf.pdf", b"%PDF-1.4 synthetic broken pdf body without objects")
        self.upload_extra(bundle_id, "SYNTHETIC_unsupported_text.txt", "합성 텍스트 파일".encode())
        self.upload_extra(bundle_id, "SYNTHETIC_" + "x" * 300 + ".docx", build_small("X", 1))  # 255자 초과 — 422

    def assign_w1_units(self, driver: SyntheticDriver, bundle_id: int, extras: dict[str, dict], locations: list[tuple[int, dict]]) -> Counter:
        stats: Counter = Counter()

        def units_of(status: str) -> list[dict]:
            items: list[dict] = []
            offset = 0
            while True:
                page = driver.get("/units", limit="1000", offset=str(offset), status=status)
                items += page["items"]
                offset += 1000
                if offset >= page["total"]:
                    return items

        def try_assign(unit: dict, location: tuple[int, dict], hold_reason: str = "") -> bool:
            try:
                assign_as_is(self.client, bundle_id, unit, location[0], hold_reason=hold_reason, **location[1])
            except AssertionError as err:
                stats["assign_fail"] += 1
                if stats["assign_fail"] <= 6:
                    print("assign fail:", str(err)[:400], flush=True)
                return False
            stats["hold" if hold_reason else "as_is"] += 1
            return True

        def confirm_custom(unit: dict, targets: list[dict], reason: str) -> bool:
            group = driver.get(f"/groups/by-unit/{unit['id']}")
            entry = next(m for m in group["units"] if m["unit_id"] == unit["id"])
            body = {"action": "confirm", "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned", "reason": reason}], "targets": targets}
            response = save_group(self.client, bundle_id, body, AUTHOR)
            if response.status_code != 200:
                stats["custom_fail"] += 1
                return False
            return True

        view = get_view(self.client, bundle_id, extras["big1"]["id"], AUTHOR)
        text_units = [u for u in view["units"] if u["kind"] in ("sentence", "heading")]
        for n, unit in enumerate(text_units[:170]):
            loc = locations[n % len(locations)]
            if n % 17 == 3 and unit["lang"] in ("ko", "en"):  # 같은 문장을 세 곳으로
                places = (loc, locations[(n * 7 + 5) % len(locations)], locations[(n * 11 + 9) % len(locations)])
                targets = [{"key": f"t{k}", "target_doc_id": p[0], **p[1], "source_unit_ids": [unit["id"]]} for k, p in enumerate(places)]
                stats["multi_target"] += confirm_custom(unit, targets, "합성 사유: 같은 문장을 세 곳에 둔다. " + long_text(300, "ko"))
            elif n % 17 == 8 and unit["lang"] in ("ko", "en"):  # 3,000자 새 문장으로 고쳐 쓰기
                target = {"key": "t", "target_doc_id": loc[0], **loc[1], "source_unit_ids": [unit["id"]], "text": long_text(3000, unit["lang"]), "change_type": "rewritten"}
                stats["rewritten_long"] += confirm_custom(unit, [target], "합성 사유: 길게 고쳐 썼다. " + long_text(500, "ko"))
            else:
                try_assign(unit, loc)
        for unit in text_units[-8:]:  # 끝의 극단 문단
            try_assign(unit, locations[3])
        for unit in [u for u in get_view(self.client, bundle_id, extras["tables"]["id"], AUTHOR)["units"] if u["kind"] == "table"]:
            try_assign(unit, locations[5])
        for key in ("pdf", "small0", "small1", "koname", "enname"):
            sentences = [u for u in get_view(self.client, bundle_id, extras[key]["id"], AUTHOR)["units"] if u["kind"] in ("sentence", "heading")]
            for n, unit in enumerate(sentences[:6]):
                try_assign(unit, locations[(n * 13 + 1) % len(locations)])
        self.delete_unassigned_in_bulk(driver, bundle_id, units_of("unassigned"))
        return stats

    def delete_unassigned_in_bulk(self, driver: SyntheticDriver, bundle_id: int, unassigned: list[dict]) -> None:
        reason = "합성 일괄 삭제 사유: 구조 문장이라 새 문서에 두지 않는다. " + long_text(600, "ko")
        todo = [u for u in unassigned if u["group_unit_id"] is None]
        for start in range(0, len(todo), 1500):
            chunk = todo[start:start + 1500]
            body = {"action": "delete", "reason": reason, "units": [{"unit_id": u["unit_id"], "revision": u["decision"]["revision"]} for u in chunk]}
            response = self.client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
            if response.status_code != 200:
                self.fail(f"bulk delete: {response.status_code} {response.text[:500]}")

    def run_w1_review_cycle(self, driver: SyntheticDriver, bundle_id: int) -> None:
        """요청 → 되돌림 → 요청 → 완료 → 다시 열기 → 요청 → 거둠 → 요청 → 되돌림. 끝 상태는 작업 중(Assign을 고칠 수 있게)."""
        for doc in driver.get("/documents"):
            for warning in (doc.get("extraction") or {}).get("warnings", []):
                if warning.get("needs_ack") and not warning.get("acked_at"):
                    self.client.post(f"/api/bundles/{bundle_id}/warnings/{warning['id']}/ack", json={"note": "합성 확인 메모 " + long_text(200, "ko")}, headers=AUTHOR)
        steps: list[tuple[str, dict, str | None]] = [
            ("request", AUTHOR, None), ("return", REVIEWER, self.long_reason),
            ("request", AUTHOR, None), ("complete", REVIEWER, None),
            ("reopen", AUTHOR, "합성 다시 열기 사유: " + long_text(1200, "ko")),
            ("request", AUTHOR, None), ("withdraw", AUTHOR, None),
            ("request", AUTHOR, None),
            ("return", REVIEWER, ("Synthetic second return: " + long_text(1500, "en") + " " + "NOSPACEREVIEWTOKEN" * 20)[:1990]),
        ]
        for action, headers, reason in steps:
            if action == "request":  # 요청 조건에 의미 검토 4항목이 필요하고 작업 중으로 돌아올 때마다 지워진다
                self.put_checks(bundle_id)
            self.review(bundle_id, action, headers, reason)

    def mix_w1_states(self, driver: SyntheticDriver, bundle_id: int, extras: dict[str, dict], locations: list[tuple[int, dict]]) -> None:
        """둘째 큰 문서를 미배정으로 돌린 뒤 보류(짧은·1,200자·공백 없는 690자 사유)와 확정을 섞는다."""
        reset = self.client.post(f"/api/bundles/{bundle_id}/decisions/reset", json={"revision": self.get_revision(bundle_id), "document_id": extras["big2"]["id"]}, headers=AUTHOR)
        if reset.status_code != 200:
            self.fail(f"reset big2: {reset.status_code} {reset.text[:200]}")
        units = [u for u in get_view(self.client, bundle_id, extras["big2"]["id"], AUTHOR)["units"] if u["kind"] in ("sentence", "heading")]
        reasons = ["합성 보류 사유", "합성 보류 사유: " + long_text(1200, "ko"), "HoldReasonWithoutSpaces" * 30]
        for n, unit in enumerate(units[:90]):
            if n % 3 == 0:
                hold = reasons[n % 9 // 3]
                assign_as_is(self.client, bundle_id, unit, locations[(n * 5) % len(locations)][0], hold_reason=hold, **locations[(n * 5) % len(locations)][1])
            elif n % 3 == 1:
                loc = locations[(n * 5 + 2) % len(locations)]
                assign_as_is(self.client, bundle_id, unit, loc[0], **loc[1])

    def suggest_w1_with_ai(self, driver: SyntheticDriver, bundle_id: int, extras: dict[str, dict]) -> None:
        """합성 문서 셋을 미배정으로 돌려 가짜 AI 제안을 받는다(가짜 전송, 실제 모델 아님). 작은 문서는 답이 없어 실패 작업이 남는다."""
        old_docs = [(code, v["document"]["id"]) for code, v in driver.views.items() if v["document"]["side"] == "old" and code not in driver._find_match_docs()]
        for _code, doc_id in old_docs[:3]:
            self.client.post(f"/api/bundles/{bundle_id}/decisions/reset", json={"revision": self.get_revision(bundle_id), "document_id": doc_id}, headers=AUTHOR)
        answers = SyntheticAnswers(driver.expected)
        with fake_ai_session() as fake:
            fake.chat, fake.embed = answers.chat, answers.embed
            for _code, doc_id in old_docs[:3]:
                self.client.post(f"/api/bundles/{bundle_id}/ai/classify", json={"document_id": doc_id}, headers=AUTHOR)
            self.client.post(f"/api/bundles/{bundle_id}/ai/classify", json={"document_id": extras["small2"]["id"]}, headers=AUTHOR)
            self.client.portal.call(run_jobs_until_idle)

    def create_w1(self) -> None:
        title = ("SYNTHETIC W1 worst 원심분리기·세척·검증 절차 전체 재구성 묶음 (극단값 검토용, extreme-case bundle for UI review) " + "긴제목" * 20)[:146]
        driver = SyntheticDriver(self.client, self.synthetic, AUTHOR, title=title)
        try:
            driver.start()
            bundle_id = driver.bundle_id
            description = ("합성 설명 " + long_text(880, "ko"))[:900]
            self.client.patch(f"/api/bundles/{bundle_id}", json={"revision": self.get_revision(bundle_id), "description": description}, headers=AUTHOR)
            sop_codes, wi_codes = self.build_w1_tobe(driver, bundle_id)
            locations = self.list_locations(driver, sop_codes, wi_codes)
            driver.save_answers(skip_omitted=False)  # 큰 문서보다 먼저 — Unit이 1,000개를 넘으면 몰이가 죽는다
            extras = self.upload_w1_documents(bundle_id)
            stats = self.assign_w1_units(driver, bundle_id, extras, locations)
            print(f"W1 assign stats: {dict(stats)}", flush=True)
            self.run_w1_review_cycle(driver, bundle_id)
            self.mix_w1_states(driver, bundle_id, extras, locations)
            self.upload_rejected_files(bundle_id)
            self.suggest_w1_with_ai(driver, bundle_id, extras)
            self.set_members(bundle_id)
        except Exception:
            # 반쪽 W1은 다음 실행이 "이미 있다"며 건너뛴다 — 지우고 다시 던진다
            if driver.bundle_id:
                driver.delete_bundle()
            raise

    # ---------- 단계별·가벼운·빈 묶음 ----------

    def create_stage_bundle(self, title: str, stage: str) -> int | None:
        driver = SyntheticDriver(self.client, self.synthetic, AUTHOR, title=title[:200])
        try:
            driver.start()
            driver.save_answers(skip_omitted=False)
            driver.put_semantic_checks()
            bundle_id = driver.bundle_id
            if stage == "ready":
                return bundle_id
            self.review(bundle_id, "request", AUTHOR)
            if stage in ("returned", "resubmitted"):
                self.review(bundle_id, "return", REVIEWER, self.long_reason)
            if stage == "resubmitted":
                driver.put_semantic_checks()
                self.review(bundle_id, "request", AUTHOR)
                self.set_members(bundle_id)  # 검토 중인 묶음의 멤버 다섯
            if stage in ("done", "reopened"):
                self.review(bundle_id, "complete", REVIEWER)
            if stage == "reopened":
                self.review(bundle_id, "reopen", AUTHOR, "합성 다시 열기 사유 " + long_text(400, "ko"))
            return bundle_id
        except Exception:
            if driver.bundle_id:
                driver.delete_bundle()
            raise

    def create_light_bundle(self, index: int, title: str) -> None:
        description = ("합성 설명 " + long_text(880, "ko"))[:900] if index % 4 == 0 else ("" if index % 4 == 1 else f"합성 짧은 설명 {index}")
        response = self.client.post("/api/bundles", json={"title": title, "is_synthetic": index % 6 != 4, "description": description}, headers=AUTHOR)
        if response.status_code != 201:
            self.fail(f"light bundle #{index} ({len(title)} chars): {response.status_code} {response.text[:200]}")
            return
        bundle = response.json()
        if index % 3 == 2:
            self.upload_extra(bundle["id"], f"SYNTHETIC_OLD-{index}_light_{index}.docx", build_small(f"L-{index}", 5))
        if index % 5 == 0:
            members = [{"login_id": "qa.member", "role": "author"}, {"login_id": "qa.lead", "role": "reviewer"}, {"login_id": "dev.admin", "role": "reviewer"}]
            self.client.put(f"/api/bundles/{bundle['id']}/members", json={"revision": bundle["revision"], "members": members}, headers=AUTHOR)

    def create_bundles(self) -> None:
        existing = self.list_bundle_titles()

        def ensure(title: str, create: Callable[[], object]) -> None:
            """같은 제목이 이미 있으면 건너뛴다. 항목마다 한 행만 쓰므로 빈 제목처럼 겹치는 제목도 개수대로 맞는다."""
            if existing[title.strip()] >= 1:
                existing[title.strip()] -= 1
                self.skipped += 1
                print(f"skipped  {title.strip()[:60]}", flush=True)
                return
            print(f"seeding  {title.strip()[:60]}", flush=True)
            create()
            self.created += 1

        if not any(t.startswith(W1_PREFIX) for t in existing):
            print(f"seeding  {W1_PREFIX}", flush=True)
            self.create_w1()
            self.created += 1
        else:
            self.skipped += 1
            print(f"skipped  {W1_PREFIX}", flush=True)
        for title, stage in STAGE_BUNDLES:
            prefix = " ".join(title.split()[:3])  # "SYNTHETIC W2 in-review"
            if any(t.startswith(prefix) for t in existing):
                self.skipped += 1
                print(f"skipped  {prefix}", flush=True)
            else:
                print(f"seeding  {prefix}", flush=True)
                self.create_stage_bundle(title, stage)
                self.created += 1
        ensure(EMPTY_TITLE, lambda: self.client.post("/api/bundles", json={"title": EMPTY_TITLE, "is_synthetic": True}, headers=AUTHOR))
        for index, title in enumerate(LIGHT_TITLES):
            ensure(title, lambda i=index, t=title: self.create_light_bundle(i, t))
        self.create_map_bundles()
        self.check_validation_limits()

    # ---------- 참조 지도용 묶음 ----------

    def create_map_bundles(self) -> None:
        """M1~M8 — 있는지는 제목 접두로 본다. M6~M8은 끝에 작성자가 빠지므로 prod.member의 목록까지 본다."""
        response = self.client.get("/api/bundles", headers=OUTSIDER)
        assert response.status_code == 200, response.text
        titles = list(self.list_bundle_titles()) + [bundle["title"] for bundle in response.json()]
        for spec in build_map_plan():
            prefix = build_map_prefix(spec.n)
            if any(title.startswith(prefix) for title in titles):
                self.skipped += 1
                print(f"skipped  {prefix}", flush=True)
                continue
            print(f"seeding  {prefix}", flush=True)
            self.create_map_bundle(spec)
            self.created += 1

    def create_map_bundle(self, spec: MapBundleSpec) -> None:
        bundle_id = create_bundle(self.client, title=spec.title, is_synthetic=True)["id"]
        try:
            tobe = put_tobe_codes(self.client, bundle_id, [build_tobe_doc(code, title) for code, title in spec.tobe])
            for doc in spec.docs:
                self.fill_map_doc(bundle_id, doc, tobe)
            if spec.members:  # 구성원은 끝에 — M6~M8은 작성자가 빠져 더 고칠 수 없다
                response = set_members(self.client, bundle_id, list(spec.members))
                assert response.status_code == 200, response.text
        except Exception:
            # 반쪽 묶음은 다음 실행이 "이미 있다"며 건너뛴다 — 지우고 다시 던진다
            delete_bundle(self.client, bundle_id)
            raise

    def fill_map_doc(self, bundle_id: int, spec: MapDocSpec, tobe: dict[str, int]) -> None:
        """올리고, 번호·제목을 바꾸고, 참조 줄 확인 → 이동 → 보내기 순으로 줄을 다룬다(편집은 판단보다 먼저)."""
        doc = upload_old_doc(self.client, bundle_id, spec.file_name, [line.text for line in spec.lines])
        changes = {key: value for key, value in (("doc_code", spec.doc_code or None), ("title", spec.title)) if value is not None}
        if changes:
            response = self.client.patch(
                f"/api/bundles/{bundle_id}/documents/{doc['id']}", json={"revision": doc["revision"], **changes}, headers=AUTHOR
            )
            assert response.status_code == 200, response.text
        for line in spec.lines:
            if line.ref:
                confirm_ref(self.client, bundle_id, doc["id"], line.text, line.ref)
        for line in spec.lines:
            if line.move_to:
                self.move_line(bundle_id, find_line(self.client, bundle_id, doc["id"], line.text), line.move_to)
        for line in spec.lines:
            if line.assign_to:
                unit = find_line(self.client, bundle_id, doc["id"], line.text)
                assign_as_is(self.client, bundle_id, unit, tobe[line.assign_to], slot_key="purpose")

    def move_line(self, bundle_id: int, unit: dict, code: str) -> None:
        group = get_group_by_unit(self.client, bundle_id, unit["id"])
        revision = next(member for member in group["units"] if member["unit_id"] == unit["id"])["decision"]["revision"]
        body = {
            "action": "move_external", "reason": "Synthetic map move", "move_target_code": code,
            "units": [{"unit_id": unit["id"], "revision": revision}],
        }
        response = self.client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text

    def check_validation_limits(self) -> None:
        """입력 상한 밖(제목 201자·설명 2,001자)은 422로 거절돼야 한다 — 어긋나면 실패로 센다."""
        for body in ({"title": "x" * 201, "is_synthetic": True}, {"title": "SYNTHETIC too long description", "description": "d" * 2001, "is_synthetic": True}):
            response = self.client.post("/api/bundles", json=body, headers=AUTHOR)
            if response.status_code != 422:
                self.fail(f"over-limit bundle input was accepted: {response.status_code}")

    # ---------- 관리 자료 ----------

    def create_admin_data(self) -> None:
        from app.access.catalog import PERMISSIONS

        perms = list(PERMISSIONS)
        listed = self.client.get("/api/access/roles", headers=ADMIN).json()
        existing_names = {role["name"] for role in listed}
        role_ids: dict[int, int] = {}
        for i, name in enumerate(ROLE_NAMES):
            if name[:100].strip() in existing_names:  # 서버가 앞뒤 공백을 걷어 저장한다
                continue
            p = perms if i in (0, 1, 4) else (["bundle.create"] if i == 3 else ([] if i == 5 else perms[i % len(perms)::2]))
            body = {"name": name[:100], "description": (long_text(480, "ko") if i % 2 == 0 else "Synthetic role")[:500], "permissions": p}
            response = self.client.post("/api/access/roles", json=body, headers=ADMIN)
            if response.status_code not in (200, 201):
                self.fail(f"role {i}: {response.status_code} {response.text[:200]}")
            else:
                role_ids[i] = response.json()["id"]
        if not role_ids:
            print("skipped  roles and grants", flush=True)
        else:
            self.create_grants(role_ids, perms)
        self.create_guideline_versions()

    def create_grants(self, role_ids: dict[int, int], perms: list[str]) -> None:
        """부여 41건 — 디렉터리에 없는 대상 둘 포함, 모든 권한 역할(4번)은 일부러 부여하지 않는다."""
        count = 0

        def grant(body: dict) -> None:
            nonlocal count
            response = self.client.post("/api/access/grants", json=body, headers=ADMIN)
            count += response.status_code in (200, 201)

        for i, role_id in role_ids.items():
            if i == 4:
                continue
            for j, (subject_type, subject_id) in enumerate(GRANT_SUBJECTS):
                if i in (0, 1) and subject_id not in ("synthetic.missing.user", "SYNTHETIC-MISSING-DEPT", "DIV-IT"):
                    continue
                if (i + j) % 2 == 0 or i == 3:
                    grant({"subject_type": subject_type, "subject_id": subject_id, "role_id": role_id})
        grant({"subject_type": "user", "subject_id": "qa.member", "permission": "bundle.create"})
        for subject_id in ("prod.member", "ops.member"):
            for permission in perms[:4]:
                grant({"subject_type": "user", "subject_id": subject_id, "permission": permission})
        print(f"roles created {len(role_ids)}, grants created {count}", flush=True)

    def create_guideline_versions(self) -> None:
        """지침 키 3개에 버전 3개씩(내용 +1,500자, 메모 200자)."""
        guidelines = self.client.get("/api/admin/guidelines", headers=ADMIN).json()
        if any(v["note"].startswith("합성 메모") for g in guidelines for v in g["versions"]):
            print("skipped  guideline versions", flush=True)
            return
        for item in guidelines[:3]:
            current = self.client.get(f"/api/admin/guidelines/{item['key']}/versions/{item['versions'][0]['version']}", headers=ADMIN).json()
            for k in range(3):
                body = {"content": current.get("content", "synthetic") + f"\n\n합성 추가 지침 {k}: " + long_text(1500, "ko"), "note": ("합성 메모 " + long_text(300, "ko"))[:200]}
                response = self.client.post(f"/api/admin/guidelines/{item['key']}/versions", json=body, headers=ADMIN)
                if response.status_code not in (200, 201):
                    self.fail(f"guideline version {item['key']}: {response.status_code} {response.text[:200]}")


def _seed_worst() -> int:
    # 로컬 .env가 AI를 켜 두어도 워커를 띄우지 않는다 — run_jobs_until_idle과 작업을 다투고 가짜 전송이 풀린 뒤 실제 주소로 나간다
    settings.ai_enabled = settings.embed_enabled = False
    with TestClient(app) as client, tempfile.TemporaryDirectory(prefix="sop-worst-") as directory:
        seeder = WorstSeeder(client, build_synthetic_bundle(Path(directory)))
        seeder.create_bundles()
        seeder.create_admin_data()
        total = seeder.created + seeder.skipped
        print(json.dumps({"created": seeder.created, "skipped": seeder.skipped, "failures": len(seeder.failures)}))
        print(f"worst seed done: {total} bundles")
        return 1 if seeder.failures else 0


async def main() -> int:
    try:
        auth_mode = settings.resolved_auth_mode()
        hr_rows = await count_hr_rows() if auth_mode == "dev" else 0
        refusal = find_seed_refusal(auth_mode, is_postgres=engine.dialect.name == "postgresql", hr_rows=hr_rows)
        if refusal:
            print(f"refusing to seed: {refusal} ({engine.url.render_as_string(hide_password=True)})", file=sys.stderr)
            return 1
        await engine.dispose()  # 가드가 연 풀 연결은 이 루프에 묶여 있다 — 앱이 자기 루프에서 새 연결을 열게 먼저 닫는다
        return await asyncio.to_thread(_seed_worst)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
