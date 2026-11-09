// (bpm lib/hangul.ts에서 옮김) 한글 초성 검색 헬퍼 — 유니코드 분해로 구현, 외부 의존성 없음 (spec §7 Phase B).

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

const HANGUL_BASE = 0xac00; // "가"
const HANGUL_LAST = 0xd7a3; // "힣"
const PER_CHOSUNG = 588; // 중성 21 × 종성 28 — 초성 하나가 차지하는 음절 수

/** 완성형 한글을 초성 문자열로 변환. 비한글 문자는 그대로 둔다 ("결재A" → "ㄱㅈA"). */
export function extractChosung(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      result += CHOSUNG[Math.floor((code - HANGUL_BASE) / PER_CHOSUNG)];
    } else {
      result += char;
    }
  }
  return result;
}

/** 쿼리가 초성으로만 구성됐는지 (공백 제외). 빈 문자열은 false. */
export function isChosungQuery(query: string): boolean {
  const chars = [...query.replace(/\s/g, "")];
  return chars.length > 0 && chars.every((char) => CHOSUNG.includes(char));
}

/** 대소문자 무시 부분 일치 + 초성 쿼리면 초성 일치도 허용. */
export function matchesQuery(text: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }
  if (text.toLowerCase().includes(trimmed.toLowerCase())) {
    return true;
  }
  return isChosungQuery(trimmed) && extractChosung(text).includes(trimmed);
}
