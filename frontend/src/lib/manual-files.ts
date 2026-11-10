// 설명서 원문과 그림 크기를 디스크에서 읽는다 - 서버 컴포넌트(빌드 때 한 번)와 내용 검사만 쓴다. node:fs를 쓰므로 브라우저 쪽 코드가 가져오면 빌드가 깨진다.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { MarkdownImageSize } from "@/components/ui/markdown-view";

import { listImageRefs } from "./manual";

// next build·next dev·vitest 모두 frontend/에서 돈다. standalone 실행 때는 이 화면이 빌드 때 이미 그려져 있어 다시 읽지 않는다
export const MANUAL_DIR = join(process.cwd(), "public", "manual");
export const MANUAL_FILE = "user-manual.md";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function readManualSource(): Promise<string> {
  return readFile(join(MANUAL_DIR, MANUAL_FILE), "utf8");
}

/** PNG 머리(IHDR)에서 가로·세로를 읽는다. PNG가 아니면 null */
export function readPngSize(bytes: Buffer): MarkdownImageSize | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** 글에 쓴 그림마다 원래 크기 - 그림이 늦게 떠도 자리가 먼저 잡혀, 자리(#id)로 연 화면이 밀리지 않는다 */
export async function readImageSizes(source: string): Promise<Record<string, MarkdownImageSize>> {
  const sizes: Record<string, MarkdownImageSize> = {};
  for (const ref of listImageRefs(source)) {
    // 그림 주소 검사는 뷰어가 한다 - 여기서는 설명서 폴더 밖으로 나가는 주소만 건너뛴다
    if (ref.includes("..") || ref.startsWith("/")) continue;
    const size = readPngSize(await readFile(join(MANUAL_DIR, ref)));
    if (size) sizes[ref] = size;
  }
  return sizes;
}
