// ApiError -> 사람이 읽는 문구. 서버 detail 중 이 앱이 아는 것(권한 표·운영 API의 업무 오류)은 문장으로 옮기고, 모르는 것은 상태 코드 수준의 error.* 키로 옮긴다.
// 서버 원문은 422 검증 사유와 502 문장 뒤의 짧은 기술 힌트(상태 코드·예외 클래스명)만 보여 준다 - 그 밖의 detail에는 상류 시스템 사정이 실릴 수 있어 가린다.
import { PERMISSIONS } from "./access";
import { ApiError } from "./api";

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

const STATUS_KEYS: Record<number, string> = {
  0: "error.network",
  401: "error.unauthorized",
  403: "error.forbidden",
  404: "error.notFound",
  409: "error.conflict",
  413: "error.tooLarge",
  502: "error.upstream",
  503: "error.unavailable",
};

// 상태 코드 + detail 전체가 같을 때의 문장 - backend routers/access.py·admin.py의 HTTPException detail과 같은 글자
const EXACT_DETAIL_KEYS: Record<number, Record<string, string>> = {
  404: {
    "role not found": "error.roleGone",
    "grant not found": "error.grantGone",
  },
  409: {
    "role name already exists": "error.roleNameTaken",
    "role is still granted": "error.roleStillGranted",
    "grant already exists": "error.grantExists",
    "sync ran too recently": "error.syncTooSoon",
  },
  422: {
    "unknown subject": "error.subjectGone",
    "unknown role": "error.roleGone",
    "exactly one of role_id or permission is required": "error.grantNeedsOne",
  },
  503: {
    "HR sync is not configured": "error.hrNotConfigured",
    "AI is disabled": "error.aiDisabled",
  },
};

const MISSING_PERMISSION_PREFIX = "missing permission: ";
const UNKNOWN_PERMISSION_PREFIX = "unknown permission: ";
const HR_SOURCE_PREFIX = "HR source error: ";
const AI_ENDPOINT_PREFIX = "AI endpoint error: ";

// 힌트로 보여 줘도 되는 글자 모양 - 숫자 상태 코드나 예외 클래스명뿐이고, 주소·메시지가 섞여 오면 버린다
const HINT_PATTERN = /^[\w.]{1,60}$/;

// 앞에 공백을 붙인 힌트 문장. 보여 줄 수 없는 모양이면 빈 문자열이라 본문 뒤에 그대로 이어 붙인다.
function formatHint(raw: string, t: TFunc): string {
  const hint = raw.trim();
  if (!HINT_PATTERN.test(hint)) return "";
  return ` ${t("error.hint", { hint: /^\d+$/.test(hint) ? `HTTP ${hint}` : hint })}`;
}

function humanizeKnownDetail(err: ApiError, t: TFunc): string | null {
  const exactKey = EXACT_DETAIL_KEYS[err.status]?.[err.detail];
  if (exactKey) return t(exactKey);

  if (err.status === 403 && err.detail.startsWith(MISSING_PERMISSION_PREFIX)) {
    const key = err.detail.slice(MISSING_PERMISSION_PREFIX.length);
    // 카탈로그에 있는 권한만 라벨로 풀어 말한다 - 모르는 키는 일반 거부 문구로 떨어진다
    return (PERMISSIONS as readonly string[]).includes(key)
      ? t("error.missingPermission", { permission: t(`permission.${key}`) })
      : null;
  }
  if (err.status === 422 && err.detail.startsWith(UNKNOWN_PERMISSION_PREFIX)) {
    return t("error.unknownPermission");
  }
  if (err.status === 502 && err.detail.startsWith(HR_SOURCE_PREFIX)) {
    return t("error.hrSource") + formatHint(err.detail.slice(HR_SOURCE_PREFIX.length), t);
  }
  if (err.status === 502 && err.detail.startsWith(AI_ENDPOINT_PREFIX)) {
    return t("error.aiEndpoint") + formatHint(err.detail.slice(AI_ENDPOINT_PREFIX.length), t);
  }
  return null;
}

// 업무 규칙 거절 코드 → rule.<code> 문구. 문맥 중 글자·숫자 값만 문구 변수로 넘긴다. 모르는 코드는 상태 코드 문구로 떨어진다.
function humanizeRule(err: ApiError, t: TFunc): string | null {
  if (!err.rule) return null;
  // 묶음 저장 거절(invalid_group)처럼 세부 사유가 있으면 그 문구를 먼저 찾는다
  const detailKey = typeof err.rule.reason === "string" ? `rule.${err.rule.code}.${err.rule.reason}` : null;
  const key = detailKey && t(detailKey) !== detailKey ? detailKey : `rule.${err.rule.code}`;
  const vars: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(err.rule)) {
    if (typeof value === "string" || typeof value === "number") vars[name] = value;
    else if (Array.isArray(value)) vars[`${name}Count`] = value.length;
  }
  const text = t(key, vars);
  return text === key ? null : text;
}

export function humanizeApiError(err: unknown, t: TFunc): string {
  if (!(err instanceof ApiError)) return t("error.unknown");
  const rule = humanizeRule(err, t);
  if (rule !== null) return rule;
  // 모르는 규칙 코드 - 422여도 원문(JSON)을 보이지 않는다
  if (err.rule) return t(STATUS_KEYS[err.status] ?? "error.unknown");
  const known = humanizeKnownDetail(err, t);
  if (known !== null) return known;
  // 아는 업무 오류가 아닌 422만 detail을 보여 준다(어느 입력이 틀렸는지가 사용자에게 필요한 정보)
  if (err.status === 422) return t("error.invalid", { detail: err.detail });
  return t(STATUS_KEYS[err.status] ?? "error.unknown");
}
