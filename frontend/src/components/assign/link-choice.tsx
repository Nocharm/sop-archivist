// 고른 곳이 이미 쓴 문서의 문장일 때 - 문장마다 한 줄(언어 · 글 · 끝에 변경 종류, 문서 번호는 상자 머리에). 나눔·합침·번역은 서버가 구조로 정해 글로만 보인다.
// 한 줄로 줄여 결정 칸을 낮게 둔다 - 전체 글은 올리면 툴팁, New 원문에서도 고른 문장이 강조된다.
"use client";

import { Fragment, type ReactNode } from "react";

import { ChangeKindChip, ChangeKindToggle, type TextChangeKind } from "@/components/assign/change-kind-toggle";
import { LangToken } from "@/components/paper/lang-token";
import { Truncate } from "@/components/ui/motion";
import type { ChangeTypeInput, WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface LinkChoiceProps {
  rows: WrittenSentence[];
  changeTypes: Record<number, ChangeTypeInput | null>;
  /** 아직 사람이 받지 않은 AI 연결 - 기본은 제안 그대로(null) */
  aiPending: ReadonlySet<number>;
  /** 줄에 없는 언어의 문장 - 서버가 번역으로 정해 종류를 고르지 않는다 */
  translatedIds: ReadonlySet<number>;
  /** 사람이 고르지 않았을 때 저장될 값(글이 같으면 그대로) - 고른 값으로 보인다 */
  defaults: Record<number, ChangeTypeInput>;
  auto: "split" | "merged" | null;
  mergedWith: string[];
  onChange: (targetId: number, value: ChangeTypeInput | null) => void;
  /** 문장 줄 바로 아래의 알림(참조 줄이 EQUIS와 다를 때) - 없으면 그리지 않는다 */
  renderNote?: (row: WrittenSentence) => ReactNode;
}

function readTextKind(value: string | null | undefined): TextChangeKind | null {
  return value === "as_is" || value === "tone" || value === "rewritten" ? value : null;
}

export function LinkChoice({ rows, changeTypes, aiPending, translatedIds, defaults, auto, mergedWith, onChange, renderNote }: LinkChoiceProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1.5">
      {rows.map((row) => {
        const current = row.target_id in changeTypes ? changeTypes[row.target_id] : aiPending.has(row.target_id) ? null : defaults[row.target_id];
        // 아직 받지 않은 AI 연결(null)은 AI가 고른 종류가 눌린 채 ✦ - 그 칸을 다시 누르면 AI 제안 그대로(null)로 남는다
        const aiKind = aiPending.has(row.target_id) ? readTextKind(row.change_type) : null;
        return (
          <Fragment key={row.target_id}>
            <div className="chosen-line" data-testid={`assign-link-${row.target_id}`}>
              <LangToken lang={row.lang} />
              <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
                <Truncate text={row.text} lang={row.lang === "neutral" ? undefined : row.lang} />
              </span>
              {translatedIds.has(row.target_id) ? (
                <ChangeKindChip kind="translated" testId={`assign-change-${row.target_id}-translated`} />
              ) : (
                auto === null && (
                  <ChangeKindToggle
                    testId={`assign-change-${row.target_id}`}
                    value={current === null ? aiKind : readTextKind(current)}
                    aiKind={aiKind}
                    onChange={(kind) => onChange(row.target_id, kind === aiKind && current === null ? null : kind)}
                  />
                )
              )}
            </div>
            {renderNote?.(row)}
          </Fragment>
        );
      })}
      {auto && <p className="text-xs font-semibold text-accent">{t(auto === "split" ? "assign.autoSplit" : "assign.autoMerged")}</p>}
      {mergedWith.length > 0 && <p className="text-xs text-ink-2">{t("assign.mergedWith", { ids: mergedWith.join(", ") })}</p>}
    </div>
  );
}
