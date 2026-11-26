// 떨어진 짝 괄호선(11-23 명세 E1) - 고른 박스와 떨어진 짝이 모두 그 칸 화면 안이면 앞머리 왼쪽에 세로선 하나(규칙은 lib/pair-bracket-model). Old · New 같다.
// 표시 전용(누르는 동작 없음)이고, 보이는 동안은 용지가 안내 줄을 숨긴다(onShown). 화면 밖 덩어리의 박스는 재지 않는다(E1-R3) - 덩어리 상자를 먼저 본다.
// 다시 재는 때는 짝 선과 같은 훅(lib/use-pane-measure) - 새 이펙트를 두지 않는다.
"use client";

import { useRef, useState, type RefObject } from "react";

import { readFarSide } from "@/lib/link-direction-model";
import { resolvePairBracket, type BracketEnd } from "@/lib/pair-bracket-model";
import { usePaneMeasure } from "@/lib/use-pane-measure";

type Bracket = ReturnType<typeof resolvePairBracket>;

interface PairBracketProps {
  side: "old" | "new";
  /** 고른 박스 - 없으면(그림 탭 · 고름 없음) 그리지 않는다 */
  pickedId: number | null;
  /** 고른 박스의 짝 구성원(lib/pair-bracket-model listPairMates) */
  mateIds: readonly number[];
  /** 괄호선이 보이는가 - 고른 박스나 값이 바뀔 때만 알린다 */
  onShown: (shown: boolean) => void;
}

/** 그 칸 몸통에서 Unit의 박스 - 줄 조각 · 표 칸 조각 · 접힌 삭제 줄(몸통 밖 위치 판의 조각은 보지 않는다) */
function findBox(body: ParentNode, unitId: number): HTMLElement | null {
  return body.querySelector<HTMLElement>(`:is(.strip, .cell-piece, .deleted-line)[data-strip-unit="${unitId}"]`);
}

/** 박스의 앞머리 상자 - 화면 밖 덩어리이거나 박스가 없으면(접힌 줄 · 다른 탭) null. 앞머리가 없는 박스는 그 박스 */
function readEnd(unitId: number, box: HTMLElement | null, frame: DOMRect): BracketEnd | null {
  if (box === null) return null;
  const chunk = box.closest(".strip-chunk");
  if (chunk !== null && readFarSide(chunk.getBoundingClientRect(), frame) !== null) return null;
  const lead = box.closest(".strip-row")?.querySelector<HTMLElement>(":scope > .strip-lead") ?? box;
  const rect = lead.getBoundingClientRect();
  return { unitId, top: rect.top, left: rect.left, height: rect.height };
}

/** 그리는 층 - 경로 하나, 없으면 빈 SVG(틀을 찾는 자리라 늘 둔다) */
export function PairBracketSvg({ side, bracket, svgRef }: { side: "old" | "new"; bracket: Bracket; svgRef?: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={svgRef} className="pair-bracket" data-side={side} aria-hidden>
      {bracket && <path d={bracket.d} data-units={bracket.unitIds.join(",")} data-testid="assign-pair-bracket" />}
    </svg>
  );
}

/** 두 칸을 담은 틀(.assign-panes) 안에 둔다 - 틀이 좌표 기준이다 */
export function PairBracket({ side, pickedId, mateIds, onShown }: PairBracketProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [bracket, setBracket] = useState<Bracket>(null);
  // 마지막으로 알린 "고른 박스:보임" - 같은 값이면 다시 알리지 않는다
  const toldRef = useRef("");
  const pane = `[data-pane="${side}"]`;

  function readBracket(): Bracket {
    const root = svgRef.current?.parentElement;
    if (!root || pickedId === null || mateIds.length === 0) return null;
    const paneEl = root.querySelector<HTMLElement>(pane);
    const body = paneEl?.querySelector<HTMLElement>(".pane-body");
    if (!paneEl || !body || paneEl.dataset.tab === "figures") return null;
    const pickedBox = findBox(body, pickedId);
    // 이어 붙은 카드 안의 구성원은 바로 곁이라 잇지 않는다(안내 줄과 같은 규칙)
    const card = pickedBox?.closest(".strip-card") ?? null;
    const far = mateIds.flatMap((id) => {
      const box = findBox(body, id);
      return card !== null && box?.closest(".strip-card") === card ? [] : [{ id, box }];
    });
    if (far.length === 0) return null;
    const frame = body.getBoundingClientRect();
    const picked = readEnd(pickedId, pickedBox, frame);
    if (picked === null) return null;
    const mates: (BracketEnd | null)[] = [];
    for (const mate of far) {
      const end = readEnd(mate.id, mate.box, frame);
      // 하나라도 화면 밖이면 그리지 않는다 - 나머지는 재지 않는다
      if (end === null) return null;
      mates.push(end);
    }
    return resolvePairBracket(picked, mates, frame, root.getBoundingClientRect());
  }

  function measure() {
    const next = readBracket();
    setBracket((prev) => (prev?.d === next?.d && prev?.unitIds.join() === next?.unitIds.join() ? prev : next));
    const told = `${pickedId}:${next !== null}`;
    if (told !== toldRef.current) {
      toldRef.current = told;
      onShown(next !== null);
    }
  }

  usePaneMeasure({ rootRef: svgRef, observe: `${pane} .pane-body, ${pane} .pane-body > *`, measure, key: `${pickedId}:${mateIds.join(",")}` });

  return <PairBracketSvg side={side} bracket={bracket} svgRef={svgRef} />;
}
