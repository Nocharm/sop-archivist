// Assign 오른쪽 - 이미 쓴 New 문서의 원문. Old와 같은 종이 조각: 왼쪽 밖 앞머리(절 번호 칸, 폭 = 절 깊이라 들여쓴 것처럼 읽힌다), 본문 위 줄에 출처 칩(연결선이 칩 왼쪽으로 들어온다). 점선 = 후보, 채움 = 고른 문장, 칩 = 붙은 Old 출처(누르면 Old의 그 조각으로), 위험색 = 출처 없음.
// 칩 오른쪽 갈매기는 그 Old 조각이 왼쪽 칸 화면 위·아래 밖에 있다는 표시 - 스크롤마다 바뀌어 LinkLines가 data-dir로 단다(Old 배지와 같은 방식).
// 표·그림은 이번 화면에서 잇지 않아 회색 상자로만 보인다(설계 §2).
"use client";

import { ChevronDown, ChevronUp, FilePlus2, Spline } from "lucide-react";
import { Fragment, useState, type MouseEvent } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { StripLead } from "@/components/paper/strip-lead";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { getCardTops, getHiddenPrefixLength, getPairBrackets, getPillWidth, getSectionPill, getTabWidths } from "@/lib/strip-pill-model";

interface NewPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  rows: WrittenSentence[];
  candidateIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  /** 출처 없는 New 모드에서 고른 문장 */
  focusId: number | null;
  sourceLabel: (unitId: number) => string;
  /** 줄을 누름 - anchor는 그 줄(그 자리 메뉴가 붙는다) */
  onPick: (targetId: number, additive: boolean, anchor: HTMLElement, event: MouseEvent) => void;
  /** 출처 칩을 누름 - Old의 그 조각으로 간다 */
  onJumpSource: (unitId: number, targetId: number) => void;
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
  if (row.kind === "sentence" && row.source_unit_ids.length === 0 && row.change_type !== "new") return "unsourced";
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

export function NewPane(props: NewPaneProps) {
  const { t } = useI18n();
  const [openSources, setOpenSources] = useState<ReadonlySet<number>>(new Set());
  // 짝 구성원이 바로 이웃하면 구성원 수와 상관없이 한 카드, 앞머리 번호 칸 폭은 절 깊이 - Old와 같은 규칙. 짝 묶음 번호는 짝의 작은 문장 id(서버는 둘짜리 짝만 서로를 가리킨다). 표·그림 줄은 카드를 끊는다
  const brackets = getPairBrackets(props.rows.map((row) => ({ unitId: row.target_id, groupId: row.kind !== "sentence" || row.partner_target_id === null ? null : Math.min(row.target_id, row.partner_target_id) })));
  const cardTops = getCardTops(props.rows.map((row) => row.target_id), brackets);
  const widths = getTabWidths(
    props.rows
      .filter((row) => row.kind === "sentence")
      .map((row) => {
        const top = cardTops.get(row.target_id);
        return { key: String(row.target_id), part: "", sectionLabel: readSectionNumber(row.section_path), pairTopOf: top === undefined ? null : String(top) };
      }),
  );
  function renderSources(row: WrittenSentence) {
    const isOpen = openSources.has(row.target_id);
    const ids = row.source_unit_ids;
    const shown = isOpen || ids.length <= VISIBLE_SOURCES + 1 ? ids : ids.slice(0, VISIBLE_SOURCES);
    const hidden = ids.slice(shown.length);
    return (
      <span className="new-srcs">
        {shown.map((unitId) => (
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

  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-doc={props.docId} data-testid="assign-new">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-new-doc" ariaLabel={t("assign.newDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag">{t("assign.writtenTag")}</span>
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
          <div className="pg new-sheet" data-strips="">
            {props.rows.map((row, index) => {
              // 절이 바뀌는 첫 문장 앞에만 절 머리
              const isSectionStart = row.section_path !== "" && row.section_path !== props.rows[index - 1]?.section_path;
              // 번호는 앞머리가 보일 때만 머리 글에서 뺀다 - 표·그림이나 짝 카드의 둘째 줄부터가 절을 열면 앞머리에 번호가 없다
              const isNumberInLead = isSectionStart && row.kind === "sentence" && !cardTops.has(row.target_id);
              const head = isSectionStart ? <p className="new-sec">{isNumberInLead ? row.section_path.slice(getHiddenPrefixLength(row.section_path, readSectionNumber(row.section_path))) : row.section_path}</p> : null;
              if (row.kind !== "sentence") {
                return (
                  <Fragment key={row.target_id}>
                    {head}
                    <p className="new-block" data-testid={`assign-new-${row.target_id}`}>
                      {row.kind === "table" ? t("assign.newTable") : t("assign.newFigure")}
                    </p>
                  </Fragment>
                );
              }
              const bracket = brackets.get(row.target_id);
              const number = isNumberInLead ? getSectionPill(readSectionNumber(row.section_path)) : null;
              const previous = props.rows[index - 1];
              const gap = !head && previous?.kind === "sentence" ? <div className="new-gap" data-pair={cardTops.has(row.target_id) ? "" : undefined} /> : null;
              return (
                <Fragment key={row.target_id}>
                  {head}
                  {gap}
                  <div className="strip-row">
                    <StripLead
                      width={widths.get(String(row.target_id)) ?? getPillWidth(1)}
                      number={number}
                      bracket={bracket}
                      dim={!isSectionStart}
                      tip=""
                      testId="assign-new"
                      id={row.target_id}
                    />
                    <div className="strip new-line" data-bracket={bracket} data-lang={row.lang} data-state={readState(row, props)} data-target={row.target_id} data-testid={`assign-new-${row.target_id}`}>
                      {(row.source_unit_ids.length > 0 || row.change_type === "new") && renderSources(row)}
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
                        <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
                          {row.text}
                        </span>
                      </button>
                    </div>
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
