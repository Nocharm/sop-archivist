// 문단 Excel 받기 창 - 처음 값(목차만 꺼짐)과 네 체크박스.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LangProvider } from "@/lib/i18n";

import { ParagraphDownloadDialog } from "./paragraph-download-dialog";

function html(): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(ParagraphDownloadDialog, { busy: false, onConfirm: noop, onClose: noop })));
}

function checked(markup: string): string[] {
  return Array.from(markup.matchAll(/<input\b[^>]*>/g))
    .map((match) => match[0])
    .filter((tag) => /\schecked(=|\s|>)/.test(tag))
    .map((tag) => /data-testid="space-download-(\w+)"/.exec(tag)?.[1] ?? "?");
}

describe("ParagraphDownloadDialog", () => {
  it("starts with the contents off and the rest on", () => {
    const h = html();
    expect(h).toContain('data-testid="space-download-dialog"');
    for (const key of ["tables", "deleted", "figures", "toc"]) expect(h).toContain(`data-testid="space-download-${key}"`);
    expect(checked(h)).toEqual(["tables", "deleted", "figures"]);
    expect(h).toContain('data-testid="space-download-confirm"');
  });
});
