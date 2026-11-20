// Assign 오른쪽 - New 문서. 이미 쓴 문서는 그 원문, 아직 쓰지 않은 문서는 지금까지의 배정으로 엮은 문서(서버 결과물 C 규칙, 읽기 전용 미리 보기).
// Old와 같은 종이 조각: 왼쪽 밖 앞머리(절 번호 칸, 폭 = 절 깊이라 들여쓴 것처럼 읽힌다), 본문 위 줄에 출처 칩, 위 테두리 오른쪽에 올리거나 고를 때만 KO/EN 탭(짝은 모두).
// 엮은 문서의 앞머리는 결과물 C와 같은 줄마다 자기 번호(생략·주석은 없음)이고 칸 번호는 칸 머리 줄에 남는다.
// 점선 = 후보, 채움 = 고른 문장, 칩 = 붙은 Old 출처(누르면 Old의 그 조각으로), 왼쪽 끝 위험색 막대 = 출처 없음. 엮은 문서의 빈 칸은 옅은 자리 표시.
// 엮은 문서의 문장을 받지 않는 절은 자리 표시가 없다 - 묶음은 칸 머리만, 앱이 채우는 목록(자식 WI)은 읽기만 하는 줄.
// 엮은 문서의 두 문장 사이에 Old 조각을 놓았으면 그 자리에 저장 전 문장(점선 초안), 빈 칸에 놓았으면 그 자리 표시에 강조 테두리(끌어서 보내기).
// 엮은 문서도 고른 Old 줄을 더 이을 수 있는 확정 문장(joinableIds)은 눌러 작은 메뉴를 연다(onJoinPick) - 그 밖의 문장은 읽기만 한다.
// 줄 상자(.new-item)마다 data-row(t:<id> | slot:<칸>) - 끄는 동안 놓을 자리를 이것으로 읽는다.
// 참조 줄이 EQUIS와 어긋나면 칩 줄 끝에 작은 표시(RefMark) - 출처 없는 줄은 그 표시만 있는 칩 줄이 생긴다.
// 칩 오른쪽 갈매기는 그 Old 조각이 왼쪽 칸 화면 위·아래 밖에 있다는 표시 - 스크롤마다 바뀌어 LinkLines가 data-dir로 단다(Old 배지와 같은 방식).
// AI 제안 거르기(aiFilter, lib/new-ai-filter-model)가 걸리면 고른 줄의 제안·간 곳은 강조 테두리와 꼬리표, 다른 줄의 AI 제안은 칸마다 띠 하나로 접히고(누르면 흐리게 펼침), 나머지 줄은 흐리다.
// 줄이 새로 들어오면 펼치며 나타나고 빠지면 접히며 사라진다(확정이 곧 보이는 실시간 넣기). 표·그림은 실제 표(좌우 스크롤)·그림 이미지로 보인다(new-bundle.tsx).
// 클릭 배치(place, MD 2 S3) - 엮은 문서에서 Old 줄을 고른 채면 칸 머리 · 빈 칸 · 번호 줄 사이 틈을 눌러 보낼 곳을 고른다(칠하기 · 꼬리표는 CSS :hover).
// 이미 쓴 문서의 표는 칸마다 상자(cellLink, 시안 2 D5) - 칸 위 출처 칩과 끊기 ×, Old 줄을 고른 채 칸을 누르거나 끈 조각을 칸에 놓으면 문장처럼 잇는다(new-bundle.tsx).
// 엮은 문서는 머리의 "기본 | 템플릿" 전환(viewSwitch)으로 같은 줄을 회사 템플릿 모양(components/template/template-view)으로도 본다 - 템플릿이면 몸에 그 보기를 그린다.
"use client";

import { ChevronDown, ChevronUp, FilePlus2, Scissors, Sparkles, Spline, X } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { NewBundle } from "@/components/assign/new-bundle";
import { getSpotAttrs, PlaceGap, type PlaceSpotView } from "@/components/assign/place-spot";
import { PaneZoom } from "@/components/assign/pane-zoom";
import { RefMark } from "@/components/assign/ref-mark";
import { LangToken } from "@/components/paper/lang-token";
import { DeviationMark, EmptyRequiredMark } from "@/components/tobe/deviation-mark";
import { StripLead, STRIP_LEAD_EXTRA } from "@/components/paper/strip-lead";
import { EmptyState } from "@/components/ui/empty-state";
import { Collapse, Truncate } from "@/components/ui/motion";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { BundleCell, WrittenSentence } from "@/lib/api-sop";
import type { DraftLine } from "@/lib/assign-drop-model";
import { readCaretPoint } from "@/lib/caret-point";
import { diffRows, getComposedLeadWidths, getNewRowKey, isComposedRow, isWrittenRow, readSectionNumber, type NewPaneRow, type SectionMark } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";
import { readNewAiSectionKey, type NewAiFilter } from "@/lib/new-ai-filter-model";
import { readWrittenRefMark } from "@/lib/ref-model";
import { getCardTops, getHiddenPrefixLength, getPairBrackets, getPillWidth, getSectionPill, getTabWidths } from "@/lib/strip-pill-model";

/** 클릭 배치의 자리(MD 2 S3) - heads는 칸 첫 줄의 키(getNewRowKey)로 그 칸 머리(빈 칸이면 자리 표시도 같은 자리), gaps는 "before:<id>" · "after:<id>" */
export interface NewPlaceSpots {
  heads: ReadonlyMap<string, PlaceSpotView>;
  gaps: ReadonlyMap<string, PlaceSpotView>;
  /** AI 제안 줄 - mine은 고른 줄의 제안(누르면 그 AI 추천을 고른 것과 같다), other는 다른 줄의 제안(누를 수 없고 올리면 aiOtherTip) */
  aiLines: ReadonlyMap<number, "mine" | "other">;
  aiOtherTip: string;
  onPickAi: (targetId: number) => void;
}

interface NewPaneProps {
  /** 누른 문단 안에 펼쳐 넣을 단추 줄(그 자리 메뉴) - targetId 줄의 글 아래에 미끄러지듯 열린다 */
  lineActions?: { targetId: number; node: ReactNode } | null;
  /** 그림 이미지를 받을 묶음 */
  bundleId: number;
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  rows: NewPaneRow[];
  /** 엮은 문서의 칸 머리(section_path) → 칸 제목 출처("← OLD-1 §5") - 서버 값 그대로 칸 이름 뒤에 흐리게 */
  headingNotes?: ReadonlyMap<string, string>;
  /** 엮은 문서의 칸 머리(section_path) → 표준과 다름 · 비어 있음 알림 - 칸 이름 뒤에 */
  sectionMarks?: ReadonlyMap<string, SectionMark>;
  /** 줄 들고 남의 기준 - 바뀌면(문서를 바꿈·처음 받음) 움직임 없이 새로 시작한다 */
  rowsKey: string;
  /** 머리 표지 - 이미 쓴 문서인지 배정으로 엮는 문서인지 */
  tag: string;
  /** 엮은 문서 - 문장을 눌러 고르지 않는다(잇는 대상은 이미 쓴 문서 문장뿐). 단 joinableIds의 문장은 눌러 작은 메뉴(이 문장에 잇기)를 연다 */
  readOnly: boolean;
  /** 엮은 문서에서 고른 Old 줄을 더 이을 수 있는 문장(target id) - 이 문장들만 누를 수 있다. 없으면 모두 읽기만 */
  joinableIds?: ReadonlySet<number>;
  /** 이을 수 있는 문장을 누름 - anchor는 그 줄 상자(메뉴가 붙는다) */
  onJoinPick?: (targetId: number, anchor: HTMLElement, event: MouseEvent) => void;
  candidateIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  /** 출처 없는 New 모드에서 고른 문장 */
  focusId: number | null;
  /** 양 단에서 다듬으려고 고른 문장 */
  shapeId?: number | null;
  sourceLabel: (unitId: number) => string;
  /** 줄을 누름 - anchor는 그 줄(그 자리 메뉴가 붙는다) */
  onPick: (targetId: number, additive: boolean, anchor: HTMLElement, event: MouseEvent) => void;
  /** 출처 칩을 누름 - Old의 그 조각으로 간다 */
  onJumpSource: (unitId: number, targetId: number) => void;
  /** 방금 확정해 보낸 문장 - seq가 바뀌면 한 번, 그 문장이 그려지는 대로 화면에 들인다(새로 들어온 줄이 아니면 번쩍임도) */
  live: { seq: number; targetIds: number[] } | null;
  onReveal: (el: HTMLElement, flash: boolean) => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
  /** 이미 쓴 문서의 원문 고치기 주소 - 엮은 문서나 읽기 전용이면 없다 */
  /** 이 문서의 원문을 한 단으로 열어 다듬는다 - 이미 쓴 문서에만 있다 */
  onEditOriginal?: () => void;
  /** 줄을 우클릭 - 그 문장의 고치기 메뉴를 연다(이미 쓴 문서에서 고칠 수 있는 사람만) */
  onShape?: (targetId: number, click: { x: number; y: number }) => void;
  /** 그 자리에서 나눌 선 - 그 줄의 글 안 at 자리에 선을 긋고 바로 아래에 cutPop(나누기·취소)을 둔다 */
  cut?: { targetId: number; at: number } | null;
  cutPop?: ReactNode;
  /** 나눌 선을 끄는 중 - 그 줄의 글 안 글자 위치, 글 위·아래로 벗어났으면 처음·끝 */
  onCutDrag?: (at: number | "start" | "end") => void;
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
  /** 이미 쓴 문서 표의 칸 잇기(시안 2 D5) - 칸 위 출처 칩은 늘, 누르기는 pickable(Old 줄을 고른 채)일 때, 놓기는 droppable일 때 */
  cellLink?: NewCellLink | null;
}

/** 이미 쓴 문서 표의 칸 잇기 - onPick은 문장 줄 누르기(onPick)와 같은 길, onUnlink는 칸 칩의 × */
export interface NewCellLink {
  pickable: boolean;
  droppable: boolean;
  onUnlink?: (targetId: number, unitId: number) => void;
}

function readState(row: WrittenSentence, props: NewPaneProps): string | undefined {
  if (row.target_id === props.focusId) return "focus";
  if (row.target_id === props.shapeId) return "shape";
  if (props.pickedIds.has(row.target_id)) return "picked";
  if (props.candidateIds.has(row.target_id)) return "candidate";
  if (!props.readOnly && row.kind === "sentence" && row.source_unit_ids.length === 0 && row.change_type !== "new") return "unsourced";
  return undefined;
}

/** 끄는 자리 → 그 줄의 글 안 글자 위치. 글자 위가 아니면 글의 위·아래 어느 쪽인지로 답하고, 옆으로만 벗어났으면 선을 그대로 둔다(null) */
function readCutDragAt(text: HTMLElement, x: number, y: number): number | "start" | "end" | null {
  const caret = readCaretPoint(x, y);
  const holder = caret ? (caret.node instanceof Element ? caret.node : caret.node.parentElement) : null;
  const piece = holder?.closest<HTMLElement>("[data-start]") ?? null;
  if (caret && piece && text.contains(piece)) return Number(piece.dataset.start) + (caret.node.nodeType === Node.TEXT_NODE ? caret.offset : 0);
  const rect = text.getBoundingClientRect();
  if (y < rect.top) return "start";
  if (y > rect.bottom) return "end";
  return null;
}

/** 짝 묶음 번호 - 짝의 작은 문장 id(서버는 둘짜리 짝만 서로를 가리킨다), 짝이 아니면 null. 앞머리 괄호와 언어 탭이 같은 기준을 쓴다 */
function readPairGroup(row: WrittenSentence): number | null {
  return row.kind !== "sentence" || row.partner_target_id === null ? null : Math.min(row.target_id, row.partner_target_id);
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

// 칩 줄에 먼저 보이는 출처 수 - 넘치면 "+N"을 눌러 펼친다(연결선은 접힌 출처를 "+N"에 잇는다)
const VISIBLE_SOURCES = 2;
// 빠진 줄을 접는 동안 더 그리는 시간(ms) - 접힘(--dur-slow 240ms)보다 조금 길게. 들어온 줄 표시도 이때 걷는다
const ROW_EXIT_MS = 300;

interface Presence {
  key: string;
  sig: string;
  rows: NewPaneRow[];
  added: Set<string>;
  leaving: Map<string, NewPaneRow[]>;
}

/**
 * 같은 문서 안에서 줄이 들고 난 차이 - 기준(key)이 바뀌면 움직임 없이 새로 시작하되, enterKeys(방금 보낸 문장 - 확정하며 문서가 바뀐 경우)는 들어온 줄로 친다.
 * 렌더 중 상태 맞추기, 줄 키가 바뀔 때만
 */
function useRowPresence(rows: NewPaneRow[], key: string, enterKeys: readonly string[]): Presence {
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
  // 엮은 문서만 - 이미 쓴 문서의 문장은 원래 있던 줄이라 들어오는 움직임을 쓰지 않는다
  const enterKeys = props.readOnly && props.live ? props.live.targetIds.map((id) => `t:${id}`) : [];
  const presence = useRowPresence(props.rows, props.rowsKey, enterKeys);
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
  const shown: Array<{ row: NewPaneRow; leaving: boolean }> = [];
  for (const row of props.rows) {
    for (const gone of presence.leaving.get(getNewRowKey(row)) ?? []) shown.push({ row: gone, leaving: true });
    shown.push({ row, leaving: false });
  }
  for (const gone of presence.leaving.get("") ?? []) shown.push({ row: gone, leaving: true });

  const sentences = shown.map((item) => item.row).filter(isWrittenRow);
  // 짝 구성원이 바로 이웃하면 구성원 수와 상관없이 한 카드, 앞머리 번호 칸 폭은 절 깊이 - Old와 같은 규칙. 짝 묶음 번호는 짝의 작은 문장 id(서버는 둘짜리 짝만 서로를 가리킨다). 표·그림 줄은 카드를 끊는다
  const brackets = getPairBrackets(sentences.map((row) => ({ unitId: row.target_id, groupId: readPairGroup(row) })));
  const cardTops = getCardTops(sentences.map((row) => row.target_id), brackets);
  // 엮은 문서는 줄마다 자기 번호라 번호 칸 폭도 그 번호의 깊이로(표·그림 포함), 이미 쓴 문서는 절 번호의 깊이로
  const widths = sentences.some(isComposedRow)
    ? getComposedLeadWidths(sentences)
    : getTabWidths(
        sentences
          .filter((row) => row.kind === "sentence")
          .map((row) => {
            const top = cardTops.get(row.target_id);
            return { key: String(row.target_id), part: "", sectionLabel: readSectionNumber(row.section_path), pairTopOf: top === undefined ? null : String(top) };
          }),
      );

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

  // 나눌 선 끌기 - 선이 옮겨 가며 다시 그려져도 끊기지 않게 창에서 듣는다(Old 용지와 같은 방식)
  const [isCutDragging, setIsCutDragging] = useState(false);
  const handleCutMove = useEffectEvent((event: PointerEvent) => {
    const targetId = props.cut?.targetId;
    const text = targetId === undefined ? null : paneRef.current?.querySelector<HTMLElement>(`.new-line[data-target="${targetId}"] .new-text`);
    if (!text || !props.onCutDrag) return;
    const at = readCutDragAt(text, event.clientX, event.clientY);
    if (at !== null) props.onCutDrag(at);
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

  function handleCutDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); // 글자가 끌려 골라지지 않게
    window.getSelection()?.removeAllRanges();
    setIsCutDragging(true);
  }

  /** AI 제안 거르기의 꼬리표 - 고른 줄의 AI 제안이거나 고른 줄이 이미 간 곳일 때만 */
  function renderAiTag(row: WrittenSentence): ReactNode {
    const mark = props.aiFilter?.marks.get(getNewRowKey(row));
    if (mark !== "mine_ai" && mark !== "mine_went") return null;
    return (
      <span className="new-ai-tag" data-testid={`assign-new-ai-tag-${row.target_id}`}>
        {t(mark === "mine_ai" ? "assign.newAi.mine" : "assign.newAi.went")}
      </span>
    );
  }

  /** 출처 칩들 - 문장 상자와 표 칸이 같은 칩을 쓴다. onUnlink가 있으면(칸) 칩마다 끊기 × */
  function renderChips(targetId: number, ids: number[], isAi: boolean, onUnlink?: (unitId: number) => void): ReactNode {
    const isOpen = openSources.has(targetId);
    const visible = isOpen || ids.length <= VISIBLE_SOURCES + 1 ? ids : ids.slice(0, VISIBLE_SOURCES);
    const hidden = ids.slice(visible.length);
    return (
      <>
        {visible.map((unitId) => (
          <Fragment key={unitId}>
            <button
              type="button"
              className="new-src"
              aria-label={t("assign.jumpOld", { id: props.sourceLabel(unitId) })}
              data-src-unit={unitId}
              data-ai={isAi ? "" : undefined}
              data-testid={`assign-new-src-${targetId}-${unitId}`}
              onClick={() => props.onJumpSource(unitId, targetId)}
            >
              {props.sourceLabel(unitId)}
              <ChevronUp size={11} strokeWidth={2.5} className="new-src-dir" data-d="above" aria-hidden />
              <ChevronDown size={11} strokeWidth={2.5} className="new-src-dir" data-d="below" aria-hidden />
            </button>
            {onUnlink && (
              <button
                type="button"
                className="new-src new-src-x"
                aria-label={t("assign.cellLink.unlink", { id: props.sourceLabel(unitId) })}
                data-tip={t("assign.cellLink.unlink", { id: props.sourceLabel(unitId) })}
                data-testid={`assign-new-src-x-${targetId}-${unitId}`}
                onClick={() => onUnlink(unitId)}
              >
                <X size={11} strokeWidth={2.5} aria-hidden />
              </button>
            )}
          </Fragment>
        ))}
        {hidden.length > 0 && (
          <button
            type="button"
            className="new-src is-more"
            aria-label={t("assign.moreSources", { n: hidden.length })}
            data-src-more={hidden.join(",")}
            data-testid={`assign-new-src-more-${targetId}`}
            onClick={() => setOpenSources((prev) => new Set(prev).add(targetId))}
          >
            +{hidden.length}
          </button>
        )}
      </>
    );
  }

  /** 칸 위 출처 칩 - 문장 상자와 같은 칩 줄, 고칠 수 있으면 칩마다 × */
  function renderCellSources(cell: BundleCell): ReactNode {
    const unlink = props.cellLink?.onUnlink;
    return <span className="new-srcs">{renderChips(cell.target_id, cell.source_unit_ids, cell.status === "ai_suggested", unlink ? (unitId) => unlink(cell.target_id, unitId) : undefined)}</span>;
  }

  function renderSources(row: WrittenSentence) {
    return (
      <span className="new-srcs">
        {renderChips(row.target_id, row.source_unit_ids, row.status === "ai_suggested")}
        {row.change_type === "new" && <span className="new-src is-new">{t("assign.markedNew")}</span>}
        {/* 참조 줄이 EQUIS와 어긋난다(번호·이름·EQUIS에 없음·폐기) - 출처가 없는 줄에도 뜬다. 이 문서의 글은 여기서 고치지 않아 알리기만 한다 */}
        <RefMark row={row} />
        {renderAiTag(row)}
      </span>
    );
  }

  /** 문장 한 줄(앞 틈 포함) */
  function renderSentence(row: WrittenSentence, isSectionStart: boolean, previous: NewPaneRow | undefined): ReactNode {
    const bracket = brackets.get(row.target_id);
    // 엮은 문서는 줄마다 결과물 C의 자기 번호(생략·주석은 없음). 이미 쓴 문서는 절을 여는 줄에만 절 번호 - 짝 카드의 둘째 줄부터가 절을 열면 앞머리에 번호가 없다
    const isOwnNumber = isComposedRow(row);
    const number = isOwnNumber ? row.number : isSectionStart && !cardTops.has(row.target_id) ? getSectionPill(readSectionNumber(row.section_path)) : null;
    const cutAt = props.cut && props.cut.targetId === row.target_id ? props.cut.at : null;
    const text = (
      <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
        {cutAt === null ? (
          row.text
        ) : (
          <>
            <span data-start={0}>{row.text.slice(0, cutAt)}</span>
            <span className="new-cut" aria-hidden data-testid={`assign-new-cut-${row.target_id}`}>
              {props.onCutDrag && <span className="cut-handle" data-tip={isCutDragging ? undefined : t("split.cutMove")} data-testid={`assign-new-cut-handle-${row.target_id}`} onPointerDown={handleCutDown} />}
            </span>
            <span data-start={cutAt}>{row.text.slice(cutAt)}</span>
          </>
        )}
      </span>
    );
    return (
      <>
        {!isSectionStart && previous?.kind === "sentence" && <div className="new-gap" data-pair={cardTops.has(row.target_id) ? "" : undefined} />}
        <div className="strip-row">
          <StripLead width={widths.get(String(row.target_id)) ?? getPillWidth(1)} number={number} bracket={bracket} dim={isOwnNumber ? number === null : !isSectionStart} tip="" testId="assign-new" id={row.target_id} />
          <div
            className="strip new-line"
            data-bracket={bracket}
            data-lang={row.lang}
            data-state={readState(row, props)}
            data-target={row.target_id}
            data-pair-group={readPairGroup(row) ?? undefined}
            data-testid={`assign-new-${row.target_id}`}
            onContextMenu={
              props.onShape && isWrittenRow(row)
                ? (event) => {
                    event.preventDefault();
                    props.onShape?.(row.target_id, { x: event.clientX, y: event.clientY });
                  }
                : undefined
            }
          >
            {(row.source_unit_ids.length > 0 || row.change_type === "new" || readWrittenRefMark(row) !== null) && renderSources(row)}
            {props.readOnly ? (
              props.joinableIds?.has(row.target_id) && props.onJoinPick ? (
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
                <button type="button" className="new-hit" data-testid={`assign-new-ai-pick-${row.target_id}`} onClick={() => props.place?.onPickAi(row.target_id)}>
                  {text}
                </button>
              ) : (
                <span className="new-hit is-static" data-place-tip={props.place?.aiLines.get(row.target_id) === "other" ? props.place.aiOtherTip : undefined}>
                  {text}
                </span>
              )
            ) : (
              <button
                type="button"
                className="new-hit"
                aria-pressed={props.pickedIds.has(row.target_id)}
                data-testid={`assign-new-pick-${row.target_id}`}
                onClick={(event) => {
                  const line = event.currentTarget.parentElement;
                  if (line) props.onPick(row.target_id, event.ctrlKey || event.metaKey, line, event);
                }}
              >
                {text}
              </button>
            )}
            <LangToken lang={row.lang} className="strip-lang" testId={`assign-new-lang-${row.target_id}`} />
            {cutAt !== null && <div className="new-cut-pop">{props.cutPop}</div>}
            {props.lineActions?.targetId === row.target_id && (
              <Collapse open appear className="strip-acts new-line-acts">
                {props.lineActions.node}
              </Collapse>
            )}
          </div>
        </div>
      </>
    );
  }

  /** 칸 머리 - 칸 제목 출처가 있으면 칸 이름 뒤에 흐리게, 넘치면 말줄임(빈 칸 줄의 머리도 같다) */
  function renderSectionHead(row: NewPaneRow, isNumberInLead: boolean): ReactNode {
    const label = isNumberInLead ? row.section_path.slice(getHiddenPrefixLength(row.section_path, readSectionNumber(row.section_path))) : row.section_path;
    const note = props.headingNotes?.get(row.section_path);
    const mark = props.sectionMarks?.get(row.section_path);
    // 번호 없는 절(5장의 범주)은 머리 글을 키로 - 범주끼리 같은 식별자가 되지 않게
    const idKey = readSectionNumber(row.section_path) || row.section_path;
    const marks = mark && (
      <>
        {mark.deviationReason !== null && <DeviationMark reason={mark.deviationReason} testId={`assign-new-differs-${idKey}`} />}
        {mark.isEmptyRequired && <EmptyRequiredMark testId={`assign-new-empty-required-${idKey}`} />}
      </>
    );
    const spot = props.place?.heads.get(getNewRowKey(row));
    const spotAttrs = spot ? { ...getSpotAttrs(spot), "data-testid": `assign-place-${spot.key}` } : undefined;
    if (!note)
      return (
        <p className="new-sec" {...spotAttrs}>
          {label}
          {marks}
        </p>
      );
    // 출처 글은 칸 오른쪽 끝까지 가서, 첫 줄의 언어 탭(위 테두리에서 8px 위로 나온다)이 글에 닿지 않게 아래 여백을 4px 더 둔다
    return (
      <p className="new-sec mb-2 flex gap-1.5" {...spotAttrs}>
        <span>
          {label}
          {marks}
        </span>
        <span className="min-w-[8ch] flex-1 font-normal text-ink-3">
          {/* 번호 없는 절(5장의 범주)은 머리 글을 키로 - 범주끼리 같은 식별자가 되지 않게 */}
          <Truncate text={note} testId={`assign-new-heading-note-${readSectionNumber(row.section_path) || row.section_path}`} />
        </span>
      </p>
    );
  }

  function renderRow(row: NewPaneRow, isSectionStart: boolean, previous: NewPaneRow | undefined): ReactNode {
    if (row.kind === "empty") {
      // 문장을 받지 않는 절(N/A가 아닐 때) - 묶음은 칸 머리만 있고, 앱이 채우는 목록은 읽기만 하는 줄이다(고르기·놓을 자리 없음)
      if (row.fixed === "group" && !row.na) return null;
      if (row.fixed === "auto" && !row.na) {
        return (
          <div className="strip-row">
            <span className="strip-lead-gap" style={{ width: getPillWidth(1) + STRIP_LEAD_EXTRA }} />
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
          <span className="strip-lead-gap" style={{ width: getPillWidth(1) + STRIP_LEAD_EXTRA }} />
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
            renumber={isComposedRow(row) ? row.renumber : null}
            captionRequired={isComposedRow(row)}
            bundleId={props.bundleId}
            testId={`assign-new-${row.target_id}`}
            cellLink={
              props.cellLink && !isComposedRow(row)
                ? {
                    pickable: props.cellLink.pickable,
                    droppable: props.cellLink.droppable,
                    pickedIds: props.pickedIds,
                    onPick: (cell, anchor, event) => props.onPick(cell.target_id, event.ctrlKey || event.metaKey, anchor, event),
                    renderSources: renderCellSources,
                  }
                : null
            }
          />
        );
      if (!isComposedRow(row)) return block;
      // 엮은 문서의 표·그림도 결과물 C처럼 번호를 센다 - 앞머리에 자기 번호를 두어 문장 번호가 건너뛴 까닭이 보이게
      return (
        <div className="strip-row">
          <StripLead width={widths.get(String(row.target_id)) ?? getPillWidth(1)} number={row.number} dim={row.number === null} tip="" testId="assign-new" id={row.target_id} />
          {block}
        </div>
      );
    }
    return renderSentence(row, isSectionStart, previous);
  }

  /** 놓은 자리의 점선 초안 - 기준 줄의 앞머리 폭만큼 들여 문장 상자와 왼쪽 x가 같다(빈 칸 줄의 strip-lead-gap과 같은 방식) */
  function renderDraft(anchor: NewPaneRow, lines: DraftLine[]): ReactNode {
    const lead = (isWrittenRow(anchor) ? (widths.get(String(anchor.target_id)) ?? getPillWidth(1)) : getPillWidth(1)) + STRIP_LEAD_EXTRA;
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
    <section ref={paneRef} className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-doc={props.docId} data-testid="assign-new">
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
        {props.onEditOriginal && (
          <Tooltip label={t("assign.openSplitTip")}>
            <button type="button" className="pane-toggle" aria-label={t("assign.openSplit")} data-testid="assign-new-edit-original" onClick={props.onEditOriginal}>
              <Scissors size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        )}
        <Tooltip label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")}>
          <button type="button" className="pane-toggle" aria-pressed={props.linesOn} aria-label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")} data-testid="assign-lines-toggle" onClick={props.onToggleLines}>
            <Spline size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </Tooltip>
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-new-zoom" />
      </div>
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
              data-read-only={props.readOnly ? "" : undefined}
            >
              {shown.map(({ row, leaving }, index) => {
                const previous = shown[index - 1]?.row;
                const key = getNewRowKey(row);
                // 절이 바뀌는 첫 줄 앞에만 절 머리 - 접히며 빠지는 줄과 들어오는 줄이 같은 절이면 머리는 하나
                const isSectionStart = row.section_path !== "" && row.section_path !== previous?.section_path;
                // 번호는 앞머리가 보일 때만 머리 글에서 뺀다 - 표·그림·빈 칸이나 짝 카드의 둘째 줄부터가 절을 열면 앞머리에 번호가 없다. 엮은 문서는 앞머리가 줄 자기 번호라 칸 번호를 머리에 남긴다
                const isNumberInLead = isSectionStart && row.kind === "sentence" && !cardTops.has(row.target_id) && !isComposedRow(row);
                // 점선 초안은 엮은 문서에서 기준 줄(빠지는 줄이 아닌) 바로 앞이나 뒤에
                const draftSide = props.readOnly && props.draft && !leaving && props.draft.anchorKey === key ? props.draft.side : null;
                // AI 제안 거르기 - 다른 줄의 AI 제안은 그 칸의 띠를 펼치기 전까지 그리지 않는다(칸 머리는 남긴다 - 번호가 접힌 줄의 앞머리에 있었으면 머리 글로 돌려 준다)
                const aiMark = leaving ? undefined : props.aiFilter?.marks.get(key);
                const aiSection = readNewAiSectionKey(row.section_path);
                const isAiFolded = aiMark === "other_ai" && !aiOpen.sections.has(aiSection);
                const aiBand = isAiFolded ? props.aiFilter?.bands.get(key) : undefined;
                // 클릭 배치의 번호 줄 사이 틈 - 그 줄 바로 앞 · 뒤(빠지는 줄에는 없다)
                const gapBefore = leaving || row.kind === "empty" ? undefined : props.place?.gaps.get(`before:${row.target_id}`);
                const gapAfter = leaving || row.kind === "empty" ? undefined : props.place?.gaps.get(`after:${row.target_id}`);
                return (
                  <Fragment key={key}>
                    {isSectionStart && renderSectionHead(row, isNumberInLead && !isAiFolded)}
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
                        data-enter={presence.added.has(key) ? "" : undefined}
                        data-leave={leaving ? "" : undefined}
                        data-ai-view={aiMark === undefined ? undefined : aiMark === "mine_ai" || aiMark === "mine_went" ? "mine" : "dim"}
                        inert={leaving || undefined}
                      >
                        <div className="new-item-inner">
                          {row.kind !== "empty" && row.kind !== "sentence" && renderAiTag(row)}
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
