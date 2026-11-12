// Assign 오른쪽 - 이미 쓴 New 문서의 원문. Old와 같은 종이 조각: 왼쪽 밖 언어 탭(폭 = 절 깊이라 들여쓴 것처럼 읽힌다), 본문 위 줄에 출처 칩(연결선이 칩 왼쪽으로 들어온다). 점선 = 후보, 채움 = 고른 문장, 칩 = 붙은 Old 출처(누르면 Old의 그 조각으로), 위험색 = 출처 없음, 흐림 = 고른 Old 줄에 없는 언어(이을 수 없다).
// 칩 오른쪽 갈매기는 그 Old 조각이 왼쪽 칸 화면 위·아래 밖에 있다는 표시 - 스크롤마다 바뀌어 LinkLines가 data-dir로 단다(Old 배지와 같은 방식).
// 표·그림은 이번 화면에서 잇지 않아 회색 상자로만 보인다(설계 §2).
"use client";

import { ChevronDown, ChevronUp, FilePlus2, Spline } from "lucide-react";
import { Fragment, useState, type MouseEvent } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { getPairBrackets, getPillWidth, getSectionPill, getTabWidths } from "@/lib/strip-pill-model";

interface NewPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  rows: WrittenSentence[];
  candidateIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  /** 출처 없는 New 모드에서 고른 문장 */
  focusId: number | null;
  /** 이을 수 있는 언어 - 고른 Old 줄의 언어. 다른 언어 문장은 누를 수 없다(같은 언어끼리만 잇는다, 명세 §7.10). null이면 제한 없음 */
  allowedLangs: ReadonlySet<string> | null;
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
  // 한/영 짝이 바로 이웃하면 한 카드(위·아래 괄호), 탭 폭은 절 깊이 - Old와 같은 규칙
  const sentences = props.rows.filter((row) => row.kind === "sentence");
  const brackets = getPairBrackets(sentences.map((row) => ({ unitId: row.target_id, partnerId: row.partner_target_id })));
  const widths = getTabWidths(
    sentences.map((row) => ({
      key: String(row.target_id),
      part: "",
      sectionLabel: readSectionNumber(row.section_path),
      pairTopOf: brackets.get(row.target_id) === "bottom" ? String(row.partner_target_id) : null,
    })),
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
              const head = isSectionStart ? <p className="new-sec">{row.section_path}</p> : null;
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
              const number = isSectionStart && bracket !== "bottom" ? getSectionPill(readSectionNumber(row.section_path)) : null;
              const isBlocked = props.allowedLangs !== null && !props.allowedLangs.has(row.lang);
              const previous = props.rows[index - 1];
              const gap = !head && previous?.kind === "sentence" ? <div className="new-gap" data-pair={brackets.get(previous.target_id) === "top" && bracket === "bottom" ? "" : undefined} /> : null;
              return (
                <Fragment key={row.target_id}>
                  {head}
                  {gap}
                  <div className="strip-row">
                    <span className="strip-tab" style={{ width: widths.get(String(row.target_id)) ?? getPillWidth(1) }} data-lang={row.lang === "neutral" ? undefined : row.lang} data-bracket={bracket} data-dim={isSectionStart ? undefined : ""} data-testid={`assign-new-tab-${row.target_id}`}>
                      {number !== null && (
                        <span className="strip-tab-num" aria-hidden>
                          {number}
                        </span>
                      )}
                      <span className="strip-tab-letters" aria-hidden>
                        {row.lang !== "neutral" && <span>{row.lang.toUpperCase()}</span>}
                      </span>
                    </span>
                    <div className="strip new-line" data-bracket={bracket} data-lang={row.lang} data-state={readState(row, props)} data-blocked={isBlocked ? "" : undefined} data-target={row.target_id} data-testid={`assign-new-${row.target_id}`}>
                      {(row.source_unit_ids.length > 0 || row.change_type === "new") && renderSources(row)}
                      <button
                        type="button"
                        className="new-hit"
                        aria-pressed={props.pickedIds.has(row.target_id)}
                        disabled={isBlocked}
                        data-testid={`assign-new-pick-${row.target_id}`}
                        onClick={(event) => {
                          const line = event.currentTarget.parentElement;
                          if (line) props.onPick(row.target_id, event.ctrlKey || event.metaKey, line, event);
                        }}
                      >
                        <span className="sr-only">{row.lang === "neutral" ? "–" : row.lang.toUpperCase()}</span>
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
