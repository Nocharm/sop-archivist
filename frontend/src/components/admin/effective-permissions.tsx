// 한 사람의 유효 권한 - 권한마다 켜졌는지와 출처(개인·부서, 역할·직접). 판정은 서버(getEffective)가 하고 여기는 그대로 그린다.
import { InlineNotice } from "@/components/inline-notice";
import { SourceLine } from "@/components/permission-source-line";
import { orderPermissions, PERMISSIONS } from "@/lib/access";
import { getEffectiveNotices, translateOrRaw } from "@/lib/admin-format";
import type { EffectiveAccess } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function EffectivePermissions({ access }: { access: EffectiveAccess }) {
  const { t } = useI18n();
  const held = orderPermissions(access.permissions);
  const missing = PERMISSIONS.filter((key) => !access.permissions.includes(key));
  return (
    <div data-testid="effective-result" className="space-y-2">
      {getEffectiveNotices(access).map((notice) => (
        <InlineNotice key={notice.testId} testId={notice.testId} tone="info">
          {t(notice.key)}
        </InlineNotice>
      ))}
      {held.length === 0 && (
        <p data-testid="effective-none" className="adm-note">
          {t("effective.none")}
        </p>
      )}
      {held.length > 0 && (
        <ul className="adm-perms">
          {held.map((key) => (
            <li key={key} data-testid={`effective-perm-${key}`} className="adm-perm">
              <span className="adm-t1">{translateOrRaw(t, `permission.${key}`, key)}</span>
              {(access.sources[key] ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(access.sources[key] ?? []).map((source, index) => (
                    <SourceLine key={`${source.kind}-${source.subject_id}-${source.role ?? "direct"}-${index}`} source={source} />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {missing.map((key) => (
            <li key={key} className="adm-perm off">
              <span className="adm-t1">{t(`permission.${key}`)}</span>
              <span className="adm-t2">{t("grants.detail.notHeld")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
