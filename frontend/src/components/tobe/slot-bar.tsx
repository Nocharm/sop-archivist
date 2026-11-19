// SOP 줄의 칸 상태 막대(Documents 화면 설계 §6) - 그 문서 골격에서 문장을 받는 칸마다 눈금 하나(옆의 "n of m"과 같은 칸). 장식이라 aria-hidden이고 뜻은 옆의 글이 말한다.
// 상태는 모양으로도 갈린다(채움 · 테두리 · 빗금). 눈금의 툴팁은 목록 틀에 건 useDelegatedTip이 data-tip을 읽어 띄운다.
"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { formatSlotName, type SlotRow } from "@/lib/slot-status-model";

export function SlotBar({ rows, testId }: { rows: readonly SlotRow[]; testId: string }): ReactNode {
  const { t } = useI18n();
  const byKey = new Map(rows.map((row) => [row.key, row]));

  /** 칸 표의 상태 글과 같은 말 - 문장을 받지 않는 줄(auto · group)은 눈금이 없어 여기 오지 않는다 */
  function describe(row: SlotRow): string {
    const { state } = row;
    switch (state.kind) {
      case "filled":
        return state.count === 1 ? t("tobe.slots.sentenceOne") : t("tobe.slots.sentences", { n: state.count });
      case "sub":
        return t("tobe.slots.inSub", { n: state.count });
      case "covered": {
        const by = byKey.get(state.by);
        return by ? t("tobe.slots.covered", { name: formatSlotName(by) }) : t("tobe.slots.na");
      }
      case "na":
        return t("tobe.slots.na");
      default:
        return t("tobe.slots.empty");
    }
  }

  return (
    <span className="slot-bar" aria-hidden="true" data-testid={testId}>
      {rows
        .filter((row) => row.isAssignable)
        .map((row) => (
          <i key={row.key} data-state={row.state.kind} data-child={row.level > 0 ? "" : undefined} data-tip={`${formatSlotName(row)} · ${describe(row)}`} />
        ))}
    </span>
  );
}
