import { describe, expect, it } from "vitest";

import { filterByQuery, matchTerm } from "@/lib/search";

describe("matchTerm", () => {
  it("substring (case-insensitive) returns char ranges", () => {
    expect(matchTerm("Kim Daeri", "kim")).toEqual([{ start: 0, end: 3 }]);
  });
  it("hangul chosung matches (index-aligned)", () => {
    // 결재 → ㄱㅈ
    expect(matchTerm("결재", "ㄱㅈ")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials of a Korean name", () => {
    // 결재 → g(ㄱ) j(ㅈ) → "gj"
    expect(matchTerm("결재", "gj")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials skip silent ㅇ", () => {
    // 이재 → ㅇ(skip) j(ㅈ) → roman "j"; match "j" covers the 재 syllable
    expect(matchTerm("이재", "j")).toEqual([{ start: 1, end: 2 }]);
  });
  it("returns null when nothing matches", () => {
    expect(matchTerm("Kim", "zzz")).toBeNull();
  });
  it("subsequence (order-only) matches as last resort", () => {
    // p·f·x가 순서대로 등장 (연속 아님) → subsequence 매치
    expect(matchTerm("prefix", "pfx")).not.toBeNull();
  });
  it("subsequence respects order", () => {
    // c가 a보다 뒤 → 순서 불일치 → null
    expect(matchTerm("abc", "ca")).toBeNull();
  });
  it("subsequence accepts chosung per char and skips spaces (업무 체계 탐색 검색)", () => {
    // 초성 부분일치는 공백 때문에 깨지지만("ㅂㅈ ㅈㅈ" ≠ "ㅂㅈㅈㅈ") 시퀀스는 글자별 초성으로 통과
    expect(matchTerm("배지 조제", "ㅂㅈㅈㅈ")).toEqual([
      { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4, end: 5 },
    ]);
    // 연속 안 되는 글자 + 초성 섞임
    expect(matchTerm("배지 조제 계획", "배조ㄱ")).toEqual([
      { start: 0, end: 1 }, { start: 3, end: 4 }, { start: 6, end: 7 },
    ]);
    expect(matchTerm("배지 조제", "ㅈㅂ")).toBeNull();
  });
});

describe("filterByQuery ordering (정확 > 접두 > 부분 > subsequence)", () => {
  const items = [
    { name: "axbxc" }, // subsequence
    { name: "xabc" }, // 부분
    { name: "abc" }, // 정확
    { name: "abcd" }, // 접두
  ];
  it("sorts hits by match quality", () => {
    const hits = filterByQuery(items, "abc", (i) => [{ field: "name", text: i.name }]);
    expect(hits.map((h) => h.item.name)).toEqual(["abc", "abcd", "xabc", "axbxc"]);
  });
});

describe("filterByQuery ranking v2 (단어시작 · 타이브레이크 · 공백 AND)", () => {
  const nameField = (i: { name: string }) => [{ field: "name", text: i.name }];

  it("word-start beats mid-substring, prefix beats both", () => {
    const items = [{ name: "Akimoto Ken" }, { name: "Junho Kim" }, { name: "Kim Minsu" }];
    const hits = filterByQuery(items, "kim", nameField);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Minsu", "Junho Kim", "Akimoto Ken"]);
  });

  it("whitespace acts as AND - surname-last name still matches per word", () => {
    const items = [{ name: "Kimberly June" }, { name: "Junho Kim" }];
    const hits = filterByQuery(items, "kim jun", nameField);
    // Junho Kim: 두 term 모두 접두/단어시작 — 통짜 부분일치가 아니어도 상위
    expect(hits.map((h) => h.item.name)).toEqual(["Junho Kim", "Kimberly June"]);
  });

  it("earlier field in getFields wins ties (name field over id field)", () => {
    const items = [
      { name: "Park Jimin", id: "kim.aaa" }, // id 접두 매치
      { name: "Kim Jimin", id: "user.bbb" }, // 이름 접두 매치
    ];
    const hits = filterByQuery(items, "kim", (i) => [
      { field: "name", text: i.name },
      { field: "id", text: i.id },
    ]);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Jimin", "Park Jimin"]);
  });

  it("shorter field text wins at equal rank and position", () => {
    const items = [{ name: "Kim Junhyeokjin" }, { name: "Kim Jun" }];
    const hits = filterByQuery(items, "kim", nameField);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Jun", "Kim Junhyeokjin"]);
  });

  it("chosung word-start beats chosung mid-match", () => {
    const items = [{ name: "이규진" }, { name: "규진호" }];
    const hits = filterByQuery(items, "ㄱㅈ", nameField);
    expect(hits.map((h) => h.item.name)).toEqual(["규진호", "이규진"]);
  });
});

describe("filterByQuery", () => {
  const users = [
    { name: "Kim Daeri", dept: "Procurement" },
    { name: "Lee Minjae", dept: "Sales" },
    { name: "결재팀장", dept: "Procurement" },
  ];
  const fields = (u: { name: string; dept: string }) => [
    { field: "name", text: u.name },
    { field: "dept", text: u.dept },
  ];

  it("empty query returns all with no matches", () => {
    const hits = filterByQuery(users, "", fields);
    expect(hits).toHaveLength(3);
    expect(hits[0].matches).toEqual([]);
  });
  it("comma = AND across terms (each term in any field)", () => {
    // "kim, procurement" → name matches kim AND dept matches procurement
    const hits = filterByQuery(users, "kim, procurement", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Daeri"]);
  });
  it("department field search", () => {
    const hits = filterByQuery(users, "sales", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Lee Minjae"]);
  });
  it("collects highlight ranges per field", () => {
    const hits = filterByQuery(users, "kim", fields);
    const nameMatch = hits[0].matches.find((m) => m.field === "name");
    expect(nameMatch?.ranges).toEqual([{ start: 0, end: 3 }]);
  });
});
