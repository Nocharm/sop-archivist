// 알림 - 화면 오른쪽 위(상단 막대 바로 아래)에 위에서 내려오며 나타나고, 유지 뒤 오른쪽으로 미끄러져 사라진다.
// 새 것이 위에 쌓이고 오래된 것부터 빠지며, 빠진 자리는 높이를 접어 남은 알림이 매끄럽게 메운다. AppShell이 ToastHost를 한 번 둔다.
"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { Tooltip } from "@/components/ui/tooltip";

// info - 실패는 아니지만 기대와 다르게 끝난 일(AI 결과가 버려짐·취소됨)
type ToastTone = "ok" | "error" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  /** 오른쪽으로 빠지는 중 - 전환이 끝나면 목록에서 지운다 */
  leaving: boolean;
}

// 실패는 읽을 시간을 더 준다
const TOAST_MS: Record<ToastTone, number> = { ok: 3000, error: 7000, info: 6000 };
// 빠지는 전환 길이 - motion.css의 .toast-slot 전환(--dur-slow 두 번: 밀려 나가기 → 높이 접기)과 맞춘다
const LEAVE_MS = 480;
const MAX_TOASTS = 4;

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 새 알림을 맨 위에 넣는다 - 같은 문구는 앞의 것을 지우고, 넘치면 가장 오래된 것부터 버린다 */
export function pushToast(list: Toast[], next: Toast, max = MAX_TOASTS): Toast[] {
  return [next, ...list.filter((toast) => toast.text !== next.text)].slice(0, max);
}

export function dismissToast(id: string): void {
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  toasts = toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast));
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  }, LEAVE_MS);
}

export function showToast(text: string, tone: ToastTone = "ok"): void {
  const id = genId();
  toasts = pushToast(toasts, { id, tone, text, leaving: false });
  emit();
  window.setTimeout(() => dismissToast(id), TOAST_MS[tone]);
}

const EMPTY: Toast[] = [];

export function ToastHost() {
  const { t } = useI18n();
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div className="toast-stack" aria-live="polite" data-testid="toasts">
      {items.map((toast) => (
        <div key={toast.id} className="toast-slot" data-leaving={toast.leaving ? "" : undefined}>
          <div className="toast-clip">
            <div role={toast.tone === "error" ? "alert" : "status"} className={`toast ${toast.tone}`} data-testid={`toast-${toast.tone}`}>
              {toast.tone === "error" && <CircleAlert size={16} strokeWidth={1.5} className="shrink-0 text-danger" aria-hidden />}
              {toast.tone === "info" && <Info size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />}
              {toast.tone === "ok" && (
                <CircleCheck size={16} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
              )}
              <span className="min-w-0">{toast.text}</span>
              <Tooltip label={t("common.close")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("common.close")} data-testid={`toast-close-${toast.id}`} onClick={() => dismissToast(toast.id)}>
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
