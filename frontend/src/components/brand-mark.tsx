// 서비스 마크 - 네 줄로 쌓인 문장 조각(둘째 줄은 쪼갠 조각)과 오른쪽 종이 테두리, 셋째 줄 끝이 테두리를 뚫고 나가는 화살(조각을 새 자리로 보낸다). 22px 상단 바에서 뭉개지지 않게 줄 수를 줄이고 굵게 그린다.
// 색은 놓이는 바탕이 정한다: --mark-base(조각·테두리)와 --mark-pop(옮긴 조각). 파비콘 app/icon.svg가 같은 모양을 그린다.

interface BrandMarkProps {
  size: number;
  className?: string;
}

const BASE = { fill: "var(--mark-base)" };
const POP = { fill: "var(--mark-pop)" };

export function BrandMark({ size, className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden focusable="false">
      <rect x="6" y="4.4" width="16.5" height="3.6" rx="0.9" style={POP} />
      <rect x="3" y="10.4" width="8.6" height="3.6" rx="0.9" style={BASE} />
      <rect x="13.6" y="10.4" width="8.9" height="3.6" rx="0.9" style={BASE} />
      <rect x="3" y="16.4" width="9.4" height="3.6" rx="0.9" style={POP} />
      <path d="M14.4 16.4H26.6L29.6 18.2L26.6 20H14.4Z" style={POP} />
      <rect x="6" y="22.4" width="16.5" height="3.6" rx="0.9" style={BASE} />
      <path
        d="M24 3.6H24.5A1.8 1.8 0 0 1 26.3 5.4V14.4M26.3 22V26.6A1.8 1.8 0 0 1 24.5 28.4H7"
        style={{ fill: "none", stroke: "var(--mark-base)", strokeWidth: 2 }}
      />
    </svg>
  );
}
