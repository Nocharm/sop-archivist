// 부여 대상 선택기 - 사람은 디렉터리 검색(디바운스, 최대 50명), 부서는 접고 펴는 트리. 부여 추가 폼과 유효 권한 조회가 공유한다.
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { DIRECTORY_SEARCH_LIMIT, listDepartments, searchDirectory, type SubjectType } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { buildDeptTree, getDeptName, type DeptNode } from "@/lib/dept-tree";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { INPUT_FIELD } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

/** 고른 대상 - id는 사람이면 login_id, 부서면 dept_code(백엔드 subject_id), label은 화면에 보일 이름 */
export interface PickedSubject {
  id: string;
  label: string;
}

interface SubjectPickerProps {
  testId: string;
  subjectType: SubjectType;
  value: PickedSubject | null;
  onChange: (subject: PickedSubject) => void;
  /** 검색 결과에 없는 로그인 ID(퇴직자·직원 동기화 전 첫 로그인)를 직접 조회하는 선택지를 연다. 사람 선택에서만 쓴다. */
  allowLoginIdEntry?: boolean;
}

// 입력이 멈춘 뒤 검색을 보내기까지의 대기(ms)
const SEARCH_DEBOUNCE_MS = 250;

const OPTION_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-gray-800 hover:bg-gray-100 aria-pressed:bg-accent/10 aria-pressed:font-semibold";

function PersonSearch({ testId, value, onChange, allowLoginIdEntry }: Omit<SubjectPickerProps, "subjectType">) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useLoaded(() => searchDirectory(debouncedQuery), debouncedQuery);
  const people = search.data ?? [];
  const typedId = query.trim();
  // 입력 뒤 디바운스를 기다리는 동안과 요청이 진행 중인 동안
  const isSearching = typedId !== debouncedQuery || search.isLoading;
  const showLoginIdEntry = allowLoginIdEntry === true && typedId !== "" && !people.some((person) => person.login_id === typedId);

  return (
    <div className="space-y-2">
      <input
        type="text"
        data-testid={`${testId}-search`}
        className={INPUT_FIELD}
        value={query}
        maxLength={200}
        placeholder={t("picker.searchPerson")}
        aria-label={t("picker.searchPerson")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {search.error !== null && (
        <InlineNotice testId={`${testId}-error`} tone="error">
          {humanizeApiError(search.error, t)}
        </InlineNotice>
      )}
      {search.data !== null && (
        <ul data-testid={`${testId}-list`} className="max-h-56 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-200">
          {people.map((person) => (
            <li key={person.login_id}>
              <button
                type="button"
                data-testid={`${testId}-option-${person.login_id}`}
                aria-pressed={value?.id === person.login_id}
                className={`${OPTION_CLASS} w-full`}
                onClick={() => onChange({ id: person.login_id, label: getDisplayName(person, lang) })}
              >
                <span className="shrink-0">{getDisplayName(person, lang)}</span>
                <span className="shrink-0 text-xs text-gray-500">{person.login_id}</span>
                <span className="min-w-0 truncate text-xs text-gray-500">{person.dept_path || person.department}</span>
              </button>
            </li>
          ))}
          {showLoginIdEntry && (
            <li>
              <button
                type="button"
                data-testid={`${testId}-raw-option`}
                className={`${OPTION_CLASS} w-full`}
                onClick={() => onChange({ id: typedId, label: typedId })}
              >
                {t("picker.lookupLoginId", { id: typedId })}
              </button>
            </li>
          )}
          {people.length === 0 && !showLoginIdEntry && (
            <li data-testid={`${testId}-empty`} className="px-3 py-2 text-sm text-gray-500">
              {t("picker.noResults")}
            </li>
          )}
        </ul>
      )}
      {/* 높이를 늘 확보해 검색 중 표시가 켜지고 꺼질 때 아래 요소가 밀리지 않게 한다 */}
      <p data-testid={`${testId}-status`} className="min-h-4 text-xs text-gray-500">
        {isSearching ? t("picker.searching") : people.length >= DIRECTORY_SEARCH_LIMIT ? t("picker.limitHint", { count: DIRECTORY_SEARCH_LIMIT }) : ""}
      </p>
    </div>
  );
}

function DepartmentTree({ testId, value, onChange }: Omit<SubjectPickerProps, "subjectType" | "allowLoginIdEntry">) {
  const { t, lang } = useI18n();
  const departments = useLoaded(listDepartments);
  // 사용자가 직접 펴거나 접은 부서만 기록하고, 나머지는 루트만 펼친 기본값을 따른다
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const tree = departments.data ? buildDeptTree(departments.data) : [];

  const renderNode = (node: DeptNode, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = openOverrides[node.code] ?? depth === 0;
    const name = getDeptName(node, lang);
    return (
      <li key={node.code}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
          {hasChildren ? (
            <button
              type="button"
              data-testid={`${testId}-toggle-${node.code}`}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? t("picker.collapse") : t("picker.expand")}: ${name}`}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
              onClick={() => setOpenOverrides((prev) => ({ ...prev, [node.code]: !isOpen }))}
            >
              {isOpen ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          )}
          <button
            type="button"
            data-testid={`${testId}-option-${node.code}`}
            aria-pressed={value?.id === node.code}
            className={OPTION_CLASS}
            onClick={() => onChange({ id: node.code, label: name })}
          >
            <span className="min-w-0 truncate">{name}</span>
            <span className="shrink-0 text-xs text-gray-500">{node.code}</span>
          </button>
        </div>
        {hasChildren && isOpen && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
      </li>
    );
  };

  if (departments.error !== null) {
    return (
      <InlineNotice testId={`${testId}-error`} tone="error">
        {humanizeApiError(departments.error, t)}
      </InlineNotice>
    );
  }
  if (departments.data === null) {
    return <p className="text-sm text-gray-500">{t("common.loading")}</p>;
  }
  if (tree.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} className="text-sm text-gray-500">
        {t("picker.deptEmpty")}
      </p>
    );
  }
  return (
    <ul data-testid={`${testId}-tree`} className="max-h-56 overflow-auto rounded-md border border-gray-200 py-1">
      {tree.map((root) => renderNode(root, 0))}
    </ul>
  );
}

export function SubjectPicker({ testId, subjectType, value, onChange, allowLoginIdEntry }: SubjectPickerProps) {
  const { t } = useI18n();
  return (
    // min-w-0: 그리드·플렉스 부모 안에서 긴 부서 경로가 칸을 넓혀 옆 단추를 밀어내지 않게 목록 쪽에서 말줄임한다
    <div data-testid={testId} className="min-w-0 space-y-2">
      {subjectType === "user" ? (
        <PersonSearch testId={testId} value={value} onChange={onChange} allowLoginIdEntry={allowLoginIdEntry} />
      ) : (
        <DepartmentTree testId={testId} value={value} onChange={onChange} />
      )}
      <p data-testid={`${testId}-selected`} className="text-sm text-gray-600">
        {value ? t("picker.selected", { name: value.label }) : t("picker.none")}
      </p>
    </div>
  );
}
