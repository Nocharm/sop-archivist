"""사내 AI로 부여 읽기 — 관리자가 쓴 지시를 AI가 줄마다 대상·동작·역할로 읽고, 서버가 대상을 직원·부서에 맞춘다.

아무것도 쓰지 않는다(사용량 행만 남는다). 반영은 관리자가 미리보기에서 고른 줄을 `POST /api/access/grants/batch`로 보낸다.
AI 페이로드에는 관리자의 글과 역할 이름·권한 키만 싣는다 — 직원 명단은 보내지 않고, 이름은 서버가 응답을 받은 뒤 맞춘다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.catalog import PERMISSIONS
from app.models import Department, Employee, Role
from app.sop.ai.guidelines import GuidelineRef, load_active_guidelines
from app.sop.ai.llm import AiStr, build_messages, call_llm, parse_reply

GRANT_AI_FEATURE = "grant_ai"  # 사용량 표의 기능 이름
GRANT_AI_GUIDELINE = "prompt.grant"
MAX_GRANT_AI_TEXT_CHARS = 4000  # 관리자가 한 번에 보내는 지시 — 한 화면 분량, 응답이 모델 출력 한도를 넘지 않게
MAX_GRANT_AI_LINES = 200  # 일괄 저장 상한(MAX_BATCH_GRANTS)과 같은 크기
MAX_GRANT_AI_ITEMS = 50  # 한 줄의 대상·역할·권한 각각

GrantAiText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_GRANT_AI_TEXT_CHARS)]


class GrantAiIn(BaseModel):
    text: GrantAiText


class _ReplyLine(BaseModel):
    line: int = Field(ge=1)
    action: Literal["add", "remove"]
    subjects: list[AiStr] = Field(default_factory=list, max_length=MAX_GRANT_AI_ITEMS)
    roles: list[AiStr] = Field(default_factory=list, max_length=MAX_GRANT_AI_ITEMS)
    permissions: list[AiStr] = Field(default_factory=list, max_length=MAX_GRANT_AI_ITEMS)


class GrantAiReply(BaseModel):
    """AI 응답 — 프롬프트 시드(seeds/prompt.grant.md)의 응답 예시와 같은 필드."""

    lines: list[_ReplyLine] = Field(max_length=MAX_GRANT_AI_LINES)


class SubjectMatchOut(BaseModel):
    subject_type: Literal["user", "dept"]
    subject_id: str


class SubjectReadOut(BaseModel):
    written: str
    # 0개 = 목록에 없음, 2개 이상 = 동명이인(관리자가 고른다)
    matches: list[SubjectMatchOut]


class RoleReadOut(BaseModel):
    written: str
    role_id: int | None  # None = 그런 역할이 없음


class PermissionReadOut(BaseModel):
    written: str
    permission: str | None  # None = 그런 권한이 없음


class GrantAiLineOut(BaseModel):
    line: int
    action: Literal["add", "remove"]
    subjects: list[SubjectReadOut]
    roles: list[RoleReadOut]
    permissions: list[PermissionReadOut]


class GrantAiOut(BaseModel):
    lines: list[GrantAiLineOut]
    model: str


async def load_grant_ai_context(session: AsyncSession) -> tuple[GuidelineRef, list[Role]]:
    """AI 호출 전에 읽을 것 — 활성 지침과 역할 목록(호출 동안 세션을 잡지 않으려고 먼저 읽는다)."""
    guidelines = await load_active_guidelines(session, [GRANT_AI_GUIDELINE])
    roles = list(await session.scalars(select(Role).order_by(Role.id)))
    return guidelines[GRANT_AI_GUIDELINE], roles


async def read_grant_text(
    *, login_id: str, text: str, guideline: GuidelineRef, role_names: list[str]
) -> tuple[GrantAiReply | None, str]:
    """지시를 AI에 한 번 보낸다(세션 없이). 응답을 읽지 못하면 (None, 모델) — 호출 실패는 AiCallFailed로 올라간다."""
    payload = {"task": "grant", "text": text, "roles": role_names, "permissions": list(PERMISSIONS)}
    reply = await call_llm(
        login_id=login_id, feature=GRANT_AI_FEATURE, messages=build_messages([guideline], payload), reasoning="low"
    )
    return parse_reply(reply.content, GrantAiReply), reply.model


async def resolve_grant_reply(session: AsyncSession, reply: GrantAiReply, roles: list[Role]) -> list[GrantAiLineOut]:
    """AI가 쓴 대상 글을 직원(로그인 ID·영문·한글 이름)·부서(코드·영문·한글 이름)에 맞추고, 역할 이름·권한 키를 확인한다.

    ID·코드는 대소문자를 가리지 않고, 이름은 글자 그대로 맞춘다. 같은 글에 여럿이 맞으면 모두 돌려줘 화면이 고르게 한다.
    """
    written = {subject for line in reply.lines for subject in line.subjects if subject}
    lowered = {value.lower() for value in written}
    users: dict[str, list[str]] = {}
    depts: dict[str, list[str]] = {}
    if written:
        employees = await session.execute(
            select(Employee.login_id, Employee.name, Employee.korean_name).where(
                or_(
                    func.lower(Employee.login_id).in_(lowered),
                    Employee.name.in_(written),
                    Employee.korean_name.in_(written),
                )
            )
        )
        for login_id, name, korean_name in employees:
            for key in {login_id.lower(), name, korean_name} - {""}:
                users.setdefault(key, []).append(login_id)
        departments = await session.execute(
            select(Department.dept_code, Department.name, Department.name_ko).where(
                or_(
                    func.lower(Department.dept_code).in_(lowered),
                    Department.name.in_(written),
                    Department.name_ko.in_(written),
                )
            )
        )
        for code, name, name_ko in departments:
            for key in {code.lower(), name, name_ko} - {""}:
                depts.setdefault(key, []).append(code)

    role_ids = {role.name.casefold(): role.id for role in roles}
    known_permissions = set(PERMISSIONS)

    def _match_subject(value: str) -> list[SubjectMatchOut]:
        # 로그인 ID·부서 코드가 맞으면 그것 하나 — 이름이 같은 다른 사람보다 ID가 분명하다
        exact_user = [login_id for login_id in users.get(value.lower(), []) if login_id.lower() == value.lower()]
        if exact_user:
            return [SubjectMatchOut(subject_type="user", subject_id=exact_user[0])]
        exact_dept = [code for code in depts.get(value.lower(), []) if code.lower() == value.lower()]
        if exact_dept:
            return [SubjectMatchOut(subject_type="dept", subject_id=exact_dept[0])]
        found = [SubjectMatchOut(subject_type="user", subject_id=login_id) for login_id in dict.fromkeys(users.get(value, []))]
        found += [SubjectMatchOut(subject_type="dept", subject_id=code) for code in dict.fromkeys(depts.get(value, []))]
        return found

    return [
        GrantAiLineOut(
            line=line.line,
            action=line.action,
            subjects=[SubjectReadOut(written=s, matches=_match_subject(s)) for s in dict.fromkeys(line.subjects) if s],
            roles=[RoleReadOut(written=r, role_id=role_ids.get(r.casefold())) for r in dict.fromkeys(line.roles) if r],
            permissions=[
                PermissionReadOut(written=p, permission=p if p in known_permissions else None)
                for p in dict.fromkeys(line.permissions)
                if p
            ],
        )
        for line in reply.lines
    ]
