// 역할을 받은 대상 - 겹친 머리글자 셋과 건수, 올리거나 초점이 가면 명단이 뜨고 부여 화면에서 그 역할로 거른다. 이름이 다 안 들어가는 자리라 머리글자 원을 쓴다.
"use client";

import { Building2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import type { Grant, Role } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { SubjectNames } from "@/lib/subject-label";

const AVATARS = 3;
const LISTED = 6;
const POP_WIDTH = 260;

interface RoleHoldersProps {
  role: Role;
  holders: readonly Grant[];
  names: SubjectNames;
  onOpenGrants: () => void;
}

export function RoleHolders({ role, holders, names, onOpenGrants }: RoleHoldersProps) {
  const { t } = useI18n();
  // 표 틀이 넘치는 자리를 자르므로 명단은 화면 기준 자리(fixed)에 그린다
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const label = t("roles.grantCount", { count: role.grant_count });
  const getName = (grant: Grant) => (grant.subject_missing ? grant.subject_id : names.get(grant.subject_type, grant.subject_id, grant.subject_name));

  const open = (element: Element) => {
    const box = element.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(box.left, window.innerWidth - POP_WIDTH - 8)), top: box.bottom });
  };
  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && pos !== null) {
      event.stopPropagation();
      setPos(null);
    }
  };

  if (holders.length === 0) return <span className="adm-t2">{label}</span>;
  return (
    <span
      className="adm-holders"
      onMouseEnter={(event) => open(event.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(event) => open(event.currentTarget)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPos(null);
      }}
      onKeyDown={handleKey}
    >
      <button type="button" className="adm-holders-btn" data-testid={`role-holders-${role.id}`} aria-label={`${role.name} · ${label}`} aria-expanded={pos !== null} onClick={onOpenGrants}>
        <span className="adm-avs" aria-hidden>
          {holders.slice(0, AVATARS).map((grant) => (
            <span key={grant.id} className="adm-av">
              {grant.subject_type === "dept" ? <Building2 size={11} strokeWidth={1.5} /> : (getName(grant)[0] ?? "")}
            </span>
          ))}
          {holders.length > AVATARS && <span className="adm-av more">+{holders.length - AVATARS}</span>}
        </span>
        <span className="adm-t2">{label}</span>
      </button>
      {pos !== null && (
        <span className="adm-holders-pop" style={{ left: pos.left, top: pos.top, width: POP_WIDTH }} data-testid={`role-holders-pop-${role.id}`}>
          <span className="adm-pop-inner">
            <span className="adm-pop-title">{role.name} · {label}</span>
            {holders.slice(0, LISTED).map((grant) => (
              <span key={grant.id} className="adm-holder">
                {grant.subject_type === "dept" && <Building2 size={13} strokeWidth={1.5} className="adm-dicon" aria-hidden />}
                <b>{getName(grant)}</b>
                <span className="adm-key">{grant.subject_id}</span>
              </span>
            ))}
            {holders.length > LISTED && <span className="adm-t2">{t("roles.holdersMore", { count: holders.length - LISTED })}</span>}
            <button type="button" className="adm-link" data-testid={`role-holders-open-${role.id}`} onClick={onOpenGrants}>
              {t("roles.holdersOpen")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
