// 사내 AI로 부여 등록 창 - 관리자가 쓴 지시를 AI가 줄마다 읽고, 미리보기에서 고른 줄만 일괄 저장한다. AI가 꺼지거나 실패해도 "부여 추가"는 그대로다.
"use client";

import { Building2, LoaderCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { ApiError, batchGrants, readGrantsWithAi, type Grant, type GrantAiLine } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import {
  buildGrantAiBatch,
  buildGrantAiRows,
  countGrantAiStatus,
  getPickKey,
  hasChange,
  isRowToCheck,
  type GrantAiRow,
} from "@/lib/grant-ai-model";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_FIELD } from "@/lib/ui-classes";
import { useSubjectDirectory } from "@/lib/use-subject-names";

// 서버 상한(MAX_GRANT_AI_TEXT_CHARS)과 같다
const MAX_TEXT = 4000;

interface GrantAiModalProps {
  grants: readonly Grant[];
  roleNames: ReadonlyMap<number, string>;
  onClose: () => void;
  onSaved: () => void;
}

export function GrantAiModal({ grants, roleNames, onClose, onSaved }: GrantAiModalProps) {
  const { t } = useI18n();
  const directory = useSubjectDirectory();
  const [text, setText] = useState("");
  const [lines, setLines] = useState<GrantAiLine[] | null>(null);
  const [picks, setPicks] = useState<ReadonlyMap<string, string>>(new Map());
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const rows = lines === null ? [] : buildGrantAiRows(lines, grants, picks);
  const checked = new Set(rows.filter((row) => hasChange(row) && !unchecked.has(row.key)).map((row) => row.key));
  const batch = buildGrantAiBatch(rows, checked);
  const total = (batch.add?.length ?? 0) + (batch.remove?.length ?? 0);
  const toCheck = rows.filter(isRowToCheck).length;

  const handleRead = async () => {
    setIsReading(true);
    setError(null);
    try {
      const result = await readGrantsWithAi(text);
      setLines(result.lines);
      setPicks(new Map());
      setUnchecked(new Set());
    } catch (err) {
      setError(err);
    } finally {
      setIsReading(false);
    }
  };

  const handleApply = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await batchGrants(batch);
      const skipped = result.skipped.length + result.unknown.length + result.missing.length;
      showToast(t("grants.ai.done", { added: result.added.length, removed: result.removed.length }) + (skipped > 0 ? ` ${t("grants.ai.doneSkipped", { count: skipped })}` : ""));
      onSaved();
    } catch (err) {
      setError(err);
      setIsSaving(false);
    }
  };

  const toggleRow = (key: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickSubject = (rowKey: string, written: string, value: string) => {
    setPicks((prev) => new Map(prev).set(getPickKey(rowKey, written), value));
  };

  const isAiOff = error instanceof ApiError && error.status === 503;

  return (
    <Modal
      testId="grant-ai"
      size="xl"
      title={t("grants.ai.title")}
      subtitle={t("grants.ai.subtitle")}
      isBusy={isSaving}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-3">{t("grants.ai.privacy")}</span>
          <button type="button" data-testid="grant-ai-cancel" className={BUTTON_SECONDARY} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" data-testid="grant-ai-apply" className={BUTTON_PRIMARY} disabled={total === 0 || isSaving} onClick={() => void handleApply()}>
            {isSaving ? t("common.saving") : total > 0 ? t("grants.ai.apply", { count: total }) : t("grants.ai.applyNone")}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="space-y-2">
          <label htmlFor="grant-ai-text" className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink-2">
            {t("grants.ai.text")}
            <span className="text-xs font-normal text-ink-3">{t("grants.ai.textHint")}</span>
          </label>
          <textarea
            id="grant-ai-text"
            data-testid="grant-ai-text"
            className={`${INPUT_FIELD} h-32 py-2 font-mono text-[13px] leading-relaxed`}
            value={text}
            maxLength={MAX_TEXT}
            spellCheck={false}
            placeholder={t("grants.ai.placeholder")}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" data-testid="grant-ai-read" className={BUTTON_SECONDARY} disabled={text.trim() === "" || isReading} onClick={() => void handleRead()}>
            {isReading ? <LoaderCircle size={16} strokeWidth={1.5} className="animate-spin" aria-hidden /> : <Sparkles size={16} strokeWidth={1.5} aria-hidden />}
            {isReading ? t("grants.ai.reading") : lines === null ? t("grants.ai.read") : t("grants.ai.reread")}
          </button>
          {error !== null && (
            <InlineNotice testId="grant-ai-error" tone={isAiOff ? "info" : "error"}>
              {isAiOff ? t("grants.ai.off") : humanizeApiError(error, t)}
            </InlineNotice>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <span className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink-2">
            {t("grants.ai.preview")}
            <span className="text-xs font-normal text-ink-3">{t("grants.ai.previewHint")}</span>
          </span>
          {lines === null ? (
            <p data-testid="grant-ai-empty" className="rounded-md border border-dashed border-line-2 px-4 py-8 text-center text-sm text-ink-3">
              {t("grants.ai.emptyPreview")}
            </p>
          ) : rows.length === 0 ? (
            <p data-testid="grant-ai-none" className="rounded-md border border-dashed border-line-2 px-4 py-8 text-center text-sm text-ink-3">
              {t("grants.ai.noLines")}
            </p>
          ) : (
            <div className="adm-ai-rows" data-testid="grant-ai-rows">
              {rows.map((row) => (
                <GrantAiRowView
                  key={row.key}
                  row={row}
                  isChecked={checked.has(row.key)}
                  roleNames={roleNames}
                  getName={(type, id) => directory.names.get(type, id, id)}
                  onToggle={() => toggleRow(row.key)}
                  onPick={(written, value) => pickSubject(row.key, written, value)}
                />
              ))}
            </div>
          )}
          {lines !== null && rows.length > 0 && (
            <p className="flex flex-wrap gap-x-4 text-xs text-ink-3" data-testid="grant-ai-summary">
              <span>{t("grants.ai.sumAdd", { count: batch.add?.length ?? 0 })}</span>
              <span>{t("grants.ai.sumRemove", { count: batch.remove?.length ?? 0 })}</span>
              {toCheck > 0 && <span>{t("grants.ai.sumCheck", { count: toCheck })}</span>}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface GrantAiRowViewProps {
  row: GrantAiRow;
  isChecked: boolean;
  roleNames: ReadonlyMap<number, string>;
  getName: (type: "user" | "dept", id: string) => string;
  onToggle: () => void;
  onPick: (written: string, value: string) => void;
}

function GrantAiRowView({ row, isChecked, roleNames, getName, onToggle, onPick }: GrantAiRowViewProps) {
  const { t } = useI18n();
  const counts = countGrantAiStatus(row);
  const canCheck = hasChange(row);
  const toCheck = isRowToCheck(row);
  return (
    <div className="adm-ai-row" data-testid={`grant-ai-row-${row.key}`} data-check={toCheck || undefined} data-off={!isChecked || undefined}>
      <Checkbox
        testId={`grant-ai-check-${row.key}`}
        checked={isChecked}
        disabled={!canCheck}
        ariaLabel={t("grants.ai.rowCheck", { line: row.line })}
        onChange={onToggle}
      />
      <span className="adm-ai-cells">
        {row.subjects.map((subject) =>
          subject.matches.length > 1 ? (
            <Select
              key={subject.written}
              testId={`grant-ai-pick-${row.key}`}
              ariaLabel={t("grants.ai.pick", { name: subject.written })}
              value={subject.chosen ? `${subject.chosen.subject_type}:${subject.chosen.subject_id}` : ""}
              options={[
                { value: "", label: t("grants.ai.pickPlaceholder", { name: subject.written, count: subject.matches.length }) },
                ...subject.matches.map((match) => ({ value: `${match.subject_type}:${match.subject_id}`, label: `${getName(match.subject_type, match.subject_id)} (${match.subject_id})` })),
              ]}
              onChange={(value) => onPick(subject.written, value)}
            />
          ) : subject.chosen ? (
            <span key={subject.written} className="adm-chip adm-ai-who">
              <span className="adm-ai-name">
                {subject.chosen.subject_type === "dept" && <Building2 size={12} strokeWidth={1.5} className="text-ink-3" aria-hidden />}
                {getName(subject.chosen.subject_type, subject.chosen.subject_id)}
              </span>
              <span className="adm-id">{subject.chosen.subject_id}</span>
            </span>
          ) : (
            <span key={subject.written} className="adm-chip" data-bad>
              {subject.written}
            </span>
          ),
        )}
      </span>
      <span className="adm-ai-op" data-action={row.action}>
        {t(`grants.ai.action.${row.action}`)}
      </span>
      <span className="adm-ai-cells">
        {row.roles.map((role) => (
          <span key={role.written} className="adm-chip" data-kind="role" data-bad={role.role_id === null || undefined}>
            {role.role_id !== null ? (roleNames.get(role.role_id) ?? role.written) : role.written}
          </span>
        ))}
        {row.permissions.map((perm) => (
          <span key={perm.written} className="adm-chip direct" data-bad={perm.permission === null || undefined}>
            {perm.permission !== null ? t(`permission.${perm.permission}`) : perm.written}
          </span>
        ))}
      </span>
      <span className="adm-ai-status" data-testid={`grant-ai-status-${row.key}`}>
        {counts.new > 0 && <span data-status="new">{t("grants.ai.status.new", { count: counts.new })}</span>}
        {counts.remove > 0 && <span data-status="remove">{t("grants.ai.status.remove", { count: counts.remove })}</span>}
        {counts.exists > 0 && <span>{t("grants.ai.status.exists", { count: counts.exists })}</span>}
        {counts.notHeld > 0 && <span>{t("grants.ai.status.notHeld", { count: counts.notHeld })}</span>}
        {row.needsPick.length > 0 && <span data-status="check">{t("grants.ai.status.pick")}</span>}
        {row.unknownSubjects.length > 0 && <span data-status="check">{t("grants.ai.status.unknownSubject", { count: row.unknownSubjects.length })}</span>}
        {row.unknownWhat.length > 0 && <span data-status="check">{t("grants.ai.status.unknownWhat", { count: row.unknownWhat.length })}</span>}
        {(row.subjects.length === 0 || row.roles.length + row.permissions.length === 0) && <span data-status="check">{t("grants.ai.status.incomplete")}</span>}
      </span>
    </div>
  );
}
