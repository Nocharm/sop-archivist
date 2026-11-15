// 배정 화면 오른쪽 칸의 참조 줄 카드 - 고른 줄이 다른 문서를 번호로 가리키는 줄(REF)이면 그 번호를 보이고 사람이 확인한다.
// 앱은 번호 영역을 제안만 한다: 제안이 남은 줄은 이 카드를 정리해야 Confirm이 켜진다(결정 전에 번호만 확인 - 설계 2026-11-15 §4).
// 번호가 정해지면 그 번호의 EQUIS 표시(지금 번호·이름)를 함께 보인다. EQUIS가 꺼져 있으면 표시만 없다.
"use client";

import { BookMarked, Check, PencilLine, X } from "lucide-react";
import { useState } from "react";

import { EquisStatus } from "@/components/equis/equis-status";
import { Tooltip } from "@/components/ui/tooltip";
import { getUnitRef, type ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { guessRefNumber } from "@/lib/ref-model";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { useLoaded } from "@/lib/use-loaded";

interface RefCardProps {
  bundleId: number;
  docId: number;
  unit: ViewUnit;
  canEdit: boolean;
  busy: boolean;
  /** 번호를 고칠 수 없는 까닭(이미 배정을 결정한 줄) - 고칠 수 있으면 null */
  blockedReason: string | null;
  /** 확인이 남은 제안 수(이것 포함) - 둘 이상이면 다음으로 가는 단추를 둔다 */
  left: number;
  onConfirm: (number: string) => void;
  onReject: () => void;
  /** 메뉴로 연 "참조 줄로 표시"를 그만둔다 - 제안도 확정도 없는 줄에서만 */
  onClose: () => void;
  onNext: () => void;
}

export function RefCard({ bundleId, docId, unit, canEdit, busy, blockedReason, left, onConfirm, onReject, onClose, onNext }: RefCardProps) {
  const { t } = useI18n();
  const mark = unit.ref;
  // 제안도 확정도 없는 줄은 번호를 적는 칸부터 연다(메뉴의 "참조 줄로 표시")
  const [draft, setDraft] = useState<string | null>(mark === null ? guessRefNumber(unit.text) : null);
  const isTyping = draft !== null;
  const detail = useLoaded(() => (mark === null ? Promise.resolve(null) : getUnitRef(bundleId, docId, unit.id)), `${unit.id}:${mark?.state ?? ""}:${mark?.number ?? ""}`);
  // 앞서 고른 줄의 답이 남아 있을 수 있다 - 이 줄의 이 번호에 대한 답만 쓴다
  const equis = !detail.isLoading && detail.data?.number === mark?.number ? (detail.data?.equis ?? null) : null;
  useEquisPolling(equis?.refreshing === true, detail.reload);
  const isLocked = blockedReason !== null || busy;

  function submitDraft() {
    const number = (draft ?? "").trim();
    if (number === "" || isLocked) return;
    onConfirm(number);
  }

  return (
    <section className="ref-card mx-[var(--pad)] mt-[var(--pad)] grid gap-1.5 rounded-md border p-2.5 text-[13px]" data-state={mark?.state ?? "new"} data-testid="assign-ref">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--lang-ref-ink)]">
        <BookMarked size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1" data-testid="assign-ref-title">
          {t(mark === null ? "assign.ref.enter" : mark.state === "proposed" ? "assign.ref.proposed" : "assign.ref.confirmed")}
        </span>
        <span className="flex-none whitespace-nowrap font-mono font-normal text-ink-3">{unit.display_id}</span>
      </span>
      {isTyping ? (
        <form
          className="grid gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <label className="grid gap-1 text-xs text-ink-3">
            {t("assign.ref.number")}
            <input
              className="input h-8 font-mono text-[13px]"
              value={draft}
              maxLength={100}
              autoFocus
              spellCheck={false}
              data-testid="assign-ref-input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // 번호 칸의 Esc는 고치기만 접는다(화면의 Esc 동작으로 번지지 않게)
                if (event.key !== "Escape") return;
                event.stopPropagation();
                if (mark === null) onClose();
                else setDraft(null);
              }}
            />
          </label>
          <span className="text-[11px] text-ink-3">{t("assign.ref.numberHint")}</span>
          <div className="flex flex-wrap gap-1.5">
            <Tooltip label={blockedReason ?? ""} suppressed={blockedReason === null}>
              <button type="submit" className="btn h-7" data-testid="assign-ref-use" aria-disabled={isLocked || draft.trim() === "" ? "true" : undefined}>
                <Check size={14} strokeWidth={1.5} aria-hidden />
                {t("assign.ref.use")}
              </button>
            </Tooltip>
            <button type="button" className="btn ghost h-7" data-testid="assign-ref-cancel" onClick={() => (mark === null ? onClose() : setDraft(null))}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="lang-token h-5 px-1.5 text-[12px]" data-lang="ref" data-proposed={mark?.state === "proposed" ? "" : undefined} data-testid="assign-ref-number">
              {mark?.number}
            </span>
            {equis && <EquisStatus equis={equis} testId="assign-ref-equis" canEdit={false} onRefresh={detail.reload} />}
          </span>
          {equis?.state === "found" && equis.name !== "" && (
            <p className="min-w-0 break-words text-xs text-ink-2" data-testid="assign-ref-now">
              <span className="font-mono">{equis.number}</span> {equis.name}
            </p>
          )}
          {mark?.state === "proposed" && <p className="text-xs text-ink-2">{t("assign.ref.hint")}</p>}
          {canEdit && (
            <div className="flex flex-wrap gap-1.5">
              {mark?.state === "proposed" && (
                <Tooltip label={blockedReason ?? ""} suppressed={blockedReason === null}>
                  <button type="button" className="btn h-7" data-testid="assign-ref-confirm" aria-disabled={isLocked ? "true" : undefined} onClick={() => !isLocked && onConfirm(mark.number)}>
                    <Check size={14} strokeWidth={1.5} aria-hidden />
                    {t("assign.ref.confirm")}
                  </button>
                </Tooltip>
              )}
              <button type="button" className="btn ghost h-7 gap-1 px-1.5 text-xs" data-testid="assign-ref-fix" disabled={isLocked} onClick={() => setDraft(mark?.number ?? "")}>
                <PencilLine size={13} strokeWidth={1.5} aria-hidden />
                {t("assign.ref.fix")}
              </button>
              <Tooltip label={blockedReason ?? ""} suppressed={blockedReason === null || mark?.state === "proposed"}>
                {/* 제안을 물리는 것은 언어를 바꾸지 않아 배정이 있어도 된다 */}
                <button
                  type="button"
                  className="btn ghost h-7 gap-1 px-1.5 text-xs"
                  data-testid="assign-ref-reject"
                  aria-disabled={busy || (blockedReason !== null && mark?.state !== "proposed") ? "true" : undefined}
                  onClick={() => !busy && (blockedReason === null || mark?.state === "proposed") && onReject()}
                >
                  <X size={13} strokeWidth={1.5} aria-hidden />
                  {t("assign.ref.reject")}
                </button>
              </Tooltip>
              {mark?.state === "proposed" && left > 1 && (
                <button type="button" className="btn ghost h-7 px-1.5 text-xs" data-testid="assign-ref-next" onClick={onNext}>
                  {t("assign.ref.leftNext", { n: left - 1 })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
