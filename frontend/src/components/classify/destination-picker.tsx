// 보낼 곳 고르기 - To-Be의 칸(SOP)·단계(WI)와 고정 처분(삭제·다른 문서로 이동). N/A 칸은 보이지만 고를 수 없다. 메뉴는 트리거에 붙는다.
"use client";

import { ChevronDown, Circle, Trash2, ExternalLink } from "lucide-react";
import { useImperativeHandle, useRef, useState, type Ref } from "react";

import { Menu, MenuRadio } from "@/components/ui/menu";
import { getDestinationId, type Destination, type DestinationOption } from "@/lib/classify-model";
import { useI18n } from "@/lib/i18n";

export interface DestinationPickerHandle {
  open: () => void;
}

interface DestinationPickerProps {
  options: DestinationOption[];
  value: Destination | null;
  /** 사람이 아직 확정하지 않은 값 - 점선 */
  isDraft: boolean;
  /** AI가 낸 값 - 보라 점선(보라는 AI에만 쓴다) */
  isAi?: boolean;
  disabled: boolean;
  onChange: (next: Destination) => void;
  ref?: Ref<DestinationPickerHandle>;
}

export function describeDestination(value: Destination | null, options: DestinationOption[], t: (key: string) => string): { code: string; label: string } | null {
  if (!value) return null;
  if (value.kind === "delete") return { code: "", label: t("classify.deleted") };
  if (value.kind === "move") return { code: "", label: t("classify.moved") };
  const option = options.find((item) => item.id === getDestinationId(value));
  return option ? { code: option.docCode, label: option.label } : { code: "", label: "?" };
}

export function DestinationPicker({ options, value, isDraft, isAi = false, disabled, onChange, ref }: DestinationPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);
  const current = describeDestination(value, options, t);
  const currentId = value ? getDestinationId(value) : null;
  const docCodes = [...new Set(options.map((option) => option.docCode))];
  const tone = !value ? "border-dashed text-ink-3" : value.kind === "delete" ? "border-danger text-danger bg-danger-tint" : isAi ? "border-dashed bg-st-ai-tint" : isDraft ? "border-dashed" : "";

  function pick(next: Destination) {
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`flex h-9 w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-line-2 bg-surface px-2.5 text-left font-semibold ${tone}`}
        style={isAi && value ? { borderColor: "var(--st-ai-line)" } : undefined}
        data-testid="classify-destination"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {!value && <Circle size={14} strokeWidth={1.5} aria-hidden />}
        {value?.kind === "delete" && <Trash2 size={14} strokeWidth={1.5} aria-hidden />}
        {value?.kind === "move" && <ExternalLink size={14} strokeWidth={1.5} aria-hidden />}
        {current ? (
          <span className="min-w-0 truncate">
            {current.code && <span className="mr-1.5 font-mono font-normal text-ink-2">{current.code}</span>}
            {current.label}
          </span>
        ) : (
          <span className="font-normal">{t("classify.chooseWhere")}</span>
        )}
        <ChevronDown size={14} strokeWidth={1.5} className="select-chevron ml-auto" aria-hidden />
      </button>
      {open && (
        <Menu anchorRef={triggerRef} onClose={() => setOpen(false)} testId="classify-destination-menu" align="start">
          <div className="max-h-[420px] w-[340px] overflow-y-auto">
            {docCodes.map((code) => (
              <div key={code} role="group" aria-label={code}>
                <div className="menu-label font-mono">{code}</div>
                {options
                  .filter((option) => option.docCode === code)
                  .map((option) => (
                    <MenuRadio
                      key={option.id}
                      checked={option.id === currentId}
                      disabled={option.disabled}
                      testId={`classify-dest-${option.id}`}
                      onSelect={() => pick(option.destination)}
                    >
                      <span className={`${option.depth ? "pl-4" : ""} ${option.disabled ? "text-ink-4" : ""} min-w-0 truncate`}>
                        {option.label}
                        {option.disabled && " · N/A"}
                      </span>
                    </MenuRadio>
                  ))}
              </div>
            ))}
            <div role="group" aria-label={t("classify.dispositions")} className="mt-1 border-t border-line pt-1">
              <MenuRadio checked={value?.kind === "delete"} testId="classify-dest-delete" onSelect={() => pick({ kind: "delete" })}>
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                {t("classify.deleted")}
              </MenuRadio>
              <MenuRadio checked={value?.kind === "move"} testId="classify-dest-move" onSelect={() => pick({ kind: "move" })}>
                <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
                {t("classify.moved")}
              </MenuRadio>
            </div>
          </div>
        </Menu>
      )}
    </>
  );
}
