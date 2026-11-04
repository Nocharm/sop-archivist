// 번역 사전 — en 권위, ko는 같은 키를 tsc가 강제한다(+ i18n-messages.test). {x}는 t(key, vars)로 치환.
// 권한 라벨 키는 `permission.<권한 키>`라 권한 키 자체가 permission.으로 시작하는 항목은 permission.permission.manage가 된다.

export type Lang = "en" | "ko";

const en = {
  "permission.permission.manage": "Manage permissions",
  "permission.directory.sync": "Run directory sync",
  "permission.ai.admin": "Manage AI",
  "permission.system.view": "View system status",
  "error.unauthorized": "Your session is missing or has expired. Please sign in again.",
  "error.forbidden": "You don't have permission to do this.",
  "error.conflict": "This conflicts with the current state. Reload and try again.",
  "error.invalid": "Some input is not valid: {detail}",
  "error.upstream": "A connected service did not respond properly. Try again later.",
  "error.unavailable": "This feature is turned off or not set up yet.",
  "error.network": "Could not reach the server. Check your connection and try again.",
  "error.unknown": "Something went wrong. Please try again.",
};

type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  "permission.permission.manage": "권한 관리",
  "permission.directory.sync": "직원 동기화 실행",
  "permission.ai.admin": "AI 관리",
  "permission.system.view": "시스템 상태 보기",
  "error.unauthorized": "로그인이 없거나 만료되었습니다. 다시 로그인해 주세요.",
  "error.forbidden": "이 작업을 할 권한이 없습니다.",
  "error.conflict": "현재 상태와 충돌합니다. 새로고침한 뒤 다시 시도해 주세요.",
  "error.invalid": "입력값이 올바르지 않습니다: {detail}",
  "error.upstream": "연결된 서비스가 올바르게 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  "error.unavailable": "이 기능은 꺼져 있거나 아직 설정되지 않았습니다.",
  "error.network": "서버에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
  "error.unknown": "문제가 발생했습니다. 다시 시도해 주세요.",
};

export const MESSAGES: Record<Lang, Record<string, string>> = { en, ko };
