// 결과물 C 순서 바꾸기 - 한 판(KO 또는 EN) 안에서 새 문장 하나를 위·아래로 옮긴 뒤, 서버가 받는 "그 새 문서의 새 문장 전부, 새 순서대로" 목록을 만든다.
// 판마다 자기 언어 문장만 보이므로 두 판을 칸(location_key)마다 이어 붙인다. 각 판 안의 상대 순서만 화면에 드러나니 이 이음으로 충분하다.
import type { OutputC, OutputCItem } from "./api-sop";

export type MoveDir = -1 | 1;

type Doc = OutputC["docs"][number];

function findDoc(output: OutputC, targetDocId: number): Doc | undefined {
  return output.docs.find((doc) => doc.target_doc_id === targetDocId);
}

/** 칸 안에서 한 칸 옮긴 목록 - 끝에 닿았으면 null */
function moveWithin(items: readonly OutputCItem[], targetId: number, dir: MoveDir): OutputCItem[] | null {
  const index = items.findIndex((item) => item.target_id === targetId);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= items.length) return null;
  const moved = [...items];
  [moved[index], moved[next]] = [moved[next], moved[index]];
  return moved;
}

/** 옮길 수 있는가 - 단추를 그릴지 정한다 */
export function canMoveTarget(items: readonly OutputCItem[], targetId: number, dir: MoveDir): boolean {
  return moveWithin(items, targetId, dir) !== null;
}

/**
 * 옮긴 뒤의 새 문서 전체 순서(target_id). current는 지금 보는 판, other는 다른 판. 칸 새 문장(표 안 칸)은 표에 딸려 빠진다.
 * 옮길 수 없거나 문서가 없으면 null.
 */
export function buildTargetOrder(current: OutputC, other: OutputC, targetDocId: number, locationKey: string, targetId: number, dir: MoveDir): number[] | null {
  const doc = findDoc(current, targetDocId);
  if (!doc) return null;
  const otherDoc = findDoc(other, targetDocId);
  let changed = false;
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  for (const section of doc.sections) {
    let items: readonly OutputCItem[] = section.items;
    if (section.location_key === locationKey) {
      const moved = moveWithin(section.items, targetId, dir);
      if (!moved) return null;
      items = moved;
      changed = true;
    }
    for (const item of items) push(item.target_id);
    for (const item of otherDoc?.sections.find((other) => other.location_key === section.location_key)?.items ?? []) push(item.target_id);
  }
  // 다른 판에만 있는 칸(이 판에 문장이 없는 칸)도 빠뜨리지 않는다
  for (const section of otherDoc?.sections ?? []) for (const item of section.items) push(item.target_id);
  return changed ? order : null;
}
