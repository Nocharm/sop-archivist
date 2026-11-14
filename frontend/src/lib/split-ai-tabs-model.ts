// Split 오른쪽 칸 "AI suggestions" 탭 줄의 순수 모델 - 정하지 않은 나누기 제안을 문장(Unit)마다 탭 하나로, 문서 순서로 놓는다.

export interface PendingSplit {
  unitId: number;
  /** 탭에 쓰는 Unit 표시 번호 */
  label: string;
  /** 문서 순서에서의 위치 */
  position: number;
  /** 요청 출처 - 이 화면에서 보낸 것만 안다(새로고침 뒤·다른 사람의 요청은 unknown) */
  origin: AiOrigin;
}

export type AiOrigin = "single" | "batch" | "unknown";

export interface AiTab {
  unitId: number;
  label: string;
  /** 아직 열어 보지 않았다 */
  unseen: boolean;
  origin: AiOrigin;
}

export function buildAiTabs(suggestions: readonly PendingSplit[], seen: ReadonlySet<number>): AiTab[] {
  const byUnit = new Map<number, PendingSplit>();
  for (const item of suggestions) if (!byUnit.has(item.unitId)) byUnit.set(item.unitId, item);
  return [...byUnit.values()]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ unitId: item.unitId, label: item.label, unseen: !seen.has(item.unitId), origin: item.origin }));
}

/** 탭 줄 머리의 남은 수 - 일괄 출처가 있으면 "Whole document · N left", 출처를 모르는 탭만 있으면 이름 없이 "N left" */
export function getAiTabsHead(tabs: readonly AiTab[]): { kind: "batch" | "plain"; n: number } | null {
  const batch = tabs.filter((tab) => tab.origin === "batch").length;
  if (batch > 0) return { kind: "batch", n: batch };
  const unknown = tabs.filter((tab) => tab.origin === "unknown").length;
  return unknown > 0 ? { kind: "plain", n: unknown } : null;
}

/** 원문을 제안 위치에서 자른 조각들(미리보기) - 글 밖의 위치는 버리고, 빈 조각은 뺀다. 쪼개기와 배정 화면이 함께 쓴다 */
export function cutSplitPieces(text: string, offsets: readonly number[]): string[] {
  const points = [...offsets].filter((at) => at > 0 && at < text.length).sort((a, b) => a - b);
  const pieces: string[] = [];
  let start = 0;
  for (const at of points) {
    pieces.push(text.slice(start, at));
    start = at;
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}
