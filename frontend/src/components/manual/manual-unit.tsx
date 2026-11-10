// 설명서 조각 하나 - 종이 조각 위에 붙는 머리(조각 번호·설명하는 단계·제목·읽음 상태·읽음 단추)와 Markdown 본문.
// 머리는 조각을 읽는 동안 위에 붙어 있어, 긴 조각을 끝까지 읽은 자리에서 바로 읽음 표시를 할 수 있다.
"use client";

import { Check } from "lucide-react";

import { ReadStatePill } from "@/components/manual/read-state";
import { STAGE_ICONS } from "@/components/stage-nav";
import { MarkdownView, type MarkdownImageSize } from "@/components/ui/markdown-view";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { getSectionStage, MANUAL_ASSET_BASE, MANUAL_LANG, type ManualSection, type ReadState } from "@/lib/manual";
import { STAGES } from "@/lib/stages";

interface ManualUnitProps {
  section: ManualSection;
  state: ReadState;
  /** 지금 조각 - 단축키(↵·U)가 닿는 곳이라 글쇠 표시를 여기에만 보인다 */
  current: boolean;
  imageSizes: Record<string, MarkdownImageSize>;
  onMark: () => void;
  onUnmark: () => void;
}

export function ManualUnit({ section, state, current, imageSizes, onMark, onUnmark }: ManualUnitProps) {
  const { t } = useI18n();
  const stageKey = getSectionStage(section.id);
  const step = stageKey ? STAGES.find((stage) => stage.key === stageKey)?.step : undefined;
  const StageIcon = stageKey ? STAGE_ICONS[stageKey] : undefined;
  const stageLabel = stageKey ? t("manual.explains", { stage: t(`stage.${stageKey}`) }) : "";
  const testId = `manual-unit-${section.id}`;

  return (
    <section id={section.id} className="manual-unit" aria-label={section.title} data-state={state} data-current={current ? "" : undefined} data-testid={testId}>
      <header className="manual-unit-head">
        <span className="manual-tag" data-testid={`${testId}-tag`}>
          {section.tag}
        </span>
        {/* 단계 레일과 같은 번호·아이콘 - 이 조각이 어느 화면의 설명인지 */}
        {stageKey && (
          <Tooltip label={stageLabel} align="start">
            <span className="manual-unit-stage" role="img" aria-label={stageLabel} data-testid={`${testId}-stage`}>
              {step !== undefined ? <span className="stg-n">{step}</span> : StageIcon && <StageIcon size={16} strokeWidth={1.5} />}
            </span>
          </Tooltip>
        )}
        <h2 className="manual-unit-title" lang={MANUAL_LANG}>
          {section.title}
        </h2>
        <span className="flex-1" />
        <ReadStatePill state={state} testId={`${testId}-state`} />
        {state === "read" ? (
          <button type="button" className="btn ghost" data-testid={`${testId}-unmark`} onClick={onUnmark}>
            {t("manual.unmark")}
            {current && <kbd>U</kbd>}
          </button>
        ) : (
          <button type="button" className="btn" data-testid={`${testId}-mark`} onClick={onMark}>
            <Check size={16} strokeWidth={1.5} aria-hidden />
            {t("manual.markRead")}
            {current && <kbd>↵</kbd>}
          </button>
        )}
      </header>
      <MarkdownView source={section.body} className="manual-unit-body" lang={MANUAL_LANG} imageBase={MANUAL_ASSET_BASE} imageSizes={imageSizes} testId={`${testId}-body`} />
    </section>
  );
}
