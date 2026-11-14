"use client";

/** 고른 조각의 글 아래 단추 줄 - 짝 풀기와 합치기 풀기(할 수 있을 때만). 경계 확인 단추는 없어졌다(배정을 확정하면 확인된 것으로 친다). */
import { UnfoldVertical, Unlink } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

interface SplitUnitActionsProps {
  unitId: number;
  canUnpair: boolean;
  canUnmerge: boolean;
  busy: boolean;
  onUnpair: () => void;
  onUnmerge: () => void;
}

export function SplitUnitActions(props: SplitUnitActionsProps) {
  const { t } = useI18n();

  function renderButton(key: string, label: string, icon: ReactNode, onClick: () => void, tone: string) {
    return (
      <button
        type="button"
        className="strip-act"
        data-tone={tone}
        data-testid={`split-act-${key}-${props.unitId}`}
        disabled={props.busy}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  }

  return (
    // 줄 자체를 눌러도 그 조각을 고른 채로 둔다(조각 상자 누르기가 다시 고르지 않게)
    <div className="strip-acts-bar" role="group" aria-label={t("split.unitActions")} onClick={(event) => event.stopPropagation()}>
      {props.canUnpair && renderButton("unpair", t("split.removePair"), <Unlink size={13} strokeWidth={2} aria-hidden />, props.onUnpair, "pair")}
      {props.canUnmerge && renderButton("unmerge", t("split.unmerge"), <UnfoldVertical size={13} strokeWidth={2} aria-hidden />, props.onUnmerge, "quiet")}
    </div>
  );
}
