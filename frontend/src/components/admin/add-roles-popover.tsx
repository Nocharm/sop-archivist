// 대상 한 명에게 역할을 더하는 고르기 - 더하기 줄에 붙어 뜨고 화면을 어둡게 하지 않는다. 이미 받은 역할은 빼고, 여러 개를 골라 한 번에 준다.
"use client";

import { useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { Role } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui-classes";
import { useDismiss } from "@/lib/use-dismiss";

interface AddRolesPopoverProps {
  title: string;
  roles: readonly Role[];
  isSaving: boolean;
  onClose: () => void;
  onAdd: (roleIds: number[]) => void;
}

// 열리면 첫 역할에 초점 - 키보드로 A → 고르기 → Enter가 이어진다(콜백 ref가 처음 붙을 때 한 번)
function focusFirst(node: HTMLDivElement | null): void {
  node?.querySelector<HTMLElement>("input, button")?.focus();
}

export function AddRolesPopover({ title, roles, isSaving, onClose, onAdd }: AddRolesPopoverProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<readonly number[]>([]);
  useDismiss(ref, true, onClose);

  const toggle = (id: number) => setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  return (
    <div ref={ref} className="adm-pop" role="dialog" aria-label={title} data-testid="grant-add-pop">
      <div ref={focusFirst} className="adm-pop-body">
        <p className="adm-pop-title">{title}</p>
        {roles.length === 0 ? (
          <p className="adm-note" data-testid="grant-add-none">{t("grants.add.none")}</p>
        ) : (
          roles.map((role) => (
            <Checkbox
              key={role.id}
              testId={`grant-add-role-${role.id}`}
              className="adm-pop-opt"
              checked={picked.includes(role.id)}
              onChange={() => toggle(role.id)}
              label={
                <span className="adm-two">
                  <span className="adm-t1">{role.name}</span>
                  <span className="adm-t2">{role.permissions.length === 0 ? t("roles.noPermissions") : role.permissions.map((key) => t(`permission.${key}`)).join(" · ")}</span>
                </span>
              }
            />
          ))
        )}
      </div>
      <div className="adm-pop-foot">
        <button type="button" className={BUTTON_SECONDARY} data-testid="grant-add-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className={BUTTON_PRIMARY} data-testid="grant-add-save" disabled={picked.length === 0 || isSaving} onClick={() => onAdd([...picked])}>
          {isSaving ? t("common.saving") : t("grants.add.submit")}
        </button>
      </div>
    </div>
  );
}
