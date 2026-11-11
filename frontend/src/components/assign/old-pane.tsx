// Assign 왼쪽 - Old 원문이 곧 목록이다. Split과 같은 Unit 조각(앞 KO/EN·H 태그, 끝 상태 표시)에 확정한 조각의 간 곳을 한 줄 덧붙인다.
"use client";

import type { ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { Paper } from "@/components/paper/paper";
import { PartTabs } from "@/components/paper/part-tabs";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { PaperModel, PaperTabKey } from "@/lib/paper-model";

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
  /** 조각 오른쪽 칸 - 연결 배지 */
  renderPills: (unitId: number) => ReactNode;
  /** 내용이 있는 본문·머리말·꼬리말 탭 - 둘 이상일 때만 탭 줄을 그린다 */
  partKeys: readonly PaperTabKey[];
  activePart: PaperTabKey;
  onPartChange: (key: PaperTabKey) => void;
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
      {props.partKeys.length > 1 && (
        <div className="flex items-center">
          <PartTabs keys={props.partKeys} active={props.activePart} onChange={props.onPartChange} testIdPrefix="assign-tab" />
        </div>
      )}
      <div className="pane-body">
        {model ? (
          <Paper
            model={model}
            items={props.partKeys.length > 1 ? model[props.activePart] : undefined}
            selectedId={props.selectedId}
            highlightIds={props.highlightIds}
            pickedIds={props.pickedIds}
            onUnitClick={(unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey })}
            figureSource={props.figureSource}
            contour
            strips={{ isChecked: IS_CHECKED, hideChecked: true, statusOf: props.statusOf, renderNote: props.renderNote, renderPills: props.renderPills }}
            testId="assign-paper"
          />
        ) : (
          props.placeholder
        )}
      </div>
    </section>
  );
}
