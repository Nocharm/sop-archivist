// 외부 이동 "대상 문서" 칸 - 치는 글로 다른 Bundle의 To-Be 문서(내가 멤버인 Bundle)와 전에 쓴 코드를 추천하고, 친 글을 그대로 쓸 수도 있다.
"use client";

import { useEffect, useState } from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { listMoveTargets } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

const QUERY_DELAY_MS = 200; // 치는 동안 요청을 아끼는 대기
export const MOVE_CODE_MAX_LENGTH = 100;

interface MoveTargetFieldProps {
  bundleId: number;
  value: string;
  onChange: (code: string) => void;
  testId: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function MoveTargetField({ bundleId, value, onChange, testId, disabled = false, autoFocus = false }: MoveTargetFieldProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(value.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value.trim()), QUERY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  const targets = useLoaded(() => listMoveTargets(bundleId, query), `${bundleId}:${query}`);
  const options: ComboboxOption[] = (targets.data ?? []).map((item) => ({
    value: item.code,
    label: item.code,
    hint: [item.title, item.bundle_code, item.used ? t(`assign.move.used.${item.used}`) : ""].filter(Boolean).join(" · "),
  }));
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      testId={testId}
      ariaLabel={t("classify.moveTo")}
      placeholder="SOP-XX-00000"
      mono
      disabled={disabled}
      maxLength={MOVE_CODE_MAX_LENGTH}
      autoFocus={autoFocus}
      typedLabel={(text) => t("assign.move.useTyped", { code: text })}
      emptyLabel={targets.data === null ? t("common.loading") : t("assign.move.none")}
    />
  );
}
