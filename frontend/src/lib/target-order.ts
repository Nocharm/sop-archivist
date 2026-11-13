// 결과물 C 순서 바꾸기 - 칸 안에서 새 문장 하나를 위·아래로 옮긴 뒤, 서버가 받는 "그 새 문서의 새 문장 전부, 새 순서대로" 목록을 만든다.
// C는 한 벌이라 칸마다 두 언어 문장이 C 순서대로 한 목록이다 - 칸을 차례로 이으면 문서 전체 순서다. 칸 제목·표 안 칸 새 문장은 C 항목이 아니라 빠진다(서버도 받지 않는다).
import type { OutputC, OutputCItem, TargetOrderItem } from "./api-sop";

export type MoveDir = -1 | 1;

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

/** 새 문서 전체 순서 - 칸을 차례로 잇는다. reorder가 칸의 줄을 바꿔 주면 그 순서를 쓴다. 문서가 없으면 null */
function listDocOrder(output: OutputC, targetDocId: number, reorder: (locationKey: string, items: readonly OutputCItem[]) => readonly OutputCItem[]): number[] | null {
  const doc = output.docs.find((item) => item.target_doc_id === targetDocId);
  return doc ? doc.sections.flatMap((section) => reorder(section.location_key, section.items).map((item) => item.target_id)) : null;
}

/** 옮긴 뒤의 새 문서 전체 순서(target_id). 옮길 수 없거나 문서가 없으면 null */
export function buildTargetOrder(output: OutputC, targetDocId: number, locationKey: string, targetId: number, dir: MoveDir): number[] | null {
  let moved: OutputCItem[] | null = null;
  const order = listDocOrder(output, targetDocId, (key, items) => {
    if (key !== locationKey) return items;
    moved = moveWithin(items, targetId, dir);
    return moved ?? items;
  });
  return order && moved ? order : null;
}

/** 줄 하나에 바꿀 값 - 깊이·번호 표시. 뺀 값은 서버가 그대로 둔다 */
export type TargetPatch = Omit<TargetOrderItem, "target_id" | "wi_step">;

/**
 * 깊이·번호 표시만 바꾸는 요청 목록 - 서버는 문서의 새 문장 전부를 받으므로 지금 순서 그대로 싣고, 바꿀 줄(patches)에만 값을 붙인다.
 * 나머지 줄은 값을 빼서 그대로 둔다.
 */
export function buildPatchItems(output: OutputC, targetDocId: number, patches: ReadonlyMap<number, TargetPatch>): TargetOrderItem[] | null {
  const order = listDocOrder(output, targetDocId, (_key, items) => items);
  return order && order.map((id) => ({ target_id: id, ...patches.get(id) }));
}
