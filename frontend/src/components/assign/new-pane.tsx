// Assign 오른쪽 - 아직 쓰지 않은 New 문서(지금까지의 배정으로 엮은 문서, 서버 결과물 C 규칙, 읽기 전용 미리 보기). 이미 쓴 문서는 Old와 같은 용지(new-paper)가 그린다.
// Old와 같은 줄 틀(StripBox, 시안 2 D6): 칸 머리는 번호 칸에 칸 번호가 든 제목 박스, 줄 앞머리는 결과물 C와 같은 줄마다 자기 번호 · 글머리 기호(composed.strips), 본문 위 줄에 출처 칩,
// 위 테두리 오른쪽에 올리거나 고를 때만 KO/EN 탭(짝은 모두), 이웃한 한/영 같은 의미 줄은 짝 카드. 번호 칸은 C 번호 표시를 고르고(ComposedNumberCell),
// 고른 Old 줄에서 온 박스는 고름 테두리와 왼쪽 손잡이(순서 · 칸 옮기기, lib/use-composed-grip).
// 칩 = 붙은 Old 출처(누르면 Old의 그 조각으로). 빈 칸은 옅은 자리 박스, 문장을 받지 않는 절은 자리 표시가 없다 - 묶음은 칸 머리만, 앱이 채우는 목록(자식 WI)은 읽기만 하는 박스다.
// 두 문장 사이에 Old 조각을 놓았으면 그 자리에 저장 전 문장(점선 초안), 빈 칸에 놓았으면 그 자리 표시에 강조 테두리(끌어서 보내기).
// 고른 Old 줄을 더 이을 수 있는 확정 문장(joinableIds)은 눌러 작은 메뉴를 연다(onJoinPick) - 그 밖의 문장은 읽기만 한다.
// 줄 상자(.new-item)마다 data-row(t:<id> | slot:<칸>) - 끄는 동안 놓을 자리를 이것으로 읽는다.
// 칩 오른쪽 갈매기는 그 Old 조각이 왼쪽 칸 화면 위·아래 밖에 있다는 표시 - 스크롤마다 바뀌어 LinkLines가 data-dir로 단다(Old 배지와 같은 방식).
// AI 제안 거르기(aiFilter, lib/new-ai-filter-model)가 걸리면 고른 줄의 제안·간 곳은 강조 테두리와 꼬리표, 다른 줄의 AI 제안은 칸마다 띠 하나로 접히고(누르면 흐리게 펼침), 나머지 줄은 흐리다.
// 줄이 새로 들어오면 펼치며 나타나고 빠지면 접히며 사라진다(확정이 곧 보이는 실시간 넣기). 표·그림은 실제 표(좌우 스크롤)·그림 이미지로 보인다(new-bundle.tsx).
// 클릭 배치(place, MD 2 S3) - Old 줄을 고른 채면 칸 머리 · 빈 칸 · 번호 줄 사이 틈을 눌러 보낼 곳을 고른다(칠하기 · 꼬리표는 CSS :hover).
// 머리의 "기본 | 템플릿" 전환(viewSwitch)으로 같은 줄을 회사 템플릿 모양(components/template/template-view)으로도 본다 - 템플릿이면 몸에 그 보기를 그린다.
"use client";

import { FilePlus2, FoldVertical, GripVertical, Link2, Sparkles, Spline } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { NewBundle } from "@/components/assign/new-bundle";
import { NewAiTag, SourceChips } from "@/components/assign/new-sources";
import { getSpotAttrs, PlaceGap, type PlaceSpotView } from "@/components/assign/place-spot";
import { PaneZoom } from "@/components/assign/pane-zoom";
import { LangToken } from "@/components/paper/lang-token";
import { PartTabs } from "@/components/paper/part-tabs";
import { ComposedNumberCell, type ComposedStyleChoice } from "@/components/paper/number-cell";
import { DeviationMark, EmptyRequiredMark } from "@/components/tobe/deviation-mark";
import { StripBox } from "@/components/paper/strip-box";
import { StripLead, STRIP_LEAD_EXTRA } from "@/components/paper/strip-lead";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { Collapse, Truncate } from "@/components/ui/motion";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { ComposedDoc } from "@/lib/api-sop";
import type { DraftLine } from "@/lib/assign-drop-model";
import type { PlaceEdit } from "@/lib/c-edit-model";
import { isMousePress } from "@/lib/assign-key-target";
import { readCaretPoint } from "@/lib/caret-point";
import { diffRows, getNewRowKey, readSectionNumber, type ComposedHead, type ComposedRow, type ComposedStrips, type EmptySlotRow, type SectionMark } from "@/lib/composed-model";
import { useComposedGrip } from "@/lib/use-composed-grip";
import { useI18n } from "@/lib/i18n";
import { readNewAiSectionKey, type NewAiFilter } from "@/lib/new-ai-filter-model";
import type { JoinKind, JoinPlan } from "@/lib/split-menu-model";
import { getCardTops, getPairBrackets, getPillWidth, type PairBracket } from "@/lib/strip-pill-model";

/** 클릭 배치의 자리(MD 2 S3) - heads는 칸 첫 줄의 키(getNewRowKey)로 그 칸 머리(빈 칸이면 자리 표시도 같은 자리), gaps는 "before:<id>" · "after:<id>" */
export interface NewPlaceSpots {
  heads: ReadonlyMap<string, PlaceSpotView>;
  gaps: ReadonlyMap<string, PlaceSpotView>;
  /** AI 제안 줄 - mine은 고른 줄의 제안(누르면 그 AI 추천을 고른 것과 같다), other는 다른 줄의 제안(누를 수 없고 올리면 aiOtherTip) */
  aiLines: ReadonlyMap<number, "mine" | "other">;
  aiOtherTip: string;
  onPickAi: (targetId: number, isMouse: boolean) => void;
}

/** 엮은 문서의 줄 - 문장 · 표 · 그림이거나 빈 칸 */
type PaneRow = ComposedRow | EmptySlotRow;

interface NewPaneProps {
  /** 누른 문단 안에 펼쳐 넣을 단추 줄(그 자리 메뉴) - targetId 줄의 글 아래에 미끄러지듯 열린다 */
  lineActions?: { targetId: number; node: ReactNode } | null;
  /** 그림 이미지를 받을 묶음 */
  bundleId: number;
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  rows: PaneRow[];
  /** 엮은 문서의 칸 머리(section_path) → 칸 제목 출처("← OLD-1 §5") - 서버 값 그대로 칸 이름 뒤에 흐리게 */
  headingNotes?: ReadonlyMap<string, string>;
  /** 엮은 문서의 칸 머리(section_path) → 표준과 다름 · 비어 있음 알림 - 칸 이름 뒤에 */
  sectionMarks?: ReadonlyMap<string, SectionMark>;
  /** 줄 들고 남의 기준 - 바뀌면(문서를 바꿈·처음 받음) 움직임 없이 새로 시작한다 */
  rowsKey: string;
  /** 머리 표지 */
  tag: string;
  /** 엮은 문서에서 고른 Old 줄을 더 이을 수 있는 문장(target id) - 이 문장들만 누를 수 있다. 없으면 모두 읽기만 */
  joinableIds?: ReadonlySet<number>;
  /** 이을 수 있는 문장을 누름 - anchor는 그 줄 상자(메뉴가 붙는다) */
  onJoinPick?: (targetId: number, anchor: HTMLElement, event: MouseEvent) => void;
  /** 더 이을 곳으로 고른 문장 */
  pickedIds: ReadonlySet<number>;
  sourceLabel: (unitId: number) => string;
  /** 출처 칩을 누름 - Old의 그 조각으로 간다 */
  onJumpSource: (unitId: number, targetId: number) => void;
  /** 방금 확정해 보낸 문장 - seq가 바뀌면 한 번, 그 문장이 그려지는 대로 화면에 들인다(새로 들어온 줄이 아니면 번쩍임도) */
  live: { seq: number; targetIds: number[] } | null;
  onReveal: (el: HTMLElement, flash: boolean) => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
  /** 칸 머리 아래 한 줄 - 짝 고르는 중 같은 안내 */
  banner?: ReactNode;
  /** 칸 머리의 문서 이름 뒤 - New 문서에 거는 거르기(출처 없는 New) */
  headExtra?: ReactNode;
  /** 두 문서 사이 연결선 켜기·끄기 */
  linesOn: boolean;
  onToggleLines: () => void;
  /**
   * 문장 사이에 놓은 자리의 점선 초안(엮은 문서에서만) - anchorKey 줄 상자 바로 앞(before)이나 뒤(after)에 그린다. 그 줄이 없으면 그리지 않는다.
   * 줄 상자가 아니라 줄 들고 남·이음 선·고르기·놓기 대상에 끼지 않는다
   */
  draft?: { anchorKey: string; side: "before" | "after"; lines: DraftLine[] } | null;
  /** 고른 줄의 초안이 든 빈 칸(칸 키) - 그 자리 표시에 테두리만 단다 */
  draftSlotKey?: string | null;
  /** 고른 줄의 AI 제안만 남기는 거르기 - 그 줄의 것은 밝게 꼬리표, 다른 줄의 AI 제안은 칸마다 띠로 접고, 나머지는 흐리게. 거르지 않으면 null */
  aiFilter?: NewAiFilter | null;
  /** 기본 | 템플릿 전환(엮은 문서만) - 넘기면 머리에 전환이 생기고, template이면 몸에 body(템플릿 보기)를 그린다 */
  viewSwitch?: { template: boolean; onChange: (template: boolean) => void; body: ReactNode } | null;
  /** 클릭 배치 - 엮은 문서에서 Old 줄을 고른 채 고칠 수 있을 때만. 없으면 자리가 없다 */
  place?: NewPlaceSpots | null;
  /** 엮은 문서(빈 템플릿)의 용지 모양(시안 2 D6) - 칸 머리 제목 박스 · 결과물 C 번호 칸 · 짝 카드 · 고른 박스의 손잡이 */
  composed?: NewComposedView | null;
}

/** 엮은 문서 기본 보기 - 줄은 rows(buildComposedRows(order.doc)), 모양은 strips(buildComposedStrips) */
export interface NewComposedView {
  strips: ComposedStrips;
  /** 고른 Old 줄에서 온 박스 - 고름 테두리, 손잡이는 이 박스에만 */
  selectedIds: ReadonlySet<number>;
  /** 순서 · 칸 옮기기 · 번호 표시 - 고칠 수 없으면 null(번호 칸은 읽기만, 손잡이 없음) */
  order: NewComposedOrder | null;
  /** 용지 위 나누기 · 합치기 · 짝(스텝 8) - Old 용지와 같은 두 번 누르기 · 틈 단추. 고칠 수 없으면 null */
  ops?: NewComposedOps | null;
}

export interface NewComposedOps {
  /** 박스 안 나눌 선 - 그 박스가 고른 줄에서 왔을 때만 */
  cut: { targetId: number; at: number } | null;
  cutPop: ReactNode;
  onDoubleClick: (targetId: number, at: number | null) => void;
  onCutDrag: (at: number | "start" | "end") => void;
  /** 이웃한 두 박스의 틈 - null이면 단추 없음 */
  plan: (upperId: number, lowerId: number) => JoinPlan | null;
  onJoin: (upperId: number, lowerId: number, kind: JoinKind) => void;
  busy: boolean;
}

export interface NewComposedOrder {
  /** 화면 문서(기다리는 편집을 얹은 것) - 손잡이 끌기가 이 문서로 자리를 센다 */
  doc: ComposedDoc;
  busy: boolean;
  /** 저장이 날아가는 줄 - 박스에 처리 중 쉬머 */
  pendingIds: ReadonlySet<number>;
  onPlace: (edit: PlaceEdit, note: string) => void;
  onStyle: (targetId: number, choice: ComposedStyleChoice) => void;
}

/** 끄는 자리 → 그 줄의 글 안 글자 위치. 글자 위가 아니면 글의 위·아래 어느 쪽인지로 답하고, 옆으로만 벗어났으면 선을 그대로 둔다(null) */
function readCutDragAt(text: HTMLElement, x: number, y: number): number | "start" | "end" | null {
  // 선 앞뒤 조각은 글자 노드만 들어 글자 수가 곧 data-start 자리다
  const scanned = readTextOffset(text, x, y);
  if (scanned !== null) return scanned;
  const caret = readCaretPoint(x, y);
  const holder = caret ? (caret.node instanceof Element ? caret.node : caret.node.parentElement) : null;
  const piece = holder?.closest<HTMLElement>("[data-start]") ?? null;
  if (caret && piece && text.contains(piece)) return Number(piece.dataset.start) + (caret.node.nodeType === Node.TEXT_NODE ? caret.offset : 0);
  const rect = text.getBoundingClientRect();
  if (y < rect.top) return "start";
  if (y > rect.bottom) return "end";
  return null;
}

/** 누른 자리 → 그 글 안 글자 위치(글 밖이면 null) - 빈 템플릿 박스를 두 번 누른 자리에 나눌 선을 놓는다 */
function readTextOffset(text: HTMLElement, x: number, y: number): number | null {
  // 글자 자리 API(caretPositionFromPoint)는 고를 수 없는 박스 글(user-select: none)에서 글 끝을 답한다 - 글자 상자를 하나씩 재어
  // 누른 글자를 찾는다(문장 하나라 짧다)
  const range = document.createRange();
  let seen = 0;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    for (let index = 0; index < length; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) return seen + index + (x > rect.left + rect.width / 2 ? 1 : 0);
    }
    seen += length;
  }
  return null;
}

/** 쓴 New 문서가 없을 때 오른쪽 칸 - 올리는 곳(To-Be)으로 데려간다 */
export function NewPaneEmpty({ zoom, onGoToBe }: { zoom: number; onGoToBe: () => void }) {
  const { t } = useI18n();
  return (
    <section className="assign-pane" style={{ "--z": zoom }} data-pane="new" data-testid="assign-new">
      <div className="pane-head">
        <span className="tag">{t("assign.writtenTag")}</span>
      </div>
      <div className="pane-body">
        <EmptyState
          icon={FilePlus2}
          testId="assign-new-empty"
          title={t("assign.newEmpty.title")}
          body={t("assign.newEmpty.body")}
          action={
            <button type="button" className="btn" data-testid="assign-go-tobe" onClick={onGoToBe}>
              {t("assign.newEmpty.go")}
            </button>
          }
        />
      </div>
    </section>
  );
}

// 빠진 줄을 접는 동안 더 그리는 시간(ms) - 접힘(--dur-slow 240ms)보다 조금 길게. 들어온 줄 표시도 이때 걷는다
const ROW_EXIT_MS = 300;

interface Presence {
  key: string;
  sig: string;
  rows: PaneRow[];
  added: Set<string>;
  leaving: Map<string, PaneRow[]>;
}

/**
 * 같은 문서 안에서 줄이 들고 난 차이 - 기준(key)이 바뀌면 움직임 없이 새로 시작하되, enterKeys(방금 보낸 문장 - 확정하며 문서가 바뀐 경우)는 들어온 줄로 친다.
 * 렌더 중 상태 맞추기, 줄 키가 바뀔 때만
 */
function useRowPresence(rows: PaneRow[], key: string, enterKeys: readonly string[]): Presence {
  const sig = rows.map(getNewRowKey).join(",");
  const [state, setState] = useState<Presence>({ key, sig, rows, added: new Set(), leaving: new Map() });
  if (state.key !== key) {
    const present = new Set(sig.split(","));
    setState({ key, sig, rows, added: new Set(enterKeys.filter((item) => present.has(item))), leaving: new Map() });
  } else if (state.sig !== sig) {
    const { added, leaving } = diffRows(state.rows, rows, getNewRowKey);
    setState({ key, sig, rows, added, leaving });
  }
  useEffect(() => {
    if (state.added.size === 0 && state.leaving.size === 0) return;
    const timer = window.setTimeout(() => setState((prev) => (prev.sig === state.sig ? { ...prev, added: new Set(), leaving: new Map() } : prev)), ROW_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  return state;
}

export function NewPane(props: NewPaneProps) {
  const { t } = useI18n();
  const [openSources, setOpenSources] = useState<ReadonlySet<number>>(new Set());
  const paneRef = useRef<HTMLElement>(null);
  const enterKeys = props.live ? props.live.targetIds.map((id) => `t:${id}`) : [];
  // 본문 | 그림 탭(시안 2 D3) - 그림 줄은 그림 탭에만, 본문에는 자리 표시 없이 빠진다. 문서를 바꾸면 본문으로(렌더 중 상태 맞추기)
  const [figureTab, setFigureTab] = useState<{ docId: string; on: boolean }>({ docId: props.docId, on: false });
  const figureCount = props.rows.filter((row) => row.kind === "figure").length;
  const isFigureTab = figureCount > 0 && figureTab.docId === props.docId && figureTab.on;
  const tabRows = figureCount === 0 ? props.rows : props.rows.filter((row) => (row.kind === "figure") === isFigureTab);
  // 탭을 바꾸면 줄 들고 남을 새로 시작한다(빠지는 줄 움직임 없이)
  const presence = useRowPresence(tabRows, `${props.rowsKey}:${isFigureTab ? "figures" : "body"}`, enterKeys);
  // 문서를 바꾸면 새 문서가 옆에서 들어온다 - 문서 목록에서 뒤 문서면 오른쪽에서, 앞 문서면 왼쪽에서(렌더 중 상태 맞추기)
  const [slide, setSlide] = useState<{ docId: string; dir: "next" | "prev" | null }>({ docId: props.docId, dir: null });
  if (slide.docId !== props.docId) {
    const from = props.docOptions.findIndex((option) => option.value === slide.docId);
    const to = props.docOptions.findIndex((option) => option.value === props.docId);
    setSlide({ docId: props.docId, dir: from < 0 || to < 0 ? null : to > from ? "next" : "prev" });
  }
  // AI 제안 거르기에서 띠를 눌러 펼친 칸 - 고른 줄이나 문서가 바뀌면 다시 접는다(렌더 중 상태 맞추기)
  const aiFoldKey = `${props.docId}:${props.aiFilter?.key ?? ""}`;
  const [aiOpen, setAiOpen] = useState<{ key: string; sections: ReadonlySet<string> }>({ key: aiFoldKey, sections: new Set() });
  if (aiOpen.key !== aiFoldKey) setAiOpen({ key: aiFoldKey, sections: new Set() });
  // 그릴 줄 - 지금 줄 사이사이에 빠지는 줄을 제자리(바로 뒤에 남은 줄 앞)에 끼운다
  const shown: Array<{ row: PaneRow; leaving: boolean }> = [];
  for (const row of tabRows) {
    for (const gone of presence.leaving.get(getNewRowKey(row)) ?? []) shown.push({ row: gone, leaving: true });
    shown.push({ row, leaving: false });
  }
  for (const gone of presence.leaving.get("") ?? []) shown.push({ row: gone, leaving: true });

  const sentences = shown.flatMap((item) => (item.row.kind === "empty" ? [] : [item.row]));
  const composed = props.composed ?? null;
  const strips = composed?.strips ?? null;
  // 짝 묶음 번호 - 이웃한 같은 의미 묶음 문장(buildComposedStrips)
  const readGroup = (row: ComposedRow): number | null => strips?.lines.get(row.target_id)?.pairGroup ?? null;
  // 짝 구성원이 바로 이웃하면 구성원 수와 상관없이 한 카드 - Old와 같은 규칙. 표·그림 줄은 카드를 끊는다
  const brackets = getPairBrackets(sentences.map((row) => ({ unitId: row.target_id, groupId: readGroup(row) })));
  const cardTops = getCardTops(sentences.map((row) => row.target_id), brackets);
  // 줄마다 자기 번호라 번호 칸 폭도 그 번호의 깊이로(표·그림 포함)
  const widths = new Map(sentences.map((row) => [String(row.target_id), strips?.lines.get(row.target_id)?.width ?? getPillWidth(1)]));

  // 방금 보낸 문장을 화면에 들인다 - 엮은 문서는 다시 읽은 뒤에야 그 줄이 생기니 그려질 때까지 렌더마다 본다(seq마다 한 번)
  const revealedSeq = useRef<number | null>(null);
  const { live, onReveal } = props;
  useEffect(() => {
    if (!live || revealedSeq.current === live.seq) return;
    const el = live.targetIds.map((id) => paneRef.current?.querySelector<HTMLElement>(`.new-line[data-target="${id}"]`)).find((item) => item);
    if (!el) return;
    revealedSeq.current = live.seq;
    onReveal(el, !el.closest("[data-enter]"));
  });

  // 박스 안 나눌 선(스텝 8)
  const ops = composed?.ops ?? null;
  const activeCut = ops?.cut ?? null;
  const onCutDrag = ops?.onCutDrag;
  // 나눌 선 끌기 - 선이 옮겨 가며 다시 그려져도 끊기지 않게 창에서 듣는다(Old 용지와 같은 방식)
  const [isCutDragging, setIsCutDragging] = useState(false);
  const handleCutMove = useEffectEvent((event: PointerEvent) => {
    const targetId = activeCut?.targetId;
    const text = targetId === undefined ? null : paneRef.current?.querySelector<HTMLElement>(`.new-line[data-target="${targetId}"] .new-text`);
    if (!text || !onCutDrag) return;
    const at = readCutDragAt(text, event.clientX, event.clientY);
    if (at !== null) onCutDrag(at);
  });
  useEffect(() => {
    if (!isCutDragging) return;
    const move = (event: PointerEvent) => handleCutMove(event);
    const stop = () => {
      setIsCutDragging(false);
      // 놓은 자리가 문장 위면 누르기(click)가 따라온다 - 끌기가 고르기로 읽히지 않게 그 한 번은 삼킨다
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [isCutDragging]);

  // 엮은 문서 - 번호 칸 창이 열린 줄(한 번에 하나), 고른 박스의 손잡이 끌기(순서 · 칸 옮기기, lib/use-composed-grip), 아이콘 표시의 툴팁
  const [styleOpen, setStyleOpen] = useState<number | null>(null);
  const order = composed?.order ?? null;
  useComposedGrip(paneRef, order && !props.viewSwitch?.template ? { doc: order.doc, t, onPlace: order.onPlace } : null);
  const tip = useDelegatedTip();

  /** 엮은 문서 줄의 앞머리 - 결과물 C 번호 표시를 고르는 번호 칸(번호 · 글머리 기호, 고칠 수 없으면 읽기만) */
  function renderComposedLead(row: ComposedRow, bracket: PairBracket | undefined): ReactNode {
    const line = strips?.lines.get(row.target_id);
    return (
      <ComposedNumberCell
        width={widths.get(String(row.target_id)) ?? getPillWidth(1)}
        bracket={bracket}
        testId="assign-new"
        targetId={row.target_id}
        mark={line?.mark ?? null}
        style={line?.style ?? "omitted"}
        canNumber={line?.canNumber ?? false}
        canEdit={order !== null && line !== undefined}
        busy={order === null || order.busy}
        open={styleOpen === row.target_id}
        onOpenChange={(open) => setStyleOpen(open ? row.target_id : null)}
        onPick={(choice) => order?.onStyle(row.target_id, line?.canDepth === false ? { ...choice, depth: null } : choice)}
      />
    );
  }

  function handleCutDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); // 글자가 끌려 골라지지 않게
    window.getSelection()?.removeAllRanges();
    setIsCutDragging(true);
  }

  function renderSources(row: ComposedRow) {
    return (
      <span className="new-srcs">
        <SourceChips
          targetId={row.target_id}
          ids={row.source_unit_ids}
          isAi={row.status === "ai_suggested"}
          sourceLabel={props.sourceLabel}
          onJump={props.onJumpSource}
          isOpen={openSources.has(row.target_id)}
          onOpen={(id) => setOpenSources((prev) => new Set(prev).add(id))}
        />
        {row.change_type === "new" && <span className="new-src is-new">{t("assign.markedNew")}</span>}
        <NewAiTag targetId={row.target_id} mark={props.aiFilter?.marks.get(getNewRowKey(row))} />
      </span>
    );
  }

  /**
   * 문장 사이 틈 - 빈 템플릿에서 고른 줄의 박스 위아래 틈에는 Old 용지와 같은 Join(같은 언어 = 합치기, 한/영 = 짝). 못 묶으면 꺼진 단추와 까닭.
   * 다른 틈은 그대로
   */
  function renderGap(previous: ComposedRow, row: ComposedRow): ReactNode {
    const isPair = cardTops.has(row.target_id);
    const isNear = ops !== null && composed !== null && (composed.selectedIds.has(previous.target_id) || composed.selectedIds.has(row.target_id));
    const plan = isNear ? ops.plan(previous.target_id, row.target_id) : null;
    if (!ops || !plan) return <div className="new-gap" data-pair={isPair ? "" : undefined} />;
    const label = t("split.joinAdjacent");
    const reason = plan.kind === null && plan.reasonKey ? t(plan.reasonKey) : null;
    const isOff = plan.kind === null || ops.busy;
    const Icon = plan.kind === "pair" ? Link2 : FoldVertical;
    const tab = Math.max(widths.get(String(previous.target_id)) ?? 0, widths.get(String(row.target_id)) ?? 0) + STRIP_LEAD_EXTRA;
    return (
      <div className="strip-gap" data-pair={isPair ? "" : undefined} data-near-selected="" style={{ "--gap-tab": `${tab}px` }} data-testid={`assign-new-gap-${previous.target_id}-${row.target_id}`}>
        <button
          type="button"
          className="strip-merge"
          aria-disabled={isOff ? "true" : undefined}
          aria-label={reason ? `${label} - ${reason}` : label}
          data-tip={reason ?? undefined}
          data-testid={`assign-new-merge-${previous.target_id}-${row.target_id}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!isOff && plan.kind !== null) ops.onJoin(previous.target_id, row.target_id, plan.kind);
          }}
        >
          <Icon size={12} strokeWidth={1.8} aria-hidden />
          <span className="strip-merge-label">{label}</span>
        </button>
      </div>
    );
  }

  /** 문장 한 줄(앞 틈 포함) */
  function renderSentence(row: ComposedRow, isSectionStart: boolean, previous: PaneRow | undefined): ReactNode {
    const bracket = brackets.get(row.target_id);
    const cutAt = activeCut && activeCut.targetId === row.target_id ? activeCut.at : null;
    const text = (
      <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
        {cutAt === null ? (
          row.text
        ) : (
          <>
            <span data-start={0}>{row.text.slice(0, cutAt)}</span>
            <span className="new-cut" aria-hidden data-testid={`assign-new-cut-${row.target_id}`}>
              {onCutDrag && <span className="cut-handle" data-tip={isCutDragging ? undefined : t("split.cutMove")} data-testid={`assign-new-cut-handle-${row.target_id}`} onPointerDown={handleCutDown} />}
            </span>
            <span data-start={cutAt}>{row.text.slice(cutAt)}</span>
          </>
        )}
      </span>
    );
    // 엮은 문서 - 고른 Old 줄에서 온 박스는 고름 테두리(시안 1), 그 박스 왼쪽에 손잡이(저장이 날아가는 박스는 잠금)
    const isSelected = composed?.selectedIds.has(row.target_id) ?? false;
    const isPending = order?.pendingIds.has(row.target_id) ?? false;
    return (
      <>
        {!isSectionStart && previous?.kind === "sentence" && renderGap(previous, row)}
        <StripBox
          lead={
            strips ? (
              renderComposedLead(row, bracket)
            ) : (
              <StripLead width={widths.get(String(row.target_id)) ?? getPillWidth(1)} number={row.number} bracket={bracket} dim={row.number === null} tip="" testId="assign-new" id={row.target_id} />
            )
          }
          boxClassName="strip new-line"
          bracket={bracket}
          boxAttrs={{
            "data-lang": row.lang,
            "data-state": props.pickedIds.has(row.target_id) ? "picked" : undefined,
            "data-target": row.target_id,
            "data-pair-group": readGroup(row) ?? undefined,
            "data-sel": isSelected ? "" : undefined,
            "data-pending": isPending ? "" : undefined,
            "data-testid": `assign-new-${row.target_id}`,
            // 빈 템플릿 박스 두 번 누르기 - 그 박스의 Old 줄을 고르고 누른 자리에 나눌 선(Old 용지와 같은 손짓, 스텝 8)
            onDoubleClick:
              ops
                ? (event) => {
                    const textEl = event.currentTarget.querySelector<HTMLElement>(".new-text");
                    ops.onDoubleClick(row.target_id, textEl ? readTextOffset(textEl, event.clientX, event.clientY) : null);
                  }
                : undefined,
          }}
          chips={(row.source_unit_ids.length > 0 || row.change_type === "new") && renderSources(row)}
        >
            {isSelected && order && !isPending && (
              <span className="strip-grip" data-drag-handle="" data-composed-grip={row.target_id} data-tip={t("assign.composedOrder.grip")} data-testid={`assign-new-grip-${row.target_id}`}>
                <GripVertical aria-hidden="true" />
              </span>
            )}
            {props.joinableIds?.has(row.target_id) && props.onJoinPick ? (
              <button
                type="button"
                className="new-hit"
                aria-haspopup="menu"
                aria-pressed={props.pickedIds.has(row.target_id)}
                data-testid={`assign-new-join-${row.target_id}`}
                onClick={(event) => {
                  const line = event.currentTarget.parentElement;
                  if (line) props.onJoinPick?.(row.target_id, line, event);
                }}
              >
                {text}
              </button>
            ) : props.place?.aiLines.get(row.target_id) === "mine" ? (
              <button type="button" className="new-hit" data-testid={`assign-new-ai-pick-${row.target_id}`} onClick={(event) => props.place?.onPickAi(row.target_id, isMousePress(event))}>
                {text}
              </button>
            ) : (
              <span className="new-hit is-static" data-place-tip={props.place?.aiLines.get(row.target_id) === "other" ? props.place.aiOtherTip : undefined}>
                {text}
              </span>
            )}
            <LangToken lang={row.lang} className="strip-lang" testId={`assign-new-lang-${row.target_id}`} />
            {cutAt !== null && <div className="new-cut-pop">{ops?.cutPop}</div>}
            {props.lineActions?.targetId === row.target_id && (
              <Collapse open appear className="strip-acts new-line-acts">
                {props.lineActions.node}
              </Collapse>
            )}
        </StripBox>
      </>
    );
  }

  /**
   * 엮은 문서의 칸 머리 - 번호 칸에 칸 번호가 든 제목 박스(Old 용지의 제목 박스 모양, 시안 2 D6). 칸 제목 출처는 이름 뒤에 흐리게, 넘치면 말줄임.
   * 클릭 배치의 칸 자리는 박스에 단다(빈 칸 자리 표시도 같은 자리). 줄 상자의 data-csec는 손잡이 끌기가 칸 띠를 재는 열쇠
   */
  function renderComposedHead(row: PaneRow, head: ComposedHead): ReactNode {
    const note = props.headingNotes?.get(row.section_path);
    const mark = props.sectionMarks?.get(row.section_path);
    // 번호 없는 절(5장의 범주)은 머리 글을 키로 - 범주끼리 같은 식별자가 되지 않게
    const idKey = readSectionNumber(row.section_path) || row.section_path;
    const spot = props.place?.heads.get(getNewRowKey(row));
    return (
      <StripBox
        rowAttrs={{ className: "new-head-row", "data-csec": head.sectionKey, "data-chead": "", "data-testid": `assign-new-head-${head.sectionKey}` }}
        lead={<StripLead width={head.width} number={head.number} dim={head.number === null} tip="" testId="assign-new-head" id={head.sectionKey} />}
        boxClassName="strip new-head"
        boxAttrs={spot ? { ...getSpotAttrs(spot), "data-testid": `assign-place-${spot.key}` } : undefined}
      >
        <p className="h new-head-text">
          <span className="new-head-label">
            {head.label}
            {mark?.deviationReason != null && <DeviationMark reason={mark.deviationReason} testId={`assign-new-differs-${idKey}`} />}
            {mark?.isEmptyRequired && <EmptyRequiredMark testId={`assign-new-empty-required-${idKey}`} />}
          </span>
          {note && (
            <span className="new-head-note">
              <Truncate text={note} testId={`assign-new-heading-note-${idKey}`} />
            </span>
          )}
        </p>
      </StripBox>
    );
  }

  /** 엮은 문서의 빈 칸 · 앱이 채우는 목록 줄의 앞머리 폭 - 그 칸 첫 깊이(문장 상자와 같은 x) */
  function readOpenWidth(row: PaneRow): number {
    return strips?.heads.get(row.section_path)?.openWidth ?? getPillWidth(1);
  }

  function renderRow(row: PaneRow, isSectionStart: boolean, previous: PaneRow | undefined): ReactNode {
    if (row.kind === "empty") {
      // 문장을 받지 않는 절(N/A가 아닐 때) - 묶음은 칸 머리만 있고, 앱이 채우는 목록은 읽기만 하는 박스다(고르기·놓을 자리 없음)
      if (row.fixed === "group" && !row.na) return null;
      if (row.fixed === "auto" && !row.na) {
        return (
          <div className="strip-row">
            <span className="strip-lead-gap" style={{ width: readOpenWidth(row) + STRIP_LEAD_EXTRA }} />
            <ul className="new-auto" data-testid={`assign-new-auto-${row.key}`}>
              {row.autoItems.length === 0 && <li className="text-ink-3">{t("outputs.autoEmpty")}</li>}
              {row.autoItems.map((item) => (
                <li key={item.code}>
                  <span className="font-mono">{item.code}</span>
                  {item.title !== "" && ` — ${item.title}`}
                </li>
              ))}
            </ul>
          </div>
        );
      }
      // 빈 칸 자리 표시는 그 칸 머리와 같은 자리(누르면 그 칸에 놓는다)
      const slotSpot = props.place?.heads.get(getNewRowKey(row));
      return (
        <div className="strip-row">
          <span className="strip-lead-gap" style={{ width: readOpenWidth(row) + STRIP_LEAD_EXTRA }} />
          <p
            {...(slotSpot ? getSpotAttrs(slotSpot) : undefined)}
            className="new-slot-empty"
            data-slot={row.key}
            data-na={row.na ? "" : undefined}
            data-draft={props.draftSlotKey === row.key ? "" : undefined}
            data-testid={`assign-new-slot-${row.key}`}
          >
            {row.na ? t("assign.slotNa") : t("assign.slotEmpty")}
          </p>
        </div>
      );
    }
    if (row.kind !== "sentence") {
      // 실제 표·그림 - 저장 직후 미리 넣은 표 줄은 칸 격자가 아직 없어 서버를 다시 읽을 때까지 글자 자리 표시
      const block =
        row.kind === "table" && !row.table ? (
          <p className="new-block" data-testid={`assign-new-${row.target_id}`}>
            {t("assign.newTable")}
          </p>
        ) : (
          <NewBundle
            kind={row.kind}
            table={row.table}
            figure={row.figure}
            caption={row.caption}
            renumber={row.renumber}
            bundleId={props.bundleId}
            testId={`assign-new-${row.target_id}`}
          />
        );
      // 엮은 문서의 표·그림도 결과물 C처럼 번호를 센다 - 앞머리에 자기 번호를 두어 문장 번호가 건너뛴 까닭이 보이게
      return (
        <div className="strip-row">
          {strips ? renderComposedLead(row, undefined) : <StripLead width={widths.get(String(row.target_id)) ?? getPillWidth(1)} number={row.number} dim={row.number === null} tip="" testId="assign-new" id={row.target_id} />}
          {block}
        </div>
      );
    }
    return renderSentence(row, isSectionStart, previous);
  }

  /** 놓은 자리의 점선 초안 - 기준 줄의 앞머리 폭만큼 들여 문장 상자와 왼쪽 x가 같다(빈 칸 줄의 strip-lead-gap과 같은 방식) */
  function renderDraft(anchor: PaneRow, lines: DraftLine[]): ReactNode {
    const lead = (anchor.kind !== "empty" ? (widths.get(String(anchor.target_id)) ?? getPillWidth(1)) : getPillWidth(1)) + STRIP_LEAD_EXTRA;
    return (
      <div className="new-draft" data-testid="assign-new-draft">
        <div className="strip-row">
          <span className="strip-lead-gap" style={{ width: lead }} />
          <span className="new-draft-tag">{t("assign.unsaved")}</span>
        </div>
        {lines.map((line, index) => (
          <div key={line.key} className="strip-row">
            <span className="strip-lead-gap" style={{ width: lead }} />
            <div className="strip new-draft-line" data-lang={line.lang} data-testid={`assign-new-draft-line-${index}`}>
              <span lang={line.lang === "neutral" ? undefined : line.lang} className="new-text">
                {line.text}
              </span>
              <LangToken lang={line.lang} className="strip-lang" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    // data-composed-order - 손잡이 끌기의 놓을 자리 선이 이 칸 기준으로 놓인다(styles/components.css)
    <section ref={paneRef} className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-doc={props.docId} data-composed-order={order ? "" : undefined} data-testid="assign-new">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-new-doc" ariaLabel={t("assign.newDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag new-pane-tag" data-testid="assign-new-tag">
          <Truncate text={props.tag} revealOnFocus />
        </span>
        {props.headExtra}
        <span className="flex-1" />
        {props.viewSwitch && <ViewSwitch template={props.viewSwitch.template} onChange={props.viewSwitch.onChange} label={t("assign.newView")} testId="assign-new-view" />}
        <Tooltip label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")}>
          <button type="button" className="pane-toggle" aria-pressed={props.linesOn} aria-label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")} data-testid="assign-lines-toggle" onClick={props.onToggleLines}>
            <Spline size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </Tooltip>
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-new-zoom" />
      </div>
      {figureCount > 0 && !props.viewSwitch?.template && (
        <div className="flex items-center">
          <PartTabs keys={["body", "figures"]} active={isFigureTab ? "figures" : "body"} onChange={(key) => setFigureTab({ docId: props.docId, on: key === "figures" })} counts={{ figures: figureCount }} testIdPrefix="assign-new-tab" />
        </div>
      )}
      {props.banner}
      {props.viewSwitch?.template ? (
        <div className="pane-body" key={props.docId}>
          {props.viewSwitch.body}
        </div>
      ) : (
        <div className="pane-body">
          <div className="sheet" key={props.docId} data-slide={slide.dir ?? undefined}>
            <div
              className="pg new-sheet"
              data-strips=""
              data-dragging={isCutDragging ? "" : undefined}
              data-read-only=""
              {...tip.handlers}
            >
              {tip.node}
              {shown.map(({ row, leaving }, index) => {
                const previous = shown[index - 1]?.row;
                const key = getNewRowKey(row);
                // 절이 바뀌는 첫 줄 앞에만 절 머리 - 접히며 빠지는 줄과 들어오는 줄이 같은 절이면 머리는 하나
                const isSectionStart = row.section_path !== "" && row.section_path !== previous?.section_path;
                // 점선 초안은 엮은 문서에서 기준 줄(빠지는 줄이 아닌) 바로 앞이나 뒤에
                const draftSide = props.draft && !leaving && props.draft.anchorKey === key ? props.draft.side : null;
                // AI 제안 거르기 - 다른 줄의 AI 제안은 그 칸의 띠를 펼치기 전까지 그리지 않는다(칸 머리는 남긴다 - 번호가 접힌 줄의 앞머리에 있었으면 머리 글로 돌려 준다)
                const aiMark = leaving ? undefined : props.aiFilter?.marks.get(key);
                const aiSection = readNewAiSectionKey(row.section_path);
                const isAiFolded = aiMark === "other_ai" && !aiOpen.sections.has(aiSection);
                const aiBand = isAiFolded ? props.aiFilter?.bands.get(key) : undefined;
                // 클릭 배치의 번호 줄 사이 틈 - 그 줄 바로 앞 · 뒤(빠지는 줄에는 없다)
                const gapBefore = leaving || row.kind === "empty" ? undefined : props.place?.gaps.get(`before:${row.target_id}`);
                const gapAfter = leaving || row.kind === "empty" ? undefined : props.place?.gaps.get(`after:${row.target_id}`);
                const head = isSectionStart ? strips?.heads.get(row.section_path) : undefined;
                return (
                  <Fragment key={key}>
                    {head && renderComposedHead(row, head)}
                    {gapBefore && <PlaceGap view={gapBefore} testId={`assign-place-${gapBefore.key}`} />}
                    {draftSide === "before" && props.draft && renderDraft(row, props.draft.lines)}
                    {aiBand && (
                      <button
                        type="button"
                        className="new-ai-band"
                        aria-expanded={false}
                        data-testid={`assign-new-ai-hidden-${aiBand.sectionKey}`}
                        onClick={() => setAiOpen((prev) => ({ key: prev.key, sections: new Set(prev.sections).add(aiSection) }))}
                      >
                        <Sparkles size={12} strokeWidth={1.75} className="flex-none" aria-hidden />
                        {t("assign.newAi.hidden", { n: aiBand.count })}
                      </button>
                    )}
                    {!isAiFolded && (
                      <div
                        className="new-item"
                        data-row={key}
                        data-csec={strips ? (row.kind === "empty" ? row.key : strips.lines.get(row.target_id)?.sectionKey) : undefined}
                        data-enter={presence.added.has(key) ? "" : undefined}
                        data-leave={leaving ? "" : undefined}
                        data-ai-view={aiMark === undefined ? undefined : aiMark === "mine_ai" || aiMark === "mine_went" ? "mine" : "dim"}
                        inert={leaving || undefined}
                      >
                        <div className="new-item-inner">
                          {row.kind !== "empty" && row.kind !== "sentence" && <NewAiTag targetId={row.target_id} mark={aiMark} />}
                          {renderRow(row, isSectionStart, previous)}
                        </div>
                      </div>
                    )}
                    {gapAfter && <PlaceGap view={gapAfter} testId={`assign-place-${gapAfter.key}`} />}
                    {draftSide === "after" && props.draft && renderDraft(row, props.draft.lines)}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
