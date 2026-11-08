// 마크다운 뷰어 변환 - 문단·목록·표·코드와 원문 HTML이 실행되지 않는지
import { describe, expect, it } from "vitest";

import { convertMarkdownToHtml } from "./markdown-view";

describe("convertMarkdownToHtml", () => {
  it("keeps a single newline as a line break and splits paragraphs on a blank line", () => {
    expect(convertMarkdownToHtml("첫 줄\n둘째 줄")).toBe("<p>첫 줄<br>둘째 줄</p>");
    expect(convertMarkdownToHtml("문단 하나\n\n문단 둘")).toBe("<p>문단 하나</p><p>문단 둘</p>");
  });

  it("ends a paragraph at a list or heading and keeps list continuations", () => {
    expect(convertMarkdownToHtml("소개\n- 항목")).toBe("<p>소개</p><ul><li>항목</li></ul>");
    expect(convertMarkdownToHtml("소개\n## 제목")).toBe("<p>소개</p><h2>제목</h2>");
    expect(convertMarkdownToHtml("- 항목\n  이어지는 줄\n- 다음")).toBe("<ul><li>항목<br>이어지는 줄</li><li>다음</li></ul>");
    expect(convertMarkdownToHtml("- 상위\n  - 하위")).toBe('<ul><li>상위</li><li class="md-sub">하위</li></ul>');
  });

  it("renders a GFM table with inline code in cells", () => {
    expect(convertMarkdownToHtml("| ID | 칸 키 |\n|---|---|\n| S1 | `purpose` |")).toBe(
      '<div class="md-tablewrap"><table><thead><tr><th>ID</th><th>칸 키</th></tr></thead><tbody><tr><td>S1</td><td><code>purpose</code></td></tr></tbody></table></div>',
    );
  });

  it("escapes raw HTML and refuses script links", () => {
    expect(convertMarkdownToHtml("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    expect(convertMarkdownToHtml("[x](javascript:alert(1))")).toContain('href="#"');
  });

  it("keeps code block text as written", () => {
    expect(convertMarkdownToHtml("```\n<<<DATA {nonce}>>>\n```")).toContain("<pre><code>&lt;&lt;&lt;DATA {nonce}&gt;&gt;&gt;</code></pre>");
  });
});
