// Assign 오른쪽 - 이미 쓴 New 문서의 원문. Old와 같은 종이 조각에 거울로 뒤집어 앉는다: 언어 탭은 오른쪽, 출처 칩은 왼쪽 아래(둘 다 가운데 선을 마주 본다). 점선 = 후보, 채움 = 고른 문장, ← 1-012 = 붙은 Old 출처(누르면 Old의 그 조각으로), 위험색 = 출처 없음.
// 표·그림은 이번 화면에서 잇지 않아 회색 상자로만 보인다(설계 §2).
"use client";

import { FilePlus2 } from "lucide-react";
import { Fragment, type MouseEvent } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
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
  sourceLabel: (unitId: number) => string;
  /** 줄을 누름 - anchor는 그 줄(그 자리 메뉴가 붙는다) */
  onPick: (targetId: number, additive: boolean, anchor: HTMLElement, event: MouseEvent) => void;
  /** 출처 칩을 누름 - Old의 그 조각으로 간다 */
  onJumpSource: (unitId: number, targetId: number) => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
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

export function NewPane(props: NewPaneProps) {
  const { t } = useI18n();
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
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-new-zoom" />
      </div>
      <div className="pane-body">
        <div className="sheet">
          <div className="pg new-sheet" data-strips="" data-mirror="">
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
              const previous = props.rows[index - 1];
              const gap = !head && previous?.kind === "sentence" ? <div className="new-gap" data-pair={brackets.get(previous.target_id) === "top" && bracket === "bottom" ? "" : undefined} /> : null;
              return (
                <Fragment key={row.target_id}>
                  {head}
                  {gap}
                  <div className="strip-row">
                    <div className="strip new-line" data-bracket={bracket} data-lang={row.lang} data-state={readState(row, props)} data-target={row.target_id} data-testid={`assign-new-${row.target_id}`}>
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
                        <span className="sr-only">{row.lang === "neutral" ? "–" : row.lang.toUpperCase()}</span>
                        <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
                          {row.text}
                        </span>
                      </button>
                      {(row.source_unit_ids.length > 0 || row.change_type === "new") && (
                        <span className="new-srcs">
                          {row.source_unit_ids.map((unitId) => (
                            <button
                              key={unitId}
                              type="button"
                              className="new-src"
                              aria-label={t("assign.jumpOld", { id: props.sourceLabel(unitId) })}
                              data-testid={`assign-new-src-${row.target_id}-${unitId}`}
                              onClick={() => props.onJumpSource(unitId, row.target_id)}
                            >
                              ← {props.sourceLabel(unitId)}
                            </button>
                          ))}
                          {row.change_type === "new" && <span className="new-src is-new">{t("assign.markedNew")}</span>}
                        </span>
                      )}
                    </div>
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
