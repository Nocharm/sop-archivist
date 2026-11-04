"""SQLAlchemy declarative base and shared column helpers (each model change needs an Alembic revision)."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ColumnElement,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Text,
    and_,
)
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

    db-backup 사이드카는 psql로 같은 테이블에 INSERT만 한다 — 테이블은 Alembic 0002가 만들고(사이드카가
    먼저 만들면 0002가 "already exists"로 깨진다), 사이드카는 생길 때까지 기다린다. 컬럼을 바꾸면
    scripts/db-backup.sh의 INSERT도 함께 갱신할 것.
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


class Role(Base):
    """권한 묶음 — 관리 화면에서 만들고 고친다. 권한 키 목록은 role_permissions."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class RolePermission(Base):
    """역할에 든 권한 키 하나. 키는 FK가 아니다 — 카탈로그(app.access.catalog)는 코드라 판정 때 모르는 키를 버린다."""

    __tablename__ = "role_permissions"

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission: Mapped[str] = mapped_column(String(100), primary_key=True)


class AccessGrant(Base):
    """부여 — (대상, 역할 또는 권한 하나). 대상은 개인 login_id 또는 부서 dept_code.

    대상은 FK가 아니다: 조직 개편·HR 삭제로 대상 행이 사라져도 부여는 남아 관리 화면에 "대상 없음"으로 보이고,
    판정에서는 체인·직원 조회에 걸리지 않아 저절로 무시된다.
    """

    __tablename__ = "access_grants"
    __table_args__ = (
        CheckConstraint(
            "(role_id IS NOT NULL AND permission IS NULL) OR (role_id IS NULL AND permission IS NOT NULL)",
            name="role_xor_permission",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "user" | "dept" — API 경계에서 제한한다
    subject_type: Mapped[str] = mapped_column(String(10))
    subject_id: Mapped[str] = mapped_column(String(100))
    # 부여가 남은 역할은 지울 수 없다 — 지우면 받은 사람들의 권한이 조용히 사라지므로 회수를 먼저 요구한다
    role_id: Mapped[int | None] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), default=None
    )
    permission: Mapped[str | None] = mapped_column(String(100), default=None)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    @classmethod
    def build_identity_filter(
        cls, subject_type: str, subject_id: str, role_id: int | None, permission: str | None
    ) -> ColumnElement[bool]:
        """같은 부여를 찾는 조건. role_id·permission 중 하나는 늘 NULL이라 DB unique로는 중복을 못 막아 API·시드가 이걸로 검사한다."""
        return and_(
            cls.subject_type == subject_type,
            cls.subject_id == subject_id,
            cls.role_id.is_(None) if role_id is None else cls.role_id == role_id,
            cls.permission.is_(None) if permission is None else cls.permission == permission,
        )


class AccessAuditEvent(Base):
    """권한 표 변경 기록 — 역할 생성·수정·삭제와 부여·회수. 변경과 같은 트랜잭션에서 남는다(app.access.audit)."""

    __tablename__ = "access_audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    # 변경한 사람 login_id(인증된 요청 사용자)
    actor: Mapped[str] = mapped_column(String(100))
    # app.access.audit.ACTIONS 중 하나
    action: Mapped[str] = mapped_column(String(30))
    # 무엇이 바뀌었는지 — 역할은 이름·권한(수정은 before/after), 부여는 대상·역할 또는 권한
    detail: Mapped[dict] = mapped_column(JSON)


class LoginRecord(Base):
    """로그인/활동 기록 — 사용자 현황조사용. /api/me 호출 시 KST 하루 1인 1건 기록(집계·리포트는 후속)."""

    __tablename__ = "login_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    # 조회 편의용 표시명 스냅샷(없으면 None)
    name: Mapped[str | None] = mapped_column(String(200), default=None)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )


class AiUsageEvent(Base):
    """AI 호출 1건의 계량 기록 — 질문·답변 원문 없이 누가·어떤 기능으로·몇 토큰을 썼는지만 남긴다."""

    __tablename__ = "ai_usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    # 호출한 기능 이름("ping" 등) — 호출부가 정하는 짧은 상수라 FK 없이 문자열
    feature: Mapped[str] = mapped_column(String(50))
    # 요청 모델 선택자(빈값 = 서버 기본 모델)
    model: Mapped[str] = mapped_column(String(200), default="")
    # 서버가 usage를 안 주거나 호출이 실패하면 None
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
