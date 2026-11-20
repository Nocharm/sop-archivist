// 변경 종류 표시 - 고른 곳 상자의 문장 줄 끝에 둔다. 종류는 사람이 고르지 않고 서버가 정한다(설계 2026-11-20-change-type-two D2 · D7):
// 글자 비교 종류("=" / "수정")는 화면이 같은 규칙으로 미리 보이고 저장 응답이 이긴다. 나눔 · 합침 · 번역은 구조에서 나온다.
"use client";

import { Languages, Merge, PenLine, Split, type LucideIcon } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

// "="는 라벨이 곧 기호라 아이콘을 두지 않는다
const KIND_ICONS: Record<string, LucideIcon> = { rewritten: PenLine, split: Split, merged: Merge, translated: Languages };
// 글자 비교 종류는 라벨이 짧아 올리면 뜻을 보인다
const TIP_KINDS = new Set(["as_is", "rewritten"]);

export function ChangeKindChip({ kind, testId }: { kind: string; testId: string }) {
  const { t } = useI18n();
  const Icon = KIND_ICONS[kind];
  const chip = (
    <span className="kind-chip" data-testid={testId} data-value={kind}>
      {Icon && <Icon size={12} strokeWidth={1.75} aria-hidden />}
      {t(`change.${kind}`)}
    </span>
  );
  return TIP_KINDS.has(kind) ? <Tooltip label={t(`assign.changeTip.${kind}`)}>{chip}</Tooltip> : chip;
}
