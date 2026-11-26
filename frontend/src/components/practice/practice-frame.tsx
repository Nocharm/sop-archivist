// 연습 화면의 틀(설계 2026-11-26-practice-page D14 · D9) - 왼쪽은 실제 Assign(연습 Bundle -1), 오른쪽은 과제 칸.
// 접힘: 사람이 누르기 전(auto)에는 창 폭이 정한다 - 좁으면 처음부터 접힌 막대(CSS 미디어 쿼리가 첫 그림부터, 하이드레이션 차이 없음). 누른 것은 useState 하나(기억하지 않는다).
// 서버에 자취가 없는 두 손짓(고르기 · 옮기기, 키보드 그림)은 여기서 보고 가짜 서버의 기록에 적는다 - Assign은 window 버블에서 들으니 틀의 캡처가 먼저 본다.
"use client";

import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { PracticeTasks } from "@/components/practice/practice-tasks";
import { readKeyPlace } from "@/lib/assign-key-target";
import { findAssignKey } from "@/lib/assign-keymap";
import { notePracticeAct } from "@/lib/practice/practice-server";

/** 이 폭 밑에서는 과제 칸이 처음부터 접힌다 - components.css `.practice-grid[data-pref="auto"]`의 미디어 쿼리와 같은 값(1120px에서 과제 칸이 Assign 머리 줄을 겹치게 했다) */
export const PRACTICE_NARROW_QUERY = "(max-width: 1279.98px)";

type FoldPref = "auto" | "open" | "folded";

function subscribeNarrow(listener: () => void): () => void {
  const query = window.matchMedia(PRACTICE_NARROW_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const readNarrow = () => window.matchMedia(PRACTICE_NARROW_QUERY).matches;
// 서버 렌더 · 하이드레이션은 넓다고 본다 - 그동안의 모습은 CSS가 창 폭으로 그린다
const readServerNarrow = () => false;

/** 고르기 · 옮기기(J · K와 같은 글쇠) - Assign 안에서 누른 것만(과제 칸의 Tab, 글 칸 · 창 · 메뉴 안의 글쇠는 손짓이 아니다) */
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

export function PracticeFrame({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<FoldPref>("auto");
  const isNarrow = useSyncExternalStore(subscribeNarrow, readNarrow, readServerNarrow);
  const folded = pref === "folded" || (pref === "auto" && isNarrow);
  return (
    <div className="practice-grid" data-pref={pref} data-folded={folded ? "" : undefined} onKeyDownCapture={noteKey} onClickCapture={noteClick}>
      <div className="practice-main">{children}</div>
      <PracticeTasks folded={folded} onToggleFold={() => setPref(folded ? "open" : "folded")} />
    </div>
  );
}
