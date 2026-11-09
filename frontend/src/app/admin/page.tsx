// 관리 화면 - 왼쪽 세로 메뉴(권한 아래 역할·부여·기록·조회를 펼쳐 둔다)와 오른쪽 본문. 권한 없는 탭은 렌더하지 않고, 탭이 하나도 없으면 홈으로 보낸다.
"use client";

import { Activity, Bot, FolderKanban, RefreshCw, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AccessAudit } from "@/components/admin/access-audit";
import { AccessEffective } from "@/components/admin/access-effective";
import { AccessGrants } from "@/components/admin/access-grants";
import { AccessRoles } from "@/components/admin/access-roles";
import { AiPanel } from "@/components/admin/ai-panel";
import { BatchRunsPanel } from "@/components/admin/batch-runs-panel";
import { BundlesPanel } from "@/components/admin/bundles-panel";
import { GuidelinesPanel } from "@/components/admin/guidelines-panel";
import { HrSyncPanel } from "@/components/admin/hr-sync-panel";
import { hasPermission, type PermissionKey } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/session";

type AdminTabKey = "access" | "directory" | "batch" | "ai" | "bundles" | "guidelines";
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
  { key: "bundles", permission: "bundle.admin", Icon: FolderKanban },
  { key: "guidelines", permission: "guideline.manage", Icon: ScrollText },
];

const ACCESS_SUBS: AccessSubKey[] = ["roles", "grants", "audit", "lookup"];

function AccessPanel({ sub }: { sub: AccessSubKey }) {
  return (
    <>
      {sub === "roles" && <AccessRoles />}
      {sub === "grants" && <AccessGrants />}
      {sub === "audit" && <AccessAudit />}
      {sub === "lookup" && <AccessEffective />}
    </>
  );
}

function AdminContent() {
  const { t } = useI18n();
  const me = useMe();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sub, setSub] = useState<AccessSubKey>("roles");

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

  // 권한 하위 항목을 누르면 권한 탭으로 옮기면서 그 항목을 연다
  const selectSub = (key: AccessSubKey) => {
    setSub(key);
    if (activeTab.key !== "access") selectTab("access");
  };

  return (
    <div className="flex min-h-full flex-col bg-surface">
      <div className="flex h-[52px] shrink-0 items-center border-b border-line px-[var(--pad)]">
        <h1 className="page-title ul">{t("nav.admin")}</h1>
      </div>
      <div className="grid flex-1 grid-cols-[208px_minmax(0,1fr)]">
        {/* 세로 탭 - 식별자(admin-tab-*·access-sub-*)와 ?tab= 주소는 이전 가로 탭과 같다 */}
        <div className="border-r border-line">
          <div role="tablist" aria-orientation="vertical" aria-label={t("nav.admin")} className="side-nav">
            {allowedTabs.map(({ key, Icon }) => (
              <div key={key} className="grid gap-px">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab.key === key}
                  data-testid={`admin-tab-${key}`}
                  className="side-nav-item"
                  onClick={() => selectTab(key)}
                >
                  <Icon size={16} strokeWidth={1.5} aria-hidden />
                  {t(`admin.tab.${key}`)}
                </button>
                {key === "access" &&
                  ACCESS_SUBS.map((subKey) => (
                    <button
                      key={subKey}
                      type="button"
                      role="tab"
                      aria-selected={activeTab.key === "access" && sub === subKey}
                      data-testid={`access-sub-${subKey}`}
                      className="side-nav-item sub"
                      onClick={() => selectSub(subKey)}
                    >
                      {t(`admin.sub.${subKey}`)}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
        {/* 사용자를 바꾸거나 탭을 옮기면 패널을 새로 마운트해 이전 사용자의 데이터·오류가 남지 않게 한다 */}
        <div
          key={`${me.login_id}:${activeTab.key}:${activeTab.key === "access" ? sub : ""}`}
          className="fade-in min-w-0 px-6 py-5"
          role="tabpanel"
          data-testid={`admin-panel-${activeTab.key}`}
        >
          {activeTab.key === "access" && <AccessPanel sub={sub} />}
          {activeTab.key === "directory" && <HrSyncPanel />}
          {activeTab.key === "batch" && <BatchRunsPanel />}
          {activeTab.key === "ai" && <AiPanel />}
          {activeTab.key === "bundles" && <BundlesPanel />}
          {activeTab.key === "guidelines" && <GuidelinesPanel />}
        </div>
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
