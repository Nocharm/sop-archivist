"""결과물 A·B·C와 Excel의 언어별 문구 — 코드 값의 표시 이름·위치 표기·이어짐/합침/나눔 표시. SOP 칸 이름은 두 언어 모두 영문 그대로."""

from dataclasses import dataclass

# 칸 키(SLOT_KEYS)마다 하나 — 칸 이름은 도메인 문서 §2의 영문 이름 그대로 — 새 문서가 영문 칸 제목을 쓰므로 한글판도 바꾸지 않는다
SLOT_LABELS = {
    "purpose": "Purpose",
    "scope": "Scope",
    "definitions": "Definitions",
    "responsibilities": "Responsibilities",
    "general_requirements": "General Requirements",
    "general_requirements.safety": "General Requirements › Safety",
    "general_requirements.operation": "General Requirements › Operation",
    "procedures": "Procedures",
    "procedures.procedure": "Procedures › Procedure",
    "procedures.electronic_record_control": "Procedures › Electronic Record Control",
    "procedures.troubleshooting": "Procedures › Troubleshooting",
    "procedures.maintenance": "Procedures › Maintenance",
    "document_relationships": "Document Relationships",
    "document_relationships.attachments": "Document Relationships › Attachments",
    "document_relationships.appendices": "Document Relationships › Appendices",
}

WI_PART_LABELS = {"instruction": "Instruction", "why": "Why"}


@dataclass(frozen=True)
class OutputLabels:
    """한 언어의 문구 — 틀(…_template)은 str.format으로 숫자를 채운다(표·행·열·단계는 1부터)."""

    change_types: dict[str, str]
    statuses: dict[str, str]
    dest_kinds: dict[str, str]  # sop | wi | delete | move_external
    unassigned: str  # 흐름도의 미배정 노드
    parts: dict[str, str]  # 본문이 아닌 부분(머리말·꼬리말…)
    paragraph: str
    figure: str
    cell_template: str  # {table} {row} {col}
    table_template: str  # {table}
    table_row_template: str  # {table} {row}
    table_source_template: str  # 결과물 A 표 줄의 원문 칸 — {table} {rows} {cols}
    wi_step_template: str  # {step} {part}
    wi_unstepped_template: str  # {part}
    no_section: str
    continued: str
    merged: str
    split: str
    translated: str
    slots: dict[str, str]
    wi_parts: dict[str, str]


LABELS = {
    "ko": OutputLabels(
        change_types={
            "as_is": "그대로", "tone": "말투", "rewritten": "고쳐 씀", "split": "나눔", "merged": "합침",
            "translated": "번역", "deleted": "삭제", "new": "신규", "table_restructured": "표 구성 변경",
            "translated_added": "번역 · 추가", "heading": "칸 제목",
        },
        statuses={"unassigned": "미배정", "ai_suggested": "AI 제안", "confirmed": "확정", "on_hold": "보류"},
        dest_kinds={"sop": "새 SOP", "wi": "WI", "delete": "삭제", "move_external": "다른 문서로 이동"},
        unassigned="미배정",
        parts={"header": "머리말", "footer": "꼬리말", "footnote": "각주", "endnote": "미주", "textbox": "텍스트 상자"},
        paragraph="문단",
        figure="그림",
        cell_template="표 {table} · {row}행 {col}열",
        table_template="표 {table}",
        table_row_template="표 {table} · {row}행",
        table_source_template="[표 {table}, {rows}×{cols}]",
        wi_step_template="{step}단계 · {part}",
        wi_unstepped_template="단계 없음 · {part}",
        no_section="(절 없음)",
        continued="(이어짐)",
        merged="(합침)",
        split="(나눔)",
        translated="(번역)",
        slots=SLOT_LABELS,
        wi_parts=WI_PART_LABELS,
    ),
    "en": OutputLabels(
        change_types={
            "as_is": "As is", "tone": "Tone", "rewritten": "Rewritten", "split": "Split", "merged": "Merged",
            "translated": "Translated", "deleted": "Deleted", "new": "New", "table_restructured": "Table restructured",
            "translated_added": "Translated · Added", "heading": "Slot heading",
        },
        statuses={"unassigned": "Unassigned", "ai_suggested": "AI suggested", "confirmed": "Confirmed", "on_hold": "On hold"},
        dest_kinds={"sop": "New SOP", "wi": "WI", "delete": "Deleted", "move_external": "Moved to another document"},
        unassigned="Unassigned",
        parts={"header": "Header", "footer": "Footer", "footnote": "Footnote", "endnote": "Endnote", "textbox": "Text box"},
        paragraph="Paragraph",
        figure="Figure",
        cell_template="Table {table} · R {row} C {col}",
        table_template="Table {table}",
        table_row_template="Table {table} · R {row}",
        table_source_template="[Table {table}, {rows}×{cols}]",
        wi_step_template="Step {step} · {part}",
        wi_unstepped_template="No step · {part}",
        no_section="(No section)",
        continued="(continued)",
        merged="(merged)",
        split="(split)",
        translated="(translated)",
        slots=SLOT_LABELS,
        wi_parts=WI_PART_LABELS,
    ),
}
