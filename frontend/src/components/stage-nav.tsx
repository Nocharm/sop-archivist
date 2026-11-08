// 묶음 안 단계 이동 - 한 벌의 마크업을 <html data-shell>에 따라 CSS가 왼쪽 레일(72px) 또는 상단 2단(38px)으로 그린다. 그래서 저장된 배치가 첫 페인트부터 맞다.
"use client";

import { ClipboardCheck, Files, LayoutGrid } from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n";
import { getStageHref, STAGES, type StageKey } from "@/lib/stages";

const STAGE_ICONS: Partial<Record<StageKey, typeof Files>> = {
  overview: LayoutGrid,
  documents: Files,
  review: ClipboardCheck,
};

export function StageNav({ bundleId, current }: { bundleId: number; current: StageKey | null }) {
  const { t } = useI18n();

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
        const label = t(`stage.${stage.key}`);
        if (!stage.ready) {
          // 아직 없는 화면 - 자리는 지키고 들어가지 못하게만 한다(폭이 모드 단위로만 바뀐다)
          return (
            <span key={stage.key} className="stg" aria-disabled="true" data-testid={`stage-nav-${stage.key}`}>
              {mark}
              {label}
            </span>
          );
        }
        return (
          <Link
            key={stage.key}
            href={getStageHref(bundleId, stage.key)}
            className="stg"
            aria-current={current === stage.key ? "page" : undefined}
            data-testid={`stage-nav-${stage.key}`}
          >
            {mark}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
