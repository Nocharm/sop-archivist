// 클릭 배치(MD 2 S3)의 자리 - New 칸 기본 보기(new-pane)와 템플릿 보기(template-view spotProps)가 같은 속성을 단다.
// 올렸을 때 칠하기 · 꼬리표는 CSS(:hover, data-place-label)가 한다 - 포인터가 움직일 때 종이를 다시 그리지 않는다(긴 문서).
// 누르면 고르기만 하고(onPick) 확정은 결정 칸의 Confirm이 한다. 못 놓는 곳은 빨간 꼬리표로 까닭만 보이고 누를 수 없다.
"use client";

import type { HTMLAttributes, KeyboardEvent, MouseEvent } from "react";

import { isMousePress } from "@/lib/assign-key-target";

/** 자리 하나의 보기 - label은 올렸을 때의 꼬리표(틈 위치 · 못 놓는 까닭 · 알림, 없으면 빈 글), picked는 지금 고른 자리 */
export interface PlaceSpotView {
  key: string;
  open: boolean;
  label: string;
  picked: boolean;
  onPick: (isMouse: boolean) => void;
}

export type SpotAttrs = HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;

/** 자리 안의 다른 단추(템플릿 줄 · 번역 없음 · 칸 머리 표시)를 누른 것은 자리 고르기가 아니다 */
function isInnerControl(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): boolean {
  const target = event.target instanceof Element ? event.target.closest("button, a, [data-tpl-spot='line']") : null;
  return target !== null && target !== event.currentTarget && event.currentTarget.contains(target);
}

/** 칸 자리(칸 머리 · 범주 행 · 빈 칸)에 다는 속성 - 누를 수 있으면 단추 역할(Space - ↵는 화면의 확정이다), 못 놓는 곳은 눌러도 아무 일 없는 꺼진 단추(까닭이 이름이라 보조기기도 읽는다) */
export function getSpotAttrs(view: PlaceSpotView): SpotAttrs {
  const common: SpotAttrs = {
    "data-place": view.open ? "open" : "refused",
    "data-place-label": view.label || undefined,
    "data-place-picked": view.picked ? "" : undefined,
  };
  if (!view.open) return { ...common, role: "button", tabIndex: 0, "aria-disabled": true, "aria-label": view.label || undefined };
  return {
    ...common,
    role: "button",
    tabIndex: 0,
    "aria-pressed": view.picked,
    onClick: (event) => {
      if (!isInnerControl(event)) view.onPick(isMousePress(event));
    },
    onKeyDown: (event) => {
      if (event.key !== " " || isInnerControl(event)) return;
      event.preventDefault();
      view.onPick(false);
    },
  };
}

/** 번호 줄 사이의 틈 - 높이 없이 앞뒤 줄에 걸친 누름 띠. 올리면 가로선과 꼬리표("6.1.1 다음 — 6.1.2가 된다").
 *  끌기는 이 띠를 지나쳐 그 밑의 줄을 읽는다(data-drag-pass) - 띠가 줄 끝 4px를 덮어도 끌어 놓기의 답이 바뀌지 않게 */
export function PlaceGap({ view, testId }: { view: PlaceSpotView; testId: string }) {
  return (
    <button
      type="button"
      className="place-gap"
      data-drag-pass=""
      data-place={view.open ? "open" : "refused"}
      data-place-label={view.label || undefined}
      data-place-picked={view.picked ? "" : undefined}
      aria-label={view.label}
      aria-disabled={view.open ? undefined : true}
      tabIndex={view.open ? undefined : -1}
      aria-pressed={view.open ? view.picked : undefined}
      data-testid={testId}
      onClick={view.open ? (event) => view.onPick(isMousePress(event)) : undefined}
    />
  );
}
