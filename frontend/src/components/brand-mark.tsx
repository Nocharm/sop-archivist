// 서비스 마크 - 쌓인 문장 조각과 오른쪽 종이 테두리, 가운데 줄 끝이 테두리를 뚫고 나가는 화살(조각을 새 자리로 보낸다).
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
      <rect x="6.5" y="3.5" width="17" height="2.6" rx="0.6" style={POP} />
      <rect x="6.5" y="7.5" width="17" height="2.6" rx="0.6" style={BASE} />
      <rect x="3" y="11.5" width="7.2" height="2.6" rx="0.6" style={BASE} />
      <rect x="11.6" y="11.5" width="6.2" height="2.6" rx="0.6" style={BASE} />
      <rect x="19.2" y="11.5" width="5" height="2.6" rx="0.6" style={BASE} />
      <rect x="3" y="15.5" width="6.2" height="2.6" rx="0.6" style={POP} />
      <rect x="10.6" y="15.5" width="8.8" height="2.6" rx="0.6" style={POP} />
      <path d="M20.8 15.5H27.4L29.4 16.8L27.4 18.1H20.8Z" style={POP} />
      <rect x="6.5" y="19.5" width="17" height="2.6" rx="0.6" style={BASE} />
      <rect x="4.6" y="23.5" width="18.9" height="2.6" rx="0.6" style={POP} />
      <path
        d="M24.2 4.8H24.7A1.5 1.5 0 0 1 26.2 6.3V13.6M26.2 20V26.1A1.5 1.5 0 0 1 24.7 27.6H7"
        style={{ fill: "none", stroke: "var(--mark-base)", strokeWidth: 1.6 }}
      />
    </svg>
  );
}
