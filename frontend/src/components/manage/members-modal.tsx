// 묶음 멤버 고치기 - 사람을 찾아 작성자·검토자로 넣고, 역할을 바꾸고, 뺀다. 개요(작성자)와 관리 화면(묶음 관리 권한)이 같이 쓴다.
// 저장은 목록 통째 바꾸기(PUT members)라 화면에서 모은 뒤 한 번에 보낸다. 규칙(작성자 1명 이상, 자기 역할 잠금)은 서버가 판정한다.
"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { SubjectPicker, type PickedSubject } from "@/components/subject-picker";
import { BusyLabel, Collapse } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import type { MemberInput } from "@/lib/api-manage";
import type { BundleMember, MemberRole } from "@/lib/api-sop";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";

const ROLES: MemberRole[] = ["author", "reviewer"];

interface Row {
  login_id: string;
  role: MemberRole;
  label: string;
  active: boolean;
}

interface MembersModalProps {
  title: string;
  members: BundleMember[];
  testId: string;
  onSave: (members: MemberInput[]) => Promise<void>;
  onClose: () => void;
}

export function MembersModal({ title, members, testId, onSave, onClose }: MembersModalProps) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>(() =>
    members.map((member) => ({ login_id: member.login_id, role: member.role, label: getDisplayName(member, lang), active: member.active })),
  );
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PickedSubject | null>(null);
  const [pickedRole, setPickedRole] = useState<MemberRole>("reviewer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const changed =
    rows.length !== members.length || rows.some((row) => members.find((member) => member.login_id === row.login_id)?.role !== row.role);
  const authorCount = rows.filter((row) => row.role === "author").length;
  const roleOptions = ROLES.map((role) => ({ value: role, label: t(`role.${role}`) }));

  function addPicked() {
    if (!picked) return;
    setRows((prev) =>
      prev.some((row) => row.login_id === picked.id)
        ? prev.map((row) => (row.login_id === picked.id ? { ...row, role: pickedRole } : row))
        : [...prev, { login_id: picked.id, role: pickedRole, label: picked.label, active: true }],
    );
    setPicked(null);
    setAdding(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(rows.map((row) => ({ login_id: row.login_id, role: row.role })));
      onClose();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      testId={testId}
      footer={
        <>
          <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid={`${testId}-save`} disabled={!changed || saving || authorCount === 0} onClick={() => void handleSave()}>
            <BusyLabel busy={saving} label={t("common.save")} busyLabel={t("common.saving")} />
          </button>
        </>
      }
    >
      <ul className="grid gap-1" data-testid={`${testId}-list`}>
        {rows.map((row) => (
          <li key={row.login_id} className="hover-row grid grid-cols-[minmax(0,1fr)_140px_32px] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover" data-testid={`${testId}-row-${row.login_id}`}>
            <span className="min-w-0">
              <span className="block truncate">{row.label}</span>
              <small className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-ink-3">
                {row.login_id}
                {!row.active && <span className="pill danger">{t("overview.noAccess")}</span>}
              </small>
            </span>
            <Select
              testId={`${testId}-role-${row.login_id}`}
              ariaLabel={t("members.role")}
              size="sm"
              value={row.role}
              options={roleOptions}
              onChange={(role) => setRows((prev) => prev.map((item) => (item.login_id === row.login_id ? { ...item, role } : item)))}
            />
            {/* 마지막 칸(32px)은 아이콘만 - 라벨이 펼쳐지면 옆 역할 칸을 덮으므로 펼치지 않고 툴팁으로 설명한다 */}
            <Tooltip label={t("members.remove")} align="end">
              <button type="button" className="mbtn danger" aria-label={t("members.remove")} data-testid={`${testId}-remove-${row.login_id}`} onClick={() => setRows((prev) => prev.filter((item) => item.login_id !== row.login_id))}>
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      {authorCount === 0 && (
        <p className="text-[13px] text-danger" data-testid={`${testId}-no-author`}>
          {t("rule.no_active_author")}
        </p>
      )}
      {!adding && (
        <button type="button" className="btn ghost" data-testid={`${testId}-add`} onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.5} aria-hidden />
          {t("members.add")}
        </button>
      )}
      <Collapse open={adding}>
        <div className="grid gap-2 rounded-md border border-line p-3">
          <SubjectPicker testId={`${testId}-picker`} subjectType="user" value={picked} onChange={setPicked} allowLoginIdEntry />
          <div className="flex items-center gap-2">
            <Select testId={`${testId}-new-role`} ariaLabel={t("members.role")} value={pickedRole} options={roleOptions} onChange={setPickedRole} />
            <span className="flex-1" />
            <button type="button" className="btn ghost" data-testid={`${testId}-add-cancel`} onClick={() => setAdding(false)}>
              <X size={16} strokeWidth={1.5} aria-hidden />
              {t("common.cancel")}
            </button>
            <button type="button" className="btn" data-testid={`${testId}-add-confirm`} disabled={!picked} onClick={addPicked}>
              {t("members.addConfirm")}
            </button>
          </div>
        </div>
      </Collapse>
      {error !== null && (
        <p className="text-[13px] text-danger" data-testid={`${testId}-error`}>
          {humanizeApiError(error, t)}
        </p>
      )}
    </Modal>
  );
}
