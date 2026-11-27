// 본문·머리말·꼬리말·그림 탭 줄 - Assign Old 칸과 New 칸이 같은 모양을 쓴다(둘 이상일 때만 그린다)
"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { PaperSheet, PaperTabKey } from "@/lib/paper-model";

interface PartTabsProps {
  keys: readonly PaperTabKey[];
  active: PaperTabKey;
  onChange: (key: PaperTabKey) => void;
  /** 탭 오른쪽 표시(남은 확인 수 등) */
  renderBadge?: (key: PaperTabKey) => ReactNode;
  /** 탭 이름 뒤 수 - 그림 탭의 "Figures n"(시안 2 D3) */
  counts?: Partial<Record<PaperTabKey, number | undefined>>;
  /** `<prefix>s`는 줄, `<prefix>-<key>`는 탭의 testid */
  testIdPrefix: string;
}

/** 머리말 · 꼬리말 쪽의 설명 줄 - 쓰이는 구역(1구역 · 첫 쪽…), 구역 정보가 없는 옛 추출이나 각주는 "머리말 2"처럼 차례로 */
export function describeSheet(sheet: PaperSheet, index: number, t: ReturnType<typeof useI18n>["t"]): string {
  if (sheet.refs.length === 0) return t("split.sheetOrdinal", { name: t(`split.part.${sheet.part}`), n: index + 1 });
  return sheet.refs.map((ref) => t("split.sheetRef", { n: ref.section, type: t(`split.refType.${ref.type}`) })).join(", ");
}

export function PartTabs({ keys, active, onChange, renderBadge, counts, testIdPrefix }: PartTabsProps) {
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
            {counts?.[key] !== undefined && <span className="tabular-nums text-ink-3">{counts[key]}</span>}
            {renderBadge?.(key)}
          </button>
        );
      })}
    </div>
  );
}
