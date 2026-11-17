// AI 요청 항목(문서 전체 분류, 번역 등) - Assign 더보기 메뉴(components/assign/more-menu.tsx)가 그린다.
// 보내도 서버가 건너뛸 요청은 숨기지 않고 흐리게, 까닭은 disabledReason이다.

export interface AiAskItem {
  key: string;
  label: string;
  run: () => Promise<void>;
  /** 있으면 꺼진 항목 - 왜 못 쓰는지 사람 말로 */
  disabledReason?: string | null;
}
