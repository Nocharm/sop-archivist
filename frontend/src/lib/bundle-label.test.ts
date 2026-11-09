// Bundle 표시 이름 - 이름이 있으면 이름, 비었으면 순차 코드(BND-0013)를 보인다.
import { describe, expect, it } from "vitest";

import { getBundleLabel } from "./bundle-label";

describe("getBundleLabel", () => {
  it("shows the code when there is no name", () => {
    expect(getBundleLabel({ code: "BND-0013", title: "" })).toBe("BND-0013");
  });

  it("treats a blank name as no name", () => {
    expect(getBundleLabel({ code: "BND-0013", title: "   " })).toBe("BND-0013");
  });

  it("shows the name when there is one", () => {
    expect(getBundleLabel({ code: "BND-0013", title: "Centrifuge" })).toBe("Centrifuge");
  });
});
