// New 문서 목록에 번호로 줄을 더하는 규칙 - 한 번에 여러 번호(붙여 넣은 줄들)를 받아 이미 있는 번호를 가르고, 새 줄의 종류와 상위 SOP를 정한다.
// 그리고 EQUIS가 아는 값으로 줄의 칸을 채우자는 제안(자동으로 바꾸지 않고 사람이 누른다).
import type { EquisInfo, TargetDoc, TargetDocType } from "./api-sop";

/** Documents의 New 목록에 두는 도구 - 파일 올리기, 번호로 더하기, Excel 양식 · 가져오기, AI 목록 읽기, 표준 골격 선언, 칸 상태(막대 · 표 · 꼬리표), WI 단계 더하기 */
export type TobeTool = "upload" | "add_row" | "template" | "import" | "read_list" | "declare" | "sections" | "add_step";

const TOBE_TOOLS: readonly TobeTool[] = ["upload", "add_row", "template", "import", "read_list", "declare", "sections", "add_step"];

/** 지금 두는 도구 - 새 문서를 만드는 쪽을 숨긴 동안 쓴 파일을 올리는 것만 */
export function listTobeTools(drafting: boolean): readonly TobeTool[] {
  return drafting ? TOBE_TOOLS : TOBE_TOOLS.filter((tool) => tool === "upload");
}

/** 붙여 넣은 글에서 번호들 - 줄·탭·쉼표·세미콜론으로 가르고 앞뒤 공백을 걷는다. 같은 번호는 한 번만(처음 나온 순서) */
export function readCodes(text: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const piece of text.split(/[\n\r\t,;]+/)) {
    const code = piece.trim();
    if (code === "" || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export interface NewRow {
  code: string;
  doc_type: TargetDocType;
  parent_code: string | null;
}

export interface AddPlan {
  rows: NewRow[];
  /** 이미 목록에 있어 건너뛴 번호 */
  skipped: string[];
}

type Listed = Pick<TargetDoc, "code" | "doc_type">;

/** 번호가 종류를 말하는가 - "SOP-…"·"WI-…"로 시작하면 그 종류, 아니면 null */
export function readTypeFromCode(code: string): TargetDocType | null {
  const head = code.toUpperCase();
  if (/^SOP(?![A-Z])/.test(head)) return "sop";
  if (/^WI(?![A-Z])/.test(head)) return "wi";
  return null;
}

/**
 * 더할 줄들. 종류는 번호가 말하면 그대로(SOP-…, WI-…), 아니면 목록에 SOP가 있으면 WI, 없으면 SOP.
 * WI의 상위 SOP는 그 앞에서 가장 가까운 SOP(같이 더하는 줄 포함), 없으면 목록의 마지막 SOP. 둘 다 없으면 그 WI는 SOP로 더한다
 * (상위 없는 WI는 서버가 받지 않는다 - 줄을 만든 뒤 종류를 고친다).
 */
export function planAddRows(codes: readonly string[], listed: readonly Listed[]): AddPlan {
  const taken = new Set(listed.map((doc) => doc.code));
  let lastSop = [...listed].reverse().find((doc) => doc.doc_type === "sop")?.code ?? null;
  const rows: NewRow[] = [];
  const skipped: string[] = [];
  for (const code of codes) {
    if (taken.has(code)) {
      skipped.push(code);
      continue;
    }
    taken.add(code);
    const wanted = readTypeFromCode(code) ?? (lastSop === null ? "sop" : "wi");
    if (wanted === "wi" && lastSop !== null) rows.push({ code, doc_type: "wi", parent_code: lastSop });
    else {
      rows.push({ code, doc_type: "sop", parent_code: null });
      lastSop = code;
    }
  }
  return { rows, skipped };
}

export type AddPreview =
  | { kind: "none" } // 적은 번호가 없다
  | { kind: "sop"; code: string }
  | { kind: "wi"; code: string; parent: string }
  | { kind: "sopFallback"; code: string } // 번호는 WI인데 목록에 SOP가 없어 SOP로 더한다
  | { kind: "taken"; code: string } // 더할 줄이 없다 - 첫 번호가 이미 있다
  | { kind: "many"; n: number }; // 더할 줄이 둘 이상

/** 등록 칸에 적은 글이 무엇을 더하는가 - planAddRows(readCodes(text), listed)의 결과를 그대로 읽는다 */
export function describeAdd(text: string, listed: readonly Listed[]): AddPreview {
  const codes = readCodes(text);
  if (codes.length === 0) return { kind: "none" };
  const { rows } = planAddRows(codes, listed);
  if (rows.length === 0) return { kind: "taken", code: codes[0] };
  if (rows.length > 1) return { kind: "many", n: rows.length };
  const [row] = rows;
  if (row.doc_type === "wi" && row.parent_code !== null) return { kind: "wi", code: row.code, parent: row.parent_code };
  // 번호가 WI라고 말하는데 SOP로 들어간 줄만 알린다 - 번호만으론 종류를 모르는 줄은 처음부터 SOP다
  if (readTypeFromCode(row.code) === "wi") return { kind: "sopFallback", code: row.code };
  return { kind: "sop", code: row.code };
}

export const ADD_PREVIEW_KEYS: Readonly<Record<Exclude<AddPreview["kind"], "none">, string>> = {
  sop: "tobe.add.sop",
  wi: "tobe.add.wi",
  sopFallback: "tobe.add.sopFallback",
  taken: "tobe.add.taken",
  many: "tobe.add.many",
};

export type EquisHint =
  /** EQUIS가 이 문서를 SOP라고 한다 - 줄의 종류가 WI다 */
  | { kind: "type"; value: "sop" }
  /** EQUIS에 장비 번호가 있다 - 장비 SOP로 표시하지 않은 SOP다 */
  | { kind: "equipment"; tag: string };

/**
 * EQUIS 값으로 줄을 채우자는 제안 - 찾은 번호일 때만. 종류는 SOP로 읽히는 값만 제안한다(WI의 값은 실제 표에서 확인하지 못했다).
 * 장비 SOP는 EQUIS에 장비 번호가 있을 때 제안한다("있으면 장비 SOP"가 맞는지는 사람이 본다).
 */
export function listEquisHints(doc: Pick<TargetDoc, "doc_type" | "is_equipment_sop">, equis: EquisInfo | null | undefined): EquisHint[] {
  if (!equis || equis.state !== "found") return [];
  const hints: EquisHint[] = [];
  const isSop = /(^|[^A-Za-z])SOP([^A-Za-z]|$)/i.test(equis.subtype ?? "") || /standard operating procedure/i.test(equis.subtype ?? "");
  if (isSop && doc.doc_type !== "sop") hints.push({ kind: "type", value: "sop" });
  const tag = (equis.equipment_tag ?? "").trim();
  if (tag !== "" && doc.doc_type === "sop" && !doc.is_equipment_sop) hints.push({ kind: "equipment", tag });
  return hints;
}
