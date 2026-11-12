"use client";

/** 고른 조각의 글 아래 단추 줄 - 경계 확인, 확인 취소(두 번 눌러), 짝 풀기·합치기 풀기(할 수 있을 때만) */
import { Check, Undo2, UnfoldVertical, Unlink } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
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

export function SplitUnitActions(props: SplitUnitActionsProps) {
  const { t } = useI18n();
  const [isArmed, setIsArmed] = useState(false);

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
        disabled={props.busy}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {icon}
        <span>{label}</span>
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

  return (
    // 줄 자체를 눌러도 그 조각을 고른 채로 둔다(조각 상자 누르기가 다시 고르지 않게)
    <div className="strip-acts-bar" role="group" aria-label={t("split.unitActions")} onClick={(event) => event.stopPropagation()}>
      {props.isChecked
        ? renderButton("uncheck", isArmed ? t("split.uncheckArmed") : t("split.uncheckBoundary"), <Undo2 size={13} strokeWidth={2} aria-hidden />, handleUncheck, { tone: "quiet", armed: isArmed, kbd: "U" })
        : renderButton("check", t("split.checkBoundary"), <Check size={13} strokeWidth={2.2} aria-hidden />, props.onCheck, { tone: "primary", kbd: "↵" })}
      {props.canUnpair && renderButton("unpair", t("split.removePair"), <Unlink size={13} strokeWidth={2} aria-hidden />, props.onUnpair, { tone: "pair" })}
      {props.canUnmerge && renderButton("unmerge", t("split.unmerge"), <UnfoldVertical size={13} strokeWidth={2} aria-hidden />, props.onUnmerge, { tone: "quiet" })}
    </div>
  );
}
