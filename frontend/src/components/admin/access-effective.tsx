// 관리 > 권한 > 유효 권한 조회 - 사람을 고르면 그 사람의 유효 권한과 권한별 출처(개인/부서, 역할/직접)를 보여 준다. 퇴직자·미등록 직원은 로그인 ID로 직접 조회한다.
"use client";

import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { SourceLine } from "@/components/permission-source-line";
import { SubjectPicker, type PickedSubject } from "@/components/subject-picker";
import { PanelTitle } from "@/components/admin/panel-title";
import { orderPermissions } from "@/lib/access";
import { getEffectiveNotices, translateOrRaw } from "@/lib/admin-format";
import { getEffective } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { useLoaded } from "@/lib/use-loaded";

function EffectiveResult({ loginId }: { loginId: string }) {
  const { t } = useI18n();
  const effective = useLoaded(() => getEffective(loginId), loginId);

  if (effective.error !== null) {
    return (
      <InlineNotice testId="effective-error" tone="error">
        {humanizeApiError(effective.error, t)}
      </InlineNotice>
    );
  }
  const result = effective.data;
  if (result === null) {
    return <p className="text-sm text-ink-3">{t("effective.loading")}</p>;
  }

  const permissions = orderPermissions(result.permissions);
  return (
    <div data-testid="effective-result" className="space-y-3">
      {getEffectiveNotices(result).map((notice) => (
        <InlineNotice key={notice.testId} testId={notice.testId} tone="info">
          {t(notice.key)}
        </InlineNotice>
      ))}
      {permissions.length === 0 ? (
        <p data-testid="effective-none" className="text-sm text-ink-3">
          {t("effective.none")}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {permissions.map((key) => (
            <li key={key} data-testid={`effective-perm-${key}`} className="space-y-1.5 px-3 py-2.5">
              <div className="text-sm font-semibold text-ink">{translateOrRaw(t, `permission.${key}`, key)}</div>
              {(result.sources[key] ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(result.sources[key] ?? []).map((source, index) => (
                    <SourceLine key={`${source.kind}-${source.subject_id}-${source.role ?? "direct"}-${index}`} source={source} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AccessEffective() {
  const { t } = useI18n();
  const [person, setPerson] = useState<PickedSubject | null>(null);

  return (
    <section data-testid="access-effective" className="space-y-4">
      <PanelTitle title={t("admin.sub.lookup")} info={t("effective.intro")} testId="effective-info" />
      <div className="space-y-1.5">
        <span className="text-sm font-semibold text-ink-2">{t("effective.pickerLabel")}</span>
        <SubjectPicker testId="effective-picker" subjectType="user" value={person} onChange={setPerson} allowLoginIdEntry />
      </div>
      {person !== null && <EffectiveResult key={person.id} loginId={person.id} />}
    </section>
  );
}
