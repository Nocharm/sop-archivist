// 원문 용지 - 블록을 원문 순서대로 그리고 단위마다 누를 수 있는 조각을 둔다. 용지 안에는 추출한 글자만 둔다(앱 라벨 금지).
// 글자 조각마다 data-start(블록 안 위치)를 달아, 누른 자리·끌어 고른 범위를 블록 위치로 되돌린다.
// strips(Split·Assign)에서는 단위 하나가 종이 한 조각이다 - 확인과 상관없이 처음부터 떨어져 있고, 조각 왼쪽 밖에 언어 색 탭(KO·EN, 보류는 줄무늬)을 붙여 절 번호를 보이고(짝은 이어 붙인 탭 하나), 오른쪽 끝에 아이콘 표시를 둔다.
// 고른 단위는 글자 영역의 가장 바깥 윤곽 하나로 감싼다(contour). 탭은 앱 표시라 aria로 읽히지 않고, 아이콘 표시는 포인터·포커스 툴팁으로 뜻을 알린다.
"use client";

import { CircleCheck, FoldVertical, FolderCheck, ImageIcon, Link2, Scissors, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { FigureImage } from "@/components/paper/figure-image";
import { Collapse } from "@/components/ui/motion";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import type { ViewBlock, ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { buildContourPath, buildRows, getGapMerge, getMarks, getTags, MERGE_BLOCKER_KEYS, type PaperItem, type PaperModel, type PaperRow, type Segment, type UnitMark } from "@/lib/paper-model";
import { getPairBrackets, getPillWidth, getSectionHeads, getTabWidths, getSectionLevel, getSectionPill, type PairBracket } from "@/lib/strip-pill-model";

/** 조각 끝 표시 - 단위의 것(UnitMark)에 그 조각이 놓인 블록의 경고를 더한다 */
type PaperMark = UnitMark | "warn";

const MARK_ICONS: Record<PaperMark, typeof CircleCheck> = {
  edited: Scissors,
  pair: Link2,
  classified: FolderCheck,
  ai: Sparkles,
  suggest: WandSparkles,
  warn: TriangleAlert,
  checked: CircleCheck,
};
const MARK_ORDER: readonly PaperMark[] = ["edited", "pair", "classified", "ai", "suggest", "warn", "checked"];
const MARK_LABELS: Record<PaperMark, string> = {
  edited: "split.legendEdited",
  pair: "split.legendPair",
  classified: "split.legendClassified",
  ai: "split.legendAi",
  suggest: "split.markSuggest",
  warn: "split.markWarn",
  checked: "split.legendChecked",
};

function readRowUnitId(row: PaperRow): number | null {
  return row.type === "table" ? row.item.unitId : row.unitId;
}

/** 줄이 놓인 첫 블록의 절 번호 - 표는 없다 */
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

interface PaperProps {
  model: PaperModel;
  /** 이 용지에 그릴 것 - 주면 그 한 쪽만(Split의 탭·쪽), 없으면 머리말·본문·꼬리말을 한 장에 */
  items?: readonly PaperItem[];
  selectedId: number | null;
  /** 함께 밑줄을 긋는 단위(분류에서 짝의 두 쪽) */
  highlightIds?: ReadonlySet<number>;
  /** 고른 단위의 한/영 짝 - 조각 바탕과 왼쪽 막대로 알린다 */
  partnerIds?: ReadonlySet<number>;
  /** 짝 맞추기로 고른 단위 */
  pickedIds?: ReadonlySet<number>;
  /** 나눌 자리 미리 보기(고른 단위 안) */
  cut?: PaperCut | null;
  /** 누락 의심 등 경고가 걸린 블록 - 물결 밑줄 */
  warnBlockIds?: ReadonlySet<number>;
  /** 끝난 단위는 흐리게(분류에서 확정) */
  isDone?: (unitId: number) => boolean;
  onUnitClick: (unitId: number, at: { blockId: number; offset: number } | null, event: MouseEvent) => void;
  onRangeSelect?: (range: { blockId: number; start: number; end: number }) => void;
  /** 그림을 받을 묶음·문서 - 없으면 그림 자리 상자만 */
  figureSource?: { bundleId: number; docId: number };
  /** 단위·조각·표시 testid의 앞말 */
  testId: string;
  /** 용지 자체의 testid - 한 화면에 용지가 여럿일 때(없으면 testId) */
  sheetTestId?: string;
  /** 단위마다 종이 조각으로, 앞에 태그, 끝에 표시. isChecked는 먼저 칠한 경계 확인까지 본다 */
  strips?: {
    isChecked: (unit: ViewUnit) => boolean;
    /** Split - 조각 사이의 위아래 합치기. 없으면 틈만 둔다(Assign) */
    merge?: { busy: boolean; onMerge: (firstId: number, secondId: number) => void };
    /** Split - 언어가 달라 못 합치는 틈에서 두 문장을 한/영 짝으로(짝 지을 수 있을 때만 합치기 대신) */
    pair?: { canPair: (firstId: number, secondId: number) => boolean; onPair: (firstId: number, secondId: number) => void };
    /** Assign - 경계 확인 표시는 뺀다 */
    hideChecked?: boolean;
    /** Assign - 보기를 다시 부르지 않아도 지금 커버 상태로 표시한다 */
    statusOf?: (unitId: number) => ViewUnit["status"] | undefined;
    /** Assign - 조각 아래 한 줄(간 곳) */
    renderNote?: (unitIds: number[]) => ReactNode;
    /** Assign - 조각 오른쪽 칸(연결 배지). 비면 폭을 차지하지 않는다 */
    renderPills?: (unitId: number) => ReactNode;
  };
  /** 고른 단위를 밑줄 대신 바깥 윤곽으로 감싼다 */
  contour?: boolean;
  /** strips에서 고른 조각의 글 바로 아래 줄(확인·짝 풀기 등 단추) - 조각 상자가 펼쳐지며 밀려 내려오고, 고름이 옮겨 가면 접힌다 */
  renderUnitActions?: (unitId: number) => ReactNode;
  /** 나눌 선 자리에 붙는 것(나누기 팝업) - 선을 끄는 동안에는 그리지 않는다 */
  renderAtCut?: () => ReactNode;
  /** 나눌 선을 끌어 옮긴다 - 주면 선에 손잡이가 붙는다 */
  onCutDrag?: (pos: CutDragPos) => void;
  /** 손잡이에서 ← →로 한 자리씩 */
  onCutNudge?: (step: 1 | -1) => void;
  onUnitDoubleClick?: (unitId: number, at: { blockId: number; offset: number } | null) => void;
  /** 문장 줄을 우클릭하거나 메뉴 글쇠를 눌렀다 - 주면 브라우저 메뉴 대신 이 콜백이 불린다(Split) */
  onUnitContextMenu?: (unitId: number, at: { x: number; y: number }) => void;
}

/** 화면 좌표 → 블록 위치. 글자 조각 요소의 data-start에 글자 노드 안 위치를 더한다 */
function readCaret(x: number, y: number): { blockId: number; offset: number } | null {
  let node: Node | null = null;
  let nodeOffset = 0;
  if ("caretPositionFromPoint" in document) {
    const pos = document.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    nodeOffset = pos?.offset ?? 0;
  } else if ("caretRangeFromPoint" in document) {
    // Safari 등 구형 API
    const range = (document as Document & { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    nodeOffset = range?.startOffset ?? 0;
  }
  return node ? readNodeOffset(node, nodeOffset) : null;
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
  cut,
  warnBlockIds,
  isDone,
  onUnitClick,
  onRangeSelect,
  figureSource,
  testId,
  sheetTestId,
  strips,
  contour = false,
  renderUnitActions,
  renderAtCut,
  onCutDrag,
  onCutNudge,
  onUnitDoubleClick,
  onUnitContextMenu,
}: PaperProps) {
  const { t } = useI18n();
  const pageRef = useRef<HTMLDivElement>(null);
  // 첫 누름 때 누른 조각과 그 높이 - 고르자마자 곁 틈이 벌어져 글이 밀려도 두 번 누름(나눌 자리)을 처음 누른 글자로 되돌린다
  const pressRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const [contourPath, setContourPath] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const tip = useDelegatedTip();
  const hasStrips = strips !== undefined;
  // 단추 줄을 그리는 조각 - 지금 고른 것과 바로 전에 고른 것(접히는 동안). 수천 조각마다 접기 부품을 두지 않는다
  const [actionIds, setActionIds] = useState({ current: selectedId, previous: null as number | null });
  if (actionIds.current !== selectedId) setActionIds({ current: selectedId, previous: actionIds.current });

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
    return lists.filter((list) => list.items.length > 0).map((list) => ({ edge: list.edge, rows: buildRows(list.items, model.segments) }));
  }, [hasStrips, items, model]);
  // 짝 - 단위 → 짝 단위, 이웃한 짝은 한 괄호로 묶는다(같은 쪽·같은 부분의 바로 이웃만)
  const partnerOf = useMemo(() => {
    const byPair = new Map<number, ViewUnit[]>();
    for (const unit of model.units.values()) {
      if (unit.pair_id === null) continue;
      byPair.set(unit.pair_id, [...(byPair.get(unit.pair_id) ?? []), unit]);
    }
    const map = new Map<number, ViewUnit>();
    for (const members of byPair.values()) {
      members.sort((a, b) => a.pos_seq - b.pos_seq);
      if (members.length === 2) {
        map.set(members[0].id, members[1]);
        map.set(members[1].id, members[0]);
      }
    }
    return map;
  }, [model]);
  const brackets = useMemo(() => {
    const map = new Map<number, PairBracket>();
    for (const section of sections) {
      const entries = section.rows.map((row) => {
        const unitId = readRowUnitId(row);
        return { unitId: unitId ?? -1, partnerId: unitId === null ? null : (partnerOf.get(unitId)?.id ?? null) };
      });
      for (const [unitId, bracket] of getPairBrackets(entries)) map.set(unitId, bracket);
    }
    return map;
  }, [sections, partnerOf]);
  // 고른 조각 곁 틈을 벌릴 조각 - 이웃한 짝은 한 카드라 고른 쪽이 위든 아래든 카드 위아래가 같이 벌어진다
  const selectedBlock = useMemo(() => {
    const ids = new Set<number>();
    if (selectedId === null) return ids;
    ids.add(selectedId);
    const partner = partnerOf.get(selectedId);
    if (partner && brackets.has(selectedId)) ids.add(partner.id);
    return ids;
  }, [selectedId, partnerOf, brackets]);
  // 절 번호를 보일 첫 줄 - 부분(머리글·본문·바닥글)마다 문서 순서로
  const sectionHeads = useMemo(() => {
    const heads = new Set<number>();
    for (const section of sections) {
      const units = section.rows.flatMap((row) => {
        const unitId = readRowUnitId(row);
        if (row.type === "table" || unitId === null) return [];
        return [{ unitId, part: section.edge ?? "body", sectionLabel: readRowSection(row), pairTopOf: brackets.get(unitId) === "bottom" ? (partnerOf.get(unitId)?.id ?? null) : null }];
      });
      for (const unitId of getSectionHeads(units)) heads.add(unitId);
    }
    return heads;
  }, [sections, brackets, partnerOf]);
  // 줄마다 탭 폭 - 번호 없는 줄은 직전 줄 폭, 짝은 한 폭(부분마다 문서 순서로)
  const tabWidths = useMemo(() => {
    const rows = sections.flatMap((section) =>
      section.rows.map((row) => {
        const unitId = readRowUnitId(row);
        const topId = unitId !== null && brackets.get(unitId) === "bottom" ? (partnerOf.get(unitId)?.id ?? null) : null;
        const topRow = topId === null ? undefined : section.rows.find((candidate) => readRowUnitId(candidate) === topId);
        return { key: row.key, part: section.edge ?? "body", sectionLabel: readRowSection(row), pairTopOf: topRow?.key ?? null };
      }),
    );
    return getTabWidths(rows);
  }, [sections, brackets, partnerOf]);
  // 표 칸 안의 조각 줄 - 칸이 많은 표에서 고를 때마다 다시 펴지 않게
  const cellRows = useMemo(() => {
    const map = new Map<number, PaperRow[]>();
    if (!hasStrips) return map;
    for (const item of items ?? [...model.header, ...model.body, ...model.footer]) {
      if (item.type !== "table") continue;
      for (const row of item.rows) for (const cell of row) map.set(cell.id, buildRows([{ type: "block", block: cell }], model.segments));
    }
    return map;
  }, [hasStrips, items, model]);

  // 고른 단위의 바깥 윤곽 - 그린 뒤 글자 상자를 재서 SVG path로. 창·글꼴이 바뀌면 다시 잰다
  useEffect(() => {
    const page = pageRef.current;
    if (!contour || !page) return;
    const measure = () => {
      const base = page.getBoundingClientRect();
      const rects =
        selectedId === null
          ? []
          : Array.from(page.querySelectorAll<HTMLElement>(`.su[data-unit="${selectedId}"] [data-start]`)).flatMap((piece) =>
              Array.from(piece.getClientRects()).map((rect) => ({ left: rect.left - base.left, right: rect.right - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top })),
            );
      setContourPath(buildContourPath(rects.filter((rect) => rect.right - rect.left > 0.5)));
    };
    let frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    observer.observe(page);
    // 단추 줄이 접히고 펼쳐지거나 틈이 벌어지는 동안 글이 움직인다 - 위아래가 상쇄돼 용지 높이가 그대로면 ResizeObserver가 울리지 않으니 전환 동안 프레임마다 잰다
    let running = 0;
    const tick = () => {
      measure();
      if (running > 0) frame = requestAnimationFrame(tick);
    };
    const isLayoutTransition = (event: TransitionEvent) => event.propertyName === "grid-template-rows" || event.propertyName === "height";
    const handleRun = (event: TransitionEvent) => {
      if (!isLayoutTransition(event)) return;
      running += 1;
      if (running === 1) frame = requestAnimationFrame(tick);
    };
    const handleEnd = (event: TransitionEvent) => {
      if (!isLayoutTransition(event)) return;
      running = Math.max(0, running - 1);
      if (running === 0) measure();
    };
    page.addEventListener("transitionrun", handleRun);
    page.addEventListener("transitionend", handleEnd);
    page.addEventListener("transitioncancel", handleEnd);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      page.removeEventListener("transitionrun", handleRun);
      page.removeEventListener("transitionend", handleEnd);
      page.removeEventListener("transitioncancel", handleEnd);
    };
  }, [contour, selectedId, model, cut, items]);

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

  function renderSegment(block: ViewBlock, segment: Segment, index: number): ReactNode {
    const text = block.text.slice(segment.start, segment.end);
    if (segment.unitId === null) {
      return (
        <span key={index} data-start={segment.start}>
          {text}
        </span>
      );
    }
    const unit = model.units.get(segment.unitId);
    // 여러 범위에 걸친 단위는 범위의 첫 자리도 나눌 자리다(>=)
    const isCutHere = cut && cut.blockId === block.id && cut.offset >= segment.start && cut.offset < segment.end && segment.unitId === selectedId;
    return (
      <span key={index} className="contents">
        <span
          className="su"
          lang={unit?.lang === "neutral" ? undefined : unit?.lang}
          data-unit={segment.unitId}
          data-testid={`${testId}-unit-${segment.unitId}`}
          data-sel={segment.unitId === selectedId || highlightIds?.has(segment.unitId) ? "" : undefined}
          data-pick={pickedIds?.has(segment.unitId) ? "" : undefined}
          data-warn={warnBlockIds?.has(block.id) ? "" : undefined}
          data-done={isDone?.(segment.unitId) ? "" : undefined}
          data-cut={isCutHere ? "" : undefined}
        >
          {isCutHere ? (
            <>
              <span className="cut-a" data-start={segment.start}>
                {block.text.slice(segment.start, cut.offset)}
              </span>
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
              <span className="cut-b" data-start={cut.offset}>
                {block.text.slice(cut.offset, segment.end)}
              </span>
            </>
          ) : (
            <span data-start={segment.start}>{text}</span>
          )}
        </span>
      </span>
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

  /** 조각 끝 아이콘 표시 - 고른 조각의 것만 Tab으로 닿는다(수천 개가 Tab 순서에 들지 않게) */
  function renderMarks(unit: ViewUnit | undefined, hasWarn: boolean, className: string): ReactNode {
    if (!strips) return null;
    const marks = new Set<PaperMark>();
    if (unit) {
      for (const mark of getMarks({ ...unit, status: strips.statusOf?.(unit.id) ?? unit.status })) if (mark !== "checked") marks.add(mark);
      if (strips.isChecked(unit) && !strips.hideChecked) marks.add("checked");
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
              tabIndex={unit !== undefined && unit.id === selectedId ? 0 : -1}
              data-testid={`${testId}-mark-${mark}-${unit?.id ?? "x"}`}
            >
              <Icon size={14} strokeWidth={mark === "checked" ? 2 : 1.6} className={`pmark ${mark}`} aria-hidden />
            </span>
          );
        })}
      </span>
    );
  }

  /** 두 줄 사이의 위아래 합치기 - 못 합치는 자리는 꺼 두고 까닭을 툴팁으로. 언어가 달라 못 합치지만 짝을 지을 수 있으면 짝 짓기로 바꾼다 */
  function renderMerge(prev: PaperRow, next: PaperRow): ReactNode {
    const merge = strips?.merge;
    const gap = merge ? getGapMerge(prev, next, model.units) : null;
    if (!merge || !gap) return null;
    const pair = strips?.pair;
    if (pair && gap.blocker === "mixed_language" && pair.canPair(gap.firstId, gap.secondId)) {
      const pairLabel = t("split.pairAdjacent");
      return (
        <button
          type="button"
          className="strip-merge strip-pair"
          aria-disabled={merge.busy ? "true" : undefined}
          aria-label={pairLabel}
          tabIndex={gap.firstId === selectedId || gap.secondId === selectedId ? 0 : -1}
          data-testid={`${testId}-pair-${gap.firstId}-${gap.secondId}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!merge.busy) pair.onPair(gap.firstId, gap.secondId);
          }}
        >
          <Link2 size={12} strokeWidth={1.8} aria-hidden />
          <span className="strip-merge-label">{pairLabel}</span>
        </button>
      );
    }
    const label = t("split.mergeAdjacent");
    const reason = gap.blocker ? t(MERGE_BLOCKER_KEYS[gap.blocker]) : null;
    const isOff = reason !== null || merge.busy;
    return (
      <button
        type="button"
        className="strip-merge"
        // disabled 대신 aria-disabled - 포커스와 포인터를 받아야 까닭을 보일 수 있다
        aria-disabled={isOff ? "true" : undefined}
        aria-label={reason ? `${label} - ${reason}` : label}
        data-tip={reason ?? undefined}
        tabIndex={gap.firstId === selectedId || gap.secondId === selectedId ? 0 : -1}
        data-testid={`${testId}-merge-${gap.firstId}-${gap.secondId}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!isOff) merge.onMerge(gap.firstId, gap.secondId);
        }}
      >
        <FoldVertical size={12} strokeWidth={1.8} aria-hidden />
        <span className="strip-merge-label">{label}</span>
      </button>
    );
  }

  /** 한 줄의 언어·보류를 읽어 줄 글 */
  function describeTab(unit: ViewUnit): string {
    const live = { ...unit, status: strips?.statusOf?.(unit.id) ?? unit.status };
    const { lang, hold } = getTags(live);
    return [lang === "KO" ? t("split.tabKo") : lang === "EN" ? t("split.tabEn") : null, hold ? t("split.tabHold") : null].filter((part) => part !== null).join(", ");
  }

  /** 줄 왼쪽 밖에 붙는 탭 - 언어 색(보류는 사선 줄무늬), 깊이마다 정해진 폭, 절 번호는 절의 첫 블록에만. 짝 카드는 두 줄의 탭이 이어져 한 카드의 탭이 된다 */
  function renderTab(unit: ViewUnit, section: string, width: number, bracket: PairBracket | undefined): ReactNode {
    const live = { ...unit, status: strips?.statusOf?.(unit.id) ?? unit.status };
    const { lang, hold } = getTags(live);
    const partner = bracket === "top" || bracket === "bottom" ? partnerOf.get(unit.id) : undefined;
    const top = bracket === "bottom" && partner ? partner : unit;
    const isHead = sectionHeads.has(top.id);
    const sectionNumber = isHead && bracket !== "bottom" ? getSectionPill(section) : null;
    // 설명은 블록(카드)당 하나 - 짝의 아래 줄은 위 줄이 대신 읽는다
    const description = bracket === "bottom" ? "" : [describeTab(unit), bracket === "top" && partner ? describeTab(partner) : ""].filter((part) => part !== "").join("; ");
    const letters = [lang, hold ? "H" : null].filter((part) => part !== null);
    return (
      <span
        className="strip-tab"
        style={{ width }}
        data-lang={lang?.toLowerCase()}
        data-hold={hold ? "" : undefined}
        data-bracket={bracket}
        data-dim={isHead ? undefined : ""}
        data-testid={`${testId}-tab-${unit.id}`}
      >
        {description !== "" && <span className="sr-only">{description}</span>}
        {sectionNumber !== null && (
          <>
            <span className="sr-only">{sectionNumber}</span>
            <span className="strip-tab-num" aria-hidden data-testid={`${testId}-num-${unit.id}`}>
              {sectionNumber}
            </span>
          </>
        )}
        <span className="strip-tab-letters" aria-hidden>
          {letters.map((letter) => (
            <span key={letter}>{letter}</span>
          ))}
        </span>
      </span>
    );
  }

  /** 표 칸 - 칸 문장마다 작은 조각으로 나누고 같은 칸의 이웃 조각 사이에 합치기를 둔다 */
  function renderCell(cell: ViewBlock): ReactNode {
    if (!strips) return <p data-block={cell.id}>{renderBlockText(cell)}</p>;
    const rows = cellRows.get(cell.id) ?? [];
    if (rows.length === 0) return <p data-block={cell.id} />;
    return rows.map((row, index) => {
      if (row.type !== "piece") return null;
      const unit = row.unitId === null ? undefined : model.units.get(row.unitId);
      return (
        <Fragment key={row.key}>
          {index > 0 && <div className="cell-gap">{renderMerge(rows[index - 1], row)}</div>}
          <div
            className="cell-piece"
            data-strip-unit={unit?.id}
            data-sel={unit !== undefined && unit.id === selectedId ? "" : undefined}
            data-partner={unit !== undefined && partnerIds?.has(unit.id) ? "" : undefined}
            data-testid={unit ? `${testId}-piece-${unit.id}` : undefined}
          >
            {renderMarks(unit, false, "cell-marks")}
            <p data-block={cell.id}>{row.parts[0].segments.map((segment, at) => renderSegment(cell, segment, at))}</p>
            {renderActions(unit?.id)}
          </div>
        </Fragment>
      );
    });
  }

  function renderTable(item: Extract<PaperItem, { type: "table" }>): ReactNode {
    const tableUnit = item.unitId === null ? null : model.units.get(item.unitId);
    return (
      <div className="grid gap-1">
        {tableUnit && (
          // 표 전체를 한 단위로 고르는 손잡이 - 글자 없이 선만 보인다(용지에 앱 글자를 넣지 않는다)
          <button
            type="button"
            className="ptbl-cap h-2.5 p-0"
            aria-label={tableUnit.display_id}
            data-unit={tableUnit.id}
            data-testid={`${testId}-unit-${tableUnit.id}`}
            data-sel={tableUnit.id === selectedId || highlightIds?.has(tableUnit.id) ? "" : undefined}
            onClick={(event) => onUnitClick(tableUnit.id, null, event)}
          />
        )}
        <table className="ptbl">
          <tbody>
            {item.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell) => (
                  <td key={cell.id} colSpan={cell.grid_span} rowSpan={cell.row_span}>
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderFigure(block: ViewBlock): ReactNode {
    return (
      <figure className="pfig">
        {figureSource && block.has_image ? (
          <FigureImage bundleId={figureSource.bundleId} docId={figureSource.docId} blockId={block.id} />
        ) : (
          <span className="pfig-box" aria-hidden>
            <ImageIcon size={28} strokeWidth={1.5} />
          </span>
        )}
        <p data-block={block.id}>{renderBlockText(block)}</p>
      </figure>
    );
  }

  /** strips 없이 - 문단을 그대로 잇는다 */
  function renderItem(item: PaperItem): ReactNode {
    if (item.type === "table") return <Fragment key={`t${item.table.id}`}>{renderTable(item)}</Fragment>;
    const { block } = item;
    if (block.kind === "figure") return <Fragment key={block.id}>{renderFigure(block)}</Fragment>;
    return (
      <p key={block.id} data-block={block.id} className={block.heading_level !== null ? "h" : undefined}>
        {renderBlockText(block)}
      </p>
    );
  }

  function readTabWidth(row: PaperRow): number {
    return tabWidths.get(row.key) ?? getPillWidth(getSectionLevel(readRowSection(row)));
  }

  /** 조각 한 줄 - 글 조각, 표, 그림 모두 같은 틀(앞 태그·끝 표시)에 담는다 */
  function renderRow(row: PaperRow): ReactNode {
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
    return (
      <div key={row.key} className="strip-row">
        {unit && renderTab(unit, section, width, bracket)}
        {!unit && <span className="strip-tab-gap" style={{ width }} />}
        <div
          className="strip"
          data-kind={row.type}
          data-sel={unit !== undefined && unit.id === selectedId ? "" : undefined}
          data-partner={unit !== undefined && partnerIds?.has(unit.id) ? "" : undefined}
          data-bracket={bracket}
          data-strip-unit={unitId ?? undefined}
          data-testid={`${testId}-piece-${unitId ?? row.key}`}
        >
          {row.type === "table"
            ? renderTable(row.item)
            : row.type === "figure"
              ? renderFigure(row.block)
              : row.parts.map((part) => (
                  <p key={part.block.id} data-block={part.block.id} className={part.block.heading_level !== null ? "h" : undefined}>
                    {part.segments.map((segment, index) => renderSegment(part.block, segment, index))}
                  </p>
                ))}
          {renderActions(unit?.id)}
          {foot}
          {pills}
          {renderMarks(unit, hasWarn, "strip-marks")}
        </div>
      </div>
    );
  }

  function renderRows(rows: PaperRow[]): ReactNode {
    return rows.map((row, index) => (
      <Fragment key={row.key}>
        {index > 0 && (
          <div
            className="strip-gap"
            data-pair={brackets.get(readRowUnitId(rows[index - 1]) ?? -1) === "top" && brackets.get(readRowUnitId(row) ?? -1) === "bottom" ? "" : undefined}
            data-near-selected={selectedBlock.has(readRowUnitId(rows[index - 1]) ?? -1) || selectedBlock.has(readRowUnitId(row) ?? -1) ? "" : undefined}
            // 합치기 단추를 글 시작 x에 - 위아래 탭 중 넓은 쪽 뒤라 어느 탭에도 걸치지 않는다
            style={{ "--gap-tab": `${Math.max(readTabWidth(rows[index - 1]), readTabWidth(row))}px` }}
            data-testid={`${testId}-gap-${row.key}`}
          >
            {renderMerge(rows[index - 1], row)}
          </div>
        )}
        {renderRow(row)}
      </Fragment>
    ));
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // 끌어 고르기는 mouseup이 맡는다
    const target = (event.target as HTMLElement).closest<HTMLElement>(".su[data-unit]");
    if (target) {
      onUnitClick(Number(target.dataset.unit), readCaret(event.clientX, event.clientY), event);
      return;
    }
    // 조각 끝 아이콘을 눌러도 그 단위를 고른다
    const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-mark-unit]");
    if (mark) {
      onUnitClick(Number(mark.dataset.markUnit), null, event);
      return;
    }
    // 글자 밖 조각 상자(여백·왼쪽 탭)를 눌러도 그 단위를 고른다 - 상자 안 단추·손잡이는 제 동작을 한다
    const element = event.target as HTMLElement;
    if (element.closest("button, a, input, [role='slider']")) return;
    const holder = element.closest<HTMLElement>("[data-strip-unit]") ?? element.closest(".strip-tab")?.parentElement?.querySelector<HTMLElement>(":scope > .strip[data-strip-unit]");
    // 표 안에서 칸 조각을 비껴 누른 것(칸 여백·칸 사이 틈)으로 표 전체를 고르지 않는다 - 표 전체는 표 위 손잡이·표 밖 여백으로
    if (holder?.dataset.kind === "table" && element.closest("table")) return;
    if (holder) onUnitClick(Number(holder.dataset.stripUnit), null, event);
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
    event.preventDefault();
    onUnitContextMenu(unitId, { x: event.clientX, y: event.clientY });
  }

  // 두 번 누를 때 브라우저가 낱말을 고르지 않게 - 나눌 자리를 정하는 동작이다
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.detail === 1) {
      const el = (event.target as HTMLElement).closest<HTMLElement>(".strip-row, .su[data-unit]");
      pressRef.current = el ? { el, top: el.getBoundingClientRect().top } : null;
    }
    if (onUnitDoubleClick && event.detail > 1 && (event.target as HTMLElement).closest(".su[data-unit]")) event.preventDefault();
    // 끌어 고르기가 없는 화면(Assign)에서 Shift+클릭은 여럿 고르기다 - 브라우저가 글자 선택을 늘려 클릭을 삼키지 않게
    if (!onRangeSelect && event.shiftKey && (event.target as HTMLElement).closest(".su[data-unit]")) event.preventDefault();
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
        className="pg"
        data-strips={strips ? "" : undefined}
        data-contour={contour ? "" : undefined}
        data-dragging={isDragging ? "" : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        {...tip.handlers}
      >
        {contour && contourPath && (
          <svg className="sel-contour" aria-hidden>
            <path d={contourPath} />
          </svg>
        )}
        {strips ? (
          sections.map((section) =>
            section.edge === null ? (
              <Fragment key="body">{renderRows(section.rows)}</Fragment>
            ) : (
              <div key={section.edge} className={`pg-edge ${section.edge}`}>
                {renderRows(section.rows)}
              </div>
            ),
          )
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
