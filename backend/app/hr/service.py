"""HR 웹훅 동기화 서비스 — 전체/단건 동기화·부서 미러·이행 프리뷰.

동기화가 삭제·비활성·덮어쓰기하는 것은 source="hr" 행뿐이다. source="dev"(로컬 시드) 행은 피드에 같은
loginId가 와도 건드리지 않는다.
"""

import logging
import time
from dataclasses import dataclass, field

import httpx2
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.batch_runs import JOB_HR_SYNC, record_batch_run
from app.clock import now as now_kst
from app.hr import client
from app.hr.client import RawHrEmployee
from app.hr.history import CHANGE_KINDS, Person, describe_person, is_mass_departure, record_hr_sync_run
from app.models import Department, Employee, HrSyncRun
from app.settings import settings

logger = logging.getLogger(__name__)

_DELETE_CHUNK = 500  # SQLite IN 바인드 상한(구버전 999) 아래로 유지
_PREVIEW_SAMPLE_CAP = 50  # 프리뷰 샘플 리스트 상한 — 6천명 전수 나열 방지


@dataclass(frozen=True)
class HrEmployeeFields:
    login_id: str
    name: str
    korean_name: str | None  # None = HR 결측 → 기존값 보존(소거 아님)
    korean_dept: str | None
    dept_code: str | None
    department: str | None  # None = 부서·조직 모두 결측 → 기존값 보존
    has_org: bool  # orgLevels가 비면 False — org_l*를 덮지 않는다(피드 누락이 조직을 지우는 사고 방지)
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    org_l4: str | None
    org_l5: str | None
    active: bool
    dept_mismatch: bool  # department != 저장 경로 리프 — 부서 매칭 사각 리포트용
    truncated: bool      # orgLevels 6단계 이상 절사 리포트용


def _clip(value: str | None, limit: int) -> str | None:
    """길이 초과 문자열 자르기 — sqlite는 VARCHAR 미강제지만 운영 Postgres는 초과 시 sync 전체가 실패."""
    return value if value is None else value[:limit]


def to_employee_fields(raw: RawHrEmployee) -> HrEmployeeFields:
    """RawHrEmployee → 저장 필드. 순수 — DB 미접근.

    login_id 길이(100자 초과) 검증은 호출부 책임(파싱 직후 skip) — 여기선 나머지 문자열만 클램프.
    """
    top5 = raw.org_levels[:5]  # 5레벨 초과는 루트 쪽 5개
    l1 = top5[0] if len(top5) > 0 else None
    l2 = top5[1] if len(top5) > 1 else None
    l3 = top5[2] if len(top5) > 2 else None
    l4 = top5[3] if len(top5) > 3 else None
    l5 = top5[4] if len(top5) > 4 else None
    stored_leaf = l5 or l4 or l3 or l2 or l1
    department = raw.department or stored_leaf
    return HrEmployeeFields(
        login_id=raw.login_id,
        name=(raw.name or raw.login_id)[:200],
        korean_name=_clip(raw.name_ko, 200),
        korean_dept=_clip(raw.department_ko, 200),
        dept_code=_clip(raw.dept_code, 100),
        department=_clip(department, 200),
        has_org=bool(top5),
        org_l1=_clip(l1, 200), org_l2=_clip(l2, 200), org_l3=_clip(l3, 200),
        org_l4=_clip(l4, 200), org_l5=_clip(l5, 200),
        # status 결측은 보수적으로 활성. 대소문자는 가리지 않는다 ("Active"로 바뀐 피드가 전원을 퇴직 처리하는 사고 방지)
        active=(raw.status or "active").lower() == "active",
        dept_mismatch=bool(department and stored_leaf and department != stored_leaf),
        truncated=len(raw.org_levels) > 5,
    )


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _collect_fields(
    parsed: list[RawHrEmployee | None],
) -> tuple[dict[str, HrEmployeeFields], int, list[str]]:
    """파싱 행 → login_id별 저장 필드. (필드, 건너뛴 행 수, 중복 loginId 목록).

    같은 loginId가 여러 행이면 재직 행을 우선한다 — 낡은 퇴직 행 하나가 재직자를 퇴직 처리하지 않게.
    재직 여부가 같으면 마지막 행.
    """
    fields_by_id: dict[str, HrEmployeeFields] = {}
    skipped = 0
    duplicate_ids: set[str] = set()
    for raw in parsed:
        if raw is None:
            skipped += 1
            continue
        if len(raw.login_id) > 100:
            skipped += 1  # Postgres VARCHAR(100) 초과 — 매핑 불가
            continue
        fields = to_employee_fields(raw)
        previous = fields_by_id.get(raw.login_id)
        if previous is not None:
            duplicate_ids.add(raw.login_id)
            if previous.active and not fields.active:
                continue
        fields_by_id[raw.login_id] = fields
    return fields_by_id, skipped, sorted(duplicate_ids)


@dataclass(frozen=True)
class HrSyncSummary:
    scanned: int = 0
    upserted: int = 0
    deactivated: int = 0
    deleted: int = 0
    skipped: int = 0
    org_mismatches: int = 0
    truncated_levels: int = 0
    departments_upserted: int = 0
    aborted_reason: str | None = None
    created: int = 0
    reactivated: int = 0
    duplicates: int = 0
    managed: int = 0  # 동기화 전 관리 인원(source=hr) — 대량 퇴직 판정의 분모
    mass_departure: bool = False
    # 바뀐 사람(CHANGE_KINDS별) — 회차 이력 전용. 대량 퇴직이면 수천 명이라 로그 repr에서 뺀다
    changes: dict[str, list[Person]] = field(default_factory=dict, repr=False)


async def _upsert(session: AsyncSession, fields: HrEmployeeFields) -> tuple[Employee, str | None]:
    """HR 필드 upsert — (행, 이번 호출의 상태 전환). 전환은 created·deactivated·reactivated 또는 None."""
    emp = await session.get(Employee, fields.login_id)
    is_new = emp is None
    if emp is None:
        emp = Employee(login_id=fields.login_id, source="hr")
        session.add(emp)
    was_active = bool(emp.active)
    emp.name = fields.name
    if fields.department is not None:
        emp.department = fields.department
    emp.dept_code = fields.dept_code
    if fields.has_org:
        emp.org_l1 = fields.org_l1
        emp.org_l2 = fields.org_l2
        emp.org_l3 = fields.org_l3
        emp.org_l4 = fields.org_l4
        emp.org_l5 = fields.org_l5
    if fields.korean_name is not None:
        emp.korean_name = fields.korean_name
    if fields.korean_dept is not None:
        emp.korean_dept = fields.korean_dept
    emp.active = fields.active
    if is_new:
        return emp, "created"
    if was_active and not fields.active:
        return emp, "deactivated"
    if not was_active and fields.active:
        return emp, "reactivated"
    return emp, None


def _exclude_dev_rows(
    fields_by_id: dict[str, HrEmployeeFields], dev_ids: set[str]
) -> dict[str, HrEmployeeFields]:
    """dev 시드와 loginId가 겹치는 피드 행은 동기화 대상에서 뺀다 — dev 행은 읽기·쓰기 모두 건드리지 않는다."""
    return {login_id: f for login_id, f in fields_by_id.items() if login_id not in dev_ids}


async def sync_all(session: AsyncSession) -> HrSyncSummary:
    """전수 스냅샷 동기화 — 사전 계산 후 일괄 반영. 중단(abort) 시 DB 무변경."""
    count, parsed = await client.fetch_all_employees()
    scanned = len(parsed)
    if count and count != scanned:
        return HrSyncSummary(scanned=scanned, skipped=sum(1 for p in parsed if p is None),
                             aborted_reason=f"count mismatch: header {count} != rows {scanned}")

    fields_by_id, skipped, duplicate_ids = _collect_fields(parsed)
    existing = (await session.execute(select(Employee.login_id, Employee.source))).all()
    managed_ids = {lid for lid, src in existing if src == "hr"}
    dev_ids = {lid for lid, src in existing if src == "dev"}
    fields_by_id = _exclude_dev_rows(fields_by_id, dev_ids)
    duplicate_ids = [lid for lid in duplicate_ids if lid not in dev_ids]
    org_mismatches = sum(1 for f in fields_by_id.values() if f.dept_mismatch)
    truncated_levels = sum(1 for f in fields_by_id.values() if f.truncated)

    if not fields_by_id:
        # 관리할 직원 0명 = 전멸 사고 방어 — 캡(0=off)과 무관하게 항상 중단
        return HrSyncSummary(
            scanned=scanned, skipped=skipped, org_mismatches=org_mismatches,
            truncated_levels=truncated_levels,
            aborted_reason="empty feed: no valid employee rows",
        )

    delete_ids = sorted(managed_ids - fields_by_id.keys())
    cap = settings.hr_sync_delete_cap_pct
    if cap > 0 and managed_ids and len(delete_ids) * 100 > cap * len(managed_ids):
        return HrSyncSummary(
            scanned=scanned, skipped=skipped, org_mismatches=org_mismatches,
            truncated_levels=truncated_levels, duplicates=len(duplicate_ids), managed=len(managed_ids),
            aborted_reason=(
                f"delete cap exceeded: would delete {len(delete_ids)}/{len(managed_ids)} managed rows"
            ),
        )

    changes: dict[str, list[Person]] = {kind: [] for kind in CHANGE_KINDS}
    deactivated_now: set[str] = set()
    for fields in fields_by_id.values():
        emp, transition = await _upsert(session, fields)
        if transition is not None:
            changes[transition].append(describe_person(emp))
        if transition == "deactivated":
            deactivated_now.add(fields.login_id)
    for login_id in duplicate_ids:
        changes["duplicates"].append(describe_person(await session.get(Employee, login_id)))

    for chunk in _chunks(delete_ids, _DELETE_CHUNK):
        # 지우기 전에 이름·부서를 남긴다 — 행이 사라지면 이력에서 누구였는지 알 수 없다
        removed = await session.scalars(select(Employee).where(Employee.login_id.in_(chunk)))
        changes["deleted"].extend(describe_person(emp) for emp in removed)
        await session.execute(delete(Employee).where(Employee.login_id.in_(chunk)))

    departed = deactivated_now | set(delete_ids)
    mass_departure = is_mass_departure(len(departed), len(managed_ids))
    if mass_departure:
        logger.warning(
            "HR sync mass departure: %d of %d managed rows deactivated or deleted",
            len(departed), len(managed_ids),
        )

    departments_upserted = await _mirror_departments(session)
    await session.commit()

    return HrSyncSummary(
        scanned=scanned, upserted=len(fields_by_id), deactivated=len(deactivated_now),
        deleted=len(delete_ids), skipped=skipped, org_mismatches=org_mismatches,
        truncated_levels=truncated_levels, departments_upserted=departments_upserted,
        created=len(changes["created"]), reactivated=len(changes["reactivated"]),
        duplicates=len(duplicate_ids), managed=len(managed_ids), mass_departure=mass_departure,
        changes=changes,
    )


async def _mirror_departments(session: AsyncSession) -> int:
    """kind=departments 미러 — dept_code 업서트 + 피드 부재 코드 삭제. 빈 응답이면 삭제 스킵(사고 방어)."""
    rows = await client.fetch_departments()
    seen: set[str] = set()
    for row in rows:
        if len(row.dept_code) > 100:
            continue  # Postgres VARCHAR(100) 초과 — 매핑 불가
        dept = await session.get(Department, row.dept_code)
        if dept is None:
            dept = Department(dept_code=row.dept_code)
            session.add(dept)
        dept.name = (row.name or "")[:300]
        dept.name_ko = (row.name_ko or "")[:300]
        dept.parent_dept_code = _clip(row.parent_dept_code, 100)
        dept.level = row.level if row.level is not None else 0
        seen.add(row.dept_code)
    if seen:
        existing_codes = set((await session.scalars(select(Department.dept_code))).all())
        for chunk in _chunks(sorted(existing_codes - seen), _DELETE_CHUNK):
            await session.execute(delete(Department).where(Department.dept_code.in_(chunk)))
    return len(seen)


# 전체 동기화 5분 가드 — 인메모리(단일 컨테이너 전제)
_FULL_SYNC_MIN_INTERVAL = 300.0
_last_full_sync_at: float | None = None


class SyncTooSoon(Exception):
    def __init__(self, remaining_seconds: int) -> None:
        self.remaining_seconds = remaining_seconds


def get_upstream_status(exc: BaseException) -> int | None:
    """HR 소스가 돌려준 HTTP 상태 코드 — 응답을 받지 못한 오류(연결·시간 초과)나 HTTP 오류가 아니면 None."""
    return exc.response.status_code if isinstance(exc, httpx2.HTTPStatusError) else None


def describe_failure(exc: BaseException) -> str:
    """실패 기록용 문구 — 예외 클래스명 + (있으면) HTTP 상태 코드.

    예외 메시지는 쓰지 않는다. httpx 상태 오류 메시지에 웹훅 주소가 들어 있고, 이 문구는 관리 API로 읽힌다.
    원문은 호출부(스케줄러·라우터)가 서버 로그에만 남긴다.
    """
    status = get_upstream_status(exc)
    name = type(exc).__name__
    return name if status is None else f"{name}: {status}"


def _summarize_for_record(summary: HrSyncSummary) -> str:
    """성공 기록 detail — 요약 카운트 압축 한 줄. 대량 퇴직이면 끝에 표시."""
    line = (
        f"scanned {summary.scanned} · upserted {summary.upserted}"
        f" · created {summary.created} · deactivated {summary.deactivated}"
        f" · reactivated {summary.reactivated} · deleted {summary.deleted}"
        f" · skipped {summary.skipped}"
    )
    return f"{line} · mass departure" if summary.mass_departure else line


def _build_history_row(summary: HrSyncSummary) -> HrSyncRun:
    return HrSyncRun(
        outcome="success" if summary.aborted_reason is None else "failure",
        detail=summary.aborted_reason,
        scanned=summary.scanned, created=summary.created, deactivated=summary.deactivated,
        reactivated=summary.reactivated, deleted=summary.deleted, skipped=summary.skipped,
        duplicates=summary.duplicates, managed=summary.managed,
        mass_departure=summary.mass_departure, changes=summary.changes or None,
    )


async def run_full_sync(session: AsyncSession) -> HrSyncSummary:
    """5분 가드 적용 전체 동기화 — 실패·중단 시 가드 미소모(재시도 가능).

    실행 기록(batch_job_runs): 정상 완료=success, 가드 중단·예외=failure. 회차 이력(hr_sync_runs)도
    같은 결과로 1행 남긴다. 스로틀(SyncTooSoon)은 시도가 아니므로 기록하지 않는다.
    """
    global _last_full_sync_at
    now = time.monotonic()
    if _last_full_sync_at is not None and now - _last_full_sync_at < _FULL_SYNC_MIN_INTERVAL:
        raise SyncTooSoon(int(_FULL_SYNC_MIN_INTERVAL - (now - _last_full_sync_at)))
    try:
        summary = await sync_all(session)
    except Exception as exc:
        # 실패 기록 전 rollback — sync_all이 중간 상태로 남긴 세션을 정리
        await session.rollback()
        detail = describe_failure(exc)
        await record_batch_run(session, JOB_HR_SYNC, "failure", detail)
        await record_hr_sync_run(session, HrSyncRun(outcome="failure", detail=detail))
        raise
    if summary.aborted_reason is None:
        _last_full_sync_at = now
        await record_batch_run(session, JOB_HR_SYNC, "success", _summarize_for_record(summary))
    else:
        await record_batch_run(session, JOB_HR_SYNC, "failure", summary.aborted_reason)
    await record_hr_sync_run(session, _build_history_row(summary))
    return summary


# 1인 동기화 하루 1회 스로틀 — login_id → KST 날짜 iso (인메모리, 단일 컨테이너 전제)
_one_sync_done: dict[str, str] = {}


async def sync_one(session: AsyncSession, login_id: str) -> Employee | None:
    """로그인 시 1인 동기화 — 동기화한 행을 돌려준다.

    HR 미설정·미존재·dev 시드 행·오늘 이미 조회·웹훅 장애면 None(기존 행 유지).
    """
    if not settings.hr_enabled:
        return None
    current = await session.get(Employee, login_id)
    if current is not None and current.source == "dev":
        return None
    today = now_kst().date().isoformat()
    if _one_sync_done.get(login_id) == today:
        return None
    try:
        raw = await client.fetch_employee(login_id)
    except Exception:  # noqa: BLE001 -- 웹훅 장애가 로그인을 막으면 안 됨 — 기존 행으로 동작
        logger.exception("HR single sync failed for %s - keeping existing row", login_id)
        return None
    _one_sync_done[login_id] = today  # 미존재·성공 모두 오늘 재조회 안 함
    if raw is None:
        return None
    if len(raw.login_id) > 100:
        return None  # Postgres VARCHAR(100) 초과 — 매핑 불가, 기존 행 유지
    await _upsert(session, to_employee_fields(raw))
    await session.commit()
    return await session.get(Employee, login_id)


@dataclass(frozen=True)
class HrSyncPreview:
    scanned: int
    skipped: int
    would_upsert: int
    would_deactivate: int
    would_delete: int
    org_mismatches: int
    truncated_levels: int
    korean_overwrites: int
    new_login_ids: list[str] = field(default_factory=list)
    delete_login_ids: list[str] = field(default_factory=list)
    case_mismatches: list[str] = field(default_factory=list)


async def build_sync_preview(session: AsyncSession) -> HrSyncPreview:
    """이행 드라이런 — DB 무변경으로 첫 실동기화 영향 정량화. 가드 미소모."""
    _, parsed = await client.fetch_all_employees()
    fields_by_id, skipped, _ = _collect_fields(parsed)

    rows = (await session.execute(
        select(Employee.login_id, Employee.source, Employee.active, Employee.korean_name)
    )).all()
    db_ids = {r.login_id for r in rows}
    managed_ids = {r.login_id for r in rows if r.source == "hr"}
    fields_by_id = _exclude_dev_rows(fields_by_id, {r.login_id for r in rows if r.source == "dev"})
    active_ids = {r.login_id for r in rows if r.active}
    korean_by_id = {r.login_id: r.korean_name for r in rows}

    new_ids = sorted(fields_by_id.keys() - db_ids)
    delete_ids = sorted(managed_ids - fields_by_id.keys())
    lower_db = {lid.lower(): lid for lid in db_ids}
    case_mismatches = sorted(
        f"{f.login_id} != db:{lower_db[f.login_id.lower()]}"
        for f in fields_by_id.values()
        if f.login_id not in db_ids and f.login_id.lower() in lower_db
    )
    korean_overwrites = sum(
        1 for f in fields_by_id.values()
        if f.korean_name and korean_by_id.get(f.login_id) and korean_by_id[f.login_id] != f.korean_name
    )

    return HrSyncPreview(
        scanned=len(parsed),
        skipped=skipped,
        would_upsert=len(fields_by_id),
        would_deactivate=sum(
            1 for f in fields_by_id.values() if not f.active and f.login_id in active_ids
        ),
        would_delete=len(delete_ids),
        org_mismatches=sum(1 for f in fields_by_id.values() if f.dept_mismatch),
        truncated_levels=sum(1 for f in fields_by_id.values() if f.truncated),
        korean_overwrites=korean_overwrites,
        new_login_ids=new_ids[:_PREVIEW_SAMPLE_CAP],
        delete_login_ids=delete_ids[:_PREVIEW_SAMPLE_CAP],
        case_mismatches=case_mismatches[:_PREVIEW_SAMPLE_CAP],
    )
