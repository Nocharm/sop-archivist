// 부여 상세(오른쪽 칸) - 직접 받은 것, 부서로 받은 것, 유효 권한, 최근 변경. 고른 대상의 자료가 오기 전에는 이전 내용을 흐리게 둔 채 바꾸지 않는다.
"use client";

import { Building2, Plus, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";

import { AddRolesPopover } from "@/components/admin/add-roles-popover";
import { EffectivePermissions } from "@/components/admin/effective-permissions";
import { InlineNotice } from "@/components/inline-notice";
import { MorphButton } from "@/components/ui/morph-button";
import { buildAuditSummary, translateOrRaw } from "@/lib/admin-format";
import { getEffective, type AuditEvent, type EffectiveAccess, type Grant, type Role } from "@/lib/api";
import { humanizeApiError, type TFunc } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { splitSubjectKey } from "@/lib/grants-model";
import { useI18n } from "@/lib/i18n";
import type { SubjectDirectory } from "@/lib/use-subject-names";
import { useLoaded } from "@/lib/use-loaded";

const RECENT_EVENTS = 4;
const MEMBERS_SHOWN = 14;

/** 부여가 가리키는 것의 표시 이름 - 역할이면 역할 이름, 직접 부여면 권한 라벨 */
export function getGrantWhatLabel(grant: Pick<Grant, "role_name" | "permission">, t: TFunc): string {
  if (grant.role_name !== null) return grant.role_name;
  const key = grant.permission ?? "";
  return translateOrRaw(t, `permission.${key}`, key);
}

interface GrantDetailProps {
  subjectKey: string;
  /** 자료를 다시 받을 때 바꾼다(추가·회수 뒤) */
  version: number;
  grants: readonly Grant[];
  roles: readonly Role[];
  audit: readonly AuditEvent[];
  directory: SubjectDirectory;
  /** 방금 더한 부여 - 잠깐 칠해 알린다 */
  freshIds: ReadonlySet<number>;
  isAddOpen: boolean;
  isSaving: boolean;
  /** 고른 길이 마우스면 이전 내용을 흐리게 두고 부드럽게 바꾼다(키보드는 바로) */
  isSmooth: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  onAddRoles: (type: "user" | "dept", id: string, roleIds: number[]) => void;
  onRevoke: (grant: Grant) => void;
  onJump: (key: string) => void;
}

interface LoadedDetail {
  key: string;
  access: EffectiveAccess | null;
}

function GrantRow({ grant, role, isFresh, onRevoke }: { grant: Grant; role: Role | undefined; isFresh: boolean; onRevoke: () => void }) {
  const { t } = useI18n();
  const permissions = role ? role.permissions.map((key) => t(`permission.${key}`)).join(" · ") || t("roles.noPermissions") : t("grants.detail.directNote");
  return (
    <li className="adm-grant" data-fresh={isFresh ? "" : undefined} data-testid={`grant-row-${grant.id}`}>
      <span className="adm-two">
        <span className="adm-t1">
          {getGrantWhatLabel(grant, t)}
          {grant.role_id === null && <span className="adm-chip direct">{t("grants.kind.permission")}</span>}
        </span>
        <span className="adm-t2">{permissions}</span>
      </span>
      <span className="adm-meta">
        {grant.created_by} · {formatKst(grant.created_at).slice(0, 10)}
      </span>
      <MorphButton icon={Undo2} tone="danger" label={t("grants.revokeLabel")} testId={`grant-remove-${grant.id}`} onClick={onRevoke} />
    </li>
  );
}

export function GrantDetail(props: GrantDetailProps) {
  const { subjectKey, version, grants, roles, audit, directory, freshIds, isAddOpen, isSaving, isSmooth, onOpenAdd, onCloseAdd, onAddRoles, onRevoke, onJump } = props;
  const { t } = useI18n();
  const { id: wantedId, type: wantedType } = splitSubjectKey(subjectKey);
  const loaded = useLoaded<LoadedDetail>(
    () => (wantedType === "user" ? getEffective(wantedId).then((access) => ({ key: subjectKey, access })) : Promise.resolve({ key: subjectKey, access: null })),
    `${subjectKey}#${version}`,
  );
  const isError = loaded.error !== null;
  // 새 대상의 자료가 오기 전에는 앞 대상을 그대로 보인다 - 오류면 새 대상을 보이고 안내한다
  const shownKey = isError ? subjectKey : (loaded.data?.key ?? subjectKey);
  const access = loaded.data?.key === shownKey ? loaded.data.access : null;
  const isStale = shownKey !== subjectKey;
  const { type, id } = splitSubjectKey(shownKey);
  const [membersOpen, setMembersOpen] = useState(false);

  const direct = grants.filter((grant) => grant.subject_type === type && grant.subject_id === id);
  const held = new Set(direct.map((grant) => grant.role_id));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const missing = direct.some((grant) => grant.subject_missing);
  const name = missing ? id : directory.names.get(type, id, direct[0]?.subject_name ?? "");
  const dept = directory.names.getDept(type, id);
  const members = type === "dept" ? directory.people.filter((person) => person.dept_code === id) : [];
  const recent = audit.filter((event) => event.detail.subject_type === type && event.detail.subject_id === id).slice(0, RECENT_EVENTS);
  const inherited = new Map<string, { code: string; name: string; what: string }>();
  for (const [key, sources] of Object.entries(access?.sources ?? {})) {
    for (const source of sources) {
      if (source.kind !== "dept") continue;
      const what = source.role ?? translateOrRaw(t, `permission.${key}`, key);
      inherited.set(`${source.subject_id}/${what}`, { code: source.subject_id, name: directory.names.get("dept", source.subject_id, source.subject_name), what });
    }
  }
  const titleText = t("grants.add.title", { name });

  return (
    <div className="adm-detail-in" key={shownKey} data-testid="grant-detail" data-stale={isStale && isSmooth ? "" : undefined} data-smooth={isSmooth ? "" : undefined}>
      <header className="adm-detail-head">
        <span className="adm-two">
          <span className="adm-t1">
            {type === "dept" && <Building2 size={14} strokeWidth={1.5} className="adm-dicon" aria-hidden />}
            <span data-testid="grant-detail-name">{name}</span> <span className="adm-id">{id}</span>
          </span>
          <span className="adm-t2">
            {missing ? (
              <span className="inline-flex items-center gap-1 text-warn" data-testid="grant-detail-missing">
                <TriangleAlert size={14} strokeWidth={1.5} aria-hidden />
                {t(`grants.missing.${type}`)}
              </span>
            ) : type === "dept" ? (
              t("grants.detail.deptNote")
            ) : (
              dept || t("grants.detail.noDept")
            )}
          </span>
        </span>
      </header>

      <section className="adm-sect">
        <h3 className="adm-label">
          {t(type === "dept" ? "grants.detail.deptDirect" : "grants.detail.direct")} <span className="adm-c">{direct.length}</span>
        </h3>
        <ul className="adm-grants">
          {direct.map((grant) => (
            <GrantRow key={grant.id} grant={grant} role={grant.role_id === null ? undefined : roleById.get(grant.role_id)} isFresh={freshIds.has(grant.id)} onRevoke={() => onRevoke(grant)} />
          ))}
        </ul>
        {direct.length === 0 && <p className="adm-note">{t("grants.detail.directEmpty")}</p>}
        <div className="relative">
          <button type="button" className="adm-add" data-testid="grant-add" aria-haspopup="dialog" aria-expanded={isAddOpen} onClick={isAddOpen ? onCloseAdd : onOpenAdd} disabled={isStale}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            {t("grants.add.button")}
            <kbd>A</kbd>
          </button>
          {isAddOpen && !isStale && (
            <AddRolesPopover title={titleText} roles={roles.filter((role) => !held.has(role.id))} isSaving={isSaving} onClose={onCloseAdd} onAdd={(roleIds) => onAddRoles(type, id, roleIds)} />
          )}
        </div>
      </section>

      {type === "user" && inherited.size > 0 && (
        <section className="adm-sect">
          <h3 className="adm-label">
            {t("grants.detail.inherited")} <span className="adm-c">{inherited.size}</span>
          </h3>
          <ul className="adm-grants">
            {[...inherited.values()].map((item) => (
              <li key={`${item.code}/${item.what}`} className="adm-grant inherit" data-testid={`grant-inherited-${item.code}`}>
                <span className="adm-two">
                  <span className="adm-t1">{item.what}</span>
                  <span className="adm-t2">{t("grants.detail.fromDept", { name: item.name })}</span>
                </span>
                <button type="button" className="adm-link" data-testid={`grant-goto-${item.code}`} onClick={() => onJump(`dept:${item.code}`)}>
                  {t("grants.detail.viewDept")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {type === "dept" && members.length > 0 && (
        <section className="adm-sect">
          <h3 className="adm-label">
            {t("grants.detail.members")} <span className="adm-c">{members.length}</span>
          </h3>
          <div className="adm-members">
            {(membersOpen ? members : members.slice(0, MEMBERS_SHOWN)).map((person) => (
              <button key={person.login_id} type="button" className="adm-chip btn-like" data-testid={`grant-member-${person.login_id}`} onClick={() => onJump(`user:${person.login_id}`)}>
                {directory.names.get("user", person.login_id, person.name)}
              </button>
            ))}
            {members.length > MEMBERS_SHOWN && (
              <button type="button" className="adm-link" data-testid="grant-members-toggle" onClick={() => setMembersOpen((prev) => !prev)}>
                {membersOpen ? t("common.showLess") : t("grants.detail.moreMembers", { count: members.length - MEMBERS_SHOWN })}
              </button>
            )}
          </div>
        </section>
      )}

      {type === "user" && (
        <section className="adm-sect">
          <h3 className="adm-label">{t("grants.detail.effective")}</h3>
          {isError && (
            <InlineNotice testId="effective-error" tone="error">
              {humanizeApiError(loaded.error, t)}
            </InlineNotice>
          )}
          {access === null && !isError && <p className="adm-note">{t("effective.loading")}</p>}
          {access !== null && <EffectivePermissions access={access} />}
        </section>
      )}

      <section className="adm-sect">
        <h3 className="adm-label">{t("grants.detail.recent")}</h3>
        {recent.length === 0 ? (
          <p className="adm-note">{t("grants.detail.noRecent")}</p>
        ) : (
          <ul className="adm-recent" data-testid="grant-recent">
            {recent.map((event) => (
              <li key={event.id}>
                <span>{buildAuditSummary(event, t)}</span>
                <span className="adm-t2">
                  {event.actor} · {formatKst(event.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
