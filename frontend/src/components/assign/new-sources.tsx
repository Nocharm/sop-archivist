// New 문장 · 표 칸 위 줄의 출처 칩 - 용지(new-paper)와 엮은 문서(new-pane)가 같은 칩을 쓴다. 칩 오른쪽 갈매기는 LinkLines가 data-dir로 켠다.
"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { NewAiMark } from "@/lib/new-ai-filter-model";

// 칩 줄에 먼저 보이는 출처 수 - 넘치면 "+N"을 눌러 펼친다(연결선은 접힌 출처를 "+N"에 잇는다)
const VISIBLE_SOURCES = 2;

interface SourceChipsProps {
  targetId: number;
  ids: readonly number[];
  isAi: boolean;
  sourceLabel: (unitId: number) => string;
  /** 칩을 누름 - Old의 그 조각으로 간다 */
  onJump: (unitId: number, targetId: number) => void;
  /** "+N"을 눌러 펼쳤다 */
  isOpen: boolean;
  onOpen: (targetId: number) => void;
  /** 있으면(표 칸) 칩마다 끊기 × */
  onUnlink?: (unitId: number) => void;
}

export function SourceChips({ targetId, ids, isAi, sourceLabel, onJump, isOpen, onOpen, onUnlink }: SourceChipsProps) {
  const { t } = useI18n();
  const visible = isOpen || ids.length <= VISIBLE_SOURCES + 1 ? ids : ids.slice(0, VISIBLE_SOURCES);
  const hidden = ids.slice(visible.length);
  return (
    <>
      {visible.map((unitId) => (
        <Fragment key={unitId}>
          <button
            type="button"
            className="new-src"
            aria-label={t("assign.jumpOld", { id: sourceLabel(unitId) })}
            data-src-unit={unitId}
            data-ai={isAi ? "" : undefined}
            data-testid={`assign-new-src-${targetId}-${unitId}`}
            onClick={() => onJump(unitId, targetId)}
          >
            {sourceLabel(unitId)}
            <ChevronUp size={11} strokeWidth={2.5} className="new-src-dir" data-d="above" aria-hidden />
            <ChevronDown size={11} strokeWidth={2.5} className="new-src-dir" data-d="below" aria-hidden />
          </button>
          {onUnlink && (
            <button
              type="button"
              className="new-src new-src-x"
              aria-label={t("assign.cellLink.unlink", { id: sourceLabel(unitId) })}
              data-tip={t("assign.cellLink.unlink", { id: sourceLabel(unitId) })}
              data-testid={`assign-new-src-x-${targetId}-${unitId}`}
              onClick={() => onUnlink(unitId)}
            >
              <X size={11} strokeWidth={2.5} aria-hidden />
            </button>
          )}
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          className="new-src is-more"
          aria-label={t("assign.moreSources", { n: hidden.length })}
          data-src-more={hidden.join(",")}
          data-testid={`assign-new-src-more-${targetId}`}
          onClick={() => onOpen(targetId)}
        >
          +{hidden.length}
        </button>
      )}
    </>
  );
}

/** AI 제안 거르기의 꼬리표 - 고른 줄의 AI 제안이거나 고른 줄이 이미 간 곳일 때만 */
export function NewAiTag({ targetId, mark }: { targetId: number; mark: NewAiMark | undefined }): ReactNode {
  const { t } = useI18n();
  if (mark !== "mine_ai" && mark !== "mine_went") return null;
  return (
    <span className="new-ai-tag" data-testid={`assign-new-ai-tag-${targetId}`}>
      {t(mark === "mine_ai" ? "assign.newAi.mine" : "assign.newAi.went")}
    </span>
  );
}
