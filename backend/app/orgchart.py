"""직원 → 조직 경로·부서 체인 해석 — departments 부모 체인 1순위, org_l1~l5 폴백.

departments가 빈 환경(로컬 sqlite·테스트)은 전원 폴백이다. 체인 코드(`get_dept_chain_codes`)는 부서 부여의
하위 상속 판정이 쓴다.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Department, Employee
from app.settings import settings

# 체인 상향 최대 깊이 — HR 계약상 6레벨, 여유분 포함. 초과는 사이클 취급.
_MAX_DEPTH = 15

# 부서명 내 "/" 치환 문자 — 경로 구분자와 충돌 방지(U+FF0F 전각 슬래시). AX/PI Department 등 실부서명 존재.
SEGMENT_SLASH = "／"


def sanitize_org_segment(name: str) -> str:
    """경로 세그먼트용 부서명 — 이름 속 "/"를 전각 슬래시로 치환해 split/프리픽스 파손 방지."""
    return name.replace("/", SEGMENT_SLASH)


# by_code 값: (name, parent_dept_code)
DeptEntry = tuple[str, str | None]


@dataclass(frozen=True)
class DeptIndex:
    by_code: dict[str, DeptEntry] = field(default_factory=dict)


async def load_dept_index(session: AsyncSession) -> DeptIndex:
    """departments 전체 1회 로드 — 요청당 한 번 부르고 재사용한다."""
    rows = (await session.scalars(select(Department).order_by(Department.dept_code))).all()
    return DeptIndex(by_code={d.dept_code: (d.name or "", d.parent_dept_code) for d in rows})


def get_dept_chain_codes(index: DeptIndex, dept_code: str | None) -> list[str]:
    """dept_code → 리프→루트 부서 코드 체인. 부서 부여가 하위 부서로 내려가는 판정의 입력.

    예외 없이 닿은 데까지만 돌려준다: 모르는 코드는 [], 부모 단절은 거기까지, 순환은 반복 직전까지,
    최대 _MAX_DEPTH개. 경로 표시용 해석(_resolve_chain_names)과 달리 불완전한 체인도 버리지 않는다 —
    개인 부여는 그대로 두고 닿는 조상 부서의 부여만 적용하기 위해서다.
    """
    chain: list[str] = []
    seen: set[str] = set()
    current = dept_code
    while current and current in index.by_code and current not in seen and len(chain) < _MAX_DEPTH:
        seen.add(current)
        chain.append(current)
        current = index.by_code[current][1]
    return chain


def _resolve_chain_names(emp: Employee, index: DeptIndex) -> list[str] | None:
    """dept_code → 루트까지 닿은 체인의 트림된 이름 목록(루트→리프). 해석 불가면 None.

    None 조건: 코드 부재·스테일·사이클·전체 빈 이름·부모 단절(미러 불완전 — 부분 경로는
    트림 후 루트로 떠서 인원 있는 고아 노드가 되므로 사용 금지).
    """
    code = emp.dept_code
    if not code or code not in index.by_code:
        return None
    names_leaf_to_root: list[str] = []
    visited: set[str] = set()
    cur: str | None = code
    while cur is not None and cur in index.by_code:
        if cur in visited or len(visited) >= _MAX_DEPTH:
            return None  # 사이클/과깊이
        visited.add(cur)
        name, parent = index.by_code[cur]
        if name:
            names_leaf_to_root.append(sanitize_org_segment(name))
        cur = parent
    if not names_leaf_to_root or cur is not None:
        return None  # 전체 빈 이름 또는 부모 단절
    names = list(reversed(names_leaf_to_root))
    # 최상위 N레벨 제외 — 법인·사업부급 범용 레벨은 분류에서 뺀다. 체인이 그보다 짧으면 리프만.
    trim = settings.org_trim_levels
    if trim > 0:
        names = names[trim:] if len(names) > trim else names[-1:]
    return names


def resolve_org_path(emp: Employee, index: DeptIndex) -> str:
    """dept_code → 부모 체인 경로(루트→리프). 해석 불가면 org 컬럼 폴백, 그것도 없으면 department."""
    names = _resolve_chain_names(emp, index)
    if names:
        return "/".join(names)

    # 폴백도 세그먼트 새니타이즈 — org 컬럼 원본에 "/"가 있으면 동일하게 파손되므로
    levels = [emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5]
    segments = [sanitize_org_segment(lv) if lv else lv for lv in levels if lv is not None]
    return "/".join(segments) if segments else sanitize_org_segment(emp.department or "")
