// 권한 부여 대상 이름 - 직원 디렉터리(세션당 한 번)와 부서 표를 받아 화면 언어의 이름을 만든다. 못 받으면 서버가 준 이름으로 보인다.
"use client";

import { listDepartments } from "@/lib/api";
import { loadDirectoryOnce } from "@/lib/directory-cache";
import { useI18n } from "@/lib/i18n";
import { buildSubjectNames, type SubjectNames } from "@/lib/subject-label";
import { useLoaded } from "@/lib/use-loaded";

export function useSubjectNames(): SubjectNames {
  const { lang } = useI18n();
  const directory = useLoaded(loadDirectoryOnce, "directory");
  const departments = useLoaded(listDepartments, "departments");
  return buildSubjectNames(directory.data ?? [], departments.data ?? [], lang);
}
