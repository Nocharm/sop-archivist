// New 문서 목록에 번호로 줄을 더하는 규칙 - 한 번에 여러 번호(붙여 넣은 줄들)를 받아 이미 있는 번호를 가르고, 새 줄의 종류와 상위 SOP를 정한다.
// 그리고 EQUIS가 아는 값으로 줄의 칸을 채우자는 제안(자동으로 바꾸지 않고 사람이 누른다).
import type { EquisInfo, TargetDoc, TargetDocType } from "./api-sop";

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
function readTypeFromCode(code: string): TargetDocType | null {
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
