// 결과물 C 한 벌 - 새 문서를 칸·단계 순서로 미리 본다. 칸마다 두 언어 문장이 C 순서대로 한 목록이고, 같은 의미에서 나온 이웃 문장은 굵은 선으로 묶인다.
// 결과물 화면과 검토 화면이 같이 쓴다. 확정 전 새 문장은 점선. 문서 머리 오른쪽에 그 번호의 EQUIS 표시(읽기 전용, EQUIS가 꺼져 있으면 없다). 긴 C는 줄(문서 머리·칸 머리·문장) 단위로 이어 그린다.
// 위·아래로 옮기면 두 줄이 미끄러지며 자리를 바꾸고(useFlip), 옮긴 줄이 아직 그리지 않은 구간으로 가면 거기까지 그린 뒤 그 줄을 따라 스크롤한다.
// 고칠 수 있는 Order에서는 줄을 끌어 덩어리를 칸 안이나 같은 문서의 다른 칸으로 옮기고 좌우로 깊이를 바꾼다(lib/c-drop-model.ts) - 끄는 동안의 표시는 DOM으로만 한다.
"use client";

import { ArrowDown, ArrowUp, Dot, FileStack, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, ListTree, MoreHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EquisStatus } from "@/components/equis/equis-status";
import { DeviationMark, EmptyRequiredMark } from "@/components/tobe/deviation-mark";
import { RenumberMark } from "@/components/paper/renumber-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu, MenuRadio } from "@/components/ui/menu";
import { flashElement, useFlip } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TemplateView } from "@/components/template/template-view";
import type { EquisInfo, NumberStyle, OutputC, OutputCItem } from "@/lib/api-sop";
import type { BoxDragConfig, DragCard, DragHover, DragPoint } from "@/lib/box-drag";
import {
  findDragBlock,
  findDropSectionByKey,
  findEnterRefusal,
  findLeaveRefusal,
  findLiveBlock,
  listDropRows,
  planCrossDrop,
  planDrop,
  type DragBlock,
  type DropPlan,
  type EnterRefusal,
  type LeaveRefusal,
  type RowBox,
} from "@/lib/c-drop-model";
import { previewEdit, type PlaceEdit } from "@/lib/c-edit-model";
import { splitCTable } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";
import { buildCLines, hasMergedSource, listMeaningStarts, type CLine } from "@/lib/output-groups";
import { shouldRecenter } from "@/lib/paper-model";
import type { TemplateTitles } from "@/lib/template-model";
import { canChangeDepth, canChangeStyle, canIndent, getSectionDepths, listBullets, listCounted, readBulletSymbol, readIndentKey, readStyleChoices, type IndentDir } from "@/lib/section-number";
import { canMoveTarget, readMoveKey, type MoveDir } from "@/lib/target-order";
import { useBoxDrag } from "@/lib/use-box-drag";
import { useProgressiveList } from "@/lib/use-progressive-list";

type Doc = OutputC["docs"][number];
type Section = Doc["sections"][number];

/** 순서 바꾸기 - 결과물 화면에서 작성자에게만 넘긴다. 검토 화면은 넘기지 않아 단추가 없다 */
export type MoveTarget = (targetDocId: number, locationKey: string, targetId: number, dir: MoveDir) => void;
/** 들여·내어쓰기 - 지금 보이는 깊이에서 한 단계, 그 줄만. 검토 화면은 넘기지 않는다 */
export type IndentTarget = (targetDocId: number, targetId: number, depth: number) => void;
/** 번호 표시 바꾸기 - 그 줄에만 붙는다(짝 상대·번역이 따라 바뀌지 않는다). 검토 화면은 넘기지 않는다 */
export type MarkTarget = (targetDocId: number, targetId: number, style: NumberStyle) => void;
/** 끌어 놓기 - 덩어리를 칸 안이나 같은 문서의 다른 칸의 한 자리로(깊이도 함께) 옮긴다. 넘길 때만 줄이 끌린다(검토·결과물 화면은 넘기지 않는다) */
export type PlaceTarget = (targetDocId: number, edit: PlaceEdit) => void;

/** 글꼴을 고르는 lang 속성 - 언어가 없는 단위(표 틀·그림)는 감싼 쪽을 따른다 */
function readLangAttr(lang: string): string | undefined {
  return lang === "ko" || lang === "en" ? lang : undefined;
}

const MARK_ICONS: Record<NumberStyle, LucideIcon> = { numbered: ListOrdered, bullet: Dot, omitted: List, note: Italic };
const MARK_KEYS: Record<NumberStyle, { label: string; tip: string }> = {
  numbered: { label: "outputs.markNumbered", tip: "outputs.markNumberedTip" },
  bullet: { label: "outputs.markBullet", tip: "outputs.markBulletTip" },
  omitted: { label: "outputs.markOmitted", tip: "outputs.markOmittedTip" },
  note: { label: "outputs.markNote", tip: "outputs.markNoteTip" },
};

/** 표·그림의 캡션 줄 - 확정 글이 없으면 AI 글, 확정 전이면 점선(문장과 같은 규칙). 줄마다 자기 상태를 따른다.
 * 이 새 문서에서 번호를 다시 매겼으면 글이 있는 첫 줄 앞에 "표 3 → 표 1"(Assign New 칸과 같은 표시 - 빈 캡션에는 없다) */
function CaptionLines({ captions, isNote, owner }: { captions: readonly OutputCItem[]; isNote: boolean; owner: OutputCItem }) {
  const chipIndex = captions.findIndex((caption) => caption.text || caption.ai_text);
  return captions.map((caption, index) => (
    <p
      key={caption.target_id}
      className={`${caption.status === "confirmed" ? "" : "rounded-sm border border-dashed border-line-2 px-1"} ${isNote ? "italic" : ""}`}
      lang={readLangAttr(caption.lang)}
      data-testid={`output-c-caption-${caption.target_id}`}
    >
      {index === chipIndex && owner.renumber &&<RenumberMark change={owner.renumber} testId={`output-c-renumber-${owner.target_id}`} />}
      {caption.text || caption.ai_text}
    </p>
  ));
}

function CItemView({ item }: { item: OutputCItem }) {
  // 주석 줄은 번호 없이 기울여 보인다 - 표 칸은 표의 표시를 싣는다
  const isNote = item.number_style === "note";
  if (item.kind === "table") {
    const { captions, grid } = splitCTable(item.children);
    return (
      <>
        {/* 캡션 줄은 표 앞 */}
        <CaptionLines captions={captions} isNote={isNote} owner={item} />
        {/* 넓은 표는 좌우로 스크롤한다 - 표 안을 눌러도 줄이 끌리고, 스크롤 막대 누름만 끌기에서 빠진다(lib/box-drag.ts isOnHorizontalScrollbar) */}
        <div className="ptbl-scroll my-1">
          <table className={`ptbl ${isNote ? "italic" : ""}`}>
            <tbody>
              {grid.map((cols, row) => (
                <tr key={row}>
                  {cols.map((cells, col) => (
                    // 칸 번역은 같은 자리에 줄로 쌓는다 - 칸을 하나 더 두면 뒤 열이 밀린다. 확정 전 칸이 든 자리는 점선
                    <td key={col} className={cells.every((cell) => cell.item.status === "confirmed") ? undefined : "border-dashed"}>
                      {cells.map(({ item: cell }) => (
                        <div key={cell.target_id} lang={readLangAttr(cell.lang)}>
                          {cell.text || cell.ai_text}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  // 그림은 [Figure] 대신 캡션 자식의 줄들 - 캡션이 없으면 그림 자기 글, 그것도 없으면 표시만
  const captions = item.kind === "figure" ? splitCTable(item.children).captions : [];
  if (captions.length > 0) {
    return (
      <div data-testid={`output-c-item-${item.target_id}`} data-number-style={item.number_style}>
        <CaptionLines captions={captions} isNote={isNote} owner={item} />
      </div>
    );
  }
  return (
    <p
      className={`${item.status === "confirmed" ? "" : "rounded-sm border border-dashed border-line-2 px-1"} ${isNote ? "italic" : ""}`}
      lang={readLangAttr(item.lang)}
      data-testid={`output-c-item-${item.target_id}`}
      data-number-style={item.number_style}
    >
      {item.kind === "figure" ? item.text || "[Figure]" : item.text || item.ai_text}
    </p>
  );
}

interface RowButtonsProps {
  items: OutputCItem[];
  item: OutputCItem;
  /** refocus - 누른 단추에 포커스가 있었나(옮긴 뒤 같은 단추에 다시 둔다) */
  onMove: (dir: MoveDir, refocus: boolean) => void;
  /** 깊이를 바꿀 수 없는 줄(입구 2 문서·AI 번역 줄)이면 없다 */
  indent: { canOut: boolean; canIn: boolean; onIndent: (dir: IndentDir) => void } | null;
  /** 번호 표시를 바꿀 수 없는 줄(입구 2 문서)이면 없다 */
  onMark: ((style: NumberStyle) => void) | null;
  /** 그 칸의 줄이 고를 수 있는 표시와 눌린 것으로 보일 표시 - 하위 칸이 있는 칸의 줄은 번호를 내놓지 않고 번호로 저장된 줄을 생략으로 보인다 */
  mark: ReturnType<typeof readStyleChoices>;
}

// 저장하는 동안에도 단추는 켜져 있다 - 바뀜은 화면에 먼저 얹고 저장은 뒤에서 한 번에 하나씩 보낸다
function RowButtons({ items, item, onMove, indent, onMark, mark }: RowButtonsProps) {
  const { t } = useI18n();
  return (
    // data-no-drag - 단추 사이 틈을 눌러도 줄 끌기가 시작되지 않는다
    <span className="c-acts" data-no-drag data-testid={`output-c-acts-${item.target_id}`} style={{ fontFamily: "var(--font-ui)" }}>
      {onMark && (
        // 눌림 단추 묶음(보통 넷) - 떠 있는 메뉴를 쓰지 않아 옆 글자를 덮지 않는다. 아이콘만 있으니 툴팁이 뜻을 알려 준다
        <span className="view-toggle c-mark" role="group" aria-label={t("outputs.markGroup")} data-testid={`output-c-mark-${item.target_id}`}>
          {mark.choices.map((style) => {
            const Icon = MARK_ICONS[style];
            return (
              <Tooltip key={style} label={t(MARK_KEYS[style].tip)} align="end">
                <button
                  type="button"
                  aria-pressed={mark.pressed === style}
                  aria-label={t(MARK_KEYS[style].label)}
                  data-testid={`output-c-mark-${style}-${item.target_id}`}
                  onClick={() => {
                    // 저장값과 견준다 - 눌린 것으로 보이는 생략도 저장값이 번호면 그 값을 저장한다
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
              disabled={!(dir < 0 ? indent.canOut : indent.canIn)}
              onClick={() => indent.onIndent(dir)}
            >
              {dir < 0 ? <IndentDecrease size={12} strokeWidth={1.5} aria-hidden /> : <IndentIncrease size={12} strokeWidth={1.5} aria-hidden />}
            </button>
          </Tooltip>
        ))}
      {([-1, 1] as const).map((dir) => (
        <Tooltip key={dir} label={t(dir < 0 ? "outputs.moveUpTip" : "outputs.moveDownTip")} align="end">
          <button
            type="button"
            className="btn ghost icon h-6 w-6"
            aria-label={t(dir < 0 ? "outputs.moveUp" : "outputs.moveDown")}
            data-testid={`output-c-move-${dir < 0 ? "up" : "down"}-${item.target_id}`}
            disabled={!canMoveTarget(items, item.target_id, dir)}
            onClick={(event) => onMove(dir, document.activeElement === event.currentTarget)}
          >
            {dir < 0 ? <ArrowUp size={12} strokeWidth={1.5} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.5} aria-hidden />}
          </button>
        </Tooltip>
      ))}
    </span>
  );
}

/** 용지 옆 자리가 좁을 때 묶음 대신 보이는 ⋯ 단추 - 같은 일곱 동작을 이름 붙은 메뉴 항목으로 연다. 어느 쪽을 보일지는 CSS(.c-order 틀 폭)가 정한다 */
function RowMenu({ items, item, onMove, indent, onMark, mark }: RowButtonsProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // 줄의 다른 단추처럼 끝에 줄 id - 메뉴는 output-c-menu-list-<id>, 항목은 output-c-menu-<동작>-<id>
  const testIdOf = (part: string) => `output-c-menu-${part}${item.target_id}`;
  // 고르면 닫고 실행한다 - 닫힌 메뉴가 포커스를 ⋯ 단추로 돌려 같은 줄에서 이어 고칠 수 있다
  function run(action: () => void) {
    setIsOpen(false);
    action();
  }
  return (
    <span className="c-more" data-no-drag style={{ fontFamily: "var(--font-ui)" }}>
      <Tooltip label={t("outputs.lineActions")} suppressed={isOpen} align="end">
        <button
          ref={anchorRef}
          type="button"
          className="btn ghost icon h-6 w-6"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={t("outputs.lineActions")}
          data-testid={testIdOf("")}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <MoreHorizontal size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
      {isOpen && (
        <Menu anchorRef={anchorRef} onClose={() => setIsOpen(false)} testId={testIdOf("list-")} label={t("outputs.lineActions")} align="end">
          {onMark && (
            <>
              <div className="menu-label">{t("outputs.markGroup")}</div>
              {mark.choices.map((style) => (
                <MenuRadio key={style} checked={mark.pressed === style} testId={testIdOf(`${style}-`)} onSelect={() => run(() => {
                  if (item.number_style !== style) onMark(style);
                })}>
                  {t(MARK_KEYS[style].label)}
                </MenuRadio>
              ))}
              <div className="menu-sep" role="separator" />
            </>
          )}
          {indent &&
            ([-1, 1] as const).map((dir) => (
              <button
                key={`i${dir}`}
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid={testIdOf(dir < 0 ? "outdent-" : "indent-")}
                disabled={!(dir < 0 ? indent.canOut : indent.canIn)}
                onClick={() => run(() => indent.onIndent(dir))}
              >
                {dir < 0 ? <IndentDecrease size={14} strokeWidth={1.5} aria-hidden /> : <IndentIncrease size={14} strokeWidth={1.5} aria-hidden />}
                {t(dir < 0 ? "outputs.outdent" : "outputs.indent")}
              </button>
            ))}
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid={testIdOf(dir < 0 ? "up-" : "down-")}
              disabled={!canMoveTarget(items, item.target_id, dir)}
              // 포커스는 닫힌 메뉴가 ⋯ 단추로 돌린다 - 옮긴 줄의 위·아래 단추에 다시 두지 않는다
              onClick={() => run(() => onMove(dir, false))}
            >
              {dir < 0 ? <ArrowUp size={14} strokeWidth={1.5} aria-hidden /> : <ArrowDown size={14} strokeWidth={1.5} aria-hidden />}
              {t(dir < 0 ? "outputs.moveUp" : "outputs.moveDown")}
            </button>
          ))}
        </Menu>
      )}
    </span>
  );
}

/** 줄 앞 섹션 번호 - 깊이만큼 들여 그린다. 번호가 없는 칸(입구 2 문서·단계 없는 WI)도 깊이는 그린다. 글머리 기호 줄은 번호 자리에 그 깊이의 기호(• ○ ▪) */
function NumberedLine({ item, depth, children }: { item: OutputCItem; depth: number; children: ReactNode }) {
  const isBullet = item.number === null && item.number_style === "bullet";
  return (
    <div className="c-line" data-numbered={item.number !== null ? "" : undefined} data-bullet={isBullet ? "" : undefined} style={{ paddingLeft: `calc(${depth} * var(--c-indent))` }}>
      {item.number !== null && (
        <span className="c-no" data-testid={`output-c-number-${item.target_id}`}>
          {item.number}
        </span>
      )}
      {isBullet && (
        <span className="c-no c-no-bullet" aria-hidden data-testid={`output-c-bullet-${item.target_id}`}>
          {readBulletSymbol(depth)}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** N:1 출처 꼬리표 - 옛 두 줄 이상에서 온 줄에만, 줄 아래에 어둡게(올리거나 고를 때만 CSS가 보인다). 글은 서버의 source_note 그대로, 깊이만큼 들여 글 줄에 맞춘다 */
function SourceTag({ item, depth }: { item: OutputCItem; depth: number }) {
  if (!hasMergedSource(item)) return null;
  return (
    // 바깥 상자가 줄 글꼴 크기로 깊이만큼 들이고(em 단위), 안쪽 꼬리표만 작은 글자다
    <span className="c-src-wrap" style={{ paddingLeft: `calc(${depth} * var(--c-indent))` }}>
      <span className="c-src" data-testid={`output-c-source-${item.target_id}`}>
        {item.source_note}
      </span>
    </span>
  );
}

/** 이어 그린 줄을 지금 마크업(문서 → 칸 → 줄)으로 다시 묶은 것 - 칸은 머리가 그려졌으면 줄이 아직 없어도 있다 */
interface DocBlock {
  doc: OutputC["docs"][number];
  sections: Array<{ sectionIndex: number; itemIndexes: number[] }>;
}

function groupLines(data: OutputC, lines: readonly CLine[]): DocBlock[] {
  const docs: DocBlock[] = [];
  for (const line of lines) {
    if (line.kind === "doc") docs.push({ doc: data.docs[line.docIndex], sections: [] });
    else if (line.kind === "section") docs.at(-1)?.sections.push({ sectionIndex: line.sectionIndex, itemIndexes: [] });
    else docs.at(-1)?.sections.at(-1)?.itemIndexes.push(line.itemIndex);
  }
  return docs;
}

/** 이어 그리기 끝 표지 - 용지 안에서 다음 줄들이 붙을 자리를 글 줄 모양의 쉬머로 채운다 */
function CMore({ sentinelRef }: { sentinelRef: (node: Element | null) => void }) {
  return (
    <div ref={sentinelRef} className="grid gap-2 pt-1" data-testid="output-c-more" aria-hidden>
      {[92, 74, 86].map((width) => (
        <span key={width} className="sk h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

/** 옮긴 줄 - 다음 커밋에서 그 줄을 따라 스크롤하고, 포커스가 있던 곳(누른 단추·줄 자신)에 다시 둔다. null이면 건드리지 않는다(⋯ 메뉴는 닫히며 ⋯ 단추로 돌린다) */
interface PendingMove {
  targetId: number;
  dir: MoveDir;
  refocus: "button" | "row" | null;
  /** 다른 칸에 놓은 줄 - 멀리 갈 수 있어 놓은 자리에서 잠깐 번쩍인다. 같은 칸 안의 옮김은 null(미끄러짐만) */
  flashIds: readonly number[] | null;
}

/** 끄는 줄 - 누른 줄과 그때의 덩어리 줄 id만 들고 간다. 칸의 줄은 move마다 지금 데이터에서 다시 읽는다(저장 응답·다시 받기로 바뀔 수 있다).
 * row·sheet는 누를 때의 줄·용지(끄는 도중 다시 그려지면 문서 id·줄 id로 다시 찾고 이것은 대신 쓴다), isLocked는 누를 때 덩어리가 칸을 떠날 수 없었나 - 흐리게 할 칸을 고르는 데만 쓴다 */
interface DragSource {
  docId: number;
  locationKey: string;
  targetId: number;
  blockIds: readonly number[];
  card: DragCard;
  row: HTMLElement;
  sheet: HTMLElement;
  isLocked: boolean;
}

/** 끄는 동안 붙이는 표시 - 놓기·취소 어느 길에서든 모두 거둔다(clearDragMarks) */
const DRAG_MARKS = ["data-drag-src", "data-drag-home", "data-drag-seen", "data-drag-closed", "data-drag-sheet", "data-drag-locked"] as const;

/** 지금 데이터의 그 칸과 덩어리 - 누른 줄이나 덩어리 줄이 그때와 다르면 null(그 끌기는 놓지 않는다) */
interface LiveDrag {
  doc: Doc;
  section: Section;
  depths: readonly number[];
  block: DragBlock;
}

function readLiveDrag(data: OutputC, source: DragSource): LiveDrag | null {
  const doc = data.docs.find((item) => item.target_doc_id === source.docId);
  const section = doc?.sections.find((item) => item.location_key === source.locationKey);
  if (!doc || !section) return null;
  const depths = getSectionDepths(section);
  const block = findLiveBlock(section.items, depths, source.targetId, source.blockIds, doc.entrance);
  return block && { doc, section, depths, block };
}

/** 표의 글 한 줄 - 표·그림은 캡션 글, 캡션 없는 그림은 표시, 캡션 없는 표는 칸 글을 잇는다 */
function readCardText(item: OutputCItem): string {
  if (item.kind === "figure") return item.caption || item.text || "[Figure]";
  return item.text || item.ai_text || item.caption || item.children.map((cell) => cell.text || cell.ai_text).join(" ");
}

/** 칸 하나의 모양 - N/A 여부와 줄 id·깊이·번호 표시. N/A가 되면 그 칸에는 놓을 수 없으므로 모양이 바뀐 것으로 친다 */
function readSectionShape(section: Section, depths: readonly number[]): string {
  const items = section.items.map((item, index) => `${item.target_id}/${depths[index]}/${item.number_style}`).join(",");
  return `${section.na_reason !== null ? "na:" : ""}${items}`;
}

/**
 * 출발 칸(과 도착 칸)의 모양 - 저장 응답은 바뀐 것이 없어도 새 칸 객체를 만들므로 같은 칸인지는 이것으로 본다.
 * 같으면 id·깊이로 적은 place 편집이 그대로 맞다. dest null = 같은 칸 안의 자리
 */
function readDropShape(live: LiveDrag, dest: Section | null): string {
  const home = readSectionShape(live.section, live.depths);
  return dest ? `${home}|${dest.location_key}:${readSectionShape(dest, getSectionDepths(dest))}` : home;
}

/** 이 문서에서 그 칸 - 없으면(다시 받기로 사라짐) null */
function findSection(doc: Doc, locationKey: string | null): Section | null {
  return locationKey === null ? null : (doc.sections.find((section) => section.location_key === locationKey) ?? null);
}

/** 그려진 줄의 상자 - 화면 순서. 읽기만 한다 */
function measureRows(section: HTMLElement): RowBox[] {
  return [...section.querySelectorAll<HTMLElement>("[data-drag-box]")].map((el) => {
    const box = el.getBoundingClientRect();
    return { targetId: Number(el.dataset.flipKey), top: box.top, bottom: box.bottom };
  });
}

/** 다른 칸에 못 놓는 사유의 표 문구 - 서버 거절 코드가 있으면 그 문구(G7). 이미 쓴 문서는 SOP·WI가 서버 코드가 다르다 */
function readRefusalKey(refusal: EnterRefusal | LeaveRefusal, docType: string): string {
  if (refusal === "na") return "rule.na_slot";
  if (refusal === "notAssignable") return "rule.slot_not_assignable";
  if (refusal === "written") return docType === "wi" ? "rule.wi_step_not_allowed" : "rule.slot_not_allowed";
  if (refusal === "translation") return "order.drag.keepTranslation";
  if (refusal === "otherPart") return "order.drag.otherPart";
  return "order.drag.otherDoc";
}

/** 깊이 한 단의 폭(px) - 글이 쓰는 --c-indent(지금 1.5em)를 그 줄의 글자 크기로 푼다. 선이 그 깊이의 줄이 시작하는 자리에서 시작하게 */
function readIndentPx(line: Element): number {
  const style = getComputedStyle(line);
  const indent = style.getPropertyValue("--c-indent").trim();
  return indent.endsWith("em") ? parseFloat(indent) * parseFloat(style.fontSize) : parseFloat(indent);
}

/** plan과 그 자리를 센 칸(들)의 모양(shape), 표에 적을 note는 마지막 move가 놓을 수 있는 자리였을 때만 있다. toKey는 다른 칸이면 그 칸 키, 같은 칸이면 null */
interface DragFrame {
  plan: DropPlan | null;
  key: string | null;
  shape: string | null;
  note: string | undefined;
  toKey: string | null;
  isGone: boolean;
}

const EMPTY_FRAME: DragFrame = { plan: null, key: null, shape: null, note: undefined, toKey: null, isGone: false };

/** 포인터 자리의 결과 - 놓을 자리(plan, 다른 칸이면 dest와 테두리를 그릴 그 칸 target)나 놓을 수 없는 곳의 표시(hover) */
type PlanResult = { plan: DropPlan; dest: Section | null; target: HTMLElement | null } | { hover: DragHover };

function isInsideBox(point: { clientX: number; clientY: number }, box: DOMRect): boolean {
  return point.clientX >= box.left && point.clientX <= box.right && point.clientY >= box.top && point.clientY <= box.bottom;
}

interface OutputCViewProps {
  data: OutputC;
  onMove?: MoveTarget;
  onIndent?: IndentTarget;
  onMark?: MarkTarget;
  onPlace?: PlaceTarget;
  /** 이어 그리기를 처음 묶음으로 되돌리는 키 - 다시 받은 C(라벨 언어·바깥 revision)일 때만 바꾼다. 저장 응답으로 맞춘 C는 그린 구간을 그대로 둔다 */
  resetKey?: string;
  /** 비었을 때 갈 곳(To-Be) - 고칠 수 있는 화면에서만 준다 */
  tobeHref?: string;
  /** "target:<새 문서 id>" → 그 문서 번호의 EQUIS 표시(결과물 B의 노드 id와 같은 열쇠) - 문서 머리에 붙인다 */
  equis?: ReadonlyMap<string, EquisInfo>;
  /** 기본 | 템플릿 보기(MD 2 S5) - 넘기면 문서 머리에 전환이 생긴다. 템플릿은 보기만 한다(줄 끝 단추 · 끌기 없음) */
  template?: OrderTemplate;
}

export interface OrderTemplate {
  on: boolean;
  onChange: (on: boolean) => void;
  titles: TemplateTitles;
  /** "번역 없음" 자리를 누름 - 없으면 자리는 읽기만 한다 */
  onMissing?: (source: OutputCItem) => void;
}

/** 문서 머리 - 번호 · 제목, 기본 | 템플릿 전환(있으면), EQUIS 표시, 문서 종류 칩. 머리가 좁으면 전환이 아이콘만 남는다(styles/template.css .c-doc-head) */
function DocHead({ doc, equis, template }: { doc: Doc; equis: EquisInfo | undefined; template?: OrderTemplate }) {
  const { t } = useI18n();
  return (
    <header className="c-doc-head flex items-baseline gap-2 border-b border-line pb-2" style={{ fontFamily: "var(--font-ui)" }}>
      <span className="font-mono text-[13px] font-semibold">{doc.code}</span>
      <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{doc.title}</span>
      {template && (
        <span className="ml-auto flex shrink-0 self-center">
          <ViewSwitch template={template.on} onChange={template.onChange} label={t("order.view")} testId="order-view" />
        </span>
      )}
      {/* 긴 제목이 먼저 감기고 표시는 제 폭을 지킨다(머리의 절반까지, 넘으면 말줄임) */}
      {equis && (
        <span className={`${template ? "" : "ml-auto "}flex max-w-[50%] shrink-0 self-center`}>
          <EquisStatus equis={equis} testId={`output-c-equis-${doc.target_doc_id}`} canEdit={false} />
        </span>
      )}
      <span className={`tag ${equis || template ? "" : "ml-auto"}`}>{doc.doc_type.toUpperCase()}</span>
    </header>
  );
}

export function OutputCView({ data, onMove, onIndent, onMark, onPlace, resetKey = "c", tobeHref, equis, template }: OutputCViewProps) {
  const { t } = useI18n();
  const isTemplate = template?.on === true;
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingMoveRef = useRef<PendingMove | null>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  // 끄는 동안 프레임마다 바뀌는 값 - 상태로 두면 프레임마다 다시 그린다. plan은 마지막 move가 같은 칸 안이었을 때만 있다(놓으면 이것을 저장).
  // shape는 그 plan을 센 칸의 모양(놓을 때 다르면 놓은 자리에서 다시 센다), isGone은 끄는 동안 덩어리가 바뀌어 이 끌기를 거절했다는 표시
  const dragFrameRef = useRef<DragFrame>(EMPTY_FRAME);
  // 화면에 그려진(커밋된) C - 끄는 동안 move마다 이것을 읽어 잰 줄과 같은 데이터로 센다. 상태를 구독하지 않는다
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  });
  // 마지막으로 옮긴 줄 - 그 줄까지는 늘 그린다(아직 그리지 않은 구간으로 옮겨도 보이게)
  const [followId, setFollowId] = useState<number | null>(null);
  const lines = useMemo(() => buildCLines(data), [data]);
  const followLine = followId === null ? 0 : Math.max(0, lines.findIndex((line) => line.kind === "item" && line.targetId === followId));
  const progressive = useProgressiveList(lines, resetKey, { minVisible: followLine + 2 });
  const blocks = groupLines(data, progressive.visible);

  // 옮긴 뒤 커밋마다 - 미끄러짐(useFlip)이 줄을 거꾸로 옮기기 전에 끝 자리를 잰다(그래서 useFlip보다 먼저 둔다)
  useLayoutEffect(() => {
    const move = pendingMoveRef.current;
    pendingMoveRef.current = null;
    const row = move && rootRef.current?.querySelector<HTMLElement>(`[data-testid="output-c-row-${move.targetId}"]`);
    if (!move || !row) return;
    if (move.refocus === "row") {
      // 글쇠로 옮겼으면 고른 줄이 그대로 고른 채로 남는다
      row.focus({ preventScroll: true });
    } else if (move.refocus === "button") {
      // 줄이 DOM에서 옮겨지면 포커스가 빠진다 - 같은 단추에, 칸 끝에 닿아 꺼졌으면 반대 단추에 둔다
      const [same, other] = move.dir < 0 ? ["up", "down"] : ["down", "up"];
      const button = row.querySelector<HTMLButtonElement>(`[data-testid="output-c-move-${same}-${move.targetId}"]`);
      const target = button && !button.disabled ? button : row.querySelector<HTMLButtonElement>(`[data-testid="output-c-move-${other}-${move.targetId}"]`);
      target?.focus({ preventScroll: true });
    }
    // 다른 칸에 놓은 줄 - 놓은 자리에서 잠깐 테두리(움직임 줄이기면 같은 시간 멈춘 테두리, components.css)
    for (const id of move.flashIds ?? []) {
      const landed = rootRef.current?.querySelector<HTMLElement>(`[data-testid="output-c-row-${id}"]`);
      if (landed) flashElement(landed);
    }
    const pane = row.closest(".overflow-auto, .overflow-y-auto");
    if (!pane) return;
    const box = row.getBoundingClientRect();
    const frame = pane.getBoundingClientRect();
    if (shouldRecenter(box.top, box.bottom, frame.top, frame.bottom)) {
      row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  });
  const flip = useFlip(rootRef);

  function handleMove(docId: number, section: Section, index: number, dir: MoveDir, refocus: PendingMove["refocus"]) {
    const item = section.items[index];
    const neighbor = section.items[index + dir];
    if (!onMove || !neighbor) return;
    // 이웃 줄이 아직 그리지 않은 구간이면 useFlip이 옮긴 줄만 잰다
    flip.capture([String(item.target_id), String(neighbor.target_id)]);
    pendingMoveRef.current = { targetId: item.target_id, dir, refocus, flashIds: null };
    setFollowId(item.target_id);
    onMove(docId, section.location_key, item.target_id, dir);
  }

  function clearDropPlan(isGone: boolean) {
    dragFrameRef.current = { ...EMPTY_FRAME, isGone };
    if (dropLineRef.current) dropLineRef.current.hidden = true;
  }

  // 지금 그려진 출발 용지 - 끄는 도중 다시 그려지면 누를 때의 요소는 떨어져 나가므로 문서 id로 다시 찾는다
  function findSheet(source: DragSource): HTMLElement {
    return rootRef.current?.querySelector<HTMLElement>(`article[data-doc-id="${source.docId}"]`) ?? source.sheet;
  }

  // 지금 그려진 그 줄 - 선의 왼쪽·폭·들여쓰기 폭을 잴 기준(같은 용지의 줄은 왼쪽·폭이 같다)
  function findRow(sheet: HTMLElement, source: DragSource): HTMLElement {
    return sheet.querySelector<HTMLElement>(`[data-testid="output-c-row-${source.targetId}"]`) ?? source.row;
  }

  // 끄는 동안의 표시(CSS가 흐리게 할 곳을 고른다) - 덩어리 줄(data-drag-src), 출발 용지(data-drag-sheet, 떠날 수 없으면 data-drag-locked), 출발 칸(data-drag-home),
  // 받을 수 없는 칸(data-drag-closed: N/A·다른 WI 부분·자리가 없는 칸, 떠날 수 없는 덩어리면 출발 칸 밖 전부). 칸마다 한 번만 정하고(data-drag-seen)
  // 끄는 도중 이어 그려진 칸·줄에도 붙인다 - 출발 칸은 요소가 아니라 키로 본다(다시 그려진 출발 칸도 출발 칸)
  function markDrag(source: DragSource, live: LiveDrag) {
    const sheet = findSheet(source);
    if (!sheet.hasAttribute("data-drag-sheet")) {
      sheet.setAttribute("data-drag-sheet", "");
      sheet.toggleAttribute("data-drag-locked", source.isLocked);
    }
    for (const id of source.blockIds) {
      const row = sheet.querySelector(`[data-testid="output-c-row-${id}"]`);
      if (row && !row.hasAttribute("data-drag-src")) row.setAttribute("data-drag-src", "");
    }
    for (const el of sheet.querySelectorAll<HTMLElement>("section[data-location-key]:not([data-drag-seen])")) {
      el.setAttribute("data-drag-seen", "");
      const key = el.dataset.locationKey ?? "";
      if (key === live.section.location_key) {
        el.setAttribute("data-drag-home", "");
        continue;
      }
      const section = findSection(live.doc, key);
      if (source.isLocked || !section || findEnterRefusal(live.section.location_key, section, true)) el.setAttribute("data-drag-closed", "");
    }
  }

  // 끄기 표시를 모두 거둔다 - 놓기·Esc·취소 어느 길에서든(onEnd). 다시 그려진 요소에도 붙었을 수 있어 틀 전체에서 찾는다
  function clearDragMarks(source: DragSource) {
    for (const scope of [rootRef.current, source.sheet]) {
      if (!scope) continue;
      for (const name of DRAG_MARKS) scope.removeAttribute(name);
      for (const el of scope.querySelectorAll(DRAG_MARKS.map((name) => `[${name}]`).join(","))) for (const name of DRAG_MARKS) el.removeAttribute(name);
    }
  }

  // 놓을 자리에 그 깊이의 줄이 시작하는 곳부터 선을 긋고, 그 자리에 놓았을 때 덩어리 첫 줄이 받을 번호를 표의 note로 돌려준다(저장 응답이 이긴다).
  // 번호는 선 위에 적지 않는다 - 용지 왼쪽 여백(30px)에는 긴 번호("10.12.3 · indent")가 들어가지 않고, 줄 위에 두면 아래 줄 글을 덮는다.
  // 다른 칸(dest)이면 그 칸에서 받을 번호만(깊이 낱말 없이), 번호가 없으면 칸 이름. 그 편집을 얹을 수 없으면 null - 선을 긋지 않고 놓지도 않는다
  function drawDropLine(source: DragSource, live: LiveDrag, plan: DropPlan, dest: Section | null): { note: string | undefined } | null {
    const shown = plan.edit ? previewEdit(live.doc, plan.edit) : live.doc;
    if (dest && !shown) return null;
    const firstId = live.section.items[live.block.start].target_id;
    const sectionKey = dest?.location_key ?? source.locationKey;
    const number = shown?.sections.find((section) => section.location_key === sectionKey)?.items.find((item) => item.target_id === firstId)?.number ?? null;
    const depthWord = plan.depth > live.block.baseDepth ? t("order.drag.indent") : plan.depth < live.block.baseDepth ? t("order.drag.outdent") : null;
    const root = rootRef.current;
    const line = dropLineRef.current;
    if (root && line) {
      const rootBox = root.getBoundingClientRect();
      const row = findRow(findSheet(source), source);
      const rowBox = row.getBoundingClientRect();
      const inset = plan.depth * readIndentPx(row.querySelector(".c-line") ?? row);
      line.style.top = `${plan.lineY - rootBox.top}px`;
      line.style.left = `${rowBox.left - rootBox.left + inset}px`;
      line.style.width = `${Math.max(0, rowBox.width - inset)}px`;
      line.hidden = false;
    }
    if (dest) return { note: `→ ${number ?? dest.label}` };
    return { note: [number !== null ? `→ ${number}` : null, depthWord].filter(Boolean).join(" · ") || undefined };
  }

  // 포인터 자리의 놓을 자리 - 출발 칸이면 칸 안 끌기, 같은 문서의 다른 칸이면 그 칸의 자리나 못 놓는 이유, 다른 용지 위는 이유, 용지·칸 밖은 표시 없음
  function planAt(source: DragSource, live: LiveDrag, point: DragPoint, start: DragPoint): PlanResult {
    const sheet = findSheet(source);
    const sheetBox = sheet.getBoundingClientRect();
    const pointer = { clientX: point.x, clientY: point.y };
    if (!isInsideBox(pointer, sheetBox)) {
      const other = [...(rootRef.current?.querySelectorAll<HTMLElement>("article[data-doc-id]") ?? [])].find((el) => el !== sheet && isInsideBox(pointer, el.getBoundingClientRect()));
      return { hover: other ? { state: "refused", note: t(readRefusalKey("otherDoc", live.doc.doc_type)), target: other } : { state: "none" } };
    }
    const sections = [...sheet.querySelectorAll<HTMLElement>("section[data-location-key]")];
    const bands = sections.map((el) => {
      const box = el.getBoundingClientRect();
      return { key: el.dataset.locationKey ?? "", band: { top: box.top, bottom: box.bottom } };
    });
    // 출발 칸은 지금 데이터의 칸 키로 - 끄는 도중 다시 그려진 출발 칸을 다른 칸으로 보지 않는다(덩어리 줄이 든 칸에 planCrossDrop을 부르지 않게)
    const found = findDropSectionByKey(point, sheetBox, bands, live.section.location_key);
    if (found === null) return { hover: { state: "none" } };
    const target = sections[found.index];
    if (found.isHome) {
      // 읽기만 한다 - 칸의 그려진 줄 가운데 덩어리 줄과 지금 칸에 없는 줄을 id로 뺀 것
      const blockTop = (target.querySelector(`[data-testid="output-c-row-${source.blockIds[0]}"]`) ?? findRow(sheet, source)).getBoundingClientRect().top;
      const plan = planDrop({
        locationKey: live.section.location_key,
        countsLines: live.section.counts_lines,
        items: live.section.items,
        depths: live.depths,
        block: live.block,
        rows: listDropRows(live.section.items, live.block, measureRows(target)),
        pointerY: point.y,
        dx: point.x - start.x,
        homeTop: blockTop - 1,
      });
      return { plan, dest: null, target: null };
    }
    const dest = findSection(live.doc, target.dataset.locationKey ?? null);
    if (!dest) return { hover: { state: "none" } };
    // 떠날 수 있는지 먼저 - 이미 쓴 문서의 줄은 어느 칸 위에서든 그 이유를 보인다
    const refusal = findLeaveRefusal(live.doc.entrance, live.section.items, live.block) ?? findEnterRefusal(live.section.location_key, dest, true);
    if (refusal) return { hover: { state: "refused", note: t(readRefusalKey(refusal, live.doc.doc_type)), target } };
    // 줄이 하나도 그려지지 않은 칸은 빈 칸 표시("–")의 위, 그것도 없으면 칸 머리 바로 아래에 선을 긋는다
    const empty = target.querySelector('[data-testid^="output-c-empty-"]');
    const emptyTop = empty ? empty.getBoundingClientRect().top : (target.querySelector("h3") ?? target).getBoundingClientRect().bottom + 1;
    const plan = planCrossDrop({
      fromKey: live.section.location_key,
      toKey: dest.location_key,
      source: { countsLines: live.section.counts_lines, items: live.section.items, depths: live.depths, block: live.block },
      dest: { countsLines: dest.counts_lines, items: dest.items, depths: getSectionDepths(dest) },
      rows: listDropRows(dest.items, null, measureRows(target)),
      pointerY: point.y,
      dx: point.x - start.x,
      emptyTop,
    });
    // 그려진 줄이 그 칸 데이터와 어긋나면 편집이 없다 - 놓을 자리 밖으로 친다
    return plan.edit ? { plan, dest, target } : { hover: { state: "none" } };
  }

  // 읽기 전용이면 null - 줄에 data-drag-box도 없다
  const dragConfig: BoxDragConfig<DragSource> = {
    pick: (event) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-drag-box]") : null;
      const home = row?.closest<HTMLElement>("section[data-location-key]");
      const sheet = home?.closest<HTMLElement>("article[data-doc-id]");
      // 다리(::after)를 누르면 줄 상자 밖인데도 그 줄이 잡힌다 - 단추를 몇 px 빗나간 누름이 끌기가 되지 않게 줄 상자 안만 받는다
      if (!row || !home || !sheet || !isInsideBox(event, row.getBoundingClientRect())) return null;
      const targetId = Number(row.dataset.flipKey);
      for (const doc of dataRef.current.docs) {
        for (const section of doc.sections) {
          const index = section.items.findIndex((item) => item.target_id === targetId);
          if (index < 0) continue;
          const block = findDragBlock(section.items, getSectionDepths(section), index, doc.entrance);
          const blockIds = section.items.slice(block.start, block.end + 1).map((item) => item.target_id);
          const card = { id: section.items[block.start].number ?? "", text: readCardText(section.items[index]), count: blockIds.length > 1 ? t("order.drag.lines", { count: blockIds.length }) : null };
          const isLocked = findLeaveRefusal(doc.entrance, section.items, block) !== null;
          return { docId: doc.target_doc_id, locationKey: section.location_key, targetId, blockIds, card, row, sheet, isLocked };
        }
      }
      return null;
    },
    getCard: ({ card }) => card,
    getScrollers: () => {
      const pane = rootRef.current?.closest<HTMLElement>(".overflow-auto, .overflow-y-auto");
      return pane ? [pane] : [];
    },
    onStart: (source) => {
      dragFrameRef.current = EMPTY_FRAME;
      // 흐리게 할 곳을 CSS가 고른다 - 다른 용지, 받을 수 없는 칸, 떠날 수 없는 덩어리면 출발 칸 밖의 모든 칸. 덩어리가 이미 바뀌었으면 첫 move가 거절한다
      const live = readLiveDrag(dataRef.current, source);
      if (live) markDrag(source, live);
    },
    onMove: (source, point, start) => {
      const live = dragFrameRef.current.isGone ? null : readLiveDrag(dataRef.current, source);
      if (!live) {
        // 끄는 동안 누른 줄·덩어리 줄이 바뀌었다(저장 응답·다시 받기) - 그린 선과 저장할 자리가 어긋나므로 이 끌기는 끝까지 놓지 않는다
        clearDropPlan(true);
        return { state: "refused", note: t("order.drag.changed") };
      }
      markDrag(source, live);
      const result = planAt(source, live, point, start);
      if ("hover" in result) {
        // 못 놓는 칸·용지 밖에서 놓으면 아무 일도 없다 - 앞서 잡은 자리를 버린다
        clearDropPlan(false);
        return result.hover;
      }
      const { plan, dest, target } = result;
      const toKey = dest?.location_key ?? null;
      const key = `${toKey}:${plan.beforeId}:${plan.depth}`;
      const shape = readDropShape(live, dest);
      const frame = dragFrameRef.current;
      // 자리와 칸 모양이 그대로면 선·번호도 그대로다 - 바뀌었을 때만 다시 그린다. 얹을 수 없는 다른 칸의 자리는 plan 없이 기억해 둔다
      if (key !== frame.key || shape !== frame.shape) {
        const drawn = drawDropLine(source, live, plan, dest);
        if (drawn) dragFrameRef.current = { plan, key, shape, note: drawn.note, toKey, isGone: false };
        else {
          clearDropPlan(false);
          dragFrameRef.current = { ...EMPTY_FRAME, key, shape };
        }
      }
      const next = dragFrameRef.current;
      return next.plan ? { state: "ok", note: next.note, target } : { state: "none" };
    },
    onDrop: (source, point, start) => {
      const frame = dragFrameRef.current;
      if (frame.isGone || !frame.plan || !onPlace) return;
      // 끄는 도중 덩어리 자체가 바뀌었으면 놓지 않는다
      const live = readLiveDrag(dataRef.current, source);
      if (!live) return;
      let edit = frame.plan.edit;
      let dest = findSection(live.doc, frame.toKey);
      // 마지막 move 뒤에 출발 칸이나 도착 칸의 모양이 바뀌었으면(포인터를 멈춘 채 저장 응답·다시 받기가 닿았다) 놓은 자리에서 지금 데이터로 다시 센다.
      // 그린 선은 바뀌기 전 화면의 자리라 다를 수 있다 - 포인터 밑의 화면이 바뀌었으니 지금 화면에서 포인터가 가리키는 자리를 저장한다
      if (readDropShape(live, dest) !== frame.shape) {
        const result = planAt(source, live, point, start);
        if ("hover" in result) return;
        edit = result.plan.edit;
        dest = result.dest;
        // 다른 칸의 자리는 지금 문서에 얹힐 때만 - 끄는 동안 그은 선과 같은 검사
        if (dest && edit && !previewEdit(live.doc, edit)) return;
      }
      if (!edit) return;
      // 잡은 줄이 앞(미끄러지는 동안 이웃 위로 지난다) - 출발 칸(과 도착 칸)의 그려진 줄을 모두 잰다
      const sheet = findSheet(source);
      const findSectionEl = (key: string) => sheet.querySelector<HTMLElement>(`section[data-location-key="${CSS.escape(key)}"]`);
      const others = [findSectionEl(live.section.location_key), dest ? findSectionEl(dest.location_key) : null].flatMap((el) => (el ? [...el.querySelectorAll<HTMLElement>("[data-drag-box]")] : [])).map((el) => el.dataset.flipKey ?? "").filter((key) => key !== String(source.targetId));
      flip.capture([String(source.targetId), ...others]);
      // dir은 단추 포커스에만 쓰인다 - 놓은 줄은 고른 채로 남는다. 다른 칸에 놓은 줄은 놓은 자리에서 번쩍인다
      pendingMoveRef.current = { targetId: source.targetId, dir: 1, refocus: "row", flashIds: dest ? edit.targetIds : null };
      setFollowId(source.targetId);
      onPlace(source.docId, edit);
    },
    onEnd: (source) => {
      clearDragMarks(source);
      clearDropPlan(false);
    },
  };
  // 빈 C는 root를 그리지 않는다 - 문서가 생기면 다시 붙도록 조건에 넣는다. 템플릿 보기는 보기만 하니 끌지 않는다
  useBoxDrag(rootRef, onPlace && data.docs.length > 0 && !isTemplate ? dragConfig : null);

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
    // c-order - 줄 끝 단추가 용지 옆에 뜨는 틀. 용지 폭 상한은 CSS가 정한다(단추 한 칸 자리를 늘 남긴다)
    <div ref={rootRef} className={`grid gap-6 p-[var(--pad)] ${onMove ? "c-order" : ""}`} data-testid="output-c">
      {/* 템플릿 보기 - 줄·번호·순서는 아래 기본 보기와 같은 C이고 그리기만 다르다. 문서 머리는 종이 밖에 두어 전환이 늘 같은 자리에 있다 */}
      {template?.on &&
        data.docs.map((doc) => (
          <article key={doc.target_doc_id} className="grid max-w-[760px] content-start gap-2" data-doc-id={doc.target_doc_id} data-testid={`output-c-template-${doc.target_doc_id}`}>
            <DocHead doc={doc} equis={equis?.get(`target:${doc.target_doc_id}`)} template={template} />
            <p className="text-xs text-ink-3" style={{ fontFamily: "var(--font-ui)" }} data-testid="order-template-note">
              {t("order.template.note")}
            </p>
            <TemplateView doc={doc} titles={template.titles} onMissing={template.onMissing} renderBlock={(item) => <CItemView item={item} />} testId="order-tpl" />
          </article>
        ))}
      {(isTemplate ? [] : blocks).map(({ doc, sections }, blockIndex) => {
        const docEquis = equis?.get(`target:${doc.target_doc_id}`);
        return (
        // data-doc-id·data-location-key·data-na - 끌기가 포인터 아래 용지·칸을 찾고 CSS가 끄는 동안 흐리게 할 칸을 고른다
        <article key={doc.target_doc_id} className={`sheet mx-0 ${onMove ? "" : "max-w-[760px]"}`} data-doc-id={doc.target_doc_id}>
          {/* 줄마다 자기 언어(lang)로 글꼴을 고른다 - 한 칸에 두 언어가 섞인다 */}
          <div className="pg">
            <DocHead doc={doc} equis={docEquis} template={template} />
            {sections.map(({ sectionIndex, itemIndexes }) => {
              const section = doc.sections[sectionIndex];
              // 깊이·의미 선은 칸 전체 줄로 센다 - 아직 그리지 않은 줄도 앞줄 기준에 든다
              const depths = getSectionDepths(section);
              const counted = listCounted(section);
              const bullets = listBullets(section);
              const starts = listMeaningStarts(section.items);
              return (
                <section key={section.location_key} className="grid gap-1" data-location-key={section.location_key} data-na={section.na_reason !== null ? "" : undefined}>
                  <h3 className="text-[13px] font-semibold text-ink-2" style={{ fontFamily: "var(--font-ui)" }} data-testid={`output-c-section-${doc.target_doc_id}-${section.location_key}`}>
                    {/* 부록은 이름("Appendix 2. 제목")에 번호가 들어 있어 번호를 따로 적지 않는다(shows_number) - 줄 번호의 머리는 그대로 section.number다 */}
                    {section.number !== null && section.shows_number && <span className="mr-1.5 font-mono">{section.number}</span>}
                    {section.label}
                    {section.deviation_reason !== null && <DeviationMark reason={section.deviation_reason} testId={`output-c-differs-${doc.target_doc_id}-${section.location_key}`} />}
                    {/* 비어 있는 필수 절 - 알림일 뿐 검토 요청을 막지 않는다(뜻은 툴팁) */}
                    {section.is_empty_required && <EmptyRequiredMark testId={`output-c-empty-required-${doc.target_doc_id}-${section.location_key}`} />}
                    {/* 칸 제목으로 간 옛 제목 - 칸 항목이 아니라 머리 옆에 흐리게. 길면 감긴다 */}
                    {section.heading_note !== "" && (
                      <span className="ml-2 font-normal text-ink-3 [overflow-wrap:anywhere]" data-testid={`output-c-heading-note-${doc.target_doc_id}-${section.location_key}`}>
                        {section.heading_note}
                      </span>
                    )}
                  </h3>
                  {section.na_reason !== null ? (
                    // 끄는 동안 칸이 흐려져도 이 줄은 그대로다(components.css) - 왜 못 놓는지를 그 칸에서 읽는다
                    <p className="text-ink-3" data-na-reason="">N/A · {section.na_reason}</p>
                  ) : section.kind === "auto_list" ? (
                    // 앱이 채우는 목록(그 SOP의 자식 WI) - 읽기만 하는 줄이라 끌기·순서·표시 단추가 없고, 줄을 받지도 않는다(findEnterRefusal).
                    // 하위만 묶는 절(group)은 그 아래 갈래처럼 머리만 그린다 - 줄을 받지 않아 빈 칸 표시("–")도 없다
                    <ul className="m-0 grid list-none gap-0.5 p-0 text-ink-2" data-testid={`output-c-auto-${doc.target_doc_id}-${section.location_key}`}>
                      {section.auto_items.length === 0 && <li className="text-ink-4">{t("outputs.autoEmpty")}</li>}
                      {section.auto_items.map((auto) => (
                        <li key={auto.code} className="[overflow-wrap:anywhere]">
                          <span className="font-mono">{auto.code}</span>
                          {auto.title !== "" && ` — ${auto.title}`}
                        </li>
                      ))}
                    </ul>
                  ) : section.kind === "group" ? null : section.items.length === 0 ? (
                    // 줄이 없는 칸 - 끌어 온 덩어리를 받으면 그 칸의 첫 줄들이 된다(놓을 선은 이 표시 위에 긋는다)
                    <p className="text-ink-4" data-testid={`output-c-empty-${doc.target_doc_id}-${section.location_key}`}>
                      –
                    </p>
                  ) : (
                    itemIndexes.map((index) => {
                      const item = section.items[index];
                      const line = (
                        <>
                          <NumberedLine item={item} depth={depths[index]}>
                            <CItemView item={item} />
                          </NumberedLine>
                          <SourceTag item={item} depth={depths[index]} />
                        </>
                      );
                      // 의미 묶음의 첫 줄 위에 굵은 선 - 칸의 첫 줄은 칸 머리가 위에 있어 긋지 않는다
                      const meaningStart = starts[index] && index > 0 ? "" : undefined;
                      if (!onMove) {
                        return (
                          <div key={item.target_id} className="c-row" data-meaning-start={meaningStart} data-flip-key={item.target_id} data-testid={`output-c-row-${item.target_id}`}>
                            {line}
                          </div>
                        );
                      }
                      const indent =
                        onIndent && canChangeDepth(doc.entrance, item)
                          ? {
                              canOut: canIndent(depths, counted, index, -1, bullets),
                              canIn: canIndent(depths, counted, index, 1, bullets),
                              onIndent: (dir: IndentDir) => onIndent(doc.target_doc_id, item.target_id, depths[index] + dir),
                            }
                          : null;
                      const actions: RowButtonsProps = {
                        items: section.items,
                        item,
                        indent,
                        onMark: onMark && canChangeStyle(doc.entrance) ? (style) => onMark(doc.target_doc_id, item.target_id, style) : null,
                        mark: readStyleChoices(section, item.number_style),
                        onMove: (dir, refocus) => handleMove(doc.target_doc_id, section, index, dir, refocus ? "button" : null),
                      };
                      return (
                        <div
                          key={item.target_id}
                          // 줄을 눌러 고르면 Alt+↑·↓가 한 자리 옮기고, 깊이를 바꿀 수 있는 줄은 Tab·Shift+Tab이 들이고 내어 쓴다. 탭 순서에는 넣지 않고(-1) Esc로 놓아 Tab이 페이지 이동을 빼앗지 않게 한다
                          tabIndex={-1}
                          // 줄 끝 단추는 호버·포커스 때만 용지 옆에 뜬다 - 넓으면 묶음(.c-acts), 좁으면 ⋯ 하나(.c-more). 자리를 차지하지 않아 글 폭과 줄 높이가 그대로다
                          className="hover-row c-row"
                          // 끌 수 있는 줄 - 단추(data-no-drag)를 뺀 줄 어디든 눌러 끈다
                          data-drag-box={onPlace ? "" : undefined}
                          data-meaning-start={meaningStart}
                          data-flip-key={item.target_id}
                          data-testid={`output-c-row-${item.target_id}`}
                          onKeyDown={(event) => {
                            // 줄 끝 단추·메뉴 안에서 올라온 글쇠는 그 요소의 몫이다
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Escape") event.currentTarget.blur();
                            const move = readMoveKey(event, { canUp: canMoveTarget(section.items, item.target_id, -1), canDown: canMoveTarget(section.items, item.target_id, 1) });
                            if (move !== null) {
                              event.preventDefault();
                              handleMove(doc.target_doc_id, section, index, move, "row");
                              return;
                            }
                            if (!indent) return;
                            // 바꿀 수 있을 때만 Tab을 가로챈다 - 아니면 포커스가 평소대로 다음 요소로 간다. 저장 중에도 바뀜은 화면에 먼저 얹는다
                            const dir = readIndentKey(event, { canOut: indent.canOut, canIn: indent.canIn, busy: false });
                            if (dir === null) return;
                            event.preventDefault();
                            indent.onIndent(dir);
                          }}
                        >
                          {line}
                          <RowButtons {...actions} />
                          <RowMenu {...actions} />
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })}
            {progressive.hasMore && blockIndex === blocks.length - 1 && <CMore sentinelRef={progressive.sentinelRef} />}
          </div>
        </article>
        );
      })}
      {/* 삭제·이동 목록은 마지막 줄까지 그린 뒤에 보인다 */}
      {!progressive.hasMore && (data.deleted.length > 0 || data.moved.length > 0) && (
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
      {/* 끌 때 놓을 자리 선 - 한 번 그리고 끄는 동안은 DOM(hidden·인라인 자리)으로만 바꾼다. 놓을 번호는 끌리는 표에 적는다 */}
      {onPlace && <div ref={dropLineRef} className="c-dropline" hidden data-testid="output-c-dropline" />}
    </div>
  );
}
