// 원문 용지 - 블록을 원문 순서대로 그리고 단위마다 누를 수 있는 조각을 둔다. 용지 안에는 추출한 글자만 둔다(앱 라벨 금지).
// 글자 조각마다 data-start(블록 안 위치)를 달아, 누른 자리·끌어 고른 범위를 블록 위치로 되돌린다.
// strips(Split·Assign)에서는 단위 하나가 종이 한 조각이다 - 확인과 상관없이 처음부터 떨어져 있고, 조각 왼쪽 밖에 앞머리(절 번호 칸, StripLead)를, 이웃한 짝은 구성원 수와 상관없이 한 카드(.strip-card)로, 보류는 글 첫머리에 상태 칩을, 오른쪽 끝에 아이콘 표시를 둔다. 절 첫 블록 글 앞의 절 번호는 번호 칸과 겹치니 그리지 않는다(표시만).
// 고른 조각은 조각(문단) 테두리로 보인다(CSS .strip[data-sel]). 앞머리 번호 칸·아이콘 표시는 포인터·포커스 툴팁으로 뜻을 알린다.
// strips.fold(Assign 필터)가 있으면 맞는 조각만 제 모양, 곁은 한 줄 판, 먼 구간은 묶음 한 줄로 접는다(paper-fold-model.ts) - 한 줄 판·묶음은 단추라 눌러도 조각을 고르지 않는다.
"use client";

import { BookMarked, ChevronRight, ChevronsDownUp, Ellipsis, FilePen, FoldVertical, GripVertical, ImageIcon, Link2, Scissors, TriangleAlert, Undo2, WandSparkles, type LucideIcon } from "lucide-react";
import { Fragment, memo, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefCallback } from "react";

import { BundleHead } from "@/components/paper/bundle-head";
import { FigureImage } from "@/components/paper/figure-image";
import { LangToken } from "@/components/paper/lang-token";
import { NumberCell, startNumberEdit, type NumberEdit } from "@/components/paper/number-cell";
import { StripBox, type StripAttrs } from "@/components/paper/strip-box";
import { StripLead, STRIP_LEAD_EXTRA } from "@/components/paper/strip-lead";
import { UnitStatusChip } from "@/components/status";
import { getMorphClassName } from "@/components/ui/morph-button";
import { Collapse } from "@/components/ui/motion";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { Select } from "@/components/ui/select";
import type { FollowItem, TableCounterpart, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { formatAssignKey } from "@/lib/assign-keymap";
import type { PendingPlace } from "@/lib/assign-focus-model";
import { getBundleShape, getCaptionScope, isSentenceLike, type BundleShape } from "@/lib/caption-slot-model";
import { readCaretPoint } from "@/lib/caret-point";
import { useDraftingOn } from "@/lib/drafting";
import { useI18n } from "@/lib/i18n";
import { CHUNK_MIN_CARDS, pickNearChunks, readChunkDeleted, readChunkNoise, readChunkNumbers, readChunkPending, sliceCards, sliceFoldEntries } from "@/lib/paper-chunk-model";
import { buildFoldPlan, type FoldEntry, type FoldItem, type FoldOpen } from "@/lib/paper-fold-model";
import { buildRows, flattenLineBreaks, getBundleHeader, getGapMerge, getItemSegments, getMarks, getTags, isBandHeading, isOtherTableCaption, MERGE_BLOCKER_KEYS, resolvePickUnit, type CaptionPiece, type FigureRowMode, type PaperItem, type PaperModel, type PaperRow, type Segment, type UnitMark } from "@/lib/paper-model";
import type { JoinKind, JoinPlan } from "@/lib/split-menu-model";
import { getHiddenEnds, listFollowPreview } from "@/lib/number-model";
import { readNumberKind, stepUnitContinuous, suggestUnitContinuous } from "@/lib/number-kind-model";
import { findBulletShift, getIndentBounds, planIndent, type IndentPlan, type IndentRow } from "@/lib/indent-model";
import { getCardTops, getHiddenPrefixLength, getPairBrackets, getPillWidth, getRowLevels, getSectionHeads, getTabWidths, getSectionLevel, getSectionPill, getVisibleSkip, sliceVisible, type PairBracket } from "@/lib/strip-pill-model";
import { buildHeadingShiftGroups, readHeadingShiftHead, type HeadingShiftGroup } from "@/lib/heading-shift-model";
import { getPairHint, type PairHint, type PairHintUnit } from "@/lib/pair-hint-model";
import { isDeletedLineOpen, readDeletedLine, type DeletedFold, type DeletedLine } from "@/lib/deleted-fold-model";
import { buildNoiseBlock, describeNoiseUnit, listNoiseBlocks, readNoiseReason, shouldJoinNoiseCard, type NoiseKind } from "@/lib/toc-block-model";
import { findUnwrapHeads, getRowUnwrapTable } from "@/lib/unwrap-model";
import { isUnwrapSuggestionUnchanged, readUnwrapMoves, type UnwrapLineMove } from "@/lib/unwrap-ai-model";
import { buildStripRows } from "@/lib/figure-spot-model";
import { findRowTable } from "@/lib/table-tab-model";
import { describeCounterpart, describeFollowItem, hasFollowChange, listCounterpartChoices, NO_COUNTERPART_VALUE, PICK_VALUE } from "@/lib/table-follow-model";
import type { TableFollowStrip } from "@/lib/use-table-follow";
import { useClickOrDouble } from "@/lib/use-click-or-double";
import { useNumberArrival, type ExpectedNumbers } from "@/lib/use-number-arrival";
import { useReleasedFolds } from "@/lib/use-released-folds";

/** 조각 끝 표시 - 단위의 것(UnitMark)에 그 조각이 놓인 블록의 경고를 더한다 */
type PaperMark = UnitMark | "warn";

const MARK_ICONS: Record<PaperMark, LucideIcon> = {
  edited: Scissors,
  pair: Link2,
  suggest: WandSparkles,
  ref: BookMarked,
  warn: TriangleAlert,
};
const MARK_ORDER: readonly PaperMark[] = ["edited", "pair", "suggest", "ref", "warn"];
const MARK_LABELS: Record<PaperMark, string> = {
  edited: "split.legendEdited",
  pair: "split.legendPair",
  suggest: "split.markSuggest",
  ref: "split.markRef",
  warn: "split.markWarn",
};

function readRowUnitId(row: PaperRow): number | null {
  return row.type === "table" ? row.item.unitId : row.unitId;
}

/** Assign의 처리 중인 일(설계 2026-11-20 D4) - shimmerIds는 빛이 지나가는 박스, lockedIds는 끌기 · 틈 단추 · 머리 단추를 받지 않는 박스, pills는 그 자리 알약 */
export interface PaperPending {
  shimmerIds: ReadonlySet<number>;
  lockedIds: ReadonlySet<number>;
  pills: readonly { id: string; kind: string; label: string; place: PendingPlace }[];
  /** 기다리는 명령의 박스 → 차례(첫째 대기 = 1) - 칩 "대기 n" */
  waits: ReadonlyMap<number, number>;
}

/** 저절로 삭제된 줄(잡음 표시가 붙은 글 조각 · 표 · 그림)의 종류 - 아니면 null. 블록으로 접는 화면(strips.noise)에서만 묻는다 */
function readNoiseKind(row: PaperRow | undefined, units: ReadonlyMap<number, ViewUnit>): NoiseKind | null {
  const unitId = row === undefined ? null : readRowUnitId(row);
  return unitId === null ? null : (units.get(unitId)?.noise_kind ?? null);
}

/** 접기에서 줄이 맞는지 볼 단위 - 표는 표 단위와 칸 안 문장 단위 모두, 표·그림은 머리 줄의 캡션 단위도 */
function listRowUnitIds(row: PaperRow, segments: ReadonlyMap<number, Segment[]>): number[] {
  const captionIds = row.type === "piece" ? [] : (row.captions ?? []).flatMap((caption) => (caption.unitId === null ? [] : [caption.unitId]));
  if (row.type !== "table") return [...(row.unitId === null ? [] : [row.unitId]), ...captionIds];
  const ids = new Set<number>(captionIds);
  if (row.item.unitId !== null) ids.add(row.item.unitId);
  for (const cell of row.item.rows.flat()) for (const segment of segments.get(cell.id) ?? []) if (segment.unitId !== null) ids.add(segment.unitId);
  return [...ids];
}

/** 접기 한 칸 - 이웃한 짝 카드의 두 줄은 한 칸 */
interface FoldCell {
  item: FoldItem;
  rows: PaperRow[];
}

/** 덩어리 한 자리 - index는 덩어리로 그리는 부분들을 넘어 문서 순서(.strip-chunk 순서)이고, 덩어리로 나누지 않으면 -1 */
interface ChunkSlot {
  index: number;
  unitIds: ReadonlySet<number>;
  rows: readonly PaperRow[];
}

/** 한 부분(머리말·본문·꼬리말)의 카드와 그 덩어리 */
interface CardGroup extends ChunkSlot {
  start: number;
  cards: PaperRow[][];
}

/** 필터로 접힌 목록의 덩어리 - before는 첫 틈의 윗줄(앞 덩어리의 끝 조각, 바로 이웃일 때만), signature가 같으면 같은 줄을 그린다 */
interface FoldGroup extends ChunkSlot {
  entries: FoldEntry[];
  before: PaperRow | undefined;
  signature: string;
}

/** 이 부분의 접기 계획 */
function planFold(items: readonly FoldItem[], matchIds: ReadonlySet<number>, open: FoldOpen, forcedIds: ReadonlySet<number>): FoldEntry[] {
  const plan = buildFoldPlan(items, matchIds, open, forcedIds);
  // 이 부분에 맞음이 없는데 고른 조각(출처 칩으로 건너옴)이 있으면 그 조각을 엿보기로 두고 둘레를 접는다 - 고른 조각은 늘 보여야 한다
  if (plan.length > 0 || !items.some((item) => item.unitIds.some((id) => forcedIds.has(id)))) return plan;
  return buildFoldPlan(items, forcedIds, open).map((entry) => (entry.kind === "full" ? { kind: "peek", key: entry.key } : entry));
}

/** 접힌 칸의 끝 줄 - 제 모양 조각(맞음 · 엿보기)이 아니면 없다(그 아래에는 틈을 두지 않는다) */
function readFoldTail(entry: FoldEntry | undefined, cellOf: ReadonlyMap<string, FoldCell>): PaperRow | undefined {
  return entry?.kind === "full" || entry?.kind === "peek" ? cellOf.get(entry.key)?.rows.at(-1) : undefined;
}

interface PaperChunkProps {
  /** 이번에 다시 그린다 - 화면 가까이 있거나 고른(방금 고른) 줄이 들었다 */
  live: boolean;
  /** 하나라도 바뀌면 먼 덩어리도 다시 그린다 - 줄 구성·글말처럼 화면 밖 DOM도 맞아야 하는 것. 글쇠마다 새 값이 되는 것은 그 덩어리 안의 것만 글로(readChunk…) */
  deps: readonly unknown[];
  /** 필터로 접힌 목록의 덩어리 */
  isFold: boolean;
  render: () => ReactNode;
}

/**
 * 긴 문서의 카드 덩어리 - 화면에서 먼 덩어리는 Paper가 다시 그려도 지난 모습 그대로 둔다. 고르기·호버로 Paper가 그려질 때마다 수천 조각을 다시 그리던 것을 화면 가까운 덩어리로 줄인다.
 * 먼 덩어리는 화면 밖이라 지난 모습이 보이지 않고, 가까워지면(live) 그 그리기에서 맞춘다. 줄은 DOM에 그대로 있어 찾기(Ctrl+F)·줄 데려오기·누르기(용지가 위임으로 듣는다)는 지금과 같다.
 * 덩어리 상자는 브라우저도 화면 밖이면 통째로 건너뛴다(CSS .strip-chunk content-visibility)
 */
/** 얼리기는 이미 먼 덩어리만 - 가까웠다가 멀어지는 그리기는 한 번 더 그려 그때의 상태(고름 풀림 등)를 담고 언다 */
export function isChunkFrozen(prev: PaperChunkProps, next: PaperChunkProps): boolean {
  return !prev.live && !next.live && prev.deps.length === next.deps.length && prev.deps.every((value, index) => value === next.deps[index]);
}

const PaperChunk = memo(
  function PaperChunk({ isFold, render }: PaperChunkProps) {
    return (
      <div className="strip-chunk" data-fold={isFold ? "" : undefined}>
        {render()}
      </div>
    );
  },
  isChunkFrozen,
);

/** 용지를 굴리는 가장 가까운 조상 - 없으면 창 */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(current).overflowY)) return current;
  }
  return null;
}

/** 줄이 놓인 첫 블록의 절 번호 - 표는 없다 */
/** 번호 칸 폭을 정하는 글 - 번호 범위가 있는 문서는 그 줄의 번호(없으면 빈 글이라 앞 줄 폭을 따른다), 옛 추출은 절 번호 */
function readRowLabel(row: PaperRow, model: PaperModel): string {
  if (!model.hasNumberRanges) return readRowSection(row);
  const unitId = readRowUnitId(row);
  return (unitId === null ? null : model.units.get(unitId)?.number?.value) ?? "";
}

function readRowSection(row: PaperRow): string {
  if (row.type === "piece") return row.parts[0]?.block.section_label ?? "";
  if (row.type === "figure") return row.block.section_label;
  // 표는 칸 블록이 가진 절을 따른다 - 이웃 조각과 같은 들여쓰기로 맞춘다
  return row.item.rows.flat().find((block) => block.section_label !== "")?.section_label ?? "";
}

export interface PaperCut {
  blockId: number;
  /** 블록 안 위치 - 여기서부터가 뒷조각 */
  offset: number;
}

/** 나눌 선을 끄는 자리 - 고른 단위 안이면 블록 위치, 단위 밖이면 어느 쪽으로 벗어났는지 */
export type CutDragPos = { blockId: number; offset: number } | "start" | "end";

/**
 * 박스 위에 화면이 얹는 표시(이미 쓴 New 문서, components/assign/new-paper) - 모두 Unit마다의 값이고 용지는 그 뜻을 모른다.
 * 여기서 그리는 값은 빠짐없이 keyOf의 글에 든다 - 화면에서 먼 덩어리는 이 글이 바뀔 때만 다시 그린다
 */
export interface PaperOverlay {
  /** 접혔다 - 그 줄 대신 renderFolded, 카드의 줄이 모두 접히면 카드도 앞 틈도 없다 */
  isFolded: (unitId: number) => boolean;
  /** 이 Unit들에 얹은 것 전부를 이은 글 - 같으면 같은 모습 */
  keyOf: (unitIds: ReadonlySet<number>) => string;
  /** 문장 박스 · 칸 조각에 더할 class · 속성과 testid - 얹을 것이 없으면 null */
  boxProps: (unitId: number) => { className?: string; attrs?: StripAttrs; testId?: string } | null;
  /** 줄 상자의 속성 */
  rowAttrs?: (unitId: number) => StripAttrs | undefined;
  /** 글 위 칩 줄 */
  renderTop: (unitId: number) => ReactNode;
  /** 글 아래 */
  renderFoot?: (unitId: number) => ReactNode;
  /** 접힌 줄의 자리 - 띠 하나 또는 null */
  renderFolded?: (unitIds: readonly number[]) => ReactNode;
  /** 글 감싸개의 속성 - 없으면 감싸지 않는다 */
  textProps?: (unitId: number) => StripAttrs | undefined;
  /** 올리면 보일 까닭(data-tip) - 표는 머리 줄에(칸 위에서는 뜨지 않게) */
  readWhy?: (unitId: number) => string | null;
}

interface PaperProps {
  model: PaperModel;
  /** 이 용지에 그릴 것 - 주면 그 한 쪽만(Split의 탭·쪽), 없으면 머리말·본문·꼬리말을 한 장에 */
  items?: readonly PaperItem[];
  selectedId: number | null;
  /** 고른 단위와 함께 가는 단위(Assign에서 고른 박스의 짝) - 고른 단위 밖의 것은 곁에 딸린 표시(data-mate, 흐린 점선 테두리)로 */
  highlightIds?: ReadonlySet<number>;
  /** 고른 단위의 한/영 짝 - 조각 바탕과 왼쪽 막대로 알린다 */
  partnerIds?: ReadonlySet<number>;
  /** 짝 맞추기로 고른 단위 */
  pickedIds?: ReadonlySet<number>;
  /** 먼저 고른 쪽의 용지다 - 다른 문서를 마지막에 눌렀다. 뿌리 표시 하나(data-held)라 덩어리를 다시 그리지 않는다 */
  held?: boolean;
  /** 나눌 자리 미리 보기(고른 단위 안) */
  cut?: PaperCut | null;
  /** 누락 의심 등 경고가 걸린 블록 - 물결 밑줄 */
  warnBlockIds?: ReadonlySet<number>;
  /** 끝난 단위는 흐리게(분류에서 확정) */
  isDone?: (unitId: number) => boolean;
  onUnitClick: (unitId: number, at: { blockId: number; offset: number } | null, event: MouseEvent) => void;
  onRangeSelect?: (range: { blockId: number; start: number; end: number }) => void;
  /** Shift+클릭이 여럿 고르기인 화면(Assign) - 끌어 고르기(onRangeSelect)를 함께 써도 Shift+클릭이 글자 선택을 늘리지 않게 한다 */
  shiftClickPicks?: boolean;
  /** 표·그림 어디를 눌러도 묶음 전체를 고른다(Assign 배정) - 칸 문장·칸 틈·칸 표시를 눌러도 표 단위로 부른다. Alt 누름은 글자 고르기라 고르지 않는다. 끄면 칸 문장을 그대로 고른다(한/영 짝 고르기, 쓴 New 문서 다듬기) */
  pickWholeBundle?: boolean;
  /** 그림을 받을 묶음·문서 - 없으면 그림 자리 상자만 */
  figureSource?: { bundleId: number; docId: number };
  /** 단위·조각·표시 testid의 앞말 */
  testId: string;
  /** 용지 자체의 testid - 한 화면에 용지가 여럿일 때(없으면 testId) */
  sheetTestId?: string;
  /** 뿌리 .pg에 더할 class */
  pageClassName?: string;
  /** 단위마다 종이 조각으로, 앞에 태그, 끝에 표시 */
  strips?: {
    /** Split - 조각 사이의 묶기(합치기냐 한/영 짝이냐는 plan이 고른다). 없으면 틈만 둔다(Assign) */
    join?: { busy: boolean; plan: (firstId: number, secondId: number) => JoinPlan; onJoin: (firstId: number, secondId: number, kind: JoinKind) => void };
    /** Assign - 보기를 다시 부르지 않아도 지금 커버 상태로 표시한다 */
    statusOf?: (unitId: number) => ViewUnit["status"] | undefined;
    /** Assign - 조각 아래 한 줄(간 곳) */
    renderNote?: (unitIds: number[]) => ReactNode;
    /** Assign - 조각 오른쪽 칸(연결 배지). 비면 폭을 차지하지 않는다 */
    renderPills?: (unitId: number) => ReactNode;
    /** Assign - 필터 접기. matchIds는 필터를 걸 때의 목록(스냅숏), 없으면 전부 그린다 */
    fold?: { matchIds: ReadonlySet<number>; open: FoldOpen; onOpenChange: (next: FoldOpen) => void };
    /** Assign - 머리 줄에 "Caption needed"를 띄울 묶음(lib/caption-model isCaptionNeeded). 없으면 캡션이 없는 묶음 모두 */
    isCaptionNeeded?: (unitId: number, hasCaption: boolean) => boolean;
    /** Assign - 연달아 오는 저절로 삭제된 줄(noise_kind)을 종류마다 흐린 블록 하나로 접는다(처음엔 접힘, MD 1 F6 · 쪼개기 먼저 §7 R3). 없으면 보통 조각으로 그린다(Split).
     *  펼침(open)과 고른 블록·줄(selected - unitId null이면 블록 전체)은 화면이 쥔다(결정 칸이 같은 것을 보인다).
     *  canEdit면 머리와 줄 끝에 사유 쓰기 · 삭제 취소가 늘 보인다 - onReason · onClear(그 단위들)로 편집 set_noise_reason · clear_noise */
    noise?: {
      canEdit: boolean;
      busy: boolean;
      onClear: (unitIds: number[]) => void;
      onReason: (unitIds: number[]) => void;
      open: ReadonlySet<number>;
      selected: { key: number; unitId: number | null } | null;
      onToggle: (key: number) => void;
      onPick: (key: number, unitId: number | null) => void;
    };
    /** Assign - 제목에서 바꾼 조항 묶음마다 첫 줄 위에 머리 "[제목 → 문장] 제목 n개를 문장 짝 m개로 · ↺ 제목으로"(F8b).
     *  canRevert면 "↺ 제목으로"가 onRevert(묶음의 바꾼 문장들)로 편집 set_heading(제목으로)을 부른다 */
    headingShift?: { canRevert: boolean; busy: boolean; onRevert: (unitIds: number[]) => void };
    /** Assign - 벗긴 표의 줄 묶음 머리에 "↺ 다시 표로"(F1). canRewrap이 거짓이면 머리 없이 왼쪽 세로선만. onRewrap(표 id)은 편집 set_layout_table(표로) */
    unwrap?: {
      canRewrap: boolean;
      busy: boolean;
      onRewrap: (tableId: number) => void;
      /** 덩이 안 줄 순서 손잡이를 그린다(짝 카드 손잡이 pairGrip이 없는 용지 - New) */
      lineGrip?: boolean;
      /** AI 순서 제안(B11) - 머리에 "✦ AI 순서 제안". enabled가 거짓이면 꺼진 단추 + 까닭. busy는 작업 중인 표, previews는 표마다 살아 있는 제안 차례(줄 id) -
       *  지금 덩이와 같은 줄 집합일 때만 그 자리에 "4 → 1" 칩과 [제안대로 놓기] [그대로 두기]를 보인다. onKeep(표 id, 같은 차례였나)은 채택 기록만 남긴다 */
      ai?: { enabled: boolean; busy: ReadonlySet<number>; previews: ReadonlyMap<number, readonly number[]>; onAsk: (tableId: number) => void; onApply: (tableId: number, order: readonly number[]) => void; onKeep: (tableId: number, isSame: boolean) => void };
      /** Old 영어 표의 짝 한글 표(11-23 명세 D2-R3) - answers는 표마다 서버의 답. 애매하거나 사람이 정했거나 짝 없다는 답이어도 후보가 있으면 머리에 "짝 표 고르기", 짝이 정해지면
       *  흐린 "표 n과 짝". onPick(표 id, 한글 표 id | null = 짝 없음)은 바로 저장한다(문서를 바꾸지 않는다) */
      follow?: {
        answers: ReadonlyMap<number, TableCounterpart>;
        onPick: (tableId: number, sourceTableId: number | null) => void;
        /** 한글 표처럼 하기(D2-R8) - 규칙 제안이 있는 표의 머리에 "한글 표처럼 하기 · n건" [적용] [하나씩 보기] [그대로 두기], 줄마다 칩(하나씩 보기면 줄 적용 단추) */
        plan?: TableFollowStrip;
      };
    };
    /** Assign - 고른 박스 바로 아래 떨어진 짝 안내 줄 "↑ 짝 KO · 위 §1"(lib/pair-hint-model). onGo(짝)는 그 박스를 고르고 그 자리로 스크롤한다.
     *  onPeek이 있으면(1단 보기) 한 번 누름은 짝 엿보기 판(onPeek), 두 번 누름이 onGo다(B7) */
    pairHint?: { onGo: (unitId: number) => void; onPeek?: (hint: PairHint) => void };
    /** Assign - 삭제로 확정한 줄을 흐린 한 줄 "DELETED · 종류 · 앞부분 글"로 접는다(lib/deleted-fold-model, 설계 D6). 접을 단위와 내용은 화면이 정한다.
     *  누르면 그 카드의 첫 단위를 고르고, 고른 동안만 펼친다(다른 박스를 고르면 다시 접힘, 둘 다 Collapse 전환). 접힌 줄은 끌기 · 틈 단추를 받지 않고 우클릭은 받는다 */
    deleted?: { folds: ReadonlyMap<number, DeletedFold> };
    /** Assign - 처리 중인 일. 잠긴 박스는 끌리지 않고 그 곁 틈 · 머리 단추가 꺼진다(고르기 · 우클릭은 화면이 막는다) */
    pending?: PaperPending;
    /** Assign - ⇧J ⇧J · ⇧K ⇧K로 무장한 합치기 - 두 박스에 점선 미리보기(data-merge-arm). 덩어리가 모두 다시 그려지는 드문 값이라 덩어리마다 견주지 않는다 */
    mergeArm?: { fromId: number; toId: number } | null;
    /** Assign - 고른 박스가 짝 전부가 이어 붙은 카드 안에 있으면 그 박스 왼쪽 가장자리에 점 여섯 손잡이(data-drag-handle, 설계 D8).
     *  손잡이 끌기(카드 안 순서)는 화면이 붙인다. isAllowed가 거짓인 박스(배정이 걸림 등)에는 그리지 않는다 */
    pairGrip?: { isAllowed: (unitId: number) => boolean };
    /** Assign 그림 탭 - 그림 카드 줄 끝 단추(위치 보기 · 지우기, 호버 · 포커스 때 보인다) */
    figureCard?: { renderActions: (unitId: number) => ReactNode };
    /** 박스 위에 화면이 얹는 표시 - 없으면 마크업이 그대로다 */
    overlay?: PaperOverlay;
  };
  /** strips에서 고른 조각의 글 바로 아래 줄(확인·짝 풀기 등 단추) - 조각 상자가 펼쳐지며 밀려 내려오고, 고름이 옮겨 가면 접힌다 */
  renderUnitActions?: (unitId: number) => ReactNode;
  /** 나눌 선 자리에 붙는 것(나누기 팝업) - 선을 끄는 동안에는 그리지 않는다 */
  renderAtCut?: () => ReactNode;
  /** 나눌 선을 끌어 옮긴다 - 주면 선에 손잡이가 붙는다 */
  onCutDrag?: (pos: CutDragPos) => void;
  /** 손잡이에서 ← →로 한 자리씩 */
  onCutNudge?: (step: 1 | -1) => void;
  onUnitDoubleClick?: (unitId: number, at: { blockId: number; offset: number } | null) => void;
  /** 문장 줄을 우클릭하거나 메뉴 글쇠를 눌렀다 - 주면 브라우저 메뉴 대신 이 콜백이 불린다(Split). false를 돌려주면 띄울 메뉴가 없어 브라우저 메뉴를 그대로 둔다 */
  onUnitContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => boolean | void;
  /** 글을 조금 긁으며 누른 것도 누르기로 친다(긁은 글은 푼다) - 글자를 골라 하는 일이 없는 용지 */
  pressThroughSelection?: boolean;
  /** Unit이 있는 조각을 끌 수 있는 상자로(data-drag-box, lib/box-drag.ts) - 끌기는 화면이 붙인다. 표 칸 조각은 표 조각이 감싸 따로 달지 않는다 */
  dragBoxes?: boolean;
  /** 번호 칸 손잡이(Assign) - 주면 번호 범위가 있는 문서의 번호 칸을 눌러 고친다. number가 null이면 번호 없음 */
  numberCell?: PaperNumberCell;
  /** 그림 줄(strips) - hide는 본문 탭(그림 · 그 캡션이 빠지고 자리 표시도 없다), only는 그림 탭(그림 카드만), 없으면 모두(시안 2 D3) */
  figureRows?: FigureRowMode;
  /** 표 줄(strips) - only는 표 탭(본문의 표만, 표마다 앞에 위치 머리 "§5 아래"), 없으면 모두(11-23 명세 E2) */
  tableRows?: "all" | "only";
  /** 위치 판(strips) - 이 줄들만 그린다. marker가 있으면 afterKey 줄 뒤(null이면 맨 위)에 그 표지(그림 자리 네모)를 끼운다 */
  spot?: { keys: ReadonlySet<string>; marker?: { afterKey: string | null; node: ReactNode } };
}

/** 고칠 수 있는 화면의 번호 칸 손잡이 */
export interface PaperNumberCell {
  busy: boolean;
  /** 저장을 기다리는 번호 - 응답 전에 먼저 보인다(A2-R6). 바뀔 때만 새 것이어야 한다(용지가 앞의 것과 견준다) */
  expected?: ExpectedNumbers;
  /** indentShift를 주면 들여쓰기 차이도 같은 편집에서(기호를 고를 때 위 기호 줄 단계를 따름) */
  onSave: (unitId: number, number: string | null, follow: boolean, indentShift?: number) => void;
  /** 번호 칸 창의 ◀ ▶ 들여쓰기(B8) - 누른 줄과 이어져 함께 바뀌는 줄(lib/indent-model planIndent). label은 누른 줄의 표시 ID */
  onIndent: (plan: IndentPlan, delta: -1 | 1, label: string) => void;
  /** 글쇠(⇧N · Tab)가 쓰는 손잡이 - 머리말 · 꼬리말은 용지가 쪽마다 따로라 여럿이 온다 */
  handleRef?: RefCallback<PaperNumberHandle>;
}

/** 글쇠로 번호 칸을 다룬다 - 그 줄이 이 용지에 없거나 번호 칸이 없으면 하지 않는다 */
export interface PaperNumberHandle {
  /** 번호 칸 창을 연다(⇧N) */
  openNumber: (unitId: number) => boolean;
  /** 번호 칸 창의 ◀ ▶ 한 번과 같은 값을 저장한다(Tab · ⇧Tab) - end는 더 갈 단계가 없다. shifts는 아직 보기에 없는 들여쓰기 차이(저장 중) */
  requestIndent: (unitId: number, delta: -1 | 1, shifts?: ReadonlyMap<number, number>) => "done" | "end" | null;
}

/** 화면 좌표 → 블록 위치. 글자 조각 요소의 data-start에 글자 노드 안 위치를 더한다 */
function readCaret(x: number, y: number): { blockId: number; offset: number } | null {
  const caret = readCaretPoint(x, y);
  return caret ? readNodeOffset(caret.node, caret.offset) : null;
}

function readNodeOffset(node: Node, nodeOffset: number): { blockId: number; offset: number } | null {
  const piece = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>("[data-start]");
  const block = piece?.closest<HTMLElement>("[data-block]");
  if (!piece || !block) return null;
  return { blockId: Number(block.dataset.block), offset: Number(piece.dataset.start) + (node.nodeType === Node.TEXT_NODE ? nodeOffset : 0) };
}

/** 끄는 자리 → 고른 단위 기준 자리. 글자 위가 아니면 단위의 위·아래 어느 쪽인지로 답한다 */
function readDragPos(page: HTMLElement, unitId: number, x: number, y: number): CutDragPos | null {
  const own = Array.from(page.querySelectorAll<HTMLElement>(`.su[data-unit="${unitId}"]`));
  if (own.length === 0) return null;
  const caret = readCaret(x, y);
  if (caret && own.some((element) => element.querySelector(`[data-start]`) !== null && element.closest(`[data-block="${caret.blockId}"]`) !== null)) {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(".su[data-unit]");
    if (!hit || Number(hit.dataset.unit) === unitId) return caret;
    // 다른 단위 위 - 문서 순서로 앞이면 처음, 뒤면 끝
    return hit.compareDocumentPosition(own[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? "start" : "end";
  }
  const rects = own.flatMap((element) => Array.from(element.getClientRects()));
  if (rects.length === 0) return null;
  if (y < Math.min(...rects.map((rect) => rect.top))) return "start";
  if (y > Math.max(...rects.map((rect) => rect.bottom))) return "end";
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(".su[data-unit]");
  if (hit && Number(hit.dataset.unit) !== unitId) return hit.compareDocumentPosition(own[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? "start" : "end";
  return null;
}

export function Paper({
  model,
  items,
  selectedId,
  highlightIds,
  partnerIds,
  pickedIds,
  held = false,
  cut,
  warnBlockIds,
  isDone,
  onUnitClick,
  onRangeSelect,
  shiftClickPicks = false,
  pickWholeBundle = false,
  figureSource,
  testId,
  sheetTestId,
  pageClassName,
  strips,
  renderUnitActions,
  renderAtCut,
  onCutDrag,
  onCutNudge,
  onUnitDoubleClick,
  onUnitContextMenu,
  pressThroughSelection = false,
  dragBoxes = false,
  numberCell,
  figureRows,
  tableRows = "all",
  spot,
}: PaperProps) {
  const { t } = useI18n();
  // 나누기 제안을 숨긴 동안 줄 끝 표시도 내지 않는다
  const showSplitMark = useDraftingOn() === true;
  // 고치는 중인 번호 칸 - 한 번에 한 줄. 따라 바뀔 번호는 다른 줄의 번호 칸에 점선으로 미리 보인다
  const [numberEdit, setNumberEdit] = useState<NumberEdit | null>(null);
  // 편집 뒤 번호 칸이 새로 생긴 박스 - 번호 칸이 옅은 강조로 들어오는 전환(항목 6-b). 번호 고치기는 누른 순간 기대 글로 시작한다
  const { shown: numberUnits, arrived: arrivedNumbers } = useNumberArrival(model.units, numberCell?.expected);
  // 다음 번호 셈 · 따라 바뀔 번호도 보이는 번호(기대 글 포함)로
  const numberOrder = useMemo(() => {
    const startOf = (unit: ViewUnit) => unit.spans[0]?.[1] ?? -1;
    return [...numberUnits.values()].sort((a, b) => a.pos_seq - b.pos_seq || startOf(a) - startOf(b) || a.id - b.id);
  }, [numberUnits]);
  const followed = useMemo(() => {
    if (!numberEdit || !numberEdit.follow) return [];
    return listFollowPreview(numberOrder, numberEdit.unitId, numberEdit.text);
  }, [numberEdit, numberOrder]);
  const previewOf = useMemo(() => new Map(followed.map((item) => [item.unitId, item])), [followed]);
  const releasedFolds = useReleasedFolds(strips?.deleted?.folds);
  const unreadBlockIds = useMemo(() => {
    const ids = new Set<number>();
    for (const item of [...model.header, ...model.body, ...model.footer]) {
      if (item.type === "block" && item.block.flags.includes("auto_numbering")) ids.add(item.block.id);
    }
    return ids;
  }, [model]);
  const pageRef = useRef<HTMLDivElement>(null);
  // 첫 누름 때 누른 조각과 그 높이 - 고르자마자 곁 틈이 벌어져 글이 밀려도 두 번 누름(나눌 자리)을 처음 누른 글자로 되돌린다
  const pressRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const tip = useDelegatedTip();
  const hasStrips = strips !== undefined;
  const overlay = strips?.overlay;
  // 단추 줄을 그리는 조각 - 지금 고른 것과 바로 전에 고른 것(접히는 동안). 수천 조각마다 접기 부품을 두지 않는다
  const [actionIds, setActionIds] = useState({ current: selectedId, previous: null as number | null });
  if (actionIds.current !== selectedId) setActionIds({ current: selectedId, previous: actionIds.current });
  // 저절로 삭제된 줄의 블록 - 펼침·고름은 화면(strips.noise)이 쥔다
  const hasNoise = strips?.noise !== undefined;
  // 줄 → 그 줄이 든 블록(용지 줄이 없는 안쪽 표 · 칸 안 그림까지)
  const noiseBlockOf = useMemo(() => new Map(hasNoise ? listNoiseBlocks([...model.units.values()]).flatMap((block) => block.unitIds.map((id) => [id, block] as const)) : []), [model, hasNoise]);
  // 제목 → 문장 묶음 - 첫 단위 → 묶음(그 줄이 든 카드 위에 머리를 단다)
  const hasHeadingShift = strips?.headingShift !== undefined;
  const shiftGroups = useMemo(() => {
    const map = new Map<number, HeadingShiftGroup>();
    if (!hasHeadingShift) return map;
    for (const group of buildHeadingShiftGroups(model.units.values())) map.set(group.firstUnitId, group);
    return map;
  }, [hasHeadingShift, model]);

  // 조각 줄 - 모델이 바뀔 때만 다시 편다(고르기·확인으로는 그대로)
  const sections = useMemo(() => {
    if (!hasStrips) return [];
    const lists: Array<{ edge: "top" | "bottom" | null; items: readonly PaperItem[] }> = items
      ? [{ edge: null, items }]
      : [
          { edge: "top", items: model.header },
          { edge: null, items: model.body },
          { edge: "bottom", items: model.footer },
        ];
    // 벗긴 표 덩이 안은 사람이 바꾼 순서(unwrap_seq, lib/unwrap-model) 뒤에, 이어 붙은 짝 카드 안은 사람이 바꾼 순서(pair_seq)로 - 떨어진 구성원은 제자리(lib/pair-order-model)
    // 표 탭은 본문의 표 줄만(벗긴 표의 줄 · 띠 표 제목 줄 · 안쪽 표는 바깥 표의 것)
    const tableIds = new Set(model.tableBlocks.map((block) => block.tableId));
    const isShownRow = (row: PaperRow) => tableRows === "all" || tableIds.has(findRowTable(row, model.tables) ?? -1);
    return lists.filter((list) => list.items.length > 0).map((list) => ({
      edge: list.edge,
      // 그림 줄 - 본문 탭은 빼고 그림 탭은 그것만(시안 2 D3). 위치 판은 그 그림 앞뒤 줄만
      rows: buildStripRows(list.items, model, figureRows).filter((row) => (!spot || spot.keys.has(row.key)) && isShownRow(row)),
    }));
  }, [hasStrips, items, model, figureRows, tableRows, spot]);
  // 짝 - 단위 → 같은 짝의 다른 구성원(원문 순서, 떨어진 구성원 포함). 한 카드는 아래 brackets가 정한다(같은 쪽·같은 부분의 끊김 없는 줄만)
  const matesOf = useMemo(() => {
    const byPair = new Map<number, ViewUnit[]>();
    for (const unit of model.units.values()) {
      if (unit.pair_id === null) continue;
      byPair.set(unit.pair_id, [...(byPair.get(unit.pair_id) ?? []), unit]);
    }
    const map = new Map<number, ViewUnit[]>();
    for (const members of byPair.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => a.pos_seq - b.pos_seq);
      for (const member of members) map.set(member.id, members.filter((other) => other.id !== member.id));
    }
    return map;
  }, [model]);
  const brackets = useMemo(() => {
    const map = new Map<number, PairBracket>();
    for (const section of sections) {
      const entries = section.rows.map((row) => {
        const unitId = readRowUnitId(row);
        return { unitId: unitId ?? -1, groupId: unitId === null ? null : (model.units.get(unitId)?.pair_id ?? null) };
      });
      for (const [unitId, bracket] of getPairBrackets(entries)) map.set(unitId, bracket);
    }
    return map;
  }, [sections, model]);
  // 카드의 둘째 줄부터 → 첫 줄 단위 - 번호 칸 폭·절 머리·틈 판정의 기준
  const cardTops = useMemo(() => {
    const order = sections.flatMap((section) => section.rows.map((row) => readRowUnitId(row) ?? -1));
    return getCardTops(order, brackets);
  }, [sections, brackets]);
  // 부분마다 카드와 덩어리 - 긴 부분만 덩어리로 나눈다(paper-chunk-model, PaperChunk)
  const cardGroups = useMemo(() => {
    let nextIndex = 0;
    return sections.map((section) => {
      const cards: PaperRow[][] = [];
      for (const row of section.rows) {
        const last = cards[cards.length - 1];
        // 연달아 오는 같은 종류의 저절로 삭제된 줄은 한 카드(블록) - 덩어리 나누기가 블록을 가르지 않는다
        const joinsNoise = hasNoise && shouldJoinNoiseCard(readNoiseKind(last?.[last.length - 1], model.units), readNoiseKind(row, model.units));
        if (last && (cardTops.has(readRowUnitId(row) ?? -1) || joinsNoise)) last.push(row);
        else cards.push([row]);
      }
      const { isChunked, slices } = sliceCards(cards.length);
      const groups: CardGroup[] = slices.map(({ start, count }) => {
        const slice = cards.slice(start, start + count);
        const rows = slice.flat();
        const unitIds = new Set(rows.flatMap((row) => listRowUnitIds(row, model.segments)));
        return { index: isChunked ? nextIndex++ : -1, start, cards: slice, unitIds, rows };
      });
      return { cards, groups, isChunked };
    });
  }, [sections, cardTops, model, hasNoise]);
  // 접기 칸 - 부분마다 문서 순서로, 이웃한 짝 카드는 한 칸(첫 줄 key)
  const hasFold = strips?.fold !== undefined;
  const foldCells = useMemo(() => {
    if (!hasFold) return [];
    return sections.map((section) => {
      const cells: FoldCell[] = [];
      for (let index = 0; index < section.rows.length; index += 1) {
        const row = section.rows[index];
        const rows = [row];
        if (brackets.get(readRowUnitId(row) ?? -1) === "top") {
          while (index + 1 < section.rows.length && cardTops.has(readRowUnitId(section.rows[index + 1]) ?? -1)) {
            index += 1;
            rows.push(section.rows[index]);
          }
        }
        cells.push({ item: { key: row.key, unitIds: rows.flatMap((one) => listRowUnitIds(one, model.segments)), section: readRowSection(row) }, rows });
      }
      return cells;
    });
  }, [hasFold, sections, brackets, cardTops, model]);
  // 접혀 있어도 늘 펼쳐 보일 단위 - 고른 단위와 그 짝 구성원 모두(이웃하지 않은 구성원도). 출처 칩 등으로 필터 밖 단위를 고르면 저절로 엿보기가 된다
  const foldForced = useMemo(() => {
    const ids = new Set<number>();
    if (selectedId === null) return ids;
    ids.add(selectedId);
    for (const mate of matesOf.get(selectedId) ?? []) ids.add(mate.id);
    return ids;
  }, [selectedId, matesOf]);
  // 접기 계획 - 고를 때마다 다시 세지만 같은 계획이면 같은 글이라, 고른 조각이 맞음인 동안 아래 덩어리는 그대로다
  const foldMatchIds = strips?.fold?.matchIds;
  const foldOpen = strips?.fold?.open;
  const foldPlanKey = useMemo(
    () => (foldMatchIds && foldOpen ? JSON.stringify(foldCells.map((cells) => planFold(cells.map((cell) => cell.item), foldMatchIds, foldOpen, foldForced))) : "[]"),
    [foldCells, foldMatchIds, foldOpen, foldForced],
  );
  const foldGroups = useMemo(() => {
    let nextIndex = 0;
    return (JSON.parse(foldPlanKey) as FoldEntry[][]).map((plan, sectionIndex) => {
      const cellOf = new Map(foldCells[sectionIndex].map((cell) => [cell.item.key, cell]));
      // 덩어리로 그릴지는 접기 전 칸 수로 - 펼침 · 엿보기로 계획이 길어지고 짧아져도 맨 목록과 덩어리 사이를 오가지 않는다(오가면 모든 줄이 다시 마운트된다)
      const isChunked = foldCells[sectionIndex].length >= CHUNK_MIN_CARDS;
      const groups: FoldGroup[] = sliceFoldEntries(plan).map(({ start, count }) => {
        const entries = plan.slice(start, start + count);
        const cells = entries.flatMap((entry) => ("key" in entry ? (cellOf.get(entry.key) ?? []) : []));
        return {
          index: isChunked ? nextIndex++ : -1,
          entries,
          signature: JSON.stringify([plan[start - 1], entries]),
          unitIds: new Set(cells.flatMap((cell) => cell.item.unitIds)),
          rows: cells.flatMap((cell) => cell.rows),
          before: readFoldTail(plan[start - 1], cellOf),
        };
      });
      return { cellOf, groups, isChunked };
    });
  }, [foldPlanKey, foldCells]);
  // 지금 그리는 덩어리 - .strip-chunk 순서(index 순서)
  const chunks = useMemo<ChunkSlot[]>(
    () => (hasFold ? foldGroups.flatMap((section) => (section.isChunked ? section.groups : [])) : cardGroups.flatMap((section) => (section.isChunked ? section.groups : []))),
    [hasFold, foldGroups, cardGroups],
  );
  const chunkCount = chunks.length;
  // 화면 가까이(위아래 한 화면씩 더) 있는 덩어리 번호 범위 - 재기 전(null)에는 모두 가깝다고 본다
  const [nearChunks, setNearChunks] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    const page = pageRef.current;
    if (!page || chunkCount === 0) return;
    const scroller = findScrollParent(page);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const { from, to } = pickNearChunks(Array.from(page.querySelectorAll<HTMLElement>(".strip-chunk"), (chunk) => chunk.getBoundingClientRect()), view);
      setNearChunks((prev) => (prev?.from === from && prev.to === to ? prev : { from, to }));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    schedule();
    const target = scroller ?? window;
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 확대·폭 바꿈으로 줄 높이가 바뀌면 덩어리 자리도 바뀐다
    const observer = new ResizeObserver(schedule);
    observer.observe(page);
    return () => {
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [chunkCount]);
  // 고른 줄과 방금 고른 줄(단추 줄이 접히는 동안)이 든 덩어리 - 그 앞뒤 덩어리도 함께 그린다(덩어리 첫 틈이 앞 덩어리 끝 줄의 고름을 따른다).
  // 번호를 치는 줄도 같다 - 입력이 먼(얼린) 덩어리로 스크롤되어 들어가도 글자·점선 미리 보기가 계속 다시 그려진다
  const numberEditUnitId = numberEdit?.unitId ?? null;
  // 고치는 줄의 연속 번호 값 - 번호 칸 창의 "연속 번호"가 채운다(같은 목록 후보에서 센다, number-kind-model)
  const continuous = useMemo(() => (numberEditUnitId === null ? null : suggestUnitContinuous(numberOrder, numberEditUnitId)), [numberEditUnitId, numberOrder]);
  const liveChunkIds = useMemo(() => {
    const ids = new Set<number>();
    for (const chunk of chunks) {
      if ([selectedId, actionIds.previous, numberEditUnitId].some((id) => id !== null && chunk.unitIds.has(id))) for (const index of [chunk.index - 1, chunk.index, chunk.index + 1]) ids.add(index);
    }
    return ids;
  }, [chunks, selectedId, actionIds.previous, numberEditUnitId]);

  // 고른 조각 곁 틈을 벌릴 조각 - 이웃한 짝은 한 카드라 고른 줄이 카드 어디에 있든 카드 위아래가 같이 벌어진다
  const selectedBlock = useMemo(() => {
    const ids = new Set<number>();
    if (selectedId === null) return ids;
    ids.add(selectedId);
    if (!brackets.has(selectedId)) return ids;
    const top = cardTops.get(selectedId) ?? selectedId;
    ids.add(top);
    for (const [id, cardTop] of cardTops) if (cardTop === top) ids.add(id);
    return ids;
  }, [selectedId, brackets, cardTops]);
  // 고른 박스의 떨어진 짝 - 이어 붙은 카드 안의 구성원은 바로 곁이라 안내하지 않는다. 자리 이름은 번호 칸 값(옛 추출은 절 번호), 없으면 표시 ID
  const hasPairHint = strips?.pairHint !== undefined;
  const handlePairHintPress = useClickOrDouble();
  const pairHint = useMemo(() => {
    const mates = selectedId === null ? undefined : matesOf.get(selectedId);
    const selected = selectedId === null ? undefined : model.units.get(selectedId);
    if (!hasPairHint || !mates || !selected) return null;
    const orderAt = new Map(model.order.map((id, at) => [id, at]));
    const labels = new Map(sections.flatMap((section) => section.rows.map((row) => [readRowUnitId(row) ?? -1, readRowLabel(row, model)] as const)));
    const toHintUnit = (unit: ViewUnit): PairHintUnit | null => {
      const at = orderAt.get(unit.id) ?? (unit.group_unit_id === null ? undefined : orderAt.get(unit.group_unit_id));
      if (at === undefined) return null;
      const label = labels.get(unit.id) ?? "";
      const where = model.hasNumberRanges ? label : (getSectionPill(label) ?? "");
      return { id: unit.id, lang: unit.lang, at, card: brackets.has(unit.id) ? (cardTops.get(unit.id) ?? unit.id) : null, label: where ? `§${where}` : unit.display_id };
    };
    const own = toHintUnit(selected);
    return own === null ? null : getPairHint(own, mates.flatMap((mate) => toHintUnit(mate) ?? []));
  }, [hasPairHint, selectedId, matesOf, model, sections, brackets, cardTops]);
  // 절 번호를 보일 첫 줄 - 부분(머리글·본문·바닥글)마다 문서 순서로
  const sectionHeads = useMemo(() => {
    const heads = new Set<number>();
    for (const section of sections) {
      const units = section.rows.flatMap((row) => {
        const unitId = readRowUnitId(row);
        if (row.type === "table" || unitId === null) return [];
        return [{ unitId, part: section.edge ?? "body", sectionLabel: readRowSection(row), pairTopOf: cardTops.get(unitId) ?? null }];
      });
      for (const unitId of getSectionHeads(units)) heads.add(unitId);
    }
    return heads;
  }, [sections, cardTops]);
  // 줄마다 단계와 번호 칸 폭 - 셈한 단계(번호 깊이 · 기호 단계 · 기댄 줄 단계)에 저장된 들여쓰기 차이를 더한다(B8), 짝 카드는 첫 줄(부분마다 문서 순서로)
  const indentRows = useMemo<IndentRow[]>(
    () =>
      sections.flatMap((section) =>
        section.rows.map((row) => {
          const unitId = readRowUnitId(row);
          const unit = unitId === null ? undefined : model.units.get(unitId);
          const topId = unitId === null ? undefined : cardTops.get(unitId);
          const topRow = topId === undefined ? undefined : section.rows.find((candidate) => readRowUnitId(candidate) === topId);
          return { key: row.key, unitId, part: section.edge ?? "body", sectionLabel: readRowLabel(row, model), pairTopOf: topRow?.key ?? null, shift: unit?.indent_shift ?? 0, hasCell: (unit?.number ?? null) !== null };
        }),
      ),
    [sections, cardTops, model],
  );
  const rowLevels = useMemo(() => getRowLevels(indentRows), [indentRows]);
  const tabWidths = useMemo(() => getTabWidths(indentRows, rowLevels), [indentRows, rowLevels]);
  // 고치는 중인 번호 칸 줄의 용지 줄 key - ◀ ▶ 끝과 일괄 범위를 그 줄에서 잰다
  const numberEditKey = useMemo(() => (numberEditUnitId === null ? null : (indentRows.find((row) => row.unitId === numberEditUnitId)?.key ?? null)), [indentRows, numberEditUnitId]);
  const numberEditIndent = useMemo(() => (numberEditKey === null ? undefined : getIndentBounds(indentRows, rowLevels, numberEditKey)), [indentRows, rowLevels, numberEditKey]);
  const numberEditBulletShift = useMemo(() => (numberEditKey === null ? null : findBulletShift(indentRows, numberEditKey)), [indentRows, numberEditKey]);
  function findNumberRow(unitId: number) {
    const row = indentRows.find((item) => item.unitId === unitId);
    const unit = numberUnits.get(unitId);
    return numberCell && model.hasNumberRanges && row && unit?.number ? { key: row.key, unit, number: unit.number } : null;
  }

  function openNumber(unitId: number): boolean {
    const found = findNumberRow(unitId);
    if (found) setNumberEdit(startNumberEdit(unitId, found.number.value));
    return found !== null;
  }

  function requestIndent(unitId: number, delta: -1 | 1, shifts?: ReadonlyMap<number, number>): "done" | "end" | null {
    const found = findNumberRow(unitId);
    if (!found) return null;
    if (readNumberKind(found.number.value) === "continuous") {
      const next = stepUnitContinuous(numberOrder, unitId, found.number.value ?? "", delta);
      // 창을 열어 고칠 때와 같이 뒤 번호도 따라 고친다(연속 번호의 처음 값)
      if (next !== null) numberCell?.onSave(unitId, next, true);
      return next === null ? "end" : "done";
    }
    const rows = shifts === undefined || shifts.size === 0 ? indentRows : indentRows.map((row) => ({ ...row, shift: shifts.get(row.unitId ?? -1) ?? row.shift }));
    const plan = planIndent(rows, rows === indentRows ? rowLevels : getRowLevels(rows), found.key, delta);
    if (plan) numberCell?.onIndent(plan, delta, found.unit.display_id);
    return plan ? "done" : "end";
  }

  useImperativeHandle(numberCell?.handleRef, () => ({ openNumber, requestIndent }));
  // 벗긴 표의 줄 덩이마다 첫 줄 - 그 줄 위에 묶음 머리("↺ 다시 표로")를 단다(F1). 부분마다 문서 순서로
  const unwrapHeads = useMemo(() => new Map(sections.flatMap((section) => [...findUnwrapHeads(section.rows, model.unwrapped, model.tables)])), [sections, model]);
  // 덩어리마다 그 안에서 보이는 단위와 표 - 제 줄에, 머리가 잠금을 묻는 단위(제목 → 문장 묶음, 벗긴 표의 줄, 저절로 삭제된 블록의 줄 - 다른 덩어리에 걸쳐 있거나 용지 줄이 없어도)를 더한다
  const chunkScopes = useMemo(
    () =>
      chunks.map((chunk) => {
        const unitIds = new Set(chunk.unitIds);
        const tableIds = new Set<number>();
        const headTableIds = new Set<number>();
        for (const row of chunk.rows) {
          for (const id of shiftGroups.get(readRowUnitId(row) ?? -1)?.unitIds ?? []) unitIds.add(id);
          for (const id of noiseBlockOf.get(readRowUnitId(row) ?? -1)?.unitIds ?? []) unitIds.add(id);
          if (row.type === "table") tableIds.add(row.item.table.id);
          const headTableId = unwrapHeads.get(row.key);
          if (headTableId !== undefined) headTableIds.add(headTableId);
        }
        if (headTableIds.size > 0) for (const unit of model.units.values()) if (unit.table_id !== null && headTableIds.has(unit.table_id)) unitIds.add(unit.id);
        return { unitIds, tableIds: new Set([...tableIds, ...headTableIds]) };
      }),
    [chunks, model, shiftGroups, noiseBlockOf, unwrapHeads],
  );
  const pending = strips?.pending;
  const chunkPending = useMemo(() => chunkScopes.map(({ unitIds, tableIds }) => readChunkPending(pending, unitIds, tableIds)), [chunkScopes, pending]);
  const deletedFolds = strips?.deleted?.folds;
  // 풀린 것(releasedFolds)은 그 단위의 접힘이 바뀐 그 그리기에서만 바뀌어 따로 견주지 않는다
  const chunkDeleted = useMemo(() => chunkScopes.map(({ unitIds }) => readChunkDeleted(deletedFolds, unitIds)), [chunkScopes, deletedFolds]);
  const expectedNumbers = numberCell?.expected;
  const chunkNumbers = useMemo(() => chunkScopes.map(({ unitIds }) => readChunkNumbers(expectedNumbers, unitIds)), [chunkScopes, expectedNumbers]);
  const noiseOpen = strips?.noise?.open;
  const noiseSelected = strips?.noise?.selected;
  const chunkNoise = useMemo(() => chunkScopes.map(({ unitIds }) => readChunkNoise(noiseOpen, noiseSelected, unitIds)), [chunkScopes, noiseOpen, noiseSelected]);
  // 벗긴 표 덩이의 지금 줄 차례(표 id → 줄 id) - model.order가 사람이 바꾼 순서(unwrap_seq)를 이미 따른다
  const unwrapOrders = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const id of model.order) {
      const tableId = model.unwrapLines.get(id);
      if (tableId !== undefined) map.set(tableId, [...(map.get(tableId) ?? []), id]);
    }
    return map;
  }, [model]);
  // AI 순서 제안 미리 보기 - 줄마다 "지금 → 제안" 자리. 지금 덩이와 줄 집합이 다른(낡은) 제안은 빈 표라 칩이 서지 않는다
  const unwrapAiPreviews = strips?.unwrap?.ai?.previews;
  const unwrapAiMoves = useMemo(() => {
    const all = new Map<number, UnwrapLineMove>();
    for (const [tableId, suggested] of unwrapAiPreviews ?? []) for (const [id, move] of readUnwrapMoves(unwrapOrders.get(tableId) ?? [], suggested)) all.set(id, move);
    return all;
  }, [unwrapAiPreviews, unwrapOrders]);
  // 한글 표처럼 하기의 줄 칩 - 일의 첫 줄(합칠 줄은 그 첫 줄) → (표, 일)
  const followPlans = strips?.unwrap?.follow?.plan?.plans;
  const followRows = useMemo(() => {
    const map = new Map<number, { tableId: number; item: FollowItem }>();
    for (const [tableId, plan] of followPlans ?? []) for (const item of plan.items) if (hasFollowChange(item)) map.set(item.unit_ids[0], { tableId, item });
    return map;
  }, [followPlans]);
  // 표 칸 안의 조각 줄 - 칸이 많은 표에서 고를 때마다 다시 펴지 않게
  const cellRows = useMemo(() => {
    const map = new Map<number, PaperRow[]>();
    if (!hasStrips) return map;
    for (const item of items ?? [...model.header, ...model.body, ...model.footer]) {
      if (item.type !== "table") continue;
      for (const row of item.rows) {
        for (const cell of row) map.set(cell.id, buildRows([{ type: "block", block: cell }], model.segments).filter((piece) => !isOtherTableCaption(piece, cell, model.units)));
      }
    }
    return map;
  }, [hasStrips, items, model]);

  // 나눌 선이 글 시작 가까이면 가운데 맞춤 팝업이 용지 왼쪽 밖으로 나가 옆 목록에 가려진다 - 용지 안으로 밀어 넣는다(화살표는 선에 남는다)
  useLayoutEffect(() => {
    const page = pageRef.current;
    const pop = page?.querySelector<HTMLElement>(".cut-pop");
    if (!page || !pop) return;
    const nudge = () => {
      pop.style.setProperty("--pop-dx", "0px");
      const bounds = page.getBoundingClientRect();
      const rect = pop.getBoundingClientRect();
      const dx = rect.left < bounds.left + 4 ? bounds.left + 4 - rect.left : rect.right > bounds.right - 4 ? bounds.right - 4 - rect.right : 0;
      if (dx !== 0) pop.style.setProperty("--pop-dx", `${dx}px`);
    };
    nudge();
    window.addEventListener("resize", nudge);
    return () => window.removeEventListener("resize", nudge);
  }, [cut, isDragging, selectedId, items]);

  // 나눌 선 끌기 - 선이 조각을 넘나들며 다시 그려져도 끊기지 않게 창에서 듣는다
  const handleDragMove = useEffectEvent((event: PointerEvent) => {
    const page = pageRef.current;
    if (!page || selectedId === null || !onCutDrag) return;
    const pos = readDragPos(page, selectedId, event.clientX, event.clientY);
    if (pos !== null) onCutDrag(pos);
  });
  useEffect(() => {
    if (!isDragging) return;
    const move = (event: PointerEvent) => handleDragMove(event);
    const stop = () => setIsDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [isDragging]);

  function handleHandleDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); // 글자가 끌려 골라지지 않게
    window.getSelection()?.removeAllRanges();
    setIsDragging(true);
  }

  function handleHandleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    onCutNudge?.(event.key === "ArrowRight" ? 1 : -1);
  }

  /** 글자 조각 하나. skip = 블록 앞에서 숨길 글자 수(절 첫 블록의 앞 번호 - 표시만, data-start는 숨긴 만큼 밀린 원문 위치) */
  function renderSegment(block: ViewBlock, original: Segment, index: number, skip = 0): ReactNode {
    const visible = sliceVisible(original.start, original.end, skip);
    if (visible === null) return null;
    const segment = { ...original, ...visible };
    const text = block.text.slice(segment.start, segment.end);
    if (segment.unitId === null) {
      return (
        <span key={index} data-start={segment.start}>
          {text}
        </span>
      );
    }
    const unit = model.units.get(segment.unitId);
    // 여러 범위에 걸친 단위는 범위의 첫 자리도 나눌 자리다(>=). 숨긴 앞머리 안의 자리는 앞 조각을 그리지 않는다(cut-a가 빈 글)
    const isCutHere = cut && cut.blockId === block.id && cut.offset >= original.start && cut.offset < segment.end && segment.unitId === selectedId;
    return (
      <span key={index} className="contents">
        <span
          className="su"
          lang={unit?.lang === "neutral" ? undefined : unit?.lang}
          data-unit={segment.unitId}
          data-testid={`${testId}-unit-${segment.unitId}`}
          data-sel={segment.unitId === selectedId ? "" : undefined}
          data-mate={isMate(segment.unitId) ? "" : undefined}
          data-pick={pickedIds?.has(segment.unitId) ? "" : undefined}
          data-warn={warnBlockIds?.has(block.id) ? "" : undefined}
          data-done={isDone?.(segment.unitId) ? "" : undefined}
          data-cut={isCutHere ? "" : undefined}
        >
          {isCutHere ? (
            <>
              {cut.offset > segment.start && (
                <span className="cut-a" data-start={segment.start}>
                  {flattenLineBreaks(block.text.slice(segment.start, cut.offset))}
                </span>
              )}
              <span className="cut-anchor">
                {onCutDrag && (
                  <span
                    className="cut-handle"
                    role="slider"
                    tabIndex={0}
                    aria-label={t("split.cutMove")}
                    aria-valuenow={cut.offset}
                    data-tip={isDragging ? undefined : t("split.cutMove")}
                    data-testid={`${testId}-cut-handle`}
                    onPointerDown={handleHandleDown}
                    onKeyDown={handleHandleKey}
                  />
                )}
                {renderAtCut && !isDragging && <Fragment key={cut.offset}>{renderAtCut()}</Fragment>}
              </span>
              <span className="cut-b" data-start={Math.max(cut.offset, segment.start)}>
                {flattenLineBreaks(block.text.slice(Math.max(cut.offset, segment.start), segment.end))}
              </span>
            </>
          ) : (
            <span data-start={segment.start}>{flattenLineBreaks(text)}</span>
          )}
        </span>
      </span>
    );
  }

  /** 고른 단위와 함께 가는 다른 단위(고른 박스의 짝) - 고른 것처럼 보이지 않게 따로 표시한다 */
  function isMate(unitId: number): boolean {
    return unitId !== selectedId && (highlightIds?.has(unitId) ?? false);
  }

  /** 처리 중인 일이 잡은 박스 - 끌기 · 틈 단추 · 머리 단추를 받지 않는다 */
  function isLocked(unitId: number | null | undefined): boolean {
    return unitId !== null && unitId !== undefined && (strips?.pending?.lockedIds.has(unitId) ?? false);
  }

  /** 고른 박스의 카드 안 순서 손잡이 - 짝 구성원 전부가 한 카드에 이어 붙었을 때만(떨어진 구성원이 있으면 순서가 없다) */
  function renderPairGrip(unit: ViewUnit): ReactNode {
    const grip = strips?.pairGrip;
    if (!grip || unit.id !== selectedId || !brackets.has(unit.id) || isLocked(unit.id) || !grip.isAllowed(unit.id)) return null;
    const top = cardTops.get(unit.id) ?? unit.id;
    const cardSize = 1 + [...cardTops.values()].filter((id) => id === top).length;
    if (cardSize !== (matesOf.get(unit.id)?.length ?? 0) + 1) return null;
    return (
      <span className="strip-grip" data-drag-handle="" data-grip-unit={unit.id} data-tip={t("paper.pairGrip.tip")} data-testid={`${testId}-grip-${unit.id}`}>
        <GripVertical aria-hidden="true" />
      </span>
    );
  }

  /** 고른 박스의 벗긴 표 덩이 안 순서 손잡이(시안 2 D2) - 짝 카드 손잡이와 같은 모양 · 자리. 덩이 안에서는 이것이 먼저다(카드는 구성원이 함께
   *  움직인다). 손잡이 끌기는 화면이 붙인다 - 손잡이를 받는 화면(pairGrip이 있다)에서 벗긴 표를 고칠 수 있을 때(다시 표로와 같은 조건)만,
   *  덩이에 줄이 둘 이상일 때만. 배정이 걸린 줄도 그린다(순서는 판단을 바꾸지 않는다) */
  function renderUnwrapGrip(unit: ViewUnit): ReactNode {
    const tableId = model.unwrapLines.get(unit.id);
    const unwrap = strips?.unwrap;
    if (tableId === undefined || (!strips?.pairGrip && !unwrap?.lineGrip) || !unwrap?.canRewrap || unwrap.busy || unit.id !== selectedId || isLocked(unit.id)) return null;
    if ([...model.unwrapLines.values()].filter((id) => id === tableId).length < 2) return null;
    return (
      <span className="strip-grip" data-drag-handle="" data-unwrap-grip-unit={unit.id} data-tip={t("paper.unwrapGrip.tip")} data-testid={`${testId}-unwrap-grip-${unit.id}`}>
        <GripVertical aria-hidden="true" />
      </span>
    );
  }

  /** AI 순서 제안 미리 보기 칩 "4 → 1"(B11) - 옮겨 갈 줄 오른쪽 위. 눌러도 줄을 고르는 것으로 지나간다 */
  function renderUnwrapAiMove(unit: ViewUnit): ReactNode {
    const move = unwrapAiMoves.get(unit.id);
    if (!move?.moved) return null;
    return (
      <span className="unwrap-ai-move" data-testid={`${testId}-unwrap-ai-move-${unit.id}`}>
        {t("assign.unwrapAi.move", { from: move.from, to: move.to })}
      </span>
    );
  }

  /** 한글 표처럼 하기의 줄 칩(D2-R8) - 줄 오른쪽 위. 하나씩 보기를 연 표면 그 줄만 적용하는 단추가 붙는다 */
  function renderFollowChips(unit: ViewUnit): ReactNode {
    const plan = strips?.unwrap?.follow?.plan;
    const row = followRows.get(unit.id);
    if (!plan || !row) return null;
    const isEach = plan.each.has(row.tableId);
    return (
      <span className="follow-chips" data-each={isEach ? "" : undefined} data-testid={`assign-follow-chips-${unit.id}`}>
        {describeFollowItem(row.item).map((chip) => (
          <span key={chip.key} className="follow-chip" data-kind={chip.key.slice("assign.follow.".length)}>
            {t(chip.key, chip.values)}
          </span>
        ))}
        {isEach && (
          <button
            type="button"
            className="btn toc-act follow-row-apply"
            disabled={strips?.unwrap?.busy || isLocked(unit.id)}
            data-testid={`assign-follow-row-apply-${unit.id}`}
            onClick={(event) => {
              event.stopPropagation();
              plan.onApply(row.tableId, [unit.id]);
            }}
          >
            {t("assign.follow.apply")}
          </button>
        )}
      </span>
    );
  }

  /** 무장한 합치기의 두 박스 - 점선 미리보기 */
  function readArmMark(unitId: number | null | undefined): "" | undefined {
    const arm = strips?.mergeArm;
    return arm && unitId !== null && unitId !== undefined && (unitId === arm.fromId || unitId === arm.toId) ? "" : undefined;
  }

  /** 빛이 지나가는 박스(처리 중) - 움직임 줄이기면 CSS가 옅은 바탕만 */
  function readPendingMark(unitId: number | null | undefined): "" | undefined {
    return unitId !== null && unitId !== undefined && strips?.pending?.shimmerIds.has(unitId) ? "" : undefined;
  }

  /** 그 자리의 처리 중 알약 - 누르는 즉시 뜨고 일이 끝나면 사라진다 */
  function renderPendingPills(isHere: (place: PendingPlace) => boolean): ReactNode {
    const pills = strips?.pending?.pills.filter((pill) => isHere(pill.place)) ?? [];
    if (pills.length === 0) return null;
    return pills.map((pill) => (
      <span key={pill.id} className="pending-pill" role="status" data-kind={pill.kind} data-testid={`${testId}-pending`}>
        {pill.label}
      </span>
    ));
  }

  /** 앞 명령을 기다리는 박스의 칩 "대기 n"(A1-R5) */
  function renderWaitChip(unitId: number | null | undefined): ReactNode {
    const n = unitId === null || unitId === undefined ? undefined : strips?.pending?.waits.get(unitId);
    if (n === undefined) return null;
    return (
      <span className="pending-pill queue-chip" role="status" data-testid={`assign-queue-${unitId}`}>
        {t("assign.queue.chip", { n })}
      </span>
    );
  }

  /** 두 박스 사이 틈의 알약(붙이기 · 틈에서 맺은 짝) */
  function renderGapPills(prev: PaperRow, next: PaperRow): ReactNode {
    const firstId = readRowUnitId(prev);
    const secondId = readRowUnitId(next);
    return renderPendingPills((place) => place.at === "gap" && place.firstId === firstId && place.secondId === secondId);
  }

  /** 고른 박스 아래 흐린 한 줄 - 떨어진 짝이 위/아래 어디에 있는지. 누르면 짝으로 간다(1단 보기는 한 번 = 엿보기, 두 번 = 가기) */
  function renderPairHint(unitId: number): ReactNode {
    const onGo = strips?.pairHint?.onGo;
    const onPeek = strips?.pairHint?.onPeek;
    if (!onGo || pairHint === null) return null;
    const label = t(pairHint.dir === "up" ? "paper.pairHint.above" : "paper.pairHint.below", { lang: pairHint.lang, where: pairHint.where });
    return (
      <button
        type="button"
        className="pair-hint"
        data-dir={pairHint.dir}
        aria-label={`${label} - ${t("paper.pairHint.go")}`}
        data-testid={`${testId}-pair-hint-${unitId}`}
        data-hint-target={pairHint.targetUnitId}
        onClick={(event) => {
          event.stopPropagation();
          if (onPeek) handlePairHintPress(() => onPeek(pairHint), () => onGo(pairHint.targetUnitId));
          else onGo(pairHint.targetUnitId);
        }}
      >
        {label}
        {pairHint.more > 0 && <span>+{pairHint.more}</span>}
      </button>
    );
  }

  function renderBlockText(block: ViewBlock): ReactNode {
    return (model.segments.get(block.id) ?? []).map((segment, index) => renderSegment(block, segment, index));
  }

  /** 고른 조각의 글 아래 단추 줄 - 펼치며 상자를 늘리고, 고름이 떠나면 접은 뒤 뗀다 */
  function renderActions(unitId: number | undefined): ReactNode {
    if (!renderUnitActions || unitId === undefined || (unitId !== actionIds.current && unitId !== actionIds.previous)) return null;
    // 그릴 단추가 없으면(읽기 전용·표) 빈 줄도 두지 않는다 - 빈 줄의 여백만큼 상자가 늘지 않게
    const content = renderUnitActions(unitId);
    if (content === null || content === undefined || content === false) return null;
    return (
      <Collapse key={`acts-${unitId}`} open={unitId === selectedId} className="strip-acts" appear>
        {content}
      </Collapse>
    );
  }

  /** 조각 끝 아이콘 표시 - 고른 조각의 것만 Tab으로 닿는다(수천 개가 Tab 순서에 들지 않게). 짝 카드 안이면 짝 표시는 카드가 대신한다 */
  function renderMarks(unit: ViewUnit | undefined, hasWarn: boolean, className: string, inPairCard = false): ReactNode {
    if (!strips) return null;
    const marks = new Set<PaperMark>();
    if (unit) {
      for (const mark of getMarks(unit, inPairCard, showSplitMark)) marks.add(mark);
    }
    if (hasWarn) marks.add("warn");
    if (marks.size === 0) return null;
    return (
      <span className={className}>
        {MARK_ORDER.filter((mark) => marks.has(mark)).map((mark) => {
          const Icon = MARK_ICONS[mark];
          const label = t(MARK_LABELS[mark]);
          return (
            <span
              key={mark}
              className="pmark-host"
              role="img"
              aria-label={label}
              data-tip={label}
              data-mark-unit={unit?.id}
              // 떨어진 짝 안내 줄이 선 박스의 고리 표시는 강조한다(설계 D3)
              data-on={mark === "pair" && pairHint !== null && unit !== undefined && unit.id === selectedId ? "" : undefined}
              tabIndex={unit !== undefined && unit.id === selectedId ? 0 : -1}
              data-testid={`${testId}-mark-${mark}-${unit?.id ?? "x"}`}
            >
              <Icon size={14} strokeWidth={1.6} className={`pmark ${mark}`} aria-hidden />
            </span>
          );
        })}
      </span>
    );
  }

  /** 조각 언어 칩(KO/EN) - 늘 그려 두고 조각을 올리거나 고를 때만 CSS가 드러낸다(조각마다 호버 상태를 두지 않는다). 짝이면 구성원 모두.
   *  자리는 조각 위 테두리 오른쪽 끝에 걸친 작은 탭 - 글·끝 아이콘과 겹치지 않고 조각 높이를 바꾸지 않는다. 언어가 없는 단위(neutral)는 없다 */
  function renderLang(unit: ViewUnit | undefined): ReactNode {
    if (!unit) return null;
    return <LangToken lang={unit.lang} isRefProposed={unit.ref?.state === "proposed"} className="strip-lang" tabIndex={unit.id === selectedId ? 0 : -1} testId={`${testId}-lang-${unit.id}`} />;
  }

  /** 두 줄 사이의 묶기 - 같은 언어면 합치기, 한글·영어면 짝(아이콘으로 구별). 못 묶는 자리는 꺼 두고 까닭을 툴팁으로 */
  /** 틈의 위나 아래가 고른 박스(짝 카드면 카드 전체)인가 */
  function isNearSelected(prev: PaperRow, next: PaperRow): boolean {
    return selectedBlock.has(readRowUnitId(prev) ?? -1) || selectedBlock.has(readRowUnitId(next) ?? -1);
  }

  function renderMerge(prev: PaperRow, next: PaperRow): ReactNode {
    const join = strips?.join;
    // 붙이기·묶기는 고른 박스의 위아래 틈에만 - 다른 틈에 올려도 단추가 뜨지 않는다(요청서 6번)
    const gap = join && isNearSelected(prev, next) ? getGapMerge(prev, next, model.units) : null;
    if (!join || !gap) return null;
    // 한쪽이 표·그림인 틈은 두 id가 같다 - 묶을 짝이 없으니 plan에 묻지 않는다
    const plan = gap.blocker === "not_text" ? { kind: null, reasonKey: MERGE_BLOCKER_KEYS.not_text } : join.plan(gap.firstId, gap.secondId);
    const label = t("split.joinAdjacent");
    const reason = plan.kind === null && plan.reasonKey ? t(plan.reasonKey) : null;
    const isOff = plan.kind === null || join.busy || isLocked(gap.firstId) || isLocked(gap.secondId);
    const Icon = plan.kind === "pair" ? Link2 : FoldVertical;
    return (
      <button
        type="button"
        className="strip-merge"
        // disabled 대신 aria-disabled - 포커스와 포인터를 받아야 까닭을 보일 수 있다
        aria-disabled={isOff ? "true" : undefined}
        aria-label={reason ? `${label} - ${reason}` : label}
        data-tip={reason ?? undefined}
        data-testid={`${testId}-join-${gap.firstId}-${gap.secondId}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!isOff && plan.kind !== null) join.onJoin(gap.firstId, gap.secondId, plan.kind);
        }}
      >
        <Icon size={12} strokeWidth={1.8} aria-hidden />
        <span className="strip-merge-label">{label}</span>
      </button>
    );
  }

  /** 한 줄의 보류를 읽어 줄 글 - 보류가 아니면 빈 글 */
  function describeTab(unit: ViewUnit): string {
    const live = { ...unit, status: strips?.statusOf?.(unit.id) ?? unit.status };
    return getTags(live).hold ? t("split.tabHold") : "";
  }

  /** 줄 왼쪽 밖 앞머리 - 절 번호 칸(절의 첫 블록에만, 깊이마다 정해진 폭). 짝 카드는 첫 줄만 번호를 보이고 둘째 줄부터는 첫 줄의 절 머리를 따른다 */
  function renderLead(unit: ViewUnit, section: string, width: number, bracket: PairBracket | undefined): ReactNode {
    if (model.hasNumberRanges) {
      // 번호는 늘 번호 칸에 - 줄마다 제 번호(짝 카드의 둘째 줄도 자기 번호다). 번호 칸이 없는 단위(표·그림)는 빈 칸
      if (!unit.number) return <StripLead width={width} number={null} bracket={bracket} dim tip={describeTab(unit)} testId={testId} id={unit.id} />;
      return (
        <NumberCell
          width={width}
          bracket={bracket}
          tip={describeTab(unit)}
          testId={testId}
          unitId={unit.id}
          number={numberUnits.get(unit.id)?.number ?? unit.number}
          isUnread={unreadBlockIds.has(unit.block_id)}
          canEdit={numberCell !== undefined}
          busy={(numberCell?.busy ?? false) || isLocked(unit.id)}
          edit={numberEdit?.unitId === unit.id ? numberEdit : null}
          followed={numberEdit?.unitId === unit.id ? followed : []}
          continuous={numberEdit?.unitId === unit.id ? continuous : null}
          preview={previewOf.get(unit.id) ?? null}
          isArrived={arrivedNumbers.has(unit.id)}
          onEditChange={setNumberEdit}
          onSave={(number, follow, indentShift) => {
            setNumberEdit(null);
            numberCell?.onSave(unit.id, number, follow, indentShift);
          }}
          indent={numberEdit?.unitId === unit.id ? numberEditIndent : undefined}
          stepNumber={numberEdit?.unitId === unit.id ? (text, delta) => stepUnitContinuous(numberOrder, unit.id, text, delta) : undefined}
          bulletShift={numberEdit?.unitId === unit.id ? numberEditBulletShift : null}
          onIndent={(delta) => {
            const plan = numberEditKey === null ? null : planIndent(indentRows, rowLevels, numberEditKey, delta);
            if (plan) numberCell?.onIndent(plan, delta, unit.display_id);
          }}
        />
      );
    }
    const topId = cardTops.get(unit.id);
    const isHead = sectionHeads.has(topId ?? unit.id);
    return (
      <StripLead
        width={width}
        number={isHead && topId === undefined ? getSectionPill(section) : null}
        bracket={bracket}
        dim={!isHead}
        tip={describeTab(unit)}
        testId={testId}
        id={unit.id}
      />
    );
  }

  function readOverlayBox(unitId: number | null | undefined) {
    return unitId === null || unitId === undefined ? null : (overlay?.boxProps(unitId) ?? null);
  }

  function readOverlayWhy(unitId: number | null | undefined): string | undefined {
    return unitId === null || unitId === undefined ? undefined : (overlay?.readWhy?.(unitId) ?? undefined);
  }

  /** 얹기의 글 감싸개 - 없으면 글 그대로 */
  function wrapText(unitId: number | null | undefined, text: ReactNode): ReactNode {
    const attrs = unitId === null || unitId === undefined ? undefined : overlay?.textProps?.(unitId);
    return attrs ? <div {...attrs}>{text}</div> : text;
  }

  /** 얹기가 접은 줄인가 - 짝 카드도 줄마다 접는다 */
  function isFoldedRow(row: PaperRow): boolean {
    return overlay?.isFolded(readRowUnitId(row) ?? -1) ?? false;
  }

  /** 접힌 줄의 자리(띠 하나 또는 아무것도 없음) */
  function renderFoldedRow(row: PaperRow): ReactNode {
    return <Fragment key={row.key}>{overlay?.renderFolded?.([readRowUnitId(row) ?? -1])}</Fragment>;
  }

  /** 표 칸 - 칸 문장마다 작은 조각으로 나누고 같은 칸의 이웃 조각 사이에 합치기를 둔다 */
  function renderCell(cell: ViewBlock): ReactNode {
    if (!strips) return <p data-block={cell.id}>{renderBlockText(cell)}</p>;
    const rows = cellRows.get(cell.id) ?? [];
    if (rows.length === 0) return <p data-block={cell.id} />;
    return rows.map((row, index) => {
      if (row.type !== "piece") return null;
      const unit = row.unitId === null ? undefined : model.units.get(row.unitId);
      const gapPills = index > 0 ? renderGapPills(rows[index - 1], row) : null;
      const box = readOverlayBox(unit?.id);
      return (
        <Fragment key={row.key}>
          {index > 0 && <div className="cell-gap">{gapPills ?? renderMerge(rows[index - 1], row)}</div>}
          <div
            className={box?.className ? `cell-piece ${box.className}` : "cell-piece"}
            // 풀기 전환(useUnwrapMotion)이 칸 글을 벗긴 뒤의 문장 줄과 잇는 키 - 같은 블록 · 같은 시작 자리(readFlipKey)
            data-flip-key={`${cell.id}:${row.parts[0].segments[0]?.start ?? 0}`}
            data-strip-unit={unit?.id}
            data-sel={unit !== undefined && unit.id === selectedId ? "" : undefined}
            data-mate={unit !== undefined && isMate(unit.id) ? "" : undefined}
            data-partner={unit !== undefined && partnerIds?.has(unit.id) ? "" : undefined}
            data-pending={readPendingMark(unit?.id)}
            data-tip={readOverlayWhy(unit?.id)}
            data-merge-arm={readArmMark(unit?.id)}
            {...box?.attrs}
            data-testid={box?.testId ?? (unit ? `${testId}-piece-${unit.id}` : undefined)}
          >
            {unit !== undefined && overlay?.renderTop(unit.id)}
            {renderMarks(unit, false, "cell-marks")}
            {wrapText(unit?.id, <p data-block={cell.id}>{row.parts[0].segments.map((segment, at) => renderSegment(cell, segment, at))}</p>)}
            {renderActions(unit?.id)}
            {unit !== undefined && overlay?.renderFoot?.(unit.id)}
            {unit !== undefined && renderPendingPills((place) => place.at === "box" && place.unitId === unit.id)}
            {renderWaitChip(unit?.id)}
          </div>
        </Fragment>
      );
    });
  }

  /** 캡션 칩 - 캡션 단위의 글자 조각(.su) 그대로라 Alt 긁기·나눌 자리·우클릭이 캡션 단위에 가고, 누르면 묶음으로 올려 고른다(resolvePickUnit).
   *  칩째 끌어 자리 밖에 놓으면 뗀다(data-caption-chip). 문장 같은 캡션은 테두리가 주황이다(F7). 전환 키는 칸·문장 줄과 같은 블록 · 시작 자리 -
   *  그림 줄은 줄째 키를 달아 그 안에 또 달지 않는다(안팎이 두 번 움직인다), 그림 캡션은 나타나기만 한다 */
  function renderCaptionChip(piece: CaptionPiece, shape: BundleShape): ReactNode {
    const caption = piece.unitId === null ? undefined : model.units.get(piece.unitId);
    const first = piece.parts[0];
    return (
      <span
        key={piece.key}
        className="caption-chip"
        data-caption-chip={piece.unitId ?? undefined}
        data-odd={caption && isSentenceLike(caption.text, shape) ? "" : undefined}
        data-flip-key={shape === "table" ? `${first.block.id}:${first.segments[0]?.start ?? 0}` : undefined}
        data-unwrap-enter="frame"
        data-strip-unit={piece.unitId ?? undefined}
      >
        {piece.parts.map((part) => (
          <span key={part.block.id} data-block={part.block.id}>
            {part.segments.map((segment, at) => renderSegment(part.block, segment, at))}
          </span>
        ))}
      </span>
    );
  }

  /** 첫 그림의 캡션을 같이 쓰는 그림(F7 ⑥) - 그 캡션 글을 흐린 칩으로(고르거나 끌 수 없다, 고치기는 첫 그림에서) */
  function renderSharedCaption(unit: ViewUnit): ReactNode {
    const head = unit.caption_figure_id ? model.units.get(unit.caption_figure_id) : undefined;
    if (!head) return null;
    const texts = [...model.units.values()].filter((other) => other.kind === "caption" && other.group_unit_id === head.id).map((caption) => caption.text.trim());
    if (texts.length === 0) return null;
    return (
      <span className="caption-chip" data-shared="" data-testid={`${testId}-caption-shared-${unit.id}`}>
        {texts.join(" / ")}
      </span>
    );
  }

  /**
   * 표·그림의 캡션 자리(F7 - 템플릿 규칙대로 표는 위, 그림은 아래) - 표는 머리 줄이 그 자리이고, 그림은 그림 아래 따로 둔다.
   * 머리 줄은 묶음 단위가 있을 때만. 캡션 자리는 끌어 놓을 곳(data-caption-slot)이고 칩이 나고 드는 전환 범위다
   */
  function renderBundleHead(row: Extract<PaperRow, { type: "table" | "figure" }>, unit: ViewUnit | undefined): { head: ReactNode; slot: ReactNode } {
    if (!unit) return { head: null, slot: null };
    const shape = getBundleShape(unit.kind);
    const captions = row.captions ?? [];
    const shared = captions.length === 0 && row.type === "figure" ? renderSharedCaption(unit) : null;
    const hasCaption = captions.length > 0 || shared !== null;
    const chips = captions.length === 0 ? null : (
      <span className="bundle-head-caption" data-testid={`${testId}-caption-${unit.id}`}>
        {captions.map((piece) => renderCaptionChip(piece, shape))}
      </span>
    );
    const isMissing = strips?.isCaptionNeeded ? strips.isCaptionNeeded(unit.id, hasCaption) : !hasCaption;
    // 캡션 단위를 바로 고른 때(짝 고르기·나눌 선)도 펼친 채 - 나눌 선 아래에서 다시 접히지 않게
    const isSelected = unit.id === selectedId || (highlightIds?.has(unit.id) ?? false) || captions.some((piece) => piece.unitId !== null && piece.unitId === selectedId);
    const header = getBundleHeader(row, model);
    if (row.type === "table") {
      return { head: <BundleHead head={header} selected={isSelected} testId={testId} caption={chips ?? undefined} captionMissing={isMissing} slotId={unit.id} />, slot: null };
    }
    const slot = (
      <div
        className="caption-slot bundle-head"
        data-sel={isSelected ? "" : undefined}
        data-caption-slot={unit.id}
        data-unwrap-scope={getCaptionScope(unit.id)}
        data-empty={hasCaption ? undefined : ""}
        data-testid={`${testId}-caption-slot-${unit.id}`}
      >
        {chips ?? shared}
      </div>
    );
    return { head: <BundleHead head={header} selected={isSelected} testId={testId} captionMissing={isMissing} hidePreview={hasCaption} />, slot };
  }

  /** 첫 행에서 올린 캡션(F7 ③)만 남은 표 행 - 표에서 빠져 캡션 자리에 있으니 다시 그리지 않는다 */
  function listLiftedRows(item: Extract<PaperItem, { type: "table" }>, captions: readonly CaptionPiece[]): Set<number> {
    const lifted = new Set(captions.flatMap((piece) => piece.parts.map((part) => part.block.id)));
    const rows = new Set<number>();
    item.rows.forEach((cells, index) => {
      if (cells.some((cell) => lifted.has(cell.id)) && cells.every((cell) => lifted.has(cell.id) || cell.text.trim() === "")) rows.add(index);
    });
    return rows;
  }

  function renderTable(item: Extract<PaperItem, { type: "table" }>, head: ReactNode = null, hiddenRows: ReadonlySet<number> = new Set(), headTip?: string): ReactNode {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {head !== null && <div data-unwrap-leave="" data-tip={headTip}>{head}</div>}
        {/* 가로 스크롤은 표만 - 조각 상자가 스크롤하면 위 테두리의 종류 표시가 잘린다 */}
        <div className="ptbl-scroll">
          {/* 표 벗기기 · 다시 표로 때 표 선이 옅어지고(나타나고) 칸 글은 남아 미끄러진다(F10) */}
          <table className="ptbl" data-unwrap-leave="frame">
            <tbody>
              {item.rows.map((row, rowIndex) =>
                hiddenRows.has(rowIndex) ? null : (
                  <tr key={rowIndex}>
                    {row.map((cell) => (
                      <td key={cell.id} colSpan={cell.grid_span} rowSpan={cell.row_span}>
                        {renderCell(cell)}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /** 그림 - 그림 블록 글(옛 추출 캡션)이 캡션 자리의 캡션으로 읽히면(hideText) 다시 두지 않는다. 캡션 자리(slot)는 그림 아래다 */
  function renderFigure(block: ViewBlock, head: ReactNode = null, hideText = false, slot: ReactNode = null): ReactNode {
    return (
      <>
        {head}
        <figure className="pfig">
          {figureSource && block.has_image ? (
            <FigureImage bundleId={figureSource.bundleId} docId={figureSource.docId} blockId={block.id} />
          ) : (
            <span className="pfig-box" aria-hidden>
              <ImageIcon size={28} strokeWidth={1.5} />
            </span>
          )}
          {!hideText && <p data-block={block.id}>{renderBlockText(block)}</p>}
          {/* 도형 그림의 글은 단위가 아니다 - 접어 두고, 펼치거나 브라우저 찾기(Ctrl+F가 닫힌 details를 연다)로 읽는다 */}
          {block.figure_texts?.length ? (
            <details className="pfig-texts" data-testid={`figure-texts-${block.id}`}>
              <summary>
                {t("paper.figureTexts")} <span className="tabular-nums text-ink-4">{block.figure_texts.length}</span>
              </summary>
              <ol>
                {block.figure_texts.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
            </details>
          ) : null}
        </figure>
        {slot}
      </>
    );
  }

  /** strips 없이 - 문단을 그대로 잇는다 */
  function renderItem(item: PaperItem): ReactNode {
    if (item.type === "table") return <Fragment key={`t${item.table.id}`}>{renderTable(item)}</Fragment>;
    const { block } = item;
    if (block.kind === "figure") return <Fragment key={block.id}>{renderFigure(block)}</Fragment>;
    // 벗긴 바깥 칸이 안쪽 표 자리에서 둘로 나뉜 조각이면 그 범위의 글만(F2)
    return (
      <p key={item.range ? `${block.id}-${item.range[0]}` : block.id} data-block={block.id} className={block.heading_level !== null ? "h" : undefined}>
        {getItemSegments(item, model.segments).map((segment, index) => renderSegment(block, segment, index))}
      </p>
    );
  }

  function readTabWidth(row: PaperRow): number {
    return tabWidths.get(row.key) ?? getPillWidth(getSectionLevel(readRowLabel(row, model)));
  }

  /** 절 첫 블록 글 앞의 절 번호를 숨길 글자 수 - 그 블록이 이 단위로 시작할 때만(짝 카드의 둘째 줄부터는 첫 줄이 머리면 같이). 표시만이고 원문은 그대로다.
   *  번호뿐인 단위는 숨기지 않고, 나눌 선이 번호 안으로 들어오면 그동안 번호를 드러낸다(getVisibleSkip) */
  function readHiddenPrefix(block: ViewBlock, unit: ViewUnit | undefined): number {
    if (!unit) return 0;
    if (model.hasNumberRanges) {
      // 번호 범위가 있는 문서 - 번호 칸으로 간 범위(번호와 뒤 빈 글자)를 가린다. 번호만 든 칸 블록은 통째로 가려진다
      const contentStart = unit.number?.content_start ?? 0;
      const end = contentStart > 0 ? (getHiddenEnds(unit.spans, contentStart).get(block.id) ?? 0) : 0;
      return cut?.blockId === block.id && cut.offset < end ? 0 : end;
    }
    const isHead = sectionHeads.has(cardTops.get(unit.id) ?? unit.id);
    const first = model.segments.get(block.id)?.[0];
    if (!isHead || first?.unitId !== unit.id || first.start !== 0) return 0;
    return getVisibleSkip(getHiddenPrefixLength(block.text, block.section_label), first.end, cut?.blockId === block.id ? cut.offset : null);
  }

  /** 조각 한 줄 - 글 조각, 표, 그림 모두 같은 틀(앞 태그·끝 표시)에 담는다. inPairCard는 이웃한 짝 카드 안의 줄 */
  function renderRow(row: PaperRow, isPeek = false, inPairCard = false): ReactNode {
    const unitId = row.type === "table" ? row.item.unitId : row.unitId;
    const unit = unitId === null ? undefined : model.units.get(unitId);
    const hasWarn = row.type === "piece" ? row.parts.some((part) => warnBlockIds?.has(part.block.id)) : row.type === "figure" && (warnBlockIds?.has(row.block.id) ?? false);
    const section = readRowSection(row);
    const width = readTabWidth(row);
    const bracket = unitId === null ? undefined : brackets.get(unitId);
    // 아래 줄에 간 곳 글, 연결 배지는 조각 오른쪽 아래 모서리에 떠 있다(오른쪽 여백 --pg-pad-r 안이라 글을 덮지 않는다)
    const note = unit ? strips?.renderNote?.([unit.id]) : null;
    const pills = unit && row.type !== "table" ? strips?.renderPills?.(unit.id) : null;
    const foot = note ? <div className="strip-foot">{note}</div> : null;
    const isHold = unit !== undefined && getTags({ ...unit, status: strips?.statusOf?.(unit.id) ?? unit.status }).hold;
    // 벗긴 표의 줄은 왼쪽 세로선 하나(F1), 표 줄과 벗긴 줄은 풀기 전환이 바꾸는 곳(data-unwrap-scope)이다
    const unwrapTable = getRowUnwrapTable(row, model.unwrapped, model.tables);
    const scopeTable = row.type === "table" ? row.item.table.id : unwrapTable;
    const box = readOverlayBox(unitId);
    const why = readOverlayWhy(unitId);
    return (
      <StripBox
        key={row.key}
        rowAttrs={{
          "data-peek": isPeek ? "" : undefined,
          "data-unwrap-scope": scopeTable === null ? undefined : `t${scopeTable}`,
          // 표 줄은 키를 달지 않는다 - 안의 칸 조각이 저마다 키를 단다(키 안에 키를 두지 않는다)
          "data-flip-key": row.type === "piece" ? readFlipKey(row, unit) : row.type === "figure" ? `f${row.block.id}` : undefined,
          ...(unitId === null ? undefined : overlay?.rowAttrs?.(unitId)),
        }}
        boxClassName={box?.className ? `strip ${box.className}` : undefined}
        chips={unitId !== null && overlay?.renderTop(unitId)}
        before={unwrapTable !== null && renderRail(width)}
        lead={unit ? renderLead(unit, section, width, bracket) : null}
        leadWidth={width}
        bracket={bracket}
        boxAttrs={{
          "data-kind": row.type,
          "data-sel": unit !== undefined && unit.id === selectedId ? "" : undefined,
          "data-mate": unit !== undefined && isMate(unit.id) ? "" : undefined,
          "data-partner": unit !== undefined && partnerIds?.has(unit.id) ? "" : undefined,
          "data-strip-unit": unitId ?? undefined,
          // 처리 중인 박스는 끌리지 않는다(설계 D4 - 잠금은 그 박스만)
          "data-drag-box": dragBoxes && unitId !== null && !isLocked(unitId) ? "" : undefined,
          "data-pending": readPendingMark(unitId),
          "data-merge-arm": readArmMark(unitId),
          "data-unwrap-ai-moved": unitId !== null && unwrapAiMoves.get(unitId)?.moved ? "" : undefined,
          "data-tip": row.type === "table" ? undefined : why,
          ...box?.attrs,
          "data-testid": box?.testId ?? `${testId}-piece-${unitId ?? row.key}`,
        }}
      >
          {unit !== undefined && (renderUnwrapGrip(unit) ?? renderPairGrip(unit))}
          {unit !== undefined && renderUnwrapAiMove(unit)}
          {unit !== undefined && renderFollowChips(unit)}
          {/* 표·그림의 보류 칩 - 표 위 제 줄(data-start 밖)이라 표를 덮지 않고, 눌러도 조각 상자를 누른 것으로 그 단위를 고른다 */}
          {row.type !== "piece" && isHold && (
            <div className="strip-hold">
              <UnitStatusChip status="on_hold" size="sm" testId={`${testId}-hold-${unit?.id}`} />
            </div>
          )}
          {row.type === "table"
            ? renderTable(row.item, renderBundleHead(row, unit).head, listLiftedRows(row.item, row.captions ?? []), why)
            : row.type === "figure"
              ? (() => {
                  const { head, slot } = renderBundleHead(row, unit);
                  return renderFigure(row.block, head, (row.captions?.length ?? 0) > 0 || row.block.text.trim() === "", slot);
                })()
              : wrapText(unitId, row.parts.map((part, partIndex) => {
                  const skip = partIndex === 0 ? readHiddenPrefix(part.block, unit) : 0;
                  // 번호 칸으로 간 번호만 든 칸 블록 - 빈 줄을 두지 않는다
                  if (skip > 0 && part.segments.every((segment) => segment.end <= skip)) return null;
                  // 띠 표 제목 줄은 칸 블록이라 제목 스타일이 없다 - 제목처럼 그린다(F4)
                  return (
                    <p key={part.block.id} data-block={part.block.id} className={part.block.heading_level !== null || (unit !== undefined && isBandHeading(unit)) ? "h" : undefined}>
                      {/* 보류 칩 - .su·data-start 밖이라 눌러도 글자 위치로 읽히지 않고 조각 상자를 누른 것으로 그 줄을 고른다 */}
                      {partIndex === 0 && isHold && <UnitStatusChip status="on_hold" size="sm" testId={`${testId}-hold-${unit?.id}`} />}
                      {part.segments.map((segment, index) => renderSegment(part.block, segment, index, skip))}
                    </p>
                  );
                }))}
          {row.type === "figure" && unit !== undefined && strips?.figureCard?.renderActions(unit.id)}
          {renderActions(unit?.id)}
          {unit !== undefined && overlay?.renderFoot?.(unit.id)}
          {foot}
          {unit !== undefined && unit.id === selectedId && renderPairHint(unit.id)}
          {renderPendingPills((place) => (place.at === "box" && place.unitId === unitId) || (place.at === "table" && row.type === "table" && place.tableId === row.item.table.id))}
          {renderWaitChip(unitId)}
          {pills}
          {renderMarks(unit, hasWarn, "strip-marks", inPairCard)}
          {row.type === "piece" && renderLang(unit)}
      </StripBox>
    );
  }

  /** 그림 탭에서 캡션 하나를 같이 쓰는 그림끼리 - 한 카드처럼 붙인다(짝 카드 안 틈과 같은 모양) */
  function isFigureMate(prev: PaperRow, row: PaperRow): boolean {
    if (figureRows !== "only" || prev.type !== "figure" || row.type !== "figure" || prev.unitId === null || row.unitId === null) return false;
    const group = model.figureGroupOf.get(prev.unitId);
    return group !== undefined && group === model.figureGroupOf.get(row.unitId);
  }

  /** 표 탭에서 다른 표끼리 맞닿은 틈 - 본문에서는 사이에 글이 있던 두 표라 합치기를 두지 않는다 */
  function isAcrossTables(prev: PaperRow, row: PaperRow): boolean {
    return tableRows === "only" && findRowTable(prev, model.tables) !== findRowTable(row, model.tables);
  }

  /** 표 탭의 위치 머리 "§5 아래" - 표의 첫 칸 앞에 한 번. 절이 없는 표는 머리가 없다 */
  function renderTablePlace(prev: PaperRow | undefined, row: PaperRow): ReactNode {
    if (tableRows !== "only") return null;
    const tableId = findRowTable(row, model.tables);
    if (tableId === null || (prev !== undefined && findRowTable(prev, model.tables) === tableId)) return null;
    const section = model.tableBlocks.find((block) => block.tableId === tableId)?.section ?? "";
    if (section === "") return null;
    return (
      <div className="strip-row table-place-row" data-testid={`assign-table-place-${tableId}`}>
        <span className="strip-lead-gap" style={{ width: readTabWidth(row) + STRIP_LEAD_EXTRA }} />
        <span className="table-place">{t("assign.tablePlace", { section })}</span>
      </div>
    );
  }

  /** 두 조각 사이 틈 */
  function renderGap(prev: PaperRow, row: PaperRow): ReactNode {
    const unwrapTable = getRowUnwrapTable(row, model.unwrapped, model.tables);
    const hasRail = unwrapTable !== null && unwrapTable === getRowUnwrapTable(prev, model.unwrapped, model.tables);
    return (
      <div
        className="strip-gap"
        data-unwrap-scope={hasRail ? `t${unwrapTable}` : undefined}
        // 카드 안 틈 - 둘째 줄부터의 바로 위는 늘 같은 카드다
        data-pair={cardTops.has(readRowUnitId(row) ?? -1) || isFigureMate(prev, row) ? "" : undefined}
        data-near-selected={isNearSelected(prev, row) ? "" : undefined}
        // 합치기 단추를 글 시작 x에 - 위아래 앞머리 중 넓은 쪽 뒤라 어느 앞머리에도 걸치지 않는다
        style={{ "--gap-tab": `${Math.max(readTabWidth(prev), readTabWidth(row)) + STRIP_LEAD_EXTRA}px` }}
        data-testid={`${testId}-gap-${row.key}`}
      >
        {hasRail && renderRail(Math.min(readTabWidth(prev), readTabWidth(row)))}
        {/* 처리 중인 틈은 알약이 합치기 자리를 대신한다. 저절로 삭제된 줄 곁에는 합치기를 두지 않는다 - 먼저 "삭제 취소"로 보통 줄로 돌린다. 접힌 삭제 줄 곁도 같다(펼쳐서 한다) */}
        {renderGapPills(prev, row) ?? (!(hasNoise && (readNoiseKind(prev, model.units) ?? readNoiseKind(row, model.units)) !== null) && !isDeletedRow(prev) && !isDeletedRow(row) && !isAcrossTables(prev, row) && renderMerge(prev, row))}
      </div>
    );
  }

  /** 한 카드의 블록 줄 - 용지 줄이 없는 안쪽 표 · 칸 안 그림도 제 줄로 센다. 그림 탭에는 그림 줄만, 필터로 접힌 목록에서 엿본 줄은 그 줄만 있다 */
  function listNoiseUnits(rows: readonly PaperRow[], isPeek: boolean): ViewUnit[] {
    const ids = rows.flatMap((row) => {
      const unitId = readRowUnitId(row);
      if (unitId === null) return [];
      return figureRows === "only" || isPeek ? [unitId] : (noiseBlockOf.get(unitId)?.unitIds ?? [unitId]);
    });
    return [...new Set(ids)].flatMap((id) => model.units.get(id) ?? []);
  }

  /** 저절로 삭제된 줄의 블록 - 연달아 오는 같은 종류의 줄을 흐린 블록 하나로(MD 1 F6). 머리는 "DELETED 이름 · n줄 · 사유"와 늘 보이는 사유 쓰기 ·
   *  모두 삭제 취소, 펼치면 원문 글 그대로 줄마다(취소선, 한/영 사이 점선)와 줄 끝의 같은 두 단추(흐리게, 고른 줄은 삭제 취소가 펼친 채).
   *  머리를 누르면 펼치거나 접으며 블록을 고르고, 줄을 누르면 그 줄을 고른다. 고름은 배정 줄이 아니라 화면의 고름이다(결정 칸 F12) */
  function renderNoiseBlock(rows: readonly PaperRow[], isPeek: boolean): ReactNode {
    const noise = strips?.noise;
    const block = buildNoiseBlock(listNoiseUnits(rows, isPeek), (unit) => describeNoiseUnit(unit, model.tables, t));
    if (!noise || !block) return null;
    const isOpen = noise.open.has(block.key);
    const picked = noise.selected !== null && block.unitIds.includes(noise.selected.unitId ?? noise.selected.key) ? noise.selected : null;
    const isBusy = noise.busy || block.unitIds.some(isLocked);
    const width = readTabWidth(rows[0]);
    const prefix = `${testId}-noise`;
    const name = t(`assign.noise.name.${block.kind}`);
    const reason = readNoiseReason(block, t);
    // 단추가 속한 블록 · 줄을 함께 고른다 - 앞서 고른 줄에 이어 누른 글쇠(↵ · Del · H)가 떨어지지 않게
    const pressAct = (unitId: number | null, run: () => void) => {
      noise.onPick(block.key, unitId);
      run();
    };
    return (
      <div key={`noise-${block.key}`} className="strip-row">
        <span className="strip-lead-gap" style={{ width: width + STRIP_LEAD_EXTRA }} />
        <div className="toc-block" data-kind={block.kind} data-open={isOpen ? "" : undefined} data-sel={picked !== null && picked.unitId === null ? "" : undefined} data-testid={`${prefix}-${block.key}`}>
          <div className="toc-head-row noise-head-row">
            <button
              type="button"
              className="toc-head"
              aria-expanded={isOpen}
              data-tip={reason}
              data-testid={`${prefix}-head-${block.key}`}
              onClick={() => {
                noise.onToggle(block.key);
                noise.onPick(block.key, null);
              }}
            >
              <ChevronRight size={13} strokeWidth={1.75} className="toc-chevron" aria-hidden />
              <span className="deleted-tag">{t("paper.deleted.tag")}</span>
              <span className="toc-head-text">{t("assign.noise.head", { name, n: block.counts.total, reason })}</span>
            </button>
            {noise.canEdit && (
              <span className="noise-acts">
                <button type="button" className="btn noise-act" disabled={isBusy} data-testid={`${prefix}-reason-${block.key}`} onClick={() => pressAct(null, () => noise.onReason(block.unitIds))}>
                  {t("assign.noise.write")}
                </button>
                <button type="button" className="btn noise-act" disabled={isBusy} data-testid={`${prefix}-clear-${block.key}`} onClick={() => pressAct(null, () => noise.onClear(block.unitIds))}>
                  {t("assign.noise.clearAll")}
                </button>
              </span>
            )}
            {renderPendingPills((place) => place.at === "box" && block.unitIds.includes(place.unitId))}
          </div>
          <Collapse open={isOpen} className="toc-body">
            {() => (
              <ol className="toc-lines" style={{ fontFamily: "var(--font-source)" }}>
                {block.lines.map((line) => {
                  const isPicked = picked?.unitId === line.unitId;
                  return (
                    <li key={line.unitId} className="toc-line" data-break={line.breakBefore ? "" : undefined} data-picked={isPicked ? "" : undefined}>
                      <button
                        type="button"
                        className="toc-line-text noise-line-text"
                        aria-pressed={isPicked}
                        data-testid={`${prefix}-line-${line.unitId}`}
                        onClick={() => noise.onPick(block.key, isPicked ? null : line.unitId)}
                      >
                        {line.text}
                      </button>
                      {block.reason.isMixed && line.reason !== "" && <span className="noise-line-reason" data-tip={line.reason}>{line.reason}</span>}
                      {noise.canEdit && (
                        <span className="mbtn-set noise-line-acts">
                          <button type="button" className={getMorphClassName("default", false)} aria-label={t("assign.noise.write")} disabled={isBusy} data-testid={`${prefix}-unit-reason-${line.unitId}`} onClick={() => pressAct(line.unitId, () => noise.onReason([line.unitId]))}>
                            <FilePen size={14} strokeWidth={1.5} aria-hidden />
                            <span className="mbtn-label" aria-hidden>{t("assign.noise.write")}</span>
                          </button>
                          <button type="button" className={getMorphClassName("default", isPicked)} aria-label={t("assign.noise.clear")} disabled={isBusy} data-testid={`${prefix}-unit-clear-${line.unitId}`} onClick={() => pressAct(line.unitId, () => noise.onClear([line.unitId]))}>
                            <Undo2 size={14} strokeWidth={1.5} aria-hidden />
                            <span className="mbtn-label" aria-hidden>
                              {t("assign.noise.clear")} {isPicked && <kbd>{formatAssignKey("clear")}</kbd>}
                            </span>
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Collapse>
        </div>
      </div>
    );
  }

  /** 삭제로 확정해 접은 줄인가 - 그 곁 틈에는 묶기를 두지 않는다 */
  function isDeletedRow(row: PaperRow): boolean {
    const folds = strips?.deleted?.folds;
    const fold = folds?.get(readRowUnitId(row) ?? -1);
    // 고른 박스가 든 줄은 펼쳐 그린다(isDeletedLineOpen) - 그 곁 틈은 평소대로
    return fold !== undefined && folds !== undefined && !isDeletedLineOpen(folds, fold.rowKey, selectedId);
  }

  /** 접힌 삭제 줄(설계 D6) - 목차 블록처럼 흐린 한 줄, DELETED 꼬리표만 반투명 빨강, Remark는 툴팁. 누르면 카드의 첫 단위를 골라 펼친다.
   *  data-strip-unit은 우클릭 메뉴(handleContextMenu)가 단위를 찾는 표시. testid는 카드 첫 단위(외톨이 · 이웃한 짝 카드면 줄 키 u<id>와 같다, 떨어진 짝의 다른 카드는 그 카드의 첫 단위) */
  function renderDeletedLine(rows: readonly PaperRow[], line: DeletedLine): ReactNode {
    const deleted = strips?.deleted;
    const unitId = readRowUnitId(rows[0]);
    if (!deleted || unitId === null) return null;
    const unitIds = rows.map((row) => readRowUnitId(row) ?? -1);
    return (
      <div key={`deleted-${unitId}`} className="strip-row">
        <span className="strip-lead-gap" style={{ width: readTabWidth(rows[0]) + STRIP_LEAD_EXTRA }} />
        <button
          type="button"
          className="deleted-line"
          data-tip={line.remark || undefined}
          data-pick={unitIds.some((id) => pickedIds?.has(id)) ? "" : undefined}
          data-strip-unit={unitId}
          data-pending={readPendingMark(unitId)}
          data-testid={`${testId}-deleted-u${unitId}`}
          onClick={(event) => onUnitClick(unitId, null, event)}
        >
          <span className="deleted-tag">{t("paper.deleted.tag")}</span>
          <span className="deleted-text">{[line.kind, line.text].filter((part) => part !== null && part !== "").join(" · ")}</span>
          {renderWaitChip(unitId)}
        </button>
      </div>
    );
  }

  /** 풀기 전환의 키 - 줄에서 처음 보이는 조각의 블록과 시작 자리. 번호 칸으로 가 통째로 가려진 번호 칸 블록은 건너뛴다(표 안 칸 조각의 키와 같은 꼴) */
  function readFlipKey(row: Extract<PaperRow, { type: "piece" }>, unit: ViewUnit | undefined): string {
    const skip = readHiddenPrefix(row.parts[0].block, unit);
    const part = row.parts.find((one, index) => index > 0 || !(skip > 0 && one.segments.every((segment) => segment.end <= skip))) ?? row.parts[0];
    return `${part.block.id}:${part.segments[0]?.start ?? 0}`;
  }

  /** 벗긴 표 줄 묶음의 왼쪽 세로선 - 줄과 줄 사이 틈에도 그어 한 줄로 이어진다. 앞머리(번호 칸) 바로 뒤, 조각 왼쪽 테두리 앞 */
  function renderRail(leadWidth: number): ReactNode {
    return <span className="unwrap-rail" style={{ left: leadWidth + STRIP_LEAD_EXTRA - 4 }} data-unwrap-enter="frame" aria-hidden />;
  }

  /** 벗긴 영어 표 머리의 "한글 표처럼 하기 · n건"(D2-R8) - [적용]은 편집 하나(되돌리기 한 번), [하나씩 보기]는 줄마다 적용 단추, [그대로 두기]는 이 화면에서만 감춘다 */
  function renderFollowPlan(tableId: number, isOff: boolean): ReactNode {
    const plan = strips?.unwrap?.follow?.plan;
    const found = plan?.plans.get(tableId);
    if (!plan) return null;
    if (!found) {
      // 규칙이 못 푸는 표 - AI에 물을 수 있다(D2-R9). 꺼진 단추는 포인터를 받지 않아 감싼 span이 까닭 툴팁을 단다
      if (plan.ai.busy.has(tableId)) {
        return (
          <span className="unwrap-ai-busy" data-testid={`assign-follow-ai-busy-${tableId}`}>
            {t("assign.follow.ai.busy")}
          </span>
        );
      }
      if (!plan.ai.asks.has(tableId)) return null;
      return (
        <span className="unwrap-ai-ask" data-tip={plan.ai.enabled ? undefined : t("assign.follow.ai.offTip")}>
          <button type="button" className="btn toc-act" disabled={!plan.ai.enabled || isOff} data-testid={`assign-follow-ai-${tableId}`} onClick={() => plan.ai.onAsk(tableId)}>
            {t("assign.follow.ai.ask")}
          </button>
        </span>
      );
    }
    if (found.count === 0) {
      // AI가 바꿀 것이 없다고 본 제안 - 그렇다는 말과 닫기만(채택 as_is가 남는다)
      return (
        <>
          <span className="unwrap-ai-note follow-head-note" data-testid={`assign-follow-same-${tableId}`}>
            {t("assign.follow.ai.same")}
          </span>
          <button type="button" className="btn toc-act" data-testid={`assign-follow-keep-${tableId}`} onClick={() => plan.onKeep(tableId)}>
            {t("assign.unwrapAi.close")}
          </button>
        </>
      );
    }
    return (
      <>
        <span className="unwrap-ai-note follow-head-note" data-testid={`assign-follow-${tableId}`}>
          {t("assign.follow.head", { n: found.count })}
        </span>
        <button type="button" className="btn pri toc-act" disabled={isOff} data-testid={`assign-follow-apply-${tableId}`} onClick={() => plan.onApply(tableId)}>
          {t("assign.follow.apply")}
        </button>
        <button type="button" className="btn toc-act" aria-pressed={plan.each.has(tableId)} data-testid={`assign-follow-each-${tableId}`} onClick={() => plan.onEach(tableId)}>
          {t("assign.follow.each")}
        </button>
        <button type="button" className="btn toc-act" data-testid={`assign-follow-keep-${tableId}`} onClick={() => plan.onKeep(tableId)}>
          {t("assign.follow.keep")}
        </button>
      </>
    );
  }

  /** 벗긴 영어 표 머리의 짝 표(D2-R3) - 애매하거나 사람이 정했거나 짝이 없다는 답이어도 후보가 있으면 고르기(후보 "표 n" + "짝 없음"), 짝이 정해졌으면 흐린 "표 n과 짝" */
  function renderFollow(tableId: number, isOff: boolean): ReactNode {
    const follow = strips?.unwrap?.follow;
    const answer = follow?.answers.get(tableId);
    if (!follow || !answer) return null;
    const view = describeCounterpart({ lang: model.tables.get(tableId)?.lang, side: "old", isUnwrapped: true, status: answer.status, decided: answer.decided, candidates: answer.candidates.length });
    if (view === "matched") {
      const paired = answer.candidates.find((item) => item.table_id === answer.source_table_id);
      return paired ? (
        <span className="unwrap-ai-note follow-head-note" data-testid={`assign-follow-pair-${tableId}`}>
          {t("assign.follow.paired", { n: paired.table_no })}
        </span>
      ) : null;
    }
    if (view !== "ask") return null;
    const { value, choices } = listCounterpartChoices(answer);
    const options = [
      ...(value === PICK_VALUE ? [{ value: PICK_VALUE, label: t("assign.follow.pick"), disabled: true }] : []),
      ...choices.map((choice) => ({ value: choice.value, label: choice.tableNo === null ? t("assign.follow.none") : t("assign.follow.table", { n: choice.tableNo }) })),
    ];
    return (
      <Select
        testId={`assign-follow-pick-${tableId}`}
        ariaLabel={t("assign.follow.pick")}
        size="sm"
        disabled={isOff}
        value={value}
        options={options}
        onChange={(next) => follow.onPick(tableId, next === NO_COUNTERPART_VALUE ? null : Number(next))}
      />
    );
  }

  /** 벗긴 표의 줄 덩이 머리 - "↺ 다시 표로"와 "✦ AI 순서 제안"(B11). 고칠 수 없으면 머리를 두지 않는다. 제안이 오면 [제안대로 놓기] [그대로 두기]가
   *  "✦ AI 순서 제안"을 대신하고, 제안이 지금 차례와 같으면 그렇다는 말과 닫기만 둔다 */
  function renderUnwrapHead(row: PaperRow): ReactNode {
    const unwrap = strips?.unwrap;
    const tableId = unwrapHeads.get(row.key);
    if (!unwrap?.canRewrap || tableId === undefined) return null;
    const ai = unwrap.ai;
    const isLockedTable = [...model.units.values()].some((unit) => unit.table_id === tableId && isLocked(unit.id));
    const isOff = unwrap.busy || isLockedTable;
    const current = unwrapOrders.get(tableId) ?? [];
    const suggested = ai?.previews.get(tableId);
    const isPreview = ai !== undefined && suggested !== undefined && readUnwrapMoves(current, suggested).size > 0;
    const isSame = isPreview && isUnwrapSuggestionUnchanged(current, suggested);
    const isBusy = ai?.busy.has(tableId) ?? false;
    return (
      <div className="strip-row unwrap-head-row" data-unwrap-scope={`t${tableId}`} data-testid={`${testId}-unwrap-head-${tableId}`}>
        <span className="strip-lead-gap" style={{ width: readTabWidth(row) + STRIP_LEAD_EXTRA }} />
        {/* 다시 표로를 누르면 응답 전에 이것이 사라진다 - 처리 중 알약은 밖에 둔다 */}
        <div className="unwrap-head" data-unwrap-enter="">
          {isBusy && (
            <span className="unwrap-ai-busy" data-testid={`${testId}-unwrap-ai-busy-${tableId}`}>
              {t("assign.unwrapAi.busy")}
            </span>
          )}
          {isSame && (
            <>
              <span className="unwrap-ai-note" data-testid={`${testId}-unwrap-ai-same-${tableId}`}>
                {t("assign.unwrapAi.same")}
              </span>
              <button type="button" className="btn toc-act" disabled={isOff} data-testid={`${testId}-unwrap-ai-dismiss-${tableId}`} onClick={() => ai?.onKeep(tableId, true)}>
                {t("assign.unwrapAi.close")}
              </button>
            </>
          )}
          {isPreview && !isSame && suggested && (
            <>
              <button type="button" className="btn pri toc-act" disabled={isOff} data-testid={`${testId}-unwrap-ai-apply-${tableId}`} onClick={() => ai?.onApply(tableId, suggested)}>
                {t("assign.unwrapAi.apply")}
              </button>
              <button type="button" className="btn toc-act" disabled={isOff} data-testid={`${testId}-unwrap-ai-dismiss-${tableId}`} onClick={() => ai?.onKeep(tableId, false)}>
                {t("assign.unwrapAi.keep")}
              </button>
            </>
          )}
          {ai && !isPreview && (
            // 꺼진 단추는 포인터를 받지 않아 감싼 span이 까닭 툴팁을 단다
            <span className="unwrap-ai-ask" data-tip={ai.enabled ? undefined : t("assign.unwrapAi.offTip")}>
              <button type="button" className="btn toc-act" disabled={!ai.enabled || isOff || isBusy || current.length < 2} data-testid={`${testId}-unwrap-ai-${tableId}`} onClick={() => ai.onAsk(tableId)}>
                {t("assign.unwrapAi.ask")}
              </button>
            </span>
          )}
          {renderFollowPlan(tableId, isOff)}
          {renderFollow(tableId, isOff)}
          <button
            type="button"
            className="btn toc-act"
            disabled={isOff}
            data-testid={`${testId}-rewrap-${tableId}`}
            onClick={() => unwrap.onRewrap(tableId)}
          >
            {t("assign.unwrap.rewrap")}
          </button>
        </div>
        {renderPendingPills((place) => place.at === "table" && place.tableId === tableId)}
      </div>
    );
  }

  /** 제목 → 문장 묶음 머리(F8b) - 카드에 묶음의 첫 줄이 있으면 그 카드 위 한 줄. 원문 글자 없이 꼬리표·수·되돌리기만 */
  function renderShiftHead(rows: readonly PaperRow[]): ReactNode {
    const shift = strips?.headingShift;
    const group = shift ? rows.map((row) => shiftGroups.get(readRowUnitId(row) ?? -1)).find((item) => item !== undefined) : undefined;
    if (!shift || !group) return null;
    const head = readHeadingShiftHead(group);
    return (
      <div className="strip-row" data-testid={`${testId}-shift-${group.firstUnitId}`}>
        <span className="strip-lead-gap" style={{ width: readTabWidth(rows[0]) + STRIP_LEAD_EXTRA }} />
        <div className="shift-head">
          <span className="toc-tag">{t("assign.headingShift.tag")}</span>
          <span className="shift-head-text">{t(head.key, head.values)}</span>
          {shift.canRevert && (
            <button
              type="button"
              className="btn toc-act"
              disabled={shift.busy || group.unitIds.some(isLocked)}
              data-testid={`${testId}-shift-revert-${group.firstUnitId}`}
              onClick={() => shift.onRevert(group.unitIds)}
            >
              {t("assign.headingShift.revert")}
            </button>
          )}
        </div>
      </div>
    );
  }

  /** 한 칸(외톨이 줄 하나 또는 짝 카드 한 장) - 카드는 .strip-card로 감싸 강조 테두리가 줄 수와 상관없이 카드 전체에 둘린다(감싼 요소는 display: contents라 배치는 그대로) */
  function renderCard(rows: readonly PaperRow[], isPeek = false): ReactNode {
    if (hasNoise && readNoiseKind(rows[0], model.units) !== null) return renderNoiseBlock(rows, isPeek);
    // 거르기로 접힌 줄을 엿보기로 연 것은 살펴보려는 것이라 삭제 줄도 펼친다
    const folds = strips?.deleted && !isPeek ? strips.deleted.folds : null;
    const unitIds = rows.map((row) => readRowUnitId(row) ?? -1);
    const foldedLine = folds ? readDeletedLine(folds, unitIds) : null;
    // 저장되지 못해 버린 삭제 - 같은 감싸개 안에서 줄이 접히고 박스가 펼쳐진다
    const releasedLine = folds !== null && foldedLine === null ? readDeletedLine(releasedFolds, unitIds) : null;
    const deletedLine = foldedLine ?? releasedLine;
    const renderContent = () => {
      const content = rows.map((row, index) =>
        isFoldedRow(row) ? (
          renderFoldedRow(row)
        ) : (
          <Fragment key={row.key}>
            {index > 0 && !isFoldedRow(rows[index - 1]) && renderGap(rows[index - 1], row)}
            {!isPeek && renderUnwrapHead(row)}
            {renderRow(row, isPeek, rows.length > 1)}
          </Fragment>
        ),
      );
      return rows.length > 1 ? <div className="strip-card">{content}</div> : content;
    };
    if (folds === null || deletedLine === null) return renderContent();
    // 고른 동안만 펼친다 - 줄과 박스를 같은 자리에서 Collapse로 바꿔 펼칠 때 · 접힐 때 전환(움직임 줄이기면 바로). 펼친 박스는 옅은 위험 바탕(삭제 표시는 박스 안 상태 칩)
    const isOpen = releasedLine !== null || isDeletedLineOpen(folds, deletedLine.rowKey, selectedId);
    // 방금 누른 삭제는 감싸지 않은 박스에서 온다 - 처음 붙어도 펼친 모양에서 접기 시작한다
    const isPressed = deletedLine.isPending === true;
    return (
      <>
        <Collapse open={!isOpen} appear={isPressed}>{renderDeletedLine(rows, deletedLine)}</Collapse>
        <Collapse open={isOpen} startOpen={isPressed} className={releasedLine === null ? "deleted-open" : "deleted-release"}>
          {renderContent}
        </Collapse>
      </>
    );
  }


  function renderRows(sectionIndex: number): ReactNode {
    const { cards, groups, isChunked } = cardGroups[sectionIndex];
    const renderCards = (group: CardGroup) =>
      group.cards.map((card, offset) => {
        const index = group.start + offset;
        if (card.every(isFoldedRow)) return <Fragment key={card[0].key}>{card.map(renderFoldedRow)}</Fragment>;
        return (
          <Fragment key={card[0].key}>
            {spot?.marker && spot.marker.afterKey === null && index === 0 && spot.marker.node}
            {index > 0 && renderGap(cards[index - 1][cards[index - 1].length - 1], card[0])}
            {renderTablePlace(cards[index - 1]?.at(-1), card[0])}
            {hasHeadingShift && renderShiftHead(card)}
            {renderCard(card)}
            {spot?.marker && spot.marker.afterKey !== null && card.some((row) => row.key === spot.marker?.afterKey) && spot.marker.node}
          </Fragment>
        );
      });
    if (!isChunked) return groups.length > 0 ? renderCards(groups[0]) : null;
    return groups.map((group) => renderChunk(group.cards[0][0].key, group, [cardGroups], () => renderCards(group)));
  }

  /** 덩어리 하나 - own은 그 보기(펼친 목록 · 접힌 목록)의 줄 구성 */
  function renderChunk(key: string, chunk: ChunkSlot, own: readonly unknown[], render: () => ReactNode): ReactNode {
    return (
      <PaperChunk
        key={key}
        live={nearChunks === null || (chunk.index >= nearChunks.from && chunk.index <= nearChunks.to) || liveChunkIds.has(chunk.index)}
        deps={[...own, t, testId, dragBoxes, pickWholeBundle, strips?.noise?.busy, strips?.noise?.canEdit, shiftGroups, strips?.headingShift?.busy, strips?.headingShift?.canRevert, unwrapHeads, strips?.unwrap?.busy, strips?.unwrap?.canRewrap, strips?.unwrap?.ai?.enabled, strips?.unwrap?.ai?.busy, strips?.unwrap?.follow?.answers, followRows, strips?.unwrap?.follow?.plan?.each, unwrapAiPreviews, unwrapOrders, unwrapAiMoves, strips?.mergeArm, chunkPending[chunk.index], chunkDeleted[chunk.index], chunkNumbers[chunk.index], chunkNoise[chunk.index], overlay ? overlay.keyOf(chunk.unitIds) : ""]}
        isFold={hasFold}
        render={render}
      />
    );
  }

  /** 한 줄 판의 글 - 짝 카드는 줄마다 글을 " / "로, 표·그림은 이름만. 절 머리면 앞머리에 보인 번호를 글에서 뺀다(제 모양 조각과 같이) */
  function readPieceText(row: Extract<PaperRow, { type: "piece" }>): string {
    const unit = row.unitId === null ? undefined : model.units.get(row.unitId);
    return row.parts
      .map((part, partIndex) => {
        const skip = partIndex === 0 ? readHiddenPrefix(part.block, unit) : 0;
        return flattenLineBreaks(part.segments.map((segment) => part.block.text.slice(Math.max(segment.start, skip), segment.end)).join(""));
      })
      .join(" ");
  }

  function readLineText(rows: readonly PaperRow[]): string {
    return rows
      .map((row) => (row.type === "table" ? t("split.table") : row.type === "figure" ? t("assign.newFigure") : readPieceText(row)))
      .map((text) => text.replace(/\s+/g, " ").trim())
      .join(" / ");
  }

  /** 필터 접기 - 맞음·엿보기는 제 조각, 곁은 한 줄 판, 먼 구간은 묶음 한 줄. 틈은 조각끼리 이웃할 때만(덩어리 첫 틈은 앞 덩어리의 끝 줄과) */
  function renderFolded(sectionIndex: number, fold: NonNullable<NonNullable<PaperProps["strips"]>["fold"]>): ReactNode {
    const { cellOf, groups, isChunked } = foldGroups[sectionIndex];
    const renderEntries = (group: FoldGroup) => group.entries.map((entry, at) => renderFoldEntry(entry, at > 0 ? readFoldTail(group.entries[at - 1], cellOf) : group.before, cellOf, fold));
    if (!isChunked) return groups.length > 0 ? renderEntries(groups[0]) : null;
    // 덩어리 key는 자리 번호 - 고른 조각이 엿보기로 끼어 줄이 몇 칸 밀려도 덩어리째 다시 붙이지 않고 경계의 줄만 옮긴다
    return groups.map((group, at) => renderChunk(`fold-${at}`, group, [foldCells, fold.open, group.signature], () => renderEntries(group)));
  }

  function renderFoldEntry(entry: FoldEntry, before: PaperRow | undefined, cellOf: ReadonlyMap<string, FoldCell>, fold: NonNullable<NonNullable<PaperProps["strips"]>["fold"]>): ReactNode {
    const leadWidth = (key: string): number => {
      const first = cellOf.get(key)?.rows[0];
      return (first ? readTabWidth(first) : 0) + STRIP_LEAD_EXTRA;
    };
    const { open, onOpenChange } = fold;
    if (entry.kind === "full" || entry.kind === "peek") {
      const rows = cellOf.get(entry.key)?.rows ?? [];
      return (
        <Fragment key={entry.key}>
          {before && rows[0] && renderGap(before, rows[0])}
          {renderCard(rows, entry.kind === "peek")}
        </Fragment>
      );
    }
    if (entry.kind === "line") {
      const rows = cellOf.get(entry.key)?.rows ?? [];
      const first = rows[0];
      const unitId = first ? readRowUnitId(first) : null;
      const unit = unitId === null ? undefined : model.units.get(unitId);
      const width = first ? readTabWidth(first) : 0;
      // 절 머리면 번호를 남긴다 - 짝 카드는 첫 줄이 first다
      const isHead = unit !== undefined && sectionHeads.has(unit.id);
      const foldNumber = model.hasNumberRanges ? (unit?.number?.value ?? null) : isHead && first ? getSectionPill(readRowSection(first)) : null;
      return (
        <button
          key={`line-${entry.key}`}
          type="button"
          className="fold-line"
          data-testid={`${testId}-fold-line-${entry.key}`}
          onClick={() => onOpenChange({ runs: open.runs, peeks: new Set([...open.peeks, entry.key]) })}
        >
          {unit ? (
            <StripLead width={width} number={foldNumber} dim={foldNumber === null} tip={describeTab(unit)} testId={`${testId}-fold`} id={unit.id} />
          ) : (
            <span className="strip-lead-gap" style={{ width: width + STRIP_LEAD_EXTRA }} />
          )}
          <span className="fold-line-text">{readLineText(rows)}</span>
        </button>
      );
    }
    if (entry.kind === "run") {
      const range = entry.from === "" ? "" : entry.from === entry.to ? entry.from : `${entry.from}–${entry.to}`;
      return (
        <button
          key={`run-${entry.runKey}`}
          type="button"
          className="fold-run"
          style={{ marginLeft: leadWidth(entry.runKey) }}
          aria-expanded={false}
          data-testid={`${testId}-fold-run-${entry.runKey}`}
          onClick={() => onOpenChange({ runs: new Set([...open.runs, entry.runKey]), peeks: open.peeks })}
        >
          <Ellipsis size={14} strokeWidth={1.75} aria-hidden />
          <span>{t("paper.foldRun", { n: entry.count })}</span>
          {range && <span className="fold-run-range">§ {range}</span>}
          <span className="fold-run-act">{t("paper.foldExpand")}</span>
        </button>
      );
    }
    const members = new Set(entry.memberKeys);
    return (
      <button
        key={`head-${entry.runKey}`}
        type="button"
        className="fold-head"
        style={{ marginLeft: leadWidth(entry.runKey) }}
        aria-expanded
        data-testid={`${testId}-fold-head-${entry.runKey}`}
        onClick={() => onOpenChange({ runs: new Set([...open.runs].filter((key) => key !== entry.runKey)), peeks: new Set([...open.peeks].filter((key) => !members.has(key))) })}
      >
        <ChevronsDownUp size={12} strokeWidth={1.75} aria-hidden />
        {t("paper.foldCollapse")}
      </button>
    );
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      if (!pressThroughSelection) return; // 끌어 고르기는 mouseup이 맡는다
      selection.removeAllRanges();
    }
    if (pickWholeBundle && event.altKey) return; // Alt는 글자 긁기 - 고름을 옮기지 않는다
    const target = (event.target as HTMLElement).closest<HTMLElement>(".su[data-unit]");
    if (target) {
      const unitId = Number(target.dataset.unit);
      const pickId = pickWholeBundle ? resolvePickUnit(unitId, model.units) : unitId;
      // 묶음으로 올려 고르면 누른 글자 자리는 그 묶음의 자리가 아니다
      onUnitClick(pickId, pickId === unitId ? readCaret(event.clientX, event.clientY) : null, event);
      return;
    }
    // 조각 끝 아이콘을 눌러도 그 단위를 고른다
    const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-mark-unit]");
    if (mark) {
      const unitId = Number(mark.dataset.markUnit);
      onUnitClick(pickWholeBundle ? resolvePickUnit(unitId, model.units) : unitId, null, event);
      return;
    }
    // 글자 밖 조각 상자(여백·보류 칩·왼쪽 앞머리)를 눌러도 그 단위를 고른다 - 상자 안 단추·손잡이는 제 동작을 한다
    const element = event.target as HTMLElement;
    if (element.closest("button, a, input, [role='slider']")) return;
    const holder = element.closest<HTMLElement>("[data-strip-unit]") ?? element.closest(".strip-lead")?.parentElement?.querySelector<HTMLElement>(":scope > .strip[data-strip-unit]");
    // 표 안에서 칸 조각을 비껴 누른 것(칸 여백·칸 사이 틈)으로 표 전체를 고르지 않는다 - 표 전체는 머리 줄(BundleHead)·표 밖 여백으로(묶음째 고르는 화면은 표 전체)
    if (!pickWholeBundle && holder?.dataset.kind === "table" && element.closest("table")) return;
    // 머리 줄 캡션의 빈자리도 캡션 단위를 가리킨다 - 묶음째 고르는 화면은 그 묶음으로 올린다
    if (holder) onUnitClick(pickWholeBundle ? resolvePickUnit(Number(holder.dataset.stripUnit), model.units) : Number(holder.dataset.stripUnit), null, event);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!onUnitDoubleClick) return;
    const press = pressRef.current;
    const dy = press?.el.isConnected ? press.el.getBoundingClientRect().top - press.top : 0;
    const y = event.clientY + dy;
    const hit = dy === 0 ? (event.target as HTMLElement) : document.elementFromPoint(event.clientX, y);
    const target = hit?.closest<HTMLElement>(".su[data-unit]");
    if (!target) return;
    window.getSelection()?.removeAllRanges();
    onUnitDoubleClick(Number(target.dataset.unit), readCaret(event.clientX, y));
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!onUnitContextMenu) return;
    // 글자를 끌어 고른 채면 브라우저 메뉴(복사)를 그대로 둔다
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const target = event.target as HTMLElement;
    const holder = target.closest<HTMLElement>("[data-strip-unit]") ?? target.closest<HTMLElement>(".su[data-unit]");
    const unitId = Number(holder?.dataset.stripUnit ?? holder?.dataset.unit);
    if (!holder || !Number.isFinite(unitId)) return;
    // 누른 글자 자리도 넘긴다 - Assign의 "Split here"가 그 자리에 나눌 선을 놓는다
    if (onUnitContextMenu(unitId, { x: event.clientX, y: event.clientY }, readCaret(event.clientX, event.clientY)) !== false) event.preventDefault();
  }

  // 두 번 누를 때 브라우저가 낱말을 고르지 않게 - 나눌 자리를 정하는 동작이다
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.detail === 1) {
      const el = (event.target as HTMLElement).closest<HTMLElement>(".strip-row, .su[data-unit]");
      pressRef.current = el ? { el, top: el.getBoundingClientRect().top } : null;
    }
    if (onUnitDoubleClick && event.detail > 1 && (event.target as HTMLElement).closest(".su[data-unit]")) event.preventDefault();
    // Shift+클릭이 여럿 고르기인 화면(Assign, 또는 끌어 고르기가 없는 화면)에서는 브라우저가 글자 선택을 늘려 클릭을 삼키지 않게 - 글 끝 뒤 빈자리 같은
    // 박스 안 글 밖도(끌어 고르기를 켠 New 용지에서 짧은 글의 박스를 누르면 글 밖이다)
    if ((shiftClickPicks || !onRangeSelect) && event.shiftKey && (event.target as HTMLElement).closest(".su[data-unit], [data-strip-unit]")) event.preventDefault();
  }

  function handleMouseUp() {
    if (!onRangeSelect) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const start = readNodeOffset(range.startContainer, range.startOffset);
    const end = readNodeOffset(range.endContainer, range.endOffset);
    // 1차는 한 블록 안 고르기만 - 블록을 넘는 범위는 합치기로 한다
    if (start && end && start.blockId === end.blockId && end.offset > start.offset) {
      onRangeSelect({ blockId: start.blockId, start: start.offset, end: end.offset });
    }
  }

  return (
    <div className="sheet" data-testid={sheetTestId ?? testId}>
      <div
        ref={pageRef}
        className={pageClassName ? `pg ${pageClassName}` : "pg"}
        data-strips={strips ? "" : undefined}
        data-whole-bundle={pickWholeBundle ? "" : undefined}
        data-dragging={isDragging ? "" : undefined}
        data-held={held ? "" : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        {...tip.handlers}
      >
        {strips ? (
          sections.map((section, index) => {
            const content = strips.fold ? renderFolded(index, strips.fold) : renderRows(index);
            return section.edge === null ? (
              <Fragment key="body">{content}</Fragment>
            ) : (
              <div key={section.edge} className={`pg-edge ${section.edge}`}>
                {content}
              </div>
            );
          })
        ) : (
          <>
            {model.header.length > 0 && <div className="pg-edge top grid gap-1">{model.header.map(renderItem)}</div>}
            {(items ?? model.body).map(renderItem)}
            {model.footer.length > 0 && <div className="pg-edge bottom grid gap-1">{model.footer.map(renderItem)}</div>}
          </>
        )}
        {tip.node}
      </div>
    </div>
  );
}
