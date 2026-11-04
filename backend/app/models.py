"""SQLAlchemy declarative base and shared column helpers (each model change needs an Alembic revision)."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, MetaData, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.clock import now as _now_kst

# 제약 이름을 규칙으로 고정한다 — SQLite 배치 마이그레이션(render_as_batch)은 이름 없는 제약을
# 지우거나 바꾸지 못하고, 자동 생성되는 이름은 DB마다 달라 리비전 이식성이 깨진다.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _now() -> datetime:
    """타임스탬프 컬럼 기본값 — 기준시 KST (app.clock)."""
    return _now_kst()


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Employee(Base):
    """사내 직원 디렉터리 — loginId PK. source=hr(HR 웹훅이 관리)|dev(로컬 시드, 동기화가 건드리지 않음)."""

    __tablename__ = "employees"

    login_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    # hr | dev — 동기화의 삭제·비활성 대상은 hr 행뿐이다
    source: Mapped[str] = mapped_column(String(10), default="hr")
    # 조직 레벨 원본(루트→리프, 최대 5) — departments 체인이 안 풀릴 때의 경로 폴백
    org_l1: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l2: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l3: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l4: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l5: Mapped[str | None] = mapped_column(String(200), default=None)
    department: Mapped[str] = mapped_column(String(200), default="")
    # 퇴직자는 행을 지우지 않고 false — 디렉터리·권한에서만 빠진다
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # HR deptCode — departments.dept_code 느슨 참조(FK 없음: 미러에 없는 코드도 받아야 한다)
    dept_code: Mapped[str | None] = mapped_column(String(100), default=None)
    korean_name: Mapped[str] = mapped_column(String(200), default="")
    korean_dept: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Department(Base):
    """HR 조직도 미러 — kind=departments 응답 그대로, dept_code 키. 부서 체인(권한 상속)의 소스."""

    __tablename__ = "departments"

    dept_code: Mapped[str] = mapped_column(String(100), primary_key=True)
    parent_dept_code: Mapped[str | None] = mapped_column(String(100), default=None)
    level: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(300), default="")
    name_ko: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class BatchJobRun(Base):
    """배치 작업 실행 기록 — (job, outcome)별 최신 1행만 upsert 보전(관리 화면의 배치 작업 목록 소스).

    db-backup 사이드카는 psql로 같은 테이블에 기록한다 — 스키마를 바꾸면
    scripts/db-backup.sh의 CREATE TABLE IF NOT EXISTS/INSERT도 함께 갱신할 것.
    """

    __tablename__ = "batch_job_runs"

    # 잡 식별자 — 'db_backup' | 'hr_sync'
    job: Mapped[str] = mapped_column(String(40), primary_key=True)
    # 'success' | 'failure' — 결과별 최신 1행이 PK로 강제된다
    outcome: Mapped[str] = mapped_column(String(10), primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 성공=요약 카운트, 실패=사유
    detail: Mapped[str | None] = mapped_column(Text, default=None)


class HrSyncRun(Base):
    """HR 전체 동기화 회차 이력 — 회차마다 1행, 최근 HR_SYNC_HISTORY_KEEP건만 보전.

    대량 퇴직 같은 피드 사고를 멈추는 대신 기록해, 사후에 누가 바뀌었는지 되짚을 수 있게 한다.
    """

    __tablename__ = "hr_sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    # 'success' | 'failure' — batch_job_runs와 같은 값
    outcome: Mapped[str] = mapped_column(String(10))
    # 실패=중단 사유·예외, 성공=None
    detail: Mapped[str | None] = mapped_column(Text, default=None)
    scanned: Mapped[int] = mapped_column(Integer, default=0)
    created: Mapped[int] = mapped_column(Integer, default=0)
    deactivated: Mapped[int] = mapped_column(Integer, default=0)
    reactivated: Mapped[int] = mapped_column(Integer, default=0)
    deleted: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    # 관리 인원(source=hr, 동기화 전) — 대량 퇴직 판정의 분모
    managed: Mapped[int] = mapped_column(Integer, default=0)
    mass_departure: Mapped[bool] = mapped_column(Boolean, default=False)
    # 바뀐 사람 — {"created"|"deactivated"|"reactivated"|"deleted"|"duplicates": [{login_id, name, department}]}
    changes: Mapped[dict | None] = mapped_column(JSON, default=None)
