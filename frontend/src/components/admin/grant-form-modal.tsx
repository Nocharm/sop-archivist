// 부여 추가 창 - 사람·부서를 고르고 역할이나 권한 하나를 준다(관리 > 권한 > 부여 머리의 단추).
"use client";

import { Building2, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { SubjectPicker, type PickedSubject } from "@/components/subject-picker";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { PERMISSIONS } from "@/lib/access";
import { addGrant, listRoles, type GrantInput, type SubjectType } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

const SUBJECT_TYPES: SubjectType[] = ["user", "dept"];

const SEGMENT_CLASS =
  "inline-flex h-8 items-center gap-1.5 border border-line-2 px-3 text-sm text-ink-2 first:rounded-l-md last:rounded-r-md hover:bg-sunken aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:font-semibold aria-pressed:text-ink";

function SubjectTypeIcon({ type }: { type: SubjectType }) {
  return type === "dept" ? <Building2 size={16} strokeWidth={1.5} /> : <UserRound size={16} strokeWidth={1.5} />;
}

interface GrantFormModalProps {
  onClose: () => void;
  /** 저장한 대상 - 목록이 그 줄을 고른다 */
  onSaved: (subjectType: SubjectType, subjectId: string) => void;
}

export function GrantFormModal({ onClose, onSaved }: GrantFormModalProps) {
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
      showToast(t("common.saved"));
      onSaved(subjectType, subject.id);
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
