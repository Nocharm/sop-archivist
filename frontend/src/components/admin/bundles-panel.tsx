// 관리 화면 - 모든 묶음의 메타(제목·상태·멤버·진행 건수)와 멤버 고치기. 내용은 싣지 않는다(백엔드 sop_admin.py).
// 활성 작성자가 없는 묶음은 "정리 필요"로 먼저 보이고, 그 묶음만 거르는 보기도 있다.
"use client";

import { FolderOpen, Search, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MembersModal } from "@/components/manage/members-modal";
import { BundleStatusPill } from "@/components/status";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { listAdminBundles, putAdminMembers, type AdminBundle } from "@/lib/api-manage";
import type { LangProgress } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { getBundleLabel } from "@/lib/bundle-label";

const LIST_KEY = "admin-bundles";

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
    .filter((bundle) => needle === "" || getBundleLabel(bundle).toLowerCase().includes(needle) || bundle.code.toLowerCase().includes(needle) || bundle.members.some((member) => member.login_id.includes(needle)));
  const attentionCount = all.filter((bundle) => !bundle.has_active_author).length;
  const rows = useProgressiveList(filtered, `${needle}:${onlyAttention}`);
  const view = useListView(LIST_KEY);

  const columns: DataColumn<AdminBundle>[] = [
    {
      key: "title",
      header: t("bundles.colTitle"),
      card: "title",
      grow: true,
      minWidth: 220,
      skeletonWidth: 220,
      cell: (bundle) => (
        <>
          <Link href={`/bundles/${bundle.id}`} className="block font-semibold text-ink hover:underline" data-testid={`admin-bundle-link-${bundle.id}`}>
            <span className="mr-2 font-mono text-[12px] text-ink-3">{bundle.code}</span>
            {bundle.title.trim() !== "" && <Truncate text={bundle.title} />}
          </Link>
          {!bundle.has_active_author && <span className="pill danger mt-1">{t("adminBundles.noAuthor")}</span>}
        </>
      ),
    },
    { key: "status", header: t("bundles.colStatus"), card: "badge", nowrap: true, skeletonWidth: 84, cell: (bundle) => <BundleStatusPill status={bundle.status} /> },
    {
      key: "members",
      header: t("overview.members"),
      card: "body",
      className: "max-w-[280px]",
      skeletonWidth: 200,
      cell: (bundle) => (
        <Truncate
          className="text-ink-2"
          text={bundle.members.map((member) => `${getDisplayName(member, lang)} (${t(`role.${member.role}`)}${member.active ? "" : `, ${t("overview.noAccess")}`})`).join(", ")}
        />
      ),
    },
    { key: "ko", header: <span className="lg">KO</span>, cardLabel: <span className="lg">KO</span>, align: "end", nowrap: true, skeletonWidth: 60, cell: (bundle) => <ProgressText progress={bundle.progress.ko} /> },
    { key: "en", header: <span className="lg">EN</span>, cardLabel: <span className="lg">EN</span>, align: "end", nowrap: true, skeletonWidth: 60, cell: (bundle) => <ProgressText progress={bundle.progress.en} /> },
    {
      key: "created",
      header: t("adminBundles.created"),
      nowrap: true,
      skeletonWidth: 110,
      cell: (bundle) => <span className="tabular-nums text-ink-2">{formatKst(bundle.created_at)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("manage.rowActions")}</span>,
      card: "actions",
      className: "w-10",
      skeletonWidth: 32,
      cell: (bundle) => (
        <span className="row-actions">
          <button type="button" className="btn ghost h-7 px-2 text-xs" data-testid={`admin-bundle-members-${bundle.id}`} onClick={() => setEditing(bundle)}>
            <Users size={14} strokeWidth={1.5} aria-hidden />
            {t("members.manage")}
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-4" data-testid="admin-bundles">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[260px] flex-1 items-center gap-2 rounded-md border border-line-2 bg-surface px-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
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
        <ListViewToggle listKey={LIST_KEY} view={view} testId="admin-bundles-view" />
      </div>
      {error !== null && data === null ? (
        <LoadError error={error} onRetry={reload} testId="admin-bundles" compact />
      ) : data !== null && filtered.length === 0 ? (
        <EmptyState icon={FolderOpen} testId="admin-bundles-empty" title={t("adminBundles.empty")} compact />
      ) : (
        <DataList
          view={view}
          rows={data === null ? null : rows.visible}
          columns={columns}
          getRowKey={(bundle) => bundle.id}
          testId="admin-bundles-list"
          rowTestId={(bundle) => `admin-bundle-${bundle.id}`}
          showSkeleton={showSkeleton}
          skeletonRows={5}
          more={{ hasMore: rows.hasMore, sentinelRef: rows.sentinelRef, testId: "admin-bundles-more" }}
          cardMinWidth={340}
          framed
        />
      )}
      {editing && (
        <MembersModal
          title={t("adminBundles.membersTitle", { title: getBundleLabel(editing) })}
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
