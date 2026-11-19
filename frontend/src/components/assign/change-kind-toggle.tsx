// 변경 종류(그대로 · 말투 · 고쳐 씀) 세 칸 아이콘 토글 - 고른 곳 상자의 문장 줄 끝에 둔다. 드롭다운은 지금 값이 눈에 잘 안 들어왔다(1.2.0 피드백).
// 서버가 구조로 정하는 나눔 · 합침 · 번역은 고를 수 없어 같은 자리에 아이콘 + 이름 칩(ChangeKindChip)으로 보인다.
"use client";

import { CaseSensitive, Equal, Languages, Merge, PenLine, Split, Sparkles, type LucideIcon } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export type TextChangeKind = "as_is" | "tone" | "rewritten";
const KINDS: TextChangeKind[] = ["as_is", "tone", "rewritten"];
const KIND_ICONS: Record<string, LucideIcon> = { as_is: Equal, tone: CaseSensitive, rewritten: PenLine, split: Split, merged: Merge, translated: Languages };

interface ChangeKindToggleProps {
  /** 눌린 칸 - null이면 아무 칸도 눌리지 않았다(AI 제안 종류가 없는 AI 연결) */
  value: TextChangeKind | null;
  /** 고를 수 없는 칸(글이 원문과 달라 그대로가 아님 등) - 흐리게, 올리면 까닭 */
  disabledKinds?: Partial<Record<TextChangeKind, string>>;
  /** 아직 사람이 받지 않은 AI 제안의 종류 - 그 칸에 ✦ 표시 */
  aiKind?: TextChangeKind | null;
  disabled?: boolean;
  onChange: (kind: TextChangeKind) => void;
  testId: string;
}

export function ChangeKindToggle({ value, disabledKinds = {}, aiKind = null, disabled = false, onChange, testId }: ChangeKindToggleProps) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("assign.changeType")} className="kind-toggle" data-testid={testId} data-value={value ?? undefined}>
      {KINDS.map((kind) => {
        const Icon = KIND_ICONS[kind];
        const why = disabledKinds[kind];
        const label = t(`change.${kind}`) + (kind === aiKind ? ` · ${t("assign.changeAiMark")}` : "") + (why ? ` — ${why}` : "");
        return (
          <Tooltip key={kind} label={label}>
            <button
              type="button"
              role="radio"
              aria-checked={value === kind}
              aria-label={label}
              className="kind-toggle-btn"
              data-testid={`${testId}-${kind}`}
              disabled={disabled || why !== undefined}
              onClick={() => onChange(kind)}
            >
              <Icon size={14} strokeWidth={1.75} aria-hidden />
              {kind === aiKind && <Sparkles size={8} strokeWidth={2} className="kind-toggle-ai" aria-hidden />}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** 서버가 정하는 종류(나눔 · 합침 · 번역) - 고를 수 없어 아이콘과 이름만 */
export function ChangeKindChip({ kind, testId }: { kind: string; testId: string }) {
  const { t } = useI18n();
  const Icon = KIND_ICONS[kind];
  return (
    <span className="kind-chip" data-testid={testId}>
      {Icon && <Icon size={12} strokeWidth={1.75} aria-hidden />}
      {t(`change.${kind}`)}
    </span>
  );
}
