// 결과물 A의 한 줄 - 원문·New 문장 칸은 6줄까지만 보이고, 줄마다 펼치기 단추로 그 줄만 전부 연다(키보드로 닿는다).
"use client";

import { useEffect, useRef, useState } from "react";

import { UnitStatusPill } from "@/components/status";
import { Tooltip } from "@/components/ui/tooltip";
import type { CoverStatus, OutputARow } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { truncateMiddle } from "@/lib/truncate-middle";

interface OutputARowViewProps {
  row: OutputARow;
  index: number;
  /** 보낸 곳 이름(위치 또는 종류 문구) - 화면 문구로 바꾼 값 */
  destLabel: string;
  /** 변경 종류 문구 */
  changeLabel: string | null;
  status: CoverStatus;
}

export function OutputARowView({ row, index, destLabel, changeLabel, status }: OutputARowViewProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);

  // 칸 폭이 바뀌면(창 크기·언어) 잘림 여부도 달라진다 - 펼친 동안은 잘리지 않으니 단추는 isOpen이 붙든다
  useEffect(() => {
    const check = () => {
      const clamped = [sourceRef.current, newRef.current].some((el) => el !== null && el.scrollHeight > el.clientHeight + 1);
      setIsClamped((prev) => (isOpen ? prev : clamped));
    };
    const observer = new ResizeObserver(check);
    for (const el of [sourceRef.current, newRef.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, row.source_text, row.confirmed_text]);

  const destCode = truncateMiddle(row.dest_doc_code, 12, 10);
  const expandId = `output-a-${index}-expand`;
  return (
    <tr data-testid={`output-a-row-${index}`}>
      <td className="[overflow-wrap:anywhere]">
        <span className="font-mono text-xs">
          {row.old_doc_code} <span className="text-ink-3">{row.location.section}</span>
        </span>
        <span className="block font-mono text-[11px] text-ink-3">{row.display_id}</span>
        {(isClamped || isOpen) && (
          <button
            type="button"
            className="mt-1 text-[11px] text-accent underline-offset-2 hover:underline"
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
          <div ref={sourceRef} className={isOpen ? undefined : "clamp-6"}>
            {row.source_text}
          </div>
        ) : (
          <span className="text-ink-4">–</span>
        )}
      </td>
      <td className="[overflow-wrap:anywhere]">
        {/* 100자 코드가 좁은 칸에서 열 줄로 접히지 않게 가운데를 줄이고, 전체는 툴팁으로(키보드 포커스로도) */}
        {row.dest_doc_code !== "" && (
          <Tooltip label={row.dest_doc_code} suppressed={destCode === row.dest_doc_code} align="start">
            <span className="block min-w-0 font-mono text-xs" tabIndex={destCode === row.dest_doc_code ? undefined : 0}>
              {destCode}
            </span>
          </Tooltip>
        )}
        <span className="block text-xs text-ink-3">{destLabel}</span>
        {row.dest_number && (
          <span className="block whitespace-pre-line font-mono text-[11px] text-ink-2" data-testid={`output-a-number-${index}`}>
            {row.dest_number}
          </span>
        )}
      </td>
      <td className="[overflow-wrap:anywhere]" style={{ fontFamily: "var(--font-source)" }}>
        {/* 보낸 새 문장이 모두 주석 줄이면 결과물 C처럼 기울여 보인다 */}
        {row.confirmed_text ? (
          <div ref={newRef} className={`${isOpen ? "" : "clamp-6"} ${row.dest_is_note ? "italic" : ""}`} data-testid={row.dest_is_note ? `output-a-note-${index}` : undefined}>
            {row.confirmed_text}
          </div>
        ) : (
          <span className="text-ink-4">–</span>
        )}
        {changeLabel && <span className="block text-xs text-ink-3" style={{ fontFamily: "var(--font-ui)" }}>{changeLabel}</span>}
      </td>
      <td>
        <UnitStatusPill status={status} />
      </td>
    </tr>
  );
}
