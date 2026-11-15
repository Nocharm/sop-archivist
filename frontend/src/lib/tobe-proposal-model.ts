// 새 문서 목록 AI 제안의 미리 보기 - 제안 줄을 화면 줄로 만들고, 더할 수 없는 까닭을 찾고, 저장할 순서를 정한다.
// AI는 제안만 한다: 여기서 고른 줄을 사람이 Add로 저장한다(지금 목록에 더한 전체를 한 번에 보낸다). 이미 목록에 있는 번호는 기본으로 뺀다.
import type { ProposedDoc, TargetDocType, ToBe, ToBeInput, ToBeProposal } from "./api-sop";

export interface ProposalRow {
  code: string;
  title: string;
  doc_type: TargetDocType | null;
  parent_code: string | null;
  is_equipment_sop: boolean;
  steps: string[];
  /** 이 줄을 더한다 */
  isPicked: boolean;
  /** 이미 목록에 있는 번호 - 고를 수 없다 */
  isListed: boolean;
}

/** 제안 → 화면 줄. 이미 목록에 있는 번호는 빼 두고, 나머지는 고른 채로 시작한다 */
export function buildProposalRows(proposal: ToBeProposal): ProposalRow[] {
  const listed = new Set(proposal.listed_codes);
  return proposal.docs.map((doc) => ({ ...doc, steps: [...doc.steps], isPicked: !listed.has(doc.code), isListed: listed.has(doc.code) }));
}

/** 상위 SOP로 고를 수 있는 번호 - 고른 줄 가운데 SOP와, 이미 목록에 있는 SOP */
export function listParentChoices(rows: readonly ProposalRow[], listedSops: readonly string[]): string[] {
  const picked = rows.filter((row) => row.isPicked && row.doc_type === "sop").map((row) => row.code);
  return [...new Set([...listedSops, ...picked])];
}

export type ProposalProblem =
  /** 고른 줄이 없다 */
  | { kind: "none" }
  /** 종류를 고르지 않은 줄 */
  | { kind: "type"; code: string }
  /** 상위 SOP가 없거나, 고른 상위가 더해지지 않는 줄을 가리키는 WI */
  | { kind: "parent"; code: string };

/** 더하기 전에 걸리는 첫 문제 - 없으면 null. 서버도 같은 것을 거절하지만 어느 줄인지 먼저 알린다 */
export function findProposalProblem(rows: readonly ProposalRow[], listedSops: readonly string[]): ProposalProblem | null {
  const picked = rows.filter((row) => row.isPicked);
  if (picked.length === 0) return { kind: "none" };
  const parents = new Set(listParentChoices(rows, listedSops));
  for (const row of picked) {
    if (row.doc_type === null) return { kind: "type", code: row.code };
    if (row.doc_type === "wi" && (row.parent_code === null || !parents.has(row.parent_code))) return { kind: "parent", code: row.code };
  }
  return null;
}

/** 저장할 순서 - SOP를 먼저(그 아래 WI가 상위를 찾게), 그다음 WI. 같은 종류 안에서는 제안의 순서 */
export function orderProposalWrites(rows: readonly ProposalRow[]): ProposalRow[] {
  const picked = rows.filter((row) => row.isPicked && row.doc_type !== null);
  return [...picked.filter((row) => row.doc_type === "sop"), ...picked.filter((row) => row.doc_type === "wi")];
}

/**
 * 고른 줄을 지금 목록에 더한 전체 목록 - 저장 한 번으로 보낸다. 있던 줄·N/A·단계는 받은 그대로 싣는다.
 * 줄마다 따로 보내면 200줄에 요청 760번, 1분이 걸렸고 중간에 멈추면 일부만 들어갔다 - 한 번이면 다 들어가거나 하나도 안 들어간다.
 */
export function buildProposalInput(tobe: ToBe, rows: readonly ProposalRow[]): ToBeInput {
  let order = Math.max(-1, ...tobe.docs.map((doc) => doc.order_index));
  const docs: ToBeInput["docs"] = tobe.docs.map(({ code, title, doc_type, parent_code, is_equipment_sop, order_index }) => ({ code, title, doc_type, parent_code, is_equipment_sop, order_index }));
  const steps = [...tobe.wi_steps];
  for (const row of orderProposalWrites(rows)) {
    if (row.doc_type === null) continue;
    order += 1;
    const isWi = row.doc_type === "wi";
    docs.push({ code: row.code, title: row.title, doc_type: row.doc_type, parent_code: isWi ? row.parent_code : null, is_equipment_sop: !isWi && row.is_equipment_sop, order_index: order });
    if (isWi) steps.push(...row.steps.map((title, index) => ({ code: row.code, step_no: index + 1, title })));
  }
  return { revision: tobe.revision, docs, na_slots: tobe.na_slots, wi_steps: steps };
}

function isSameDoc(row: ProposalRow, doc: ProposedDoc): boolean {
  return (
    row.title === doc.title &&
    row.doc_type === doc.doc_type &&
    row.parent_code === doc.parent_code &&
    row.is_equipment_sop === doc.is_equipment_sop &&
    row.steps.join("\n") === doc.steps.join("\n")
  );
}

/** 요청을 보낸 때의 눈금 - 그때 있던 제안의 id(없으면 0)와 그때까지 멈춘 읽기 작업 수 */
export interface ReadWait {
  after: number;
  stopped: number;
}

/**
 * 요청 뒤 창이 보일 것 - 새 제안이 오면 끝(idle), 그 사이 멈춘 작업(실패·반영 안 됨·취소)이 늘었으면 stopped, 아니면 waiting.
 * 제안이 먼저다: 실패한 작업을 다시 돌려 제안이 왔으면 그 제안을 보인다.
 */
export function decideReadWait(wait: ReadWait | null, proposalId: number | null, stopped: number): "idle" | "waiting" | "stopped" {
  if (wait === null || (proposalId !== null && proposalId > wait.after)) return "idle";
  return stopped > wait.stopped ? "stopped" : "waiting";
}

/** 사람이 한 일의 기록 - 새 줄을 모두 그대로 더했으면 as_is, 고치거나 일부만 더했으면 edited */
export function decideProposalAdoption(proposal: ToBeProposal, rows: readonly ProposalRow[]): "as_is" | "edited" {
  const isUntouched = rows.every((row, index) => (row.isListed || row.isPicked) && isSameDoc(row, proposal.docs[index]));
  return isUntouched ? "as_is" : "edited";
}
