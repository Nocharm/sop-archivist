import { describe, expect, it } from "vitest";

import { getReadOnlyReason } from "./read-only";

describe("getReadOnlyReason", () => {
  it("lets the author edit only while the bundle is in progress", () => {
    expect(getReadOnlyReason({ status: "in_progress", my_role: "author" })).toBeNull();
    expect(getReadOnlyReason({ status: "in_review", my_role: "author" })).toBe("in_review");
    expect(getReadOnlyReason({ status: "done", my_role: "author" })).toBe("done");
  });

  it("names the role when a reviewer opens a bundle that is still in progress", () => {
    expect(getReadOnlyReason({ status: "in_progress", my_role: "reviewer" })).toBe("reviewer");
    expect(getReadOnlyReason({ status: "in_progress", my_role: null })).toBe("reviewer");
  });

  it("puts the bundle status before the role", () => {
    expect(getReadOnlyReason({ status: "done", my_role: "reviewer" })).toBe("done");
  });

  it("says nothing before the bundle has loaded", () => {
    expect(getReadOnlyReason(null)).toBeNull();
  });
});
