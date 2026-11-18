// 용지 줄 앞머리의 번호 칸(문단 번호, F5) - 그 줄의 번호를 보이고, 고칠 수 있는 화면(Assign)에서는 누르면 그 자리가 입력으로 바뀐다.
// 번호는 늘 여기에 산다: 고치기·번호 없음·써 넣기(+)·타자 번호를 번호로(↤)가 모두 이 칸의 손잡이다. 원문 글자는 그대로이고 번호 범위만 바뀐다.
"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import type { ViewNumber } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { MAX_NUMBER_CHARS, type NumberPreview } from "@/lib/number-model";
import type { PairBracket } from "@/lib/strip-pill-model";

import { STRIP_LEAD_EXTRA } from "./strip-lead";

export interface NumberEdit {
  unitId: number;
  text: string;
  follow: boolean;
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
  /** 다른 줄을 고치는 중이고 이 줄의 번호가 따라 바뀐다 */
  preview: NumberPreview | null;
  onEditChange: (edit: NumberEdit | null) => void;
  /** number가 null이면 번호 없음 */
  onSave: (number: string | null, follow: boolean) => void;
}

export function NumberCell({ width, bracket, tip, testId, unitId, number, isUnread, canEdit, busy, edit, followed, preview, onEditChange, onSave }: NumberCellProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = edit !== null;
  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const tipAttr = tip === "" ? undefined : tip;
  const shown = preview ? preview.to : number.value;
  const base = { width: width + STRIP_LEAD_EXTRA };
  const numTestId = `${testId}-num-${unitId}`;

  function open() {
    onEditChange({ unitId, text: number.value ?? "", follow: true });
  }

  function save() {
    if (!edit || busy) return;
    const text = edit.text.trim();
    if (text === "") return;
    onSave(text, edit.follow);
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
        <span className="strip-lead-num" data-tip={[shown ? `§ ${shown}` : null, tipAttr].filter(Boolean).join(" · ") || undefined} data-testid={shown !== null ? numTestId : undefined}>
          {shown}
        </span>
      );
    }
    if (shown !== null) {
      const label = preview ? t("assign.number.willChange", { from: preview.from, to: preview.to }) : t("assign.number.edit", { n: shown });
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
    <span className="strip-lead" style={base} data-bracket={bracket} data-dim={shown === null ? "" : undefined} data-num-open={isEditing ? "" : undefined} data-testid={`${testId}-lead-${unitId}`}>
      {tipAttr && <span className="sr-only">{tipAttr}</span>}
      {renderBody()}
      {edit && (
        <span className="num-edit" data-testid={`${testId}-num-edit-${unitId}`}>
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
            {number.value !== null && (
              <button type="button" className="num-edit-none" data-testid={`${testId}-num-none`} disabled={busy} onClick={() => onSave(null, false)}>
                {t("assign.number.none")}
              </button>
            )}
          </span>
          <label className="num-follow">
            <input type="checkbox" checked={edit.follow} data-testid={`${testId}-num-follow`} onChange={(event) => onEditChange({ ...edit, follow: event.target.checked })} />
            <span>{t("assign.number.follow")}</span>
          </label>
          {edit.follow && followed.length > 0 && (
            <span className="num-follow-preview" data-testid={`${testId}-num-preview`}>
              {followed.slice(0, 3).map((item) => (
                <span key={item.unitId} className="num-follow-item">
                  {item.from} → {item.to}
                </span>
              ))}
              {followed.length > 3 && <span className="num-follow-more">{t("assign.number.more", { n: followed.length - 3 })}</span>}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
