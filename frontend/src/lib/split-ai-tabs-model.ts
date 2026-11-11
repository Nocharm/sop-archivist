// Split 오른쪽 칸 "AI suggestions" 탭 줄의 순수 모델 - 정하지 않은 나누기 제안을 문장(Unit)마다 탭 하나로, 문서 순서로 놓는다.

export interface PendingSplit {
  unitId: number;
  /** 탭에 쓰는 Unit 표시 번호 */
  label: string;
  /** 문서 순서에서의 위치 */
  position: number;
  /** 문서 전체 요청에서 나온 제안(문장 하나만 보낸 요청이 아니다) */
  batch: boolean;
}

export interface AiTab {
  unitId: number;
  label: string;
  /** 아직 열어 보지 않았다 */
  unseen: boolean;
  batch: boolean;
}

export function buildAiTabs(suggestions: readonly PendingSplit[], seen: ReadonlySet<number>): AiTab[] {
  const byUnit = new Map<number, PendingSplit>();
  for (const item of suggestions) if (!byUnit.has(item.unitId)) byUnit.set(item.unitId, item);
  return [...byUnit.values()]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ unitId: item.unitId, label: item.label, unseen: !seen.has(item.unitId), batch: item.batch }));
}

/** 일괄 요청에서 나온, 아직 정하지 않은 탭 수 - 탭 줄 머리 "Whole document · N left" */
export function countBatchLeft(tabs: readonly AiTab[]): number {
  return tabs.filter((tab) => tab.batch).length;
}
