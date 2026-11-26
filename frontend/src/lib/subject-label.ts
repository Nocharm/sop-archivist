// 권한 부여 대상(사람·부서)을 화면 언어의 이름으로 - 관리 > 권한의 목록들이 쓴다. 디렉터리에 없으면(퇴직·동기화 전) 서버가 준 이름, 그것도 없으면 ID.
import type { Department, DirectoryUser, SubjectType } from "./api";
import { getDeptName } from "./dept-tree";
import { getDisplayName } from "./display-name";
import type { Lang } from "./i18n-messages";

export interface SubjectNames {
  get: (type: SubjectType, id: string, fallback: string) => string;
  /** 사람의 부서 이름(한 줄 흐린 글) - 부서 대상·모르는 사람은 빈 글 */
  getDept: (type: SubjectType, id: string) => string;
}

export function buildSubjectNames(people: readonly DirectoryUser[], departments: readonly Department[], lang: Lang): SubjectNames {
  const byLogin = new Map(people.map((person) => [person.login_id, person]));
  const byCode = new Map(departments.map((dept) => [dept.dept_code, dept]));
  const getDeptLabel = (code: string): string => {
    const dept = byCode.get(code);
    return dept ? getDeptName({ code, name: dept.name, nameKo: dept.name_ko, children: [] }, lang) : "";
  };
  return {
    get: (type, id, fallback) => {
      if (type === "dept") return getDeptLabel(id) || fallback || id;
      const person = byLogin.get(id);
      return (person ? getDisplayName(person, lang) : fallback) || id;
    },
    getDept: (type, id) => {
      if (type === "dept") return "";
      const person = byLogin.get(id);
      return (person?.dept_code ? getDeptLabel(person.dept_code) : "") || (person?.department ?? "");
    },
  };
}
