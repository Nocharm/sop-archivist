// dept-tree 단위 테스트 - 공용 부서 7개의 중첩, 부모가 없는 부서의 루트 승격, 순환 끊기, 형제 정렬, 표시 이름 규칙.
import { describe, expect, it } from "vitest";

import type { Department } from "./api";
import { buildDeptTree, getDeptName, type DeptNode } from "./dept-tree";

const makeDept = (dept_code: string, parent_dept_code: string | null, name: string, name_ko: string, level: number): Department => ({
  dept_code,
  parent_dept_code,
  name,
  name_ko,
  level,
});

// 공용 데이터(global.md) - dev 디렉터리 부서 7개
const SEVEN: Department[] = [
  makeDept("CORP", null, "Example Pharma", "예시제약", 1),
  makeDept("DIV-QA", "CORP", "Quality Division", "품질본부", 2),
  makeDept("TEAM-QA1", "DIV-QA", "QA Team 1", "품질보증1팀", 3),
  makeDept("DIV-PROD", "CORP", "Production Division", "생산본부", 2),
  makeDept("TEAM-PROD1", "DIV-PROD", "Production Team 1", "생산1팀", 3),
  makeDept("DIV-IT", "CORP", "IT Division", "IT본부", 2),
  makeDept("TEAM-IT1", "DIV-IT", "IT Ops Team", "IT운영팀", 3),
];

// 트리를 평평하게 펴서 코드만 모은다
function collectCodes(nodes: DeptNode[]): string[] {
  return nodes.flatMap((node) => [node.code, ...collectCodes(node.children)]);
}

describe("buildDeptTree", () => {
  it("nests children under parents", () => {
    const tree = buildDeptTree(SEVEN);
    expect(tree).toHaveLength(1);
    expect(tree[0].code).toBe("CORP");
    expect(tree[0].children).toHaveLength(3);
    expect(tree[0].children.every((division) => division.children.length === 1)).toBe(true);
  });

  it("orders siblings by name", () => {
    const tree = buildDeptTree(SEVEN);
    expect(tree[0].children.map((node) => node.name)).toEqual(["IT Division", "Production Division", "Quality Division"]);
  });

  it("carries both names onto the node", () => {
    const [corp] = buildDeptTree(SEVEN);
    expect(corp).toMatchObject({ code: "CORP", name: "Example Pharma", nameKo: "예시제약" });
  });

  it("orphan becomes root", () => {
    const tree = buildDeptTree([...SEVEN, makeDept("LOST", "GONE", "Lost Team", "분실팀", 3)]);
    expect(tree.map((node) => node.code).sort()).toEqual(["CORP", "LOST"]);
  });

  it("cycle does not hang", () => {
    const tree = buildDeptTree([makeDept("A", "B", "Alpha", "알파", 1), makeDept("B", "A", "Beta", "베타", 1)]);
    expect(collectCodes(tree).sort()).toEqual(["A", "B"]);
    expect(tree.length).toBeGreaterThanOrEqual(1);
  });

  it("a branch hanging off a cycle stays attached after the cycle is cut", () => {
    const tree = buildDeptTree([
      makeDept("A", "B", "Alpha", "알파", 1),
      makeDept("B", "A", "Beta", "베타", 1),
      makeDept("C", "B", "Gamma", "감마", 2),
    ]);
    expect(collectCodes(tree).sort()).toEqual(["A", "B", "C"]);
  });

  it("a department that names itself as parent becomes a root", () => {
    const tree = buildDeptTree([makeDept("SELF", "SELF", "Self Team", "자기팀", 1)]);
    expect(tree.map((node) => node.code)).toEqual(["SELF"]);
  });

  it("returns an empty tree for no rows", () => {
    expect(buildDeptTree([])).toEqual([]);
  });
});

describe("getDeptName", () => {
  const node: DeptNode = { code: "DIV-QA", name: "Quality Division", nameKo: "품질본부", children: [] };

  it("uses the Korean name for ko when present", () => {
    expect(getDeptName(node, "ko")).toBe("품질본부");
  });

  it("uses the English name for en", () => {
    expect(getDeptName(node, "en")).toBe("Quality Division");
  });

  it("falls back to the other name, then the code, when one is empty", () => {
    expect(getDeptName({ ...node, nameKo: "" }, "ko")).toBe("Quality Division");
    expect(getDeptName({ ...node, name: "" }, "en")).toBe("품질본부");
    expect(getDeptName({ ...node, name: "", nameKo: "" }, "en")).toBe("DIV-QA");
  });
});
