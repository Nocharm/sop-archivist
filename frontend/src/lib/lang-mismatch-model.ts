// 문서 언어 배치와 문장 언어가 어긋나는지 가리는 순수 모델 - 쪼개기 오른쪽 칸 언어 경고의 근거.
import type { LanguageLayout, ViewUnit } from "./api-sop";

export type LangMismatchReason = "singleLangOther" | "interleavedRun";

// 번갈아 배치에서 같은 언어가 이 줄 포함 3줄 이상 이어지면 어긋남으로 본다 - 한/영이 한 줄씩 짝을 이루는 배치라
// 같은 언어 둘 연속은 제목·번호 줄 등으로 흔하고, 셋부터는 짝이 밀렸거나 언어가 잘못 잡힌 신호다.
export const INTERLEAVED_RUN_LIMIT = 3;

type LangUnit = Pick<ViewUnit, "id" | "lang">;

/** neighbors는 문서 읽기 순서의 줄들(이 줄 포함 가능). 중립 언어 줄은 이어짐을 끊지도 세지도 않는다. */
export function findLangMismatch(layout: LanguageLayout, unit: LangUnit, neighbors: LangUnit[]): { reason: LangMismatchReason } | null {
  if (unit.lang !== "ko" && unit.lang !== "en") return null;
  if (layout === "ko_en_separate") return null;
  if (layout === "ko_only" || layout === "en_only") {
    const only = layout === "ko_only" ? "ko" : "en";
    return unit.lang !== only ? { reason: "singleLangOther" } : null;
  }
  const lined = neighbors.some((n) => n.id === unit.id) ? neighbors : [...neighbors, unit];
  const at = lined.findIndex((n) => n.id === unit.id);
  let run = 1;
  for (const step of [-1, 1]) {
    for (let i = at + step; i >= 0 && i < lined.length; i += step) {
      const lang = lined[i].lang;
      if (lang === "neutral") continue;
      if (lang !== unit.lang) break;
      run += 1;
    }
  }
  return run >= INTERLEAVED_RUN_LIMIT ? { reason: "interleavedRun" } : null;
}
