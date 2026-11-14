// 확인이 필요한 추출 경고(누락 의심 등) - 문서 목록에서 모아 배정 화면이 한곳에서 확인하게 한다. 검토 요청 조건(unacked_missing_text)과 같은 것을 센다.

import type { DocSide, ExtractionWarning, SopDocument } from "./api-sop";

export interface AckWarning {
  docId: number;
  /** 문서 번호, 없으면 파일 이름 */
  docLabel: string;
  side: DocSide;
  warning: ExtractionWarning;
}

/** 확인을 받아야 하는 경고(이미 확인한 것 포함) - 문서 순서, 문서 안에서는 받은 순서 */
export function listAckWarnings(docs: readonly SopDocument[]): AckWarning[] {
  return docs.flatMap((doc) =>
    (doc.extraction?.warnings ?? [])
      .filter((warning) => warning.needs_ack)
      .map((warning) => ({ docId: doc.id, docLabel: doc.doc_code || doc.file_name, side: doc.side, warning })),
  );
}

/** 아직 확인하지 않은 수 - 0이 아니면 검토 요청이 막힌다 */
export function countPendingWarnings(items: readonly AckWarning[]): number {
  return items.filter((item) => item.warning.acked_by === null).length;
}
