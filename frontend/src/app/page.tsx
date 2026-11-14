// 홈 = 묶음 목록 - 내가 멤버인 묶음을 최근 순으로 보이고, 권한이 있으면 새 묶음을 만든다. 워드마크와 로그인 복귀가 이리로 온다.
"use client";

import { FlaskConical, FolderOpen, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Truncate } from "@/components/ui/motion";
import { BundleStatusPill, RoleTag } from "@/components/status";
import { hasPermission } from "@/lib/access";
import { humanizeApiError } from "@/lib/api-errors";
import { getConfirmedPercent } from "@/lib/progress-model";
import { createBundle, listBundles, type BundleListItem, type RowProgress } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { useMe } from "@/lib/session";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { showToast } from "@/components/ui/toast";

const SKELETON_ROWS = 3;
const LIST_KEY = "bundles";

function ProgressValue({ progress }: { progress: RowProgress }) {
  if (progress.total === 0) return <span className="text-ink-4">–</span>;
  const percent = getConfirmedPercent(progress) ?? 0;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">
        {progress.confirmed}
        <span className="text-ink-3">{` / ${progress.total}`}</span>
      </span>
      <span className="track w-16" aria-hidden>
        <i style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

export default function BundleListPage() {
  const { t } = useI18n();
  const me = useMe();
  const { data, error, isLoading, reload } = useLoaded(listBundles);
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [creating, setCreating] = useState(false);

  // 이름을 묻지 않고 바로 만든다 - 이름 대신 순차 코드(BND-0013)가 보이고, 이름은 개요에서 나중에 붙인다
  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const bundle = await createBundle({});
      navigate(`/bundles/${bundle.id}`, { immediate: true });
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setCreating(false);
    }
  }
  const canCreate = hasPermission(me, "bundle.create");
  const rows = useProgressiveList(data ?? [], "bundles");
  const view = useListView(LIST_KEY);

  const columns: DataColumn<BundleListItem>[] = [
    {
      key: "title",
      header: t("bundles.colTitle"),
      card: "title",
      grow: true,
      minWidth: 240,
      skeletonWidth: 220,
      cell: (bundle) => (
        <span className="dl-title-row flex min-w-0 items-center gap-x-2 gap-y-1">
          <Link
            href={`/bundles/${bundle.id}`}
            data-testid={`bundles-link-${bundle.id}`}
            className="min-w-0 font-semibold text-ink hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="mr-2 font-mono text-[12px] text-ink-3" data-testid={`bundles-code-${bundle.id}`}>
              {bundle.code}
            </span>
            {bundle.title.trim() !== "" ? (
              <Truncate text={bundle.title} />
            ) : (
              <span className="block font-normal text-ink-3" data-testid={`bundles-untitled-${bundle.id}`}>
                {t("bundles.untitled")}
              </span>
            )}
          </Link>
          {/* 합성 데이터는 목록에서도 합성으로 보인다 - 실제 묶음과 섞여 보이지 않게 */}
          {bundle.is_synthetic && (
            <span className="tag flex-none" data-testid={`bundles-synthetic-${bundle.id}`}>
              <FlaskConical size={12} strokeWidth={1.5} aria-hidden />
              Synthetic data
            </span>
          )}
        </span>
      ),
    },
    { key: "status", header: t("bundles.colStatus"), card: "badge", nowrap: true, skeletonWidth: 84, cell: (bundle) => <BundleStatusPill status={bundle.status} /> },
    { key: "role", header: t("bundles.colRole"), card: "badge", nowrap: true, skeletonWidth: 56, cell: (bundle) => <RoleTag role={bundle.my_role} /> },
    {
      key: "confirmed",
      header: t("bundles.colConfirmed"),
      align: "end",
      nowrap: true,
      skeletonWidth: 110,
      cellTestId: (bundle) => `bundles-confirmed-${bundle.id}`,
      cell: (bundle) => <ProgressValue progress={bundle.progress} />,
    },
    {
      key: "updated",
      header: t("bundles.colUpdated"),
      nowrap: true,
      skeletonWidth: 120,
      cell: (bundle) => <span className="tabular-nums text-ink-2">{formatKst(bundle.updated_at)}</span>,
    },
  ];

  return (
    <div className="dense min-h-full bg-surface">
      <div className="flex h-[52px] items-center justify-between gap-3 border-b border-line px-[var(--pad)]">
        <h1 className="page-title ul">{t("bundles.title")}</h1>
        <div className="flex items-center gap-2">
          <ListViewToggle listKey={LIST_KEY} view={view} testId="bundles-view" />
          {canCreate && (
            <button type="button" className="btn pri" data-testid="bundles-new" disabled={creating} onClick={() => void handleCreate()}>
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              {t("bundles.new")}
            </button>
          )}
        </div>
      </div>

      {error !== null && data === null ? (
        <div data-testid="bundles-error" className="flex items-center gap-3 px-[var(--pad)] py-6 text-ink-2">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" data-testid="bundles-retry" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : data !== null && data.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          testId="bundles-empty"
          title={t("bundles.emptyTitle")}
          body={canCreate ? t("bundles.emptyCreate") : t("bundles.empty")}
          action={
            canCreate && (
              <button type="button" className="btn pri" data-testid="bundles-empty-new" disabled={creating} onClick={() => void handleCreate()}>
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                {t("bundles.new")}
              </button>
            )
          }
        />
      ) : (
        <DataList
          view={view}
          rows={data === null ? null : rows.visible}
          columns={columns}
          getRowKey={(bundle) => bundle.id}
          testId="bundles-list"
          rowTestId={(bundle) => `bundles-row-${bundle.id}`}
          onRowClick={(bundle) => navigate(`/bundles/${bundle.id}`)}
          hasRowLink
          showSkeleton={showSkeleton}
          skeletonRows={SKELETON_ROWS}
          more={{ hasMore: rows.hasMore, sentinelRef: rows.sentinelRef, testId: "bundles-more" }}
          cardMinWidth={380}
        />
      )}

    </div>
  );
}
