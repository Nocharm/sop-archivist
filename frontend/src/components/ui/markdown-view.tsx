// 마크다운 뷰어 - AI 지침처럼 Markdown으로 쓴 글을 화면에서 읽기 좋게 그린다(편집은 원문 textarea 그대로).
// 의존성 없는 작은 파서(형제 프로젝트 bpm의 공지·매뉴얼 뷰어와 같은 방식): 제목·목록·표·코드 블록·인용·구분선·링크·굵게·기울임.
// 글자는 먼저 escape하고 서식만 태그로 바꾼 뒤 그려 원문의 HTML은 실행되지 않는다. 모양은 styles/markdown.css의 `.md`.
"use client";

import type { MouseEvent } from "react";

import { copyText } from "@/lib/clipboard";

const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

// 복사 완료 표시를 남겨 두는 시간(ms)
const COPIED_MS = 1200;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 따옴표를 엔티티로 - 속성값 탈출을 막는다(<>&는 escapeHtml이 이미 바꿨다)
function escapeAttr(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

// 링크는 http(s)·상대·앵커·mailto만 - javascript:·data:와 공백·따옴표가 든 주소는 막는다
function getSafeHref(url: string): string {
  const trimmed = url.trim();
  if (/[\s"'<>`]/.test(trimmed)) return "#";
  return /^(https?:\/\/|\/|#|mailto:)/i.test(trimmed) ? trimmed : "#";
}

// 줄 안 서식 - escape한 뒤에 바꾸므로 원문의 태그가 살아나지 않는다
function formatInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label: string, url: string) => `<a href="${escapeAttr(getSafeHref(url))}" target="_blank" rel="noreferrer">${label}</a>`,
    );
}

function splitCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const LIST_LINE = /^\s*([-*]|\d+\.)\s/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const PARAGRAPH_STOP = /^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|```|-{3,}\s*$)/;

/** 마크다운 → HTML(escape 뒤 서식). 단위 테스트가 직접 본다 */
export function convertMarkdownToHtml(source: string): string {
  const lines = source.replace(/\r/g, "").split("\n");
  let html = "";
  let i = 0;

  // 목록 항목 - 바로 아래 들여쓴 이어지는 줄(목록 기호가 아닌 줄)은 같은 항목 안의 줄바꿈으로 붙인다
  const readListItem = (first: string): string => {
    const parts = [formatInline(first)];
    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_LINE.test(lines[i])) {
      parts.push(formatInline(lines[i].trim()));
      i++;
    }
    return parts.join("<br>");
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++;
      html += `<div class="md-codewrap"><pre><code>${codeLines.join("\n")}</code></pre><button class="md-copy" type="button" aria-label="Copy">${COPY_ICON}</button></div>`;
      continue;
    }

    // GFM 표 - 머리 행 + 구분 행(---) + 본문 행. 구분 행에 파이프가 있어야 구분선(hr)과 갈린다
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && next.includes("|") && TABLE_DIVIDER.test(next)) {
      const head = splitCells(line)
        .map((cell) => `<th>${formatInline(cell)}</th>`)
        .join("");
      i += 2;
      let body = "";
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        body += `<tr>${splitCells(lines[i])
          .map((cell) => `<td>${formatInline(cell)}</td>`)
          .join("")}</tr>`;
        i++;
      }
      html += `<div class="md-tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      html += "<hr>";
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level}>${formatInline(line.replace(/^#+\s/, ""))}</h${level}>`;
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html += `<blockquote>${quoted.map(formatInline).join("<br>")}</blockquote>`;
      continue;
    }

    if (/^\s*[-*]\s/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        // 두 칸 이상 들여쓴 항목은 하위 항목 - 한 단 더 들여 그린다(중첩 목록 대신 표시만)
        const isSub = /^\s{2,}[-*]\s/.test(lines[i]);
        const first = lines[i].replace(/^\s*[-*]\s/, "");
        i++;
        items += `<li${isSub ? ' class="md-sub"' : ""}>${readListItem(first)}</li>`;
      }
      html += `<ul>${items}</ul>`;
      continue;
    }

    if (/^\s*\d+\.\s/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const first = lines[i].replace(/^\s*\d+\.\s/, "");
        i++;
        items += `<li>${readListItem(first)}</li>`;
      }
      html += `<ol>${items}</ol>`;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // 문단 안의 한 줄 바꿈은 그대로 줄바꿈 - 빈 줄로 나뉜 문단은 CSS 여백이 더 넓게 띄운다
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !PARAGRAPH_STOP.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    html += `<p>${paragraph.map((item) => formatInline(item.trim())).join("<br>")}</p>`;
  }
  return html;
}

interface MarkdownViewProps {
  source: string;
  className?: string;
  testId?: string;
}

/** 마크다운 읽기 보기 - 코드 블록은 호버한 복사 단추로, 줄 안 코드는 눌러서 복사한다 */
export function MarkdownView({ source, className = "", testId }: MarkdownViewProps) {
  // 그린 HTML 안의 단추라 클릭을 위임받는다. 복사가 실패하면(평문 HTTP의 폴백 실패) 완료 표시를 내지 않는다
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(".md-copy");
    const inlineCode = button ? null : event.target.closest("code");
    const marked = button ?? (inlineCode && !inlineCode.closest("pre") ? inlineCode : null);
    if (!marked) return;
    const text = button ? (button.parentElement?.querySelector("code")?.textContent ?? "") : (marked.textContent ?? "");
    void copyText(text).then((isCopied) => {
      if (!isCopied) return;
      marked.classList.add("md-copied");
      window.setTimeout(() => marked.classList.remove("md-copied"), COPIED_MS);
    });
  }

  return <div className={`md ${className}`} data-testid={testId} onClick={handleClick} dangerouslySetInnerHTML={{ __html: convertMarkdownToHtml(source) }} />;
}
