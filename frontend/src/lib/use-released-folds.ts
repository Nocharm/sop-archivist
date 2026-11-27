// 저장되지 못해 풀린 삭제 줄(lib/deleted-fold-model listReleasedFolds) - 접을 단위가 바뀐 그 렌더에서 앞의 것과 견준다(effect 없이 렌더 중 상태 맞추기).
import { useState } from "react";

import { listReleasedFolds, type DeletedFold } from "@/lib/deleted-fold-model";

type Folds = ReadonlyMap<number, DeletedFold>;

const NO_FOLDS: Folds = new Map();

/** 버린 삭제의 접힌 내용 - 용지가 그 카드를 감싼 채 펼친다(A2-R6 "실패하면 거꾸로") */
export function useReleasedFolds(folds: Folds = NO_FOLDS): Folds {
  const [seen, setSeen] = useState<{ folds: Folds; released: Folds }>(() => ({ folds, released: NO_FOLDS }));
  if (seen.folds === folds) return seen.released;
  const released = listReleasedFolds(seen.released, seen.folds, folds);
  setSeen({ folds, released });
  return released;
}
