import { describe, expect, it } from "vitest";

import type { Department, DirectoryUser } from "./api";
import { buildSubjectNames } from "./subject-label";

const PERSON: DirectoryUser = { login_id: "qa.lead", name: "QA Lead", korean_name: "품질리드", department: "Quality Division", dept_code: "DIV-QA", dept_path: "Example/Quality Division" };
const DEPT: Department = { dept_code: "DIV-QA", parent_dept_code: null, name: "Quality Division", name_ko: "품질본부", level: 2 };

describe("buildSubjectNames", () => {
  it("names people and departments in the screen language", () => {
    const ko = buildSubjectNames([PERSON], [DEPT], "ko");
    const en = buildSubjectNames([PERSON], [DEPT], "en");
    expect([ko.get("user", "qa.lead", "QA Lead"), ko.get("dept", "DIV-QA", "Quality Division")]).toEqual(["품질리드", "품질본부"]);
    expect([en.get("user", "qa.lead", ""), en.get("dept", "DIV-QA", "")]).toEqual(["QA Lead", "Quality Division"]);
    expect([ko.getDept("user", "qa.lead"), ko.getDept("dept", "DIV-QA")]).toEqual(["품질본부", ""]);
  });

  it("keeps the server name, then the ID, for a subject outside the directory", () => {
    const names = buildSubjectNames([], [], "ko");
    expect(names.get("user", "gone.person", "Gone Person")).toBe("Gone Person");
    expect(names.get("dept", "OLD-DEPT", "")).toBe("OLD-DEPT");
    expect(names.getDept("user", "gone.person")).toBe("");
  });
});
