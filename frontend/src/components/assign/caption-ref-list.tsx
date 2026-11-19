// 배정 화면 오른쪽 칸의 표·그림 참조 카드 - 고른 줄의 글이 "표 3"·"아래 표"로 가리키는 묶음을 보이고, 사람이 떼거나 다른 묶음에 다시 잇는다.
// 이은 참조는 결과물에서 새 문서의 표·그림 번호를 따라간다(번호 다시 매기기는 규칙 계산, 설계 2026-11-16 §5). 대상을 못 찾은 참조는 경고로 보인다.
"use client";

import { ArrowRight, Link2, Unlink } from "lucide-react";

import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { ViewCaptionRef, ViewUnit } from "@/lib/api-sop";
import { describeCaptionRef } from "@/lib/caption-ref-model";
import { useI18n } from "@/lib/i18n";

/** 참조 하나와 그 참조를 가진 단위(라벨 언어·위치 참조 방향) */
export interface CaptionRefEntry {
  ref: ViewCaptionRef;
  from: ViewUnit;
}

interface CaptionRefListProps {
  refs: readonly CaptionRefEntry[];
  /** 그 문서의 단위 - 대상 표시 ID와 후보의 캡션 글 */
  units: ReadonlyMap<number, ViewUnit>;
  /** 다시 이을 수 있는 묶음(표는 표마다 하나, 그림 전부) - 참조 종류에 맞는 것만 고르게 한다 */
  candidates: readonly ViewUnit[];
  canEdit: boolean;
  busy: boolean;
  onDetach: (refId: number) => void;
  onRelink: (refId: number, unitId: number) => void;
}

// 후보 줄에 붙이는 캡션 글 길이(글자) - 목록 폭에서 두 줄을 넘지 않게
const CAPTION_PREVIEW_CHARS = 48;

function isKindOf(kind: ViewCaptionRef["kind"], unit: ViewUnit): boolean {
  return kind === "figure" ? unit.kind === "figure" : unit.kind === "table" || unit.kind === "table_row";
}

export function CaptionRefList({ refs, units, candidates, canEdit, busy, onDetach, onRelink }: CaptionRefListProps) {
  const { t } = useI18n();
  // 묶음 단위 → 그 묶음 캡션 글(처음 것) - 후보만 보고는 어느 표인지 알기 어렵다
  const captionOf = new Map<number, string>();
  for (const unit of units.values()) {
    if (unit.kind === "caption" && unit.group_unit_id !== null && !captionOf.has(unit.group_unit_id)) captionOf.set(unit.group_unit_id, unit.text);
  }

  function buildOptions(ref: ViewCaptionRef): SelectOption<string>[] {
    const options: SelectOption<string>[] = [{ value: "", label: t("assign.captionRef.relink"), disabled: true }];
    for (const unit of candidates) {
      if (!isKindOf(ref.kind, unit)) continue;
      const caption = captionOf.get(unit.id) ?? "";
      const preview = caption.length > CAPTION_PREVIEW_CHARS ? `${caption.slice(0, CAPTION_PREVIEW_CHARS)}…` : caption;
      const isNow = unit.id === ref.target_unit_id && ref.state === "linked";
      options.push({ value: String(unit.id), label: preview ? `${unit.display_id} · ${preview}` : unit.display_id, disabled: isNow, tip: isNow ? t("assign.captionRef.linkedNow") : undefined });
    }
    return options;
  }

  return (
    <section className="mx-[var(--pad)] mt-[var(--pad)] grid gap-1.5 rounded-md border border-line bg-surface p-2.5 text-[13px]" data-testid="assign-caption-refs">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Link2 size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1">{t("assign.captionRef.title")}</span>
      </span>
      <ul className="grid gap-1">
        {refs.map(({ ref, from }) => {
          const info = describeCaptionRef(ref, units, from);
          const isDetached = ref.state === "detached";
          const keptTarget = ref.target_unit_id;
          return (
            <li
              key={ref.id}
              className="hover-row flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
              data-state={ref.state}
              data-missing={info.missing ? "" : undefined}
              data-testid={`assign-caption-ref-${ref.id}`}
            >
              <span className="flex-none rounded-sm border border-line-2 bg-sunken px-1.5 font-mono text-[12px] leading-5 text-ink-2" data-testid={`assign-caption-ref-label-${ref.id}`}>
                {info.label}
              </span>
              <ArrowRight size={13} strokeWidth={1.5} className="flex-none text-ink-3" aria-hidden />
              {isDetached ? (
                <Tooltip label={t("assign.captionRef.detachedTip")} align="start">
                  <span className="text-xs text-ink-3" tabIndex={0} data-testid={`assign-caption-ref-target-${ref.id}`}>
                    {t("assign.captionRef.detached")}
                  </span>
                </Tooltip>
              ) : info.missing ? (
                <Tooltip label={t("assign.captionRef.notFoundTip")} align="start">
                  <span className="text-xs font-medium text-st-hold" tabIndex={0} data-testid={`assign-caption-ref-target-${ref.id}`}>
                    {t("assign.captionRef.notFound")}
                  </span>
                </Tooltip>
              ) : (
                <span className="min-w-0 font-mono text-xs text-ink-2" data-testid={`assign-caption-ref-target-${ref.id}`}>
                  {info.targetDisplayId}
                </span>
              )}
              {canEdit && (
                // 줄 끝 단추는 줄에 올리거나 포커스가 갈 때만(손이 닿는 화면은 늘)
                <span className="row-actions ml-auto flex flex-none items-center gap-1">
                  <Select
                    value=""
                    options={buildOptions(ref)}
                    onChange={(value) => onRelink(ref.id, Number(value))}
                    testId={`assign-caption-ref-relink-${ref.id}`}
                    ariaLabel={t("assign.captionRef.relink")}
                    disabled={busy}
                    size="sm"
                  />
                  {isDetached ? (
                    keptTarget !== null && (
                      <button type="button" className="btn ghost h-7 gap-1 px-1.5 text-xs" disabled={busy} data-testid={`assign-caption-ref-link-${ref.id}`} onClick={() => onRelink(ref.id, keptTarget)}>
                        <Link2 size={13} strokeWidth={1.5} aria-hidden />
                        {t("assign.captionRef.linkAgain")}
                      </button>
                    )
                  ) : (
                    <button type="button" className="btn ghost h-7 gap-1 px-1.5 text-xs" disabled={busy} data-testid={`assign-caption-ref-detach-${ref.id}`} onClick={() => onDetach(ref.id)}>
                      <Unlink size={13} strokeWidth={1.5} aria-hidden />
                      {t("assign.captionRef.detach")}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-ink-3">{t("assign.captionRef.hint")}</p>
    </section>
  );
}
