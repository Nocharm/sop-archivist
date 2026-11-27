// 연습 말풍선(2026-11-27 시안 A + 뒤집기) - 화면을 살짝 어둡게 하고 지금 눌러야 할 상자만 밝게(숨쉬는 파란 테두리), 그 옆 카드가 할 일을 알려 준다.
// 막과 층은 클릭을 막지 않는다(pointer-events: none) - 카드 안의 링크 · 단추만 눌린다. 대상이 없으면(접힘 · 아직 없음) 막 없이 띠 아래 가운데.
// 이루면 카드가 뒤집혀 체크, 그 CSS 애니메이션이 끝나면(animationend) 다음 과제로 옮겨 가 앞면으로 다시 선다 - 타이머 없음. 자리 재기는 use-target-rect.
// 과제가 바라는 보기(한 단 · 양 단)와 지금 보기가 다르면 보기 단추를 밝히고 V를 먼저 안내한다. 틀이 막은 글쇠는 알림 줄 하나로 가볍게(그 애니메이션의 끝에 걷힌다).
"use client";

import { Award, CircleCheck } from "lucide-react";
import { useRef, type AnimationEvent, type RefObject } from "react";

import { formatAssignKey } from "@/lib/assign-keymap";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { placeCoach } from "@/lib/practice/coach-place";
import type { PaneView, PracticeLogEntry } from "@/lib/practice/practice-server";
import { PRACTICE_TASKS, isAlreadyThere, isPaneOff, listTargetSelectors, pickNextTask, readTaskTarget, type CoachView, type PracticeTaskId } from "@/lib/practice/practice-tasks";
import { useTargetRect } from "@/lib/use-target-rect";

/** 밝힌 상자를 대상보다 이만큼 넓힌다(px) - 테두리가 글자에 붙지 않게 */
const HOLE_PAD = 4;

/** 틀이 막은 글쇠 - seq는 누를 때마다 올라 알림 줄을 새로 그린다(애니메이션을 처음부터) */
export interface CoachNudge {
  seq: number;
  /** 누른 글쇠의 글(formatKeyPress) */
  key: string;
}

interface PracticeCoachProps {
  /** 좌표의 기준 - 연습 틀의 무대(Assign을 감싼 칸) */
  stageRef: RefObject<HTMLElement | null>;
  log: readonly PracticeLogEntry[];
  view: CoachView;
  /** Assign의 지금 보기 - 모르면(읽는 중 · Pair view) null */
  pane: PaneView | null;
  nudge: CoachNudge | null;
  /** 알림 줄의 애니메이션이 끝났다 - 걷는다 */
  onNudgeEnd: () => void;
  onSkip: (fromId: PracticeTaskId) => void;
  /** 뒤집기가 끝났다 - 다음 과제로 */
  onAdvance: () => void;
}

export function PracticeCoach({ stageRef, log, view, pane, nudge, onNudgeEnd, onSkip, onAdvance }: PracticeCoachProps) {
  const { t } = useI18n();
  const layerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const index = PRACTICE_TASKS.findIndex((item) => item.id === view.id);
  const task = index < 0 ? null : PRACTICE_TASKS[index];
  const selectors = task ? listTargetSelectors(readTaskTarget(task, pane), log) : [];
  const isOff = task !== null && isPaneOff(task, pane);
  const rects = useTargetRect({ stageRef, cardRef, ignoreRef: layerRef, selectors });
  const isMeasured = rects !== null && rects.key === selectors.join("\n");
  // 재기 전(고르개가 막 바뀜)에는 밝힌 상자 · 카드를 앞 자리에 그대로 두었다가 잰 뒤 미끄러져 간다(막이 한 프레임 꺼졌다 켜지지 않게)
  const hole = rects?.target ?? null;
  const place = rects ? placeCoach(rects.stage, rects.target, rects.card) : null;
  const nextId = task ? pickNextTask(log, task.id) : null;

  const handleNudgeEnd = (event: AnimationEvent<HTMLParagraphElement>) => {
    if (event.target === event.currentTarget) onNudgeEnd();
  };

  // 뒤집기(또는 움직임 줄이기의 체크 머무름) 애니메이션이 끝났을 때만 - 안쪽 요소의 애니메이션은 거품으로 올라와도 무시한다
  const handleFlipEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && view.isDone) onAdvance();
  };

  return (
    <div ref={layerRef} className="practice-coach-layer">
      {hole && <div className="practice-coach-hole" data-testid="practice-coach-hole" style={{ left: hole.left - HOLE_PAD, top: hole.top - HOLE_PAD, width: hole.width + HOLE_PAD * 2, height: hole.height + HOLE_PAD * 2 }} />}
      <section
        ref={cardRef}
        className="practice-coach"
        data-testid={task ? "practice-coach" : "practice-finish"}
        data-task={task?.id}
        data-place={place?.side ?? "center"}
        data-pending={isMeasured ? undefined : ""}
        aria-label={t("practice.coach.label")}
        aria-live="polite"
        style={place ? { left: place.left, top: place.top, "--coach-arrow": `${place.arrow}px` } : { visibility: "hidden" }}
      >
        {task ? (
          <div className="practice-coach-flip" data-testid="practice-coach-flip" data-done={view.isDone ? "true" : "false"} onAnimationEnd={handleFlipEnd}>
            <div className="practice-coach-face" inert={view.isDone}>
              <p className="practice-coach-step">{t("practice.coach.step", { n: index + 1, m: PRACTICE_TASKS.length, chapter: t(`practice.chapter.${task.chapter}`) })}</p>
              <h2 className="practice-coach-title">{t(task.titleKey)}</h2>
              <p className="practice-coach-body">{t(task.bodyKey)}</p>
              {task.keys.length > 0 && (
                <p className="practice-coach-keys">
                  {task.keys.map((id) => (
                    <kbd key={id}>{formatAssignKey(id)}</kbd>
                  ))}
                </p>
              )}
              {/* 보기가 어긋났다 - 밝힌 상자도 그 보기의 단추다 */}
              {isOff && task.pane !== null && (
                <p className="practice-coach-note" data-testid="practice-coach-pane">
                  {t(`practice.coach.pane.${task.pane}`)} <kbd>{formatAssignKey("view")}</kbd>
                </p>
              )}
              {isAlreadyThere(task, pane) && (
                <p className="practice-coach-note" data-testid="practice-coach-already">
                  {t(`practice.coach.already.${task.switchTo}`, { key: formatAssignKey("view") })}
                </p>
              )}
              {nudge !== null && (
                <p key={nudge.seq} className="practice-coach-nudge" data-testid="practice-coach-nudge" onAnimationEnd={handleNudgeEnd}>
                  {t("practice.coach.blocked", { key: nudge.key })}
                </p>
              )}
              <div className="practice-coach-foot">
                {/* 새 탭 - 하던 연습이 그대로 남는다(D11) */}
                <a href={`/manual#${task.anchor}`} target="_blank" rel="noreferrer" className="practice-coach-manual" data-testid="practice-coach-manual">
                  {t("practice.coach.manual")}
                </a>
                {nextId !== null && (
                  <button type="button" className="btn ghost practice-coach-skip" data-testid="practice-coach-skip" onClick={() => onSkip(task.id)}>
                    {t("practice.coach.skip")}
                  </button>
                )}
              </div>
            </div>
            <div className="practice-coach-face is-back" aria-hidden={!view.isDone}>
              <CircleCheck size={28} strokeWidth={1.5} className="practice-coach-check" aria-hidden />
              <p className="practice-coach-title">{t("practice.coach.done")}</p>
              <p className="practice-coach-step-hint">{t("practice.coach.doneHint")}</p>
            </div>
          </div>
        ) : (
          <div className="practice-coach-face is-finish">
            <Award size={28} strokeWidth={1.5} className="practice-coach-check" aria-hidden />
            <h2 className="practice-coach-title">{t("practice.finish.title", { m: PRACTICE_TASKS.length })}</h2>
            <p className="practice-coach-body">{t("practice.finish.body")}</p>
            <div className="practice-finish-acts">
              <button type="button" className="btn pri" data-testid="practice-finish-home" onClick={() => navigate("/")}>
                {t("practice.finish.home")}
              </button>
              <button type="button" className="btn" data-testid="practice-finish-again" onClick={() => window.location.reload()}>
                {t("practice.finish.again")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
