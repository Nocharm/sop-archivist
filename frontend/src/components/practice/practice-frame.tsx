// 연습 화면의 틀(설계 2026-11-26-practice-page D9 · D10, 말풍선 2026-11-27 시안 A, 안내형 2026-11-27) - 위 띠(진행 점) + 무대(실제 Assign, 연습 Bundle -1) 위에 말풍선 층.
// 펼칠 과제(누른 점)와 말풍선이 보이는 과제는 useState 둘 - 띠와 말풍선이 함께 읽는다. 기록은 가짜 서버 모듈의 값이라 useSyncExternalStore.
// Assign은 window 버블에서 들으니 틀의 캡처가 먼저 본다 - 여기서 서버에 자취가 없는 손짓(고르기 · 옮기기, 보기 바꾸기, 키보드 그림)을 적고, 지금 과제에 없는 Assign 글쇠를 막는다.
"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { PracticeBand } from "@/components/practice/practice-band";
import { PracticeCoach, type CoachNudge } from "@/components/practice/practice-coach";
import { readKeyPlace, type KeyPlace } from "@/lib/assign-key-target";
import { findAssignKey, formatKeyPress, type AssignKeyId } from "@/lib/assign-keymap";
import { notePracticeAct, readPracticeSnapshot, subscribePractice, type PaneView } from "@/lib/practice/practice-server";
import { listAllowedKeys, pickNextTask, pickOpenTask, readCoachView, type CoachSeen, type PickedTask, type PracticeTaskId } from "@/lib/practice/practice-tasks";
import { useAssignPane } from "@/lib/practice/use-assign-pane";

const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="option"]';
const PAPER_SELECTOR = '[data-pane="old"] .pane-body';

/** 처음 그릴 때 말풍선이 보일 과제 - 다른 화면에 갔다 와도 기록(모듈 값)이 남아 있으면 거기서 이어 간다 */
function readFirstSeen(): CoachSeen {
  const { log } = readPracticeSnapshot();
  return { id: pickOpenTask(log, null), since: log.length };
}

/**
 * 틀 자체에 포커스를 둔다(처음 그릴 때, 띠 · 카드 · Assign의 빈 곳을 누를 때는 브라우저가) - 포커스가 body에 있으면 글쇠가 React 트리를 지나지 않아 틀이 보지도 막지도 못한다.
 * 틀에서 누른 글쇠는 Assign에게는 용지 밖(other)이라 body에서처럼 받는다.
 */
function focusFrame(element: HTMLDivElement | null) {
  element?.focus({ preventScroll: true });
}

/** 그 단추의 제 글쇠 - 단추 · 링크 위의 Space, 용지 · 오른쪽 칸 밖 단추의 Enter는 그 단추를 누른다(Assign도 가로채지 않는다 - takesPrimaryEnter) */
function isOwnPress(event: KeyboardEvent, place: KeyPlace): boolean {
  if (!(event.target instanceof Element) || event.target.closest(CONTROL_SELECTOR) === null) return false;
  return event.key === " " || (event.key === "Enter" && place !== "paper" && place !== "side");
}

/** 도움말의 키보드 그림 여는 단추(assign-help.tsx) · 위쪽 줄의 보기 단추(assign-bar.tsx) - 포털 안의 클릭도 React 트리를 따라 여기 온다 */
function readClickAct(target: Element): "keyboard-map" | PaneView | null {
  if (target.closest('[data-testid="assign-help-keyboard-map"]')) return "keyboard-map";
  if (target.closest('[data-testid="assign-view-one"]')) return "one";
  return target.closest('[data-testid="assign-view-two"]') ? "two" : null;
}

export function PracticeFrame({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { log } = useSyncExternalStore(subscribePractice, readPracticeSnapshot, readPracticeSnapshot);
  const pane = useAssignPane();
  const [picked, setPicked] = useState<PickedTask | null>(null);
  const [seen, setSeen] = useState<CoachSeen>(readFirstSeen);
  // 막은 글쇠를 말풍선이 가볍게 알린다 - seq가 바뀌면 알림 줄을 새로 그려 애니메이션을 다시 돌리고, 그 끝(animationend)에 걷는다
  const [nudge, setNudge] = useState<CoachNudge | null>(null);
  const view = readCoachView(log, picked, seen);

  /** 띠 · 말풍선의 단추를 누른 뒤 포커스를 Old 용지로 - 단추에 남으면 Tab이 용지에 닿지 않는다(pick-bar.tsx returnFocus와 같은 일) */
  const focusPaper = () => stageRef.current?.querySelector<HTMLElement>(PAPER_SELECTOR)?.focus({ preventScroll: true });

  // 아무 과제나 고른다(순서 자유) - 고를 때의 기록 길이를 두어 그 뒤에 이루면 뒤집혀 다음 과제로 넘어간다
  const openTask = (id: PracticeTaskId) => {
    const at = { id, since: log.length };
    setPicked(at);
    setSeen(at);
    setNudge(null);
    focusPaper();
  };
  const skipTask = (fromId: PracticeTaskId) => {
    const next = pickNextTask(log, fromId);
    if (next !== null) openTask(next);
  };

  /** 서버에 자취가 없는 손짓이면 적는다 - Tab은 용지에서만 옮기기다(그 밖에서는 브라우저의 포커스 옮기기) */
  const noteKey = (id: AssignKeyId, event: KeyboardEvent, place: KeyPlace) => {
    if ((id === "move_next" || id === "move_prev") && (event.key !== "Tab" || place === "paper")) notePracticeAct({ key: id });
    // 바뀐 뒤의 보기 - 캡처라 Assign이 바꾸기 전에 본다. Pair view에서 V는 Pair view만 끈다(보기 모름 = 적지 않음)
    if (id === "view" && pane !== null) notePracticeAct({ view: pane === "one" ? "two" : "one" });
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const place = readKeyPlace(event.target);
    // 글 칸 · 창 · 메뉴 · 고르기 목록 안의 글쇠는 그 층의 것이다
    if (place === "typing" || place === "layer") return;
    if (event.target === event.currentTarget) {
      focusPaper();
      // 틀에서 누른 Tab은 용지로 들어가는 것으로 끝낸다(브라우저가 용지 다음 단추로 또 옮기지 않게)
      if (event.key === "Tab") {
        event.preventDefault();
        return;
      }
    }
    const hit = findAssignKey(event);
    if (hit === null || isOwnPress(event, place)) return;
    const allowed = listAllowedKeys(view.id, pane);
    if (allowed !== null && !allowed.has(hit.entry.id)) {
      // Assign(window 버블)까지 가지 않게 - 브라우저 기본(스크롤 · 포커스 옮기기)도 함께 막는다
      event.preventDefault();
      event.stopPropagation();
      setNudge((prev) => ({ seq: (prev?.seq ?? 0) + 1, key: formatKeyPress(hit.entry) }));
      return;
    }
    if (hit.kind === "run") noteKey(hit.entry.id, event, place);
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const act = readClickAct(event.target);
    if (act === "keyboard-map") notePracticeAct({ click: "keyboard-map" });
    // 이미 그 보기면 바뀐 것이 없다
    else if (act !== null && pane !== null && act !== pane) notePracticeAct({ view: act });
  };

  return (
    <div ref={focusFrame} className="practice" tabIndex={-1} onKeyDownCapture={handleKeyDownCapture} onClickCapture={handleClickCapture}>
      <PracticeBand log={log} nowId={view.id} onPick={openTask} />
      <div ref={stageRef} className="practice-stage">
        <div className="practice-main">{children}</div>
        <PracticeCoach
          stageRef={stageRef}
          log={log}
          view={view}
          pane={pane}
          nudge={nudge}
          onNudgeEnd={() => setNudge(null)}
          onSkip={skipTask}
          onAdvance={() => setSeen({ id: pickOpenTask(log, picked), since: log.length })}
        />
      </div>
    </div>
  );
}
