// 문서 상태·보조 검사·추출 경고 표시 - 상태 라벨은 영어 고정, 거절 사유와 경고 설명은 화면 언어.
"use client";

import { CircleAlert, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { DocStatus, ExtractionWarning, SopDocument } from "@/lib/api-sop";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function DocStatusPill({ status, testId }: { status: DocStatus; testId?: string }) {
  const { t } = useI18n();
  const ready = status === "ready";
  return (
    <span className={`pill ${ready ? "muted" : "fail"}`} data-testid={testId}>
      {ready ? <CircleCheck size={12} strokeWidth={1.5} aria-hidden /> : <CircleX size={12} strokeWidth={1.5} aria-hidden />}
      {t(`status.doc.${status}`)}
    </span>
  );
}

export function AuxPill({ document, testId }: { document: SopDocument; testId?: string }) {
  if (!document.extraction) {
    return (
      <span className="text-ink-4" data-testid={testId}>
        –
      </span>
    );
  }
  const ok = document.extraction.aux_status === "ok";
  return (
    <span className={`pill ${ok ? "quiet" : "warn"}`} data-testid={testId}>
      {ok ? <CircleCheck size={12} strokeWidth={1.5} aria-hidden /> : <CircleAlert size={12} strokeWidth={1.5} aria-hidden />}
      {ok ? "Checked" : "Aux check unavailable"}
    </span>
  );
}

/** 거절·실패 사유 한 줄. 모르는 코드는 일반 문구 */
export function getDocReason(document: SopDocument, t: TFunc): string {
  const key = `docReason.${document.status_reason}`;
  const text = t(key);
  return text === key ? t(document.status === "failed" ? "docReason.failed" : "docReason.rejected") : text;
}

function getWarningLabel(kind: string, t: TFunc): string {
  const key = `warn.${kind}`;
  const text = t(key);
  return text === key ? t("warn.other") : text;
}

interface WarningGroup {
  kind: string;
  count: number;
  open: number;
}

function groupWarnings(warnings: ExtractionWarning[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  for (const warning of warnings) {
    const group = groups.get(warning.kind) ?? { kind: warning.kind, count: 0, open: 0 };
    group.count += 1;
    if (warning.needs_ack && warning.acked_by === null) group.open += 1;
    groups.set(warning.kind, group);
  }
  return [...groups.values()];
}

function WarningChip({ group, testId }: { group: WarningGroup; testId: string }) {
  const { t } = useI18n();
  return (
    <span className={`pill shrink-0 ${group.open > 0 ? "warn" : "quiet"}`} data-testid={`${testId}-${group.kind}`}>
      <TriangleAlert size={12} strokeWidth={1.5} aria-hidden />
      {getWarningLabel(group.kind, t)}
      {group.count > 1 && <span className="tabular-nums">{` ${group.count}`}</span>}
    </span>
  );
}

/** 경고를 종류별로 묶어 칩 하나씩. 확인이 필요한데 아직 안 한 것만 경고색, 나머지는 조용히 */
export function WarningChips({ warnings, testId }: { warnings: ExtractionWarning[]; testId: string }) {
  if (warnings.length === 0) {
    return (
      <span className="text-ink-4" data-testid={testId}>
        –
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1" data-testid={testId}>
      {groupWarnings(warnings).map((group) => (
        <WarningChip key={group.kind} group={group} testId={testId} />
      ))}
    </span>
  );
}

const CHIP_GAP_PX = 4;

/** 한 줄에 들어가는 만큼만 칩을 보이고 나머지는 "+N" 칩 하나로 접는다(호버·포커스 툴팁에 전부). 폭이 달라지면 다시 잰다 - 경고 목록이 바뀌면 key로 새로 그린다 */
export function WarningChipsOneLine({ warnings, testId }: { warnings: ExtractionWarning[]; testId: string }) {
  const { t } = useI18n();
  const groups = groupWarnings(warnings);
  const [shown, setShown] = useState(groups.length);
  const observerRef = useRef<ResizeObserver | null>(null);
  // 잴 때는 칩을 모두 그려 두고(넘치는 칩은 자른다) 각 폭을 읽는다 - 안 보이는 칩도 폭은 잰다
  const hostRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (node === null) return;
    const measure = () => {
      const chips = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
      const plus = node.querySelector<HTMLElement>("[data-plus]");
      const widths = chips.map((chip) => chip.offsetWidth);
      const total = widths.reduce((sum, width) => sum + width, 0) + CHIP_GAP_PX * Math.max(widths.length - 1, 0);
      if (total <= node.clientWidth) return setShown(widths.length);
      const plusWidth = (plus?.offsetWidth ?? 0) + CHIP_GAP_PX;
      let used = plusWidth;
      let count = 0;
      for (const width of widths) {
        if (used + width + (count > 0 ? CHIP_GAP_PX : 0) > node.clientWidth) break;
        used += width + (count > 0 ? CHIP_GAP_PX : 0);
        count += 1;
      }
      setShown(count);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const hidden = groups.slice(shown);
  const hiddenNames = hidden.map((group) => `${getWarningLabel(group.kind, t)}${group.count > 1 ? ` ${group.count}` : ""}`).join(", ");
  return (
    <span ref={hostRef} className="relative flex w-0 min-w-full flex-nowrap items-center gap-1 overflow-hidden" data-testid={testId}>
      {groups.map((group, index) => (
        <span key={group.kind} data-chip className={index < shown ? "inline-flex" : "invisible absolute"}>
          <WarningChip group={group} testId={testId} />
        </span>
      ))}
      <span data-plus className={hidden.length > 0 ? "inline-flex shrink-0" : "invisible absolute"}>
        <Tooltip label={hiddenNames} align="end">
          <span role="note" className={`pill ${hidden.some((group) => group.open > 0) ? "warn" : "quiet"}`} aria-label={hiddenNames} tabIndex={hidden.length > 0 ? 0 : -1} data-testid={`${testId}-more`}>
            {`+${hidden.length}`}
          </span>
        </Tooltip>
      </span>
    </span>
  );
}
