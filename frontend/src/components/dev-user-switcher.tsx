// dev 모드 전용 사용자 전환기 - 로컬 계정 5명 중 하나로 바꿔 권한 차등을 바로 본다. 상단 바에서만 쓰며 keycloak 모드에선 렌더하지 않는다.
"use client";

import { Select } from "@/components/ui/select";

import { clearAiJobsStore } from "@/lib/ai-jobs-store";
import { clearBundleStore } from "@/lib/bundle-store";
import { clearDirectoryCache } from "@/lib/directory-cache";
import { useI18n } from "@/lib/i18n";
import { getStoredDevUser, LOCAL_USERS, storeDevUser } from "@/lib/dev-auth";
import { useSession } from "@/lib/session";

export function DevUserSwitcher() {
  const { t } = useI18n();
  const { mode, reloadMe } = useSession();
  if (mode !== "dev") return null;

  // 저장 -> 묶음 캐시 비우기 -> /api/me 재조회. apiFetch가 요청마다 저장값을 읽으므로 새 사용자로 나간다.
  // 화면은 앱 틀이 사용자마다 다시 그려 새 사용자로 다시 불러온다
  const handleChange = (loginId: string) => {
    storeDevUser(loginId);
    clearBundleStore();
    clearAiJobsStore();
    clearDirectoryCache();
    reloadMe();
  };

  const current = getStoredDevUser() ?? "";
  // 목록 밖 계정(디렉터리에 없는 첫 로그인 시험 등)이 저장돼 있으면 첫 항목으로 오표시되지 않게 그 값을 항목으로 둔다
  const isListed = LOCAL_USERS.some((user) => user.loginId === current);

  return (
    <span className="inline-flex items-center gap-1.5 text-chrome-ink-2">
      <span className="rounded-sm border border-chrome-line px-1 font-mono text-[10px] font-bold leading-4 tracking-wide" aria-hidden>
        DEV
      </span>
      <Select
        testId="dev-user-switcher"
        ariaLabel={t("nav.devUser")}
        value={current}
        size="sm"
        tone="chrome"
        className="max-w-[160px]"
        options={[
          ...(current !== "" && !isListed ? [{ value: current, label: current, triggerLabel: current }] : []),
          ...LOCAL_USERS.map((user) => ({ value: user.loginId, label: `${user.name} (${user.loginId})`, triggerLabel: user.loginId })),
        ]}
        onChange={handleChange}
      />
    </span>
  );
}
