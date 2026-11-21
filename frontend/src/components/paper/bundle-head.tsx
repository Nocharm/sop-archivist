// 표·그림 묶음 위 머리 줄 - 종류 표시 TABLE/FIGURE(REF 표시와 같은 자리·꼴로 조각 위 테두리에, 늘 보임) + 캡션(두 줄 말줄임, 고르면 펼침)
// 또는 캡션이 없으면 경고색 "Caption needed"(그림은 옛 추출의 그림 글 미리보기 한 줄 - 표의 1행 글은 캡션처럼 보이지 않게 두지 않는다, B10) + 표시 ID. 표의 머리 줄은 그 표의 캡션 자리다(F7 - 표는 위, 그림은 그림 아래 따로).
// 단추가 아니다 - 누르면 감싼 조각 상자의 data-strip-unit로 묶음 전체가 골라진다(paper.tsx handleClick). 툴팁은 감싼 영역의 useDelegatedTip이 data-tip으로 띄운다.
import type { ReactNode } from "react";

import { Truncate } from "@/components/ui/motion";
import { getCaptionScope } from "@/lib/caption-slot-model";
import { useI18n } from "@/lib/i18n";
import type { BundleHeader } from "@/lib/paper-model";

interface BundleHeadProps {
  head: BundleHeader;
  selected: boolean;
  testId: string;
  /** 묶음 캡션 - 있으면 미리보기 대신 보인다 */
  caption?: ReactNode;
  /** 캡션이 없고 있어야 한다 - 미리보기 앞에 경고 */
  captionMissing?: boolean;
  /** 이 머리 줄이 그 묶음의 캡션 자리다(표) - 끌어 놓을 곳(data-caption-slot)이고 캡션 칩이 나고 드는 전환 범위 */
  slotId?: number;
  /** 캡션이 머리 줄 밖(그림 아래 캡션 자리)에 있다 - 미리보기를 두지 않는다 */
  hidePreview?: boolean;
}

export function BundleHead({ head, selected, testId, caption, captionMissing = false, slotId, hidePreview = false }: BundleHeadProps) {
  const { t } = useI18n();
  const label = t(head.kind === "table" ? "paper.bundleTable" : "paper.bundleFigure");
  return (
    <div
      className="bundle-head"
      data-sel={selected ? "" : undefined}
      data-missing={captionMissing ? "" : undefined}
      data-caption-slot={slotId}
      data-unwrap-scope={slotId === undefined ? undefined : getCaptionScope(slotId)}
      data-testid={`${testId}-head-${head.unitId}`}
    >
      {/* 종류 표시는 화면 언어와 상관없이 영어(상태 표기 규칙), 풀이는 툴팁 */}
      {/* 고른 묶음의 것만 Tab으로 닿아 툴팁을 연다(REF 표시와 같이) */}
      <span className="lang-token strip-lang" data-lang="bundle" role="img" aria-label={label} data-tip={label} tabIndex={selected ? 0 : -1}>
        {head.kind === "table" ? "TABLE" : "FIGURE"}
      </span>
      {caption ?? (
        <>
          {captionMissing && (
            // 캡션이 붙으면 옅어진다(F10 걷기) - 표는 머리 줄이 캡션 자리 전환 범위다
            <span className="bundle-head-missing" data-unwrap-leave="" data-testid={`${testId}-caption-missing-${head.unitId}`}>
              {t("paper.captionNeeded")}
            </span>
          )}
          {!hidePreview && <Truncate text={head.preview} className="bundle-head-text" />}
        </>
      )}
      <span className="bundle-head-id">{head.displayId}</span>
    </div>
  );
}
