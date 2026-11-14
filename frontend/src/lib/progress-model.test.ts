import { describe, expect, it } from "vitest";

import { countPending, getConfirmedPercent } from "./progress-model";

const base = { total: 61, unassigned: 5, ai_suggested: 33, on_hold: 7, confirmed: 16, single_language: 17 };

describe("progress-model", () => {
  it("counts rows that are not confirmed", () => expect(countPending(base)).toBe(45));
  it("rounds the confirmed rate", () => expect(getConfirmedPercent(base)).toBe(26));
  it("has no rate for an empty bundle", () => expect(getConfirmedPercent({ ...base, total: 0, confirmed: 0 })).toBeNull());
});
