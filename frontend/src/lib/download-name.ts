// 내려받는 파일 이름 규칙 단일 소스 — 내보내기 기능이 생기면 모두 이 함수로 이름을 짓는다.
// 조각은 `_`로 잇고 빈 조각은 뺀다(조각이 비어 `__`가 생기던 문제). 시각은 KST `YYYYMMDD-HHmm`
// (toISOString은 UTC라 오전에 받은 파일이 전날 날짜로 찍힌다).

import { formatKst } from "@/lib/datetime";

/** 파일 이름에 쓸 수 없는 문자·공백을 `-`로, 연속 `-`는 하나로, 앞뒤 `-`·`.`은 떼어 낸다. 글자는 모든 언어 허용. */
export function sanitizeFileNamePart(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** KST 기준 `YYYYMMDD-HHmm`. */
export function formatDownloadStamp(now: Date = new Date()): string {
  // formatKst → "YYYY-MM-DD HH:mm"
  const [date, time] = formatKst(now.toISOString()).split(" ");
  return `${date.replace(/-/g, "")}-${time.replace(":", "")}`;
}

/** 조각 + KST 시각 + 확장자. 조각이 모두 비면 `sop-archivist`로 시작한다. */
export function buildDownloadName(
  parts: ReadonlyArray<string | null | undefined>,
  ext: string,
  now: Date = new Date(),
): string {
  const kept = parts.map((part) => sanitizeFileNamePart(part ?? "")).filter((part) => part !== "");
  return `${[...(kept.length > 0 ? kept : ["sop-archivist"]), formatDownloadStamp(now)].join("_")}.${ext}`;
}
