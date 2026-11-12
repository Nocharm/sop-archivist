// 상태 표시 - 라벨은 화면 언어와 상관없이 영어(디자인 문서 10절). 아이콘·선 모양·라벨을 함께 써서 색만으로 구분하지 않는다.
"use client";

import { Circle, CircleCheck, CircleDashed, CirclePause, CircleX, Clock, type LucideIcon } from "lucide-react";

import type { BundleStatus, CoverStatus, MemberRole } from "@/lib/api-sop";
import { translateOrRaw } from "@/lib/admin-format";
import { useI18n } from "@/lib/i18n";

// 진하기로 단계를 보인다(components.css .pill 3단): 진행 중은 연한 파랑, 검토 대기는 다른 사람 차례라 연한 호박, 끝난 일은 꽉 찬 회색
const BUNDLE_STATUS: Record<BundleStatus, { tone: string; Icon: typeof Circle }> = {
  in_progress: { tone: "active", Icon: Circle },
  in_review: { tone: "hold", Icon: Clock },
  done: { tone: "done", Icon: CircleCheck },
};

export function BundleStatusPill({ status, testId }: { status: BundleStatus; testId?: string }) {
  const { t } = useI18n();
  const { tone, Icon } = BUNDLE_STATUS[status];
  return (
    <span className={`pill ${tone}`} data-testid={testId}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {t(`status.bundle.${status}`)}
    </span>
  );
}

export function RoleTag({ role, testId }: { role: MemberRole; testId?: string }) {
  const { t } = useI18n();
  return (
    <span className="tag" data-testid={testId}>
      {t(`role.${role}`)}
    </span>
  );
}

const UNIT_STATUS: Record<CoverStatus, { Icon: typeof Circle }> = {
  unassigned: { Icon: Circle },
  ai_suggested: { Icon: CircleDashed },
  confirmed: { Icon: CircleCheck },
  on_hold: { Icon: CirclePause },
};

// 줄 머리 아이콘 색 - 확정은 주 버튼 색, 나머지는 의미 채움색
const UNIT_ICON_COLOR: Record<CoverStatus, string> = {
  unassigned: "var(--st-none-fill)",
  ai_suggested: "var(--st-ai-ink)",
  confirmed: "var(--st-ok-fill)",
  on_hold: "var(--st-hold-fill)",
};

// Unit 상태 칩 - 줄 상태·결과물 A·용지 보류·Assign 필터가 한 벌(.schip). 글자는 영어 상태 이름 그대로, 대문자는 CSS만
export type ChipTone = CoverStatus | "all" | "danger";

export function UnitStatusChip({ status, size = "md", testId }: { status: CoverStatus; size?: "md" | "sm"; testId?: string }) {
  const { t } = useI18n();
  const { Icon } = UNIT_STATUS[status];
  return (
    <span className="schip" data-tone={status} data-size={size} data-testid={testId}>
      <Icon size={size === "sm" ? 10 : 12} strokeWidth={1.75} aria-hidden />
      {t(`status.unit.${status}`)}
    </span>
  );
}

// 필터 단추 - 누르는 칩(26px), 고르면 꽉 찬 색. 수는 뒤에 옅게
export function FilterChip({ tone, label, count, selected, onClick, testId, icon: Icon }: { tone: ChipTone; label: string; count: number; selected: boolean; onClick: () => void; testId: string; icon: LucideIcon }) {
  return (
    <button type="button" role="tab" aria-selected={selected} className="schip schip-btn" data-tone={tone} data-testid={testId} onClick={onClick}>
      <Icon size={13} strokeWidth={1.75} aria-hidden />
      {label}
      <span className="schip-n">{count}</span>
    </button>
  );
}

export function UnitStatusIcon({ status }: { status: CoverStatus }) {
  const { t } = useI18n();
  const { Icon } = UNIT_STATUS[status];
  return <Icon size={14} strokeWidth={1.5} style={{ color: UNIT_ICON_COLOR[status] }} aria-label={t(`status.unit.${status}`)} />;
}

// 배치·동기화 실행 결과 - 성공은 조용한 회색 바탕, 실패는 꽉 찬 빨강. 모르는 결과 값은 테두리만 두고 값 그대로 보인다
const OUTCOME: Record<string, { tone: string; Icon: typeof Circle }> = {
  success: { tone: "muted", Icon: CircleCheck },
  failure: { tone: "fail", Icon: CircleX },
};

export function OutcomePill({ outcome, testId }: { outcome: string; testId?: string }) {
  const { t } = useI18n();
  const { tone, Icon } = OUTCOME[outcome] ?? { tone: "quiet", Icon: Circle };
  return (
    <span className={`pill ${tone}`} data-testid={testId}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {translateOrRaw(t, `outcome.${outcome}`, outcome)}
    </span>
  );
}
