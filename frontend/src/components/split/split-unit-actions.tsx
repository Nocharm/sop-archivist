"use client";

/** 고른 조각의 글 아래 단추 줄 - 경계 확인, 확인 취소(두 번 눌러), 짝 풀기·합치기 풀기(할 수 있을 때만).
 * 단추 묶음이 바뀌면(확인 ↔ 확인 취소 등) 옛 묶음이 브라운관 TV가 꺼지듯 사라진 뒤 새 묶음이 거꾸로 켜진다 - 바로 바뀌면 바뀐 줄 모른다.
 * 확인 뒤 다음 조각으로 넘어가면 그 조각의 단추 줄이 옛 줄이 다 꺼진 뒤에 켜진다.
 * 확인 취소의 "한 번 더 눌러" 라벨은 폭을 모핑해 같은 단추가 바뀐 것으로 읽히게 한다. */
import { Check, Undo2, UnfoldVertical, Unlink } from "lucide-react";
import { useEffect, useState, type AnimationEvent, type MouseEvent, type ReactNode } from "react";

import { MorphWidth } from "@/components/ui/motion";
import { useI18n } from "@/lib/i18n";

/** 확인 취소를 한 번 누른 뒤 두 번째 누름을 기다리는 시간(ms) - 지나면 처음 모양으로 돌아간다 */
const UNCHECK_ARM_MS = 3000;

interface SplitUnitActionsProps {
  unitId: number;
  isChecked: boolean;
  canUnpair: boolean;
  canUnmerge: boolean;
  busy: boolean;
  onCheck: () => void;
  onUncheck: () => void;
  onUnpair: () => void;
  onUnmerge: () => void;
}

interface ActionSet {
  isChecked: boolean;
  canUnpair: boolean;
  canUnmerge: boolean;
}

// 마지막으로 묶음이 꺼지기 시작한 때 - 곧이어 새로 붙는 단추 줄(다음 조각)은 옛 줄이 꺼진 뒤에 켜진다
let lastTurnOffAt = 0;
// 이 안에 붙은 단추 줄은 꺼짐에 이어 켜진다(ms) - 확인 요청이 돌아와 다음 조각으로 넘어가는 시간을 넉넉히 덮는다
const CHAIN_WINDOW_MS = 1500;

function readSetKey(set: ActionSet): string {
  return `${set.isChecked}:${set.canUnpair}:${set.canUnmerge}`;
}

export function SplitUnitActions(props: SplitUnitActionsProps) {
  const { t } = useI18n();
  const [isArmed, setIsArmed] = useState(false);
  // 보이는 묶음 - 들어온 묶음과 다르면 꺼지는 동안 옛 묶음을 그린다
  const [shown, setShown] = useState<ActionSet>({ isChecked: props.isChecked, canUnpair: props.canUnpair, canUnmerge: props.canUnmerge });
  // "after" - 다른 조각의 줄이 꺼지는 동안 기다렸다 켜진다
  const [turnOn, setTurnOn] = useState<"now" | "after" | null>(() => (Date.now() - lastTurnOffAt < CHAIN_WINDOW_MS ? "after" : null));
  const isTurningOff = readSetKey(shown) !== readSetKey(props);

  useEffect(() => {
    if (isTurningOff) lastTurnOffAt = Date.now();
  }, [isTurningOff]);

  useEffect(() => {
    if (!isArmed) return;
    const timer = window.setTimeout(() => setIsArmed(false), UNCHECK_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [isArmed]);

  function renderButton(key: string, label: string, icon: ReactNode, onClick: () => void, extra: { tone: string; armed?: boolean; kbd?: string }) {
    return (
      <button
        type="button"
        className="strip-act"
        data-tone={extra.tone}
        data-armed={extra.armed ? "" : undefined}
        data-testid={`split-act-${key}-${props.unitId}`}
        disabled={props.busy || isTurningOff}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {icon}
        {extra.armed === undefined ? (
          <span>{label}</span>
        ) : (
          <MorphWidth>
            <span key={extra.armed ? "armed" : "rest"} className="strip-act-swap">
              {label}
            </span>
          </MorphWidth>
        )}
        {extra.kbd && <kbd aria-hidden>{extra.kbd}</kbd>}
      </button>
    );
  }

  function handleUncheck() {
    if (!isArmed) {
      setIsArmed(true);
      return;
    }
    setIsArmed(false);
    props.onUncheck();
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.animationName === "crt-off") {
      setShown({ isChecked: props.isChecked, canUnpair: props.canUnpair, canUnmerge: props.canUnmerge });
      setIsArmed(false);
      // 고름이 다른 조각으로 넘어가 접히는 줄(inert)은 꺼진 채로 둔다 - 다음 조각의 줄이 켜진다
      setTurnOn(event.currentTarget.closest("[inert]") ? null : "now");
    } else if (event.animationName === "crt-on") {
      setTurnOn(null);
    }
  }

  return (
    // 줄 자체를 눌러도 그 조각을 고른 채로 둔다(조각 상자 누르기가 다시 고르지 않게)
    <div
      className="strip-acts-bar"
      role="group"
      aria-label={t("split.unitActions")}
      data-crt={isTurningOff ? "off" : turnOn === "now" ? "on" : turnOn === "after" ? "on-after" : undefined}
      onClick={(event) => event.stopPropagation()}
      onAnimationEnd={handleAnimationEnd}
    >
      {shown.isChecked
        ? renderButton("uncheck", isArmed ? t("split.uncheckArmed") : t("split.uncheckBoundary"), <Undo2 size={13} strokeWidth={2} aria-hidden />, handleUncheck, { tone: "quiet", armed: isArmed, kbd: "U" })
        : renderButton("check", t("split.checkBoundary"), <Check size={13} strokeWidth={2.2} aria-hidden />, props.onCheck, { tone: "primary", kbd: "↵" })}
      {shown.canUnpair && renderButton("unpair", t("split.removePair"), <Unlink size={13} strokeWidth={2} aria-hidden />, props.onUnpair, { tone: "pair" })}
      {shown.canUnmerge && renderButton("unmerge", t("split.unmerge"), <UnfoldVertical size={13} strokeWidth={2} aria-hidden />, props.onUnmerge, { tone: "quiet" })}
    </div>
  );
}
