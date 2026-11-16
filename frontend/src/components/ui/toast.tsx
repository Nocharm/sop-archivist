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

export interface ToastAction {
  label: string;
  run: () => void;
}

/** action - 알림 하나에 행동 하나. durationMs - 머무는 시간을 직접 정한다(없으면 getToastMs) */
export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  /** 오른쪽으로 빠지는 중 - 전환이 끝나면 목록에서 지운다 */
  leaving: boolean;
  action?: ToastAction;
}

// 실패는 읽을 시간을 더 준다
const TOAST_MS: Record<ToastTone, number> = { ok: 3000, error: 7000, info: 6000 };
// 빠지는 전환 길이 - motion.css의 .toast-slot 전환(--dur-slow 두 번: 밀려 나가기 → 높이 접기)과 맞춘다
const LEAVE_MS = 480;
const MAX_TOASTS = 4;
// 행동이 있는 알림은 누를 시간이 필요하다 - 실패 알림(7초)보다도 길게
export const ACTION_TOAST_MS = 10000;
// 포인터·포커스가 떠난 뒤 사라지기까지
export const TOAST_RELEASE_MS = 3000;

let toasts: Toast[] = [];
// 알림마다 사라지는 타이머 - 올려 둔 동안(holdToast)은 멈추고 떠나면 다시 건다
const fadeTimers = new Map<string, number>();
/** 알림을 붙드는 것 - 포인터와 포커스는 따로 든다(하나가 떠나도 다른 하나가 남아 있으면 머문다) */
export type ToastHold = "pointer" | "focus";
const holds = new Map<string, Set<ToastHold>>();
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

function clearFade(id: string): void {
  window.clearTimeout(fadeTimers.get(id));
  fadeTimers.delete(id);
}

function armFade(id: string, ms: number): void {
  clearFade(id);
  fadeTimers.set(id, window.setTimeout(() => dismissToast(id), ms));
}

export function dismissToast(id: string): void {
  clearFade(id);
  holds.delete(id);
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  toasts = toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast));
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  }, LEAVE_MS);
}

export function getToastMs(tone: ToastTone, options?: ToastOptions): number {
  return options?.durationMs ?? (options?.action ? Math.max(TOAST_MS[tone], ACTION_TOAST_MS) : TOAST_MS[tone]);
}

export function showToast(text: string, tone: ToastTone = "ok", options?: ToastOptions): void {
  const id = genId();
  const next: Toast = { id, tone, text, leaving: false };
  if (options?.action) next.action = options.action;
  const before = toasts;
  toasts = pushToast(toasts, next);
  // 같은 글이나 넘침으로 빠진 알림의 타이머는 거둔다
  for (const gone of before) {
    if (toasts.some((toast) => toast.id === gone.id)) continue;
    clearFade(gone.id);
    holds.delete(gone.id);
  }
  emit();
  armFade(id, getToastMs(tone, options));
}

/** 지금 쌓인 알림(위가 먼저) */
export function listToasts(): readonly Toast[] {
  return toasts;
}

/** 닫고 행동을 한 번 돈다 - 없거나 빠지는 중이면 아무 일도 없다 */
export function runToastAction(id: string): void {
  const toast = toasts.find((item) => item.id === id && !item.leaving);
  if (!toast?.action) return;
  dismissToast(id);
  toast.action.run();
}

export function holdToast(id: string, by: ToastHold = "pointer"): void {
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  holds.set(id, new Set([...(holds.get(id) ?? []), by]));
  clearFade(id);
}

/** 그 붙듦을 놓는다 - 남은 붙듦이 없을 때만 TOAST_RELEASE_MS 뒤에 사라지게 다시 건다 */
export function releaseToast(id: string, by: ToastHold = "pointer"): void {
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  const left = holds.get(id);
  left?.delete(by);
  if (left && left.size > 0) return;
  holds.delete(id);
  armFade(id, TOAST_RELEASE_MS);
}

const EMPTY: Toast[] = [];

// 행동이 있는 알림만 포인터·포커스가 머무는 동안 사라지지 않는다
function hoverProps(id: string) {
  return { onPointerEnter: () => holdToast(id, "pointer"), onFocus: () => holdToast(id, "focus"), onPointerLeave: () => releaseToast(id, "pointer"), onBlur: () => releaseToast(id, "focus") };
}

export function ToastHost() {
  const { t } = useI18n();
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div className="toast-stack" aria-live="polite" data-testid="toasts">
      {items.map((toast) => (
        <div key={toast.id} className="toast-slot" data-leaving={toast.leaving ? "" : undefined}>
          <div className="toast-clip">
            <div role={toast.tone === "error" ? "alert" : "status"} className={`toast ${toast.tone}`} data-testid={`toast-${toast.tone}`} {...(toast.action ? hoverProps(toast.id) : {})}>
              {toast.tone === "error" && <CircleAlert size={16} strokeWidth={1.5} className="shrink-0 text-danger" aria-hidden />}
              {toast.tone === "info" && <Info size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />}
              {toast.tone === "ok" && (
                <CircleCheck size={16} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
              )}
              <span className="min-w-0">{toast.text}</span>
              {toast.action && (
                <button type="button" className="btn ghost h-6 toast-action" data-testid={`toast-action-${toast.id}`} onClick={() => runToastAction(toast.id)}>
                  {toast.action.label}
                </button>
              )}
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
