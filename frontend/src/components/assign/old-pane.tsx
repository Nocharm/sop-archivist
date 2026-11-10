// Assign 왼쪽 - Old 원문이 곧 목록이다. Split과 같은 Unit 조각(앞 KO/EN·H 태그, 끝 상태 표시)에 확정한 조각의 간 곳을 한 줄 덧붙인다.
"use client";

import type { ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { Paper } from "@/components/paper/paper";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { PaperModel } from "@/lib/paper-model";

interface OldPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  /** 고른 문서의 제목 - 좁으면 말줄임 */
  docTitle: string;
  model: PaperModel | null;
  /** 모델을 아직 못 받았을 때(스켈레톤·빈 화면) */
  placeholder: ReactNode;
  selectedId: number | null;
  highlightIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  statusOf: (unitId: number) => ViewUnit["status"] | undefined;
  renderNote: (unitIds: number[]) => ReactNode;
  /** Shift는 일괄 고르기 */
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }) => void;
  figureSource?: { bundleId: number; docId: number };
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
}

const IS_CHECKED = () => true;

export function OldPane(props: OldPaneProps) {
  const { t } = useI18n();
  const { model } = props;
  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="old" data-testid="assign-old">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-old-doc" ariaLabel={t("assign.oldDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag">Old</span>
        <span className="pane-sub">{props.docTitle}</span>
        <span className="flex-1" />
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-old-zoom" />
      </div>
      <div className="pane-body">
        {model ? (
          <Paper
            model={model}
            selectedId={props.selectedId}
            highlightIds={props.highlightIds}
            pickedIds={props.pickedIds}
            onUnitClick={(unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey })}
            figureSource={props.figureSource}
            contour
            strips={{ isChecked: IS_CHECKED, hideChecked: true, statusOf: props.statusOf, renderNote: props.renderNote }}
            testId="assign-paper"
          />
        ) : (
          props.placeholder
        )}
      </div>
    </section>
  );
}
