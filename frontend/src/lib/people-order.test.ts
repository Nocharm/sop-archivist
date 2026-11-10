// 사람 고르기 순서 - 검색어가 있으면 이름·한글 이름·아이디만으로 순위를 매기고, 비었으면 내 부서 → 상위 부서 → 나머지.
import { describe, expect, it } from "vitest";

import type { DirectoryUser } from "./api";
import { orderBrowse, rankPeople } from "./people-order";

function person(login_id: string, name: string, dept_path = "Quality/QC", korean_name = ""): DirectoryUser {
  return { login_id, name, korean_name, department: dept_path.split("/").pop() ?? "", dept_code: null, dept_path };
}

describe("rankPeople", () => {
  it("puts exact, then prefix, then word-start matches first", () => {
    const people = [person("a.kim", "A Kim"), person("kimberly", "Kimberly Lee"), person("kim", "Kim")];

    expect(rankPeople(people, "kim").map((item) => item.login_id)).toEqual(["kim", "kimberly", "a.kim"]);
  });

  it("matches Korean initials", () => {
    const people = [person("user1", "User One", "Quality/QC", "김사용"), person("user2", "User Two", "Quality/QC", "박영희")];

    expect(rankPeople(people, "ㄱㅅㅇ").map((item) => item.login_id)).toEqual(["user1"]);
  });

  it("does not match people by department name", () => {
    const people = [person("lee", "Lee", "Quality/Microbiology Team")];

    expect(rankPeople(people, "Microbiology")).toEqual([]);
  });

  it("stays fast on a large directory", () => {
    const people = Array.from({ length: 5000 }, (_, index) => person(`user${index}`, `Person ${index}`, `Division ${index % 40}/Team ${index % 300}`, `사람${index}`));
    const started = performance.now();

    const result = rankPeople(people, "person 12");

    expect(result.length).toBeGreaterThan(0);
    // 느린 공용 CI 러너에서 300~460ms가 나왔다 - 제곱으로 무너지는 것만 잡게 넉넉히 둔다(로컬은 수십 ms)
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("orderBrowse", () => {
  const departments = [
    { dept_code: "CORP", parent_dept_code: null },
    { dept_code: "DIV-QA", parent_dept_code: "CORP" },
    { dept_code: "TEAM-QA1", parent_dept_code: "DIV-QA" },
    { dept_code: "DIV-PROD", parent_dept_code: "CORP" },
  ];

  it("lists my department, then parent departments nearest first, then the rest in order", () => {
    const people = [
      { ...person("other", "Other"), dept_code: "DIV-PROD" },
      { ...person("ceo", "Ceo"), dept_code: "CORP" },
      { ...person("me", "Me"), dept_code: "TEAM-QA1" },
      { ...person("nocode", "No Code"), dept_code: null },
      { ...person("teammate", "Teammate"), dept_code: "TEAM-QA1" },
      { ...person("lead", "Lead"), dept_code: "DIV-QA" },
    ];

    expect(orderBrowse(people, "me", departments).map((item) => item.login_id)).toEqual(["me", "teammate", "lead", "ceo", "other", "nocode"]);
  });

  it("keeps the original order when my department is unknown", () => {
    const people = [person("b", "B"), person("a", "A")];

    expect(orderBrowse(people, "nobody", departments).map((item) => item.login_id)).toEqual(["b", "a"]);
  });
});
