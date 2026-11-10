import { describe, expect, it } from "vitest";

import { findSections, getManualHref, getReadState, getSectionStage, listImageRefs, parseManual } from "./manual";

const SOURCE = [
  "---",
  "title: 사용 설명서",
  "version: 0.10",
  "updated: 2026-11-10",
  "---",
  "# SOP Archivist 사용 설명서",
  "",
  "머리말 한 줄.",
  "",
  "## 한눈에 보기 {#at-a-glance}",
  "",
  "제안은 연필로, 확정은 잉크로.",
  "",
  '![단계 레일](img/rail.png "레일")',
  "",
  "### 역할 {#roles}",
  "",
  "Author와 Reviewer.",
  "",
  "```",
  "## 코드 안의 제목은 조각이 아니다",
  "### 코드 안 {#not-a-heading}",
  "```",
  "",
  "## 3단계 Assign {#assign}",
  "",
  "Old Unit을 보낼 곳을 고른다. [To-Be](#tobe)를 먼저 채운다.",
  "",
  "### 이름 없는 작은 제목",
  "",
  "## 자리 이름 없는 조각",
  "",
  "끝.",
].join("\n");

describe("parseManual", () => {
  it("reads the front matter, the title and the lead before the first section", () => {
    const doc = parseManual(SOURCE);

    expect(doc.title).toBe("SOP Archivist 사용 설명서");
    expect(doc.version).toBe("0.10");
    expect(doc.updated).toBe("2026-11-10");
    expect(doc.lead).toBe("머리말 한 줄.");
  });

  it("cuts one section per ## heading and numbers them in order", () => {
    const doc = parseManual(SOURCE);

    expect(doc.sections.map((section) => [section.tag, section.id, section.title])).toEqual([
      ["M-01", "at-a-glance", "한눈에 보기"],
      ["M-02", "assign", "3단계 Assign"],
      ["M-03", "section-3", "자리 이름 없는 조각"],
    ]);
  });

  it("keeps ## lines inside a code block in the section body", () => {
    const [first] = parseManual(SOURCE).sections;

    expect(first.body).toContain("## 코드 안의 제목은 조각이 아니다");
    expect(first.body.startsWith("제안은 연필로")).toBe(true);
  });

  it("lists only the named sub headings outside code blocks", () => {
    const doc = parseManual(SOURCE);

    expect(doc.sections[0].headings).toEqual([{ id: "roles", title: "역할" }]);
    expect(doc.sections[1].headings).toEqual([]);
  });

  it("falls back to the front matter title and reads CRLF text", () => {
    const doc = parseManual("---\r\ntitle: 제목\r\n---\r\n## 조각 {#a}\r\n본문");

    expect(doc.title).toBe("제목");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].body).toBe("본문");
  });

  it("returns no sections for text without ## headings", () => {
    expect(parseManual("그냥 글").sections).toEqual([]);
    expect(parseManual("그냥 글").lead).toBe("그냥 글");
  });
});

describe("getReadState", () => {
  it("is unread without a mark, read with the same hash and updated after the text changed", () => {
    const [section] = parseManual(SOURCE).sections;
    const [edited] = parseManual(SOURCE.replace("확정은 잉크로", "확정은 잉크로만")).sections;

    expect(getReadState(section, {})).toBe("unread");
    expect(getReadState(section, { [section.id]: section.hash })).toBe("read");
    expect(getReadState(edited, { [section.id]: section.hash })).toBe("updated");
  });

  it("keeps the hash when only another section changed", () => {
    const before = parseManual(SOURCE).sections;
    const after = parseManual(SOURCE.replace("끝.", "끝이 바뀌었다.")).sections;

    expect(after[0].hash).toBe(before[0].hash);
    expect(after[2].hash).not.toBe(before[2].hash);
  });
});

describe("findSections", () => {
  const { sections } = parseManual(SOURCE);

  it("keeps the sections that hold every word, ignoring case", () => {
    expect(findSections(sections, "old UNIT").map((section) => section.id)).toEqual(["assign"]);
    expect(findSections(sections, "연필 reviewer").map((section) => section.id)).toEqual(["at-a-glance"]);
    expect(findSections(sections, "없는 낱말")).toEqual([]);
  });

  it("returns everything for a blank query", () => {
    expect(findSections(sections, "   ")).toHaveLength(3);
  });

  it("does not match link targets, image paths or anchor names", () => {
    expect(findSections(sections, "png")).toEqual([]);
    expect(findSections(sections, "#tobe")).toEqual([]);
    expect(findSections(sections, "at-a-glance")).toEqual([]);
  });
});

describe("listImageRefs", () => {
  it("lists each block image once", () => {
    expect(listImageRefs(`${SOURCE}\n\n![다시](img/rail.png)\n![새 그림](img/new.png "설명")`)).toEqual(["img/rail.png", "img/new.png"]);
  });
});

describe("getManualHref", () => {
  it("opens the section that explains the current screen", () => {
    expect(getManualHref("/bundles/12/assign")).toBe("/manual#assign");
    expect(getManualHref("/bundles/12")).toBe("/manual#bundle");
    expect(getManualHref("/bundles/12/history")).toBe("/manual#history");
    expect(getManualHref("/")).toBe("/manual#start");
    expect(getManualHref("/admin")).toBe("/manual#account");
    expect(getManualHref("/account")).toBe("/manual#account");
  });

  it("opens the top of the manual from anywhere else", () => {
    expect(getManualHref("/manual")).toBe("/manual");
    expect(getManualHref("/bundles/12/unknown")).toBe("/manual");
  });
});

describe("getSectionStage", () => {
  it("maps a stage section back to its stage", () => {
    expect(getSectionStage("tobe")).toBe("tobe");
    expect(getSectionStage("bundle")).toBe("overview");
    expect(getSectionStage("faq")).toBeNull();
  });
});
