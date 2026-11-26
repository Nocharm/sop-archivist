// 연습 화면의 과제 칸(설계 2026-11-26-practice-page §3 · §7, U1 · U2) - 과제 열둘이 늘 보이고, 한 일 기록으로 자동 ✓, 펼친 과제는 렌더 중에 셈한다(D10).
// 기록은 가짜 서버 모듈의 값이라 useSyncExternalStore로 읽는다 - 이펙트 · 타이머 없음.
"use client";

import { ChevronsLeft, ChevronsRight, CircleCheck } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { formatAssignKey } from "@/lib/assign-keymap";
import { useI18n } from "@/lib/i18n";
import { readPracticeSnapshot, subscribePractice } from "@/lib/practice/practice-server";
import { PRACTICE_TASKS, listAchieved, pickOpenTask, type PickedTask } from "@/lib/practice/practice-tasks";

interface PracticeTasksProps {
  /** 접힌 막대로 그린다 - 틀이 사람이 누른 접힘과 창 폭으로 정한다 */
  folded: boolean;
  onToggleFold: () => void;
}

export function PracticeTasks({ folded, onToggleFold }: PracticeTasksProps) {
  const { t } = useI18n();
  const { log } = useSyncExternalStore(subscribePractice, readPracticeSnapshot, readPracticeSnapshot);
  const [picked, setPicked] = useState<PickedTask | null>(null);
  const achieved = listAchieved(log);
  const openId = pickOpenTask(log, picked);
  const counts = { n: achieved.size, m: PRACTICE_TASKS.length };
  const foldLabel = folded ? t("practice.tasksUnfold") : t("practice.tasksFold");
  return (
    <aside className="practice-tasks" data-testid="practice-tasks" data-folded={folded ? "" : undefined} aria-label={t("practice.tasks")}>
      <div className="practice-tasks-head">
        <h2 className="practice-tasks-title">{t("practice.tasks")}</h2>
        <span className="practice-progress" data-testid="practice-progress" aria-label={t("practice.tasksProgressLabel", counts)}>
          {t("practice.tasksProgress", counts)}
        </span>
        <Tooltip label={foldLabel} align="end">
          <button type="button" className="btn ghost icon" data-testid="practice-tasks-fold" aria-label={foldLabel} aria-expanded={!folded} onClick={onToggleFold}>
            {folded ? <ChevronsLeft size={14} strokeWidth={1.5} aria-hidden /> : <ChevronsRight size={14} strokeWidth={1.5} aria-hidden />}
          </button>
        </Tooltip>
      </div>
      <ol className="practice-task-list">
        {PRACTICE_TASKS.map((task) => {
          const isDone = achieved.has(task.id);
          const isOpen = task.id === openId;
          return (
            <li key={task.id} className="practice-task" data-testid={`practice-task-${task.id}`} data-done={isDone ? "true" : "false"} data-open={isOpen ? "" : undefined}>
              {/* 아무 과제나 눌러 펼친다(순서 자유) - 누를 때의 기록 길이를 두어 그 뒤에 이루면 다음 과제로 넘어간다 */}
              <button type="button" className="practice-task-head" aria-expanded={isOpen} onClick={() => setPicked({ id: task.id, since: log.length })}>
                {isDone ? <CircleCheck size={14} strokeWidth={1.5} className="practice-task-check" aria-hidden /> : <span className="practice-task-dot" aria-hidden />}
                <span className="practice-task-title">{t(task.titleKey)}</span>
              </button>
              {isOpen && (
                <div className="practice-task-body">
                  <p>{t(task.bodyKey)}</p>
                  {task.keys.length > 0 && (
                    <p className="practice-task-keys">
                      {task.keys.map((id) => (
                        <kbd key={id}>{formatAssignKey(id)}</kbd>
                      ))}
                    </p>
                  )}
                  {/* 새 탭 - 하던 연습이 그대로 남는다(D11) */}
                  <a href={`/manual#${task.anchor}`} target="_blank" rel="noreferrer" className="practice-manual-link" data-testid="practice-task-manual">
                    {t("practice.tasksManual")}
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {counts.n === counts.m && (
        <p className="practice-tasks-done" data-testid="practice-tasks-done">
          {t("practice.tasksDone")}
        </p>
      )}
    </aside>
  );
}
