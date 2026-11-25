// 관리 > 권한 > 부여 - 왼쪽은 대상 목록(찾기·종류·역할 거르기, 30개씩 이어 그림), 오른쪽은 고른 대상의 받은 것·유효 권한·최근 변경. 부여가 없는 직원과 직원 목록에 없는 로그인 ID도 찾아서 조회한다.
"use client";

import { Building2, KeyRound, Plus, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { GrantDetail, getGrantWhatLabel } from "@/components/admin/grant-detail";
import { GrantAiModal } from "@/components/admin/grant-ai-modal";
import { GrantFormModal } from "@/components/admin/grant-form-modal";
import { PanelTitle } from "@/components/admin/panel-title";
import { InlineNotice } from "@/components/inline-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { useFlip } from "@/components/ui/motion";
import { batchGrants, listAudit, listGrants, listRoles, removeGrant, type Grant, type GrantInput, type SubjectType } from "@/lib/api";
import { humanizeApiError, type TFunc } from "@/lib/api-errors";
import { getSubjectKey, listGrantedSubjects, listSubjects, type GrantSubject, type SubjectFilter } from "@/lib/grants-model";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useSubjectDirectory } from "@/lib/use-subject-names";

const PAGE = 30;
const FILTERS: SubjectFilter[] = ["all", "user", "dept"];
// 최근 변경에 쓰는 기록 수 - 서버 상한(500)
const AUDIT_LIMIT = 500;
const REVOKE_UNDO_MS = 5000;
const NO_FRESH: ReadonlySet<number> = new Set();

function getGroupLabel(row: GrantSubject, t: TFunc): string {
  return t(`grants.group.${row.group}`);
}

function buildUndoInput(grant: Grant): GrantInput {
  const base = { subject_type: grant.subject_type, subject_id: grant.subject_id };
  return grant.role_id === null ? { ...base, permission: grant.permission ?? "" } : { ...base, role_id: grant.role_id };
}

/** initialRole - 역할 표에서 넘어오면 그 역할로 거른 채 연다(빈 글이면 거르지 않음) */
export function AccessGrants({ initialRole }: { initialRole: string }) {
  const { t, lang } = useI18n();
  const grants = useLoaded(listGrants);
  const roles = useLoaded(listRoles);
  const audit = useLoaded(() => listAudit(AUDIT_LIMIT));
  const directory = useSubjectDirectory();
  const listRef = useRef<HTMLDivElement>(null);
  const { capture } = useFlip(listRef);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<SubjectFilter>("all");
  const [roleId, setRoleId] = useState(initialRole);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [isSmooth, setIsSmooth] = useState(false);
  const [version, setVersion] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(NO_FRESH);

  const data = grants.data ?? [];
  const query = { text, filter, roleId: roleId === "" ? null : Number(roleId) };
  const sources = { grants: data, people: directory.people, departments: directory.departments, names: directory.names, lang, getWhat: (grant: Grant) => getGrantWhatLabel(grant, t) };
  const rows = listSubjects(sources, query);
  const allSubjects = listGrantedSubjects({ grants: data, names: directory.names });
  const counts = { all: allSubjects.length, user: allSubjects.filter((row) => row.type === "user").length, dept: allSubjects.filter((row) => row.type === "dept").length };
  const { visible, hasMore, sentinelRef } = useProgressiveList(rows, `${text}|${filter}|${roleId}`, { pageSize: PAGE });
  // 고른 대상은 거르기에서 빠져도 오른쪽에 남는다 - 처음에는 첫 줄
  const current = selKey ?? allSubjects[0]?.key ?? null;

  // 목록이 바뀌기 전 줄 자리를 잰다 - 남은 줄은 새 자리로 미끄러진다
  const refilter = (apply: () => void) => {
    capture(visible.map((row) => row.key));
    if (listRef.current) listRef.current.scrollTop = 0;
    apply();
  };

  const select = (key: string, via: "pointer" | "key") => {
    if (key === current) return;
    setIsSmooth(via === "pointer");
    setIsAddOpen(false);
    setSelKey(key);
  };

  const handleListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "a" || event.key === "A") {
      if (!event.metaKey && !event.ctrlKey && !event.altKey && current !== null) {
        event.preventDefault();
        setIsAddOpen(true);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const at = visible.findIndex((row) => row.key === current);
    const next = visible[Math.max(0, Math.min(visible.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    select(next.key, "key");
    listRef.current?.querySelector(`[data-flip-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const reloadAll = () => {
    grants.reload();
    roles.reload();
    audit.reload();
    setVersion((count) => count + 1);
  };

  const handleAddRoles = async (type: SubjectType, id: string, roleIds: number[]) => {
    setIsSaving(true);
    try {
      const result = await batchGrants({ add: roleIds.map((role_id) => ({ subject_type: type, subject_id: id, role_id })) });
      setFreshIds(new Set(result.added.map((grant) => grant.id)));
      setSelKey(getSubjectKey(type, id));
      setIsAddOpen(false);
      if (result.unknown.length > 0) showToast(t("grants.add.unknown"), "error");
      else showToast(t("grants.add.done", { count: result.added.length }));
      reloadAll();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevoke = async (grant: Grant) => {
    try {
      await removeGrant(grant.id);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      return;
    }
    // 회수로 부여가 0이 되면 목록에서 빠져도 오른쪽은 그 대상에 머문다(되돌리기가 그 자리에서 보이게)
    setSelKey(getSubjectKey(grant.subject_type, grant.subject_id));
    const what = getGrantWhatLabel(grant, t);
    const name = grant.subject_missing ? grant.subject_id : directory.names.get(grant.subject_type, grant.subject_id, grant.subject_name);
    reloadAll();
    showToast(t("grants.revoke.done", { what, subject: name }), "ok", {
      durationMs: REVOKE_UNDO_MS,
      action: {
        label: t("common.undo"),
        run: () => {
          void batchGrants({ add: [buildUndoInput(grant)] }).then(
            (result) => {
              if (result.unknown.length > 0) showToast(t("grants.revoke.undoFailed", { subject: name }), "error");
              setFreshIds(new Set(result.added.map((item) => item.id)));
              reloadAll();
            },
            (err: unknown) => showToast(humanizeApiError(err, t), "error"),
          );
        },
      },
    });
  };

  const handleJump = (key: string) => {
    refilter(() => {
      setText("");
      setFilter("all");
      setRoleId("");
    });
    select(key, "pointer");
  };

  const hasGrants = grants.data !== null && grants.data.length > 0;
  const groupCounts = rows.reduce((map, row) => map.set(row.group, (map.get(row.group) ?? 0) + 1), new Map<string, number>());

  return (
    <section data-testid="access-grants" className="space-y-3">
      <div className="flex items-center gap-4">
        <PanelTitle title={t("admin.sub.grants")} info={t("grants.intro")} testId="grants-info" />
        <span className="adm-note" data-testid="grants-summary">
          {t("grants.summary", { subjects: allSubjects.length, grants: data.length, roles: roles.data?.length ?? 0 })}
        </span>
        <span className="flex-1" />
        <button type="button" data-testid="grant-ai-open" className={`${BUTTON_SECONDARY} shrink-0`} onClick={() => setIsAiOpen(true)}>
          <Sparkles size={16} strokeWidth={1.5} />
          {t("grants.ai.open")}
        </button>
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
      {grants.data !== null && !hasGrants && <EmptyState icon={KeyRound} testId="grants-empty" title={t("grants.empty")} compact />}

      {grants.data !== null && (
      <div className="adm-split">
        <div className="adm-master">
          <label className="adm-search">
            <Search size={14} strokeWidth={1.5} aria-hidden />
            <input
              type="text"
              data-testid="grants-search"
              value={text}
              maxLength={200}
              placeholder={t("grants.search")}
              aria-label={t("grants.search")}
              onChange={(event) => refilter(() => setText(event.target.value))}
            />
          </label>
          <div className="adm-filters">
            <span className="adm-pills" role="group" aria-label={t("grants.filter.label")}>
              {FILTERS.map((key) => (
                <button key={key} type="button" className="adm-pill" aria-pressed={filter === key} data-testid={`grants-filter-${key}`} onClick={() => refilter(() => setFilter(key))}>
                  {t(`grants.filter.${key}`)} <b>{counts[key]}</b>
                </button>
              ))}
            </span>
            <span className="flex-1" />
            <Select
              testId="grants-role-filter"
              ariaLabel={t("grants.filter.role")}
              size="sm"
              value={roleId}
              options={[{ value: "", label: t("grants.filter.allRoles") }, ...(roles.data ?? []).map((role) => ({ value: String(role.id), label: role.name }))]}
              onChange={(value) => refilter(() => setRoleId(value))}
            />
          </div>
          <div
            ref={listRef}
            className="adm-list"
            tabIndex={0}
            role="listbox"
            aria-label={t("grants.listLabel")}
            data-testid="grants-table"
            onKeyDown={handleListKey}
          >
            {visible.map((row, index) => (
              <div key={row.key} className="contents">
                {(index === 0 || visible[index - 1].group !== row.group) && (
                  <div className="adm-group" data-testid={`grants-group-${row.group}`}>
                    {getGroupLabel(row, t)} <b>{groupCounts.get(row.group)}</b>
                  </div>
                )}
                <div
                  className="adm-row"
                  role="option"
                  data-flip-key={row.key}
                  data-testid={`grants-subject-${row.key}`}
                  aria-selected={current === row.key}
                  data-raw={row.group === "raw" ? "" : undefined}
                  onClick={() => select(row.key, "pointer")}
                >
                  <span className="adm-two">
                    <span className="adm-t1">
                      {row.type === "dept" && <Building2 size={13} strokeWidth={1.5} className="adm-dicon" aria-hidden />}
                      {row.group === "raw" ? t("picker.lookupLoginId", { id: row.id }) : row.name}
                      {row.isMissing && (
                        <span className="inline-flex text-warn" aria-hidden>
                          <TriangleAlert size={13} strokeWidth={1.5} />
                        </span>
                      )}
                    </span>
                    {row.group !== "raw" && (
                      <span className="adm-t2">
                        <span className="adm-key">{row.id}</span>
                        {row.isMissing ? (
                          <span className="text-warn" data-testid={`grant-missing-${row.key}`}>
                            {" · "}
                            {t(`grants.missing.${row.type}`)}
                          </span>
                        ) : (
                          (row.dept || row.type === "dept") && <> · {row.dept || t("grants.subject.dept")}</>
                        )}
                      </span>
                    )}
                  </span>
                  {row.group !== "raw" && (
                    <span className="adm-count" data-zero={row.count === 0 ? "" : undefined} data-testid={`grant-count-${row.key}`}>
                      {row.count}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} className="adm-more" data-testid="grants-more" aria-hidden />}
            {rows.length === 0 && grants.data !== null && <p className="adm-note adm-nomatch" data-testid="grants-no-match">{t("grants.noMatch")}</p>}
          </div>
          <div className="adm-listfoot">
            <span data-testid="grants-shown">{t("grants.shown", { shown: visible.length, total: rows.length })}</span>
            <span>{t("grants.keysHint")}</span>
          </div>
        </div>
        <div className="adm-detail">
          {current === null ? (
            <p className="adm-note">{t("grants.detail.none")}</p>
          ) : (
            <GrantDetail
              subjectKey={current}
              version={version}
              grants={data}
              roles={roles.data ?? []}
              audit={audit.data ?? []}
              directory={directory}
              freshIds={freshIds}
              isAddOpen={isAddOpen}
              isSaving={isSaving}
              isSmooth={isSmooth}
              onOpenAdd={() => setIsAddOpen(true)}
              onCloseAdd={() => setIsAddOpen(false)}
              onAddRoles={(type, id, roleIds) => void handleAddRoles(type, id, roleIds)}
              onRevoke={(grant) => void handleRevoke(grant)}
              onJump={handleJump}
            />
          )}
        </div>
      </div>

      )}

      {isAiOpen && (
        <GrantAiModal
          grants={data}
          roleNames={new Map((roles.data ?? []).map((role) => [role.id, role.name]))}
          onClose={() => setIsAiOpen(false)}
          onSaved={() => {
            setIsAiOpen(false);
            reloadAll();
          }}
        />
      )}
      {isFormOpen && (
        <GrantFormModal
          onClose={() => setIsFormOpen(false)}
          onSaved={(type, id) => {
            setIsFormOpen(false);
            reloadAll();
            setSelKey(getSubjectKey(type, id));
          }}
        />
      )}
    </section>
  );
}
