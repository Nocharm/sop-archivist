// 관리 화면 표시용 순수 변환 - 변경 기록 한 줄 요약, HR 동기화 중단 사유 문장, 유효 권한 조회 안내, 모르는 값의 원문 폴백. 컴포넌트는 이 결과를 그대로 그린다.
import type { AuditEvent, EffectiveAccess } from "./api";
import type { TFunc } from "./api-errors";

export interface EffectiveNotice {
  testId: string;
  /** 번역 키 */
  key: string;
}

/**
 * 유효 권한 조회 결과 위에 올릴 안내 목록(위에서 아래 순서).
 * 백엔드는 sysadmin이면 직원 행이 없거나 퇴직이어도 권한 전부를 돌려준다(known·active 판정보다 먼저 정해진다).
 * 그래서 sysadmin에게는 "권한이 없다"는 안내를 절대 붙이지 않고, 디렉터리 상태만 중립 문구로 덧붙인다.
 */
export function getEffectiveNotices(access: Pick<EffectiveAccess, "known" | "active" | "is_sysadmin">): EffectiveNotice[] {
  if (access.is_sysadmin) {
    const notices: EffectiveNotice[] = [{ testId: "effective-sysadmin", key: "effective.sysadmin" }];
    if (!access.known) notices.push({ testId: "effective-sysadmin-note", key: "effective.sysadminUnknown" });
    else if (!access.active) notices.push({ testId: "effective-sysadmin-note", key: "effective.sysadminInactive" });
    return notices;
  }
  if (!access.known) return [{ testId: "effective-unknown", key: "effective.unknown" }];
  if (!access.active) return [{ testId: "effective-inactive", key: "effective.inactive" }];
  return [];
}

/** 번역 키가 사전에 없으면(t가 키를 그대로 돌려줌) 원문을 쓴다 - 새 job·outcome이 생겨도 화면이 키 문자열을 내지 않는다. */
export function translateOrRaw(t: TFunc, key: string, raw: string): string {
  const text = t(key);
  return text === key ? raw : text;
}

/** HR 동기화 중단 사유(backend hr/service.py aborted_reason) -> 번역 키. 모르는 사유는 일반 문구. */
export function getAbortReasonKey(reason: string): string {
  if (reason.startsWith("count mismatch")) return "hr.abort.countMismatch";
  if (reason.startsWith("empty feed")) return "hr.abort.emptyFeed";
  if (reason.startsWith("delete cap exceeded")) return "hr.abort.deleteCap";
  return "hr.abort.other";
}

/**
 * 실행 기록의 detail 한 줄. 실패는 아는 중단 사유를 문장으로 풀고, 그 밖(예외 클래스명+상태 코드,
 * 성공 요약)은 백엔드가 주소·메시지를 뺀 운영 기록이라 그대로 보여 준다.
 */
export function describeRunDetail(outcome: string, detail: string | null, t: TFunc): string {
  if (!detail) return "";
  if (outcome !== "failure") return detail;
  const key = getAbortReasonKey(detail);
  return key === "hr.abort.other" ? detail : t(key);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function readStringList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatPermissions(keys: string[], t: TFunc): string {
  if (keys.length === 0) return t("audit.noPermissions");
  return keys.map((key) => translateOrRaw(t, `permission.${key}`, key)).join(", ");
}

// 부여 기록이 가리키는 것 - 역할이면 역할 이름, 권한 직접 부여면 권한 라벨
function formatGrantWhat(detail: Record<string, unknown>, t: TFunc): string {
  const roleName = readString(detail, "role_name");
  if (roleName) return t("audit.what.role", { name: roleName });
  const permission = readString(detail, "permission");
  return t("audit.what.permission", { name: translateOrRaw(t, `permission.${permission}`, permission) });
}

function formatGrantSubject(detail: Record<string, unknown>, t: TFunc): string {
  const kind = readString(detail, "subject_type") === "dept" ? "audit.subject.dept" : "audit.subject.user";
  return t(kind, { id: readString(detail, "subject_id") });
}

/**
 * 변경 기록 detail -> 사람이 읽는 한 줄. detail 모양은 action마다 다르고 서버가 JSON으로 저장한 값이라
 * 필드가 빠졌거나 모양이 달라도 예외 없이 빈 칸으로 그린다. 모르는 action은 빈 문자열.
 */
export function buildAuditSummary(event: AuditEvent, t: TFunc): string {
  const { detail } = event;
  switch (event.action) {
    case "role.create":
      return t("audit.summary.roleCreate", {
        name: readString(detail, "name"),
        permissions: formatPermissions(readStringList(detail, "permissions"), t),
      });
    case "role.update": {
      const before = readRecord(detail, "before");
      const after = readRecord(detail, "after");
      const summary = t("audit.summary.roleUpdate", {
        name: readString(after, "name"),
        permissions: formatPermissions(readStringList(after, "permissions"), t),
      });
      const oldName = readString(before, "name");
      return oldName && oldName !== readString(after, "name") ? `${summary} ${t("audit.renamedFrom", { name: oldName })}` : summary;
    }
    case "role.delete":
      return t("audit.summary.roleDelete", { name: readString(detail, "name") });
    case "grant.add":
      return t("audit.summary.grantAdd", { what: formatGrantWhat(detail, t), subject: formatGrantSubject(detail, t) });
    case "grant.remove":
      return t("audit.summary.grantRemove", { what: formatGrantWhat(detail, t), subject: formatGrantSubject(detail, t) });
    default:
      return "";
  }
}
