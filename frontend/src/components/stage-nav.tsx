// 묶음 안 단계 이동 - 한 벌의 마크업을 <html data-shell>에 따라 CSS가 왼쪽 레일(72px) 또는 상단 2단(38px)으로 그린다. 그래서 저장된 배치가 첫 페인트부터 맞다.
// 문서가 하나도 없으면 문서가 있어야 할 일이 생기는 단계(Split~Review)는 잠기고, History는 레일 맨 아래에 붙는다.
"use client";

import { ClipboardCheck, Files, Gauge, History } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { getStageHref, isStageLocked, STAGES, type Stage, type StageKey } from "@/lib/stages";

const STAGE_ICONS: Partial<Record<StageKey, typeof Files>> = {
  overview: Gauge,
  documents: Files,
  review: ClipboardCheck,
  history: History,
};

export function StageNav({ bundleId, current }: { bundleId: number; current: StageKey | null }) {
  const { t } = useI18n();
  const { bundle } = useBundle(bundleId);
  // 묶음을 아직 모르면 잠그지 않는다 - 잠깐 흐렸다가 풀리는 깜빡임이 없게
  const documentCount = bundle?.document_count ?? 1;

  // mark = 번호 칸이나 아이콘. 묶인 칸의 항목은 번호를 칸 머리에 한 번만 두고 비운다
  function renderStage(stage: Stage, mark: ReactNode, className: string) {
    const label = t(`stage.${stage.key}`);
    const locked = isStageLocked(stage.key, documentCount);
    if (!stage.ready || locked) {
      // 들어갈 수 없는 단계 - 자리는 지키고 이유를 툴팁으로(폭이 모드 단위로만 바뀐다)
      const item = (
        <span className={className} aria-disabled="true" data-stage={stage.key} data-testid={`stage-nav-${stage.key}`}>
          {mark}
          {label}
        </span>
      );
      return locked ? (
        <Tooltip key={stage.key} label={t("stage.lockedNoDocuments")}>
          {item}
        </Tooltip>
      ) : (
        <span key={stage.key} className="contents">
          {item}
        </span>
      );
    }
    return (
      <Link
        key={stage.key}
        href={getStageHref(bundleId, stage.key)}
        className={className}
        data-stage={stage.key}
        aria-current={current === stage.key ? "page" : undefined}
        data-testid={`stage-nav-${stage.key}`}
      >
        {mark}
        {label}
      </Link>
    );
  }

  return (
    <nav className="stages" aria-label={t("stage.nav")} data-testid="stage-nav">
      {STAGES.map((stage) => {
        const Icon = STAGE_ICONS[stage.key];
        const mark =
          stage.step !== undefined ? (
            <span className="stg-n" aria-hidden>
              {stage.step}
            </span>
          ) : (
            Icon && <Icon size={16} strokeWidth={1.5} aria-hidden />
          );
        return renderStage(stage, mark, "stg");
      })}
    </nav>
  );
}
