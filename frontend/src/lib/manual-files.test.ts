import { describe, expect, it } from "vitest";

import { readPngSize } from "./manual-files";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("readPngSize", () => {
  it("reads the width and height from the PNG header", () => {
    const bytes = Buffer.alloc(24);
    Buffer.from(PNG_HEAD).copy(bytes);
    bytes.writeUInt32BE(1120, 16);
    bytes.writeUInt32BE(720, 20);

    expect(readPngSize(bytes)).toEqual({ width: 1120, height: 720 });
  });

  it("returns null for other files and a cut-off header", () => {
    expect(readPngSize(Buffer.from("GIF89a, not a png, padded to length"))).toBeNull();
    expect(readPngSize(Buffer.from(PNG_HEAD))).toBeNull();
  });
});
