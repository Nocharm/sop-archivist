// 사람 고르기 순서(bpm 피커 규칙) - 검색어가 있으면 이름 > 한글 이름 > 아이디로 순위를 매기고(부서명으로는 찾지 않는다),
// 비었으면 내 부서 → 상위 부서(가까운 것부터) → 나머지 원래 순서. 이 앱 HR 데이터에는 부서장 정보가 없어 부서 코드 체인으로 대신한다.
import type { DirectoryUser } from "@/lib/api";
import { filterByQuery } from "@/lib/search";

export function rankPeople(people: DirectoryUser[], query: string): DirectoryUser[] {
  return filterByQuery(people, query, (person) => [
    { field: "name", text: person.name },
    ...(person.korean_name ? [{ field: "koreanName", text: person.korean_name }] : []),
    { field: "id", text: person.login_id },
  ]).map((hit) => hit.item);
}

interface DeptLink {
  dept_code: string;
  parent_dept_code: string | null;
}

/** 내 부서에서 위로 올라가는 부서 코드 체인 {코드: 몇 단계 위} - 같은 부서 0, 부모 1, … */
function buildChainDistances(myDeptCode: string | null, departments: readonly DeptLink[]): Map<string, number> {
  const parentOf = new Map(departments.map((dept) => [dept.dept_code, dept.parent_dept_code]));
  const distances = new Map<string, number>();
  let code = myDeptCode;
  // 순환 데이터에도 멈추게 이미 본 코드에서 끊는다
  while (code && !distances.has(code)) {
    distances.set(code, distances.size);
    code = parentOf.get(code) ?? null;
  }
  return distances;
}

/** 검색어가 없을 때 - 내 부서 → 상위 부서(가까운 것부터) → 나머지 원래 순서. 내 부서는 디렉터리의 내 행에서 읽는다 */
export function orderBrowse(people: DirectoryUser[], myLoginId: string, departments: readonly DeptLink[]): DirectoryUser[] {
  const myDeptCode = people.find((person) => person.login_id === myLoginId)?.dept_code ?? null;
  const distances = buildChainDistances(myDeptCode, departments);
  return people
    .map((person, index) => ({ person, index, distance: person.dept_code ? distances.get(person.dept_code) : undefined }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.index - b.index)
    .map((entry) => entry.person);
}
