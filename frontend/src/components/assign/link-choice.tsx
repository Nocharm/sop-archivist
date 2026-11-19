// 고른 곳이 이미 쓴 문서의 문장일 때 - 문장마다 한 줄(언어 · 글 · 끝에 변경 종류, 문서 번호는 상자 머리에). 종류는 읽기만 한다 -
// "=" / "수정"은 글 비교 미리 보기, 나눔·합침·번역은 서버가 구조로 정한다(설계 2026-11-20-change-type-two D7).
// 한 줄로 줄여 결정 칸을 낮게 둔다 - 전체 글은 올리면 툴팁, New 원문에서도 고른 문장이 강조된다.
"use client";

import { Fragment, type ReactNode } from "react";

import { ChangeKindChip } from "@/components/assign/change-kind-chip";
import { LangToken } from "@/components/paper/lang-token";
import { Truncate } from "@/components/ui/motion";
import type { WrittenSentence } from "@/lib/api-sop";
import type { TextChangeType } from "@/lib/classify-model";
import { useI18n } from "@/lib/i18n";

interface LinkChoiceProps {
  rows: WrittenSentence[];
  /** 줄에 없는 언어의 문장 - 서버가 번역으로 정한다 */
  translatedIds: ReadonlySet<number>;
  /** 문장마다 "=" / "수정" 미리 보기(previewLinkChange) */
  changes: Record<number, TextChangeType>;
  auto: "split" | "merged" | null;
  mergedWith: string[];
  /** 문장 줄 바로 아래의 알림(참조 줄이 EQUIS와 다를 때) - 없으면 그리지 않는다 */
  renderNote?: (row: WrittenSentence) => ReactNode;
}

export function LinkChoice({ rows, translatedIds, changes, auto, mergedWith, renderNote }: LinkChoiceProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1.5">
      {rows.map((row) => (
        <Fragment key={row.target_id}>
          <div className="chosen-line" data-testid={`assign-link-${row.target_id}`}>
            <LangToken lang={row.lang} />
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
              <Truncate text={row.text} lang={row.lang === "neutral" ? undefined : row.lang} />
            </span>
            {translatedIds.has(row.target_id) ? (
              <ChangeKindChip kind="translated" testId={`assign-change-${row.target_id}-translated`} />
            ) : (
              auto === null && <ChangeKindChip kind={changes[row.target_id]} testId={`assign-change-${row.target_id}`} />
            )}
          </div>
          {renderNote?.(row)}
        </Fragment>
      ))}
      {auto && <p className="text-xs font-semibold text-accent">{t(auto === "split" ? "assign.autoSplit" : "assign.autoMerged")}</p>}
      {mergedWith.length > 0 && <p className="text-xs text-ink-2">{t("assign.mergedWith", { ids: mergedWith.join(", ") })}</p>}
    </div>
  );
}
