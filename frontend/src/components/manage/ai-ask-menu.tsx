// AI 요청 더보기 메뉴 - 한 화면에서 고를 수 있는 AI 요청(문서 전체 분류, 번역 등)을 접어 둔다. 고르면 그 요청을 보낸다.
// 보내도 서버가 건너뛸 요청은 숨기지 않고 흐리게, 까닭은 data-tip 툴팁이다(누르면 아무 일도 없다).
"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { BusyLabel } from "@/components/ui/motion";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";

export interface AiAskItem {
  key: string;
  label: string;
  run: () => Promise<void>;
  /** 있으면 꺼진 항목 - 왜 못 쓰는지 사람 말로 */
  disabledReason?: string | null;
}

/** compact: 라벨 없이 아이콘만(좁은 도구 줄) - 라벨은 툴팁과 aria-label로 */
export function AiAskMenu({ items, label, testId, disabled = false, compact = false }: { items: AiAskItem[]; label: string; testId: string; disabled?: boolean; compact?: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const tip = useDelegatedTip();
  if (items.length === 0) return null;

  async function choose(item: AiAskItem) {
    setOpen(false);
    setRunning(item.key);
    try {
      await item.run();
    } finally {
      setRunning(null);
    }
  }

  const trigger = (
    <button
      ref={anchorRef}
      type="button"
      className="btn h-7"
      aria-label={compact ? label : undefined}
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid={testId}
      disabled={disabled || running !== null}
      onClick={() => setOpen((prev) => !prev)}
    >
      <BusyLabel busy={running !== null} icon={<Sparkles size={12} strokeWidth={1.5} className="text-st-ai" aria-hidden />} label={compact ? null : label} />
      <ChevronDown size={12} strokeWidth={1.5} className="select-chevron" aria-hidden />
    </button>
  );

  return (
    <>
      {compact ? (
        <Tooltip label={label} suppressed={open}>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open && (
        <Menu anchorRef={anchorRef} onClose={() => setOpen(false)} testId={`${testId}-list`} align="end">
          {/* display: contents - 툴팁 핸들러만 얹고 항목 배치는 Menu 그대로 */}
          <div style={{ display: "contents" }} {...tip.handlers}>
            {items.map((item) => {
              const reason = item.disabledReason ?? null;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  aria-disabled={reason ? "true" : undefined}
                  aria-label={reason ? `${item.label} - ${reason}` : undefined}
                  data-tip={reason ?? undefined}
                  data-tip-side="right"
                  data-testid={`${testId}-${item.key}`}
                  onClick={() => {
                    if (!reason) void choose(item);
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {tip.node}
        </Menu>
      )}
    </>
  );
}
