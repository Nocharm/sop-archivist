// 설명서 조각의 읽음 상태 표시 - 서비스의 상태 표기와 같은 문법: 읽지 않음은 점선, 읽음은 꽉 찬 잉크, 읽은 뒤 바뀜은 보류 색. 라벨은 화면 언어와 상관없이 영어다.
"use client";

import { CircleAlert, CircleCheck, CircleDashed, type LucideIcon } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import type { ReadState } from "@/lib/manual";

const READ_STATE: Record<ReadState, { tone: string; Icon: LucideIcon }> = {
  unread: { tone: "dash", Icon: CircleDashed },
  read: { tone: "ok", Icon: CircleCheck },
  updated: { tone: "hold", Icon: CircleAlert },
};

export function ReadStatePill({ state, testId }: { state: ReadState; testId: string }) {
  const { t } = useI18n();
  const { tone, Icon } = READ_STATE[state];
  const pill = (
    <span className={`pill ${tone}`} data-state={state} data-testid={testId}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {t(`manual.state.${state}`)}
    </span>
  );
  // 왜 다시 읽으라는지는 툴팁으로 - 읽은 뒤 글이 바뀐 조각이다
  return state === "updated" ? <Tooltip label={t("manual.updatedHint")}>{pill}</Tooltip> : pill;
}

/** 목차 줄 끝의 작은 표시 - 색은 줄의 data-state를 보고 CSS가 정한다 */
export function ReadStateIcon({ state }: { state: ReadState }) {
  const { t } = useI18n();
  const { Icon } = READ_STATE[state];
  return <Icon size={14} strokeWidth={1.5} className="manual-toc-state" aria-label={t(`manual.state.${state}`)} />;
}
