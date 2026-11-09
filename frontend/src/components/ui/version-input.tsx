// 버전 칸 - 숫자와 점만 받고, 오른쪽 위/아래 단추로 올리고 내린다(stepVersion). 칸 바깥 x는 호버 때만 보이고 비운다.
// 바로 저장하는 칸이라 단추·x·Enter·바깥 누름이 모두 onCommit을 부른다(같은 값이면 부르지 않는다).
"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useI18n } from "@/lib/i18n";
import { sanitizeVersion, stepVersion } from "@/lib/version-step";

interface VersionInputProps {
  value: string;
  onCommit: (next: string) => void;
  testId: string;
  disabled?: boolean;
}

export function VersionInput({ value, onCommit, testId, disabled = false }: VersionInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  function commit(next: string) {
    setDraft(null);
    if (next !== value) onCommit(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(shown);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setDraft(null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setDraft(stepVersion(shown, event.key === "ArrowUp" ? 1 : -1));
    }
  }

  if (disabled) {
    return value ? <span data-testid={testId}>{value}</span> : <span className="text-ink-4" data-testid={testId}>–</span>;
  }

  return (
    <span className="ver-input">
      <span className="ver-box">
        <input
          data-testid={testId}
          aria-label={t("documents.colVersion")}
          inputMode="decimal"
          placeholder={t("documents.colVersion")}
          value={shown}
          maxLength={20}
          onChange={(event) => setDraft(sanitizeVersion(event.target.value))}
          onKeyDown={handleKeyDown}
          onBlur={() => draft !== null && commit(draft)}
        />
        <span className="ver-steps">
          <button type="button" tabIndex={-1} aria-label={t("documents.versionUp")} data-testid={`${testId}-up`} onClick={() => commit(stepVersion(shown, 1))}>
            <ChevronUp size={11} strokeWidth={2.2} aria-hidden />
          </button>
          <button type="button" tabIndex={-1} aria-label={t("documents.versionDown")} data-testid={`${testId}-down`} onClick={() => commit(stepVersion(shown, -1))}>
            <ChevronDown size={11} strokeWidth={2.2} aria-hidden />
          </button>
        </span>
      </span>
      {shown !== "" && (
        <button type="button" className="ver-clear" aria-label={t("documents.versionClear")} data-testid={`${testId}-clear`} onClick={() => commit("")}>
          <X size={12} strokeWidth={1.8} aria-hidden />
        </button>
      )}
    </span>
  );
}
