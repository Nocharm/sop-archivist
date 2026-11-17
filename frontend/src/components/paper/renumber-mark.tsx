// 캡션 앞의 다시 매긴 번호 표시("표 3 → 표 1", 머리 번호를 붙였으면 "+ 표 1") - Assign New 칸과 결과물 C가 같은 것을 쓴다.
// 저장된 캡션 글은 원래 번호 그대로라, 화면에 보이는 새 번호가 어디서 왔는지 툴팁으로 말한다.
"use client";

import { Tooltip } from "@/components/ui/tooltip";
import type { RenumberChange } from "@/lib/api-sop";
import { formatRenumber } from "@/lib/caption-ref-model";
import { useI18n } from "@/lib/i18n";

export function RenumberMark({ change, testId }: { change: RenumberChange; testId: string }) {
  const { t } = useI18n();
  return (
    <Tooltip label={t("assign.renumberTip")} align="start">
      <span className="renumber-mark" tabIndex={0} data-testid={testId}>
        {formatRenumber(change)}
      </span>
    </Tooltip>
  );
}
