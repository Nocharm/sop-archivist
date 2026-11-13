// Split 문장 우클릭 메뉴 - 항목의 가능/불가는 순수 모델(split-menu-model)이 정하고, 이 부품은 포인터 자리에 Menu를 띄워 보인다.
// 꺼진 항목은 aria-disabled(포커스·호버를 받아야 까닭을 보인다)이고 까닭은 data-tip 툴팁이다.
"use client";

import { CheckCheck, Link2, CirclePause, Scissors, Sparkles, Unlink, type LucideIcon } from "lucide-react";
import { useRef } from "react";

import { Menu } from "@/components/ui/menu";
import { MenuLangRow } from "@/components/ui/menu-lang-row";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { useI18n } from "@/lib/i18n";
import type { SplitMenuAction, SplitMenuItem } from "@/lib/split-menu-model";

const ICONS: Record<Exclude<SplitMenuAction, "lang">, LucideIcon> = {
  join: Link2,
  unpair: Unlink,
  check_both: CheckCheck,
  check: CheckCheck,
  split: Scissors,
  ai_split: Sparkles,
  hold: CirclePause,
};

const LABELS: Record<Exclude<SplitMenuAction, "lang">, string> = {
  join: "split.menu.join",
  unpair: "split.removePair",
  check_both: "split.menu.checkBoth",
  check: "split.checkBoundary",
  split: "split.split",
  ai_split: "split.menu.aiSplit",
  hold: "split.hold",
};

interface SplitContextMenuProps {
  /** 뜨는 자리(화면 좌표) - 포인터 또는 고른 문장 줄 */
  at: { x: number; y: number };
  items: SplitMenuItem[];
  /** 한 문장 메뉴에서 경계 확인 항목이 "취소"로 바뀐다 */
  isTargetChecked: boolean;
  /** lang은 고른 언어를 같이 준다 */
  onPick: (action: SplitMenuAction, lang?: "ko" | "en") => void;
  onClose: () => void;
}

export function SplitContextMenu({ at, items, isTargetChecked, onPick, onClose }: SplitContextMenuProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tip = useDelegatedTip();

  return (
    <>
      {/* 크기 없는 기준점 - Menu가 이 자리 아래(모자라면 위)로 놓고 화면 안으로 맞춘다 */}
      <span ref={anchorRef} aria-hidden style={{ position: "fixed", left: at.x, top: at.y, width: 0, height: 0, pointerEvents: "none" }} />
      <Menu anchorRef={anchorRef} onClose={onClose} testId="split-menu" label={t("split.menu.label")}>
        {/* display: contents - 툴팁 핸들러만 얹고 항목 배치는 Menu 그대로 */}
        <div style={{ display: "contents" }} {...tip.handlers}>
          {items.map((item) => {
            if (item.action === "lang") {
              return (
                <MenuLangRow
                  key="lang"
                  label={t("split.menu.lang")}
                  current={item.lang}
                  disabledReason={item.reasonKey ? t(item.reasonKey) : null}
                  currentReason={t("split.menu.why.alreadyLang")}
                  onPick={(lang) => onPick("lang", lang)}
                  testId="split-menu-lang"
                />
              );
            }
            const Icon = ICONS[item.action];
            const label = item.action === "check" && isTargetChecked ? t("split.uncheckBoundary") : t(LABELS[item.action]);
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
                data-testid={`split-menu-${item.action}`}
                onClick={() => {
                  if (item.enabled) onPick(item.action);
                }}
              >
                <Icon size={14} strokeWidth={1.5} aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        {tip.node}
      </Menu>
    </>
  );
}
