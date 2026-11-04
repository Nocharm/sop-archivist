// dev 모드 전용 사용자 전환기 - 로컬 계정 5명 중 하나로 바꿔 권한 차등을 바로 본다. 상단 바에서만 쓰며 keycloak 모드에선 렌더하지 않는다.
"use client";

import { UserRound } from "lucide-react";
import type { ChangeEvent } from "react";

import { useI18n } from "@/lib/i18n";
import { getStoredDevUser, LOCAL_USERS, storeDevUser } from "@/lib/dev-auth";
import { useSession } from "@/lib/session";

export function DevUserSwitcher() {
  const { t } = useI18n();
  const { mode, reloadMe } = useSession();
  if (mode !== "dev") return null;

  // 저장 -> /api/me 재조회. apiFetch가 요청마다 저장값을 읽으므로 새 사용자로 나간다.
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    storeDevUser(e.target.value);
    reloadMe();
  };

  const current = getStoredDevUser() ?? "";
  // 목록 밖 계정(디렉터리에 없는 첫 로그인 시험 등)이 저장돼 있으면 첫 항목으로 오표시되지 않게 그 값을 항목으로 둔다
  const isListed = LOCAL_USERS.some((user) => user.loginId === current);

  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
      <UserRound size={16} strokeWidth={1.5} />
      <span className="sr-only">{t("nav.devUser")}</span>
      <select
        data-testid="dev-user-switcher"
        value={current}
        className="h-8 rounded-md border border-gray-300 bg-white px-1.5 text-sm text-gray-700"
        onChange={handleChange}
      >
        {current !== "" && !isListed && <option value={current}>{current}</option>}
        {LOCAL_USERS.map((user) => (
          <option key={user.loginId} value={user.loginId}>
            {user.name} ({user.loginId})
          </option>
        ))}
      </select>
    </label>
  );
}
