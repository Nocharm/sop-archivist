// 문서 버전 입력 규칙 - 저장 값은 글자 그대로지만 화면에서는 숫자와 점만 받고, 위아래 단추가 사람의 버전 올림 습관을 따른다.

const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** 위(1)·아래(-1). 소수점 아래가 0이면 앞자리가 움직이고(최소 1.0), 0이 아니면 뒷자리가 움직인다(2.9 → 2.10) */
export function stepVersion(value: string, dir: 1 | -1): string {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return "1.0";
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  if (minor === 0) return `${Math.max(1, major + dir)}.0`;
  return `${major}.${Math.max(0, minor + dir)}`;
}

/** 숫자와 첫 점 하나만 남긴다 - 붙여 넣은 "v3.1a"도 "3.1"이 된다 */
export function sanitizeVersion(text: string): string {
  const kept = text.replace(/[^\d.]/g, "");
  const dot = kept.indexOf(".");
  return dot < 0 ? kept : `${kept.slice(0, dot + 1)}${kept.slice(dot + 1).replace(/\./g, "")}`;
}
