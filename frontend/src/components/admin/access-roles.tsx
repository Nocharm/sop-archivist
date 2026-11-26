// 관리 > 권한 > 역할 - 역할 × 권한 표에서 칸을 눌러 켜고 끈 뒤 아래 띠에서 저장한다(저장 전에 받은 대상 건수를 확인). 만들기·수정·삭제는 창. 부여가 남은 역할 삭제는 서버가 409로 막고 사람 말 문구로 보여 준다.
"use client";

import { Check, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { Modal } from "@/components/modal";
import { RoleFormModal } from "@/components/admin/role-form-modal";
import { RoleHolders } from "@/components/admin/role-holders";
import { PanelTitle } from "@/components/admin/panel-title";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { MorphButton } from "@/components/ui/morph-button";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { PERMISSIONS, type PermissionKey } from "@/lib/access";
import { deleteRole, listGrants, listRoles, updateRole, type Role } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { PERMISSION_GROUPS } from "@/lib/permission-groups";
import { applyRoleChanges, countHolders, isSameRole, toggleChange, type RoleChanges } from "@/lib/role-changes";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";
import { useSubjectDirectory } from "@/lib/use-subject-names";

const NO_CHANGES: RoleChanges = new Map();

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

export function AccessRoles({ onOpenGrants }: { onOpenGrants: (roleId: number) => void }) {
  const { t } = useI18n();
  const roles = useLoaded(listRoles);
  const grants = useLoaded(listGrants);
  const directory = useSubjectDirectory();
  // "new"는 새 역할 폼, Role은 그 역할의 수정 폼
  const [formTarget, setFormTarget] = useState<Role | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [changes, setChanges] = useState<RoleChanges>(NO_CHANGES);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const data = roles.data ?? [];
  const changedRoles = data.filter((role) => changes.has(role.id));
  const changedCells = changedRoles.reduce((sum, role) => sum + (changes.get(role.id)?.size ?? 0), 0);
  const affected = countHolders(changedRoles);

  const reload = () => {
    roles.reload();
    grants.reload();
  };

  const handleSave = async () => {
    setIsSaving(true);
    const left = new Map(changes);
    try {
      // 저장은 역할의 권한 전체를 바꿔 쓴다 - 그 사이 다른 사람이 고친 역할을 옛 값으로 덮지 않게, 직전에 다시 받아 같을 때만 쓴다
      const fresh = new Map((await listRoles()).map((role) => [role.id, role]));
      if (changedRoles.some((role) => !isSameRole(role, fresh.get(role.id)))) {
        showToast(t("roles.matrix.changedElsewhere"), "error");
        return;
      }
      for (const role of changedRoles) {
        await updateRole(role.id, { name: role.name, description: role.description, permissions: applyRoleChanges(role.permissions, changes.get(role.id)) });
        left.delete(role.id);
      }
      showToast(t("roles.matrix.saved", { count: changedRoles.length }));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      // 저장된 역할만 걷어 낸다 - 실패한 것은 띠에 남아 다시 누를 수 있다
      setChanges(left);
      setIsSaving(false);
      setIsConfirming(false);
      reload();
    }
  };

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
      {data.length > 0 && (
        <>
          <div className="adm-matrix-wrap">
            <table className="adm-matrix" data-testid="roles-list">
              <thead>
                <tr>
                  <th rowSpan={2} className="name">{t("roles.form.name")}</th>
                  {PERMISSION_GROUPS.map(({ group, keys }) => (
                    <th key={group} colSpan={keys.length} className="grp">
                      {t(`permissionGroup.${group}`)}
                    </th>
                  ))}
                  <th rowSpan={2}>{t("roles.matrix.holders")}</th>
                  <th rowSpan={2} className="act">
                    <span className="sr-only">{t("common.edit")}</span>
                  </th>
                </tr>
                <tr>
                  {PERMISSIONS.map((key) => (
                    <th key={key} className="perm">
                      <Tooltip label={t(`permission.${key}.hint`)}>
                        <span tabIndex={0}>{t(`permission.${key}`)}</span>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((role) => {
                  const pending = changes.get(role.id);
                  const held = applyRoleChanges(role.permissions, pending);
                  return (
                    <tr key={role.id} data-testid={`role-row-${role.id}`} data-changed={pending ? "" : undefined}>
                      <td className="name">
                        <span className="adm-two">
                          {/* 띄어쓰기 없는 긴 이름도 두 줄까지 - 전체 이름은 편집 창 · 칸 aria-label에 있다(감사 A11, 줄 140px 이하) */}
                          <span className="adm-t1"><span className="clamp-2">{role.name}</span></span>
                          {role.description && <span className="adm-t2 clamp-2">{role.description}</span>}
                        </span>
                      </td>
                      {PERMISSIONS.map((key: PermissionKey) => {
                        const isOn = held.includes(key);
                        return (
                          <td key={key} className="cell">
                            <button
                              type="button"
                              className="adm-cell"
                              aria-pressed={isOn}
                              aria-label={`${role.name} · ${t(`permission.${key}`)}`}
                              data-pending={pending?.has(key) ? "" : undefined}
                              data-testid={`role-cell-${role.id}-${key}`}
                              disabled={isSaving}
                              onClick={() => setChanges((prev) => toggleChange(prev, role, key))}
                            >
                              {isOn && <Check size={14} strokeWidth={2} aria-hidden />}
                              {/* 표를 글로 읽을 때(화면 낭독·검증) 켜진 칸의 권한 이름 */}
                              {isOn && <span className="sr-only">{t(`permission.${key}`)}</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td>
                        <RoleHolders role={role} holders={(grants.data ?? []).filter((grant) => grant.role_id === role.id)} names={directory.names} onOpenGrants={() => onOpenGrants(role.id)} />
                      </td>
                      <td className="act">
                        {/* 아이콘 단추 둘의 폭(32px × 2 + 사이 2px)을 고정해 라벨이 펼쳐져도 옆 칸이 밀리지 않게 한다 */}
                        <div className="mbtn-set w-[66px]">
                          <MorphButton icon={Pencil} label={t("common.edit")} testId={`role-edit-${role.id}`} onClick={() => setFormTarget(role)} />
                          <MorphButton icon={Trash2} tone="danger" label={t("common.delete")} testId={`role-delete-${role.id}`} onClick={() => setDeleteTarget(role)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {changedCells > 0 && (
            <div className="adm-bar" role="region" aria-label={t("roles.matrix.barLabel")} data-testid="roles-bar">
              <span data-testid="roles-bar-text">{t("roles.matrix.bar", { cells: changedCells, roles: changedRoles.length, holders: affected })}</span>
              <button type="button" className={BUTTON_SECONDARY} data-testid="roles-bar-drop" disabled={isSaving} onClick={() => setChanges(NO_CHANGES)}>
                <X size={16} strokeWidth={1.5} aria-hidden />
                {t("roles.matrix.drop")}
              </button>
              <button type="button" className={BUTTON_PRIMARY} data-testid="roles-bar-save" disabled={isSaving} onClick={() => setIsConfirming(true)}>
                {t("common.save")}
              </button>
            </div>
          )}
        </>
      )}

      {isConfirming && (
        <ConfirmModal
          testId="roles-save"
          title={t("roles.matrix.confirmTitle")}
          target={t("roles.matrix.confirmTarget", { holders: affected })}
          confirmLabel={t("common.save")}
          busy={isSaving}
          summary={
            <ul className="adm-recent text-left">
              {changedRoles.map((role) => (
                <li key={role.id}>
                  <span className="adm-t1">{role.name}</span>
                  <span className="adm-t2">{t("roles.grantCount", { count: role.grant_count })}</span>
                  <span className="adm-t2">
                    {[...(changes.get(role.id) ?? new Map<PermissionKey, boolean>())].map(([key, isOn]) => `${isOn ? "+" : "−"} ${t(`permission.${key}`)}`).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          }
          onConfirm={() => void handleSave()}
          onClose={() => setIsConfirming(false)}
        />
      )}
      {formTarget !== null && (
        <RoleFormModal
          key={formTarget === "new" ? "new" : formTarget.id}
          role={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            reload();
          }}
        />
      )}
      {deleteTarget !== null && (
        <DeleteRoleModal
          role={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
