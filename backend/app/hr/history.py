"""HR 전체 동기화 회차 이력 — 회차 1행 기록·보존 정리·대량 퇴직 판정 (관리 화면의 HR 이력이 소비).

동기화를 멈추지 않고 기록으로 남긴다 — 피드 사고로 대량 퇴직이 나도 누가 바뀌었는지 회차별로 되짚을 수 있다.
"""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, HrSyncRun

# 보존 회차 수 — 일 1회 주기 기준 약 6개월. 넘으면 오래된 회차부터 지운다
HR_SYNC_HISTORY_KEEP = 200
# 대량 퇴직 경고 — 한 회차의 퇴직+삭제가 관리 인원의 5% 이상이면서 10명 이상
MASS_DEPARTURE_PCT = 5
MASS_DEPARTURE_MIN = 10

# changes 키 — 이력 API 응답 필드와 같은 집합
CHANGE_KINDS = ("created", "deactivated", "reactivated", "deleted", "duplicates")

Person = dict[str, str]


def is_mass_departure(departed: int, managed: int) -> bool:
    """퇴직+삭제 인원이 경고 기준을 넘는지 — 분모는 동기화 전 관리 인원."""
    return departed >= MASS_DEPARTURE_MIN and departed * 100 >= MASS_DEPARTURE_PCT * max(managed, 1)


def describe_person(emp: Employee) -> Person:
    """이력에 남길 사람 스냅샷 — 한글 이름 우선, 부서는 리프명."""
    return {
        "login_id": emp.login_id,
        "name": emp.korean_name or emp.name or "",
        "department": emp.department or "",
    }


async def record_hr_sync_run(session: AsyncSession, run: HrSyncRun) -> None:
    """회차 1행 추가 + 보존 수를 넘긴 오래된 회차 정리 + commit — 세션은 정리된 상태 전제."""
    session.add(run)
    await session.flush()
    cutoff = await session.scalar(
        select(HrSyncRun.id).order_by(HrSyncRun.id.desc()).offset(HR_SYNC_HISTORY_KEEP - 1).limit(1)
    )
    if cutoff is not None:
        await session.execute(delete(HrSyncRun).where(HrSyncRun.id < cutoff))
    await session.commit()
