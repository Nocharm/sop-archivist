// 관리 화면 - 권한별로 보이는 탭(권한 관리·직원 동기화·배치 작업·AI). 권한 없는 탭은 렌더하지 않고, 탭이 하나도 없으면 홈으로 보낸다.
"use client";

import { Activity, Bot, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AccessAudit } from "@/components/admin/access-audit";
import { AccessEffective } from "@/components/admin/access-effective";
import { AccessGrants } from "@/components/admin/access-grants";
import { AccessRoles } from "@/components/admin/access-roles";
import { AiPanel } from "@/components/admin/ai-panel";
import { BatchRunsPanel } from "@/components/admin/batch-runs-panel";
import { HrSyncPanel } from "@/components/admin/hr-sync-panel";
import { hasPermission, type PermissionKey } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/session";

type AdminTabKey = "access" | "directory" | "batch" | "ai";
type AccessSubKey = "roles" | "grants" | "audit" | "lookup";

interface AdminTab {
  key: AdminTabKey;
  permission: PermissionKey;
  Icon: LucideIcon;
}

// 화면 순서 = 탭 순서. 실제 차단은 각 API의 require_permission이 하고 여기서는 보이는 것만 거른다.
const ADMIN_TABS: AdminTab[] = [
  { key: "access", permission: "permission.manage", Icon: ShieldCheck },
  { key: "directory", permission: "directory.sync", Icon: RefreshCw },
  { key: "batch", permission: "system.view", Icon: Activity },
  { key: "ai", permission: "ai.admin", Icon: Bot },
];

const ACCESS_SUBS: AccessSubKey[] = ["roles", "grants", "audit", "lookup"];

const TAB_CLASS =
  "inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-gray-600 hover:text-gray-900 aria-selected:border-accent aria-selected:font-semibold aria-selected:text-gray-900";

function AccessSection() {
  const { t } = useI18n();
  const [sub, setSub] = useState<AccessSubKey>("roles");

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex gap-1 rounded-md bg-gray-100 p-1">
        {ACCESS_SUBS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={sub === key}
            data-testid={`access-sub-${key}`}
            className="h-8 rounded px-3 text-sm text-gray-600 hover:text-gray-900 aria-selected:bg-white aria-selected:font-semibold aria-selected:text-gray-900 aria-selected:shadow-sm"
            onClick={() => setSub(key)}
          >
            {t(`admin.sub.${key}`)}
          </button>
        ))}
      </div>
      {sub === "roles" && <AccessRoles />}
      {sub === "grants" && <AccessGrants />}
      {sub === "audit" && <AccessAudit />}
      {sub === "lookup" && <AccessEffective />}
    </div>
  );
}

function AdminContent() {
  const { t } = useI18n();
  const me = useMe();
  const router = useRouter();
  const searchParams = useSearchParams();

  const allowedTabs = ADMIN_TABS.filter((tab) => hasPermission(me, tab.permission));
  // 숨겨진 탭을 가리키는 딥링크(?tab=)는 허용된 첫 탭으로 떨어진다
  const activeTab = allowedTabs.find((tab) => tab.key === searchParams.get("tab")) ?? allowedTabs[0];

  useEffect(() => {
    if (allowedTabs.length === 0) router.replace("/");
  }, [allowedTabs.length, router]);

  if (!activeTab) return null;

  // 주소만 바꾼다(서버 왕복 없이 useSearchParams가 따라온다) - 새로고침·링크 공유에서 같은 탭이 열린다
  const selectTab = (key: AdminTabKey) => {
    window.history.replaceState(null, "", `/admin?tab=${key}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900">{t("nav.admin")}</h1>
      <div role="tablist" className="flex gap-1 border-b border-gray-200">
        {allowedTabs.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab.key === key}
            data-testid={`admin-tab-${key}`}
            className={TAB_CLASS}
            onClick={() => selectTab(key)}
          >
            <Icon size={16} strokeWidth={1.5} />
            {t(`admin.tab.${key}`)}
          </button>
        ))}
      </div>
      {/* 사용자를 바꾸거나 탭을 옮기면 패널을 새로 마운트해 이전 사용자의 데이터·오류가 남지 않게 한다 */}
      <div key={`${me.login_id}:${activeTab.key}`} role="tabpanel" data-testid={`admin-panel-${activeTab.key}`}>
        {activeTab.key === "access" && <AccessSection />}
        {activeTab.key === "directory" && <HrSyncPanel />}
        {activeTab.key === "batch" && <BatchRunsPanel />}
        {activeTab.key === "ai" && <AiPanel />}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminContent />
    </Suspense>
  );
}
