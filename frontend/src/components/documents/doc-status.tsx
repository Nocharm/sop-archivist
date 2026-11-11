// 문서 상태·보조 검사·추출 경고 표시 - 상태 라벨은 영어 고정, 거절 사유와 경고 설명은 화면 언어.
"use client";

import { CircleAlert, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
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

/** 좁은 칸용 - 경고를 종류 구분 없이 `⚠ N` 칩 하나로 줄이고 목록은 툴팁으로 본다. 확인이 필요한데 아직 안 한 것이 있으면 경고색 */
export function WarningCountChip({ warnings, testId }: { warnings: ExtractionWarning[]; testId: string }) {
  const { t } = useI18n();
  const groups = groupWarnings(warnings);
  const list = groups.map((group) => `${getWarningLabel(group.kind, t)}${group.count > 1 ? ` ${group.count}` : ""}`).join(", ");
  return (
    <Tooltip label={list}>
      <span role="note" tabIndex={0} aria-label={list} className={`pill ${groups.some((group) => group.open > 0) ? "warn" : "quiet"}`} data-testid={testId}>
        <TriangleAlert size={12} strokeWidth={1.5} aria-hidden />
        <span className="tabular-nums">{warnings.length}</span>
      </span>
    </Tooltip>
  );
}
