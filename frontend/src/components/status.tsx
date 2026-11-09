// 상태 표시 - 라벨은 화면 언어와 상관없이 영어(디자인 문서 10절). 아이콘·선 모양·라벨을 함께 써서 색만으로 구분하지 않는다.
"use client";

import { Circle, CircleCheck, CircleDashed, CirclePause, CircleX, Clock } from "lucide-react";

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

const UNIT_STATUS: Record<CoverStatus, { tone: string; Icon: typeof Circle }> = {
  unassigned: { tone: "none", Icon: Circle },
  ai_suggested: { tone: "ai", Icon: CircleDashed },
  confirmed: { tone: "ok", Icon: CircleCheck },
  on_hold: { tone: "hold", Icon: CirclePause },
};

// 줄 머리 아이콘 색 - 확정은 주 버튼 색, 나머지는 의미 채움색
const UNIT_ICON_COLOR: Record<CoverStatus, string> = {
  unassigned: "var(--st-none-fill)",
  ai_suggested: "var(--st-ai-ink)",
  confirmed: "var(--st-ok-fill)",
  on_hold: "var(--st-hold-fill)",
};

export function UnitStatusPill({ status, testId }: { status: CoverStatus; testId?: string }) {
  const { t } = useI18n();
  const { tone, Icon } = UNIT_STATUS[status];
  return (
    <span className={`pill ${tone}`} data-testid={testId}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {t(`status.unit.${status}`)}
    </span>
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
