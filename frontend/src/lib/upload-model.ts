// 올리기 창의 순수 규칙 - 파일 이름에서 문서 번호를 읽고(서버 app/sop/filename.py와 같은 식), 그 번호로 Old·New를 먼저 고르며,
// New 파일이 목록의 어느 줄에 붙는지 정한다. 서버가 같은 검사를 다시 한다 - 여기는 올리기 전에 미리 알려 주는 몫이다.
import type { TargetDoc, TargetDocType } from "./api-sop";

// 확장자는 글자로 시작하는 끝 조각만 - "Rev.2"의 ".2" 같은 버전을 확장자로 잘라 내지 않게(서버와 같다)
const EXTENSION_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const CODE_RE = /(?<![A-Za-z0-9])([A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6})(?![A-Za-z0-9])/;
// documents.doc_code 길이 - 넘는 값은 번호로 치지 않는다
const MAX_CODE_CHARS = 100;

/** 파일 이름의 첫 문서 번호 - 없으면 "" */
export function readFileCode(fileName: string): string {
  const stem = fileName.normalize("NFC").replace(EXTENSION_RE, "").replaceAll("_", " ");
  const code = CODE_RE.exec(stem)?.[1] ?? "";
  return code.length > MAX_CODE_CHARS ? "" : code;
}

export type UploadSide = "old" | "new";

/** 앱이 먼저 고르는 쪽 - 번호가 New 목록에 있으면 New. 그 번호가 이미 올린 Old 문서의 번호이기도 하면 Old로 둔다 */
export function guessUploadSide(code: string, newCodes: ReadonlySet<string>, oldCodes: ReadonlySet<string>): UploadSide {
  return code !== "" && newCodes.has(code) && !oldCodes.has(code) ? "new" : "old";
}

export type NewUploadPlan =
  /** 번호가 같은 빈 줄에 붙는다 - 종류·상위 SOP는 그 줄의 것 */
  | { kind: "attach"; code: string }
  /** 줄이 새로 생긴다 - 종류와 상위 SOP를 고른다 */
  | { kind: "create" }
  /** 그 번호의 줄에 붙일 수 없다 - 까닭의 문구 키 */
  | { kind: "blocked"; reasonKey: string };

type ListedDoc = Pick<TargetDoc, "id" | "code" | "entrance" | "document_id">;

/** New로 올릴 파일이 목록에서 갈 자리. usedDocIds는 문장이 든 줄(붙이면 그 문장들의 자리가 없어진다) */
export function planNewUpload(code: string, docs: readonly ListedDoc[], usedDocIds: ReadonlySet<number>): NewUploadPlan {
  const row = code === "" ? undefined : docs.find((doc) => doc.code === code);
  if (row === undefined) return { kind: "create" };
  if (row.entrance === "match" || row.document_id !== null) return { kind: "blocked", reasonKey: "upload.why.hasFile" };
  if (usedDocIds.has(row.id)) return { kind: "blocked", reasonKey: "upload.why.inUse" };
  return { kind: "attach", code };
}

/** 고른 파일 한 줄 - side가 null이면 앱이 고른 쪽을 쓴다(사람이 누르거나 끌거나 묶음에 놓으면 그 값) */
export interface PickedFile {
  id: string;
  file: File;
  side: UploadSide | null;
  docType: TargetDocType;
  parentCode: string;
}

/** 고른 목록에 파일을 더한다 - 이름과 크기가 같은 파일은 다시 더하지 않는다(더하는 파일끼리도). 있던 줄은 그대로다 */
export function addPickedFiles(picked: readonly PickedFile[], files: readonly File[], side: UploadSide | null, makeId: () => string): PickedFile[] {
  const next = [...picked];
  for (const file of files) {
    if (next.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
    next.push({ id: makeId(), file, side, docType: "sop", parentCode: "" });
  }
  return next;
}

/** 줄이나 파일을 놓은 묶음이 정하는 쪽 - 같은 묶음이거나 묶음 밖이면 null(바뀌지 않는다) */
export function resolveSideDrop(current: UploadSide | null, zone: UploadSide | null): UploadSide | null {
  return zone === current ? null : zone;
}

/** 올리는 차례 - Old인 줄의 자리(고른 순서) 다음에 New인 줄의 자리 */
export function listUploadOrder(sides: readonly UploadSide[]): number[] {
  const indexes = sides.map((_, index) => index);
  return [...indexes.filter((index) => sides[index] === "old"), ...indexes.filter((index) => sides[index] === "new")];
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/** 파일 크기 - 1 MB 미만은 KB(반올림, 최소 1), 그 이상은 MB 소수 한 자리 */
export function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_MB) return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
