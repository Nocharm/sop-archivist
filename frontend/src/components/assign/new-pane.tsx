// Assign 오른쪽 - New 문서. 이미 쓴 문서는 그 원문, 아직 쓰지 않은 문서는 지금까지의 배정으로 엮은 문서(서버 결과물 C 규칙, 읽기 전용 미리 보기).
// Old와 같은 종이 조각: 왼쪽 밖 앞머리(맨 왼쪽 KO/EN 표시 + 절 번호 칸, 폭 = 절 깊이라 들여쓴 것처럼 읽힌다), 본문 위 줄에 출처 칩.
// 점선 = 후보, 채움 = 고른 문장, 칩 = 붙은 Old 출처(누르면 Old의 그 조각으로), 왼쪽 끝 위험색 막대 = 출처 없음. 엮은 문서의 빈 칸은 옅은 자리 표시.
// 칩 오른쪽 갈매기는 그 Old 조각이 왼쪽 칸 화면 위·아래 밖에 있다는 표시 - 스크롤마다 바뀌어 LinkLines가 data-dir로 단다(Old 배지와 같은 방식).
// 줄이 새로 들어오면 펼치며 나타나고 빠지면 접히며 사라진다(확정이 곧 보이는 실시간 넣기). 표·그림은 이번 화면에서 잇지 않아 회색 상자로만 보인다(설계 §2).
"use client";

import { ChevronDown, ChevronUp, FilePlus2, Spline } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { StripLead, STRIP_LEAD_EXTRA, STRIP_LEAD_LANG } from "@/components/paper/strip-lead";
import { EmptyState } from "@/components/ui/empty-state";
import { Truncate } from "@/components/ui/motion";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { WrittenSentence } from "@/lib/api-sop";
import { diffRows, getNewRowKey, isWrittenRow, type NewPaneRow } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";
import { getCardTops, getHiddenPrefixLength, getPairBrackets, getPillWidth, getSectionPill, getTabWidths } from "@/lib/strip-pill-model";

interface NewPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  rows: NewPaneRow[];
  /** 엮은 문서의 칸 머리(section_path) → 칸 제목 출처("← OLD-1 §5") - 서버 값 그대로 칸 이름 뒤에 흐리게 */
  headingNotes?: ReadonlyMap<string, string>;
  /** 줄 들고 남의 기준 - 바뀌면(문서를 바꿈·처음 받음) 움직임 없이 새로 시작한다 */
  rowsKey: string;
  /** 머리 표지 - 이미 쓴 문서인지 배정으로 엮는 문서인지 */
  tag: string;
  /** 엮은 문서 - 문장을 눌러 고르지 않는다(잇는 대상은 이미 쓴 문서 문장뿐) */
  readOnly: boolean;
  candidateIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  /** 출처 없는 New 모드에서 고른 문장 */
  focusId: number | null;
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
  /** 두 문서 사이 연결선 켜기·끄기 */
  linesOn: boolean;
  onToggleLines: () => void;
}

function readState(row: WrittenSentence, props: NewPaneProps): string | undefined {
  if (row.target_id === props.focusId) return "focus";
  if (props.pickedIds.has(row.target_id)) return "picked";
  if (props.candidateIds.has(row.target_id)) return "candidate";
  if (!props.readOnly && row.kind === "sentence" && row.source_unit_ids.length === 0 && row.change_type !== "new") return "unsourced";
  return undefined;
}

/** 절 머리 글("5.2. Title")의 앞 번호 - 없으면 빈 글 */
function readSectionNumber(path: string): string {
  return /^\s*(\d+(?:\.\d+)*)\.?/.exec(path)?.[1] ?? "";
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
  // 그릴 줄 - 지금 줄 사이사이에 빠지는 줄을 제자리(바로 뒤에 남은 줄 앞)에 끼운다
  const shown: Array<{ row: NewPaneRow; leaving: boolean }> = [];
  for (const row of props.rows) {
    for (const gone of presence.leaving.get(getNewRowKey(row)) ?? []) shown.push({ row: gone, leaving: true });
    shown.push({ row, leaving: false });
  }
  for (const gone of presence.leaving.get("") ?? []) shown.push({ row: gone, leaving: true });

  const sentences = shown.map((item) => item.row).filter(isWrittenRow);
  // 짝 구성원이 바로 이웃하면 구성원 수와 상관없이 한 카드, 앞머리 번호 칸 폭은 절 깊이 - Old와 같은 규칙. 짝 묶음 번호는 짝의 작은 문장 id(서버는 둘짜리 짝만 서로를 가리킨다). 표·그림 줄은 카드를 끊는다
  const brackets = getPairBrackets(sentences.map((row) => ({ unitId: row.target_id, groupId: row.kind !== "sentence" || row.partner_target_id === null ? null : Math.min(row.target_id, row.partner_target_id) })));
  const cardTops = getCardTops(sentences.map((row) => row.target_id), brackets);
  const widths = getTabWidths(
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

  function renderSources(row: WrittenSentence) {
    const isOpen = openSources.has(row.target_id);
    const ids = row.source_unit_ids;
    const visible = isOpen || ids.length <= VISIBLE_SOURCES + 1 ? ids : ids.slice(0, VISIBLE_SOURCES);
    const hidden = ids.slice(visible.length);
    return (
      <span className="new-srcs">
        {visible.map((unitId) => (
          <button
            key={unitId}
            type="button"
            className="new-src"
            aria-label={t("assign.jumpOld", { id: props.sourceLabel(unitId) })}
            data-src-unit={unitId}
            data-ai={row.status === "ai_suggested" ? "" : undefined}
            data-testid={`assign-new-src-${row.target_id}-${unitId}`}
            onClick={() => props.onJumpSource(unitId, row.target_id)}
          >
            {props.sourceLabel(unitId)}
            <ChevronUp size={11} strokeWidth={2.5} className="new-src-dir" data-d="above" aria-hidden />
            <ChevronDown size={11} strokeWidth={2.5} className="new-src-dir" data-d="below" aria-hidden />
          </button>
        ))}
        {hidden.length > 0 && (
          <button
            type="button"
            className="new-src is-more"
            aria-label={t("assign.moreSources", { n: hidden.length })}
            data-src-more={hidden.join(",")}
            data-testid={`assign-new-src-more-${row.target_id}`}
            onClick={() => setOpenSources((prev) => new Set(prev).add(row.target_id))}
          >
            +{hidden.length}
          </button>
        )}
        {row.change_type === "new" && <span className="new-src is-new">{t("assign.markedNew")}</span>}
      </span>
    );
  }

  /** 문장 한 줄(앞 틈 포함) */
  function renderSentence(row: WrittenSentence, isSectionStart: boolean, previous: NewPaneRow | undefined): ReactNode {
    const bracket = brackets.get(row.target_id);
    // 번호는 앞머리가 보일 때만 머리 글에서 뺀다 - 짝 카드의 둘째 줄부터가 절을 열면 앞머리에 번호가 없다
    const number = isSectionStart && !cardTops.has(row.target_id) ? getSectionPill(readSectionNumber(row.section_path)) : null;
    const text = (
      <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
        {row.text}
      </span>
    );
    return (
      <>
        {!isSectionStart && previous?.kind === "sentence" && <div className="new-gap" data-pair={cardTops.has(row.target_id) ? "" : undefined} />}
        <div className="strip-row">
          <StripLead width={widths.get(String(row.target_id)) ?? getPillWidth(1)} number={number} bracket={bracket} dim={!isSectionStart} tip="" testId="assign-new" id={row.target_id} lang={row.lang} />
          <div className="strip new-line" data-bracket={bracket} data-lang={row.lang} data-state={readState(row, props)} data-target={row.target_id} data-testid={`assign-new-${row.target_id}`}>
            {(row.source_unit_ids.length > 0 || row.change_type === "new") && renderSources(row)}
            {props.readOnly ? (
              <span className="new-hit is-static">{text}</span>
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
          </div>
        </div>
      </>
    );
  }

  /** 칸 머리 - 칸 제목 출처가 있으면 칸 이름 뒤에 흐리게, 넘치면 말줄임(빈 칸 줄의 머리도 같다) */
  function renderSectionHead(row: NewPaneRow, isNumberInLead: boolean): ReactNode {
    const label = isNumberInLead ? row.section_path.slice(getHiddenPrefixLength(row.section_path, readSectionNumber(row.section_path))) : row.section_path;
    const note = props.headingNotes?.get(row.section_path);
    if (!note) return <p className="new-sec">{label}</p>;
    return (
      <p className="new-sec flex gap-1.5">
        <span>{label}</span>
        <span className="min-w-[8ch] flex-1 font-normal text-ink-3">
          <Truncate text={note} testId={`assign-new-heading-note-${readSectionNumber(row.section_path)}`} />
        </span>
      </p>
    );
  }

  function renderRow(row: NewPaneRow, isSectionStart: boolean, previous: NewPaneRow | undefined): ReactNode {
    if (row.kind === "empty") {
      return (
        <div className="strip-row">
          <span className="strip-lead-gap" style={{ width: getPillWidth(1) + STRIP_LEAD_EXTRA + STRIP_LEAD_LANG }} />
          <p className="new-slot-empty" data-testid={`assign-new-slot-${row.key}`}>
            {row.na ? t("assign.slotNa") : t("assign.slotEmpty")}
          </p>
        </div>
      );
    }
    if (row.kind !== "sentence") {
      return (
        <p className="new-block" data-testid={`assign-new-${row.target_id}`}>
          {row.kind === "table" ? t("assign.newTable") : t("assign.newFigure")}
        </p>
      );
    }
    return renderSentence(row, isSectionStart, previous);
  }

  return (
    <section ref={paneRef} className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-doc={props.docId} data-testid="assign-new">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-new-doc" ariaLabel={t("assign.newDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag" data-testid="assign-new-tag">
          {props.tag}
        </span>
        <span className="flex-1" />
        <Tooltip label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")}>
          <button type="button" className="pane-toggle" aria-pressed={props.linesOn} aria-label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")} data-testid="assign-lines-toggle" onClick={props.onToggleLines}>
            <Spline size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </Tooltip>
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-new-zoom" />
      </div>
      <div className="pane-body">
        <div className="sheet">
          <div className="pg new-sheet" data-strips="" data-read-only={props.readOnly ? "" : undefined}>
            {shown.map(({ row, leaving }, index) => {
              const previous = shown[index - 1]?.row;
              const key = getNewRowKey(row);
              // 절이 바뀌는 첫 줄 앞에만 절 머리 - 접히며 빠지는 줄과 들어오는 줄이 같은 절이면 머리는 하나
              const isSectionStart = row.section_path !== "" && row.section_path !== previous?.section_path;
              // 번호는 앞머리가 보일 때만 머리 글에서 뺀다 - 표·그림·빈 칸이나 짝 카드의 둘째 줄부터가 절을 열면 앞머리에 번호가 없다
              const isNumberInLead = isSectionStart && row.kind === "sentence" && !cardTops.has(row.target_id);
              return (
                <Fragment key={key}>
                  {isSectionStart && renderSectionHead(row, isNumberInLead)}
                  <div className="new-item" data-enter={presence.added.has(key) ? "" : undefined} data-leave={leaving ? "" : undefined} inert={leaving || undefined}>
                    <div className="new-item-inner">{renderRow(row, isSectionStart, previous)}</div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
