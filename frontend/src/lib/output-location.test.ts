// 결과물 A 옛 위치 표기 - Excel Location 칸(backend sheet_model._format_location)과 같은 글이다.
import { describe, expect, it } from "vitest";

import { formatOutputLocation } from "./output-location";

describe("formatOutputLocation", () => {
  it("writes section, place and page like the Excel Location cell", () => {
    expect(formatOutputLocation({ section: "5", place: "Paragraph", page: 3, page_basis: "rendered" })).toBe("§5 · Paragraph · p. 3");
  });

  it("marks an estimated page", () => {
    expect(formatOutputLocation({ section: "5.1", place: "Table 2 · r1c2", page: 12, page_basis: "estimated" })).toBe("§5.1 · Table 2 · r1c2 · ~p. 12");
  });

  it("leaves out the pieces that are missing", () => {
    expect(formatOutputLocation({ section: "", place: "Header", page: null, page_basis: "" })).toBe("Header");
    expect(formatOutputLocation({ section: "2", place: "", page: null, page_basis: "" })).toBe("§2");
    expect(formatOutputLocation({ section: "", place: "", page: null, page_basis: "" })).toBe("");
  });
});
