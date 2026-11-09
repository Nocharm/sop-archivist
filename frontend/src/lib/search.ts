// (bpm lib/search.ts에서 옮김) 재사용 검색 — 부분일치 + 한글초성 + 로마자초성, 공백/콤마 AND, 원문 인덱스 range(하이라이트용). deps 없음.
// 정렬: 정확>접두>단어시작>중간>초성 접두/단어시작>초성·로마자 중간>시퀀스, 동순위는 필드 순서→매치 위치→짧은 필드→입력 순서.

import { extractChosung, isChosungQuery } from "@/lib/hangul";

export interface MatchRange {
  start: number;
  end: number;
}
export interface FieldSpec {
  field: string;
  text: string;
}
export interface FieldMatch {
  field: string;
  ranges: MatchRange[];
}
export interface SearchHit<T> {
  item: T;
  matches: FieldMatch[];
}

// 초성(가나다 순) → 개정로마자 자음. ㅇ은 묵음(빈자). hangul.ts CHOSUNG 순서와 동일.
const CHOSUNG_ROMAN = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const PER_CHOSUNG = 588;

function isLatinQuery(term: string): boolean {
  const t = term.replace(/\s/g, "");
  return t.length > 0 && /^[a-z]+$/i.test(t);
}

// 텍스트의 로마자초성 문자열 + 각 로마자 char가 유래한 원문 char 인덱스 배열.
function toRomanInitials(text: string): { roman: string; src: number[] } {
  let roman = "";
  const src: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const r = CHOSUNG_ROMAN[Math.floor((code - HANGUL_BASE) / PER_CHOSUNG)];
      for (const ch of r) {
        roman += ch;
        src.push(i);
      }
    } else {
      roman += text[i].toLowerCase();
      src.push(i);
    }
  }
  return { roman, src };
}

function allOccurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    starts.push(idx);
    from = idx + 1;
  }
  return starts;
}

// 부분 시퀀스 — query 글자들이 text에 "순서대로"(연속 아님) 등장하면 각 글자 range, 아니면 null.
// 글자 하나는 원문 글자 또는 그 초성과 맞으면 통과 — "ㅂㅈㅈㅈ"가 공백 낀 "배지 조제"에, "배조계"가 "배지 조제 계획"에
// 걸린다(업무 체계 탐색 검색, 2026-09-19). 공백은 query에서 뺀다.
function subsequenceMatch(text: string, term: string): MatchRange[] | null {
  const t = term.replace(/\s/g, "").toLowerCase();
  if (!t) return null;
  const lower = text.toLowerCase();
  const initials = extractChosung(text);
  const ranges: MatchRange[] = [];
  let pos = 0;
  for (const ch of t) {
    let idx = -1;
    for (let i = pos; i < lower.length; i += 1) {
      if (lower[i] === ch || initials[i] === ch) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    ranges.push({ start: idx, end: idx + 1 });
    pos = idx + 1;
  }
  return ranges;
}

/** 한 term이 text에 매치하면 원문 기준 range 배열, 아니면 null. 우선순위 부분일치→초성→로마자→subsequence. */
export function matchTerm(text: string, term: string): MatchRange[] | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  // 1) 부분일치 (대소문자 무시)
  const subStarts = allOccurrences(text.toLowerCase(), trimmed.toLowerCase());
  if (subStarts.length) {
    return subStarts.map((s) => ({ start: s, end: s + trimmed.length }));
  }

  // 2) 한글 초성 (extractChosung는 1:1 인덱스 정렬)
  if (isChosungQuery(trimmed)) {
    const chosung = extractChosung(text);
    const starts = allOccurrences(chosung, trimmed);
    if (starts.length) {
      return starts.map((s) => ({ start: s, end: s + trimmed.length }));
    }
  }

  // 3) 로마자 초성
  if (isLatinQuery(trimmed)) {
    const lower = trimmed.toLowerCase();
    const { roman, src } = toRomanInitials(text);
    const starts = allOccurrences(roman, lower);
    if (starts.length) {
      return starts.map((s) => {
        const last = src[s + lower.length - 1];
        return { start: src[s], end: last + 1 };
      });
    }
  }

  // 4) 부분 시퀀스 (순서만 맞으면) — 최후순위 (SR-3)
  return subsequenceMatch(text, trimmed);
}

// index 위치가 단어 시작인가 — 앞 문자가 문자/숫자가 아니면(공백·. _ 등) 단어 경계.
function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return /[^\p{L}\p{N}]/u.test(text[index - 1]);
}

// 매치 품질 (rank 낮을수록 우선): 0 정확 · 1 접두 · 2 단어시작 · 3 중간 · 4 초성 접두/단어시작 ·
// 5 초성·로마자 중간 · 6 subsequence · ∞ 불일치. pos는 원문 기준 첫 매치 위치(앞일수록 우선).
interface TermQuality {
  rank: number;
  pos: number;
}

function getTermQuality(text: string, term: string): TermQuality {
  const t = term.trim().toLowerCase();
  if (!t) return { rank: Infinity, pos: Infinity };
  const lower = text.toLowerCase();
  if (lower === t) return { rank: 0, pos: 0 };
  if (lower.startsWith(t)) return { rank: 1, pos: 0 };
  const subs = allOccurrences(lower, t);
  if (subs.length) {
    const wordStart = subs.find((s) => isWordStart(text, s));
    return wordStart !== undefined ? { rank: 2, pos: wordStart } : { rank: 3, pos: subs[0] };
  }
  if (isChosungQuery(term)) {
    // 초성열은 원문과 1:1 인덱스 정렬이라 단어 경계 판정을 초성열에 그대로 적용
    const starts = allOccurrences(extractChosung(text), term.trim());
    if (starts.length) {
      const wordStart = starts.find((s) => isWordStart(text, s));
      return wordStart !== undefined ? { rank: 4, pos: wordStart } : { rank: 5, pos: starts[0] };
    }
  }
  if (isLatinQuery(term)) {
    const { roman, src } = toRomanInitials(text);
    const starts = allOccurrences(roman, t);
    if (starts.length) {
      const wordStart = starts.find((s) => isWordStart(text, src[s]));
      return wordStart !== undefined
        ? { rank: 4, pos: src[wordStart] }
        : { rank: 5, pos: src[starts[0]] };
    }
  }
  // 위치 무의미 — 같은 rank끼리는 필드 길이·입력 순서로 갈림
  if (subsequenceMatch(text, term)) return { rank: 6, pos: text.length };
  return { rank: Infinity, pos: Infinity };
}

// 아이템 정렬 키 — rank → 필드 순서(getFields 배열 순서=우선순위, 이름류가 앞) → 매치 위치 → 짧은 필드.
interface HitKey {
  rank: number;
  fieldIdx: number;
  pos: number;
  len: number;
}

function compareHitKey(a: HitKey, b: HitKey): number {
  return a.rank - b.rank || a.fieldIdx - b.fieldIdx || a.pos - b.pos || a.len - b.len;
}

// 공백·콤마 모두 AND 구분자 — "kim j"도 kim AND j로 처리(성·이름 순서 무관 매치).
function splitTerms(query: string): string[] {
  return query.split(/[\s,]+/).map((t) => t.trim()).filter((t) => t.length > 0);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MatchRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** 공백/콤마=AND(각 term이 어떤 필드에든 매치), 필드/모드=OR. query 비면 전체 통과(matches=[]). */
export function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => FieldSpec[],
): SearchHit<T>[] {
  const terms = splitTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({ item, matches: [] }));
  }
  const ranked: { hit: SearchHit<T>; key: HitKey }[] = [];
  for (const item of items) {
    const fields = getFields(item);
    const perField = new Map<string, MatchRange[]>();
    let allTermsMatched = true;
    // 모든 term이 매치해야 하므로 가장 약한 term의 키가 품질을 좌우 (SR-3 정렬)
    let worstKey: HitKey = { rank: 0, fieldIdx: 0, pos: 0, len: 0 };
    for (const term of terms) {
      let termMatched = false;
      let bestKey: HitKey | null = null;
      for (let fieldIdx = 0; fieldIdx < fields.length; fieldIdx++) {
        const f = fields[fieldIdx];
        const ranges = matchTerm(f.text, term);
        if (ranges) {
          termMatched = true;
          perField.set(f.field, [...(perField.get(f.field) ?? []), ...ranges]);
        }
        const quality = getTermQuality(f.text, term);
        if (quality.rank !== Infinity) {
          const key: HitKey = {
            rank: quality.rank,
            fieldIdx,
            pos: quality.pos,
            len: f.text.length,
          };
          if (bestKey === null || compareHitKey(key, bestKey) < 0) bestKey = key;
        }
      }
      if (!termMatched || bestKey === null) {
        allTermsMatched = false;
        break;
      }
      if (compareHitKey(bestKey, worstKey) > 0) worstKey = bestKey;
    }
    if (allTermsMatched) {
      const matches: FieldMatch[] = [...perField.entries()].map(([field, ranges]) => ({
        field,
        ranges: mergeRanges(ranges),
      }));
      ranked.push({ hit: { item, matches }, key: worstKey });
    }
  }
  // 품질 키 오름차순, 동키는 입력 순서 유지(안정).
  return ranked
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => compareHitKey(a.key, b.key) || a.i - b.i)
    .map((r) => r.hit);
}
