// Assign 위쪽 줄의 확인할 것 표시(AI 나누기 제안 · 참조 확인 · 캡션 필요) - 아이콘 + 수만 보이고, 올리거나 포커스하면 이름이 옆으로 펼쳐진다.
// 누르면 그 줄 목록이 창으로 뜨고, 줄을 누르면 그 줄로 간다(창 머리의 Next는 지금 줄 다음 것으로). 단추가 많아 넘치던 위쪽 줄을 줄이려는 것(1.2.0 피드백).
"use client";

import { ArrowRight, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useI18n } from "@/lib/i18n";

export interface PendingItem {
  unitId: number;
  label: string;
  text: string;
}

/** 아이콘 + 수 단추 - 이름(words)은 올리거나 포커스할 때 ::after로 펼쳐져 글자 수(innerText)에는 들지 않는다 */
export function PendingTrigger({ icon: Icon, tone, count, words, label, onClick, testId }: { icon: LucideIcon; tone: "ai" | "ref" | "warn"; count: number; words: string; label: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className={`pill ${tone} pending-count`} aria-label={label} data-words={words} data-testid={testId} onClick={onClick}>
      <Icon size={13} strokeWidth={1.6} aria-hidden />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

interface PendingCountProps {
  icon: LucideIcon;
  tone: "ai" | "ref" | "warn";
  /** 이름(수 없이) - 펼친 이름과 창 제목 */
  words: string;
  /** 수가 든 전체 이름 - 읽어 주는 이름 */
  label: string;
  items: PendingItem[];
  onGo: (unitId: number) => void;
  /** 지금 줄 다음 것으로 */
  onNext: () => void;
  testId: string;
}

export function PendingCount({ icon, tone, words, label, items, onGo, onNext, testId }: PendingCountProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <PendingTrigger icon={icon} tone={tone} count={items.length} words={words} label={label} onClick={() => setIsOpen(true)} testId={testId} />
      {isOpen && (
        <Modal
          title={words}
          onClose={() => setIsOpen(false)}
          testId={`${testId}-modal`}
          footer={
            <button
              type="button"
              className="btn pri"
              data-testid={`${testId}-next`}
              onClick={() => {
                setIsOpen(false);
                onNext();
              }}
            >
              {t("assign.pending.next")}
              <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
            </button>
          }
        >
          <ul className="grid max-h-[50vh] gap-1 overflow-y-auto" data-testid={`${testId}-list`}>
            {items.map((item) => (
              <li key={item.unitId}>
                <button
                  type="button"
                  className="pending-row"
                  data-testid={`${testId}-item-${item.unitId}`}
                  onClick={() => {
                    setIsOpen(false);
                    onGo(item.unitId);
                  }}
                >
                  <span className="flex-none font-mono text-xs font-semibold">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
