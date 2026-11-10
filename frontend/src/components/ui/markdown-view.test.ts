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

  it("labels the copy button in the screen language", () => {
    expect(convertMarkdownToHtml("```\nx\n```")).toContain('aria-label="Copy"');
    expect(convertMarkdownToHtml("```\nx\n```", { copyLabel: '복사 "코드"' })).toContain('aria-label="복사 &quot;코드&quot;"');
  });

  it("opens in-app and same-page links in this tab and outside links in a new one", () => {
    expect(convertMarkdownToHtml("[Assign](#assign)")).toBe('<p><a href="#assign">Assign</a></p>');
    expect(convertMarkdownToHtml("[My account](/account)")).toBe('<p><a href="/account">My account</a></p>');
    expect(convertMarkdownToHtml("[site](https://example.com)")).toBe('<p><a href="https://example.com" target="_blank" rel="noreferrer">site</a></p>');
  });

  it("gives a heading the id written after it", () => {
    expect(convertMarkdownToHtml("### 단축키 {#assign-keys}")).toBe('<h3 id="assign-keys">단축키</h3>');
    expect(convertMarkdownToHtml("## 제목 {#Bad Id}")).toBe("<h2>제목 {#Bad Id}</h2>");
  });

  it("draws a same-site image line as a figure with its size and caption", () => {
    const html = convertMarkdownToHtml('소개\n![Split 화면](img/split.png "문단이 **Unit**이 된다")\n다음', {
      imageBase: "/manual/",
      imageSizes: { "img/split.png": { width: 1280, height: 800 } },
    });
    expect(html).toBe(
      '<p>소개</p><figure class="md-fig"><a href="/manual/img/split.png" target="_blank" rel="noreferrer">' +
        '<img src="/manual/img/split.png" alt="Split 화면" width="1280" height="800" loading="lazy"></a>' +
        "<figcaption>문단이 <strong>Unit</strong>이 된다</figcaption></figure><p>다음</p>",
    );
    expect(convertMarkdownToHtml("![a](/manual/img/a.png)")).toContain('<img src="/manual/img/a.png" alt="a" loading="lazy">');
  });

  it("does not draw images from outside, from parent folders or without a base", () => {
    for (const source of ["![x](https://example.com/x.png)", "![x](//example.com/x.png)", "![x](../secret.png)", "![x](data:image/png;base64,AAAA)", "![x](img/x.svg)"]) {
      expect(convertMarkdownToHtml(source, { imageBase: "/manual/" })).not.toContain("<img");
    }
    expect(convertMarkdownToHtml("![x](img/x.png)")).not.toContain("<img");
    expect(convertMarkdownToHtml('![x" onerror="alert(1)](img/x.png)', { imageBase: "/manual/" })).toContain('alt="x&quot; onerror=&quot;alert(1)"');
  });

  it("turns a marked quote into a callout with a fixed English label", () => {
    expect(convertMarkdownToHtml("> [!TIP]\n> 첫 줄\n> 둘째 줄")).toBe(
      '<blockquote class="md-callout" data-kind="tip"><span class="md-callout-label">TIP</span>첫 줄<br>둘째 줄</blockquote>',
    );
    expect(convertMarkdownToHtml("> [!DANGER]\n> 글")).toBe("<blockquote>[!DANGER]<br>글</blockquote>");
  });

  it("draws key caps and no other written tag", () => {
    expect(convertMarkdownToHtml("<kbd>Ctrl</kbd>+<kbd>↵</kbd>로 저장")).toBe("<p><kbd>Ctrl</kbd>+<kbd>↵</kbd>로 저장</p>");
    expect(convertMarkdownToHtml("<kbd><b>J</b></kbd> <kbd onclick=x>K</kbd>")).not.toContain("<kbd");
  });
});
