// 모핑 단추 - 평소 아이콘만, 호버·포커스 때 라벨이 펼쳐진다. 위험 동작은 펼칠 때 위험색, 확인 모달 안 최종 단추는 처음부터 펼친다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Trash2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";
import { getMorphClassName, MorphButton } from "./morph-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;

function render(node: ReturnType<typeof createElement>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

afterEach(() => {
  host?.remove();
  host = null;
});

describe("getMorphClassName", () => {
  it("marks danger buttons", () => {
    expect(getMorphClassName("danger", false)).toBe("mbtn danger");
  });

  it("keeps the label open when asked", () => {
    expect(getMorphClassName("default", true)).toBe("mbtn reveal");
  });

  it("combines tone and reveal", () => {
    expect(getMorphClassName("primary", true)).toBe("mbtn primary reveal");
  });
});

describe("MorphButton", () => {
  it("always carries its label as the accessible name", () => {
    const onClick = vi.fn();
    const el = render(createElement(MorphButton, { icon: Trash2, label: "Delete", tone: "danger", onClick, testId: "doc-delete" }));
    const button = el.querySelector<HTMLButtonElement>('[data-testid="doc-delete"]');
    expect(button?.getAttribute("aria-label")).toBe("Delete");
    act(() => button?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Checkbox", () => {
  it("toggles through the hidden native input", () => {
    const onChange = vi.fn();
    const el = render(createElement(Checkbox, { checked: false, onChange, testId: "pick-all", ariaLabel: "Pick all" }));
    const input = el.querySelector<HTMLInputElement>('[data-testid="pick-all"]');
    expect(input?.type).toBe("checkbox");
    act(() => input?.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
