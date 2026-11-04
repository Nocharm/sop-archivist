// ApiError → 사람이 읽는 문구. 상태 코드 수준의 error.* 키로 옮기고, 서버 원문은 422 검증 사유만 보여 준다.
// 화면별 특정 detail(예: 역할 삭제 409)은 그 화면을 만들 때 이 위에 접두 매핑을 얹는다.
import { ApiError } from "./api";

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

const STATUS_KEYS: Record<number, string> = {
  0: "error.network",
  401: "error.unauthorized",
  403: "error.forbidden",
  409: "error.conflict",
  502: "error.upstream",
  503: "error.unavailable",
};

export function humanizeApiError(err: unknown, t: TFunc): string {
  if (!(err instanceof ApiError)) return t("error.unknown");
  // 422만 detail을 보여 준다(어느 입력이 틀렸는지가 사용자에게 필요한 정보). 502·503 detail에는 상류 시스템 사정이 실릴 수 있어 가린다.
  if (err.status === 422) return t("error.invalid", { detail: err.detail });
  return t(STATUS_KEYS[err.status] ?? "error.unknown");
}
