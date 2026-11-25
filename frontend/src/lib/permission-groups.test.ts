import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "./access";
import { MESSAGES } from "./i18n-messages";
import { PERMISSION_GROUPS } from "./permission-groups";

describe("permission groups", () => {
  it("covers every permission once, in catalog order", () => {
    expect(PERMISSION_GROUPS.flatMap((entry) => entry.keys)).toEqual([...PERMISSIONS]);
  });

  it("has a hint and a group name in both languages", () => {
    for (const lang of ["en", "ko"] as const) {
      for (const { group, keys } of PERMISSION_GROUPS) {
        expect(MESSAGES[lang][`permissionGroup.${group}`]).toBeTruthy();
        for (const key of keys) expect(MESSAGES[lang][`permission.${key}.hint`]).toBeTruthy();
      }
    }
  });
});
