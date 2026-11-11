// dev 모드 로그인 고르기 - 검색어가 없으면 로컬 계정 5명, 있으면 직원 디렉터리 전체에서 순위를 매긴다(개발 스택은 HR 동기화로 실제 직원이 들어 있다).
// 비밀번호 없이 고른 로그인 ID로 들어가고 권한은 그 사람의 것이다(서버가 DEV_ENFORCE_PERMISSIONS로 판정).
"use client";

import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import type { DirectoryUser } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { LOCAL_USERS } from "@/lib/dev-auth";
import { loadDirectoryOnce } from "@/lib/directory-cache";
import { useI18n } from "@/lib/i18n";
import { rankPeople } from "@/lib/people-order";
import { INPUT_FIELD } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

// 검색 결과로 그리는 최대 수 - 더 좁히려면 검색어를 늘린다
const MAX_RESULTS = 30;

interface DevLoginPickerProps {
  onPick: (loginId: string) => void;
}

interface PickRow {
  loginId: string;
  title: string;
  detail: string;
}

export function DevLoginPicker({ onPick }: DevLoginPickerProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const directory = useLoaded(loadDirectoryOnce, "directory");
  const typed = query.trim();

  const toRow = (person: DirectoryUser): PickRow => ({
    loginId: person.login_id,
    title: lang === "ko" && person.korean_name ? person.korean_name : person.name,
    detail: `${person.login_id} · ${person.department}`,
  });
  const rows: PickRow[] = typed
    ? rankPeople(directory.data ?? [], typed).slice(0, MAX_RESULTS).map(toRow)
    : LOCAL_USERS.map((user) => ({
        loginId: user.loginId,
        title: lang === "ko" ? user.koreanName : user.name,
        detail: `${user.loginId} · ${user.department}`,
      }));

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-2">{t("login.devHint")}</p>
      <input
        type="text"
        data-testid="login-dev-search"
        className={INPUT_FIELD}
        value={query}
        maxLength={200}
        placeholder={t("picker.searchPerson")}
        aria-label={t("picker.searchPerson")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {typed !== "" && directory.error !== null && (
        <InlineNotice testId="login-dev-error" tone="error">
          {humanizeApiError(directory.error, t)}
        </InlineNotice>
      )}
      {typed !== "" && directory.data === null && directory.error === null && (
        <p data-testid="login-dev-status" className="text-xs text-ink-3">
          {t("picker.searching")}
        </p>
      )}
      {typed !== "" && directory.data !== null && rows.length === 0 && (
        <p data-testid="login-dev-empty" className="text-xs text-ink-3">
          {t("login.devNoMatch")}
        </p>
      )}
      <ul data-testid="login-dev-list" className="max-h-80 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.loginId}>
            <button
              type="button"
              data-testid={`login-dev-user-${row.loginId}`}
              className="flex w-full flex-col items-start rounded-md border border-line px-3 py-2 text-left hover:bg-sunken"
              onClick={() => onPick(row.loginId)}
            >
              <span className="text-sm font-semibold text-ink">{row.title}</span>
              <span className="text-xs text-ink-3">{row.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
