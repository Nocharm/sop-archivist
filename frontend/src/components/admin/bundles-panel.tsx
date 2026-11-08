// 관리 화면 - 모든 묶음의 메타(제목·상태·멤버·진행 건수)와 멤버 고치기. 내용은 싣지 않는다(백엔드 sop_admin.py).
// 활성 작성자가 없는 묶음은 "정리 필요"로 먼저 보이고, 그 묶음만 거르는 보기도 있다.
"use client";

import { Search, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MembersModal } from "@/components/manage/members-modal";
import { BundleStatusPill } from "@/components/status";
import { LoadMoreRows } from "@/components/ui/load-more";
import { Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { listAdminBundles, putAdminMembers, type AdminBundle } from "@/lib/api-manage";
import type { LangProgress } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";

function ProgressText({ progress }: { progress: LangProgress }) {
  if (progress.total === 0) return <span className="text-ink-4">–</span>;
  return (
    <span className="tabular-nums">
      {progress.confirmed}
      <span className="text-ink-3">{` / ${progress.total}`}</span>
    </span>
  );
}

export function BundlesPanel() {
  const { t, lang } = useI18n();
  const { data, error, isLoading, reload } = useLoaded(listAdminBundles);
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [editing, setEditing] = useState<AdminBundle | null>(null);
  const [overrides, setOverrides] = useState<Map<number, AdminBundle>>(new Map());

  const all = (data ?? []).map((bundle) => overrides.get(bundle.id) ?? bundle);
  const needle = query.trim().toLowerCase();
  const filtered = all
    .filter((bundle) => !onlyAttention || !bundle.has_active_author)
    .filter((bundle) => needle === "" || bundle.title.toLowerCase().includes(needle) || bundle.members.some((member) => member.login_id.includes(needle)));
  const attentionCount = all.filter((bundle) => !bundle.has_active_author).length;
  const rows = useProgressiveList(filtered, `${needle}:${onlyAttention}`);

  return (
    <div className="grid gap-4" data-testid="admin-bundles">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[260px] flex-1 items-center gap-2 rounded-md border border-line-2 bg-surface px-2">
          <Search size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none"
            placeholder={t("adminBundles.search")}
            value={query}
            data-testid="admin-bundles-search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`btn ${onlyAttention ? "pri" : ""}`}
          aria-pressed={onlyAttention}
          data-testid="admin-bundles-attention"
          onClick={() => setOnlyAttention((prev) => !prev)}
        >
          {t("adminBundles.attention", { n: attentionCount })}
        </button>
      </div>
      {error !== null && data === null ? (
        <p className="text-ink-2" data-testid="admin-bundles-error">
          {humanizeApiError(error, t)}{" "}
          <button type="button" className="btn ghost" onClick={reload}>
            {t("common.retry")}
          </button>
        </p>
      ) : data !== null && filtered.length === 0 ? (
        <p className="text-ink-3" data-testid="admin-bundles-empty">
          {t("adminBundles.empty")}
        </p>
      ) : (
        <div className="dense overflow-hidden rounded-lg border border-line bg-surface">
          <table className="dtable" data-testid="admin-bundles-list">
            <thead>
              <tr>
                <th>{t("bundles.colTitle")}</th>
                <th>{t("bundles.colStatus")}</th>
                <th>{t("overview.members")}</th>
                <th className="num">
                  <span className="lg">KO</span>
                </th>
                <th className="num">
                  <span className="lg">EN</span>
                </th>
                <th>{t("adminBundles.created")}</th>
                <th aria-label={t("manage.rowActions")} />
              </tr>
            </thead>
            <tbody>
              {data === null
                ? showSkeleton &&
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      {[220, 84, 200, 60, 60, 110, 32].map((width, cell) => (
                        <td key={cell}>
                          <span className="sk h-5" style={{ width }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.visible.map((bundle) => (
                    <tr key={bundle.id} data-testid={`admin-bundle-${bundle.id}`}>
                      <td className="max-w-[320px]">
                        <Link href={`/bundles/${bundle.id}`} className="block font-semibold text-ink hover:underline" data-testid={`admin-bundle-link-${bundle.id}`}>
                          <Truncate text={bundle.title} />
                        </Link>
                        {!bundle.has_active_author && <span className="pill danger mt-1">{t("adminBundles.noAuthor")}</span>}
                      </td>
                      <td>
                        <BundleStatusPill status={bundle.status} />
                      </td>
                      <td className="max-w-[280px]">
                        <Truncate
                          className="text-ink-2"
                          text={bundle.members.map((member) => `${getDisplayName(member, lang)} (${t(`role.${member.role}`)}${member.active ? "" : `, ${t("overview.noAccess")}`})`).join(", ")}
                        />
                      </td>
                      <td className="num">
                        <ProgressText progress={bundle.progress.ko} />
                      </td>
                      <td className="num">
                        <ProgressText progress={bundle.progress.en} />
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-ink-2">{formatKst(bundle.created_at)}</td>
                      <td className="w-10">
                        <span className="row-actions">
                          <button type="button" className="btn ghost h-7 px-2 text-xs" data-testid={`admin-bundle-members-${bundle.id}`} onClick={() => setEditing(bundle)}>
                            <Users size={14} strokeWidth={1.5} aria-hidden />
                            {t("members.manage")}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
              {data !== null && rows.hasMore && <LoadMoreRows sentinelRef={rows.sentinelRef} columns={7} testId="admin-bundles-more" />}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <MembersModal
          title={t("adminBundles.membersTitle", { title: editing.title })}
          members={editing.members}
          testId="admin-bundle-members-modal"
          onClose={() => setEditing(null)}
          onSave={async (members) => {
            const next = await putAdminMembers(editing.id, editing.revision, members);
            setOverrides((prev) => new Map(prev).set(next.id, next));
            showToast(t("common.saved"));
          }}
        />
      )}
    </div>
  );
}
