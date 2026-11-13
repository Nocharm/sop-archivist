// 결과물 C 한 벌 - 새 문서를 칸·단계 순서로 미리 본다. 칸마다 두 언어 문장이 C 순서대로 한 목록이고, 같은 의미에서 나온 이웃 문장은 굵은 선으로 묶인다.
// 결과물 화면과 검토 화면이 같이 쓴다. 확정 전 새 문장은 점선.
"use client";

import { ArrowDown, ArrowUp, FileStack, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, ListTree, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import type { NumberStyle, OutputC, OutputCItem } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { listMeaningStarts } from "@/lib/output-groups";
import { canChangeDepth, canChangeStyle, canIndent, getSectionDepths, isCounted, NUMBER_STYLES, readIndentKey, type IndentDir } from "@/lib/section-number";
import { canMoveTarget, type MoveDir } from "@/lib/target-order";

/** 순서 바꾸기 - 결과물 화면에서 작성자에게만 넘긴다. 검토 화면은 넘기지 않아 단추가 없다 */
export type MoveTarget = (targetDocId: number, locationKey: string, targetId: number, dir: MoveDir) => void;
/** 들여·내어쓰기 - 지금 보이는 깊이에서 한 단계, 그 줄만. 검토 화면은 넘기지 않는다 */
export type IndentTarget = (targetDocId: number, targetId: number, depth: number) => void;
/** 번호 표시 바꾸기 - 그 줄에만 붙는다(짝 상대·번역이 따라 바뀌지 않는다). 검토 화면은 넘기지 않는다 */
export type MarkTarget = (targetDocId: number, targetId: number, style: NumberStyle) => void;

/** 글꼴을 고르는 lang 속성 - 언어가 없는 단위(표 틀·그림)는 감싼 쪽을 따른다 */
function readLangAttr(lang: string): string | undefined {
  return lang === "ko" || lang === "en" ? lang : undefined;
}

const MARK_ICONS: Record<NumberStyle, LucideIcon> = { numbered: ListOrdered, omitted: List, note: Italic };
const MARK_KEYS: Record<NumberStyle, { label: string; tip: string }> = {
  numbered: { label: "outputs.markNumbered", tip: "outputs.markNumberedTip" },
  omitted: { label: "outputs.markOmitted", tip: "outputs.markOmittedTip" },
  note: { label: "outputs.markNote", tip: "outputs.markNoteTip" },
};

function CItemView({ item }: { item: OutputCItem }) {
  // 주석 줄은 번호 없이 기울여 보인다 - 표 칸은 표의 표시를 싣는다
  const isNote = item.number_style === "note";
  if (item.kind === "table") {
    const rows = new Map<number, OutputCItem[]>();
    for (const cell of item.children) rows.set(cell.cell_row ?? 0, [...(rows.get(cell.cell_row ?? 0) ?? []), cell]);
    return (
      <table className={`ptbl my-1 ${isNote ? "italic" : ""}`}>
        <tbody>
          {[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([index, cells]) => (
            <tr key={index}>
              {cells.sort((a, b) => (a.cell_col ?? 0) - (b.cell_col ?? 0)).map((cell) => (
                // 확정 글이 없으면 AI 글 - 문장과 같은 규칙, 확정 전 칸은 점선
                <td key={cell.target_id} className={cell.status === "confirmed" ? undefined : "border-dashed"} lang={readLangAttr(cell.lang)}>
                  {cell.text || cell.ai_text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <p
      className={`${item.status === "confirmed" ? "" : "rounded-sm border border-dashed border-line-2 px-1"} ${isNote ? "italic" : ""}`}
      lang={readLangAttr(item.lang)}
      data-testid={`output-c-item-${item.target_id}`}
      data-number-style={item.number_style}
    >
      {item.kind === "figure" ? "[Figure]" : item.text || item.ai_text}
    </p>
  );
}

interface RowButtonsProps {
  items: OutputCItem[];
  item: OutputCItem;
  busy: boolean;
  onMove: (dir: MoveDir) => void;
  /** 깊이를 바꿀 수 없는 줄(입구 2 문서·AI 번역 줄)이면 없다 */
  indent: { canOut: boolean; canIn: boolean; onIndent: (dir: IndentDir) => void } | null;
  /** 번호 표시를 바꿀 수 없는 줄(입구 2 문서)이면 없다 */
  onMark: ((style: NumberStyle) => void) | null;
}

function RowButtons({ items, item, busy, onMove, indent, onMark }: RowButtonsProps) {
  const { t } = useI18n();
  return (
    <span className="row-actions-quiet flex gap-0.5" style={{ fontFamily: "var(--font-ui)" }}>
      {onMark && (
        // 세 칸 눌림 단추 - 떠 있는 메뉴를 쓰지 않아 옆 글자를 덮지 않는다. 아이콘만 있으니 툴팁이 뜻을 알려 준다
        <span className="view-toggle c-mark mr-1" role="group" aria-label={t("outputs.markGroup")} data-testid={`output-c-mark-${item.target_id}`}>
          {NUMBER_STYLES.map((style) => {
            const Icon = MARK_ICONS[style];
            return (
              <Tooltip key={style} label={t(MARK_KEYS[style].tip)} align="end">
                <button
                  type="button"
                  aria-pressed={item.number_style === style}
                  aria-label={t(MARK_KEYS[style].label)}
                  data-testid={`output-c-mark-${style}-${item.target_id}`}
                  disabled={busy}
                  onClick={() => {
                    if (item.number_style !== style) onMark(style);
                  }}
                >
                  <Icon size={12} strokeWidth={1.5} aria-hidden />
                </button>
              </Tooltip>
            );
          })}
        </span>
      )}
      {indent &&
        ([-1, 1] as const).map((dir) => (
          // 단추는 탭 순서에 있고, 툴팁이 줄을 고른 뒤 쓰는 글쇠도 알려 준다
          <Tooltip key={`i${dir}`} label={t(dir < 0 ? "outputs.outdentTip" : "outputs.indentTip")} align="end">
            <button
              type="button"
              className="btn ghost icon h-6 w-6"
              aria-label={t(dir < 0 ? "outputs.outdent" : "outputs.indent")}
              data-testid={`output-c-${dir < 0 ? "outdent" : "indent"}-${item.target_id}`}
              disabled={busy || !(dir < 0 ? indent.canOut : indent.canIn)}
              onClick={() => indent.onIndent(dir)}
            >
              {dir < 0 ? <IndentDecrease size={12} strokeWidth={1.5} aria-hidden /> : <IndentIncrease size={12} strokeWidth={1.5} aria-hidden />}
            </button>
          </Tooltip>
        ))}
      {([-1, 1] as const).map((dir) => (
        <Tooltip key={dir} label={t(dir < 0 ? "outputs.moveUp" : "outputs.moveDown")} align="end">
          <button
            type="button"
            className="btn ghost icon h-6 w-6"
            aria-label={t(dir < 0 ? "outputs.moveUp" : "outputs.moveDown")}
            data-testid={`output-c-move-${dir < 0 ? "up" : "down"}-${item.target_id}`}
            disabled={busy || !canMoveTarget(items, item.target_id, dir)}
            onClick={() => onMove(dir)}
          >
            {dir < 0 ? <ArrowUp size={12} strokeWidth={1.5} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.5} aria-hidden />}
          </button>
        </Tooltip>
      ))}
    </span>
  );
}

/** 줄 앞 섹션 번호 - 깊이만큼 들여 그린다. 번호가 없는 칸(입구 2 문서·단계 없는 WI)도 깊이는 그린다 */
function NumberedLine({ item, depth, children }: { item: OutputCItem; depth: number; children: ReactNode }) {
  return (
    <div className="c-line" data-numbered={item.number !== null ? "" : undefined} style={{ paddingLeft: `calc(${depth} * var(--c-indent))` }}>
      {item.number !== null && (
        <span className="c-no" data-testid={`output-c-number-${item.target_id}`}>
          {item.number}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface OutputCViewProps {
  data: OutputC;
  onMove?: MoveTarget;
  onIndent?: IndentTarget;
  onMark?: MarkTarget;
  moving?: boolean;
  /** 비었을 때 갈 곳(To-Be) - 고칠 수 있는 화면에서만 준다 */
  tobeHref?: string;
}

export function OutputCView({ data, onMove, onIndent, onMark, moving = false, tobeHref }: OutputCViewProps) {
  const { t } = useI18n();
  if (data.docs.length === 0) {
    return (
      <EmptyState
        icon={FileStack}
        testId="output-c-empty"
        title={t("outputs.emptyTitle")}
        body={t("outputs.emptyC")}
        action={
          tobeHref && (
            <Link href={tobeHref} className="btn" data-testid="output-c-empty-tobe">
              <ListTree size={14} strokeWidth={1.5} aria-hidden />
              {t("outputs.openTobe")}
            </Link>
          )
        }
      />
    );
  }
  return (
    <div className="grid gap-6 p-[var(--pad)]" data-testid="output-c">
      {data.docs.map((doc) => (
        <article key={doc.target_doc_id} className="sheet mx-0 max-w-[760px]">
          {/* 줄마다 자기 언어(lang)로 글꼴을 고른다 - 한 칸에 두 언어가 섞인다 */}
          <div className="pg">
            <header className="flex items-baseline gap-2 border-b border-line pb-2" style={{ fontFamily: "var(--font-ui)" }}>
              <span className="font-mono text-[13px] font-semibold">{doc.code}</span>
              <span className="font-semibold">{doc.title}</span>
              <span className="tag ml-auto">{doc.doc_type.toUpperCase()}</span>
            </header>
            {doc.sections.map((section) => {
              const depths = getSectionDepths(section);
              const counted = section.items.map(isCounted);
              const starts = listMeaningStarts(section.items);
              return (
                <section key={section.location_key} className="grid gap-1">
                  <h3 className="text-[13px] font-semibold text-ink-2" style={{ fontFamily: "var(--font-ui)" }} data-testid={`output-c-section-${doc.target_doc_id}-${section.location_key}`}>
                    {section.number !== null && <span className="mr-1.5 font-mono">{section.number}</span>}
                    {section.label}
                    {/* 칸 제목으로 간 옛 제목 - 칸 항목이 아니라 머리 옆에 흐리게. 길면 감긴다 */}
                    {section.heading_note !== "" && (
                      <span className="ml-2 font-normal text-ink-3 [overflow-wrap:anywhere]" data-testid={`output-c-heading-note-${doc.target_doc_id}-${section.location_key}`}>
                        {section.heading_note}
                      </span>
                    )}
                  </h3>
                  {section.na_reason !== null ? (
                    <p className="text-ink-3">N/A · {section.na_reason}</p>
                  ) : section.items.length === 0 ? (
                    <p className="text-ink-4">–</p>
                  ) : (
                    section.items.map((item, index) => {
                      const line = (
                        <NumberedLine item={item} depth={depths[index]}>
                          <CItemView item={item} />
                        </NumberedLine>
                      );
                      // 의미 묶음의 첫 줄 위에 굵은 선 - 칸의 첫 줄은 칸 머리가 위에 있어 긋지 않는다
                      const meaningStart = starts[index] && index > 0 ? "" : undefined;
                      if (!onMove) {
                        return (
                          <div key={item.target_id} className="c-row" data-meaning-start={meaningStart} data-testid={`output-c-row-${item.target_id}`}>
                            {line}
                          </div>
                        );
                      }
                      const indent =
                        onIndent && canChangeDepth(doc.entrance, item)
                          ? {
                              canOut: canIndent(depths, counted, index, -1),
                              canIn: canIndent(depths, counted, index, 1),
                              onIndent: (dir: IndentDir) => onIndent(doc.target_doc_id, item.target_id, depths[index] + dir),
                            }
                          : null;
                      return (
                        <div
                          key={item.target_id}
                          // 줄을 눌러 고르면 Tab·Shift+Tab이 들이고 내어 쓴다. 탭 순서에는 넣지 않고(-1) Esc로 놓아 Tab이 페이지 이동을 빼앗지 않게 한다
                          tabIndex={indent ? -1 : undefined}
                          // 줄 끝 단추는 글 뒤 같은 flex 줄에 둔다(.c-row) - 글이 폭을 채우면 아래로 감겨 겹치지 않고, 늘 흐리게 보여 호버로 높이가 변하지 않는다
                          className="hover-row c-row"
                          data-meaning-start={meaningStart}
                          data-testid={`output-c-row-${item.target_id}`}
                          onKeyDown={(event) => {
                            if (!indent || event.target !== event.currentTarget) return;
                            if (event.key === "Escape") event.currentTarget.blur();
                            // 바꿀 수 있을 때만 Tab을 가로챈다 - 아니면 포커스가 평소대로 다음 요소로 간다
                            const dir = readIndentKey(event, { canOut: indent.canOut, canIn: indent.canIn, busy: moving });
                            if (dir === null) return;
                            event.preventDefault();
                            indent.onIndent(dir);
                          }}
                        >
                          {line}
                          <RowButtons
                            items={section.items}
                            item={item}
                            busy={moving}
                            indent={indent}
                            onMark={onMark && canChangeStyle(doc.entrance) ? (style) => onMark(doc.target_doc_id, item.target_id, style) : null}
                            onMove={(dir) => onMove(doc.target_doc_id, section.location_key, item.target_id, dir)} />
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })}
          </div>
        </article>
      ))}
      {(data.deleted.length > 0 || data.moved.length > 0) && (
        <section className="grid max-w-[760px] gap-2">
          <h2 className="text-xs font-semibold text-ink-3">{t("outputs.deletedMoved")}</h2>
          {/* 옛 줄마다 한 번 - 짝이면 표시 ID·원문이 줄바꿈으로 이어져 온다 */}
          <ul className="grid gap-1 text-[13px]">
            {data.deleted.map((item, index) => (
              <li key={`d${index}`} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2" data-testid={`output-c-deleted-${index}`}>
                <span className="whitespace-pre-line font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">{item.display_id}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="whitespace-pre-line text-ink-3 line-through decoration-[var(--danger-ink)]">{item.source_text}</span>
                  <span className="block whitespace-pre-line text-xs text-ink-3">{item.reason}</span>
                </span>
              </li>
            ))}
            {data.moved.map((item, index) => (
              <li key={`m${index}`} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2" data-testid={`output-c-moved-${index}`}>
                <span className="whitespace-pre-line font-mono text-[11px] text-ink-3 [overflow-wrap:anywhere]">{item.display_id}</span>
                <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">
                  {item.source_text}
                  <span className="block text-xs text-ink-3">
                    → <span className="font-mono">{item.move_target_code}</span> · {item.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
