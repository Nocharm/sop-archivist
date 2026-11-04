// 부서 목록(GET /api/departments) -> 트리. 부여 대상 선택기(subject-picker)가 부서를 계층으로 보여 줄 때 쓴다.
import type { Department } from "./api";
import type { Lang } from "./i18n-messages";

export interface DeptNode {
  code: string;
  name: string;
  nameKo: string;
  children: DeptNode[];
}

// 형제 정렬 기준 이름 - 로케일 고정이라 브라우저 설정과 무관하게 같은 순서가 나온다
const NAME_COLLATOR = new Intl.Collator("en");

function compareDepts(a: Department, b: Department): number {
  return NAME_COLLATOR.compare(a.name, b.name) || NAME_COLLATOR.compare(a.dept_code, b.dept_code);
}

/**
 * 부모가 목록에 없거나 자기 자신이면 루트, 순환은 처음 되돌아온 부서의 부모 연결을 끊어 그 부서를 루트로 둔다.
 * HR 미러는 개편 도중 끊긴 체인이 올 수 있어 예외 없이 모든 부서를 트리에 담는 것이 계약이다.
 */
export function buildDeptTree(rows: Department[]): DeptNode[] {
  const sorted = [...rows].sort(compareDepts);
  const byCode = new Map<string, Department>();
  for (const row of sorted) {
    if (!byCode.has(row.dept_code)) byCode.set(row.dept_code, row);
  }

  const parentOf = new Map<string, string | null>();
  for (const [code, row] of byCode) {
    const parent = row.parent_dept_code;
    parentOf.set(code, parent !== null && parent !== code && byCode.has(parent) ? parent : null);
  }

  // 위로 거슬러 오르다 이번 경로에서 이미 지난 부서를 다시 만나면 순환 - 그 부서의 부모 연결을 끊는다
  const settled = new Set<string>();
  for (const start of byCode.keys()) {
    const path = new Set<string>();
    let cursor: string | null = start;
    while (cursor !== null && !settled.has(cursor)) {
      if (path.has(cursor)) {
        parentOf.set(cursor, null);
        break;
      }
      path.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    for (const code of path) settled.add(code);
  }

  const nodes = new Map<string, DeptNode>();
  for (const [code, row] of byCode) {
    nodes.set(code, { code, name: row.name, nameKo: row.name_ko, children: [] });
  }
  const roots: DeptNode[] = [];
  // byCode는 이름순으로 채워졌으므로 형제도 이름순으로 쌓인다
  for (const [code, node] of nodes) {
    const parent = parentOf.get(code) ?? null;
    if (parent === null) roots.push(node);
    else nodes.get(parent)?.children.push(node);
  }
  return roots;
}

/** 현재 언어의 부서 이름 - 한국어 UI는 name_ko 우선, 비면 다른 쪽 이름, 둘 다 비면 부서 코드. */
export function getDeptName(node: DeptNode, lang: Lang): string {
  const [primary, secondary] = lang === "ko" ? [node.nameKo, node.name] : [node.name, node.nameKo];
  return primary || secondary || node.code;
}
