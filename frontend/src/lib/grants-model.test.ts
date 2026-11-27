// 부여 화면 왼쪽 목록 - 대상별 묶기, 역할·종류 거르기, 부여 없는 직원 찾기, 직원 목록에 없는 로그인 ID.
import { describe, expect, it } from "vitest";

import type { Department, DirectoryUser, Grant } from "./api";
import { getSubjectKey, listSubjects, splitSubjectKey } from "./grants-model";
import { buildSubjectNames } from "./subject-label";

const PEOPLE: DirectoryUser[] = [
  { login_id: "qa.lead", name: "QA Lead", korean_name: "품질리드", department: "Quality Division", dept_code: "DIV-QA", dept_path: "" },
  { login_id: "ops.member", name: "Ops Member", korean_name: "운영담당", department: "IT", dept_code: "TEAM-IT1", dept_path: "" },
  { login_id: "new.person", name: "New Person", korean_name: "신규", department: "IT", dept_code: "TEAM-IT1", dept_path: "" },
];
const DEPTS: Department[] = [
  { dept_code: "DIV-QA", parent_dept_code: null, name: "Quality Division", name_ko: "품질본부", level: 2 },
  { dept_code: "TEAM-IT1", parent_dept_code: null, name: "IT Ops Team", name_ko: "IT운영팀", level: 3 },
];
const grant = (id: number, subject_type: "user" | "dept", subject_id: string, extra: Partial<Grant>): Grant => ({
  id, subject_type, subject_id, subject_name: subject_id, subject_missing: false, role_id: null, role_name: null, permission: null, created_by: "x", created_at: "", ...extra,
});
const GRANTS = [
  grant(1, "user", "ops.member", { role_id: 1, role_name: "Operations" }),
  grant(2, "user", "ops.member", { role_id: 2, role_name: "Reviewer" }),
  grant(3, "dept", "DIV-QA", { role_id: 2, role_name: "Reviewer" }),
  grant(4, "user", "gone.person", { permission: "system.view", subject_missing: true, subject_name: "" }),
];
const sources = {
  grants: GRANTS, people: PEOPLE, departments: DEPTS, names: buildSubjectNames(PEOPLE, DEPTS, "en"), lang: "en" as const,
  getWhat: (g: Grant) => g.role_name ?? g.permission ?? "",
};

describe("listSubjects", () => {
  it("makes one row per subject, people before departments, with the number of grants", () => {
    const rows = listSubjects(sources, { text: "", filter: "all", roleId: null });
    expect(rows.map((row) => [row.key, row.count, row.group])).toEqual([
      ["user:gone.person", 1, "user"],
      ["user:ops.member", 2, "user"],
      ["dept:DIV-QA", 1, "dept"],
    ]);
    expect(rows.find((row) => row.id === "gone.person")).toMatchObject({ isMissing: true, name: "gone.person" });
  });

  it("filters by role and by kind", () => {
    expect(listSubjects(sources, { text: "", filter: "all", roleId: 2 }).map((row) => row.key)).toEqual(["user:ops.member", "dept:DIV-QA"]);
    expect(listSubjects(sources, { text: "", filter: "dept", roleId: null }).map((row) => row.key)).toEqual(["dept:DIV-QA"]);
  });

  it("finds people without grants and an exact login ID nobody has", () => {
    const found = listSubjects(sources, { text: "new person", filter: "all", roleId: null });
    expect(found.map((row) => [row.key, row.count, row.group])).toEqual([["user:new.person", 0, "none"]]);
    const raw = listSubjects(sources, { text: "ghost.user", filter: "all", roleId: null });
    expect(raw.map((row) => [row.key, row.group])).toEqual([["user:ghost.user", "raw"]]);
    expect(listSubjects(sources, { text: "ops.member", filter: "all", roleId: null }).some((row) => row.group === "raw")).toBe(false);
  });

  it("finds a subject by what it holds", () => {
    expect(listSubjects(sources, { text: "Reviewer", filter: "all", roleId: null }).map((row) => row.key)).toEqual(expect.arrayContaining(["user:ops.member", "dept:DIV-QA"]));
  });
});

describe("subject keys", () => {
  it("round-trips an id that contains a colon", () => {
    expect(splitSubjectKey(getSubjectKey("user", "a:b"))).toEqual({ type: "user", id: "a:b" });
  });
});
