// i18n 변수 치환 단위 테스트 - 변수 값의 $ 특수 패턴($&, $', $$)이 치환 문자열로 해석되지 않는지 확인한다.
import { describe, expect, it } from "vitest";

import { interpolateMessage } from "./i18n";

describe("interpolateMessage", () => {
  it("replaces every occurrence of a variable", () => {
    expect(interpolateMessage("{a} and {a}", { a: "x" })).toBe("x and x");
  });

  it("stringifies number values", () => {
    expect(interpolateMessage("{n} items", { n: 3 })).toBe("3 items");
  });

  it("leaves a template without vars untouched", () => {
    expect(interpolateMessage("via role {role}")).toBe("via role {role}");
  });

  it("keeps $-patterns in a value literally", () => {
    // String.replaceAll(문자열, 문자열)은 $&·$'·$$를 치환 패턴으로 읽어 역할 이름 `Ops$&QA`가 깨졌다
    expect(interpolateMessage("via role {name}", { name: "Ops$&QA" })).toBe("via role Ops$&QA");
    expect(interpolateMessage("via role {name}", { name: "A$'B" })).toBe("via role A$'B");
    expect(interpolateMessage("via role {name}", { name: "Cost$$" })).toBe("via role Cost$$");
  });
});
