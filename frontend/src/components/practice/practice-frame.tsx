// 연습 화면의 틀(설계 2026-11-26-practice-page D9 · D10, 말풍선 2026-11-27 시안 A) - 위 띠(진행 점) + 무대(실제 Assign, 연습 Bundle -1) 위에 말풍선 층.
// 펼칠 과제(누른 점)와 말풍선이 보이는 과제는 useState 둘 - 띠와 말풍선이 함께 읽는다. 기록은 가짜 서버 모듈의 값이라 useSyncExternalStore.
// 서버에 자취가 없는 두 손짓(고르기 · 옮기기, 키보드 그림)은 여기서 보고 가짜 서버의 기록에 적는다 - Assign은 window 버블에서 들으니 틀의 캡처가 먼저 본다.
"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { PracticeBand } from "@/components/practice/practice-band";
import { PracticeCoach } from "@/components/practice/practice-coach";
import { readKeyPlace } from "@/lib/assign-key-target";
import { findAssignKey } from "@/lib/assign-keymap";
import { notePracticeAct, readPracticeSnapshot, subscribePractice } from "@/lib/practice/practice-server";
import { pickNextTask, pickOpenTask, readCoachView, type CoachSeen, type PickedTask, type PracticeTaskId } from "@/lib/practice/practice-tasks";

/** 고르기 · 옮기기(J · K와 같은 글쇠) - Assign 안에서 누른 것만(말풍선 단추의 글쇠, 글 칸 · 창 · 메뉴 안의 글쇠는 손짓이 아니다) */
function noteKey(event: KeyboardEvent) {
  const place = readKeyPlace(event.target);
  if (place === "typing" || place === "layer" || !(event.target instanceof Element) || !event.target.closest(".practice-main")) return;
  const hit = findAssignKey(event);
  if (hit?.kind === "run" && (hit.entry.id === "move_next" || hit.entry.id === "move_prev")) notePracticeAct({ key: hit.entry.id });
}

/** 도움말의 키보드 그림 여는 단추(assign-help.tsx) - 포털 안의 클릭도 React 트리를 따라 여기 온다 */
function noteClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('[data-testid="assign-help-keyboard-map"]')) notePracticeAct({ click: "keyboard-map" });
}

/** 처음 그릴 때 말풍선이 보일 과제 - 다른 화면에 갔다 와도 기록(모듈 값)이 남아 있으면 거기서 이어 간다 */
function readFirstSeen(): CoachSeen {
  const { log } = readPracticeSnapshot();
  return { id: pickOpenTask(log, null), since: log.length };
}

export function PracticeFrame({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { log } = useSyncExternalStore(subscribePractice, readPracticeSnapshot, readPracticeSnapshot);
  const [picked, setPicked] = useState<PickedTask | null>(null);
  const [seen, setSeen] = useState<CoachSeen>(readFirstSeen);
  const view = readCoachView(log, picked, seen);

  // 아무 과제나 고른다(순서 자유) - 고를 때의 기록 길이를 두어 그 뒤에 이루면 뒤집혀 다음 과제로 넘어간다
  const openTask = (id: PracticeTaskId) => {
    const at = { id, since: log.length };
    setPicked(at);
    setSeen(at);
  };
  const skipTask = (fromId: PracticeTaskId) => {
    const next = pickNextTask(log, fromId);
    if (next !== null) openTask(next);
  };

  return (
    <div className="practice">
      <PracticeBand log={log} nowId={view.id} onPick={openTask} />
      <div ref={stageRef} className="practice-stage" onKeyDownCapture={noteKey} onClickCapture={noteClick}>
        <div className="practice-main">{children}</div>
        <PracticeCoach stageRef={stageRef} log={log} view={view} onSkip={skipTask} onAdvance={() => setSeen({ id: pickOpenTask(log, picked), since: log.length })} />
      </div>
    </div>
  );
}
