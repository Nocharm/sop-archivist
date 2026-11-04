"""배치 작업 실행 기록 — (job, outcome)별 최신 1행 upsert. 관리 화면의 배치 작업 목록이 소비한다."""

from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.models import BatchJobRun

JOB_HR_SYNC = "hr_sync"
# 'db_backup'은 scripts/db-backup.sh(psql)가 기록 — 백엔드에선 조회만.
JOB_DB_BACKUP = "db_backup"


async def record_batch_run(
    session: AsyncSession, job: str, outcome: str, detail: str | None
) -> None:
    """잡·결과별 최신 1행 upsert + commit — 배치 흐름 말미에서 호출(세션은 정리된 상태 전제)."""
    row = await session.get(BatchJobRun, (job, outcome))
    if row is None:
        session.add(BatchJobRun(job=job, outcome=outcome, ran_at=clock.now(), detail=detail))
    else:
        row.ran_at = clock.now()
        row.detail = detail
    await session.commit()
