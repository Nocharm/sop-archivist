// 관리 > 권한 > 부여 - 사람·부서에 준 역할/권한 목록, 부여 추가(대상 선택기)와 회수(확인 모달). 대상이 사라진 부여는 지우지 않고 배지로 보여 사람이 정리하게 한다.
"use client";

import { Building2, Plus, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { SubjectPicker, type PickedSubject } from "@/components/subject-picker";
import { PERMISSIONS } from "@/lib/access";
import { translateOrRaw } from "@/lib/admin-format";
import { addGrant, listGrants, listRoles, removeGrant, type Grant, type GrantInput, type SubjectType } from "@/lib/api";
import { humanizeApiError, type TFunc } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY, CHIP, INPUT_FIELD, TABLE_CELL, TABLE_HEAD_CELL } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

const SUBJECT_TYPES: SubjectType[] = ["user", "dept"];

const SEGMENT_CLASS =
  "inline-flex h-8 items-center gap-1.5 border border-gray-300 px-3 text-sm text-gray-700 first:rounded-l-md last:rounded-r-md hover:bg-gray-50 aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:font-semibold aria-pressed:text-gray-900";

// 부여가 가리키는 것의 표시 이름 - 역할이면 역할 이름, 직접 부여면 권한 라벨
function getGrantWhatLabel(grant: Grant, t: TFunc): string {
  if (grant.role_name !== null) return grant.role_name;
  const key = grant.permission ?? "";
  return translateOrRaw(t, `permission.${key}`, key);
}

function getGrantSubjectLabel(grant: Grant): string {
  return grant.subject_missing ? grant.subject_id : grant.subject_name || grant.subject_id;
}

function SubjectTypeIcon({ type }: { type: SubjectType }) {
  return type === "dept" ? <Building2 size={16} strokeWidth={1.5} /> : <UserRound size={16} strokeWidth={1.5} />;
}

interface GrantFormModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function GrantFormModal({ onClose, onSaved }: GrantFormModalProps) {
  const { t } = useI18n();
  const roles = useLoaded(listRoles);
  const [subjectType, setSubjectType] = useState<SubjectType>("user");
  const [subject, setSubject] = useState<PickedSubject | null>(null);
  const [kind, setKind] = useState<"role" | "permission">("role");
  const [roleId, setRoleId] = useState("");
  const [permission, setPermission] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const selectSubjectType = (next: SubjectType) => {
    // 사람과 부서는 id 종류가 달라 이전 선택을 들고 가면 엉뚱한 대상이 된다
    if (next === subjectType) return;
    setSubjectType(next);
    setSubject(null);
  };

  const canSave = subject !== null && (kind === "role" ? roleId !== "" : permission !== "") && !isSaving;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (subject === null) return;
    setIsSaving(true);
    setError(null);
    const body: GrantInput =
      kind === "role"
        ? { subject_type: subjectType, subject_id: subject.id, role_id: Number(roleId) }
        : { subject_type: subjectType, subject_id: subject.id, permission };
    try {
      await addGrant(body);
      onSaved();
    } catch (err) {
      setError(err);
      setIsSaving(false);
    }
  };

  return (
    <Modal
      testId="grant-form"
      title={t("grants.form.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" data-testid="grant-cancel" className={BUTTON_SECONDARY} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" form="grant-form-element" data-testid="grant-save" className={BUTTON_PRIMARY} disabled={!canSave}>
            {isSaving ? t("common.saving") : t("grants.form.save")}
          </button>
        </>
      }
    >
      <form id="grant-form-element" className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-gray-700">{t("grants.form.subjectType")}</span>
          <div className="flex">
            {SUBJECT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={`grant-subject-type-${type}`}
                aria-pressed={subjectType === type}
                className={SEGMENT_CLASS}
                onClick={() => selectSubjectType(type)}
              >
                <SubjectTypeIcon type={type} />
                {t(`grants.subject.${type}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-gray-700">{t("grants.form.subject")}</span>
          <SubjectPicker testId="grant-subject-picker" subjectType={subjectType} value={subject} onChange={setSubject} />
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-gray-700">{t("grants.form.what")}</span>
          <div className="flex">
            <button
              type="button"
              data-testid="grant-kind-role"
              aria-pressed={kind === "role"}
              className={SEGMENT_CLASS}
              onClick={() => setKind("role")}
            >
              {t("grants.form.kindRole")}
            </button>
            <button
              type="button"
              data-testid="grant-kind-permission"
              aria-pressed={kind === "permission"}
              className={SEGMENT_CLASS}
              onClick={() => setKind("permission")}
            >
              {t("grants.form.kindPermission")}
            </button>
          </div>
          {kind === "role" ? (
            <>
              <select
                data-testid="grant-role-select"
                className={INPUT_FIELD}
                value={roleId}
                aria-label={t("grants.form.role")}
                onChange={(event) => setRoleId(event.target.value)}
              >
                <option value="">{t("grants.form.rolePlaceholder")}</option>
                {(roles.data ?? []).map((role) => (
                  <option key={role.id} value={String(role.id)}>
                    {role.name}
                  </option>
                ))}
              </select>
              {roles.data !== null && roles.data.length === 0 && (
                <p data-testid="grant-no-roles" className="text-xs text-gray-500">
                  {t("grants.form.noRoles")}
                </p>
              )}
              {roles.error !== null && (
                <InlineNotice testId="grant-roles-error" tone="error">
                  {humanizeApiError(roles.error, t)}
                </InlineNotice>
              )}
            </>
          ) : (
            <select
              data-testid="grant-permission-select"
              className={INPUT_FIELD}
              value={permission}
              aria-label={t("grants.form.permission")}
              onChange={(event) => setPermission(event.target.value)}
            >
              <option value="">{t("grants.form.permissionPlaceholder")}</option>
              {PERMISSIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`permission.${key}`)}
                </option>
              ))}
            </select>
          )}
        </div>

        {error !== null && (
          <InlineNotice testId="grant-form-error" tone="error">
            {humanizeApiError(error, t)}
          </InlineNotice>
        )}
      </form>
    </Modal>
  );
}

interface RevokeGrantModalProps {
  grant: Grant;
  onClose: () => void;
  onRevoked: () => void;
}

function RevokeGrantModal({ grant, onClose, onRevoked }: RevokeGrantModalProps) {
  const { t } = useI18n();
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleRevoke = async () => {
    setIsRevoking(true);
    setError(null);
    try {
      await removeGrant(grant.id);
      onRevoked();
    } catch (err) {
      setError(err);
      setIsRevoking(false);
    }
  };

  return (
    <Modal
      testId="grant-remove-modal"
      title={t("grants.revoke.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" data-testid="grant-remove-cancel" className={BUTTON_SECONDARY} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" data-testid="grant-remove-confirm" className={BUTTON_PRIMARY} disabled={isRevoking} onClick={() => void handleRevoke()}>
            {t("grants.revoke.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-800">
        {t("grants.revoke.body", {
          what: getGrantWhatLabel(grant, t),
          subject: getGrantSubjectLabel(grant),
        })}
      </p>
      {error !== null && (
        <InlineNotice testId="grant-remove-error" tone="error">
          {humanizeApiError(error, t)}
        </InlineNotice>
      )}
    </Modal>
  );
}

export function AccessGrants() {
  const { t } = useI18n();
  const grants = useLoaded(listGrants);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Grant | null>(null);

  return (
    <section data-testid="access-grants" className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-gray-600">{t("grants.intro")}</p>
        <button type="button" data-testid="grant-create" className={`${BUTTON_PRIMARY} shrink-0`} onClick={() => setIsFormOpen(true)}>
          <Plus size={16} strokeWidth={1.5} />
          {t("grants.create")}
        </button>
      </div>

      {grants.error !== null && (
        <InlineNotice testId="grants-error" tone="error">
          {humanizeApiError(grants.error, t)}
        </InlineNotice>
      )}
      {grants.data !== null && grants.data.length === 0 && (
        <p data-testid="grants-empty" className="text-sm text-gray-500">
          {t("grants.empty")}
        </p>
      )}
      {grants.data !== null && grants.data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table data-testid="grants-table" className="w-full min-w-[40rem]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className={TABLE_HEAD_CELL}>{t("grants.column.subject")}</th>
                <th className={TABLE_HEAD_CELL}>{t("grants.column.what")}</th>
                <th className={TABLE_HEAD_CELL}>{t("grants.column.by")}</th>
                <th className={TABLE_HEAD_CELL}>{t("grants.column.when")}</th>
                <th className={TABLE_HEAD_CELL}>
                  <span className="sr-only">{t("grants.revokeLabel")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grants.data.map((grant) => (
                <tr key={grant.id} data-testid={`grant-row-${grant.id}`}>
                  <td className={TABLE_CELL}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1.5 text-gray-500" title={t(`grants.subject.${grant.subject_type}`)}>
                        <SubjectTypeIcon type={grant.subject_type} />
                      </span>
                      <span className="font-semibold text-gray-900">{getGrantSubjectLabel(grant)}</span>
                      {!grant.subject_missing && <span className="text-xs text-gray-500">{grant.subject_id}</span>}
                      {grant.subject_missing && (
                        <span data-testid={`grant-missing-${grant.id}`} className={`${CHIP} gap-1`}>
                          <TriangleAlert size={16} strokeWidth={1.5} />
                          {t(`grants.missing.${grant.subject_type}`)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={TABLE_CELL}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{getGrantWhatLabel(grant, t)}</span>
                      <span className={CHIP}>{grant.role_id === null ? t("grants.kind.permission") : t("grants.kind.role")}</span>
                    </div>
                  </td>
                  <td className={TABLE_CELL}>{grant.created_by}</td>
                  <td className={`${TABLE_CELL} whitespace-nowrap`}>{formatKst(grant.created_at)}</td>
                  <td className={`${TABLE_CELL} text-right`}>
                    <button
                      type="button"
                      data-testid={`grant-remove-${grant.id}`}
                      className={BUTTON_ICON}
                      aria-label={t("grants.revokeLabel")}
                      title={t("grants.revokeLabel")}
                      onClick={() => setRevokeTarget(grant)}
                    >
                      <Undo2 size={16} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <GrantFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={() => {
            setIsFormOpen(false);
            grants.reload();
          }}
        />
      )}
      {revokeTarget !== null && (
        <RevokeGrantModal
          grant={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null);
            grants.reload();
          }}
        />
      )}
    </section>
  );
}
