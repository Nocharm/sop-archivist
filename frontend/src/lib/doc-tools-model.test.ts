import { describe, expect, it } from "vitest";

import { buildDocTools, type DocTools, type PaperPlace } from "./doc-tools-model";

const at = (place: PaperPlace) => ({ place, canEdit: true, mode: "old" as const });

function diff(a: DocTools, b: DocTools): string[] {
  return (Object.keys(a) as (keyof DocTools)[]).filter((key) => a[key] !== b[key]).sort();
}

describe("buildDocTools", () => {
  it("gives both New places the same tools", () => expect(buildDocTools(at("new-wide"))).toEqual(buildDocTools(at("new-pair"))));
  it("differs from Old only in the decision-bound tools", () => expect(diff(buildDocTools(at("old")), buildDocTools(at("new-pair")))).toEqual(["deleted", "figureDelete", "fold", "wholeBundle"]));
  it("turns everything editable off for a reader", () => expect(buildDocTools({ ...at("new-pair"), canEdit: false })).toMatchObject({ join: false, numberCell: false, unwrap: false, noise: true }));
  // 출처 없는 New 거르기 동안은 고칠 수 있어도 손질하지 않는다(누르면 잇는 자리다)
  it("keeps the shaping tools off while filtering unsourced New", () => expect(buildDocTools({ ...at("old"), mode: "unsourced" })).toMatchObject({ join: false, carve: false, numberCell: false, noise: true }));
});
