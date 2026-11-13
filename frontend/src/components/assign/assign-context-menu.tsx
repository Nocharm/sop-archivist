// Assign Old 문장 우클릭 메뉴 - 위는 배정(고른 곳으로 확정·배정 취소), 아래는 문장 고치기(여기서 나누기·앞뒤와 합치기·언어).
// 항목의 가능/불가는 순수 모델(assign-context-menu-model)이 정한다. 꺼진 항목은 숨기지 않고 흐리게, 까닭은 data-tip 툴팁이다.
// 자리는 그 자리 메뉴와 같은 규칙(placeLinkMenu) - 그 줄의 조각들(한/영 짝이면 둘 다) 아래(모자라면 위)에 놓아 다룰 문장을 가리지 않는다.
"use client";

import { ArrowDownToLine, ArrowUpToLine, Check, Eraser, Scissors, type LucideIcon } from "lucide-react";
import { useRef } from "react";

import { Menu } from "@/components/ui/menu";
import { MenuLangRow } from "@/components/ui/menu-lang-row";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import type { AssignMenuAction, AssignMenuGroups, AssignMenuItem } from "@/lib/assign-context-menu-model";
import { useI18n } from "@/lib/i18n";
import { placeLinkMenu } from "@/lib/link-menu-place";

const ICONS: Record<Exclude<AssignMenuAction, "lang">, LucideIcon> = {
  confirm: Check,
  clear: Eraser,
  split: Scissors,
  merge_prev: ArrowUpToLine,
  merge_next: ArrowDownToLine,
};

const LABELS: Record<Exclude<AssignMenuAction, "lang">, string> = {
  confirm: "classify.confirm",
  clear: "classify.clear",
  split: "split.cutHere",
  merge_prev: "assign.ctx.mergePrev",
  merge_next: "assign.ctx.mergeNext",
};

const KEYS: Partial<Record<AssignMenuAction, string>> = { confirm: "↵", clear: "U" };

interface AssignContextMenuProps {
  /** 누른 문장의 조각 - 닫으면 포커스가 돌아갈 곳 */
  anchor: HTMLElement;
  /** 가리지 않을 조각들(누른 줄의 Unit 전부) - 비면 anchor */
  cover: HTMLElement[];
  /** 누른 자리(화면 좌표) - 키보드로 열었으면 null(줄 왼쪽 아래) */
  click: { x: number; y: number } | null;
  groups: AssignMenuGroups;
  /** 확정할 곳의 짧은 이름(문서 번호 등) - 확정 항목 오른쪽에 흐리게 */
  destinationLabel: string;
  onPick: (action: AssignMenuAction, lang?: "ko" | "en") => void;
  onClose: () => void;
}

export function AssignContextMenu({ anchor, cover, click, groups, destinationLabel, onPick, onClose }: AssignContextMenuProps) {
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
    const Icon = ICONS[item.action];
    const label = t(LABELS[item.action]);
    const reason = item.reasonKey ? t(item.reasonKey) : null;
    const hint = item.action === "confirm" && item.enabled ? destinationLabel : "";
    return (
      <button
        key={item.action}
        type="button"
        role="menuitem"
        className="menu-item"
        aria-disabled={item.enabled ? undefined : "true"}
        aria-label={reason ? `${label} - ${reason}` : hint ? `${label} - ${hint}` : undefined}
        data-tip={reason ?? undefined}
        data-tip-side="right"
        data-testid={`assign-ctx-${item.action}`}
        onClick={() => {
          if (item.enabled) onPick(item.action);
        }}
      >
        <Icon size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint && <span className="ctx-hint">{hint}</span>}
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
