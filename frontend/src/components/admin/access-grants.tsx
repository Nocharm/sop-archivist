// 관리 > 권한 > 부여 - 사람·부서에 준 역할/권한 목록, 부여 추가(대상 선택기)와 회수(확인 모달). 대상이 사라진 부여는 지우지 않고 배지로 보여 사람이 정리하게 한다.
"use client";

import { Building2, KeyRound, Plus, TriangleAlert, Undo2, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { SubjectPicker, type PickedSubject } from "@/components/subject-picker";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { Select } from "@/components/ui/select";
import { PERMISSIONS } from "@/lib/access";
import { translateOrRaw } from "@/lib/admin-format";
import { addGrant, listGrants, listRoles, removeGrant, type Grant, type GrantInput, type SubjectType } from "@/lib/api";
import { humanizeApiError, type TFunc } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CHIP } from "@/lib/ui-classes";
import { useListView } from "@/lib/use-list-view";
import { MorphButton } from "@/components/ui/morph-button";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelTitle } from "@/components/admin/panel-title";
import { useLoaded } from "@/lib/use-loaded";

const SUBJECT_TYPES: SubjectType[] = ["user", "dept"];
const LIST_KEY = "admin-grants";

const SEGMENT_CLASS =
  "inline-flex h-8 items-center gap-1.5 border border-line-2 px-3 text-sm text-ink-2 first:rounded-l-md last:rounded-r-md hover:bg-sunken aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:font-semibold aria-pressed:text-ink";

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
            <X size={16} strokeWidth={1.5} aria-hidden />
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
          <span className="text-sm font-semibold text-ink-2">{t("grants.form.subjectType")}</span>
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
          <span className="text-sm font-semibold text-ink-2">{t("grants.form.subject")}</span>
          <SubjectPicker testId="grant-subject-picker" subjectType={subjectType} value={subject} onChange={setSubject} />
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-ink-2">{t("grants.form.what")}</span>
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
              <Select
                testId="grant-role-select"
                ariaLabel={t("grants.form.role")}
                className="w-full"
                value={roleId}
                options={[
                  { value: "", label: t("grants.form.rolePlaceholder") },
                  ...(roles.data ?? []).map((role) => ({ value: String(role.id), label: role.name })),
                ]}
                onChange={setRoleId}
              />
              {roles.data !== null && roles.data.length === 0 && (
                <p data-testid="grant-no-roles" className="text-xs text-ink-3">
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
            <Select
              testId="grant-permission-select"
              ariaLabel={t("grants.form.permission")}
              className="w-full"
              value={permission}
              options={[
                { value: "", label: t("grants.form.permissionPlaceholder") },
                ...PERMISSIONS.map((key) => ({ value: key, label: t(`permission.${key}`) })),
              ]}
              onChange={setPermission}
            />
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
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" data-testid="grant-remove-confirm" className="btn danger" disabled={isRevoking} onClick={() => void handleRevoke()}>
            <Undo2 size={16} strokeWidth={1.5} aria-hidden />
            {t("grants.revoke.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink">
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
  const view = useListView(LIST_KEY);

  const columns: DataColumn<Grant>[] = [
    {
      key: "subject",
      header: t("grants.column.subject"),
      card: "title",
      cell: (grant) => (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Tooltip label={t(`grants.subject.${grant.subject_type}`)}>
            <span className="inline-flex items-center gap-1.5 text-ink-3" role="img" aria-label={t(`grants.subject.${grant.subject_type}`)}>
              <SubjectTypeIcon type={grant.subject_type} />
            </span>
          </Tooltip>
          <span className="font-semibold text-ink">{getGrantSubjectLabel(grant)}</span>
          {!grant.subject_missing && <span className="text-xs font-normal text-ink-3">{grant.subject_id}</span>}
          {grant.subject_missing && (
            <span data-testid={`grant-missing-${grant.id}`} className={`${CHIP} gap-1`}>
              <TriangleAlert size={16} strokeWidth={1.5} />
              {t(`grants.missing.${grant.subject_type}`)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "what",
      header: t("grants.column.what"),
      card: "body",
      minWidth: 220,
      cell: (grant) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{getGrantWhatLabel(grant, t)}</span>
          <span className={CHIP}>{grant.role_id === null ? t("grants.kind.permission") : t("grants.kind.role")}</span>
        </div>
      ),
    },
    { key: "by", header: t("grants.column.by"), cell: (grant) => grant.created_by },
    { key: "when", header: t("grants.column.when"), nowrap: true, cell: (grant) => <span className="tabular-nums">{formatKst(grant.created_at)}</span> },
    {
      key: "revoke",
      header: <span className="sr-only">{t("grants.revokeLabel")}</span>,
      card: "actions",
      className: "text-right",
      cell: (grant) => (
        <MorphButton icon={Undo2} tone="danger" label={t("grants.revokeLabel")} testId={`grant-remove-${grant.id}`} onClick={() => setRevokeTarget(grant)} />
      ),
    },
  ];

  return (
    <section data-testid="access-grants" className="space-y-4">
      <div className="flex items-center gap-4">
        <PanelTitle title={t("admin.sub.grants")} info={t("grants.intro")} testId="grants-info" />
        <span className="flex-1" />
        <ListViewToggle listKey={LIST_KEY} view={view} testId="grants-view" />
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
        <EmptyState icon={KeyRound} testId="grants-empty" title={t("grants.empty")} compact />
      )}
      {grants.data !== null && grants.data.length > 0 && (
        <DataList
          view={view}
          rows={grants.data}
          columns={columns}
          getRowKey={(grant) => grant.id}
          testId="grants-table"
          rowTestId={(grant) => `grant-row-${grant.id}`}
          cardMinWidth={300}
          framed
        />
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
