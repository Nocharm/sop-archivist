// dev 모드(Keycloak 없음) 임시 로그인 — fixture 5명 + 선택값 localStorage 영속. 백엔드 app/dev_users.py와 loginId·이름이 같다.

export interface LocalUser {
  loginId: string;
  name: string;
  koreanName: string;
  department: string;
}

// department는 백엔드 시드 부서의 영문 이름 열 — 사용자 전환기가 /api/me 값과 어긋나지 않게 맞춘다.
export const LOCAL_USERS: LocalUser[] = [
  { loginId: "dev.admin", name: "Dev Admin", koreanName: "개발관리자", department: "IT Ops Team" },
  { loginId: "qa.lead", name: "QA Lead", koreanName: "품질리드", department: "Quality Division" },
  { loginId: "qa.member", name: "QA Member", koreanName: "품질담당", department: "QA Team 1" },
  { loginId: "prod.member", name: "Production Member", koreanName: "생산담당", department: "Production Team 1" },
  { loginId: "ops.member", name: "Ops Member", koreanName: "운영담당", department: "IT Ops Team" },
];

const KEY = "sopa.devUser";

export function getStoredDevUser(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(KEY);
}

export function storeDevUser(loginId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (loginId) {
    window.localStorage.setItem(KEY, loginId);
  } else {
    window.localStorage.removeItem(KEY);
  }
}
