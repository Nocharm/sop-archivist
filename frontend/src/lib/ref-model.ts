// 참조 줄(REF) 화면 규칙 - 다른 문서를 번호로 가리키는 줄의 번호 짐작과 확인이 남은 줄 세기(설계 2026-11-15-ref-paragraph — 구현 끝나 지웠다, git 이력).
import type { UnitRefDetail, ViewUnit, WrittenSentence } from "./api-sop";

// 문서 번호 꼴 - 서버의 제안 규칙(backend app/sop/refs.py)과 같다: 영문 대문자 머리 + 하이픈 마디 + 숫자 끝
const NUMBER = /(?<![A-Za-z0-9])[A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6}(?![A-Za-z0-9])/;

/** 글 안에서 문서 번호처럼 보이는 첫 글자 묶음 - 사람이 "참조 줄로 표시"를 열 때 번호 칸에 미리 넣는다. 없으면 빈 글 */
export function guessRefNumber(text: string): string {
  return NUMBER.exec(text)?.[0] ?? "";
}

/** 사람이 번호를 확인하기 전인 제안 */
export function isRefPending(unit: ViewUnit | undefined): boolean {
  return unit?.ref?.state === "proposed";
}

/** 줄(단위 여럿)에서 참조 카드를 보일 단위 - 확인이 남은 제안이 먼저, 없으면 확정된 참조 줄 */
export function pickRefUnit(units: readonly ViewUnit[]): ViewUnit | null {
  return units.find((unit) => isRefPending(unit)) ?? units.find((unit) => unit.ref !== null) ?? null;
}

export interface RefAdvice {
  /** 무엇이 EQUIS와 다른가 - 번호가 지금 번호가 아니거나, 번호는 맞는데 이름이 다르다 */
  issue: "number" | "title";
  /** EQUIS의 지금 번호·정식 이름으로 맞춘 글 */
  text: string;
}

/** 대소문자와 빈칸 차이는 같은 글로 본다(사용자 확인 2026-11-14 - 제목 비교) */
function fold(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * 참조 줄의 새 문장이 EQUIS와 어긋나는지 - 어긋나면 무엇이 다른지와 맞춘 글. 맞거나 견줄 것이 없으면 null.
 * 견줄 글은 서버가 준 제안이고, 제안이 없으면(원문이 이미 맞다) 원문이다. EQUIS가 그 번호를 모르거나 폐기했으면 견주지 않는다.
 */
export function readRefAdvice(text: string, sourceText: string, detail: UnitRefDetail | null): RefAdvice | null {
  const equis = detail?.equis;
  if (!equis || equis.state !== "found" || equis.retired !== null || equis.number === "") return null;
  const expected = detail.suggested_text ?? sourceText;
  if (fold(text) === fold(expected)) return null;
  return { issue: fold(text).includes(equis.number.toUpperCase()) ? "title" : "number", text: expected };
}

/** 이미 쓴 New 문서의 참조 줄에 붙는 작은 표시 - 번호·이름이 EQUIS와 다름, EQUIS가 모르는 번호, 폐기된 문서, 조회 실패 */
export type WrittenRefMark = "number" | "title" | "not_found" | "retired" | "failed";

/**
 * New 원문의 참조 줄에 보일 표시 - 문제없는 줄과 조회 중인 줄은 null이다(아무것도 띄우지 않는다).
 * EQUIS가 모르는 번호와 폐기된 문서는 서버가 견주지 않아 ref_issue가 비어 있고, 그 번호의 EQUIS 표시에서 읽는다.
 */
export function readWrittenRefMark(row: Pick<WrittenSentence, "ref" | "ref_issue">): WrittenRefMark | null {
  const equis = row.ref?.equis ?? null;
  if (equis?.state === "not_found") return "not_found";
  if (equis !== null && equis.retired !== null) return "retired";
  if (row.ref_issue) return row.ref_issue;
  // 조회에 실패했고 전에 받은 값도 없다 - 표시가 없으면 "문제없음"으로 읽히므로 못 봤다고 알린다
  if (equis?.state === "unavailable" && equis.verdict === null) return "failed";
  return null;
}

/** 조회 중인 참조 줄 수 - 0이 될 때까지 New 원문 목록을 다시 읽는다(서버는 한 번 읽을 때 10개씩 조회한다) */
export function countRefLookups(rows: ReadonlyArray<Pick<WrittenSentence, "ref">>): number {
  return rows.filter((row) => row.ref?.equis?.refreshing === true).length;
}
