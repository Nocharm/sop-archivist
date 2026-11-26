// 관리 > 권한 > 부여의 왼쪽 목록 - 부여가 있는 대상, 찾기에 걸린 부여 없는 대상, 직원 목록에 없는 로그인 ID를 한 줄씩 만든다. 순수 함수.
import type { Department, DirectoryUser, Grant, SubjectType } from "./api";
import { getDeptName } from "./dept-tree";
import type { Lang } from "./i18n-messages";
import { filterByQuery } from "./search";
import type { SubjectNames } from "./subject-label";

/** user·dept = 부여가 있는 사람·부서, none = 부여가 없는 대상(찾을 때만), raw = 직원 목록에 없는 로그인 ID */
export type SubjectGroup = "user" | "dept" | "none" | "raw";
export type SubjectFilter = "all" | SubjectType;

export interface GrantSubject {
  key: string;
  type: SubjectType;
  id: string;
  name: string;
  /** 사람의 부서 이름 - 부서 대상은 빈 글 */
  dept: string;
  isMissing: boolean;
  /** 받은 역할·권한 수 */
  count: number;
  group: SubjectGroup;
}

export interface SubjectQuery {
  text: string;
  filter: SubjectFilter;
  /** 이 역할을 받은 대상만 - 없으면 전부 */
  roleId: number | null;
}

export function getSubjectKey(type: SubjectType, id: string): string {
  return `${type}:${id}`;
}

export function splitSubjectKey(key: string): { type: SubjectType; id: string } {
  const at = key.indexOf(":");
  return { type: key.slice(0, at) === "dept" ? "dept" : "user", id: key.slice(at + 1) };
}

const GROUP_ORDER: Record<SubjectGroup, number> = { user: 0, dept: 1, none: 2, raw: 3 };
const NAME_COLLATOR = new Intl.Collator("ko");

interface SubjectSources {
  grants: readonly Grant[];
  people: readonly DirectoryUser[];
  departments: readonly Department[];
  names: SubjectNames;
  lang: Lang;
  /** 받은 역할·권한의 표시 이름 - 찾기에 쓴다 */
  getWhat: (grant: Grant) => string;
}

/** 거르기 전 전체 - 부여가 있는 대상 하나가 한 줄, 개수는 받은 역할·권한 수 */
export function listGrantedSubjects({ grants, names }: Pick<SubjectSources, "grants" | "names">): GrantSubject[] {
  const byKey = new Map<string, GrantSubject>();
  for (const grant of grants) {
    const key = getSubjectKey(grant.subject_type, grant.subject_id);
    const row = byKey.get(key);
    if (row) row.count += 1;
    else {
      byKey.set(key, {
        key,
        type: grant.subject_type,
        id: grant.subject_id,
        name: grant.subject_missing ? grant.subject_id : names.get(grant.subject_type, grant.subject_id, grant.subject_name),
        dept: names.getDept(grant.subject_type, grant.subject_id),
        isMissing: grant.subject_missing,
        count: 1,
        group: grant.subject_type,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || NAME_COLLATOR.compare(a.name, b.name) || NAME_COLLATOR.compare(a.id, b.id));
}

/** 찾기·거르기를 건 목록 - 찾는 말이 있으면 부여 없는 직원·부서와, 아무 데도 없는 로그인 ID도 나온다 */
export function listSubjects(sources: SubjectSources, query: SubjectQuery): GrantSubject[] {
  const { grants, people, departments, names, lang, getWhat } = sources;
  const text = query.text.trim();
  const all = listGrantedSubjects({ grants, names });
  const rows = all.filter((row) => {
    if (query.roleId !== null && !grants.some((grant) => grant.role_id === query.roleId && getSubjectKey(grant.subject_type, grant.subject_id) === row.key)) return false;
    return query.filter === "all" || row.type === query.filter;
  });
  if (text === "") return rows;

  const labels = new Map<string, string[]>();
  for (const grant of grants) {
    const key = getSubjectKey(grant.subject_type, grant.subject_id);
    labels.set(key, [...(labels.get(key) ?? []), getWhat(grant)]);
  }
  const toFields = (row: GrantSubject) => [
    { field: "name", text: row.name },
    { field: "id", text: row.id },
    ...(row.dept ? [{ field: "dept", text: row.dept }] : []),
    ...(labels.get(row.key) ?? []).map((label) => ({ field: "what", text: label })),
  ];
  const known = new Set(all.map((row) => row.key));
  const isOpen = query.roleId === null;
  const without: GrantSubject[] = [];
  if (isOpen && query.filter !== "dept") {
    for (const person of people) {
      const key = getSubjectKey("user", person.login_id);
      if (known.has(key)) continue;
      without.push({ key, type: "user", id: person.login_id, name: names.get("user", person.login_id, person.name), dept: names.getDept("user", person.login_id), isMissing: false, count: 0, group: "none" });
    }
  }
  if (isOpen && query.filter !== "user") {
    for (const dept of departments) {
      const key = getSubjectKey("dept", dept.dept_code);
      if (known.has(key)) continue;
      without.push({ key, type: "dept", id: dept.dept_code, name: getDeptName({ code: dept.dept_code, name: dept.name, nameKo: dept.name_ko, children: [] }, lang), dept: "", isMissing: false, count: 0, group: "none" });
    }
  }
  const granted = filterByQuery(rows, text, toFields).map((hit) => hit.item);
  const found = filterByQuery(without, text, toFields).map((hit) => hit.item);
  const result = [...granted].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
  result.push(...found);
  // 어디에도 없는 로그인 ID - 사람 이름이 아니라 정확한 ID로 조회한다(퇴직·동기화 전)
  if (isOpen && query.filter !== "dept" && !/\s/.test(text) && !known.has(getSubjectKey("user", text)) && !people.some((person) => person.login_id === text)) {
    result.push({ key: getSubjectKey("user", text), type: "user", id: text, name: text, dept: "", isMissing: false, count: 0, group: "raw" });
  }
  return result;
}
