// 언어 배치 그림 - 글자 대신 칸 배치로 보인다(파랑 = 한국어, 초록 = 영어). 드롭다운 값·업로드 행이 같이 쓴다.
import type { LanguageLayout } from "@/lib/api-sop";

// 칸 순서 - 위에서 아래(교차·한쪽만) 또는 왼쪽에서 오른쪽(분리)
const CELLS: Record<LanguageLayout, { dir: "rows" | "cols"; cells: Array<"ko" | "en"> }> = {
  ko_en_interleaved: { dir: "rows", cells: ["ko", "en", "ko", "en"] },
  ko_en_separate: { dir: "cols", cells: ["ko", "en"] },
  en_only: { dir: "rows", cells: ["en"] },
  ko_only: { dir: "rows", cells: ["ko"] },
};

export function LayoutPicto({ layout }: { layout: LanguageLayout }) {
  const { dir, cells } = CELLS[layout];
  return (
    <span className="layout-picto" data-dir={dir} data-n={cells.length} aria-hidden>
      {cells.map((cell, index) => (
        <i key={index} className={cell} />
      ))}
    </span>
  );
}

export function LayoutLabel({ layout, label }: { layout: LanguageLayout; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <LayoutPicto layout={layout} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
