// 관리 화면 - SOP 표준 골격. 새 SOP 문서가 복사해 가는 본(항목의 순서·키·제목·종류·기본 표시)을 표 하나로 고친다.
// 고친 것은 화면에만 있다가 Save로 목록을 통째로 보낸다(백엔드 sop_outline.py). 이미 만든 문서의 골격은 바뀌지 않는다.
// 줄 규칙(번호·더하기·빼기·옮기기·저장 전 검사)은 lib/outline-admin-model.ts에 있다.
"use client";

import { ArrowDown, ArrowUp, CircleAlert, CornerDownRight, Plus, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";

import { PanelTitle } from "@/components/admin/panel-title";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/ui/info-tip";
import { LoadError } from "@/components/ui/load-error";
import { BusyLabel } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { getOutlineStandard, putOutlineStandard, type OutlineStandardItem } from "@/lib/api-manage";
import type { NumberStyle } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import {
  addRow,
  buildItems,
  buildRows,
  canAddChild,
  canMoveRow,
  CHILD_PREFIX_MAX,
  findProblem,
  hasChildren,
  isChanged,
  KEY_MAX,
  moveRow,
  NUMBER_STYLES,
  numberRows,
  OUTLINE_KINDS,
  removeRow,
  TITLE_MAX,
  type OutlineProblem,
  type OutlineRow,
} from "@/lib/outline-admin-model";
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_FIELD } from "@/lib/ui-classes";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";

// 기본 표시의 이름은 결과물 C의 번호 표시 단추와 같은 글을 쓴다
const STYLE_LABEL_KEYS: Record<NumberStyle, string> = {
  numbered: "outputs.markNumbered",
  bullet: "outputs.markBullet",
  omitted: "outputs.markOmitted",
  note: "outputs.markNote",
};

// 고르는 칸의 폭(px) - 열 폭(아래 colgroup)에서 칸 좌우 여백을 뺀 값
const KIND_SELECT_WIDTH = 136;
const STYLE_SELECT_WIDTH = 108;

// 긴 제목이 들어와도 열이 밀리지 않게 폭을 고정한다(table-layout: fixed) - 제목과 하위 항목 열이 남은 폭을 나눠 갖는다
const INPUT_CELL = `${INPUT_FIELD} min-w-0`;

/** 문제의 사람 말 - 서버가 거절하는 사유는 서버 문구(rule.outline_invalid.<사유>)와 같은 글을 쓴다 */
function describeProblem(problem: OutlineProblem, t: (key: string) => string): string {
  const isScreenOnly = problem.reason === "title_required" || problem.reason === "bad_suggestions";
  return t(isScreenOnly ? `outline.problem.${problem.reason}` : `rule.outline_invalid.${problem.reason}`);
}

function RowAction({ icon: Icon, label, testId, disabled, danger = false, onClick }: { icon: LucideIcon; label: string; testId: string; disabled: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <Tooltip label={label} align="end">
      <button type="button" className={`${BUTTON_ICON} h-6 w-6 ${danger ? "text-danger" : ""}`} aria-label={label} data-testid={testId} disabled={disabled} onClick={onClick}>
        <Icon size={16} strokeWidth={1.5} aria-hidden />
      </button>
    </Tooltip>
  );
}

interface OutlineRowViewProps {
  row: OutlineRow;
  /** 새 문서에서 이 항목이 받을 번호 - 키가 맞지 않거나 부모가 위에 없으면 null */
  number: string | null;
  /** 이 줄이 저장을 막고 있으면 그 까닭 */
  problem: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  withChildren: boolean;
  busy: boolean;
  onEdit: (change: Partial<OutlineRow>) => void;
  onAddChild: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function OutlineRowView({ row, number, problem, canMoveUp, canMoveDown, withChildren, busy, onEdit, onAddChild, onMove, onRemove }: OutlineRowViewProps) {
  const { t } = useI18n();
  const id = `admin-outline-row-${row.rowId}`;
  // 하위 항목 칸은 그 종류가 쓸 때만(머리말은 이름 붙인 하위 절, 권장 이름은 그것과 범주 표). 값이 남아 있으면 종류와 상관없이 보여 숨은 값이 저장되지 않게 한다
  const hasPrefix = row.kind === "named_children" || row.child_prefix !== "";
  const hasSuggestions = row.kind === "named_children" || row.kind === "category_table" || row.suggestions !== "";
  const canExpand = hasPrefix || hasSuggestions;
  const [open, setOpen] = useState(false);
  const isOpen = canExpand && open;
  const names = row.suggestions.split(",").filter((name) => name.trim() !== "").length;
  return (
    <>
      <tr data-testid={id} data-open={isOpen ? "" : undefined}>
        <td>
          {problem !== null ? (
            <Tooltip label={problem} align="start">
              <span className="inline-flex text-danger" tabIndex={0} role="img" aria-label={problem} data-testid={`${id}-problem`}>
                <CircleAlert size={16} strokeWidth={1.5} aria-hidden />
              </span>
            </Tooltip>
          ) : (
            <span className="font-mono text-[13px] tabular-nums text-ink-2" data-testid={`${id}-number`}>
              {number ?? "–"}
            </span>
          )}
        </td>
        <td>
          <div className="adm-two">
            <input className="adm-quiet strong" value={row.title_en} maxLength={TITLE_MAX} placeholder={t("outline.titleEn")} aria-label={t("outline.titleEn")} disabled={busy} data-testid={`${id}-title-en`} onChange={(event) => onEdit({ title_en: event.target.value })} />
            {row.isNew ? (
              <input
                className="adm-quiet mono shown"
                // 새 줄은 표 끝이나 하위 끝에 생긴다 - 키 칸에 초점을 줘 그 줄이 화면에 들어오게 한다
                autoFocus
                value={row.key}
                maxLength={KEY_MAX}
                placeholder={t("outline.keyPlaceholder")}
                aria-label={t("outline.colKey")}
                spellCheck={false}
                autoCapitalize="off"
                disabled={busy}
                data-testid={`${id}-key`}
                onChange={(event) => onEdit({ key: event.target.value })}
              />
            ) : (
              <Tooltip label={row.key} align="start" shrinks>
                {/* 하위 항목의 긴 키는 끝 이름만 - 전체는 툴팁(번호가 부모를 말해 준다) */}
                <span className="adm-outline-key" tabIndex={0} data-testid={`${id}-key`} aria-label={row.key}>
                  {row.key.includes(".") ? `….${row.key.split(".").pop() ?? ""}` : row.key}
                </span>
              </Tooltip>
            )}
          </div>
        </td>
        <td>
          <input className="adm-quiet" lang="ko" value={row.title_ko} maxLength={TITLE_MAX} placeholder={t("outline.titleKo")} aria-label={t("outline.titleKo")} disabled={busy} data-testid={`${id}-title-ko`} onChange={(event) => onEdit({ title_ko: event.target.value })} />
        </td>
        <td>
          <Select
            testId={`${id}-kind`}
            ariaLabel={t("outline.colKind")}
            size="sm"
            width={KIND_SELECT_WIDTH}
            value={row.kind}
            disabled={busy}
            options={OUTLINE_KINDS.map((kind) => ({ value: kind, label: t(`outline.kind.${kind}`) }))}
            onChange={(kind) => onEdit({ kind })}
          />
        </td>
        <td>
          <Checkbox testId={`${id}-required`} ariaLabel={t("outline.colRequired")} checked={row.is_required} disabled={busy} onChange={(next) => onEdit({ is_required: next })} />
        </td>
        <td>
          <Select
            testId={`${id}-style`}
            ariaLabel={t("outline.colStyle")}
            size="sm"
            width={STYLE_SELECT_WIDTH}
            value={row.default_style}
            disabled={busy}
            options={NUMBER_STYLES.map((style) => ({ value: style, label: t(STYLE_LABEL_KEYS[style]) }))}
            onChange={(style) => onEdit({ default_style: style })}
          />
        </td>
        <td>
          {canExpand ? (
            <button type="button" className="adm-link" aria-expanded={isOpen} data-testid={`${id}-children`} onClick={() => setOpen((prev) => !prev)}>
              {t("outline.childrenSummary", { count: names })}
            </button>
          ) : (
            <span className="adm-t2">–</span>
          )}
        </td>
        {/* 좁은 창에서 표가 옆으로 밀려도(틀 안 가로 스크롤) 줄 끝 단추는 오른쪽에 붙어 늘 닿는다 */}
        <td className="sticky right-0 bg-[var(--surface)]">
          {/* 줄 끝 단추는 늘 제자리에 흐리게 있고 줄에 올리거나 초점이 가면 또렷해진다 */}
          <span className="row-actions-quiet flex h-8 items-center justify-end gap-0.5">
            <RowAction icon={CornerDownRight} label={t("outline.addChild")} testId={`${id}-add-child`} disabled={busy || !canAddChild(row)} onClick={onAddChild} />
            <RowAction icon={ArrowUp} label={t("outline.moveUp")} testId={`${id}-up`} disabled={busy || !canMoveUp} onClick={() => onMove(-1)} />
            <RowAction icon={ArrowDown} label={t("outline.moveDown")} testId={`${id}-down`} disabled={busy || !canMoveDown} onClick={() => onMove(1)} />
            <RowAction icon={Trash2} label={t(withChildren ? "outline.removeWithChildren" : "outline.remove")} testId={`${id}-remove`} disabled={busy} danger onClick={onRemove} />
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr className="adm-outline-sub" data-testid={`${id}-children-row`}>
          <td />
          <td colSpan={7}>
            <div className="adm-outline-children">
              {hasPrefix && (
                <label className="adm-outline-field">
                  <span className="adm-t2">{t("outline.colChildPrefix")}</span>
                  <input className={INPUT_CELL} value={row.child_prefix} maxLength={CHILD_PREFIX_MAX} placeholder={t("outline.colChildPrefix")} disabled={busy} data-testid={`${id}-child-prefix`} onChange={(event) => onEdit({ child_prefix: event.target.value })} />
                </label>
              )}
              {hasSuggestions && (
                <label className="adm-outline-field wide">
                  <span className="adm-t2">{t("outline.colSuggestions")}</span>
                  <input className={INPUT_CELL} value={row.suggestions} placeholder={t("outline.suggestionsPlaceholder")} disabled={busy} data-testid={`${id}-suggestions`} onChange={(event) => onEdit({ suggestions: event.target.value })} />
                </label>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function OutlinePanel() {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = useLoaded(getOutlineStandard);
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  // 저장 응답 - 저장한 뒤에는 다시 불러오지 않고 이것을 본으로 삼는다
  const [saved, setSaved] = useState<OutlineStandardItem[] | null>(null);
  // 고치는 중인 줄 - null이면 본 그대로다
  const [draft, setDraft] = useState<OutlineRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  // 새 줄의 화면 이름 번호(new-1, new-2 …) - 키에는 "-"를 쓸 수 없어 저장된 줄의 이름(키)과 겹치지 않는다
  const newRowCount = useRef(0);

  const base = saved ?? data;
  if (base === null) {
    if (error !== null) return <LoadError error={error} onRetry={reload} testId="admin-outline" compact />;
    return showSkeleton ? <span className="sk h-[280px] w-full" /> : null;
  }

  const rows = draft ?? buildRows(base);
  const numbers = numberRows(rows);
  const problem = findProblem(rows);
  const problemText = problem === null ? null : describeProblem(problem, t);
  const changed = isChanged(rows, base);

  function add(parentRowId: string | null) {
    newRowCount.current += 1;
    setDraft(addRow(rows, `new-${newRowCount.current}`, parentRowId));
  }

  async function save() {
    setSaving(true);
    try {
      setSaved(await putOutlineStandard(buildItems(rows)));
      setDraft(null);
      showToast(t("outline.saved"));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3" data-testid="admin-outline">
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid min-w-0 gap-1">
          <PanelTitle title={t("admin.tab.outline")} info={t("outline.intro")} testId="admin-outline-info" />
          <p className="text-xs text-ink-3" data-testid="admin-outline-note">
            {t("outline.appliesNote")}
          </p>
        </div>
        <span className="flex-1" />
        <button type="button" className={BUTTON_SECONDARY} data-testid="admin-outline-add" disabled={saving} onClick={() => add(null)}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          {t("outline.add")}
        </button>
        <button type="button" className={BUTTON_SECONDARY} data-testid="admin-outline-discard" disabled={saving || draft === null} onClick={() => setDraft(null)}>
          <Undo2 size={16} strokeWidth={1.5} aria-hidden />
          {t("outline.discard")}
        </button>
        <button type="button" className={BUTTON_PRIMARY} data-testid="admin-outline-save" disabled={saving || !changed || problem !== null} onClick={() => void save()}>
          <BusyLabel busy={saving} label={t("common.save")} busyLabel={t("common.saving")} />
        </button>
      </div>
      {problemText !== null && (
        <p className="text-xs text-danger" role="status" data-testid="admin-outline-problem">
          {problemText}
        </p>
      )}
      <div className="dlist-frame">
        <table className="dtable adm-outline min-w-[1040px] table-fixed" data-testid="admin-outline-table">
          <colgroup>
            <col className="w-[72px]" />
            <col />
            <col />
            <col className="w-[164px]" />
            <col className="w-[88px]" />
            <col className="w-[136px]" />
            <col className="w-[120px]" />
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr>
              <th>{t("outline.colNumber")}</th>
              <th>
                <span className="inline-flex items-center gap-1">
                  {t("outline.colTitle")}
                  <InfoTip text={t("outline.keyInfo")} testId="admin-outline-key-info" />
                </span>
              </th>
              <th>{t("outline.titleKo")}</th>
              <th>
                <span className="inline-flex items-center gap-1">
                  {t("outline.colKind")}
                  <InfoTip text={t("outline.kindInfo")} testId="admin-outline-kind-info" />
                </span>
              </th>
              <th>{t("outline.colRequired")}</th>
              <th>{t("outline.colStyle")}</th>
              <th>
                <span className="inline-flex items-center gap-1">
                  {t("outline.colChildren")}
                  <InfoTip text={t("outline.childrenInfo")} testId="admin-outline-children-info" align="end" />
                </span>
              </th>
              <th className="right-0 z-[2]">
                <span className="sr-only">{t("manage.rowActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <OutlineRowView
                key={row.rowId}
                row={row}
                number={numbers[index]}
                problem={problem?.rowId === row.rowId ? problemText : null}
                canMoveUp={canMoveRow(rows, row.rowId, -1)}
                canMoveDown={canMoveRow(rows, row.rowId, 1)}
                withChildren={hasChildren(rows, row.rowId)}
                busy={saving}
                onEdit={(change) => setDraft(rows.map((item) => (item.rowId === row.rowId ? { ...item, ...change } : item)))}
                onAddChild={() => add(row.rowId)}
                onMove={(direction) => setDraft(moveRow(rows, row.rowId, direction))}
                onRemove={() => setDraft(removeRow(rows, row.rowId))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
