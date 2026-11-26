// Assign 키보드 그림 - 도움말의 "키보드 그림" 단추가 여는 큰 창. 키마다 Shift 줄 · 보통 줄을 종류 색으로 보인다(모델 lib/keyboard-map-model.ts).
"use client";

import { Modal } from "@/components/modal";
import type { AssignKeyKind } from "@/lib/assign-keymap";
import { useI18n } from "@/lib/i18n";
import { buildKeyboardMap, GAP_CODE, type MapLabel } from "@/lib/keyboard-map-model";

const KINDS: readonly AssignKeyKind[] = ["move", "judge", "shape", "free"];
// 자판은 글쇠 표에서 한 번만 만든다
const ROWS = buildKeyboardMap();

export function AssignKeyboardMap({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const renderLine = (label: MapLabel | undefined, prefix: string, testSuffix: string, code: string) =>
    label && (
      <span className="kbd-line" data-kind={label.kind} data-testid={`assign-keyboard-map-${testSuffix}-${code}`}>
        {prefix}
        {t(label.labelKey)}
      </span>
    );
  return (
    <Modal title={t("assign.kbd.title")} onClose={onClose} testId="assign-keyboard-map" size="board">
      <div className="kbd-legend" data-testid="assign-keyboard-map-legend">
        {KINDS.map((kind) => (
          <span key={kind}>
            <i className="kbd-swatch" data-kind={kind} aria-hidden />
            {t(`assign.kbd.legend.${kind}`)}
          </span>
        ))}
      </div>
      <div className="kbd-map">
        {ROWS.map((row, index) => (
          <div key={index} className="kbd-row">
            {row.map((item) =>
              item.code === GAP_CODE ? (
                <span key={item.code} style={{ gridColumn: `span ${item.width}` }} aria-hidden />
              ) : (
                <div key={item.code} className="kbd-cap" data-kind={item.kind ?? undefined} data-testid={`assign-keyboard-map-key-${item.code}`} style={{ gridColumn: `span ${item.width}` }}>
                  <span className="kbd-cap-name">{item.cap}</span>
                  {renderLine(item.shift, "⇧ ", "shift", item.code)}
                  {renderLine(item.plain, "", "plain", item.code)}
                  {item.combo && (
                    <span className="kbd-line" data-kind="free">
                      + {item.combo}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-2">{t("assign.kbd.note")}</p>
    </Modal>
  );
}
