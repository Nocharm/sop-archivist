// 연습 화면의 위 띠(설계 2026-11-26-practice-page §3, 말풍선 2026-11-27 시안 A) - 저장되지 않는다는 알림, 진행 점 열넷 · n/14, 처음부터 단추. 한 줄, 폭 전체.
// 점: 끝낸 과제는 채움, 말풍선이 보이는 과제는 테두리, 아직은 회색. 누르면 그 과제로 간다(순서 자유).
"use client";

import { FlaskConical, RotateCcw } from "lucide-react";

import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { useI18n } from "@/lib/i18n";
import type { PracticeLogEntry } from "@/lib/practice/practice-server";
import { PRACTICE_TASKS, listAchieved, type PracticeTaskId } from "@/lib/practice/practice-tasks";

interface PracticeBandProps {
  log: readonly PracticeLogEntry[];
  /** 말풍선이 보이고 있는 과제 - 다 끝났으면 null */
  nowId: PracticeTaskId | null;
  onPick: (id: PracticeTaskId) => void;
}

export function PracticeBand({ log, nowId, onPick }: PracticeBandProps) {
  const { t } = useI18n();
  const tip = useDelegatedTip();
  const achieved = listAchieved(log);
  const counts = { n: achieved.size, m: PRACTICE_TASKS.length };
  return (
    <div className="practice-band" data-testid="practice-band">
      <FlaskConical size={14} strokeWidth={1.5} aria-hidden />
      <span className="practice-band-title">{t("practice.band")}</span>
      <span className="practice-band-hint">{t("practice.bandHint")}</span>
      {/* 점 열넷의 툴팁은 띠가 맡아 하나만 띄운다 */}
      <div className="practice-dots" role="group" aria-label={t("practice.dots")} {...tip.handlers}>
        {PRACTICE_TASKS.map((task, index) => {
          const isNow = task.id === nowId;
          const label = t("practice.dotTip", { n: index + 1, title: t(task.titleKey) });
          return (
            <button
              key={task.id}
              type="button"
              className="practice-dot"
              data-testid={`practice-dot-${task.id}`}
              data-done={achieved.has(task.id) ? "true" : "false"}
              data-now={isNow ? "true" : "false"}
              data-tip={label}
              aria-label={label}
              aria-current={isNow ? "step" : undefined}
              onClick={() => onPick(task.id)}
            />
          );
        })}
        {tip.node}
      </div>
      <span className="practice-progress" data-testid="practice-progress" aria-label={t("practice.progressLabel", counts)}>
        {t("practice.progress", counts)}
      </span>
      {/* 새로 읽기 = 가짜 서버 상태가 모듈 변수라 처음으로 돌아간다(D11) */}
      <button type="button" className="btn ghost practice-band-act" data-testid="practice-start-over" onClick={() => window.location.reload()}>
        <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
        {t("practice.startOver")}
      </button>
    </div>
  );
}
