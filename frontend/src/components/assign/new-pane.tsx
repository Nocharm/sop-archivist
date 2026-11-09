// Assign 오른쪽 - 이미 쓴 New 문서의 원문. 점선 = 후보, 채움 = 고른 문장, ← 1-012 = 붙은 Old 출처, 위험색 = 출처 없음.
// 표·그림은 이번 화면에서 잇지 않아 회색 상자로만 보인다(설계 §2).
"use client";

import { Fragment } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { Select, type SelectOption } from "@/components/ui/select";
import type { WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

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
  onPick: (targetId: number, additive: boolean) => void;
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

export function NewPane(props: NewPaneProps) {
  const { t } = useI18n();
  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-testid="assign-new">
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
          <div className="pg new-sheet">
            {props.rows.map((row, index) => {
              // 절이 바뀌는 첫 문장 앞에만 절 머리
              const head = row.section_path && row.section_path !== props.rows[index - 1]?.section_path ? <p className="new-sec">{row.section_path}</p> : null;
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
              return (
                <Fragment key={row.target_id}>
                  {head}
                  <button
                    type="button"
                    className="new-line"
                    data-state={readState(row, props)}
                    aria-pressed={props.pickedIds.has(row.target_id)}
                    data-testid={`assign-new-${row.target_id}`}
                    onClick={(event) => props.onPick(row.target_id, event.ctrlKey || event.metaKey)}
                  >
                    <span className={`ptag ${row.lang}`}>{row.lang === "neutral" ? "–" : row.lang.toUpperCase()}</span>
                    <span lang={row.lang === "neutral" ? undefined : row.lang} className="new-text">
                      {row.text}
                    </span>
                    {row.source_unit_ids.map((unitId) => (
                      <span key={unitId} className="new-src">
                        ← {props.sourceLabel(unitId)}
                      </span>
                    ))}
                    {row.change_type === "new" && <span className="new-src is-new">{t("assign.markedNew")}</span>}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
