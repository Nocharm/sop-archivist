// SOP 한 줄의 칸 상태 표(New 목록의 펼친 곳) - 칸마다 지금 상태(문장 수·Empty·N/A)를 먼저 보이고 하는 일(Mark N/A·Edit reason·Restore)을 단추로 둔다.
// 문장을 받지 않는 줄은 상태가 다르다 - 하위만 묶는 항목은 하위의 문장 수만(없으면 빈 자리), 앱이 채우는 목록은 그 설명만 있고 N/A 단추가 없다.
// 사유 편집기는 화면에 하나다(ToBeSection의 naEdit) - Save N/A·Cancel로만 닫히고, 칸을 떠나거나 줄을 접어도 적던 사유는 남는다.
// 표준에서 벗어나는 일(이름 바꾸기 · 빼기 · 되살리기 · 사용자 항목 더하기)도 같은 편집기(mode)와 줄 끝 아이콘 단추로 한다 - 표준과 다른 줄은 이름 옆 표시에 사유 툴팁.
// 설계: docs/superpowers/specs/2026-11-17-documents-screen-design.md §8
"use client";

import { Minus, Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { DeviationMark } from "@/components/tobe/deviation-mark";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import {
  canSubmitSlotEdit,
  formatSlotName,
  openNaEdit,
  splitSlotColumns,
  type NaEdit,
  type OutlineAction,
  type SlotEditMode,
  type SlotKey,
  type SlotRow,
  type SlotSummary,
} from "@/lib/slot-status-model";

/** 최상위에 더할 때의 편집기 칸 키(부모가 없다) - 시험 ID에는 "top"으로 적는다 */
const TOP_KEY = "";

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
  onSave: (slotKey: SlotKey, reason: string) => Promise<void>;
  onRestore: (row: SlotRow) => void;
  /** 골격 쓰기(표준에서 벗어나기 · 되살리기) - 편집기로 한 쓰기는 성공하면 부른 쪽이 그 편집기를 닫는다 */
  onOutline: (action: OutlineAction, mode: SlotEditMode) => Promise<void>;
}

export function SlotTable({ prefix, docKey, rows, summary, isWritten, canEdit, saving, usedReasons, edit, onEdit, onSave, onRestore, onOutline }: SlotTableProps): ReactNode {
  const { t } = useI18n();
  // 고칠 수 없게 되면(검토 요청 등으로 다시 받은 Bundle) 편집기를 그리지 않는다 - 목록이 편집기도 닫는다
  const myEdit = canEdit && edit !== null && edit.docKey === docKey ? edit : null;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  // 다 펼친 사유 - 그 줄만이고 기억하지 않는다
  const [openReasons, setOpenReasons] = useState<ReadonlySet<SlotKey>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // 바로 전 그림에서 편집기가 열려 있던 칸 - 닫힐 때 포커스를 그 칸의 다음 할 일로 옮긴다
  const lastEditKeyRef = useRef<SlotKey | null>(null);
  const editingKey = myEdit?.slotKey ?? null;
  // 이미 쓴 SOP(입구 2)는 골격이 파일의 것이라 고치지 않는다
  const canEditOutline = canEdit && !isWritten;
  // 저장 중 - saving은 다시 그린 뒤에야 닿아, 같은 작업 안의 두 번째 Enter·누름은 이 값으로 막는다
  const submittingRef = useRef(false);

  // 적는 중에 다른 칸을 열려 하면 열려 있는 편집기로 포커스를 돌린다(누른 단추가 포커스를 가져간 뒤라 이펙트에서).
  // 접혀 있던 줄이 다시 펼쳐졌으면 접힘 전환이 보이게 할 때까지(visibility) 포커스를 받지 못한다 - 받을 때까지 몇 프레임 다시 시도한다
  useEffect(() => {
    if (!myEdit?.refused) return;
    let frame = 0;
    let tries = 0;
    const tryFocus = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (document.activeElement !== input && tries < 30) {
        tries += 1;
        frame = requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, [myEdit]);

  // 편집기가 닫히며(저장 · 취소 · Esc) 포커스가 쪽으로 떨어졌으면 그 칸의 다음 할 일(Edit reason · Mark N/A)로 - 키보드 사용자가 제자리에 남는다
  useEffect(() => {
    const closed = lastEditKeyRef.current;
    lastEditKeyRef.current = editingKey;
    if (closed === null || editingKey !== null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-slot="${closed}"] .slot-acts button`)?.focus();
  }, [editingKey]);

  function openEditor(row: SlotRow) {
    const saved = row.state.kind === "na" ? row.state.reason : "";
    onEdit(openNaEdit(edit, { docKey, slotKey: row.key, saved }));
  }

  /** 골격 편집기 - 이름은 지금 이름과 사유로, 빼기는 빈 사유로, 더하기는 빈 이름 · 사유로 연다 */
  function openOutlineEditor(slotKey: SlotKey, mode: Exclude<SlotEditMode, "na">, row?: SlotRow) {
    const saved = mode === "rename" ? (row?.deviationReason ?? "") : "";
    const savedTitle = mode === "rename" ? row?.titleEn : mode === "add" ? "" : undefined;
    onEdit(openNaEdit(edit, { docKey, slotKey, saved, mode, savedTitle }));
  }

  /** 빼기 - 필수 표준 항목만 사유를 묻고, 선택 항목(7.1.x)은 바로 빼고 사용자 항목은 바로 지운다 */
  function removeItem(row: SlotRow) {
    if (row.origin === "custom") void onOutline({ kind: "delete", key: row.key }, "remove");
    else if (row.isRequired) openOutlineEditor(row.key, "remove");
    else void onOutline({ kind: "remove", key: row.key, reason: "" }, "remove");
  }

  function toggleReason(key: SlotKey) {
    setOpenReasons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(current: NaEdit) {
    const reason = current.text.trim();
    const titleEn = (current.title ?? "").trim();
    if (!canSubmitSlotEdit(current) || saving || submittingRef.current) return;
    submittingRef.current = true;
    const key = current.slotKey;
    try {
      const mode = current.mode ?? "na";
      if (mode === "na") await onSave(key, reason);
      else if (mode === "rename") await onOutline({ kind: "rename", key, titleEn, reason }, mode);
      else if (mode === "remove") await onOutline({ kind: "remove", key, reason }, mode);
      else await onOutline({ kind: "add", parentKey: key, titleEn, reason }, mode);
    } finally {
      submittingRef.current = false;
    }
  }

  function handleReasonKey(event: KeyboardEvent<HTMLInputElement>, current: NaEdit) {
    // 한글 조합 중의 Enter는 글자를 끝내는 것이다
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void submit(current);
    }
  }

  /** Esc는 편집기 어디에서나(사유 칸 · 칩 · Save · Cancel) 닫는다 */
  function handleEditorKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // 펼친 곳 밖의 Esc 처리(창 닫기 등)로 번지지 않게
    event.preventDefault();
    event.stopPropagation();
    onEdit(null);
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
      case "auto":
        // 설명은 문장이라 줄 아래 글로 둔다(상태 열에 두면 그 단의 이름 열이 좁아진다). 이미 쓴 SOP는 이 절도 파일을 따른다
        return isWritten ? <span className="text-ink-3">{t("tobe.slots.fromFile")}</span> : null;
      case "group":
        // 하위만 묶는 항목 - 그 아래에 문장이 없으면 적을 상태가 없다
        return null;
      case "empty":
        return <span className="text-ink-3">{isWritten ? t("tobe.slots.fromFile") : t("tobe.slots.empty")}</span>;
      case "na":
      case "covered":
        return <span className="pill quiet">{t("tobe.slots.na")}</span>;
      case "removed":
        return <span className="text-ink-3">{t("tobe.outline.removed")}</span>;
    }
  }

  /** 줄 끝 아이콘 단추 하나 - 아이콘만이라 툴팁과 이름을 단다. 줄에 올리거나 포커스가 갈 때만 보인다 */
  function renderIconButton(label: string, testId: string, icon: ReactNode, run: () => void): ReactNode {
    return (
      <Tooltip label={label} align="end">
        <button type="button" className="btn ghost slot-btn slot-icon slot-hover" aria-label={label} data-testid={testId} disabled={saving} onClick={run}>
          {icon}
        </button>
      </Tooltip>
    );
  }

  /** 골격 단추 - 이름 바꾸기(표준 · 사용자 항목), 빼기(문장 · 칸 제목이 없을 때), 하위에 더하기(묶음 제목). 선언 항목은 선언 목록이 고친다 */
  function renderOutlineActions(row: SlotRow): ReactNode {
    if (!canEditOutline || row.origin === "declared") return null;
    const name = formatSlotName(row);
    return (
      <>
        {renderIconButton(t("tobe.outline.rename", { name }), `${prefix}-outline-${row.key}-rename`, <Pencil size={14} strokeWidth={1.5} aria-hidden />, () =>
          openOutlineEditor(row.key, "rename", row),
        )}
        {row.canRemove && renderIconButton(t("tobe.outline.remove", { name }), `${prefix}-outline-${row.key}-remove`, <Minus size={14} strokeWidth={1.5} aria-hidden />, () => removeItem(row))}
        {row.canAddChild &&
          renderIconButton(t("tobe.outline.addChild", { name }), `${prefix}-outline-${row.key}-add`, <Plus size={14} strokeWidth={1.5} aria-hidden />, () => openOutlineEditor(row.key, "add"))}
      </>
    );
  }

  function renderActions(row: SlotRow, isEditing: boolean): ReactNode {
    if (!canEdit || isEditing) return null;
    const key = row.key;
    if (row.state.kind === "removed") {
      if (!canEditOutline) return null;
      return (
        <button type="button" className="btn ghost slot-btn slot-hover" data-testid={`${prefix}-outline-${key}-restore`} disabled={saving} onClick={() => void onOutline({ kind: "restore", key }, "remove")}>
          {t("tobe.outline.restore")}
        </button>
      );
    }
    // N/A 줄은 Edit reason · Restore만 - 단추 열이 넓어지면 칸 이름이 좁아진다(N/A를 되돌린 뒤 이름 · 빼기)
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
    // 줄에 올리거나 포커스가 갈 때만
    return (
      <>
        {renderOutlineActions(row)}
        {row.canMarkNa && (
          <button type="button" className="btn ghost slot-btn slot-hover" data-testid={`${prefix}-na-${key}-mark`} onClick={() => openEditor(row)}>
            {t("tobe.slots.mark")}
          </button>
        )}
      </>
    );
  }

  /** 편집기 - N/A 사유, 또는 골격 쓰기(이름 · 빼기 · 더하기)의 이름과 사유. name은 자리 표시 글에 넣는 칸 이름(더하기는 부모) */
  function renderEditor(slotKey: SlotKey, name: string, current: NaEdit, isStandard: boolean): ReactNode {
    const mode = current.mode ?? "na";
    const base = `${prefix}-${mode}-${slotKey === TOP_KEY ? "top" : slotKey}`;
    const hasTitle = mode === "rename" || mode === "add";
    const reasonId = `${base}-input`;
    const titleId = `${base}-title`;
    const saveLabel = { na: t("tobe.slots.save"), rename: t("tobe.outline.saveRename"), remove: t("tobe.outline.saveRemove"), add: t("tobe.outline.saveAdd") }[mode];
    const placeholder = mode === "na" ? t("tobe.slots.reasonPlaceholder", { name }) : mode === "rename" && isStandard ? t("tobe.outline.reasonOptional") : undefined;
    return (
      <div className="slot-editor" data-testid={`${base}-editor`} onKeyDown={handleEditorKey}>
        {hasTitle && (
          <>
            <label htmlFor={titleId} className="text-xs text-ink-3">
              {t("tobe.outline.titleLabel")}
            </label>
            <input
              ref={inputRef}
              id={titleId}
              className="slot-input"
              data-testid={titleId}
              value={current.title ?? ""}
              maxLength={200}
              autoFocus
              onChange={(event) => onEdit({ ...current, title: event.target.value })}
              onKeyDown={(event) => handleReasonKey(event, current)}
            />
          </>
        )}
        <label htmlFor={reasonId} className="text-xs text-ink-3">
          {mode === "na" ? t("tobe.slots.reasonLabel") : t("tobe.outline.reasonLabel")}
        </label>
        <input
          ref={hasTitle ? undefined : inputRef}
          id={reasonId}
          className="slot-input"
          data-testid={`${base}-reason`}
          value={current.text}
          maxLength={2000}
          placeholder={placeholder}
          // 열리면 첫 칸으로 - 떠나도 아무 일도 없다(onBlur를 걸지 않는다)
          autoFocus={!hasTitle}
          onChange={(event) => onEdit({ ...current, text: event.target.value })}
          onKeyDown={(event) => handleReasonKey(event, current)}
        />
        {mode === "na" && usedReasons.length > 0 && (
          <div className="slot-used">
            <span className="text-xs text-ink-3">{t("tobe.slots.used")}</span>
            {usedReasons.map((reason, index) => (
              <Tooltip key={reason} label={reason}>
                <button
                  type="button"
                  className="slot-chip"
                  data-testid={`${base}-chip-${index}`}
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
          <button type="button" className="btn pri h-7" data-testid={`${base}-save`} disabled={!canSubmitSlotEdit(current) || saving} onClick={() => void submit(current)}>
            {saveLabel}
            <kbd>↵</kbd>
          </button>
          <button type="button" className="btn h-7" data-testid={`${base}-cancel`} onClick={() => onEdit(null)}>
            {t("common.cancel")}
            <kbd>Esc</kbd>
          </button>
        </div>
        {current.refused && (
          <p role="status" className="text-xs text-warn" data-testid={`${base}-finish-first`}>
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
      <div
        key={key}
        className="slot-row"
        data-slot={key}
        data-state={row.state.kind}
        data-child={row.level > 0 ? "" : undefined}
        // 하위 칸의 들여쓰기 24px은 CSS(data-child)가 건다 - 그보다 깊은 수준만 단마다 24px씩 더 들인다
        style={row.level > 1 ? { "--slot-indent": `${row.level * 24}px` } : undefined}
        data-editing={isEditing ? "" : undefined}
        data-testid={`${prefix}-slot-${key}`}
      >
        <span className="slot-num">{row.number}</span>
        <span className="slot-name" data-removed={row.state.kind === "removed" ? "" : undefined}>
          {row.label}
          {row.isDeviation && <DeviationMark reason={row.deviationReason} testId={`${prefix}-slot-${key}-differs`} />}
        </span>
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
            {t("tobe.slots.covered", { name: formatSlotName(coveredBy) })}
          </span>
        )}
        {row.state.kind === "auto" && !isWritten && (
          <span className="slot-note" data-testid={`${prefix}-slot-${key}-auto-note`}>
            {t("tobe.slots.autoList")}
          </span>
        )}
        {/* 칸 제목에 옛 제목이 이어진 칸 - 서버가 N/A를 막으므로 단추 대신 까닭(문장이라 단추 열이 아니라 줄 아래 글로 둔다) */}
        {canEdit && row.headingLinked && (
          <span className="slot-note" data-testid={`${prefix}-slot-${key}-heading-note`}>
            {t("tobe.slots.headingLinked")}
          </span>
        )}
        {isEditing && myEdit !== null && renderEditor(key, (myEdit.mode ?? "na") === "add" ? formatSlotName(row) : row.label, myEdit, row.origin === "standard")}
      </div>
    );
  }

  return (
    <div ref={tableRef} className="slot-table" data-testid={`${prefix}-slots`}>
      <div className="slot-head">
        <span className="slot-title">{t("tobe.slots.title")}</span>
        <span className="text-xs text-ink-2" data-testid={`${prefix}-slots-summary`}>
          {/* 이미 쓴 SOP는 문장 수를 세지 않는다 - "0 with sentences"는 거짓이라 N/A 수만 */}
          {isWritten ? t("tobe.row.na", { n: summary.na }) : t("tobe.slots.summary", { filled: summary.filled, empty: summary.empty, na: summary.na })}
        </span>
      </div>
      <div className="slot-cols">
        {/* 가를 곳이 없는 골격(최상위 칸 하나)은 오른쪽 단이 비어 그리지 않는다 */}
        {splitSlotColumns(rows).map(
          (column) =>
            column.length > 0 && (
              <div key={column[0].key} className="slot-col">
                {column.map(renderRow)}
              </div>
            ),
        )}
      </div>
      {canEditOutline &&
        (myEdit !== null && myEdit.slotKey === TOP_KEY && myEdit.mode === "add" ? (
          // 표의 격자 밖이라 블록으로 감싼다(편집기의 grid-column이 표에 새 열을 만들지 않게)
          <div>{renderEditor(TOP_KEY, "", myEdit, false)}</div>
        ) : (
          <div>
            <button type="button" className="btn ghost slot-btn" data-testid={`${prefix}-outline-add-top`} disabled={saving} onClick={() => openOutlineEditor(TOP_KEY, "add")}>
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              {t("tobe.outline.addTop")}
            </button>
          </div>
        ))}
      <p className="slot-help">{t("tobe.slots.help")}</p>
    </div>
  );
}
