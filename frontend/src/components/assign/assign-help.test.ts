// 도움말 · 설명서 #assign-keys · 글쇠 표(ASSIGN_KEYS)가 같은 글쇠를 말하는지 - 하나만 고치면 여기서 걸린다(명세 2026-11-23-assign-feedback-2 B2-R2).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ASSIGN_KEYS, formatAssignKey, formatKeyPress, HELP_ONLY } from "@/lib/assign-keymap";
import { setHelpOpen, setHelpTab } from "@/lib/help-prefs";
import { LangProvider } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n-messages";
import { readManualSource } from "@/lib/manual-files";

import { AssignHelp } from "./assign-help";

const MANUAL_GESTURES: Record<string, string> = { click: "누르기", drag: "끌기", wheel: "휠" };
const MOD_MARKS: Record<string, string> = { Shift: "⇧", Ctrl: "Ctrl+", Alt: "Alt+" };

/** 설명서 한 칸의 글쇠 묶음 → 표와 같은 글("⇧H" · "Ctrl+→" · "⇧누르기") */
function readManualPresses(cell: string): string[] {
  return [...cell.matchAll(/((?:<kbd>[^<]+<\/kbd>\+)*)(?:<kbd>([^<]+)<\/kbd>|(누르기|끌기|휠))/g)].map(([, mods, key, gesture]) => {
    const marks = [...mods.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(([, mod]) => MOD_MARKS[mod] ?? mod).join("");
    return `${marks}${key ?? gesture}`;
  });
}

/** 표에 없는 손짓의 글 → 설명서와 같은 글 */
function toManualPress(press: string): string {
  return press.replace(/\{(\w+)\}/, (_whole, gesture: string) => MANUAL_GESTURES[gesture]).replace(/(Shift|Ctrl|Alt) \+ /, (_whole, mod: string) => MOD_MARKS[mod]);
}

const diff = (left: ReadonlySet<string>, right: ReadonlySet<string>) => [...left].filter((item) => !right.has(item));

afterEach(() => {
  setHelpOpen("assign", false);
  document.body.replaceChildren();
});

describe("Assign keys", () => {
  it("the help panel, the manual and the list agree", async () => {
    // Arrange
    const source = await readManualSource();
    const section = source.slice(source.indexOf("{#assign-keys}")).split(/\n##/)[0];
    const inManual = new Set(section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 글쇠")).flatMap((line) => readManualPresses(line.split(" | ")[0])));
    const inList = new Set([...ASSIGN_KEYS.map(formatKeyPress), ...HELP_ONLY.flatMap((item) => item.presses.map(toManualPress))]);

    // Act
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setHelpTab("assign", "keys");
    setHelpOpen("assign", true);
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(createElement(LangProvider, null, createElement(AssignHelp))));
    const rows = [...document.querySelectorAll('[data-testid="assign-help-keys"] > div')].map((row) => [row.querySelector("dt")?.textContent ?? "", row.querySelector("kbd")?.textContent ?? ""]);
    await act(async () => root.unmount());

    // Assert
    expect(diff(inList, inManual), "설명서 `#assign-keys`에 이 글쇠의 줄을 더하거나 `assign-keymap.ts`에서 빼세요").toEqual([]);
    expect(diff(inManual, inList), "`assign-keymap.ts`에 이 글쇠를 더하거나 설명서 `#assign-keys`에서 줄을 빼세요").toEqual([]);
    const en = MESSAGES.en as Record<string, string>;
    const writeGesture = (press: string) => press.replace(/\{(\w+)\}/, (_whole, gesture: string) => en[`assign.help.${gesture}`]);
    const listed = [
      ...[...new Map(ASSIGN_KEYS.map((entry) => [entry.id, en[entry.labelKey]]))].map(([id, label]) => [label, formatAssignKey(id)]),
      ...HELP_ONLY.filter((item) => !item.isDraftOnly).map((item) => [en[item.labelKey], item.presses.map(writeGesture).join(" ")]),
    ];
    expect(rows, "도움말은 `ASSIGN_KEYS` · `HELP_ONLY`를 차례대로 보입니다(`assign-help.tsx`)").toEqual(listed);
  });

  it("every key id has an en and ko label", () => {
    for (const labelKey of [...ASSIGN_KEYS, ...HELP_ONLY].map((item) => item.labelKey)) {
      for (const lang of ["en", "ko"] as const) expect((MESSAGES[lang] as Record<string, string>)[labelKey], `${lang} ${labelKey} - \`i18n-messages.ts\`에 문구를 더하세요`).toBeTruthy();
    }
  });

  it("every line of the help reads differently", () => {
    for (const lang of ["en", "ko"] as const) {
      const labels = [...new Set(ASSIGN_KEYS.map((entry) => entry.labelKey)), ...HELP_ONLY.map((item) => item.labelKey)].map((key) => (MESSAGES[lang] as Record<string, string>)[key]);
      expect(labels.filter((label, index) => labels.indexOf(label) !== index), lang).toEqual([]);
    }
  });
});
