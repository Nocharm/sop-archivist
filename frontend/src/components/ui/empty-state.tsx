// 빈 화면 - 내용이 없을 때 한 줄 문장 대신 가운데 박스에 아이콘·짧은 제목·한 줄 안내·다음 행동을 둔다. 모든 화면이 이 하나를 쓴다.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  testId: string;
  /** 표 칸 안처럼 좁은 자리 - 여백과 아이콘을 줄인다 */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, body, action, testId, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " compact" : ""}`} data-testid={testId}>
      <span className="empty-state-badge" aria-hidden>
        <Icon size={compact ? 20 : 26} strokeWidth={1.5} />
      </span>
      <p className="empty-state-title">{title}</p>
      {body && <p className="empty-state-body">{body}</p>}
      {action}
    </div>
  );
}
