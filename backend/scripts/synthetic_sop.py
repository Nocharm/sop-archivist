"""합성 SOP 묶음 생성기 — QC Centrifuge 사례(옛 SOP 5개 → 새 SOP 1개·WI 4개)의 파일과 기대 정답 JSON을 만든다(스펙 §13, 도메인 사례 §1).

모든 문장은 지어낸 것이고 실제 SOP 문장이 아니다. 파일 이름은 `SYNTHETIC_`로 시작하고 DOCX 핵심 속성 title·subject에
`SYNTHETIC`이 들어간다. 같은 입력이면 같은 바이트다(zip 항목 시각·문서 속성 시각을 고정한다).
개발 전용이다 — 개발 의존성 python-docx와 테스트 팩토리(tests.pdf_factory)를 쓰므로 운영 이미지에서는 부르지 않는다.

만드는 파일(out_dir 아래):
- OLD-1·OLD-2(Eppendorf, 한/영 연달아)·OLD-3(Beckman Coulter, 한/영 따로)·OLD-4(Thermoscientific, 연달아) DOCX,
  OLD-5(Labogene, 영어만) 텍스트 PDF, 입구 2 새 문서 WI-04(Labogene 운전, 영어만) DOCX
- `SYNTHETIC_tobe.xlsx` — To-Be 목록 가져오기 템플릿(SOP-CF와 WI-01–03, 단계)
- `SYNTHETIC_expected.json` — 기대 정답(아래 형식, 계획 2의 가짜 AI도 같은 파일을 정답으로 쓴다)

expected.json 형식:
- `bundle_title`: 묶음 제목.
- `tobe_na_slots`: [{code, slot_key, reason}] — Excel 템플릿에 N/A 칸이 없어 To-Be 가져오기 뒤 PUT /tobe로 싣는다(선택 키).
- `edits`: 쪼개기 편집. split은 {doc, op, unit_text, at_text}(at = unit_text 안 at_text 위치),
  set_layout_table은 {doc, op, table_index, is_layout}(table_index는 문서 안 표 번호, 0부터).
- `answers`: 옛 문서의 판단 단위마다 하나(표 단위 포함, 묶인 칸 문장은 표 답의 칸 targets가 맡는다).
  - 단위는 (doc 문서 번호, text 정확한 글자, occurrence 같은 글자 중 몇 번째, 1부터)로 가리킨다. `kind`("table"·"figure")가
    있으면 그 종류 단위 중에서, 없으면 글 단위(문장·제목·칸 문장) 중에서 찾는다. 표 단위의 text는 ""다.
  - `group`이 같은 답은 한 번에 저장한다(관계 묶음 저장 한 번). `disposition`은 assigned·delete·move_external, `reason`은 사유.
  - 선택 키: `lang`(생성기가 쓴 언어 ko·en·neutral — 서버의 언어 판정과 같아야 한다), `move_target_code`(외부 이동 문서 번호),
    `bulk`(true면 그 묶음은 일괄 처분 POST /decisions/bulk로 저장 — 구조 제목·머리말), `identical`(true면 입구 2 같은 글자
    후보로 한 번에 확정되는 답 — 관계 묶음 저장으로 보내지 않는다).
  - `targets`: 보낸 새 문장. `key`가 같은 새 문장은 한 새 문장(합침, 출처는 그 key를 가진 답들의 단위)이다. `code`는 새 문서 번호,
    위치는 `slot_key`(SOP) 또는 `wi_step`+`wi_part`(WI) 또는 `section_path`(입구 2 — 새 문서의 기존 새 문장을 text로 찾는다).
    `kind`(sentence·table·figure), `lang`, `text`(확정 글자, 표·그림은 없음), `change_type`(결과물의 변경 종류 — 나눔·합침은 구조로
    정해지므로 요청에는 싣지 않는다), 표는 `grid`. 칸 새 문장은 `parent_key`·`cell_row`·`cell_col`·`source_text`(출처 칸 문장 글자,
    표 답과 같은 문서)를 갖는다.
- `match`: 입구 2. `identical_count`(같은 글자 후보 수), `new_texts`([{doc, text, lang, section_path}] — 짝 없는 새 문장, 신규).
- `omitted`: {doc, text, occurrence} — 일부러 남기는 누락. answers에도 들어 있고(혼자인 group) 검토 요청 거절을 본 뒤 저장한다.
- `summary`: 언어별 기대 요약 숫자 {old_units, unassigned, duplicate, deleted, moved, new}(선택 키, answers에서 센다).
- `flow_edge_total`: 언어별 결과물 B 간선 수 합(선택 키 — 옛 커버 단위마다 보낸 새 문서 수, 없으면 1).
"""

import itertools
import json
import re
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import docx
from docx.document import Document as DocxDocument
from docx.oxml.parser import parse_xml
from docx.shared import Inches
from openpyxl import Workbook
from PIL import Image, ImageDraw

from app.sop.tobe_excel import DOC_HEADER, DOC_SHEET, STEP_HEADER, STEP_SHEET
from tests.pdf_factory import build_text_pdf

FILE_PREFIX = "SYNTHETIC_"
EXPECTED_FILE = f"{FILE_PREFIX}expected.json"
TOBE_FILE = f"{FILE_PREFIX}tobe.xlsx"
BUNDLE_TITLE = "SYNTHETIC QC Centrifuge"
# 같은 입력이면 같은 바이트 — 문서 속성 시각과 zip 항목 시각을 이 값으로 고정한다
FIXED_TIME = datetime(2026, 1, 1, tzinfo=UTC)
FIXED_ZIP_TIME = (2026, 1, 1, 0, 0, 0)
_CORE_TIME_RE = re.compile(r"(<dcterms:(created|modified)\b[^>]*>)[^<]*(</dcterms:\2>)")

SOP_CODE = "SOP-CF"
MATCH_CODE = "WI-04"
MOVE_TARGET_CODE = "SOP-QC-99999"
LAYOUTS = {"interleaved": "ko_en_interleaved", "separate": "ko_en_separate", "en_only": "en_only"}

STRUCTURE_REASON = "합성: 구조 제목·머리말·꼬리말은 새 문서 양식(SOP 칸·WI 단계)이 대신한다."
REPEAT_REASON = "합성: 같은 문장이 5절에도 있어 한 번만 남긴다."
DUPLICATE_REASON = "합성: 안전 요구사항은 SOP에 두고, 같은 행동을 WI-01 4단계에서도 지시한다."
HISTORY_REASON = "합성: 장비 도입 이력은 절차 내용이 아니다."
PURCHASE_REASON = "합성: 구매 이력은 절차 내용이 아니어서 WI-04에 옮기지 않았다."
MOVE_REASON = "합성: 교정 절차는 장비 교정 SOP가 관리한다."
SHAPE_REASON = "합성: 글 상자의 도형 틀은 그림이 아니다(상자 글은 따로 옮겼다)."
NA_REASON = "합성: QC 원심분리기는 별도 문제 해결 절차 없이 제조사 지원으로 처리한다."

TOBE_DOCS = (
    # (번호, 제목, 종류, 부모 SOP 번호, 장비 SOP 여부)
    (SOP_CODE, "Use and Maintenance of QC Centrifuge", "SOP", "", "Y"),
    ("WI-01", "Operation of Eppendorf Centrifuge", "WI", SOP_CODE, "N"),
    ("WI-02", "Operation of Beckman Coulter Centrifuge", "WI", SOP_CODE, "N"),
    ("WI-03", "Operation of Thermoscientific Centrifuge", "WI", SOP_CODE, "N"),
)
TOBE_STEPS = (
    ("WI-01", 1, "Pre-cool and check"),
    ("WI-01", 2, "Load the tubes"),
    ("WI-01", 3, "Mount the rotor and close the lid"),
    ("WI-01", 4, "Start the run"),
    ("WI-01", 5, "Unload and clean"),
    ("WI-02", 1, "Load the tubes"),
    ("WI-02", 2, "Start the run"),
    ("WI-02", 3, "Clean the rotor"),
    ("WI-03", 1, "Power on"),
    ("WI-03", 2, "Set and start the run"),
)

# 입구 2 — OLD-5(PDF)와 WI-04(새 문서)에 같은 글자로 들어가는 문장
LEVEL_BENCH = "Check that the centrifuge is placed on a level bench."
POWER_ON = "Plug in the power cord and switch on the centrifuge."
BALANCE = "Balance the tubes by weight before loading the rotor."
WAIT_STOP = "Wait until the rotor stops before opening the lid."
CLOSE_LID_NEW = "Close the lid firmly before starting the run."
SELECT_PROGRAM = "Select the program."
PRESS_RUN = "Press RUN to start the centrifuge."
LOGBOOK = "Record the run in the equipment logbook."
WI04_PREPARATION, WI04_OPERATION, WI04_AFTER_USE = "1. Preparation", "2. Operation", "3. After use"


@dataclass(frozen=True)
class SyntheticDocument:
    path: Path
    side: str  # old | new
    layout: str  # documents.language_layout 값
    doc_type: str | None  # 새 문서(side=new)만 — 입구 2 To-Be 줄의 종류
    parent_code: str | None


@dataclass(frozen=True)
class SyntheticBundle:
    directory: Path
    documents: list[SyntheticDocument]
    tobe_file: Path
    expected: dict


# --- 기대 정답 ---


def _sop(slot_key: str, text: str, change_type: str, lang: str, *, key: str | None = None) -> dict:
    return _target(SOP_CODE, {"slot_key": slot_key}, text, change_type, lang, key=key)


def _wi(
    code: str, step: int, part: str, text: str, change_type: str, lang: str, *, key: str | None = None
) -> dict:
    return _target(code, {"wi_step": step, "wi_part": part}, text, change_type, lang, key=key)


def _match(section_path: str, text: str, change_type: str) -> dict:
    return _target(MATCH_CODE, {"section_path": section_path}, text, change_type, "en")


def _target(code: str, location: dict, text: str, change_type: str, lang: str, *, key: str | None = None) -> dict:
    target = {"code": code, **location, "kind": "sentence", "lang": lang, "text": text, "change_type": change_type}
    return target if key is None else {"key": key, **target}


class _AnswerSheet:
    """문서를 쓰는 순서대로 정답을 적는다 — 글자를 한 곳에서만 정해 문서와 정답이 어긋나지 않게 한다.

    add는 적은 글자를 돌려줘 문서를 쓰는 코드가 그 글자를 그대로 쓴다. 같은 (문서, 종류, 글자)는 나온 순서대로 occurrence를 센다.
    """

    def __init__(self) -> None:
        self.answers: list[dict] = []
        self._seen: Counter[tuple[str, str, str]] = Counter()
        self._groups = itertools.count(1)
        self._keys = itertools.count(1)

    def add(
        self,
        doc: str,
        text: str,
        lang: str,
        *targets: dict,
        group: str | None = None,
        disposition: str = "assigned",
        reason: str = "",
        kind: str | None = None,
        **extra: object,
    ) -> str:
        self._seen[(doc, kind or "text", text)] += 1
        keyed = [target if "key" in target else {"key": f"t{next(self._keys):03d}", **target} for target in targets]
        answer: dict = {
            "doc": doc, "text": text, "occurrence": self._seen[(doc, kind or "text", text)], "lang": lang,
            "group": group or f"g{next(self._groups):02d}", "disposition": disposition, "reason": reason,
            "targets": keyed,
        }
        if kind is not None:
            answer["kind"] = kind
        answer.update(extra)
        self.answers.append(answer)
        return text

    def structure(self, doc: str, text: str, lang: str) -> str:
        """구조 제목·머리말·꼬리말 — 한 번에 일괄 삭제한다."""
        return self.add(doc, text, lang, group="g-structure", disposition="delete", reason=STRUCTURE_REASON, bulk=True)

    def delete(self, doc: str, text: str, lang: str, reason: str, *, kind: str | None = None) -> str:
        return self.add(doc, text, lang, disposition="delete", reason=reason, kind=kind)

    def headings(self, document: DocxDocument, doc: str, ko: str, en: str) -> None:
        """한/영 절 제목 한 쌍을 Heading 1로 쓴다 — 구조 제목이라 일괄 삭제한다."""
        for text, lang in ((ko, "ko"), (en, "en")):
            document.add_paragraph(self.structure(doc, text, lang), style="Heading 1")

    def move(self, doc: str, text: str, lang: str) -> str:
        return self.add(
            doc, text, lang, disposition="move_external", reason=MOVE_REASON, move_target_code=MOVE_TARGET_CODE
        )


def _summarize(answers: list[dict], new_texts: list[dict]) -> tuple[dict, dict]:
    """언어별 기대 요약 숫자와 결과물 B 간선 합 — 서버와 같은 규칙(중립은 두 언어 모두, 칸 문장은 표의 처분)으로 센다."""
    stats = {lang: Counter() for lang in ("ko", "en")}
    disposition_keys = {"delete": "deleted", "move_external": "moved", "assigned": "assigned"}
    for answer in answers:
        if answer.get("kind") == "table":
            counted = [(cell["lang"], {cell["code"]}) for cell in answer["targets"] if "parent_key" in cell]
        else:
            counted = [(answer["lang"], {target["code"] for target in answer["targets"]})]
        for lang, codes in counted:
            for each in ("ko", "en") if lang == "neutral" else (lang,):
                stats[each]["old_units"] += 1
                stats[each][disposition_keys[answer["disposition"]]] += 1
                stats[each]["duplicate"] += len(codes) >= 2
                stats[each]["edges"] += max(1, len(codes))
    summary = {
        lang: {
            "old_units": counts["old_units"], "unassigned": 0, "duplicate": counts["duplicate"],
            "deleted": counts["deleted"], "moved": counts["moved"],
            "new": sum(item["lang"] == lang for item in new_texts),
        }
        for lang, counts in stats.items()
    }
    return summary, {lang: counts["edges"] for lang, counts in stats.items()}


# --- 파일 만들기 공용 ---


def _freeze_zip(data: bytes) -> bytes:
    """zip 항목 시각과 핵심 속성의 만든·고친 시각을 고정해 다시 싼다 — 저장 라이브러리는 지금 시각을 적는다."""
    out = BytesIO()
    with zipfile.ZipFile(BytesIO(data)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            content = source.read(info)
            if info.filename == "docProps/core.xml":
                fixed = FIXED_TIME.strftime("%Y-%m-%dT%H:%M:%SZ")
                content = _CORE_TIME_RE.sub(rf"\g<1>{fixed}\g<3>", content.decode("utf-8")).encode("utf-8")
            target.writestr(zipfile.ZipInfo(info.filename, date_time=FIXED_ZIP_TIME), content, zipfile.ZIP_DEFLATED)
    return out.getvalue()


def _new_docx(code: str, title: str) -> DocxDocument:
    document = docx.Document()
    props = document.core_properties
    props.title = f"SYNTHETIC {code} {title}"
    props.subject = "SYNTHETIC test data, not a real SOP"
    props.keywords = "SYNTHETIC"
    props.author = props.last_modified_by = "SYNTHETIC generator"
    props.created = props.modified = FIXED_TIME
    props.revision = 1
    return document


def _save_docx(document: DocxDocument) -> bytes:
    buffer = BytesIO()
    document.save(buffer)
    return _freeze_zip(buffer.getvalue())


def _add_paragraphs(document: DocxDocument, *texts: str, style: str | None = None) -> None:
    for text in texts:
        document.add_paragraph(text, style=style)


def _add_table(document: DocxDocument, rows: list[list[str]]) -> None:
    table = document.add_table(rows=len(rows), cols=len(rows[0]))
    for row_cells, row_texts in zip(table.rows, rows, strict=True):
        for cell, text in zip(row_cells.cells, row_texts, strict=True):
            cell.text = text


def _add_textbox(document: DocxDocument, paragraphs: list[str]) -> None:
    """Word가 저장하는 모양의 텍스트 상자 하나 — Choice(DrawingML)와 Fallback(VML)이 같은 글을 담는다(메인 추출기는 Choice만 읽는다)."""
    content = "".join(f'<w:p><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>' for text in paragraphs)
    run = (
        '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
        ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
        ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
        ' xmlns:v="urn:schemas-microsoft-com:vml">'
        '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>'
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0"'
        ' locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
        '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
        '<wp:extent cx="3657600" cy="685800"/><wp:wrapNone/><wp:docPr id="901" name="Text Box 901"/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>'
        '<a:ext cx="3657600" cy="685800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
        f"<wps:txbx><w:txbxContent>{content}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>"
        "</a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>"
        '<mc:Fallback><w:pict><v:shape type="#_x0000_t202" style="width:288pt;height:54pt">'
        f"<v:textbox><w:txbxContent>{content}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r>"
    )
    document.add_paragraph()._p.append(parse_xml(run))


def _draw_figure() -> bytes:
    """로터 장착 위치 그림 — 글자 없는 도형만 그린다."""
    image = Image.new("RGB", (240, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((60, 20, 180, 140), outline="black", width=3)
    for x, y in ((120, 35), (165, 80), (120, 125), (75, 80)):
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill="gray")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


# --- 옛 문서 ---


def _build_old_1(sheet: _AnswerSheet) -> tuple[bytes, list[dict]]:
    """OLD-1 Eppendorf — 한/영 연달아, 1–7절, 나눌 복합 문장·데이터 표·캡션 그림·같은 문장 반복."""
    doc, add = "OLD-1", sheet.add
    document = _new_docx(doc, "Eppendorf Centrifuge and Microcentrifuge")

    sheet.headings(document, doc, "1. 목적", "1. Purpose")
    _add_paragraphs(
        document,
        add(doc, "이 절차는 Eppendorf 원심분리기를 안전하고 일관되게 사용하는 방법을 정한다.", "ko", _sop(
            "purpose", "이 SOP는 QC 원심분리기를 안전하고 일관되게 사용하고 유지 관리하기 위한 요구사항을 정한다.",
            "rewritten", "ko",
        )),
        add(doc, "This procedure describes how to use the Eppendorf centrifuge safely and consistently.", "en", _sop(
            "purpose",
            "This SOP sets the requirements for the safe and consistent use and maintenance of QC centrifuges.",
            "rewritten", "en",
        )),
    )
    sheet.headings(document, doc, "2. 적용 범위", "2. Scope")
    _add_paragraphs(
        document,
        add(doc, "이 절차는 QC 실험실의 Eppendorf 원심분리기와 마이크로 원심분리기에 적용한다.", "ko", _sop(
            "scope", "이 SOP는 QC 실험실의 모든 원심분리기와 마이크로 원심분리기에 적용한다.", "rewritten", "ko",
        )),
        add(
            doc, "This procedure applies to Eppendorf centrifuges and microcentrifuges in the QC laboratory.", "en",
            _sop(
                "scope", "This SOP applies to all centrifuges and microcentrifuges in the QC laboratory.", "rewritten",
                "en",
            ),
        ),
    )
    sheet.headings(document, doc, "3. 정의", "3. Definitions")
    rcf_ko, rcf_en = "RCF는 상대 원심력을 뜻하며 g로 표시한다.", "RCF means relative centrifugal force and is expressed in g."
    _add_paragraphs(
        document,
        add(doc, rcf_ko, "ko", _sop("definitions", rcf_ko, "as_is", "ko")),
        add(doc, rcf_en, "en", _sop("definitions", rcf_en, "as_is", "en")),
    )
    sheet.headings(document, doc, "4. 책임", "4. Responsibilities")
    _add_paragraphs(
        document,
        add(doc, "QC 분석자는 사용 전에 원심분리기 상태를 점검한다.", "ko", _sop(
            "responsibilities", "QC 분석자는 사용 전에 원심분리기 상태를 점검하여야 한다.", "tone", "ko",
        )),
        add(doc, "The QC analyst checks the condition of the centrifuge before use.", "en", _sop(
            "responsibilities", "The QC analyst shall check the condition of the centrifuge before use.", "tone", "en",
        )),
        add(doc, "QC 팀장은 원심분리기 사용 기록을 매월 검토한다.", "ko", _sop(
            "responsibilities", "QC 팀장은 원심분리기 사용 기록을 매월 검토하여야 한다.", "tone", "ko",
        )),
        add(doc, "The QC team leader reviews the centrifuge use records every month.", "en", _sop(
            "responsibilities", "The QC team leader shall review the centrifuge use records every month.", "tone", "en",
        )),
    )
    sheet.headings(document, doc, "5. 절차", "5. Procedure")
    gloves_ko, gloves_en = "보호 장갑과 보안경을 착용한다.", "Wear protective gloves and safety glasses."
    tubes_ko, tubes_en = "튜브를 대칭으로 배치하여 균형을 맞춘다.", "Place the tubes symmetrically to balance the load."
    why_ko, why_en = "균형이 맞지 않으면 진동으로 로터가 손상될 수 있다.", "An unbalanced load can damage the rotor through vibration."
    _add_paragraphs(
        document,
        add(doc, gloves_ko, "ko", _sop(
            "general_requirements.safety", "원심분리기를 다룰 때는 보호 장갑과 보안경을 착용하여야 한다.", "tone", "ko",
        )),
        add(doc, gloves_en, "en", _sop(
            "general_requirements.safety",
            "Protective gloves and safety glasses shall be worn when handling the centrifuge.", "rewritten", "en",
        )),
        add(doc, tubes_ko, "ko", _wi("WI-01", 2, "instruction", tubes_ko, "as_is", "ko")),
        add(doc, tubes_en, "en", _wi("WI-01", 2, "instruction", tubes_en, "as_is", "en")),
        add(doc, why_ko, "ko", _wi("WI-01", 2, "why", why_ko, "as_is", "ko")),
        add(doc, why_en, "en", _wi("WI-01", 2, "why", why_en, "as_is", "en")),
    )
    # 복합 문장 — 편집으로 둘로 나눈 뒤 3단계(장착·닫기)와 4단계(시작)로 보낸다
    mount_ko, start_ko = "로터를 장착하고 뚜껑을 닫은 후", "START 버튼을 누른다."
    add(doc, mount_ko, "ko", _wi("WI-01", 3, "instruction", "로터를 장착하고 뚜껑을 닫는다.", "tone", "ko"))
    add(doc, start_ko, "ko", _wi("WI-01", 4, "instruction", start_ko, "as_is", "ko"))
    compound_ko = f"{mount_ko} {start_ko}"
    _add_paragraphs(
        document,
        compound_ko,
        # 영어 짝은 편집 없이 한 단위를 두 새 문장으로 나눈다(관계 나눔 1:2)
        add(
            doc, "Mount the rotor, close the lid and press START.", "en",
            _wi("WI-01", 3, "instruction", "Mount the rotor and close the lid.", "split", "en"),
            _wi("WI-01", 4, "instruction", "Press START.", "split", "en"),
        ),
    )
    document.add_picture(BytesIO(_draw_figure()), width=Inches(1.6))
    figure_target = {
        "code": "WI-01", "wi_step": 3, "wi_part": "instruction", "kind": "figure", "lang": "neutral",
        "change_type": "as_is",
    }
    caption = add(doc, "그림 1. 로터 장착 위치 (Figure 1. Rotor mounting position)", "neutral", figure_target, kind="figure")
    document.add_paragraph(caption, style="Caption")
    table_ko, table_en = "운전 조건은 아래 표를 따른다.", "Run conditions are given in the table below."
    _add_paragraphs(
        document,
        add(doc, table_ko, "ko", _wi("WI-01", 4, "instruction", table_ko, "as_is", "ko")),
        add(doc, table_en, "en", _wi("WI-01", 4, "instruction", table_en, "as_is", "en")),
    )
    rows = [["Rotor", "Speed", "Time"], ["F-45-30-11", "14,000 rpm", "10 min"]]
    location = {"code": "WI-01", "wi_step": 4, "wi_part": "instruction"}
    cells = [
        {
            **location, "parent_key": "t-table-1", "kind": "sentence", "lang": "en", "text": text,
            "change_type": "as_is", "source_text": text, "cell_row": row, "cell_col": col,
        }
        for row, texts in enumerate(rows)
        for col, text in enumerate(texts)
    ]
    table_target = {
        "key": "t-table-1", **location, "kind": "table", "lang": "neutral", "change_type": "as_is",
        "grid": {"rows": len(rows), "cols": len(rows[0])},
    }
    add(doc, "", "neutral", table_target, *cells, kind="table")
    _add_table(document, rows)
    _add_paragraphs(
        document,
        # OLD-2의 문장과 합쳐 5단계 한 문장이 된다(합침)
        add(doc, "원심분리 후 로터가 완전히 멈춘 것을 확인한다.", "ko", _wi(
            "WI-01", 5, "instruction", "로터가 완전히 멈춘 것을 확인한 후 뚜껑을 연다.", "merged", "ko", key="t-merge-ko",
        ), group="g-merge-ko"),
        add(doc, "Confirm that the rotor has stopped completely after centrifugation.", "en", _wi(
            "WI-01", 5, "instruction", "Open the lid only after confirming that the rotor has stopped completely.",
            "merged", "en", key="t-merge-en",
        ), group="g-merge-en"),
    )
    sheet.headings(document, doc, "6. 유지 관리", "6. Maintenance")
    maintain_ko, maintain_en = "로터와 챔버는 6개월마다 점검하여야 한다.", "The rotor and chamber shall be inspected every 6 months."
    _add_paragraphs(
        document,
        # 5절과 같은 글자의 반복 — 두 번째는 지운다
        sheet.delete(doc, gloves_ko, "ko", REPEAT_REASON),
        sheet.delete(doc, gloves_en, "en", REPEAT_REASON),
        add(doc, maintain_ko, "ko", _sop("procedures.maintenance", maintain_ko, "as_is", "ko")),
        add(doc, maintain_en, "en", _sop("procedures.maintenance", maintain_en, "as_is", "en")),
    )
    sheet.headings(document, doc, "7. 참고 문서", "7. References")
    manual_ko, manual_en = "제조사 사용 설명서를 참고한다.", "Refer to the manufacturer's operating manual."
    _add_paragraphs(
        document,
        add(doc, manual_ko, "ko", _sop("document_relationships", manual_ko, "as_is", "ko")),
        add(doc, manual_en, "en", _sop("document_relationships", manual_en, "as_is", "en")),
    )
    edits = [{"doc": doc, "op": "split", "unit_text": compound_ko, "at_text": start_ko}]
    return _save_docx(document), edits


def _build_old_2(sheet: _AnswerSheet) -> tuple[bytes, dict]:
    """OLD-2 Eppendorf 5702R — 한/영 연달아, OLD-1과 합칠 문장 한 쌍·중복 배정·일부러 남기는 누락."""
    doc, add = "OLD-2", sheet.add
    document = _new_docx(doc, "Eppendorf 5702R Centrifuge")
    sheet.headings(document, doc, "1. 운전", "1. Operation")
    precool_ko = "냉장 원심분리기는 사용 전에 설정 온도까지 미리 냉각한다."
    precool_en = "Pre-cool the refrigerated centrifuge to the set temperature before use."
    alarm_ko, alarm_en = "불균형 경고가 울리면 즉시 운전을 멈추어야 한다.", "Stop the run immediately if the imbalance alarm sounds."
    wipe_ko, wipe_en = "사용 후 챔버의 물기를 마른 천으로 닦는다.", "After use, wipe moisture from the chamber with a dry cloth."
    _add_paragraphs(
        document,
        add(doc, precool_ko, "ko", _wi("WI-01", 1, "instruction", precool_ko, "as_is", "ko")),
        add(doc, precool_en, "en", _wi("WI-01", 1, "instruction", precool_en, "as_is", "en")),
        add(
            doc, alarm_ko, "ko",
            _sop("general_requirements.safety", alarm_ko, "as_is", "ko"),
            _wi("WI-01", 4, "instruction", "불균형 경고가 울리면 STOP 버튼을 눌러 운전을 멈춘다.", "tone", "ko"),
            reason=DUPLICATE_REASON,
        ),
        add(
            doc, alarm_en, "en",
            _sop(
                "general_requirements.safety", "The run shall be stopped immediately if the imbalance alarm sounds.",
                "tone", "en",
            ),
            _wi(
                "WI-01", 4, "instruction", "If the imbalance alarm sounds, press STOP to stop the run.", "rewritten",
                "en",
            ),
            reason=DUPLICATE_REASON,
        ),
        add(doc, "회전이 멈춘 뒤 뚜껑을 연다.", "ko", _wi(
            "WI-01", 5, "instruction", "로터가 완전히 멈춘 것을 확인한 후 뚜껑을 연다.", "merged", "ko", key="t-merge-ko",
        ), group="g-merge-ko"),
        add(doc, "Open the lid after the rotation stops.", "en", _wi(
            "WI-01", 5, "instruction", "Open the lid only after confirming that the rotor has stopped completely.",
            "merged", "en", key="t-merge-en",
        ), group="g-merge-en"),
        add(doc, wipe_ko, "ko", _wi("WI-01", 5, "instruction", wipe_ko, "as_is", "ko")),
        add(doc, wipe_en, "en", _wi("WI-01", 5, "instruction", wipe_en, "as_is", "en")),
    )
    return _save_docx(document), {"doc": doc, "text": precool_ko, "occurrence": 1}


def _build_old_3(sheet: _AnswerSheet) -> bytes:
    """OLD-3 Beckman Coulter — 한글 전체 뒤 영어 전체(따로), 삭제 한 쌍, 머리말·꼬리말."""
    doc, add = "OLD-3", sheet.add
    document = _new_docx(doc, "Beckman Coulter Centrifuge and Microcentrifuge")
    sections = (
        ("ko", "1. 운전", "2. 이력", (
            "시료 튜브를 로터의 마주 보는 자리에 넣는다.",
            "속도와 시간을 설정하고 START 버튼을 누른다.",
            "운전이 끝나면 로터를 꺼내 70% 에탄올로 닦는다.",
        ), "이 장비는 2015년에 QC 실험실에 설치되었다."),
        ("en", "1. Operation", "2. History", (
            "Put the sample tubes in opposite positions of the rotor.",
            "Set the speed and time and press START.",
            "When the run ends, remove the rotor and wipe it with 70% ethanol.",
        ), "This instrument was installed in the QC laboratory in 2015."),
    )
    for lang, operation, history, steps, installed in sections:
        document.add_paragraph(sheet.structure(doc, operation, lang), style="Heading 1")
        for step, text in enumerate(steps, start=1):
            document.add_paragraph(add(doc, text, lang, _wi("WI-02", step, "instruction", text, "as_is", lang)))
        document.add_paragraph(sheet.structure(doc, history, lang), style="Heading 1")
        document.add_paragraph(sheet.delete(doc, installed, lang, HISTORY_REASON))
    section = document.sections[0]
    section.header.paragraphs[0].text = sheet.structure(doc, "SYNTHETIC OLD-3 Beckman Coulter", "en")
    section.footer.paragraphs[0].text = sheet.structure(doc, "합성 문서 - 실제 SOP 아님", "ko")
    return _save_docx(document)


def _build_old_4(sheet: _AnswerSheet) -> tuple[bytes, list[dict]]:
    """OLD-4 Thermoscientific — 한/영 연달아, 한/영 두 열 레이아웃 표(보통 표로 만들고 편집으로 바꾼다)·텍스트 상자·외부 이동."""
    doc, add = "OLD-4", sheet.add
    document = _new_docx(doc, "Thermoscientific Centrifuge")
    sheet.headings(document, doc, "1. 운전", "1. Operation")
    power_ko, power_en = "전원 스위치를 켜고 자가 진단이 끝날 때까지 기다린다.", "Switch on the power and wait until the self-test finishes."
    _add_paragraphs(
        document,
        add(doc, power_ko, "ko", _wi("WI-03", 1, "instruction", power_ko, "as_is", "ko")),
        add(doc, power_en, "en", _wi("WI-03", 1, "instruction", power_en, "as_is", "en")),
    )
    rows = [
        ["로터 커버를 닫는다.", "Close the rotor cover."],
        ["설정 화면에서 속도와 시간을 입력한다.", "Enter the speed and time on the settings screen."],
    ]
    for ko, en in rows:
        add(doc, ko, "ko", _wi("WI-03", 2, "instruction", ko, "as_is", "ko"))
        add(doc, en, "en", _wi("WI-03", 2, "instruction", en, "as_is", "en"))
    _add_table(document, rows)
    # 메인 추출기는 글 상자의 도형을 캡션 없는 그림 단위로도 낸다 — 그림이 아니므로 지운다
    sheet.delete(doc, "", "neutral", SHAPE_REASON, kind="figure")
    _add_textbox(document, [
        add(doc, "주의: 로터마다 최대 회전 속도가 다르므로 로터에 표시된 값을 넘기지 않는다.", "ko", _wi(
            "WI-03", 2, "instruction", "로터마다 최대 회전 속도가 다르므로 로터에 표시된 값을 넘기지 않는다.", "tone", "ko",
        )),
        add(
            doc, "Caution: each rotor has its own maximum speed, so do not exceed the value marked on the rotor.", "en",
            _wi(
                "WI-03", 2, "instruction",
                "Each rotor has its own maximum speed, so do not exceed the value marked on the rotor.", "tone", "en",
            ),
        ),
    ])
    sheet.headings(document, doc, "2. 교정", "2. Calibration")
    _add_paragraphs(
        document,
        sheet.move(doc, "원심분리기 교정은 장비 교정 SOP에 따른다.", "ko"),
        sheet.move(doc, "Calibration of the centrifuge follows the equipment calibration SOP.", "en"),
    )
    edits = [{"doc": doc, "op": "set_layout_table", "table_index": 0, "is_layout": True}]
    return _save_docx(document), edits


def _build_old_5(sheet: _AnswerSheet) -> bytes:
    """OLD-5 Labogene — 영어만(ASCII) 텍스트 PDF. 문단마다 한 문장이고 WI-04와 짝을 맞춘다."""
    doc, add = "OLD-5", sheet.add
    paragraphs = [
        add(doc, LEVEL_BENCH, "en", _match(WI04_PREPARATION, LEVEL_BENCH, "as_is"), identical=True),
        add(doc, POWER_ON, "en", _match(WI04_PREPARATION, POWER_ON, "as_is"), identical=True),
        add(doc, BALANCE, "en", _match(WI04_OPERATION, BALANCE, "as_is"), identical=True),
        add(
            doc, "The lid should be closed firmly before starting.", "en",
            _match(WI04_OPERATION, CLOSE_LID_NEW, "tone"),
        ),
        add(
            doc, "Select the program and press RUN to start the centrifuge.", "en",
            _match(WI04_OPERATION, SELECT_PROGRAM, "split"), _match(WI04_OPERATION, PRESS_RUN, "split"),
        ),
        add(doc, WAIT_STOP, "en", _match(WI04_AFTER_USE, WAIT_STOP, "as_is"), identical=True),
        sheet.delete(doc, "The Labogene centrifuge was purchased for the QC laboratory.", "en", PURCHASE_REASON),
    ]
    lines: list[str] = []
    for text in paragraphs:
        lines += [text, ""]  # 빈 줄이 문단 경계다
    return build_text_pdf([lines[:-1]])


def _build_wi_04() -> tuple[bytes, list[dict]]:
    """WI-04 Labogene 운전 — 입구 2 새 문서(영어만). OLD-5와 같은 글자 문장·고쳐 쓴 문장·나눈 문장·신규 문장."""
    document = _new_docx(MATCH_CODE, "Labogene Centrifuge Operation")
    sections = (
        (WI04_PREPARATION, (LEVEL_BENCH, POWER_ON)),
        (WI04_OPERATION, (BALANCE, CLOSE_LID_NEW, SELECT_PROGRAM, PRESS_RUN)),
        (WI04_AFTER_USE, (WAIT_STOP, LOGBOOK)),
    )
    for heading, texts in sections:
        document.add_paragraph(heading, style="Heading 1")
        _add_paragraphs(document, *texts)
    new_texts = [{"doc": MATCH_CODE, "text": LOGBOOK, "lang": "en", "section_path": WI04_AFTER_USE}]
    return _save_docx(document), new_texts


def _build_tobe() -> bytes:
    """To-Be 목록 가져오기 템플릿 — 화면이 내려 주는 템플릿과 같은 시트·머리 줄(N/A는 템플릿에 없다)."""
    workbook = Workbook()
    doc_sheet = workbook.active
    doc_sheet.title = DOC_SHEET
    doc_sheet.append(DOC_HEADER)
    for code, title, doc_type, parent, equipment in TOBE_DOCS:
        doc_sheet.append([code, title, doc_type, parent or None, equipment])
    step_sheet = workbook.create_sheet(STEP_SHEET)
    step_sheet.append(STEP_HEADER)
    for row in TOBE_STEPS:
        step_sheet.append(list(row))
    workbook.properties.title = "SYNTHETIC QC Centrifuge To-Be"
    workbook.properties.creator = "SYNTHETIC generator"
    buffer = BytesIO()
    workbook.save(buffer)
    return _freeze_zip(buffer.getvalue())


def build_synthetic_bundle(out_dir: Path) -> SyntheticBundle:
    """합성 자료 파일과 SYNTHETIC_expected.json을 out_dir에 쓰고 돌려준다 — 같은 입력이면 같은 바이트."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet = _AnswerSheet()
    old_1, split_edits = _build_old_1(sheet)
    old_2, omitted = _build_old_2(sheet)
    old_3 = _build_old_3(sheet)
    old_4, layout_edits = _build_old_4(sheet)
    old_5 = _build_old_5(sheet)
    wi_04, new_texts = _build_wi_04()
    files = (
        # (파일 이름, 바이트, 쪽, 언어 배치, 새 문서 종류, 부모 번호)
        ("SYNTHETIC_OLD-1_Eppendorf_Centrifuge_and_Microcentrifuge.docx", old_1, "old", "interleaved", None, None),
        ("SYNTHETIC_OLD-2_Eppendorf_5702R_Centrifuge.docx", old_2, "old", "interleaved", None, None),
        ("SYNTHETIC_OLD-3_Beckman_Coulter_Centrifuge.docx", old_3, "old", "separate", None, None),
        ("SYNTHETIC_OLD-4_Thermoscientific_Centrifuge.docx", old_4, "old", "interleaved", None, None),
        ("SYNTHETIC_OLD-5_Labogene_Centrifuge.pdf", old_5, "old", "en_only", None, None),
        ("SYNTHETIC_WI-04_Labogene_Centrifuge_Operation.docx", wi_04, "new", "en_only", "wi", SOP_CODE),
    )
    documents = []
    for name, data, side, layout, doc_type, parent_code in files:
        path = out_dir / name
        path.write_bytes(data)
        documents.append(SyntheticDocument(path, side, LAYOUTS[layout], doc_type, parent_code))
    tobe_file = out_dir / TOBE_FILE
    tobe_file.write_bytes(_build_tobe())

    summary, flow_edge_total = _summarize(sheet.answers, new_texts)
    identical_count = sum(bool(answer.get("identical")) for answer in sheet.answers)
    expected = {
        "bundle_title": BUNDLE_TITLE,
        "tobe_na_slots": [{"code": SOP_CODE, "slot_key": "procedures.troubleshooting", "reason": NA_REASON}],
        "edits": split_edits + layout_edits,
        "answers": sheet.answers,
        "match": {"identical_count": identical_count, "new_texts": new_texts},
        "omitted": omitted,
        "summary": summary,
        "flow_edge_total": flow_edge_total,
    }
    (out_dir / EXPECTED_FILE).write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return SyntheticBundle(directory=out_dir, documents=documents, tobe_file=tobe_file, expected=expected)
