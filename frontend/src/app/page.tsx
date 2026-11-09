// 홈 = 묶음 목록 - 내가 멤버인 묶음을 최근 순으로 보이고, 권한이 있으면 새 묶음을 만든다. 워드마크와 로그인 복귀가 이리로 온다.
"use client";

import { FlaskConical, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NewBundleModal } from "@/components/new-bundle-modal";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { Truncate } from "@/components/ui/motion";
import { BundleStatusPill, RoleTag } from "@/components/status";
import { hasPermission } from "@/lib/access";
import { humanizeApiError } from "@/lib/api-errors";
import { listBundles, type BundleListItem, type LangProgress } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { useMe } from "@/lib/session";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";

const SKELETON_ROWS = 3;
const LIST_KEY = "bundles";

function ProgressValue({ progress }: { progress: LangProgress }) {
  if (progress.total === 0) return <span className="text-ink-4">–</span>;
  const percent = Math.round((progress.confirmed / progress.total) * 100);
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
            <Truncate text={bundle.title} />
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
      key: "ko",
      header: (
        <>
          <span className="lg">KO</span> {t("bundles.colConfirmed")}
        </>
      ),
      align: "end",
      nowrap: true,
      skeletonWidth: 110,
      cellTestId: (bundle) => `bundles-ko-${bundle.id}`,
      cell: (bundle) => <ProgressValue progress={bundle.progress.ko} />,
    },
    {
      key: "en",
      header: (
        <>
          <span className="lg">EN</span> {t("bundles.colConfirmed")}
        </>
      ),
      align: "end",
      nowrap: true,
      skeletonWidth: 110,
      cellTestId: (bundle) => `bundles-en-${bundle.id}`,
      cell: (bundle) => <ProgressValue progress={bundle.progress.en} />,
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
            <button type="button" className="btn pri" data-testid="bundles-new" onClick={() => setCreating(true)}>
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
        <p data-testid="bundles-empty" className="px-[var(--pad)] py-6 text-ink-3">
          {canCreate ? t("bundles.emptyCreate") : t("bundles.empty")}
        </p>
      ) : (
        <DataList
          view={view}
          rows={data === null ? null : rows.visible}
          columns={columns}
          getRowKey={(bundle) => bundle.id}
          testId="bundles-list"
          rowTestId={(bundle) => `bundles-row-${bundle.id}`}
          onRowClick={(bundle) => navigate(`/bundles/${bundle.id}`)}
          showSkeleton={showSkeleton}
          skeletonRows={SKELETON_ROWS}
          more={{ hasMore: rows.hasMore, sentinelRef: rows.sentinelRef, testId: "bundles-more" }}
          cardMinWidth={380}
        />
      )}

      {creating && <NewBundleModal onClose={() => setCreating(false)} />}
    </div>
  );
}
