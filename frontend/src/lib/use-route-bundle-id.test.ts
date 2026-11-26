import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BundleIdContext, useRouteBundleId } from "./use-route-bundle-id";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "42" }) }));

function Probe() {
  return createElement("span", null, String(useRouteBundleId()));
}

describe("useRouteBundleId", () => {
  it("reads the number from the address when no context value is set", () => {
    expect(renderToString(createElement(Probe))).toContain(">42<");
  });

  it("prefers the context value (the practice screen puts -1 there)", () => {
    expect(renderToString(createElement(BundleIdContext, { value: -1 }, createElement(Probe)))).toContain(">-1<");
  });
});
