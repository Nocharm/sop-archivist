// 본문·머리말·꼬리말 탭 줄 - Split과 Assign Old 칸이 같은 모양을 쓴다(둘 이상일 때만 그린다)
"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { PaperTabKey } from "@/lib/paper-model";

interface PartTabsProps {
  keys: readonly PaperTabKey[];
  active: PaperTabKey;
  onChange: (key: PaperTabKey) => void;
  /** 탭 오른쪽 표시(남은 확인 수 등) */
  renderBadge?: (key: PaperTabKey) => ReactNode;
  /** `<prefix>s`는 줄, `<prefix>-<key>`는 탭의 testid */
  testIdPrefix: string;
}

export function PartTabs({ keys, active, onChange, renderBadge, testIdPrefix }: PartTabsProps) {
  const { t } = useI18n();
  return (
    <div className="flex gap-0.5 rounded-md bg-sunken p-0.5" role="tablist" aria-label={t("split.tabs")} data-testid={`${testIdPrefix}s`}>
      {keys.map((key) => {
        const isOn = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isOn}
            className={`flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-xs ${isOn ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
            data-testid={`${testIdPrefix}-${key}`}
            onClick={() => onChange(key)}
          >
            {t(`split.tab.${key}`)}
            {renderBadge?.(key)}
          </button>
        );
      })}
    </div>
  );
}
