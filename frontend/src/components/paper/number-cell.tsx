// 용지 줄 앞머리의 번호 칸(문단 번호, F5) - 그 줄의 번호를 보이고, 고칠 수 있는 화면(Assign)에서는 누르면 그 자리에 창이 열린다.
// 번호는 늘 여기에 산다: 고치기·번호 없음·써 넣기(+)·타자 번호를 번호로(↤)가 모두 이 칸의 손잡이다. 원문 글자는 그대로이고 번호 범위만 바뀐다.
// 창 맨 위는 종류 단추 줄(시안 2 D1 - 연속 번호 · • ○ ▪ · 직접 · 없음). 종류는 저장하지 않고 값에서 읽는다(number-kind-model).
"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import type { ViewNumber } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useDismiss } from "@/lib/use-dismiss";
import { MAX_NUMBER_CHARS, type NumberPreview } from "@/lib/number-model";
import { readNumberKind, type NumberKind } from "@/lib/number-kind-model";
import { BULLET_SYMBOLS } from "@/lib/section-number";
import type { PairBracket } from "@/lib/strip-pill-model";

import { STRIP_LEAD_EXTRA } from "./strip-lead";

export interface NumberEdit {
  unitId: number;
  /** 눌린 종류 - 연속 번호 · 직접일 때만 입력 상자가 있다 */
  kind: NumberKind;
  text: string;
  /** 뒤 번호도 따라 고치기 - 연속 번호에서만 켤 수 있다 */
  follow: boolean;
}

/** 입력 상자로 고치는 종류 - 점 기호 · 없음은 누르면 바로 저장한다 */
function isTextKind(kind: NumberKind): boolean {
  return kind === "continuous" || kind === "custom";
}

interface NumberCellProps {
  width: number;
  bracket?: PairBracket;
  /** 보류 설명 - 비면 툴팁·sr-only 글을 두지 않는다 */
  tip: string;
  testId: string;
  unitId: number;
  number: ViewNumber;
  /** 자동 번호를 못 읽은 줄 - 빈 번호 칸의 "+"를 늘 보인다(다른 번호 없는 줄은 줄에 올렸을 때만) */
  isUnread: boolean;
  /** 고칠 수 있는 화면인가 - 아니면 번호만 보인다 */
  canEdit: boolean;
  busy: boolean;
  /** 이 줄을 고치는 중이면 그 입력 */
  edit: NumberEdit | null;
  /** 고치는 중인 줄을 따라 바뀔 번호들(문서 순서) */
  followed: readonly NumberPreview[];
  /** 고치는 중인 줄의 연속 번호 값(suggestUnitContinuous) - 고치는 줄이 아니거나 셀 수 없으면 null */
  continuous: string | null;
  /** 다른 줄을 고치는 중이고 이 줄의 번호가 따라 바뀐다 */
  preview: NumberPreview | null;
  onEditChange: (edit: NumberEdit | null) => void;
  /** number가 null이면 번호 없음 */
  onSave: (number: string | null, follow: boolean) => void;
}

export function NumberCell({ width, bracket, tip, testId, unitId, number, isUnread, canEdit, busy, edit, followed, continuous, preview, onEditChange, onSave }: NumberCellProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLSpanElement>(null);
  const isEditing = edit !== null;
  const editKind = edit?.kind ?? null;
  // 고치는 칸은 바깥을 누르거나 Esc(입력 밖에 포커스가 있어도)로 닫는다 - 저장하지 않고 닫는다
  useDismiss(cellRef, isEditing, () => onEditChange(null));
  // 창이 열리거나 종류가 바뀌면 입력 상자로(없는 종류면 눌린 종류 단추로) 포커스 - Esc · 글쇠가 창 안에서 시작한다
  useEffect(() => {
    if (editKind === null) return;
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      return;
    }
    cellRef.current?.querySelector<HTMLButtonElement>('.num-kind[aria-pressed="true"]')?.focus();
  }, [editKind]);

  const tipAttr = tip === "" ? undefined : tip;
  const shown = preview ? preview.to : number.value;
  const base = { width: width + STRIP_LEAD_EXTRA };
  const numTestId = `${testId}-num-${unitId}`;
  // 원문과 다르게 고친 번호 - 툴팁에 원문 번호를 함께 적는다(따라 바뀔 미리 보기 중에는 미리 보기 설명만)
  const sourceTip = number.note !== null && !preview ? t("assign.numberKind.source", { n: number.note }) : null;

  function open() {
    const kind = readNumberKind(number.value);
    onEditChange({ unitId, kind, text: isTextKind(kind) ? (number.value ?? "") : "", follow: kind === "continuous" });
  }

  function save() {
    if (!edit || busy) return;
    const text = edit.text.trim();
    if (text === "") return;
    onSave(text, edit.kind === "continuous" && edit.follow);
  }

  /** 종류 단추 - 연속 번호는 앱이 센 값을 채우고, 직접은 지금 글(없으면 빈 상자), 점 기호 · 없음은 바로 저장한다 */
  function pickKind(kind: NumberKind, symbol?: string) {
    if (!edit || busy) return;
    if (kind === "continuous" || kind === "custom") {
      const kept = isTextKind(edit.kind) ? edit.text : isTextKind(readNumberKind(number.value)) ? (number.value ?? "") : "";
      onEditChange({ ...edit, kind, text: kind === "continuous" ? (continuous ?? kept) : kept, follow: kind === "continuous" });
      // 이미 입력 상자가 있으면(종류가 그대로이거나 연속 ↔ 직접) 포커스를 돌려준다 - 새로 생기는 상자는 위 effect가 맡는다
      inputRef.current?.focus();
    } else if (kind === "bullet" && symbol !== undefined) {
      onSave(symbol, false);
    } else if (kind === "none") {
      onSave(null, false);
    }
  }

  function renderKinds(current: NumberEdit) {
    const isPressed = (kind: NumberKind, symbol?: string) => current.kind === kind && (symbol === undefined || number.value === symbol);
    return (
      <span className="num-kind-row" role="group" aria-label={t("assign.numberKind.group")}>
        <button type="button" className="num-kind" aria-pressed={isPressed("continuous")} data-testid={`${testId}-num-kind-continuous`} disabled={busy} onClick={() => pickKind("continuous")}>
          {t("assign.numberKind.continuous")}
        </button>
        {BULLET_SYMBOLS.map((symbol, index) => {
          const label = t("assign.numberKind.bullet", { symbol });
          return (
            <button key={symbol} type="button" className="num-kind num-kind-bullet" aria-pressed={isPressed("bullet", symbol)} aria-label={label} data-tip={label} data-testid={`${testId}-num-kind-bullet-${index}`} disabled={busy} onClick={() => pickKind("bullet", symbol)}>
              {symbol}
            </button>
          );
        })}
        <button type="button" className="num-kind" aria-pressed={isPressed("custom")} data-testid={`${testId}-num-kind-custom`} disabled={busy} onClick={() => pickKind("custom")}>
          {t("assign.numberKind.custom")}
        </button>
        {/* 번호가 없는 줄의 "없음"은 할 일이 없다 - 눌린 채 꺼 둔다 */}
        <button type="button" className="num-kind" aria-pressed={isPressed("none")} data-tip={t("assign.number.none")} data-testid={`${testId}-num-kind-none`} disabled={busy || number.value === null} onClick={() => pickKind("none")}>
          {t("assign.numberKind.none")}
        </button>
      </span>
    );
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    // 용지·화면의 단축키(J/K, Ctrl+Z)가 입력 글자를 가로채지 않게 한다
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEditChange(null);
    }
  }

  function renderBody() {
    if (!canEdit) {
      return (
        <span className="strip-lead-num" data-tip={[shown ? `§ ${shown}` : null, sourceTip, tipAttr].filter(Boolean).join(" · ") || undefined} data-testid={shown !== null ? numTestId : undefined}>
          {shown}
        </span>
      );
    }
    if (shown !== null) {
      const label = [preview ? t("assign.number.willChange", { from: preview.from, to: preview.to }) : t("assign.number.edit", { n: shown }), sourceTip].filter(Boolean).join(" · ");
      return (
        <button type="button" className="strip-lead-num num-cell" data-preview={preview ? "" : undefined} data-fixed={number.is_set ? "" : undefined} data-tip={label} aria-label={label} data-testid={numTestId} disabled={busy} onClick={open}>
          {shown}
        </button>
      );
    }
    if (number.typed_len > 0 && number.read !== null) {
      const read = number.read;
      return (
        <button type="button" className="strip-lead-num num-cell num-add" data-tip={t("assign.number.fromTyped")} aria-label={t("assign.number.fromTyped")} data-testid={`${testId}-num-typed-${unitId}`} disabled={busy} onClick={() => onSave(read, false)}>
          ↤
        </button>
      );
    }
    return (
      <button type="button" className="strip-lead-num num-cell num-add" data-quiet={isUnread ? undefined : ""} data-tip={t("assign.number.add")} aria-label={t("assign.number.add")} data-testid={`${testId}-num-add-${unitId}`} disabled={busy} onClick={open}>
        +
      </button>
    );
  }

  return (
    <span ref={cellRef} className="strip-lead" style={base} data-bracket={bracket} data-dim={shown === null ? "" : undefined} data-num-open={isEditing ? "" : undefined} data-testid={`${testId}-lead-${unitId}`}>
      {tipAttr && <span className="sr-only">{tipAttr}</span>}
      {renderBody()}
      {edit && (
        <span className="num-edit" data-testid={`${testId}-num-edit-${unitId}`}>
          {renderKinds(edit)}
          {isTextKind(edit.kind) && (
            <span className="num-edit-row">
              <input
                ref={inputRef}
                className="num-edit-input"
                value={edit.text}
                maxLength={MAX_NUMBER_CHARS}
                aria-label={t("assign.number.input")}
                data-testid={`${testId}-num-input`}
                onChange={(event) => onEditChange({ ...edit, text: event.target.value })}
                onKeyDown={handleKey}
              />
              {edit.kind === "continuous" && continuous !== null && (
                <span className="num-continuous" data-testid={`${testId}-num-continuous`}>
                  {t("assign.numberKind.continuousValue", { n: continuous })}
                </span>
              )}
            </span>
          )}
          {edit.kind === "continuous" && (
            <label className="num-follow">
              <input type="checkbox" checked={edit.follow} data-testid={`${testId}-num-follow`} onChange={(event) => onEditChange({ ...edit, follow: event.target.checked })} />
              <span>{t("assign.number.follow")}</span>
            </label>
          )}
          {edit.kind === "continuous" && edit.follow && followed.length > 0 && (
            <span className="num-follow-preview" data-testid={`${testId}-num-preview`}>
              {followed.slice(0, 3).map((item) => (
                <span key={item.unitId} className="num-follow-item">
                  {item.from} → {item.to}
                </span>
              ))}
              {followed.length > 3 && <span className="num-follow-more">{t("assign.number.more", { n: followed.length - 3 })}</span>}
            </span>
          )}
          {number.note !== null && (
            <span className="num-note" data-testid={`${testId}-num-note`}>
              {t("assign.numberKind.note", { n: number.note })}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
