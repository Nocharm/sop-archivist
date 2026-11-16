// Assign Old 문장 우클릭 메뉴 - 위는 배정(배정 취소), 아래는 문장 고치기(여기서 나누기·앞뒤와 합치기·언어).
// 항목의 가능/불가는 순수 모델(assign-context-menu-model)이 정한다. 꺼진 항목은 숨기지 않고 흐리게, 까닭은 data-tip 툴팁이다.
// 자리는 그 자리 메뉴와 같은 규칙(placeLinkMenu) - 그 줄의 조각들(한/영 짝이면 둘 다) 아래(모자라면 위)에 놓아 다룰 문장을 가리지 않는다.
"use client";

import { ArrowDownToLine, ArrowUpToLine, BookMarked, BookX, CaptionsOff, Eraser, LayoutList, Link2, MousePointerClick, PanelBottom, PanelTop, Rows3, Scissors, Table2, Unlink, type LucideIcon } from "lucide-react";
import { useRef } from "react";

import { Menu } from "@/components/ui/menu";
import { MenuLangRow } from "@/components/ui/menu-lang-row";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import type { AssignMenuAction, AssignMenuGroups, AssignMenuItem } from "@/lib/assign-context-menu-model";
import { useI18n } from "@/lib/i18n";
import { placeLinkMenu } from "@/lib/link-menu-place";

// 오른쪽 칸의 다듬기 줄(shape-tools)도 같은 아이콘·이름을 쓴다 - 같은 일은 어디서나 같은 모양으로
export const ASSIGN_ACTION_ICONS: Record<Exclude<AssignMenuAction, "lang">, LucideIcon> = {
  clear: Eraser,
  split: Scissors,
  merge_prev: ArrowUpToLine,
  merge_next: ArrowDownToLine,
  // 한글·영어 이웃은 합치지 않고 짝으로 맺는다 - 같은 자리에 합치기 대신 나온다
  pair_prev: Link2,
  pair_next: Link2,
  pair_pick: MousePointerClick,
  unpair: Unlink,
  ref_mark: BookMarked,
  ref_clear: BookX,
  table_rows: Rows3,
  table_merge: Table2,
  table_layout: LayoutList,
  // 캡션 자리(위·아래)를 그린 아이콘 - 글을 묶음 위(아래) 캡션 줄로
  caption_attach_prev: PanelTop,
  caption_attach_next: PanelBottom,
  caption_detach: CaptionsOff,
};

export const ASSIGN_ACTION_LABELS: Record<Exclude<AssignMenuAction, "lang">, string> = {
  clear: "classify.clear",
  split: "split.cutHere",
  merge_prev: "assign.ctx.mergePrev",
  merge_next: "assign.ctx.mergeNext",
  pair_prev: "assign.ctx.pairPrev",
  pair_next: "assign.ctx.pairNext",
  pair_pick: "assign.ctx.pairPick",
  unpair: "assign.ctx.unpair",
  ref_mark: "assign.ctx.refMark",
  ref_clear: "assign.ref.reject",
  // 표 항목은 쪼개기 화면의 단추와 같은 이름을 쓴다
  table_rows: "split.splitRows",
  table_merge: "split.mergeRows",
  table_layout: "split.layoutTable",
  // 묶음 대상의 이름 - 글 대상이면 항목의 labelKey("위 표의 캡션으로 쓰기")가 대신한다
  caption_attach_prev: "assign.ctx.captionAttachPrev",
  caption_attach_next: "assign.ctx.captionAttachNext",
  caption_detach: "assign.ctx.captionDetach",
};

const KEYS: Partial<Record<AssignMenuAction, string>> = { clear: "U" };

interface AssignContextMenuProps {
  /** 누른 문장의 조각 - 닫으면 포커스가 돌아갈 곳 */
  anchor: HTMLElement;
  /** 가리지 않을 조각들(누른 줄의 Unit 전부) - 비면 anchor */
  cover: HTMLElement[];
  /** 누른 자리(화면 좌표) - 키보드로 열었으면 null(줄 왼쪽 아래) */
  click: { x: number; y: number } | null;
  groups: AssignMenuGroups;
  onPick: (action: AssignMenuAction, lang?: "ko" | "en") => void;
  onClose: () => void;
}

export function AssignContextMenu({ anchor, cover, click, groups, onPick, onClose }: AssignContextMenuProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLElement>(anchor);
  const tip = useDelegatedTip();

  function place(rect: DOMRect, size: { width: number; height: number }) {
    const boxes = cover.filter((el) => el.isConnected).map((el) => el.getBoundingClientRect());
    const row = boxes.length === 0 ? rect : { top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)), left: Math.min(...boxes.map((box) => box.left)) };
    return placeLinkMenu(row, click?.x ?? null, size, { width: window.innerWidth, height: window.innerHeight }, click?.y ?? null);
  }

  function renderItem(item: AssignMenuItem) {
    if (item.action === "lang") {
      return (
        <MenuLangRow
          key="lang"
          label={t("split.menu.lang")}
          current={item.lang}
          disabledReason={item.reasonKey ? t(item.reasonKey) : null}
          currentReason={t("split.menu.why.alreadyLang")}
          onPick={(lang) => onPick("lang", lang)}
          testId="assign-ctx-lang"
        />
      );
    }
    const Icon = ASSIGN_ACTION_ICONS[item.action];
    const label = t(item.labelKey ?? ASSIGN_ACTION_LABELS[item.action]);
    const reason = item.reasonKey ? t(item.reasonKey) : null;
    return (
      <button
        key={item.action}
        type="button"
        role="menuitem"
        className="menu-item"
        aria-disabled={item.enabled ? undefined : "true"}
        aria-label={reason ? `${label} - ${reason}` : undefined}
        data-tip={reason ?? undefined}
        data-tip-side="right"
        data-testid={`assign-ctx-${item.action}`}
        onClick={() => {
          if (item.enabled) onPick(item.action);
        }}
      >
        <Icon size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {KEYS[item.action] && <kbd>{KEYS[item.action]}</kbd>}
      </button>
    );
  }

  return (
    <Menu anchorRef={anchorRef} onClose={onClose} testId="assign-ctx-menu" label={t("assign.ctx.label")} place={place}>
      {/* display: contents - 툴팁 핸들러만 얹고 항목 배치는 Menu 그대로 */}
      <div style={{ display: "contents" }} {...tip.handlers}>
        <p className="menu-label">{t("assign.ctx.assignGroup")}</p>
        {groups.assign.map(renderItem)}
        <div className="menu-sep" role="separator" />
        <p className="menu-label">{t("assign.ctx.editGroup")}</p>
        {groups.edit.map(renderItem)}
      </div>
      {tip.node}
    </Menu>
  );
}
