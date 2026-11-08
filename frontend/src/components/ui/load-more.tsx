// 점진 렌더 목록의 끝 표지 - 다음 묶음이 붙기 전 잠깐 보일 수 있는 자리를 최종 행 크기의 쉬머로 채운다.
"use client";

/** 표의 끝 표지 - 열 수만큼 쉬머 칸을 둔 행 */
export function LoadMoreRows({ sentinelRef, columns, testId }: { sentinelRef: (node: Element | null) => void; columns: number; testId: string }) {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <tr key={row} ref={row === 0 ? sentinelRef : undefined} data-testid={row === 0 ? testId : undefined} aria-hidden>
          {Array.from({ length: columns }, (_, cell) => (
            <td key={cell}>
              <span className="sk h-4" style={{ width: `${55 + ((row * 7 + cell * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** 목록(ul·div)의 끝 표지 - 줄 높이만큼 쉬머 줄 */
export function LoadMoreBlock({ sentinelRef, rowHeight, testId }: { sentinelRef: (node: Element | null) => void; rowHeight: number; testId: string }) {
  return (
    <div ref={sentinelRef} data-testid={testId} aria-hidden className="grid">
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid content-center gap-1.5 border-b border-line px-3" style={{ height: rowHeight }}>
          <span className="sk h-3 w-20" />
          <span className="sk h-3.5" style={{ width: `${60 + row * 12}%` }} />
        </div>
      ))}
    </div>
  );
}
