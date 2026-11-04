// 상단 바·홈이 같이 쓰는 사용자 표시 이름 규칙 - 한국어 UI는 korean_name 우선, 이름이 비면 login_id.
import type { Me } from "./api";
import type { Lang } from "./i18n-messages";

export function getDisplayName(me: Me, lang: Lang): string {
  if (lang === "ko" && me.korean_name) return me.korean_name;
  // 직원 행이 없는 첫 로그인은 name이 비어 있다 - 화면이 빈 칸이 되지 않게 login_id로 보인다
  return me.name || me.login_id;
}
