// 설명서 원문(public/manual/user-manual.md)이 화면·코드와 어긋나지 않는지 본다 - 자리 이름·그림·권한 키·버전·화면 라벨.
// 화면 라벨이나 권한을 바꾸고 설명서를 그대로 두면 여기서 걸린다(설명서는 업데이트마다 따라간다).
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertMarkdownToHtml } from "@/components/ui/markdown-view";

import packageJson from "../../package.json";
import { PERMISSIONS } from "./access";
import { MESSAGES } from "./i18n-messages";
import { listImageRefs, MANUAL_ASSET_BASE, MANUAL_PAGE_SECTION, MANUAL_STAGE_SECTION, parseManual } from "./manual";
import { MANUAL_DIR, readImageSizes, readManualSource } from "./manual-files";

// 화면 문구 사전에 없는 화면 글자 - 코드에 그대로 박혀 있는 것만 둔다
const LABELS_OUTSIDE_MESSAGES = new Set(["EN", "KO", "Synthetic data"]);

const HANGUL = /[ㄱ-ㆎ가-힣]/;

/** 코드 블록과 줄 안 코드를 뺀 글 - 굵은 글씨·링크를 셀 때 코드 안의 별표·괄호가 섞이지 않게 */
function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
}

const source = await readManualSource();
const doc = parseManual(source);
const prose = stripCode(source);

describe("user manual text", () => {
  it("names every section and sub heading with its own id", () => {
    const ids = doc.sections.flatMap((section) => [section.id, ...section.headings.map((heading) => heading.id)]);
    const unnamed = prose.split("\n").filter((line) => /^#{2,3} /.test(line) && !/\{#[a-z0-9][a-z0-9-]*\}\s*$/.test(line));

    expect(doc.sections.length).toBeGreaterThan(0);
    expect(unnamed).toEqual([]);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("has the section each screen's help link opens", () => {
    const sectionIds = new Set(doc.sections.map((section) => section.id));
    const wanted = [...Object.values(MANUAL_STAGE_SECTION), ...Object.values(MANUAL_PAGE_SECTION)];

    expect(wanted.filter((id) => !sectionIds.has(id))).toEqual([]);
  });

  it("links only to places that exist in the manual or the app, never to an outside address", () => {
    const ids = new Set(doc.sections.flatMap((section) => [section.id, ...section.headings.map((heading) => heading.id)]));
    const targets = Array.from(prose.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g), (match) => match[1]);

    expect(targets.filter((target) => target.startsWith("#") && !ids.has(target.slice(1)))).toEqual([]);
    expect(targets.filter((target) => !target.startsWith("#") && !target.startsWith("/"))).toEqual([]);
    // 공개 저장소·로그인 밖 정적 파일이라 서버 주소가 들어가면 안 된다
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });

  it("shows every image it names and leaves no unused image in the folder", async () => {
    const refs = listImageRefs(source);
    const sizes = await readImageSizes(source);
    const files = readdirSync(join(MANUAL_DIR, "img")).map((name) => `img/${name}`);

    expect(refs.filter((ref) => !sizes[ref])).toEqual([]);
    expect(files.filter((file) => !refs.includes(file))).toEqual([]);
  });

  it("uses only syntax the viewer draws", () => {
    for (const section of doc.sections) {
      const html = convertMarkdownToHtml(section.body, { imageBase: MANUAL_ASSET_BASE });
      const text = html.replace(/<pre>[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "");

      // 그려지지 않은 그림·자리 이름·키 모양·굵은 글씨가 글자로 남으면 안 된다
      expect(text, section.id).not.toMatch(/!\[|\{#|&lt;kbd|\*\*/);
      // 작은 제목은 ###까지만 - 조각 제목(##)은 화면이 그린다
      expect(html, section.id).not.toMatch(/<h[1245]/);
    }
  });

  it("writes screen labels exactly as the English screen shows them", () => {
    const labels = new Set([...Object.values(MESSAGES.en), ...LABELS_OUTSIDE_MESSAGES]);
    const bold = Array.from(prose.matchAll(/\*\*([^*\n]+)\*\*/g), (match) => match[1]);
    const unknown = [...new Set(bold.filter((phrase) => !HANGUL.test(phrase) && !labels.has(phrase)))];

    expect(unknown).toEqual([]);
  });

  it("explains every permission key", () => {
    expect(PERMISSIONS.filter((key) => !source.includes(`\`${key}\``))).toEqual([]);
  });

  it("is stamped with the service version it describes", () => {
    const [major, minor] = packageJson.version.split(".");

    // MINOR를 올리는 릴리스는 설명서를 다시 읽고 이 값을 같이 올린다
    expect(doc.version).toBe(`${major}.${minor}`);
    expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
