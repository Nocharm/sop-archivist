// 오른쪽 칸 1번 "다듬기"의 캡션 자리(표 풀기·표준화 명세 F7 · F12) - 고른 줄이 표·그림이면 그 캡션 자리 하나.
// 비었으면 후보 단추를 한 줄씩(오른쪽에 작은 설명, 가장 그럴듯한 것을 강조, 글 후보는 가까운 순 처음 몇 개 + 더 보기), 채웠으면 캡션 칩(KO/EN 표시 · 글 · 출처)과 손잡이
// (↩ 다시 첫 행으로 · ✂ 한/영 나누기 · × 떼서 문장으로 · 그림 풀기). 문장 같은 캡션은 칩 테두리만 주황이고 옆에 떼기가 있다.
// 상태 글자나 개수 띠는 두지 않는다 - 할 일은 후보 단추가 말한다. 무엇을 띄울지는 lib/caption-slot-model buildCaptionSlot이 정한다.
"use client";

import { useState, type ReactNode } from "react";

import { LangToken } from "@/components/paper/lang-token";
import { Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import type { UnitLang } from "@/lib/api-sop";
import { NEAR_SHOWN, type CaptionCandidate, type CaptionChip, type CaptionSlotView } from "@/lib/caption-slot-model";
import { useI18n } from "@/lib/i18n";

interface CaptionSlotProps {
  slot: CaptionSlotView;
  busy: boolean;
  /** 손잡이 모두를 막는 까닭(저장 전 고름 등)의 문구 키 - 없으면 null */
  blockedKey: string | null;
  /** 써 넣기를 막는 까닭 - 보낼 곳을 고르기 전에는 써 넣을 New 문장이 없다 */
  writeBlockedKey: string | null;
  /** 떼면 안 되는 캡션(그림 블록 위 옛 캡션)의 막는 까닭 - 뗄 수 있으면 null */
  readDetachBlock: (unitId: number) => string | null;
  onCandidate: (candidate: Exclude<CaptionCandidate, { kind: "write" }>) => void;
  onWrite: () => void;
  onDetach: (unitId: number) => void;
  onSplit: (unitId: number, at: number) => void;
  onBackFirstRow: () => void;
  onUngroup: () => void;
}

const CHIP_NOTES: Record<CaptionChip["origin"], string | null> = {
  unit: null,
  first_row: "assign.captionSlot.note.firstRow",
  written: "assign.captionSlot.note.written",
  shared: "assign.captionSlot.note.shared",
};

export function CaptionSlot({ slot, busy, blockedKey, writeBlockedKey, readDetachBlock, onCandidate, onWrite, onDetach, onSplit, onBackFirstRow, onUngroup }: CaptionSlotProps) {
  const { t } = useI18n();
  // "더 보기"를 연 캡션 자리(묶음) - 다른 표·그림을 고르면 저절로 접힌다
  const [openFor, setOpenFor] = useState<number | null>(null);

  /** 글 단추 하나 - 꺼진 단추는 aria-disabled로 포커스를 받아 까닭을 툴팁으로 보인다 */
  function renderButton(label: ReactNode, reasonKey: string | null, onPress: () => void, testId: string, extra: { isBest?: boolean; note?: string | null } = {}): ReactNode {
    const isOff = reasonKey !== null || busy;
    return (
      <Tooltip key={testId} label={reasonKey ? t(reasonKey) : ""} suppressed={reasonKey === null} align="start">
        <button
          type="button"
          className="cap-cand"
          data-best={extra.isBest ? "" : undefined}
          aria-disabled={isOff ? "true" : undefined}
          data-testid={testId}
          onClick={() => !isOff && onPress()}
        >
          <span className="cap-cand-label">{label}</span>
          {extra.note && <span className="cap-cand-note">{extra.note}</span>}
        </button>
      </Tooltip>
    );
  }

  function describeCandidate(candidate: Exclude<CaptionCandidate, { kind: "write" }>): { label: string; note: string } {
    if (candidate.kind === "figure") {
      return { label: t(candidate.side === "above" ? "assign.captionSlot.cand.figureAbove" : "assign.captionSlot.cand.figureBelow", { text: candidate.text }), note: t("assign.captionSlot.note.figure") };
    }
    const label = candidate.kind === "near"
      ? candidate.distance === 0
        ? t("assign.captionSlot.cand.inside", { text: candidate.text })
        : t(`assign.captionSlot.cand.${candidate.side}${candidate.distance === 1 ? "1" : ""}`, { k: candidate.distance, text: candidate.text })
      : t("assign.captionSlot.cand.firstRow", { text: candidate.text });
    return { label, note: candidate.isShaped ? t("assign.captionSlot.note.shaped", { n: candidate.number ?? "" }) : t("assign.captionSlot.note.notShaped") };
  }

  function renderCandidate(candidate: CaptionCandidate): ReactNode {
    const testId = `assign-caption-cand-${candidate.kind === "near" ? `u${candidate.unitId}` : candidate.kind === "figure" ? `f${candidate.figureId}` : candidate.kind}`;
    if (candidate.kind === "write") return renderButton(t("assign.captionSlot.cand.write"), blockedKey ?? writeBlockedKey, onWrite, testId);
    const { label, note } = describeCandidate(candidate);
    const reasonKey = blockedKey ?? (candidate.kind === "first_row" ? candidate.reasonKey : null);
    return renderButton(<Truncate text={label} />, reasonKey, () => onCandidate(candidate), testId, { isBest: candidate.isBest, note });
  }

  function renderChip(chip: CaptionChip): ReactNode {
    const note = CHIP_NOTES[chip.origin];
    const canDetach = chip.unitId !== null && (chip.origin === "unit" || chip.origin === "first_row");
    const detachKey = chip.unitId === null ? null : (blockedKey ?? readDetachBlock(chip.unitId));
    const body = (
      <span className="caption-chip" data-odd={chip.isOdd ? "" : undefined} data-written={chip.origin === "written" ? "" : undefined} data-shared={chip.origin === "shared" ? "" : undefined}>
        <Truncate text={chip.text} lang={chip.lang === "ko" || chip.lang === "en" ? chip.lang : undefined} />
      </span>
    );
    return (
      <div key={chip.key} className="cap-chip-row" data-testid={`assign-caption-chip-${chip.key}`}>
        <LangToken lang={chip.lang as UnitLang} />
        {chip.isOdd ? (
          <Tooltip label={t("assign.captionSlot.odd")} align="start">
            <span className="min-w-0 flex-1" tabIndex={0}>{body}</span>
          </Tooltip>
        ) : (
          <span className="min-w-0 flex-1">{body}</span>
        )}
        {note && <span className="cap-cand-note">{t(note)}</span>}
        {canDetach && chip.unitId !== null && renderButton(t("assign.captionSlot.detach"), detachKey, () => chip.unitId !== null && onDetach(chip.unitId), `assign-caption-detach-${chip.unitId}`)}
      </div>
    );
  }

  const splitChip = slot.chips.find((chip) => chip.splitAt !== null && chip.unitId !== null);
  // 글 후보는 가까운 순으로 처음 몇 개만(가장 그럴듯한 것은 늘), 나머지는 "더 보기" 뒤에
  const isAllOpen = openFor === slot.bundleId;
  const near = slot.candidates.filter((candidate) => candidate.kind === "near");
  const shownNear = near.filter((candidate, index) => isAllOpen || index < NEAR_SHOWN || candidate.isBest);
  const hiddenCount = near.length - shownNear.length;
  const moreToggle = (hiddenCount > 0 || (isAllOpen && near.length > NEAR_SHOWN)) && (
    <button type="button" className="cap-cand cap-more" data-testid="assign-caption-more" onClick={() => setOpenFor(isAllOpen ? null : slot.bundleId)}>
      <span className="cap-cand-label">{isAllOpen ? t("assign.captionSlot.less") : t("assign.captionSlot.more", { n: hiddenCount })}</span>
    </button>
  );
  const helpKey = slot.state === "empty" ? "assign.captionSlot.help.empty" : slot.state === "written" ? "assign.captionSlot.help.written" : "assign.captionSlot.help.filled";
  return (
    <section className="cap-slot" data-state={slot.state} data-testid="assign-caption-slot" aria-label={t(`assign.captionSlot.title.${slot.state}`)}>
      <div className="cap-slot-title">{t(`assign.captionSlot.title.${slot.state}`)}</div>
      {slot.chips.map(renderChip)}
      {shownNear.map(renderCandidate)}
      {moreToggle}
      {slot.candidates.filter((candidate) => candidate.kind !== "near").map(renderCandidate)}
      {(slot.hasFirstRow || splitChip || slot.groupHeadId !== null) && (
        <div className="cap-slot-acts">
          {slot.hasFirstRow && renderButton(t("assign.captionSlot.backFirstRow"), blockedKey, onBackFirstRow, "assign-caption-back-first-row")}
          {splitChip && splitChip.unitId !== null && splitChip.splitAt !== null && renderButton(t("assign.captionSlot.split"), blockedKey, () => splitChip.unitId !== null && splitChip.splitAt !== null && onSplit(splitChip.unitId, splitChip.splitAt), "assign-caption-split")}
          {slot.groupHeadId !== null && renderButton(t("assign.captionSlot.ungroup"), blockedKey, onUngroup, "assign-caption-ungroup")}
        </div>
      )}
      <p className="cap-slot-help">{t(helpKey)}</p>
    </section>
  );
}
