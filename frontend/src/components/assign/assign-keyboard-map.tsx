// Assign 키보드 그림 - 도움말의 "키보드 그림" 단추가 여는 큰 창. 자판 전체에서 쓰는 키마다 보통 줄 · ⇧ 줄을 종류 색으로 보인다(모델 lib/keyboard-map-model.ts).
"use client";

import { useState, type KeyboardEvent } from "react";

import { Modal } from "@/components/modal";
import type { AssignKeyKind } from "@/lib/assign-keymap";
import { useI18n } from "@/lib/i18n";
import { buildKeyboardMap, findMapKey, GAP_CODE, isShiftCode, shouldFlashKey, type MapLabel } from "@/lib/keyboard-map-model";

const KINDS: readonly AssignKeyKind[] = ["move", "judge", "shape", "free"];
// 자판은 글쇠 표에서 한 번만 만든다
const ROWS = buildKeyboardMap();

export function AssignKeyboardMap({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  // 누르고 있는 키(code)와 마지막으로 반짝인 키 - 반짝임은 번호(n)가 바뀌어 같은 키를 다시 눌러도 다시 돈다
  const [held, setHeld] = useState<readonly string[]>([]);
  const [flash, setFlash] = useState<{ code: string; n: number } | null>(null);
  const isShift = held.some(isShiftCode);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const item = findMapKey(event.code);
    if (!item) return;
    // Tab이 창 밖 단추로 가지 않게 - Esc는 그대로 창이 닫는다
    event.preventDefault();
    setHeld((codes) => (codes.includes(event.code) ? codes : [...codes, event.code]));
    if (!event.repeat && shouldFlashKey(item, isShift || isShiftCode(event.code) || event.shiftKey)) setFlash((last) => ({ code: event.code, n: (last?.n ?? 0) + 1 }));
  };
  const renderLine = (label: MapLabel | undefined, prefix: string, testSuffix: string, code: string) =>
    label && (
      <span className={`kbd-line${testSuffix === "shift" ? " is-shift" : ""}`} data-testid={`assign-keyboard-map-${testSuffix}-${code}`}>
        {prefix}
        {t(label.labelKey)}
      </span>
    );
  return (
    <Modal title={t("assign.kbd.title")} onClose={onClose} testId="assign-keyboard-map" size="board">
      {/* 포커스가 여기 있어야 눌린 키를 받는다(창이 열리며 본문의 첫 포커스로 온다) - 글쇠는 화면 단축키로 가지 않는다 */}
      <div
        className="kbd-map outline-none"
        tabIndex={0}
        data-testid="assign-keyboard-map-board"
        data-shift={isShift ? "" : undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => setHeld((codes) => codes.filter((code) => code !== event.code))}
        onBlur={() => setHeld([])}
      >
        {ROWS.map((row, index) => (
          <div key={index} className="kbd-row">
            {row.map((item, at) =>
              item.code === GAP_CODE ? (
                <span key={`gap-${at}`} style={{ gridColumn: `span ${item.width}` }} aria-hidden />
              ) : (
                <div
                  key={flash?.code === item.code ? `${item.code}-${flash.n}` : item.code}
                  className="kbd-cap"
                  data-kind={item.kind ?? undefined}
                  data-pressed={held.includes(item.code) ? "" : undefined}
                  data-flash={flash?.code === item.code ? flash.n : undefined}
                  data-testid={`assign-keyboard-map-key-${item.code}`} 
                  style={{ gridColumn: `span ${item.width}` }}
                >
                  <span className={`kbd-cap-name${item.cap.length > 2 ? " is-small" : ""}`}>{item.cap}</span>
                  {renderLine(item.plain, "", "plain", item.code)}
                  {renderLine(item.shift, "⇧", "shift", item.code)}
                  {item.combo && <span className="kbd-line">+ {item.combo}</span>}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="kbd-legend" data-testid="assign-keyboard-map-legend">
        {KINDS.map((kind) => (
          <span key={kind}>
            <i className="kbd-swatch" data-kind={kind} aria-hidden />
            {t(`assign.kbd.legend.${kind}`)}
          </span>
        ))}
      </div>
      <p className="text-center text-xs text-ink-2">{t("assign.kbd.note")}</p>
    </Modal>
  );
}
