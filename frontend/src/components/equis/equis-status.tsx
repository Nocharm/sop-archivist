// EQUIS 표시 - 문서 번호가 EQUIS에서 어떤 상태인지 한 줄로 보이고, 누르면 받아 둔 정보가 그 자리에 펼쳐진다.
// 표시는 안내일 뿐 어떤 저장도 막지 않는다. 정상은 회색으로 조용히, 경고색은 한 번 확인할 줄에만 쓴다(설계 §4·§9).
"use client";

import { Ban, CircleCheck, CircleDashed, ExternalLink, Loader2, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";
import { Tooltip } from "@/components/ui/tooltip";
import type { EquisInfo, EquisVersion } from "@/lib/api-sop";
import { formatKstShort } from "@/lib/datetime";
import { formatEquisLabel, listEquisHintKeys, type EquisIcon, type EquisTone } from "@/lib/equis-model";
import { useI18n } from "@/lib/i18n";

const ICONS: Record<EquisIcon, LucideIcon> = { check: CircleCheck, alert: TriangleAlert, dashed: CircleDashed, failed: Ban, loading: Loader2 };
const TONES: Record<EquisTone, string> = { quiet: "text-ink-3", attention: "font-semibold text-warn", muted: "text-ink-4", neutral: "text-ink-2" };

interface EquisStatusProps {
  equis: EquisInfo;
  testId: string;
  /** 좁은 칸(To-Be 번호 칸) - 아이콘만 두고 글은 툴팁과 aria-label로 옮긴다 */
  compact?: boolean;
  /** 작성자가 작업 중일 때만 다시 조회·번호 바꾸기를 보인다 */
  canEdit: boolean;
  onRefresh: () => void;
  /** 옛 번호일 때 지금 번호로 바꾸기 - 번호를 그 자리에서 저장하는 화면만 넘긴다 */
  onUseCurrentNumber?: () => void;
}

function describe(version: EquisVersion): string {
  return [version.version, version.status, version.effective_date || version.retired_date].filter((part) => part !== "").join(" · ");
}

export function EquisStatus({ equis, testId, compact = false, canEdit, onRefresh, onUseCurrentNumber }: EquisStatusProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = formatEquisLabel(equis, t);
  const Icon = ICONS[label.icon];
  const tone = TONES[label.tone];

  if (equis.state === "pending") {
    // 조회 중에는 펼칠 것이 없다 - 최종 표시와 같은 줄 높이로 자리만 지킨다
    return (
      <span className={`inline-flex h-4 shrink-0 items-center gap-1 text-[11px] leading-4 ${tone}`} role="status" aria-label={label.text} data-testid={testId}>
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin" aria-hidden />
        {!compact && label.text}
      </span>
    );
  }

  const trigger = (
    <button
      ref={anchorRef}
      type="button"
      className={`inline-flex h-4 min-w-0 items-center gap-1 rounded-sm text-[11px] leading-4 hover:underline ${tone}`}
      aria-label={compact ? label.text : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid={testId}
      onClick={() => setOpen((value) => !value)}
    >
      <Icon size={12} strokeWidth={1.5} className="shrink-0" aria-hidden />
      {/* 좁은 칸에서는 글이 말줄임된다 - 전체는 눌러 펼친 정보에 있다 */}
      {!compact && <span className="truncate">{label.text}</span>}
    </button>
  );

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {compact ? (
        <Tooltip label={label.text} suppressed={open}>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {!compact && canEdit && label.icon === "failed" && (
        <button type="button" className="btn ghost h-5 px-1.5 text-[11px]" data-testid={`${testId}-retry`} onClick={onRefresh}>
          {t("equis.retry")}
        </button>
      )}
      {open && (
        <EquisPopover
          equis={equis}
          anchorRef={anchorRef}
          testId={testId}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onRefresh={onRefresh}
          onUseCurrentNumber={onUseCurrentNumber}
        />
      )}
    </span>
  );
}

interface EquisPopoverProps {
  equis: EquisInfo;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  testId: string;
  canEdit: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onUseCurrentNumber?: () => void;
}

function EquisPopover({ equis, anchorRef, testId, canEdit, onClose, onRefresh, onUseCurrentNumber }: EquisPopoverProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const requestClose = useEffectEvent(() => onClose());

  // 메뉴와 같은 층 규칙 - 잰 뒤에 놓고, 바깥 누르기·Esc로 닫고, 닫히면 포커스를 연 곳으로 돌린다
  useEffect(() => {
    const layer = pushEscLayer();
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const frame = requestAnimationFrame(() => {
      if (!panel || !anchor) return;
      const rect = panel.getBoundingClientRect();
      setPos(placeBelow(anchor.getBoundingClientRect(), { width: rect.width, height: rect.height }, "start"));
      panel.focus({ preventScroll: true });
    });
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target) || anchor?.contains(target)) return;
      requestClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopEscLayer(layer)) {
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      popEscLayer(layer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      if (!document.activeElement || document.activeElement === document.body || panel?.contains(document.activeElement)) {
        anchor?.focus({ preventScroll: true });
      }
    };
  }, [anchorRef]);

  const hasFacts = equis.verdict !== null;
  const hints = [
    ...(equis.state === "not_found" ? ["equis.hint.notFound"] : []),
    ...(equis.state === "unavailable" ? ["equis.hint.failed"] : []),
    ...listEquisHintKeys(equis),
  ];
  const fields: Array<[string, string]> = hasFacts
    ? [
        ["equis.field.name", equis.name],
        ["equis.field.subtype", equis.subtype],
        ["equis.field.current", equis.current ? describe(equis.current) : equis.retired ? describe(equis.retired) : ""],
        ["equis.field.inProgress", equis.in_progress.map((version) => `${version.version} ${version.status}`).join(", ")],
        ["equis.field.department", equis.owning_department],
        ["equis.field.plant", equis.plant],
        ["equis.field.area", equis.area],
        ["equis.field.legacy", equis.legacy_numbers.join(" / ")],
        ["equis.field.equipment", equis.equipment_tag],
      ]
    : [];
  const shown = fields.filter(([, value]) => value !== "");
  const isOldNumber = equis.reasons.includes("old_number");

  function act(run: () => void) {
    onClose();
    run();
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("equis.details")}
      tabIndex={-1}
      className="menu grid w-[340px] max-w-[calc(100vw-16px)] gap-2 p-3 outline-none"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      data-testid={`${testId}-details`}
    >
      <div className="font-mono text-[11px] leading-4 text-ink-3">EQUIS · {equis.number}</div>
      {hints.map((key) => (
        <p key={key} className="text-[13px] leading-5 text-ink-2">
          {t(key)}
        </p>
      ))}
      {equis.ambiguous.length > 0 && <p className="text-[13px] leading-5 text-ink-2">{t("equis.hint.candidates", { numbers: equis.ambiguous.join(", ") })}</p>}
      {shown.length > 0 && (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-5">
          {shown.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-ink-3">{t(key)}</dt>
              <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {equis.fetched_at && (
        <p className="text-xs leading-[18px] text-ink-3">
          {t("equis.field.lookedUp")} {formatKstShort(equis.fetched_at)} · {t("equis.edwNote")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {equis.doc_url && (
          <a className="btn h-7" href={equis.doc_url} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-open`}>
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            {t("equis.open")}
          </a>
        )}
        {canEdit && isOldNumber && onUseCurrentNumber && (
          <button type="button" className="btn h-7" data-testid={`${testId}-use-current`} onClick={() => act(onUseCurrentNumber)}>
            {t("equis.useCurrentNumber")}
          </button>
        )}
        {canEdit && (
          <button type="button" className="btn ghost h-7" data-testid={`${testId}-refresh`} onClick={() => act(onRefresh)}>
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
            {t("equis.lookUpAgain")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

