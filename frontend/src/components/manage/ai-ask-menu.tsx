// AI 요청 더보기 메뉴 - 한 화면에서 고를 수 있는 AI 요청(문서 전체 분류, 번역 등)을 접어 둔다. 고르면 그 요청을 보낸다.
"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { BusyLabel } from "@/components/ui/motion";
import { Menu } from "@/components/ui/menu";

export interface AiAskItem {
  key: string;
  label: string;
  run: () => Promise<void>;
}

export function AiAskMenu({ items, label, testId, disabled = false }: { items: AiAskItem[]; label: string; testId: string; disabled?: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
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

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="btn h-7"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        disabled={disabled || running !== null}
        onClick={() => setOpen((prev) => !prev)}
      >
        <BusyLabel busy={running !== null} icon={<Sparkles size={12} strokeWidth={1.5} className="text-st-ai" aria-hidden />} label={label} />
        <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <Menu anchorRef={anchorRef} onClose={() => setOpen(false)} testId={`${testId}-list`} align="end">
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" className="menu-item" data-testid={`${testId}-${item.key}`} onClick={() => void choose(item)}>
              {item.label}
            </button>
          ))}
        </Menu>
      )}
    </>
  );
}
