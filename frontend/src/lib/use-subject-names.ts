// 권한 부여 대상 이름 - 직원 디렉터리(세션당 한 번)와 부서 표를 받아 화면 언어의 이름을 만든다. 못 받으면 서버가 준 이름으로 보인다.
"use client";

import { useMemo } from "react";

import { listDepartments, type Department, type DirectoryUser } from "@/lib/api";
import { loadDirectoryOnce } from "@/lib/directory-cache";
import { useI18n } from "@/lib/i18n";
import { buildSubjectNames, type SubjectNames } from "@/lib/subject-label";
import { useLoaded } from "@/lib/use-loaded";

const NO_PEOPLE: DirectoryUser[] = [];
const NO_DEPARTMENTS: Department[] = [];

export interface SubjectDirectory {
  names: SubjectNames;
  people: readonly DirectoryUser[];
  departments: readonly Department[];
}

export function useSubjectDirectory(): SubjectDirectory {
  const { lang } = useI18n();
  const directory = useLoaded(loadDirectoryOnce, "directory");
  const departments = useLoaded(listDepartments, "departments");
  const people = directory.data ?? NO_PEOPLE;
  const depts = departments.data ?? NO_DEPARTMENTS;
  return useMemo(() => ({ names: buildSubjectNames(people, depts, lang), people, departments: depts }), [people, depts, lang]);
}
