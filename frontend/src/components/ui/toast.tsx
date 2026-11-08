// 알림 한 줄 - 화면 오른쪽 아래에 떠서 레이아웃을 밀지 않는다. 저장 결과·실패를 알린다. AppShell이 ToastHost를 한 번 둔다.
"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";

type ToastTone = "ok" | "error";

interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
}

// 실패는 읽을 시간을 더 준다
const TOAST_MS: Record<ToastTone, number> = { ok: 3000, error: 7000 };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function showToast(text: string, tone: ToastTone = "ok"): void {
  const id = genId();
  // 같은 문구가 겹쳐 쌓이지 않게 앞의 것을 지운다
  toasts = [...toasts.filter((toast) => toast.text !== text), { id, tone, text }].slice(-4);
  emit();
  window.setTimeout(() => dismissToast(id), TOAST_MS[tone]);
}

const EMPTY: Toast[] = [];

export function ToastHost() {
  const { t } = useI18n();
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div className="fixed bottom-4 right-4 z-50 grid justify-items-end gap-2" aria-live="polite" data-testid="toasts">
      {items.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className="flex max-w-sm items-center gap-2 rounded-md border border-line-2 bg-raised px-3 py-2 text-[13px] leading-5 text-ink shadow-[var(--shadow-2)]"
          data-testid={`toast-${toast.tone}`}
        >
          {toast.tone === "error" ? (
            <CircleAlert size={16} strokeWidth={1.5} className="shrink-0 text-danger" aria-hidden />
          ) : (
            <CircleCheck size={16} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
          )}
          <span className="min-w-0">{toast.text}</span>
          <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("common.close")} data-testid={`toast-close-${toast.id}`} onClick={() => dismissToast(toast.id)}>
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
