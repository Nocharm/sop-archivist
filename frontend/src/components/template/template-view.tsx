// 템플릿 보기(MD 1 F9 · F8c) - 결과물 C 꼴의 문서(엮은 문서 · 결과물 C 문서)를 회사 템플릿 모양으로 그리는 부품 하나. 모양 규칙은 lib/template-model이고 여기는 그리기만 한다.
// 머리글(글자만, 로고 없음) · 제목 · 빈 표지 표(Document No.만) · 앱이 만든 목차(읽기 전용) · 두 절반(SOP 영어 → 한글, WI 한글 → 영어) · CONFIDENTIAL.
// 쓰는 쪽이 켜는 것: 줄 누르기(onPickLine), "번역 없음" 자리 누르기(onMissing), 표·그림 그리기(renderBlock), 자리마다 속성·핸들러(spotProps - 클릭 배치 · 끌어 놓기가 단다),
// 줄 사이 틈(renderGap - 클릭 배치가 번호 줄 사이에 그린다).
// 아무것도 넘기지 않으면 읽기만 하는 보기다. 자리(장·절 제목 · 범주 행 · 빈 칸 · 줄)에는 늘 data-tpl-spot · data-section(줄은 data-row), 앱이 만드는 것에는 data-tpl-fixed가 달린다.
"use client";

import { Fragment, useMemo, type CSSProperties, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

import { DeviationMark, EmptyRequiredMark } from "@/components/tobe/deviation-mark";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { useI18n } from "@/lib/i18n";
import {
  buildTemplateLayout,
  CATEGORY_HEADS,
  isLineSelected,
  type HalfLang,
  type TemplateBlock,
  type TemplateDoc,
  type TemplateItem,
  type TemplateLine,
  type TemplateMarker,
  type TemplateMarks,
  type TemplateTitles,
} from "@/lib/template-model";

/** 템플릿 위의 자리 - section은 장·절 제목 · 5장 범주 행 · 빈 칸, line은 놓인 줄, fixed는 앱이 만드는 것(놓을 수 없는 곳) */
export type TemplateSpot =
  | { kind: "section"; sectionKey: string }
  | { kind: "line"; sectionKey: string; targetId: number }
  | { kind: "fixed"; what: "toc" | "cover" | "scope_table" | "system" };

interface TemplateViewProps<T extends TemplateItem> {
  doc: TemplateDoc<T>;
  titles: TemplateTitles;
  /** 칠할 새 문장 - 거울 줄의 어느 쪽이든 들면 두 절반이 함께 칠해진다 */
  selectedIds?: ReadonlySet<number>;
  /** 문장 줄을 누름 - 없으면 줄은 읽기만 한다 */
  onPickLine?: (item: T, event: MouseEvent) => void;
  /** "번역 없음" 자리를 누름(비춘 반대 절반의 줄) - 없으면 자리는 읽기만 한다 */
  onMissing?: (source: T) => void;
  /** 표·그림 줄 - 없으면 글(캡션)만 */
  renderBlock?: (item: T) => ReactNode;
  /** 자리마다 붙일 속성·핸들러 - 클릭 배치(MD 2 S3)·끌어 놓기(F9)가 쓴다 */
  spotProps?: (spot: TemplateSpot) => HTMLAttributes<HTMLElement> | undefined;
  /** 줄 묶음(장 · 절의 줄들)에서 두 줄 사이(prev 뒤 · next 앞, 맨 앞 · 맨 끝은 null)에 그릴 것 - 줄 id는 그 줄(번역 없음이면 비춘 줄)의 target id. 없으면 아무것도 */
  renderGap?: (sectionKey: string, prevId: number | null, nextId: number | null, lang: HalfLang) => ReactNode;
  testId: string;
}

// 템플릿 글 - 문서 내용이라 화면 언어와 상관없이 영어(설계 부록 A · F)
const HEADER = { sop: "Standard Operating Procedure", wi: "Work Instruction" } as const;
const COVER_TITLE = "Summary of Changes for Current Version";
const CONFIDENTIAL = "CONFIDENTIAL";
const NOTE = "Note.";
const NO_IDS: ReadonlySet<number> = new Set();

function renderMarker(marker: TemplateMarker): ReactNode {
  if (marker.kind === "number") return marker.text;
  if (marker.kind === "bullet") return marker.symbol;
  if (marker.kind === "note") return NOTE;
  return null;
}

function readLang(lang: string): string | undefined {
  return lang === "en" || lang === "ko" ? lang : undefined;
}

export function TemplateView<T extends TemplateItem>({ doc, titles, selectedIds = NO_IDS, onPickLine, onMissing, renderBlock, spotProps, renderGap, testId }: TemplateViewProps<T>) {
  const { t } = useI18n();
  const tip = useDelegatedTip();
  const layout = useMemo(() => buildTemplateLayout(doc, titles), [doc, titles]);

  function renderMarks(marks: TemplateMarks, idKey: string): ReactNode {
    return (
      <>
        {marks.deviationReason !== null && <DeviationMark reason={marks.deviationReason} testId={`${idKey}-differs`} />}
        {marks.isEmptyRequired && <EmptyRequiredMark testId={`${idKey}-empty-required`} />}
      </>
    );
  }

  function renderLine(line: TemplateLine<T>, lang: HalfLang, sectionKey: string, why = false): ReactNode {
    const style = { "--tpl-d": line.depth } as CSSProperties;
    const sel = isLineSelected(line, selectedIds) ? "" : undefined;
    const mark = <span className="tpl-mark">{renderMarker(line.marker)}</span>;
    if (line.item === null) {
      const source = line.source;
      if (source === null) return null;
      const label = t("template.noTranslation");
      return (
        <div key={line.key} className="tpl-line" data-sel={sel} data-why={why ? "" : undefined} style={style} data-testid={`${testId}-${lang}-miss-${source.target_id}`}>
          {mark}
          {onMissing ? (
            <button type="button" className="tpl-miss" data-tip={t("template.noTranslationTip")} data-testid={`${testId}-${lang}-miss-${source.target_id}-fill`} onClick={() => onMissing(source)}>
              {label}
            </button>
          ) : (
            <span className="tpl-miss">{label}</span>
          )}
        </div>
      );
    }
    const item = line.item;
    const isSentence = item.kind === "sentence";
    const attrs = {
      ...spotProps?.({ kind: "line", sectionKey, targetId: item.target_id }),
      className: `tpl-line${isSentence ? "" : " is-block"}`,
      style,
      "data-sel": sel,
      "data-why": why ? "" : undefined,
      "data-note": line.marker.kind === "note" ? "" : undefined,
      "data-tpl-spot": "line",
      "data-section": sectionKey,
      "data-row": `t:${item.target_id}`,
      "data-testid": `${testId}-${lang}-${item.target_id}`,
    };
    const body = isSentence ? (
      <span className="tpl-text" lang={readLang(item.lang)}>
        {item.text}
      </span>
    ) : (
      <div className="tpl-block">{renderBlock ? renderBlock(item) : <span className="tpl-text">{item.text}</span>}</div>
    );
    if (onPickLine && isSentence)
      return (
        <button key={line.key} type="button" {...attrs} aria-pressed={sel !== undefined} onClick={(event) => onPickLine(item, event)}>
          {mark}
          {body}
        </button>
      );
    return (
      <div key={line.key} {...attrs}>
        {mark}
        {body}
      </div>
    );
  }

  function renderEmpty(na: boolean, sectionKey: string, idKey: string): ReactNode {
    return (
      <p className="tpl-empty" {...spotProps?.({ kind: "section", sectionKey })} data-tpl-spot="section" data-section={sectionKey} data-na={na ? "" : undefined} data-testid={`${idKey}-empty`}>
        {na ? t("assign.slotNa") : t("assign.slotEmpty")}
      </p>
    );
  }

  function renderBlockOf(block: TemplateBlock<T>, lang: HalfLang): ReactNode {
    const idKey = `${testId}-${lang}-${block.sectionKey}`;
    switch (block.kind) {
      case "heading":
        return (
          <p key={block.key} className="tpl-h" data-level={Math.min(block.level, 2)} {...spotProps?.({ kind: "section", sectionKey: block.sectionKey })} data-tpl-spot="section" data-section={block.sectionKey} data-testid={`${idKey}-head`}>
            <span>{block.text}</span>
            {renderMarks(block, idKey)}
          </p>
        );
      case "lines": {
        // 줄마다 그 줄의 id와 바로 앞에 그려진 줄의 id - 그리지 않는 줄(비춘 줄도 없는 번역 없음)은 틈을 두지 않고 건너뛴다
        const ids = block.lines.map((line) => line.item?.target_id ?? line.source?.target_id ?? null);
        const prevIds: (number | null)[] = [];
        let lastId: number | null = null;
        for (const id of ids) {
          prevIds.push(lastId);
          if (id !== null) lastId = id;
        }
        return (
          <div key={block.key} className="tpl-lines" data-nested={block.nested ? "" : undefined}>
            {block.lines.map((line, index) => {
              const id = ids[index];
              return (
                <Fragment key={line.key}>
                  {renderGap && id !== null && renderGap(block.sectionKey, prevIds[index], id, lang)}
                  {renderLine(line, lang, block.sectionKey)}
                </Fragment>
              );
            })}
            {renderGap && lastId !== null && renderGap(block.sectionKey, lastId, null, lang)}
          </div>
        );
      }
      case "empty":
        return <Fragment key={block.key}>{renderEmpty(block.na, block.sectionKey, idKey)}</Fragment>;
      case "auto":
        return (
          <ul key={block.key} className="tpl-auto" {...spotProps?.({ kind: "section", sectionKey: block.sectionKey })} data-tpl-spot="section" data-section={block.sectionKey} data-testid={`${idKey}-auto`}>
            {block.items.length === 0 && <li className="text-ink-3">{t("outputs.autoEmpty")}</li>}
            {block.items.map((item) => (
              <li key={item.code}>
                <span className="font-mono">{item.code}</span>
                {item.title !== "" && ` ${item.title}`}
              </li>
            ))}
          </ul>
        );
      case "grid":
        return (
          // 2장 빈 표는 앱이 그리는 것(놓을 수 없음), 3·4장 표 머리는 그 장의 자리다 - 칸마다 따로 놓지 않고 장 제목과 같이 그 장의 줄이 된다(F9)
          <table
            key={block.key}
            className="tpl-table"
            {...(block.blankRow ? { ...spotProps?.({ kind: "fixed", what: "scope_table" }), "data-tpl-spot": "fixed", "data-tpl-fixed": "scope_table" } : { ...spotProps?.({ kind: "section", sectionKey: block.sectionKey }), "data-tpl-spot": "section", "data-section": block.sectionKey })}
            data-testid={`${idKey}-grid`}
          >
            <thead>
              <tr>
                {block.heads.map((head) => (
                  <th key={head} scope="col">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            {block.blankRow && (
              <tbody>
                <tr>
                  {block.heads.map((head) => (
                    <td key={head} />
                  ))}
                </tr>
              </tbody>
            )}
          </table>
        );
      case "label":
        return (
          <p key={block.key} className="tpl-label">
            <span className="tpl-mark">•</span>
            {block.text}
          </p>
        );
      case "system":
        return (
          <p key={block.key} className="tpl-line" {...spotProps?.({ kind: "fixed", what: "system" })} data-tpl-spot="fixed" data-tpl-fixed="system" data-testid={`${idKey}-system`}>
            <span className="tpl-mark">•</span>
            <span className="tpl-text">{block.text}</span>
          </p>
        );
      case "categories":
        return (
          <table key={block.key} className="tpl-table tpl-cat" data-testid={`${idKey}-categories`}>
            <thead>
              <tr>
                <th scope="col">{CATEGORY_HEADS[0]}</th>
                <th scope="col">{CATEGORY_HEADS[1]}</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => {
                const rowKey = `${testId}-${lang}-${row.sectionKey}`;
                return (
                  <tr key={row.sectionKey} {...spotProps?.({ kind: "section", sectionKey: row.sectionKey })} data-tpl-spot="section" data-section={row.sectionKey} data-testid={`${rowKey}-row`}>
                    <th scope="row">
                      {row.title}
                      {renderMarks(row, rowKey)}
                    </th>
                    <td>{row.lines.length > 0 ? row.lines.map((line) => renderLine(line, lang, row.sectionKey)) : <span className="tpl-cell-empty">{row.na ? t("assign.slotNa") : t("assign.slotEmpty")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      case "wi_chapter":
        return (
          <table key={block.key} className="tpl-table tpl-wi" {...spotProps?.({ kind: "section", sectionKey: block.sectionKey })} data-tpl-spot="section" data-section={block.sectionKey} data-testid={`${idKey}-chapter`}>
            <colgroup>
              <col className="tpl-wi-label" />
              <col />
              <col className="tpl-wi-fig" />
            </colgroup>
            <thead>
              <tr>
                <th colSpan={3} scope="colgroup">
                  {block.title}
                </th>
              </tr>
            </thead>
            <tbody>
              {block.rows.length === 0 && (
                <tr>
                  <td />
                  <td className="tpl-cell-empty">{t("assign.slotEmpty")}</td>
                  <td>{block.figures.map((line) => renderLine(line, lang, block.sectionKey))}</td>
                </tr>
              )}
              {block.rows.map((row, index) => (
                <tr key={row.line.key} data-why={row.why ? "" : undefined}>
                  <td className="tpl-wi-num">{renderMarker(row.line.marker)}</td>
                  <td>{renderLine({ ...row.line, marker: { kind: "none" }, depth: 0 }, lang, block.sectionKey, row.why)}</td>
                  {index === 0 && <td rowSpan={block.rows.length}>{block.figures.map((line) => renderLine(line, lang, block.sectionKey))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        );
    }
  }

  return (
    <div className="sheet tpl-sheet">
      <div className="pg tpl-paper" data-doc-type={layout.docType} data-testid={testId} {...tip.handlers}>
        <p className="tpl-header">{HEADER[layout.docType]}</p>
        <p className="tpl-title">{layout.title || layout.code}</p>
        <table className="tpl-table tpl-cover" {...spotProps?.({ kind: "fixed", what: "cover" })} data-tpl-spot="fixed" data-tpl-fixed="cover" data-testid={`${testId}-cover`}>
          <tbody>
            <tr>
              <th colSpan={4}>{COVER_TITLE}</th>
            </tr>
            <tr>
              <th colSpan={3}>Document No.</th>
              <th>Ver.</th>
            </tr>
            <tr>
              <td colSpan={3} className="font-mono" data-testid={`${testId}-doc-no`}>
                {layout.code}
              </td>
              <td />
            </tr>
            <tr>
              <th colSpan={2}>Record No.</th>
              <th colSpan={2}>Title</th>
            </tr>
            <tr>
              <td colSpan={2} />
              <td colSpan={2} />
            </tr>
            <tr>
              <th colSpan={2}>Section No.</th>
              <th colSpan={2} rowSpan={2}>
                Description of Change
              </th>
            </tr>
            <tr>
              <th>ENG</th>
              <th>KOR</th>
            </tr>
            <tr>
              <td />
              <td />
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        <nav className="tpl-toc" aria-label={t("template.toc")} {...spotProps?.({ kind: "fixed", what: "toc" })} data-tpl-spot="fixed" data-tpl-fixed="toc" data-testid={`${testId}-toc`}>
          <p className="tpl-toc-head">
            Table of Contents <span className="tpl-toc-note">{t("template.tocNote")}</span>
          </p>
          {layout.toc.map((entry) => (
            <p key={entry.key} className="tpl-toc-line" data-level={entry.level}>
              {entry.text}
            </p>
          ))}
        </nav>
        {layout.halves.map((half) => (
          <section key={half.lang} className="tpl-half" lang={half.lang} data-testid={`${testId}-half-${half.lang}`}>
            <p className="tpl-half-label">{t(half.lang === "en" ? "template.half.en" : "template.half.ko")}</p>
            {half.blocks.map((block) => renderBlockOf(block, half.lang))}
          </section>
        ))}
        <p className="tpl-foot">{CONFIDENTIAL}</p>
        {tip.node}
      </div>
    </div>
  );
}
