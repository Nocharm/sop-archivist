// 홈 = 묶음 목록 - 내가 멤버인 묶음을 최근 순으로 보이고, 권한이 있으면 새 묶음을 만든다. 워드마크와 로그인 복귀가 이리로 온다.
"use client";

import { FlaskConical, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NewBundleModal } from "@/components/new-bundle-modal";
import { LoadMoreRows } from "@/components/ui/load-more";
import { Truncate } from "@/components/ui/motion";
import { BundleStatusPill, RoleTag } from "@/components/status";
import { hasPermission } from "@/lib/access";
import { humanizeApiError } from "@/lib/api-errors";
import { listBundles, type LangProgress } from "@/lib/api-sop";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { useMe } from "@/lib/session";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";

const SKELETON_ROWS = 3;

function ProgressCell({ progress, testId }: { progress: LangProgress; testId: string }) {
  if (progress.total === 0) {
    return (
      <td className="num text-ink-4" data-testid={testId}>
        –
      </td>
    );
  }
  const percent = Math.round((progress.confirmed / progress.total) * 100);
  return (
    <td data-testid={testId}>
      <div className="flex items-center justify-end gap-2">
        <span className="tabular-nums">
          {progress.confirmed}
          <span className="text-ink-3">{` / ${progress.total}`}</span>
        </span>
        <span className="track w-16" aria-hidden>
          <i style={{ width: `${percent}%` }} />
        </span>
      </div>
    </td>
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

  return (
    <div className="dense min-h-full bg-surface">
      <div className="flex h-[52px] items-center justify-between gap-3 border-b border-line px-[var(--pad)]">
        <h1 className="page-title ul">{t("bundles.title")}</h1>
        {canCreate && (
          <button type="button" className="btn pri" data-testid="bundles-new" onClick={() => setCreating(true)}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            {t("bundles.new")}
          </button>
        )}
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
        <table className="dtable" data-testid="bundles-list">
          <thead>
            <tr>
              <th>{t("bundles.colTitle")}</th>
              <th>{t("bundles.colStatus")}</th>
              <th>{t("bundles.colRole")}</th>
              <th className="num">
                <span className="lg">KO</span> {t("bundles.colConfirmed")}
              </th>
              <th className="num">
                <span className="lg">EN</span> {t("bundles.colConfirmed")}
              </th>
              <th>{t("bundles.colUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {data === null
              ? showSkeleton &&
                Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} data-testid="bundles-skeleton">
                    {[220, 84, 56, 110, 110, 120].map((width, cell) => (
                      <td key={cell}>
                        <span className="sk h-5" style={{ width }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.visible.map((bundle) => (
                  <tr
                    key={bundle.id}
                    data-link=""
                    data-testid={`bundles-row-${bundle.id}`}
                    onClick={() => navigate(`/bundles/${bundle.id}`)}
                  >
                    <td>
                      <Link
                        href={`/bundles/${bundle.id}`}
                        data-testid={`bundles-link-${bundle.id}`}
                        className="inline-block max-w-[420px] align-middle font-semibold text-ink hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Truncate text={bundle.title} />
                      </Link>
                      {/* 합성 데이터는 목록에서도 합성으로 보인다 - 실제 묶음과 섞여 보이지 않게 */}
                      {bundle.is_synthetic && (
                        <span className="tag ml-2 align-middle" data-testid={`bundles-synthetic-${bundle.id}`}>
                          <FlaskConical size={12} strokeWidth={1.5} aria-hidden />
                          Synthetic data
                        </span>
                      )}
                    </td>
                    <td>
                      <BundleStatusPill status={bundle.status} />
                    </td>
                    <td>
                      <RoleTag role={bundle.my_role} />
                    </td>
                    <ProgressCell progress={bundle.progress.ko} testId={`bundles-ko-${bundle.id}`} />
                    <ProgressCell progress={bundle.progress.en} testId={`bundles-en-${bundle.id}`} />
                    <td className="whitespace-nowrap tabular-nums text-ink-2">{formatKst(bundle.updated_at)}</td>
                  </tr>
                ))}
            {data !== null && rows.hasMore && <LoadMoreRows sentinelRef={rows.sentinelRef} columns={6} testId="bundles-more" />}
          </tbody>
        </table>
      )}

      {creating && <NewBundleModal onClose={() => setCreating(false)} />}
    </div>
  );
}
