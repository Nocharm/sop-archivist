// 결과물 A의 한 줄(7열) - 의미 묶음 안에서 문장마다 한 줄. 묶음이 함께 쓰는 칸(Row·Remark)은 묶음 첫 줄에만, 보낸 곳 종류·새 문서는 바뀔 때만 보인다.
// 원문·새 문장·Remark 칸은 6줄까지만 보이고, 줄마다 펼치기 단추로 그 줄만 전부 열면서 확정한 사람·시각·관계 묶음·경고도 보인다(키보드로 닿는다).
"use client";

import { useEffect, useRef, useState } from "react";

import { UnitStatusChip } from "@/components/status";
import { Tooltip } from "@/components/ui/tooltip";
import type { CoverStatus } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { AScreenLine } from "@/lib/output-groups";
import { truncateMiddle } from "@/lib/truncate-middle";

interface OutputARowViewProps {
  line: AScreenLine;
  index: number;
  /** 보낸 곳 종류 문구(New SOP·WI·Deleted…), 미배정이면 빈 글 */
  destKindLabel: string;
  /** 변경 종류 문구 */
  changeLabel: string | null;
  status: CoverStatus;
}

export function OutputARowView({ line, index, destKindLabel, changeLabel, status }: OutputARowViewProps) {
  const { t } = useI18n();
  const { row, showShared, showDest } = line;
  const [isOpen, setIsOpen] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const remarkRef = useRef<HTMLDivElement>(null);

  // 칸 폭이 바뀌면(창 크기·언어) 잘림 여부도 달라진다 - 펼친 동안은 잘리지 않으니 단추는 isOpen이 붙든다
  useEffect(() => {
    const targets = [sourceRef.current, newRef.current, remarkRef.current];
    const check = () => {
      const clamped = targets.some((el) => el !== null && el.scrollHeight > el.clientHeight + 1);
      setIsClamped((prev) => (isOpen ? prev : clamped));
    };
    const observer = new ResizeObserver(check);
    for (const el of targets) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, row.source_text, row.confirmed_text, row.ai_text, row.remark, showShared]);

  const newText = row.confirmed_text || row.ai_text;
  const hasDetails = row.confirmed_by !== null || row.confirmed_at !== null || row.group_id !== null || row.warnings.length > 0;
  const destCode = truncateMiddle(row.dest_doc_code, 12, 10);
  const expandId = `output-a-${index}-expand`;
  const clamp = isOpen ? "" : "clamp-6";
  return (
    <tr data-testid={`output-a-row-${index}`} data-group-start={showShared ? "" : undefined}>
      <td className="font-mono text-xs tabular-nums" data-testid={`output-a-row-no-${index}`}>
        {showShared ? row.row_no : ""}
      </td>
      <td className="[overflow-wrap:anywhere]">
        {row.old_doc_code || row.display_id ? (
          <>
            <span className="font-mono text-xs">
              {row.old_doc_code} <span className="text-ink-3">{row.location.section}</span>
            </span>
            <span className="block font-mono text-[11px] text-ink-3">{row.display_id}</span>
          </>
        ) : (
          <span className="text-ink-4">–</span>
        )}
        {(isClamped || hasDetails || isOpen) && (
          <button
            type="button"
            className="mt-1 block text-[11px] text-accent underline-offset-2 hover:underline"
            aria-expanded={isOpen}
            data-testid={expandId}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            {t(isOpen ? "common.showLess" : "common.showMore")}
          </button>
        )}
      </td>
      <td className="[overflow-wrap:anywhere]" style={{ fontFamily: "var(--font-source)" }}>
        {row.source_text ? (
          <div ref={sourceRef} className={clamp}>
            {row.source_text}
          </div>
        ) : (
          <span className="text-ink-4">–</span>
        )}
      </td>
      <td className="[overflow-wrap:anywhere]">
        {showDest && destKindLabel !== "" && <span className="block text-xs text-ink-2">{destKindLabel}</span>}
        {/* 100자 코드가 좁은 칸에서 열 줄로 접히지 않게 가운데를 줄이고, 전체는 툴팁으로(키보드 포커스로도) */}
        {showDest && row.dest_doc_code !== "" && (
          <Tooltip label={row.dest_doc_code} suppressed={destCode === row.dest_doc_code} align="start">
            <span className="block min-w-0 font-mono text-xs" tabIndex={destCode === row.dest_doc_code ? undefined : 0}>
              {destCode}
            </span>
          </Tooltip>
        )}
        {row.dest_location && <span className="block text-xs text-ink-3">{row.dest_location}</span>}
        {row.dest_number && (
          <span className="block whitespace-pre-line font-mono text-[11px] text-ink-2" data-testid={`output-a-number-${index}`}>
            {row.dest_number}
          </span>
        )}
        {showDest && destKindLabel === "" && !row.dest_location && <span className="text-ink-4">–</span>}
      </td>
      <td className="[overflow-wrap:anywhere]" style={{ fontFamily: "var(--font-source)" }}>
        {/* 확정 글이 없으면 AI 글을 점선 테두리로(결과물 C와 같은 표시). 보낸 새 문장이 모두 주석 줄이면 C처럼 기울인다 */}
        {newText ? (
          <div
            ref={newRef}
            className={`${clamp} ${row.confirmed_text ? "" : "rounded-sm border border-dashed border-line-2 px-1"} ${row.dest_is_note ? "italic" : ""}`}
            data-testid={row.confirmed_text ? `output-a-new-${index}` : `output-a-ai-${index}`}
          >
            {newText}
          </div>
        ) : (
          <span className="text-ink-4">–</span>
        )}
        {isOpen && hasDetails && (
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs text-ink-3" style={{ fontFamily: "var(--font-ui)" }} data-testid={`output-a-details-${index}`}>
            {row.confirmed_by !== null && (
              <>
                <dt>{t("outputs.confirmedBy")}</dt>
                <dd className="text-ink-2">{row.confirmed_by}</dd>
              </>
            )}
            {row.confirmed_at !== null && (
              <>
                <dt>{t("outputs.confirmedAt")}</dt>
                <dd className="tabular-nums text-ink-2">{formatKst(row.confirmed_at)}</dd>
              </>
            )}
            {row.group_id !== null && (
              <>
                <dt>{t("outputs.groupId")}</dt>
                <dd className="font-mono text-ink-2">{row.group_id}</dd>
              </>
            )}
            {row.warnings.length > 0 && (
              <>
                <dt>{t("outputs.checksCol")}</dt>
                <dd className="text-ink-2">
                  {row.warnings.map((warning, at) => (
                    <span key={at} className="block">
                      {warning.kind}: {warning.source} → {warning.target}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        )}
      </td>
      <td className="[overflow-wrap:anywhere]">
        {showShared && row.remark && (
          <div ref={remarkRef} className={`${clamp} whitespace-pre-line text-xs text-ink-2`}>
            {row.remark}
          </div>
        )}
      </td>
      <td>
        <UnitStatusChip status={status} />
        {changeLabel && <span className="mt-0.5 block text-xs text-ink-3">{changeLabel}</span>}
      </td>
    </tr>
  );
}
