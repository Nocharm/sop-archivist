// 설명서 화면 단축키 판단 - Split과 같은 글쇠(J/K 이동, ↵ 읽음, U 지우기)를 쓰고 화면은 이 결과대로 실행만 한다.
// ↑↓·Space는 글을 스크롤하는 데 남겨 둔다(Split과 다른 점 - 여기는 읽는 화면이다).

import type { ReadState } from "./manual";

export type ManualKeyAction = "next" | "prev" | "mark" | "unmark" | "find" | "escape";

export interface ManualKeyContext {
  /** 글 입력 칸(찾기)에 포커스가 있다 */
  typing: boolean;
  /** 단추·링크에 포커스가 있다 - Enter는 그 단추의 것이다 */
  onControl: boolean;
  /** 메뉴·툴팁 밖의 층(사용자 메뉴 등)이 열려 있다 */
  layerOpen: boolean;
  /** 찾는 낱말이 들어 있다 */
  hasQuery: boolean;
  /** 지금 조각의 읽음 상태 - 남은 조각이 없으면 null */
  state: ReadState | null;
}

interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const LETTER_CODE = /^Key([A-Z])$/;

// 한글 입력 상태에서는 key가 자모(ㅓ·ㅏ·ㅕ)로 온다 - 영문 글쇠가 아니면 글쇠 자리(code)로 읽는다
function readKey(event: KeyLike): string {
  if (event.key.length === 1 && event.key.charCodeAt(0) > 0x7f) {
    const letter = LETTER_CODE.exec(event.code);
    if (letter) return letter[1].toLowerCase();
  }
  return event.key.toLowerCase();
}

export function getManualKeyAction(event: KeyLike, ctx: ManualKeyContext): ManualKeyAction | null {
  if (ctx.layerOpen) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = readKey(event);
  // Esc는 찾기를 지우고 글로 돌아간다 - 찾는 중이 아니면 할 일이 없다
  if (key === "escape") return ctx.typing || ctx.hasQuery ? "escape" : null;
  if (ctx.typing) return null;
  if (key === "/") return "find";
  if (key === "j") return "next";
  if (key === "k") return "prev";
  if (ctx.state === null) return null;
  if (key === "enter") return ctx.onControl || ctx.state === "read" ? null : "mark";
  if (key === "u") return ctx.state === "unread" ? null : "unmark";
  return null;
}
