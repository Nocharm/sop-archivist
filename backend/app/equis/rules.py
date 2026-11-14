"""EQUIS 판정 규칙과 옛 번호 따라가기 — DB·HTTP를 모르는 순수 함수(설계 §6·§7).

EDW의 최신판 표시(LATEST_VERSION__V)는 한 문서에 여러 줄이 True라 읽지 않는다. 상태와 판 번호로만 고른다.
"""

import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

Side = Literal["old", "new"]
Version = tuple[int, int]
Fetch = Callable[[str], Awaitable[Sequence["EquisRow"]]]

# 한 번호에서 지금 문서까지 따라가는 최대 횟수 — 넘으면 닿은 문서에서 멈춘다(설계 §7)
MAX_LEGACY_HOPS = 5

_VERSION_RE = re.compile(r"(\d{1,4})(?:\.(\d{1,4}))?")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_LEGACY_SEPARATOR = "/"
# 생애주기 → 그 문서가 "지금 판"일 때의 상태(인계서 7.4)
_END_STATUS = {
    "draft to effective lifecycle": "effective",
    "draft to approved lifecycle": "approved",
    "initial to final lifecycle": "final",
}
_END_STATUS_FALLBACK = ("effective", "approved", "final")
_RETIRED = ("obsolete", "withdrawn")
# 아직 승인 전인 상태 — 제목으로 쓸 이름을 고를 때 뺀다(사용자 결정: Draft 제외, 나머지 둘은 설계 §4.3)
_UNAPPROVED = ("draft", "in review", "in approval")
_AUTHORIZED = "authorized"
_NOTE_STATUSES = ("in review", "in approval")


@dataclass(frozen=True)
class EquisRow:
    """EDW 줄 하나에서 받는 칸만 남긴 것 — 실명 칸은 여기에 자리가 없다(설계 §5·§6.1)."""

    number: str
    doc_id: str
    version: Version
    version_text: str
    status: str
    lifecycle: str
    name: str
    subtype: str
    owning_department: str
    plant: str
    area: str
    legacy_numbers: tuple[str, ...]
    equipment_tag: str
    effective_date: str
    approved_date: str
    superseded_date: str
    obsolete_date: str
    withdrawn_date: str


@dataclass(frozen=True)
class VersionFact:
    version_text: str
    status: str
    effective_date: str = ""
    retired_date: str = ""


@dataclass(frozen=True)
class DocFacts:
    """EQUIS 문서 하나의 사실 — 줄의 쪽과 올린 판에 따라 달라지는 판정은 담지 않는다(설계 §8.1)."""

    doc_id: str
    number: str
    name: str
    subtype: str
    owning_department: str
    plant: str
    area: str
    legacy_numbers: tuple[str, ...]
    equipment_tag: str
    current: VersionFact | None
    in_progress: tuple[VersionFact, ...]
    retired: VersionFact | None
    name_version: VersionFact | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "DocFacts":
        """to_dict로 담아 둔 JSON → DocFacts. 목록으로 풀린 튜플과 판 사실을 되돌린다."""

        def read_version(value: Any) -> VersionFact | None:
            return VersionFact(**value) if isinstance(value, dict) else None

        return cls(
            doc_id=data["doc_id"],
            number=data["number"],
            name=data["name"],
            subtype=data["subtype"],
            owning_department=data["owning_department"],
            plant=data["plant"],
            area=data["area"],
            legacy_numbers=tuple(data["legacy_numbers"]),
            equipment_tag=data["equipment_tag"],
            current=read_version(data["current"]),
            in_progress=tuple(VersionFact(**item) for item in data["in_progress"]),
            retired=read_version(data["retired"]),
            name_version=read_version(data["name_version"]),
        )


@dataclass(frozen=True)
class Verdict:
    verdict: Literal["ok", "attention", "in_equis"]
    reasons: tuple[str, ...] = ()
    notes: tuple[VersionFact, ...] = ()


@dataclass(frozen=True)
class Resolution:
    """물은 번호가 닿은 곳 — trail은 물은 번호부터 지금 번호까지, ambiguous는 고르지 못한 후보 번호."""

    state: Literal["found", "not_found"]
    asked: str
    trail: tuple[str, ...]
    facts: DocFacts | None
    ambiguous: tuple[str, ...] = ()


# --- 읽기 ---


def _read_text(value: object) -> str:
    """웹훅 값(글·불리언·숫자·null)을 글로 맞춘다."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_number(text: str) -> str:
    return text.strip().upper()


def parse_version(text: str) -> Version | None:
    """`14.1` → (14, 1). 앱의 `v3`·`Ver 1.1`·`Rev. 2`도 첫 숫자 묶음으로 읽는다. 못 읽으면 None."""
    match = _VERSION_RE.search(text)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2) or 0)


def read_kst_date(value: object) -> str:
    """`_KST` 칸의 날짜 — 값이 자정 Z로 와도 날짜 부분만 KST 날짜로 읽는다(UTC로 바꾸면 하루가 밀린다)."""
    match = _DATE_RE.match(_read_text(value))
    return match.group(0) if match else ""


def split_legacy(value: object) -> tuple[str, ...]:
    return tuple(part for part in (normalize_number(raw) for raw in _read_text(value).split(_LEGACY_SEPARATOR)) if part)


def parse_row(raw: object) -> EquisRow | None:
    """EDW 줄 → EquisRow. 객체가 아니거나, 필수 칸(번호·문서 ID·판·상태·생애주기)이 없거나, 판을 못 읽으면 None."""
    if not isinstance(raw, Mapping):
        return None
    number = normalize_number(_read_text(raw.get("DOC_DOCUMENT_NUMBER")))
    doc_id = _read_text(raw.get("DOC_DOCUMENT_ID"))
    version_raw = raw.get("DOC_VERSION")
    # 판은 숫자로 와도 소수 자리를 지킨다(2.0을 2로 줄이면 화면의 판 글자가 달라진다)
    version_text = str(version_raw) if isinstance(version_raw, float) else _read_text(version_raw)
    status = _read_text(raw.get("DOC_DOCUMENT_STATUS"))
    lifecycle = _read_text(raw.get("DOC_LIFECYCLE"))
    version = parse_version(version_text)
    if not (number and doc_id and status and lifecycle) or version is None:
        return None
    return EquisRow(
        number=number,
        doc_id=doc_id,
        version=version,
        version_text=version_text,
        status=status,
        lifecycle=lifecycle,
        name=_read_text(raw.get("DOC_DOCUMENT_NAME")),
        subtype=_read_text(raw.get("DOC_SUBTYPE")),
        owning_department=_read_text(raw.get("DOC_OWNING_DEPARTMENT")),
        plant=_read_text(raw.get("DOC_PLANT")),
        area=_read_text(raw.get("DOC_AREA")),
        legacy_numbers=split_legacy(raw.get("DOC_LEGACY_DOCUMENT_ID")),
        equipment_tag=_read_text(raw.get("DOC_EQUIPMENT_TAG_NO")),
        effective_date=read_kst_date(raw.get("DOC_EFFECTIVE_DATE_KST")),
        approved_date=read_kst_date(raw.get("DOC_APPROVED_DATE_KST")),
        superseded_date=read_kst_date(raw.get("DOC_SUPERSEDED_DATE_KST")),
        obsolete_date=read_kst_date(raw.get("DOC_OBSOLETE_DATE_KST")),
        withdrawn_date=read_kst_date(raw.get("DOC_WITHDRAWN_DATE_KST")),
    )


# --- 문서 하나의 사실 ---


def _to_fact(row: EquisRow) -> VersionFact:
    return VersionFact(
        version_text=row.version_text,
        status=row.status,
        effective_date=row.effective_date,
        retired_date=row.obsolete_date or row.withdrawn_date,
    )


def _pick_end_statuses(rows: Sequence[EquisRow]) -> tuple[str, ...]:
    """끝 상태 — 가장 높은 판의 생애주기로 정한다. 모르는 생애주기는 세 끝 상태를 모두 본다."""
    known = _END_STATUS.get(rows[-1].lifecycle.casefold())
    return (known,) if known else _END_STATUS_FALLBACK


def build_facts(rows: Sequence[EquisRow]) -> DocFacts:
    """한 문서의 판 줄들 → 사실. rows는 비어 있지 않아야 한다."""
    ordered = sorted(rows, key=lambda row: row.version)
    top = ordered[-1]
    end_statuses = _pick_end_statuses(ordered)
    current = next((row for row in reversed(ordered) if row.status.casefold() in end_statuses), None)
    named = next((row for row in reversed(ordered) if row.status.casefold() not in _UNAPPROVED), None)
    info = named or top
    return DocFacts(
        doc_id=top.doc_id,
        number=top.number,
        name=named.name if named else "",
        subtype=info.subtype,
        owning_department=info.owning_department,
        plant=info.plant,
        area=info.area,
        legacy_numbers=info.legacy_numbers,
        equipment_tag=info.equipment_tag,
        current=_to_fact(current) if current else None,
        # 지금 판보다 작은 Draft·In Review는 다음 정식 판에 밀려 남은 초안이라 버린다
        in_progress=tuple(_to_fact(row) for row in ordered if current and row.version > current.version),
        retired=_to_fact(top) if top.status.casefold() in _RETIRED else None,
        name_version=_to_fact(named) if named else None,
    )


# --- 줄의 판정 ---


def judge(facts: DocFacts, side: Side, doc_version: str) -> Verdict:
    """문서의 사실 + 줄의 쪽·올린 판 → 판정(설계 §6.4). 새 문서는 폐기만 본다."""
    if facts.retired:
        return Verdict("attention", ("retired",))
    if side == "new":
        return Verdict("in_equis")
    reasons: list[str] = []
    current = facts.current
    if current is None:
        return Verdict("attention", ("no_current",))
    uploaded = parse_version(doc_version)
    if uploaded is not None and uploaded != parse_version(current.version_text):
        reasons.append("version_mismatch")
    if any(fact.status.casefold() == _AUTHORIZED for fact in facts.in_progress):
        reasons.append("newer_authorized")
    notes = tuple(fact for fact in facts.in_progress if fact.status.casefold() in _NOTE_STATUSES)
    return Verdict("attention" if reasons else "ok", tuple(reasons), notes)


# --- 옛 번호 따라가기 ---


def _group_by_doc(rows: Sequence[EquisRow]) -> dict[str, list[EquisRow]]:
    groups: dict[str, list[EquisRow]] = {}
    for row in rows:
        groups.setdefault(row.doc_id, []).append(row)
    return groups


def _read_doc_number(rows: Sequence[EquisRow]) -> str:
    return max(rows, key=lambda row: row.version).number


async def resolve_number(number: str, fetch: Fetch) -> Resolution:
    """번호 → 지금 문서. 맞은 문서가 살아 있으면 거기서 멈추고, 없거나 폐기됐으면 그 번호를 Legacy로 가진 문서로 넘어간다.

    Legacy는 조각이 정확히 같을 때만 잇는다(조회는 일부만 겹쳐도 돌려준다). 이어받은 문서가 둘 이상이면 고르지 않는다.
    """
    asked = normalize_number(number)
    trail = [asked]
    seen: set[str] = set()
    standing: list[EquisRow] = []
    ambiguous: tuple[str, ...] = ()
    current = asked
    for hop in range(MAX_LEGACY_HOPS + 1):
        groups = _group_by_doc(await fetch(current))
        matched = next((rows for rows in groups.values() if _read_doc_number(rows) == current), None)
        if matched:
            standing = matched
            seen.add(matched[0].doc_id)
            if build_facts(matched).retired is None:
                break
        successors = [
            rows
            for doc_id, rows in groups.items()
            if doc_id not in seen and any(current in row.legacy_numbers for row in rows)
        ]
        if len(successors) > 1:
            ambiguous = tuple(sorted(_read_doc_number(rows) for rows in successors))
            break
        if not successors or hop == MAX_LEGACY_HOPS:
            break
        standing = successors[0]
        seen.add(standing[0].doc_id)
        current = _read_doc_number(standing)
        trail.append(current)
    facts = build_facts(standing) if standing else None
    return Resolution("found" if facts else "not_found", asked, tuple(trail), facts, ambiguous)
