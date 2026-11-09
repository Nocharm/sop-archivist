// 대상 선택기 - 사람은 직원 전체를 한 번 받아 브라우저에서 순위를 매기고(25명씩 이어 그림), 부서는 접고 펴는 트리. 멤버 관리·부여 추가·유효 권한 조회가 공유한다.
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { listDepartments, type SubjectType } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { buildDeptTree, getDeptName, type DeptNode } from "@/lib/dept-tree";
import { Truncate } from "@/components/ui/motion";
import { loadDirectoryOnce } from "@/lib/directory-cache";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { orderBrowse, rankPeople } from "@/lib/people-order";
import { useMe } from "@/lib/session";
import { INPUT_FIELD } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";

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

const OPTION_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-ink hover:bg-hover aria-pressed:bg-accent/10 aria-pressed:font-semibold";

// 사람 목록을 한 번에 그리는 수 - 끝에 닿으면 같은 수만큼 더 붙인다
const PEOPLE_PAGE = 25;

function PersonSearch({ testId, value, onChange, allowLoginIdEntry }: Omit<SubjectPickerProps, "subjectType">) {
  const { t, lang } = useI18n();
  const me = useMe();
  const [query, setQuery] = useState("");
  const directory = useLoaded(loadDirectoryOnce, "directory");
  // 내 부서의 상위 체인을 알려고 부서 표를 같이 받는다(실패하면 체인 없이 원래 순서)
  const departments = useLoaded(listDepartments, "departments");
  const people = directory.data ?? [];
  const typedId = query.trim();
  // 검색어가 있으면 이름 > 한글 이름 > 아이디 순위, 없으면 내 부서 → 상위 부서 → 나머지
  const ordered = typedId ? rankPeople(people, typedId) : orderBrowse(people, me.login_id, departments.data ?? []);
  const { visible, hasMore, sentinelRef } = useProgressiveList(ordered, typedId, { pageSize: PEOPLE_PAGE });
  const showLoginIdEntry = allowLoginIdEntry === true && typedId !== "" && !people.some((person) => person.login_id === typedId);

  return (
    <div className="min-w-0 space-y-2">
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
      {directory.error !== null && (
        <InlineNotice testId={`${testId}-error`} tone="error">
          {humanizeApiError(directory.error, t)}
        </InlineNotice>
      )}
      {directory.data === null && directory.error === null ? (
        <p data-testid={`${testId}-status`} className="min-h-4 text-xs text-ink-3">
          {t("picker.searching")}
        </p>
      ) : (
        directory.data !== null && (
          <ul data-testid={`${testId}-list`} className="picker-list">
            {visible.map((person) => (
              <li key={person.login_id}>
                <button
                  type="button"
                  data-testid={`${testId}-option-${person.login_id}`}
                  aria-pressed={value?.id === person.login_id}
                  className="picker-option"
                  onClick={() => onChange({ id: person.login_id, label: getDisplayName(person, lang) })}
                >
                  <span className="shrink-0 font-medium">{getDisplayName(person, lang)}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-3">{person.login_id}</span>
                  <Truncate className="min-w-0 flex-1 text-xs text-ink-3" text={person.dept_path || person.department} />
                </button>
              </li>
            ))}
            {hasMore && (
              <li ref={sentinelRef} className="picker-more" data-testid={`${testId}-more`} aria-hidden>
                <span className="sk h-3 w-40" />
              </li>
            )}
            {showLoginIdEntry && (
              <li>
                <button type="button" data-testid={`${testId}-raw-option`} className="picker-option" onClick={() => onChange({ id: typedId, label: typedId })}>
                  {t("picker.lookupLoginId", { id: typedId })}
                </button>
              </li>
            )}
            {ordered.length === 0 && !showLoginIdEntry && (
              <li data-testid={`${testId}-empty`} className="px-3 py-2 text-sm text-ink-3">
                {t("picker.noResults")}
              </li>
            )}
          </ul>
        )
      )}
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
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-hover"
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
            <span className="shrink-0 text-xs text-ink-3">{node.code}</span>
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
    return <p className="text-sm text-ink-3">{t("common.loading")}</p>;
  }
  if (tree.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} className="text-sm text-ink-3">
        {t("picker.deptEmpty")}
      </p>
    );
  }
  return (
    <ul data-testid={`${testId}-tree`} className="max-h-56 overflow-auto rounded-md border border-line py-1">
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
      <p data-testid={`${testId}-selected`} className="text-sm text-ink-2">
        {value ? t("picker.selected", { name: value.label }) : t("picker.none")}
      </p>
    </div>
  );
}
