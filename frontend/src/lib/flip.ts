// FLIP(처음·끝 재기 → 거꾸로 옮기기 → 되돌아오며 움직이기)의 거리 계산 - 화면 부품은 components/ui/motion.tsx useFlip.

/** 줄마다 거꾸로 옮길 거리(처음 − 끝, px) - 두 쪽에서 다 잰 줄 중 실제로 움직인 줄만 */
export function computeFlipOffsets(first: ReadonlyMap<string, number>, last: ReadonlyMap<string, number>): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const [key, top] of first) {
    const end = last.get(key);
    if (end !== undefined && end !== top) offsets.set(key, top - end);
  }
  return offsets;
}
