// SOP 한 줄의 칸 상태 표(New 목록의 펼친 곳) - 칸마다 지금 상태(문장 수·Empty·N/A)를 먼저 보이고 하는 일(Mark N/A·Edit reason·Restore)을 단추로 둔다.
// 사유 편집기는 화면에 하나다(ToBeSection의 naEdit) - Save N/A·Cancel로만 닫히고, 칸을 떠나거나 줄을 접어도 적던 사유는 남는다.
// 설계: docs/superpowers/specs/2026-11-17-documents-screen-design.md §8
"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { openNaEdit, SLOT_COLUMNS, type NaEdit, type SlotKey, type SlotRow, type SlotSummary } from "@/lib/slot-status-model";

interface SlotTableProps {
  /** `tobe-id-<줄 id>` */
  prefix: string;
  docKey: string;
  rows: readonly SlotRow[];
  summary: SlotSummary;
  /** 이미 쓴 SOP - 문장 수가 없다 */
  isWritten: boolean;
  canEdit: boolean;
  saving: boolean;
  usedReasons: readonly string[];
  /** 화면에 하나 - 이 문서의 것일 때만 그린다 */
  edit: NaEdit | null;
  onEdit: (next: NaEdit | null) => void;
  onSave: (slotKey: SlotKey, reason: string) => void;
  onRestore: (row: SlotRow) => void;
}

export function SlotTable({ prefix, docKey, rows, summary, isWritten, canEdit, saving, usedReasons, edit, onEdit, onSave, onRestore }: SlotTableProps): ReactNode {
  const { t } = useI18n();
  const myEdit = edit !== null && edit.docKey === docKey ? edit : null;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  // 다 펼친 사유 - 그 줄만이고 기억하지 않는다
  const [openReasons, setOpenReasons] = useState<ReadonlySet<SlotKey>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // 적는 중에 다른 칸을 열려 하면 열려 있는 편집기로 포커스를 돌린다(누른 단추가 포커스를 가져간 뒤라 이펙트에서)
  useEffect(() => {
    if (myEdit?.refused) inputRef.current?.focus();
  }, [myEdit]);

  function openEditor(row: SlotRow) {
    const saved = row.state.kind === "na" ? row.state.reason : "";
    onEdit(openNaEdit(edit, { docKey, slotKey: row.key, saved }));
  }

  function toggleReason(key: SlotKey) {
    setOpenReasons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleReasonKey(event: KeyboardEvent<HTMLInputElement>, current: NaEdit) {
    // 한글 조합 중의 Enter는 글자를 끝내는 것이다
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (current.text.trim() !== "" && !saving) onSave(current.slotKey, current.text.trim());
    } else if (event.key === "Escape") {
      // 펼친 곳 밖의 Esc 처리(창 닫기 등)로 번지지 않게
      event.preventDefault();
      event.stopPropagation();
      onEdit(null);
    }
  }

  function renderState(row: SlotRow): ReactNode {
    const { state } = row;
    switch (state.kind) {
      case "filled":
        return state.count === 1 ? t("tobe.slots.sentenceOne") : t("tobe.slots.sentences", { n: state.count });
      case "sub":
        // 단추 자리는 비우고 까닭은 이 글의 툴팁 - 포커스로도 닿는다
        return (
          <Tooltip label={t("tobe.slots.subHolds")} align="end">
            <span tabIndex={0} className="slot-sub">
              {t("tobe.slots.inSub", { n: state.count })}
            </span>
          </Tooltip>
        );
      case "decide":
        return <span className="pill warn">{t("tobe.slots.fill")}</span>;
      case "empty":
        return <span className="text-ink-3">{isWritten ? t("tobe.slots.fromFile") : t("tobe.slots.empty")}</span>;
      case "na":
      case "covered":
        return <span className="pill quiet">{t("assign.slotNa")}</span>;
    }
  }

  function renderActions(row: SlotRow, isEditing: boolean): ReactNode {
    if (!canEdit || isEditing) return null;
    const key = row.key;
    if (row.state.kind === "na") {
      return (
        <>
          <button type="button" className="btn ghost slot-btn slot-hover" data-testid={`${prefix}-na-${key}-edit`} onClick={() => openEditor(row)}>
            {t("tobe.slots.editReason")}
          </button>
          <button type="button" className="btn ghost slot-btn slot-hover" data-testid={`${prefix}-na-${key}-restore`} disabled={saving} onClick={() => onRestore(row)}>
            {t("tobe.slots.restore")}
          </button>
        </>
      );
    }
    if (!row.canMarkNa) return null;
    // 정할 칸은 다음 할 일이라 늘 보이고, 빈 칸은 줄에 올리거나 포커스가 갈 때만
    return (
      <button type="button" className={`btn ghost slot-btn ${row.state.kind === "decide" ? "" : "slot-hover"}`} data-testid={`${prefix}-na-${key}-mark`} onClick={() => openEditor(row)}>
        {t("tobe.slots.mark")}
      </button>
    );
  }

  function renderEditor(row: SlotRow, current: NaEdit): ReactNode {
    const key = row.key;
    const inputId = `${prefix}-na-${key}-input`;
    return (
      <div className="slot-editor" data-testid={`${prefix}-na-${key}-editor`}>
        <label htmlFor={inputId} className="text-xs text-ink-3">
          {t("tobe.slots.reasonLabel")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="slot-input"
          data-testid={`${prefix}-na-${key}-reason`}
          value={current.text}
          maxLength={2000}
          placeholder={t("tobe.slots.reasonPlaceholder", { name: row.label })}
          // 열리면 사유 칸으로 - 떠나도 아무 일도 없다(onBlur를 걸지 않는다)
          autoFocus
          onChange={(event) => onEdit({ ...current, text: event.target.value })}
          onKeyDown={(event) => handleReasonKey(event, current)}
        />
        {usedReasons.length > 0 && (
          <div className="slot-used">
            <span className="text-xs text-ink-3">{t("tobe.slots.used")}</span>
            {usedReasons.map((reason, index) => (
              <Tooltip key={reason} label={reason}>
                <button
                  type="button"
                  className="slot-chip"
                  data-testid={`${prefix}-na-${key}-chip-${index}`}
                  onClick={() => {
                    onEdit({ ...current, text: reason, refused: false });
                    inputRef.current?.focus();
                  }}
                >
                  {reason}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn pri h-7" data-testid={`${prefix}-na-${key}-save`} disabled={current.text.trim() === "" || saving} onClick={() => onSave(key, current.text.trim())}>
            {t("tobe.slots.save")}
            <kbd>↵</kbd>
          </button>
          <button type="button" className="btn h-7" data-testid={`${prefix}-na-${key}-cancel`} onClick={() => onEdit(null)}>
            {t("common.cancel")}
            <kbd>Esc</kbd>
          </button>
        </div>
        {current.refused && (
          <p role="status" className="text-xs text-warn" data-testid={`${prefix}-na-${key}-finish-first`}>
            {t("tobe.slots.finishFirst")}
          </p>
        )}
      </div>
    );
  }

  function renderRow(row: SlotRow): ReactNode {
    const key = row.key;
    const isEditing = myEdit !== null && myEdit.slotKey === key;
    const coveredBy = row.state.kind === "covered" ? byKey.get(row.state.by) : undefined;
    const isReasonOpen = openReasons.has(key);
    return (
      <div key={key} className="slot-row" data-slot={key} data-state={row.state.kind} data-child={row.isChild ? "" : undefined} data-editing={isEditing ? "" : undefined} data-testid={`${prefix}-slot-${key}`}>
        <span className="slot-num">{row.number}</span>
        <span className="slot-name">{row.label}</span>
        <span className="slot-state" data-testid={`${prefix}-slot-${key}-state`}>
          {renderState(row)}
        </span>
        <span className="slot-acts">{renderActions(row, isEditing)}</span>
        {row.state.kind === "na" && (
          // 사유는 두 줄에서 자르고, 글 자체가 단추다 - 누르면 그 자리에서 다 펴진다
          <button type="button" className="slot-reason" aria-expanded={isReasonOpen} data-testid={`${prefix}-na-${key}-text`} onClick={() => toggleReason(key)}>
            {/* 줄 자르기는 단추 안의 글에 건다(단추 요소에는 line-clamp가 먹지 않는다) */}
            <span className={isReasonOpen ? undefined : "clamp-2"}>{row.state.reason}</span>
          </button>
        )}
        {coveredBy && (
          <span className="slot-note" data-testid={`${prefix}-na-${key}-text`}>
            {t("tobe.slots.covered", { number: coveredBy.number, name: coveredBy.label })}
          </span>
        )}
        {/* 칸 제목에 옛 제목이 이어진 칸 - 서버가 N/A를 막으므로 단추 대신 까닭(문장이라 단추 열이 아니라 줄 아래 글로 둔다) */}
        {canEdit && row.headingLinked && (
          <span className="slot-note" data-testid={`${prefix}-slot-${key}-heading-note`}>
            {t("tobe.slots.headingLinked")}
          </span>
        )}
        {isEditing && myEdit !== null && renderEditor(row, myEdit)}
      </div>
    );
  }

  return (
    <div className="slot-table" data-testid={`${prefix}-slots`}>
      <div className="slot-head">
        <span className="slot-title">{t("tobe.slots.title")}</span>
        <span className="text-xs text-ink-2" data-testid={`${prefix}-slots-summary`}>
          {/* 이미 쓴 SOP는 문장 수를 세지 않는다 - "0 with sentences"는 거짓이라 N/A 수만 */}
          {isWritten ? t("tobe.row.na", { n: summary.na }) : t("tobe.slots.summary", { filled: summary.filled, empty: summary.empty, na: summary.na })}
        </span>
        {summary.decide > 0 && (
          <span className="pill warn" data-testid={`${prefix}-slots-decide`}>
            {t("tobe.slots.decide", { n: summary.decide })}
          </span>
        )}
      </div>
      <div className="slot-cols">
        {SLOT_COLUMNS.map((column) => (
          <div key={column[0]} className="slot-col">
            {column.map((key) => {
              const row = byKey.get(key);
              return row ? renderRow(row) : null;
            })}
          </div>
        ))}
      </div>
      <p className="slot-help">{t("tobe.slots.help")}</p>
    </div>
  );
}
