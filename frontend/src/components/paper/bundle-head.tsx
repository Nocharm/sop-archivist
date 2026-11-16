// 표·그림 묶음 위 머리 줄 - 종류 표시 TABLE/FIGURE(REF 표시와 같은 자리·꼴로 조각 위 테두리에, 늘 보임) + 캡션 또는 미리보기 한 줄 + 표시 ID.
// 단추가 아니다 - 누르면 감싼 조각 상자의 data-strip-unit로 묶음 전체가 골라진다(paper.tsx handleClick). 툴팁은 감싼 영역의 useDelegatedTip이 data-tip으로 띄운다.
import type { ReactNode } from "react";

import { Truncate } from "@/components/ui/motion";
import { useI18n } from "@/lib/i18n";
import type { BundleHeader } from "@/lib/paper-model";

interface BundleHeadProps {
  head: BundleHeader;
  selected: boolean;
  testId: string;
  /** 묶음 캡션 - 있으면 미리보기 대신 보인다 */
  caption?: ReactNode;
  captionMissing?: boolean;
}

export function BundleHead({ head, selected, testId, caption, captionMissing = false }: BundleHeadProps) {
  const { t } = useI18n();
  const label = t(head.kind === "table" ? "paper.bundleTable" : "paper.bundleFigure");
  return (
    <div className="bundle-head" data-sel={selected ? "" : undefined} data-missing={captionMissing ? "" : undefined} data-testid={`${testId}-head-${head.unitId}`}>
      {/* 종류 표시는 화면 언어와 상관없이 영어(상태 표기 규칙), 풀이는 툴팁 */}
      <span className="lang-token strip-lang" data-lang="bundle" role="img" aria-label={label} data-tip={label}>
        {head.kind === "table" ? "TABLE" : "FIGURE"}
      </span>
      {caption ?? (
        <>
          {head.kind === "table" && head.preview !== "" && <span className="bundle-head-label">{t("paper.bundleFirstRow")}</span>}
          <Truncate text={head.preview} className="bundle-head-text" />
        </>
      )}
      <span className="bundle-head-id">{head.displayId}</span>
    </div>
  );
}
