// 관리 > 권한 > 역할 - 역할 목록과 만들기·수정·삭제(삭제는 확인 모달). 부여가 남은 역할 삭제는 서버가 409로 막고 사람 말 문구로 보여 준다.
"use client";

import { Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { orderPermissions, PERMISSIONS } from "@/lib/access";
import { translateOrRaw } from "@/lib/admin-format";
import { createRole, deleteRole, listRoles, updateRole, type Role } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CHIP, INPUT_FIELD } from "@/lib/ui-classes";
import { Checkbox } from "@/components/ui/checkbox";
import { MorphButton } from "@/components/ui/morph-button";
import { showToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelTitle } from "@/components/admin/panel-title";
import { useLoaded } from "@/lib/use-loaded";

// 컬럼 길이와 같다(backend RoleName 100, description 500)
const ROLE_NAME_MAX = 100;
const ROLE_DESCRIPTION_MAX = 500;

interface RoleFormModalProps {
  /** null이면 새 역할 */
  role: Role | null;
  onClose: () => void;
  onSaved: () => void;
}

function RoleFormModal({ role, onClose, onSaved }: RoleFormModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const togglePermission = (key: string) => {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    const body = { name: name.trim(), description: description.trim(), permissions };
    try {
      if (role) await updateRole(role.id, body);
      else await createRole(body);
      showToast(t("common.saved"));
      onSaved();
    } catch (err) {
      setError(err);
      setIsSaving(false);
    }
  };

  const canSave = name.trim() !== "" && !isSaving;
  return (
    <Modal
      testId="role-form"
      title={role ? t("roles.form.editTitle") : t("roles.form.createTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" data-testid="role-form-cancel" className={BUTTON_SECONDARY} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="submit" form="role-form-element" data-testid="role-form-save" className={BUTTON_PRIMARY} disabled={!canSave}>
            {isSaving ? t("common.saving") : t("common.save")}
          </button>
        </>
      }
    >
      <form id="role-form-element" className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink-2">{t("roles.form.name")}</span>
          <input
            type="text"
            data-testid="role-form-name"
            className={INPUT_FIELD}
            value={name}
            maxLength={ROLE_NAME_MAX}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink-2">{t("roles.form.description")}</span>
          <textarea
            data-testid="role-form-description"
            className={`${INPUT_FIELD} h-20 py-1.5`}
            value={description}
            maxLength={ROLE_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-ink-2">{t("roles.form.permissions")}</legend>
          {/* 두 줄로 세운다 - 흘려 놓으면 좁은 창에서 이름과 옆 칸이 붙는다 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {PERMISSIONS.map((key) => (
              <Checkbox
                key={key}
                testId={`role-form-perm-${key}`}
                className="text-sm text-ink"
                checked={permissions.includes(key)}
                onChange={() => togglePermission(key)}
                label={t(`permission.${key}`)}
              />
            ))}
          </div>
        </fieldset>
        {role && <p className="text-xs text-ink-3">{t("roles.form.editNote")}</p>}
        {error !== null && (
          <InlineNotice testId="role-form-error" tone="error">
            {humanizeApiError(error, t)}
          </InlineNotice>
        )}
      </form>
    </Modal>
  );
}

interface DeleteRoleModalProps {
  role: Role;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteRoleModal({ role, onClose, onDeleted }: DeleteRoleModalProps) {
  const { t } = useI18n();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteRole(role.id);
      onDeleted();
    } catch (err) {
      setError(err);
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      testId="role-delete"
      size="sm"
      title={t("roles.delete.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" data-testid="role-delete-cancel" className={BUTTON_SECONDARY} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" data-testid="role-delete-confirm" className="btn danger" disabled={isDeleting} onClick={() => void handleDelete()}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            {t("common.delete")}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink">{t("roles.delete.body", { name: role.name })}</p>
      {error !== null && (
        <InlineNotice testId="role-delete-error" tone="error">
          {humanizeApiError(error, t)}
        </InlineNotice>
      )}
    </Modal>
  );
}

export function AccessRoles() {
  const { t } = useI18n();
  const roles = useLoaded(listRoles);
  // "new"는 새 역할 폼, Role은 그 역할의 수정 폼
  const [formTarget, setFormTarget] = useState<Role | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  return (
    <section data-testid="access-roles" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <PanelTitle title={t("admin.sub.roles")} info={t("roles.intro")} testId="roles-info" />
        <button type="button" data-testid="role-create" className={BUTTON_PRIMARY} onClick={() => setFormTarget("new")}>
          <Plus size={16} strokeWidth={1.5} />
          {t("roles.create")}
        </button>
      </div>

      {roles.error !== null && (
        <InlineNotice testId="roles-error" tone="error">
          {humanizeApiError(roles.error, t)}
        </InlineNotice>
      )}
      {roles.data !== null && roles.data.length === 0 && (
        <EmptyState icon={Users} testId="roles-empty" title={t("roles.empty")} compact />
      )}
      {roles.data !== null && roles.data.length > 0 && (
        <ul data-testid="roles-list" className="divide-y divide-line rounded-md border border-line">
          {roles.data.map((role) => (
            <li key={role.id} data-testid={`role-row-${role.id}`} className="flex items-start justify-between gap-4 px-3 py-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-semibold text-ink">{role.name}</span>
                  <span className="text-xs text-ink-3">{t("roles.grantCount", { count: role.grant_count })}</span>
                </div>
                {role.description && <p className="text-sm text-ink-2">{role.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {role.permissions.length === 0 ? (
                    <span className="text-xs text-ink-3">{t("roles.noPermissions")}</span>
                  ) : (
                    orderPermissions(role.permissions).map((key) => (
                      <span key={key} className={CHIP}>
                        {translateOrRaw(t, `permission.${key}`, key)}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <MorphButton icon={Pencil} label={t("common.edit")} testId={`role-edit-${role.id}`} onClick={() => setFormTarget(role)} />
                <MorphButton icon={Trash2} tone="danger" label={t("common.delete")} testId={`role-delete-${role.id}`} onClick={() => setDeleteTarget(role)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {formTarget !== null && (
        <RoleFormModal
          key={formTarget === "new" ? "new" : formTarget.id}
          role={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            roles.reload();
          }}
        />
      )}
      {deleteTarget !== null && (
        <DeleteRoleModal
          role={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            roles.reload();
          }}
        />
      )}
    </section>
  );
}
