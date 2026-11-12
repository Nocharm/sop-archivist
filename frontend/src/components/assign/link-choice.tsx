// 고른 곳이 이미 쓴 문서의 문장일 때 - 문장마다 변경 종류(AI 제안 그대로·그대로·말투·고쳐 씀). 나눔·합침은 서버가 구조로 정해 자동 표시만.
"use client";

import type { ChangeTypeInput, WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface LinkChoiceProps {
  rows: WrittenSentence[];
  changeTypes: Record<number, ChangeTypeInput | null>;
  /** 아직 사람이 받지 않은 AI 연결 - 기본은 제안 그대로(null) */
  aiPending: ReadonlySet<number>;
  /** 사람이 고르지 않았을 때 저장될 값(글이 같으면 그대로) - 눌린 칩으로 보인다 */
  defaults: Record<number, ChangeTypeInput>;
  auto: "split" | "merged" | null;
  mergedWith: string[];
  onChange: (targetId: number, value: ChangeTypeInput | null) => void;
}

const KINDS: ChangeTypeInput[] = ["as_is", "tone", "rewritten"];

export function LinkChoice({ rows, changeTypes, aiPending, defaults, auto, mergedWith, onChange }: LinkChoiceProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      {rows.map((row) => {
        const current = row.target_id in changeTypes ? changeTypes[row.target_id] : aiPending.has(row.target_id) ? null : defaults[row.target_id];
        return (
          <div key={row.target_id} className="grid gap-1.5" data-testid={`assign-link-${row.target_id}`}>
            <p className="text-[13px] leading-5 text-ink" lang={row.lang === "neutral" ? undefined : row.lang}>
              <b className="mr-1 font-mono text-[11px]">{row.doc_code}</b>
              {row.text}
            </p>
            {auto === null && (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("assign.changeType")}>
                {aiPending.has(row.target_id) && (
                  <button type="button" className="mini-chip" aria-pressed={current === null} data-testid={`assign-change-${row.target_id}-ai`} onClick={() => onChange(row.target_id, null)}>
                    {t("assign.changeAi", { type: row.change_type ? t(`change.${row.change_type}`) : "–" })}
                  </button>
                )}
                {KINDS.map((kind) => (
                  <button key={kind} type="button" className="mini-chip" aria-pressed={current === kind} data-testid={`assign-change-${row.target_id}-${kind}`} onClick={() => onChange(row.target_id, kind)}>
                    {t(`change.${kind}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {auto && <p className="text-xs font-semibold text-accent">{t(auto === "split" ? "assign.autoSplit" : "assign.autoMerged")}</p>}
      {mergedWith.length > 0 && <p className="text-xs text-ink-2">{t("assign.mergedWith", { ids: mergedWith.join(", ") })}</p>}
    </div>
  );
}
