// 올리기 창의 순수 규칙 - 파일 이름에서 문서 번호를 읽고(서버 app/sop/filename.py와 같은 식), 그 번호로 Old·New를 먼저 고르며,
// New 파일이 목록의 어느 줄에 붙는지 정한다. 서버가 같은 검사를 다시 한다 - 여기는 올리기 전에 미리 알려 주는 몫이다.
import type { TargetDoc } from "./api-sop";

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
