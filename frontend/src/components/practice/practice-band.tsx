// 연습 화면의 위 띠(설계 2026-11-26-practice-page §3) - 저장되지 않는다는 알림과 처음부터 단추. 한 줄, 폭 전체.
"use client";

import { FlaskConical, RotateCcw } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function PracticeBand() {
  const { t } = useI18n();
  return (
    <div className="practice-band" data-testid="practice-band">
      <FlaskConical size={14} strokeWidth={1.5} aria-hidden />
      <span className="practice-band-title">{t("practice.band")}</span>
      <span className="practice-band-hint">{t("practice.bandHint")}</span>
      {/* 새로 읽기 = 가짜 서버 상태가 모듈 변수라 처음으로 돌아간다(D11) */}
      <button type="button" className="btn ghost practice-band-act" data-testid="practice-start-over" onClick={() => window.location.reload()}>
        <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
        {t("practice.startOver")}
      </button>
    </div>
  );
}
