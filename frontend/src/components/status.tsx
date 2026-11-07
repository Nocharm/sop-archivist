// 상태 표시 - 라벨은 화면 언어와 상관없이 영어(디자인 문서 10절). 아이콘·선 모양·라벨을 함께 써서 색만으로 구분하지 않는다.
"use client";

import { Circle, CircleCheck, Clock } from "lucide-react";

import type { BundleStatus, MemberRole } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

const BUNDLE_STATUS: Record<BundleStatus, { tone: string; Icon: typeof Circle }> = {
  in_progress: { tone: "quiet", Icon: Circle },
  // 검토 대기는 다른 사람 차례라 호박색으로 기다림을 보인다
  in_review: { tone: "hold", Icon: Clock },
  // 끝난 일은 조용해진다 - 채움 없이 확인 아이콘만
  done: { tone: "quiet", Icon: CircleCheck },
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
