// 역할 만들기·수정 창 - 권한은 갈래로 묶어 설명과 함께 고른다(관리 > 권한 > 역할).
"use client";

import { X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { showToast } from "@/components/ui/toast";
import { createRole, updateRole, type Role } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { PERMISSION_GROUPS } from "@/lib/permission-groups";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_FIELD } from "@/lib/ui-classes";

// 컬럼 길이와 같다(backend RoleName 100, description 500)
const ROLE_NAME_MAX = 100;
const ROLE_DESCRIPTION_MAX = 500;

interface RoleFormModalProps {
  /** null이면 새 역할 */
  role: Role | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RoleFormModal({ role, onClose, onSaved }: RoleFormModalProps) {
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
        <fieldset className="space-y-3">
          <legend className="pb-1.5 text-sm font-semibold text-ink-2">{t("roles.form.permissions")}</legend>
          {PERMISSION_GROUPS.map(({ group, keys }) => (
            <div key={group} className="space-y-1.5" role="group" aria-label={t(`permissionGroup.${group}`)}>
              <div className="adm-t2">{t(`permissionGroup.${group}`)}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {keys.map((key) => (
                  <Checkbox
                    key={key}
                    testId={`role-form-perm-${key}`}
                    className="items-start text-sm text-ink"
                    checked={permissions.includes(key)}
                    onChange={() => togglePermission(key)}
                    label={
                      <span className="adm-two">
                        <span>{t(`permission.${key}`)}</span>
                        <span className="adm-t2">{t(`permission.${key}.hint`)}</span>
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          ))}
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
