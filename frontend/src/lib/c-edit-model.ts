// 결과물 C 문서 하나의 낙관적 편집 - 위·아래·깊이·번호 표시를 화면에서 먼저 바꾸고 번호를 미리 센다. 저장은 뒤에서 하고,
// 응답(서버가 그 문서를 C 모양으로 돌려준다)이 오면 그 문서를 서버 값으로 맞춘 뒤 보낸 뒤에 누른 편집만 다시 얹는다. 실패하면 저장 안 된 편집을 모두 버린다.
import type { NumberStyle, OutputCDoc, OutputCItem, TargetOrderItem } from "./api-sop";
import { numberLines } from "./section-number";
import type { MoveDir } from "./target-order";

export type CEdit =
  | { kind: "move"; locationKey: string; targetId: number; dir: MoveDir }
  | { kind: "indent"; targetId: number; depth: number }
  | { kind: "style"; targetId: number; style: NumberStyle };

/** saved = 마지막으로 받은 서버 문서, shown = 그 위에 edits를 얹은 화면 문서. sentCount = 날아가는 요청에 실린 앞쪽 편집 수 */
export interface DocDraft {
  saved: OutputCDoc;
  shown: OutputCDoc;
  edits: readonly CEdit[];
  sentCount: number;
}

export function startDraft(doc: OutputCDoc): DocDraft {
  return { saved: doc, shown: doc, edits: [], sentCount: 0 };
}

function setLineNumber(item: OutputCItem, number: string | null): OutputCItem {
  if (item.number === number && item.children.every((child) => child.number === number)) return item;
  return { ...item, number, children: item.children.map((child) => ({ ...child, number })) };
}

/**
 * 줄 번호만 다시 센다(서버 outputs.number_targets와 같은 규칙) - 칸 번호가 같은 칸끼리 한 줄(WI 한 단계의 Instruction·Why),
 * 번호 생략·주석 줄은 null, 표 칸은 표의 번호, 번호 없는 칸(입구 2 문서·단계 없는 WI)은 null.
 */
export function numberDoc(doc: OutputCDoc): OutputCDoc {
  const runs = new Map<string, Array<[number, number]>>();
  doc.sections.forEach((section, sectionIndex) => {
    if (section.number === null) return;
    const run = runs.get(section.number) ?? [];
    section.items.forEach((_, itemIndex) => run.push([sectionIndex, itemIndex]));
    runs.set(section.number, run);
  });
  const numbers = new Map<string, string | null>();
  for (const [base, run] of runs) {
    const depths = run.map(([s, i]) => {
      const item = doc.sections[s].items[i];
      return item.number_style === "numbered" ? item.indent_level : null;
    });
    numberLines(base, depths).forEach((number, k) => numbers.set(`${run[k][0]}:${run[k][1]}`, number));
  }
  return {
    ...doc,
    sections: doc.sections.map((section, s) => ({ ...section, items: section.items.map((item, i) => setLineNumber(item, numbers.get(`${s}:${i}`) ?? null)) })),
  };
}

/** 칸 안 줄 하나를 바꾼 문서 - 그 줄이 없으면 null */
function updateLine(doc: OutputCDoc, targetId: number, update: (item: OutputCItem) => OutputCItem): OutputCDoc | null {
  const sectionIndex = doc.sections.findIndex((section) => section.items.some((item) => item.target_id === targetId));
  if (sectionIndex < 0) return null;
  const sections = doc.sections.map((section, s) => (s === sectionIndex ? { ...section, items: section.items.map((item) => (item.target_id === targetId ? update(item) : item)) } : section));
  return { ...doc, sections };
}

/** 편집 하나를 얹고 번호를 다시 센 문서 - 칸 끝을 넘는 옮김이나 없는 줄이면 null */
function applyEdit(doc: OutputCDoc, edit: CEdit): OutputCDoc | null {
  if (edit.kind === "move") {
    const sectionIndex = doc.sections.findIndex((section) => section.location_key === edit.locationKey);
    const items = doc.sections[sectionIndex]?.items ?? [];
    const index = items.findIndex((item) => item.target_id === edit.targetId);
    const next = index + edit.dir;
    if (index < 0 || next < 0 || next >= items.length) return null;
    const moved = [...items];
    [moved[index], moved[next]] = [moved[next], moved[index]];
    return numberDoc({ ...doc, sections: doc.sections.map((section, s) => (s === sectionIndex ? { ...section, items: moved } : section)) });
  }
  const changed =
    edit.kind === "indent"
      ? updateLine(doc, edit.targetId, (item) => ({ ...item, indent_level: edit.depth }))
      : // 표 칸은 표의 표시를 싣는다
        updateLine(doc, edit.targetId, (item) => ({ ...item, number_style: edit.style, children: item.children.map((child) => ({ ...child, number_style: edit.style })) }));
  return changed && numberDoc(changed);
}

/** 화면 문서에 편집을 얹는다 - 칸 끝이거나 없는 줄이면 null */
export function addEdit(draft: DocDraft, edit: CEdit): DocDraft | null {
  const shown = applyEdit(draft.shown, edit);
  return shown && { ...draft, shown, edits: [...draft.edits, edit] };
}

/**
 * 보낼 요청 목록 - 화면 문서의 칸 순서대로 모든 줄을 한 번씩 싣고, 깊이·표시는 서버 문서(saved)와 다른 줄에만 붙인다.
 * 같은 값을 빼야 서버가 그대로 둔다 - 출처를 따라 바뀐 번역 깊이를 낡은 값으로 되보내면 422 translation_locked다.
 */
export function sendDraft(draft: DocDraft): { draft: DocDraft; items: TargetOrderItem[] } {
  const saved = new Map(draft.saved.sections.flatMap((section) => section.items).map((item) => [item.target_id, item]));
  const items = draft.shown.sections.flatMap((section) =>
    section.items.map((item) => {
      const before = saved.get(item.target_id);
      return {
        target_id: item.target_id,
        ...(before && before.indent_level !== item.indent_level ? { indent_level: item.indent_level } : {}),
        ...(before && before.number_style !== item.number_style ? { number_style: item.number_style } : {}),
      };
    }),
  );
  return { draft: { ...draft, sentCount: draft.edits.length }, items };
}

/** 저장 성공 - 서버 문서를 새 기준으로 두고, 보낸 뒤에 누른 편집만 그 위에 다시 얹는다(못 얹는 편집은 버린다). 남은 편집이 없으면 서버 문서 그대로 */
export function acceptSaved(draft: DocDraft, doc: OutputCDoc): DocDraft {
  let shown = doc;
  const edits: CEdit[] = [];
  for (const edit of draft.edits.slice(draft.sentCount)) {
    const next = applyEdit(shown, edit);
    if (!next) continue;
    shown = next;
    edits.push(edit);
  }
  return { saved: doc, shown, edits, sentCount: 0 };
}

/** 저장 실패 - 저장 안 된 편집(보낸 것과 그 뒤에 누른 것)을 모두 버리고 서버 문서로 돌아간다 */
export function rejectSaved(draft: DocDraft): DocDraft {
  return { saved: draft.saved, shown: draft.saved, edits: [], sentCount: 0 };
}
