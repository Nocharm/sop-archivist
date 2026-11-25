"""결과물 A·B·C와 Excel의 언어별 문구 — 코드 값의 표시 이름·위치 표기·이어짐/합침/나눔 표시. SOP 칸 이름은 여기 없다(문서 골격 outline.DocOutline.get_label, 두 언어 모두 영문)."""

from dataclasses import dataclass

from app.sop.noise import NOISE_FRONT, NOISE_HISTORY, NOISE_TOC

FIGURE_MARKER = "[Figure]"  # 글이 없는 그림 줄의 글 — 두 언어 모두
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
    band_table: str  # 띠 표 제목 줄의 위치(자리) — 번호는 절 칸에, 원문 칸은 제목만(F4 · F11)
    cell_template: str  # {table} {row} {col}
    nested_separator: str  # 안쪽 표 위치의 앞붙이 — 바깥 칸과 안쪽 자리 사이(F2 · F11, "표 3 · 1행 1열 › 표 4 · 2행 1열")
    table_template: str  # {table}
    table_caption_template: str  # 다른 표의 칸 줄이 된 캡션의 위치 — 칸 좌표가 아니라 캡션 자리(B10), {table}
    figure_caption: str  # 같은 경우의 그림 캡션 위치
    table_source_template: str  # 결과물 A 표 줄의 원문 칸 — {table} {rows} {cols}
    read_number_template: str  # 번호를 고친 줄의 절 — {number}는 고친 번호, {read}는 추출기가 읽은 값
    wi_step_template: str  # {step} {part}
    wi_unstepped_template: str  # {part}
    no_section: str
    continued: str
    merged: str
    split: str
    translated: str
    wi_parts: dict[str, str]
    # 저절로 삭제된 줄(잡음 표시, noise.NOISE_KINDS) — 종류 → 글
    noise_place_templates: dict[str, str]  # 위치(자리) — {lang} {n}(그 문서·종류·언어 안 차례)
    noise_langs: dict[str, str]  # 그 위치의 언어 이름
    noise_remarks: dict[str, str]  # 사유를 적지 않은 줄의 Remark(정한 문구)
    noise_table_template: str  # 결과물 A 원문 칸 — 표 한 줄, {table} {rows} {cols}
    disposed_remarks: dict[str, str]  # Remark를 비운 삭제·이동 줄의 Remark — 처분 → 글


LABELS = {
    "ko": OutputLabels(
        change_types={
            # 그대로는 두 언어 모두 "=" — 읽는 사람에게 필요한 것은 원문 그대로인가 아닌가뿐이다(설계 2026-11-20-change-type-two D3)
            "as_is": "=", "rewritten": "수정", "split": "나눔", "merged": "합침",
            "translated": "번역", "deleted": "삭제", "new": "신규",
            "translated_added": "번역 · 추가", "heading": "칸 제목",
        },
        statuses={"unassigned": "미배정", "ai_suggested": "AI 제안", "confirmed": "확정", "on_hold": "보류", "deleted": "삭제"},
        dest_kinds={"sop": "새 SOP", "wi": "WI", "delete": "삭제", "move_external": "다른 문서로 이동"},
        unassigned="미배정",
        parts={"header": "머리말", "footer": "꼬리말", "footnote": "각주", "endnote": "미주", "textbox": "텍스트 상자"},
        paragraph="문단",
        figure="그림",
        band_table="띠 표",
        cell_template="표 {table} · {row}행 {col}열",
        nested_separator=" › ",
        table_template="표 {table}",
        table_caption_template="표 {table} 캡션",
        figure_caption="그림 캡션",
        table_source_template="[표 {table}, {rows}×{cols}]",
        read_number_template="{number} (읽은 값 {read})",
        wi_step_template="{step}단계 · {part}",
        wi_unstepped_template="단계 없음 · {part}",
        no_section="(절 없음)",
        continued="(이어짐)",
        merged="(합침)",
        split="(나눔)",
        translated="(번역)",
        wi_parts=WI_PART_LABELS,
        noise_place_templates={
            NOISE_TOC: "목차 · {lang} · {n}행", NOISE_FRONT: "본문 앞부분 · {lang} · {n}행",
            NOISE_HISTORY: "개정 이력 · {lang} · {n}행",
        },
        noise_langs={"ko": "한글", "en": "영어", "ref": "REF"},
        noise_remarks={
            NOISE_TOC: "목차 · 새 문서 목차는 앱이 만든다 (저절로)", NOISE_FRONT: "1장 앞이라 삭제",
            NOISE_HISTORY: "개정 이력이라 삭제",
        },
        noise_table_template="표 {table} ({rows}×{cols})",
        disposed_remarks={"delete": "삭제", "move_external": "이동"},
    ),
    "en": OutputLabels(
        change_types={
            "as_is": "=", "rewritten": "Modified", "split": "Split", "merged": "Merged",
            "translated": "Translated", "deleted": "Deleted", "new": "New",
            "translated_added": "Translated · Added", "heading": "Slot heading",
        },
        statuses={
            "unassigned": "Unassigned", "ai_suggested": "AI suggested", "confirmed": "Confirmed", "on_hold": "On hold",
            "deleted": "Deleted",
        },
        dest_kinds={"sop": "New SOP", "wi": "WI", "delete": "Deleted", "move_external": "Moved to another document"},
        unassigned="Unassigned",
        parts={"header": "Header", "footer": "Footer", "footnote": "Footnote", "endnote": "Endnote", "textbox": "Text box"},
        paragraph="Paragraph",
        figure="Figure",
        band_table="Band table",
        cell_template="Table {table} · R {row} C {col}",
        nested_separator=" › ",
        table_template="Table {table}",
        table_caption_template="Table {table} caption",
        figure_caption="Figure caption",
        table_source_template="[Table {table}, {rows}×{cols}]",
        read_number_template="{number} (read as {read})",
        wi_step_template="Step {step} · {part}",
        wi_unstepped_template="No step · {part}",
        no_section="(No section)",
        continued="(continued)",
        merged="(merged)",
        split="(split)",
        translated="(translated)",
        wi_parts=WI_PART_LABELS,
        noise_place_templates={
            NOISE_TOC: "Contents · {lang} · line {n}", NOISE_FRONT: "Front matter · {lang} · line {n}",
            NOISE_HISTORY: "Change history · {lang} · line {n}",
        },
        noise_langs={"ko": "Korean", "en": "English", "ref": "REF"},
        noise_remarks={
            NOISE_TOC: "Contents · the app builds the new contents (automatic)", NOISE_FRONT: "Before chapter 1",
            NOISE_HISTORY: "Change history",
        },
        noise_table_template="Table {table} ({rows}×{cols})",
        disposed_remarks={"delete": "Deleted", "move_external": "Moved"},
    ),
}
